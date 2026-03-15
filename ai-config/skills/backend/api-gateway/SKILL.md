---
name: api-gateway
description: >
  API Gateway concepts. Routing, rate limiting, authentication, load balancing.
  Trigger: API Gateway, routing, load balancing, reverse proxy, edge service
tools:
  - Read
  - Write
  - Edit
  - Grep
metadata:
  author: apigen-team
  version: "1.0"
  tags: [gateway, routing, microservices, edge]
  scope: ["**/gateway/**"]
---

# API Gateway Concepts

## What is an API Gateway?

```
Single entry point for all client requests

         ┌─────────────────┐
         │    Clients      │
         │ (Web, Mobile)   │
         └────────┬────────┘
                  │
         ┌────────▼────────┐
         │   API Gateway   │
         │  (routing,      │
         │   auth, rate    │
         │   limiting)     │
         └────────┬────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐    ┌───▼───┐    ┌───▼───┐
│User   │    │Order  │    │Product│
│Service│    │Service│    │Service│
└───────┘    └───────┘    └───────┘
```

## Core Responsibilities

### Routing
```
Route requests to appropriate backend services:

/api/users/*     → User Service
/api/orders/*    → Order Service
/api/products/*  → Product Service

Path rewriting:
/api/users/123   → /users/123 (strip prefix)
```

### Authentication/Authorization
```
Centralized auth at edge:
1. Validate JWT token
2. Extract user context
3. Forward user info to services
4. Return 401/403 if invalid

Benefits:
- Services don't need auth logic
- Consistent auth across services
- Token validation cached
```

### Rate Limiting
```
Protect services from overload:

Per client:
  Anonymous: 60 req/min
  Authenticated: 1000 req/min
  Premium: 10000 req/min

Per endpoint:
  /api/search: 30 req/min
  /api/login: 5 req/min
```

### Load Balancing
```
Distribute traffic across instances:

Strategies:
- Round Robin
- Least Connections
- Weighted
- IP Hash (sticky sessions)

Health checks:
- Remove unhealthy instances
- Automatic failover
```

## Additional Features

### Request/Response Transformation
```
Transform requests:
- Add headers (correlation ID, auth)
- Modify body
- Change content type

Transform responses:
- Remove internal headers
- Standardize error format
- Add CORS headers
```

### Caching
```
Cache responses at edge:

Benefits:
- Reduce backend load
- Faster response times
- Resilience (serve cached on failure)

Strategies:
- Cache by URL + headers
- Cache invalidation
- Vary by user/tenant
```

### Circuit Breaking
```
Prevent cascade failures:

States:
- Closed: Normal operation
- Open: Fail fast (service down)
- Half-Open: Test recovery

Configuration:
- Failure threshold
- Timeout
- Recovery window
```

### Logging & Monitoring
```
Centralized observability:

Metrics:
- Request rate
- Error rate
- Latency (P50, P95, P99)
- Active connections

Logging:
- Access logs
- Request/response bodies (debug)
- Correlation IDs

Tracing:
- Distributed trace propagation
- Span timing
```

## Gateway Patterns

### Backend for Frontend (BFF)
```
Separate gateways per client type:

Web BFF Gateway    → Web-specific routes
Mobile BFF Gateway → Mobile-optimized APIs
Partner Gateway    → B2B API contracts
```

### API Composition
```
Aggregate multiple services:

GET /api/dashboard
  → GET /users/me
  → GET /orders/recent
  → GET /notifications/unread
  → Combined response
```

### Canary Releases
```
Route % of traffic to new version:

v1 (stable): 95%
v2 (canary): 5%

Progressive rollout:
Day 1: 5%
Day 2: 25%
Day 3: 50%
Day 4: 100%
```

## Gateway Solutions

```
| Solution | Type | Best For |
|----------|------|----------|
| Kong | Open source | Feature-rich, plugins |
| AWS API Gateway | Managed | AWS ecosystem |
| Apigee | Enterprise | API management |
| NGINX | OSS | Performance |
| Spring Cloud Gateway | Framework | Java/Spring |
| Envoy | Proxy | Service mesh |
| Traefik | Cloud-native | Kubernetes |
```

## Security Considerations

```
✅ TLS termination at gateway
✅ Request validation (size, content-type)
✅ SQL injection / XSS prevention
✅ DDoS protection
✅ IP allowlisting/blocklisting
✅ Bot detection
✅ API key rotation
✅ Secrets management
```

## Best Practices

```
Performance:
✅ Connection pooling
✅ Async I/O
✅ Response streaming
✅ Compression

Reliability:
✅ Health checks
✅ Graceful degradation
✅ Retry with backoff
✅ Timeout configuration

Operations:
✅ Blue-green deployment
✅ Configuration as code
✅ Centralized logging
✅ Alerting on error spikes
```

## Related Skills

- `gateway-spring`: Spring Cloud Gateway implementation
