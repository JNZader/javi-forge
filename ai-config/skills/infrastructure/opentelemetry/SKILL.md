---
name: opentelemetry
description: >
  OpenTelemetry observability patterns for traces, metrics, and logs.
  Trigger: opentelemetry, otel, tracing, metrics, observability, jaeger, prometheus
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [opentelemetry, observability, tracing, metrics, monitoring]
  updated: "2026-02"
---

# OpenTelemetry Observability

## Stack Versions

```yaml
# Go
go.opentelemetry.io/otel: 1.24+

# Python
opentelemetry-sdk: 1.23+
opentelemetry-instrumentation: 0.44+

# Rust
opentelemetry: 0.22+
tracing-opentelemetry: 0.23+

# Collectors
Jaeger: 1.54+
Prometheus: 2.50+
Grafana: 10.3+
```

## Architecture

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  Service A  │  │  Service B  │  │  Service C  │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │ OTLP
                        ▼
              ┌─────────────────┐
              │  OTel Collector │
              └────────┬────────┘
                       │
       ┌───────────────┼───────────────┐
       ▼               ▼               ▼
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   Jaeger    │ │ Prometheus  │ │    Loki     │
│  (Traces)   │ │  (Metrics)  │ │   (Logs)    │
└─────────────┘ └─────────────┘ └─────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │    Grafana      │
              └─────────────────┘
```

## Go Setup

### Tracer Provider

```go
package telemetry

import (
    "context"
    "time"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
    "go.opentelemetry.io/otel/propagation"
    "go.opentelemetry.io/otel/sdk/resource"
    sdktrace "go.opentelemetry.io/otel/sdk/trace"
    semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
    "go.opentelemetry.io/otel/trace"
)

type Config struct {
    ServiceName    string
    ServiceVersion string
    Environment    string
    OTLPEndpoint   string
}

func InitTracer(ctx context.Context, cfg Config) (func(context.Context) error, error) {
    exporter, err := otlptracegrpc.New(ctx,
        otlptracegrpc.WithEndpoint(cfg.OTLPEndpoint),
        otlptracegrpc.WithInsecure(),
    )
    if err != nil {
        return nil, err
    }

    res, err := resource.Merge(
        resource.Default(),
        resource.NewWithAttributes(
            semconv.SchemaURL,
            semconv.ServiceName(cfg.ServiceName),
            semconv.ServiceVersion(cfg.ServiceVersion),
            attribute.String("environment", cfg.Environment),
        ),
    )
    if err != nil {
        return nil, err
    }

    tp := sdktrace.NewTracerProvider(
        sdktrace.WithBatcher(exporter, sdktrace.WithBatchTimeout(5*time.Second)),
        sdktrace.WithResource(res),
        sdktrace.WithSampler(sdktrace.ParentBased(
            sdktrace.TraceIDRatioBased(0.1), // Sample 10%
        )),
    )

    otel.SetTracerProvider(tp)
    otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
        propagation.TraceContext{},
        propagation.Baggage{},
    ))

    return tp.Shutdown, nil
}

func Tracer(name string) trace.Tracer {
    return otel.Tracer(name)
}
```

### HTTP Middleware

```go
package middleware

import (
    "net/http"
    "time"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/metric"
    "go.opentelemetry.io/otel/propagation"
    semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
    "go.opentelemetry.io/otel/trace"
)

type TelemetryMiddleware struct {
    tracer         trace.Tracer
    requestCounter metric.Int64Counter
    requestLatency metric.Float64Histogram
}

func NewTelemetryMiddleware() (*TelemetryMiddleware, error) {
    tracer := otel.Tracer("http-server")
    meter := otel.Meter("http-server")

    requestCounter, _ := meter.Int64Counter(
        "http.server.requests",
        metric.WithDescription("Total HTTP requests"),
    )

    requestLatency, _ := meter.Float64Histogram(
        "http.server.latency",
        metric.WithDescription("HTTP request latency"),
        metric.WithUnit("ms"),
        metric.WithExplicitBucketBoundaries(1, 5, 10, 25, 50, 100, 250, 500, 1000),
    )

    return &TelemetryMiddleware{
        tracer:         tracer,
        requestCounter: requestCounter,
        requestLatency: requestLatency,
    }, nil
}

func (m *TelemetryMiddleware) Handler(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        start := time.Now()

        ctx := otel.GetTextMapPropagator().Extract(r.Context(), propagation.HeaderCarrier(r.Header))
        ctx, span := m.tracer.Start(ctx, r.Method+" "+r.URL.Path,
            trace.WithSpanKind(trace.SpanKindServer),
            trace.WithAttributes(
                semconv.HTTPMethod(r.Method),
                semconv.HTTPRoute(r.URL.Path),
            ),
        )
        defer span.End()

        wrapped := &responseWriter{ResponseWriter: w, statusCode: 200}
        next.ServeHTTP(wrapped, r.WithContext(ctx))

        duration := float64(time.Since(start).Milliseconds())
        attrs := metric.WithAttributes(
            semconv.HTTPMethod(r.Method),
            semconv.HTTPStatusCode(wrapped.statusCode),
        )

        m.requestCounter.Add(ctx, 1, attrs)
        m.requestLatency.Record(ctx, duration, attrs)
        span.SetAttributes(semconv.HTTPStatusCode(wrapped.statusCode))
    })
}

type responseWriter struct {
    http.ResponseWriter
    statusCode int
}

func (w *responseWriter) WriteHeader(code int) {
    w.statusCode = code
    w.ResponseWriter.WriteHeader(code)
}
```

### Database Tracing

```go
package telemetry

import (
    "context"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/codes"
    semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
    "go.opentelemetry.io/otel/trace"
)

type DBTracer struct {
    tracer trace.Tracer
}

func NewDBTracer() *DBTracer {
    return &DBTracer{tracer: otel.Tracer("database")}
}

func (t *DBTracer) TraceQuery(ctx context.Context, operation, query string) (context.Context, func(error)) {
    ctx, span := t.tracer.Start(ctx, "db."+operation,
        trace.WithSpanKind(trace.SpanKindClient),
        trace.WithAttributes(
            semconv.DBSystemPostgreSQL,
            semconv.DBOperation(operation),
            semconv.DBStatement(query),
        ),
    )

    return ctx, func(err error) {
        if err != nil {
            span.RecordError(err)
            span.SetStatus(codes.Error, err.Error())
        }
        span.End()
    }
}
```

### Custom Metrics

```go
package metrics

import (
    "context"

    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/attribute"
    "go.opentelemetry.io/otel/metric"
)

type AppMetrics struct {
    itemsProcessed metric.Int64Counter
    processingTime metric.Float64Histogram
    activeItems    metric.Int64UpDownCounter
}

func NewAppMetrics() (*AppMetrics, error) {
    meter := otel.Meter("app.metrics")

    itemsProcessed, _ := meter.Int64Counter(
        "app.items.processed",
        metric.WithDescription("Number of items processed"),
    )

    processingTime, _ := meter.Float64Histogram(
        "app.processing.time",
        metric.WithDescription("Processing time"),
        metric.WithUnit("ms"),
    )

    activeItems, _ := meter.Int64UpDownCounter(
        "app.active.count",
        metric.WithDescription("Number of active items"),
    )

    return &AppMetrics{
        itemsProcessed: itemsProcessed,
        processingTime: processingTime,
        activeItems:    activeItems,
    }, nil
}

func (m *AppMetrics) RecordItem(ctx context.Context, itemType, status string) {
    attrs := metric.WithAttributes(
        attribute.String("item.type", itemType),
        attribute.String("status", status),
    )
    m.itemsProcessed.Add(ctx, 1, attrs)
}
```

## Python Setup

```python
from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource, SERVICE_NAME, SERVICE_VERSION
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor

def setup_telemetry(service_name: str, service_version: str, otlp_endpoint: str):
    resource = Resource.create({
        SERVICE_NAME: service_name,
        SERVICE_VERSION: service_version,
    })

    # Tracing
    tracer_provider = TracerProvider(resource=resource)
    span_exporter = OTLPSpanExporter(endpoint=otlp_endpoint, insecure=True)
    tracer_provider.add_span_processor(BatchSpanProcessor(span_exporter))
    trace.set_tracer_provider(tracer_provider)

    # Metrics
    metric_reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=otlp_endpoint, insecure=True),
        export_interval_millis=30000,
    )
    meter_provider = MeterProvider(resource=resource, metric_readers=[metric_reader])
    metrics.set_meter_provider(meter_provider)

    # Auto-instrumentation
    AsyncPGInstrumentor().instrument()
    return tracer_provider, meter_provider

def instrument_fastapi(app):
    FastAPIInstrumentor.instrument_app(app)
```

### Custom Spans (Python)

```python
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

tracer = trace.get_tracer(__name__)

class DataProcessor:
    async def process(self, data: list) -> list:
        with tracer.start_as_current_span(
            "data_processing",
            attributes={"data.count": len(data)}
        ) as span:
            try:
                with tracer.start_as_current_span("preprocess"):
                    normalized = self._normalize(data)

                with tracer.start_as_current_span("transform") as transform_span:
                    result = await self._transform(normalized)
                    transform_span.set_attribute("result.count", len(result))

                return result
            except Exception as e:
                span.record_exception(e)
                span.set_status(Status(StatusCode.ERROR, str(e)))
                raise
```

## OpenTelemetry Collector

```yaml
# otel-collector-config.yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 5s
    send_batch_size: 1000

  memory_limiter:
    check_interval: 1s
    limit_mib: 1000
    spike_limit_mib: 200

  filter:
    spans:
      exclude:
        match_type: strict
        attributes:
          - key: http.route
            value: /health

exporters:
  jaeger:
    endpoint: jaeger:14250
    tls:
      insecure: true

  prometheus:
    endpoint: 0.0.0.0:8889

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch, filter]
      exporters: [jaeger]

    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
```

## Docker Compose

```yaml
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.96.0
    command: ["--config=/etc/otel-collector-config.yaml"]
    volumes:
      - ./otel-collector-config.yaml:/etc/otel-collector-config.yaml
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
      - "8889:8889"   # Prometheus metrics

  jaeger:
    image: jaegertracing/all-in-one:1.54
    ports:
      - "16686:16686" # UI
      - "14250:14250" # gRPC

  prometheus:
    image: prom/prometheus:v2.50.1
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:10.3.3
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    ports:
      - "3000:3000"
```

## Prometheus Queries

```promql
# Request rate by endpoint
sum(rate(http_server_requests_total[5m])) by (http_route)

# Error rate
sum(rate(http_server_requests_total{http_status_code=~"5.."}[5m]))
/ sum(rate(http_server_requests_total[5m]))

# P99 latency
histogram_quantile(0.99, sum(rate(http_server_latency_bucket[5m])) by (le, http_route))

# Active items
app_active_count by (item_type)
```

## Best Practices

1. **Use semantic conventions**
   ```go
   import semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
   span.SetAttributes(
       semconv.HTTPMethod(r.Method),
       semconv.HTTPStatusCode(200),
   )
   ```

2. **Context propagation** - Always pass context through the call chain
   ```go
   func (s *Service) Process(ctx context.Context, data Data) error {
       ctx, span := tracer.Start(ctx, "Process")
       defer span.End()
       return s.repo.Save(ctx, data)  // Pass ctx!
   }
   ```

3. **Sampling strategy** - Use parent-based with ratio
   ```go
   sdktrace.WithSampler(sdktrace.ParentBased(
       sdktrace.TraceIDRatioBased(0.1),  // 10% of root spans
   ))
   ```

4. **Cardinality control** - Avoid high-cardinality attributes
   ```go
   // Good - low cardinality
   attribute.String("http.method", "GET")

   // Bad - high cardinality, avoid!
   attribute.String("user.id", userID)
   ```

5. **Error recording** - Always record errors with status
   ```go
   if err != nil {
       span.RecordError(err)
       span.SetStatus(codes.Error, err.Error())
       return err
   }
   ```

## Related Skills

- `kubernetes`: K8s observability
- `fastapi`: Python instrumentation
- `chi-router`: Go instrumentation
- `timescaledb`: Metrics storage
