---
name: traefik-proxy
description: >
  Traefik reverse proxy configuration, routing, and middleware patterns.
  Trigger: traefik, reverse proxy, load balancer, ingress, routing, tls
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [traefik, proxy, load-balancer, docker, kubernetes]
  updated: "2026-02"
---

# Traefik Reverse Proxy

## Stack Versions

```yaml
Traefik: 3.0+
Docker Provider: enabled
Kubernetes Provider: enabled
Let's Encrypt: enabled
```

## Docker Compose Setup

```yaml
# docker-compose.yml
services:
  traefik:
    image: traefik:v3.0
    container_name: traefik
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./traefik/traefik.yml:/etc/traefik/traefik.yml:ro
      - ./traefik/dynamic:/etc/traefik/dynamic:ro
      - ./traefik/acme.json:/acme.json
    networks:
      - traefik-public
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.traefik.rule=Host(`traefik.example.com`)"
      - "traefik.http.routers.traefik.service=api@internal"
      - "traefik.http.routers.traefik.middlewares=auth"

networks:
  traefik-public:
    external: true
```

## Static Configuration

```yaml
# traefik/traefik.yml
global:
  checkNewVersion: false
  sendAnonymousUsage: false

log:
  level: INFO
  format: json

accessLog:
  format: json
  fields:
    defaultMode: keep
    headers:
      defaultMode: drop
      names:
        User-Agent: keep
        Authorization: redact

api:
  dashboard: true
  insecure: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https

  websecure:
    address: ":443"
    http:
      tls:
        certResolver: letsencrypt
        domains:
          - main: example.com
            sans:
              - "*.example.com"

  metrics:
    address: ":8082"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: traefik-public

  file:
    directory: /etc/traefik/dynamic
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@example.com
      storage: /acme.json
      httpChallenge:
        entryPoint: web

metrics:
  prometheus:
    entryPoint: metrics
    addEntryPointsLabels: true
    addServicesLabels: true
```

## Dynamic Configuration - Middlewares

```yaml
# traefik/dynamic/middlewares.yml
http:
  middlewares:
    # Security headers
    secure-headers:
      headers:
        frameDeny: true
        browserXssFilter: true
        contentTypeNosniff: true
        forceSTSHeader: true
        stsIncludeSubdomains: true
        stsPreload: true
        stsSeconds: 31536000
        referrerPolicy: "strict-origin-when-cross-origin"

    # Rate limiting
    rate-limit:
      rateLimit:
        average: 100
        burst: 50
        period: 1s

    # IP whitelist
    internal-only:
      ipWhiteList:
        sourceRange:
          - "10.0.0.0/8"
          - "172.16.0.0/12"
          - "192.168.0.0/16"

    # Compression
    compress:
      compress:
        excludedContentTypes:
          - text/event-stream

    # Retry
    retry:
      retry:
        attempts: 3
        initialInterval: 100ms

    # Circuit breaker
    circuit-breaker:
      circuitBreaker:
        expression: "NetworkErrorRatio() > 0.5 || ResponseCodeRatio(500, 600, 0, 600) > 0.5"
        checkPeriod: 10s
        fallbackDuration: 30s

    # CORS
    cors:
      headers:
        accessControlAllowMethods:
          - GET
          - POST
          - PUT
          - DELETE
          - OPTIONS
        accessControlAllowHeaders:
          - Content-Type
          - Authorization
        accessControlAllowOriginList:
          - https://app.example.com
        accessControlMaxAge: 86400
```

## Service Labels (Docker)

### API Service

```yaml
services:
  api:
    image: ghcr.io/org/api:latest
    networks:
      - traefik-public
      - internal
    labels:
      - "traefik.enable=true"
      # Router
      - "traefik.http.routers.api.rule=Host(`api.example.com`)"
      - "traefik.http.routers.api.entrypoints=websecure"
      - "traefik.http.routers.api.tls.certresolver=letsencrypt"
      # Service
      - "traefik.http.services.api.loadbalancer.server.port=8080"
      - "traefik.http.services.api.loadbalancer.healthcheck.path=/health"
      - "traefik.http.services.api.loadbalancer.healthcheck.interval=10s"
      # Middlewares
      - "traefik.http.routers.api.middlewares=secure-headers,rate-limit,cors,compress"
      # Sticky sessions
      - "traefik.http.services.api.loadbalancer.sticky.cookie=true"
      - "traefik.http.services.api.loadbalancer.sticky.cookie.name=api_session"
```

### Path-Based Routing

```yaml
services:
  ai-service:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.ai.rule=Host(`api.example.com`) && PathPrefix(`/ai`)"
      - "traefik.http.routers.ai.entrypoints=websecure"
      - "traefik.http.services.ai.loadbalancer.server.port=8000"
      # Strip prefix
      - "traefik.http.middlewares.ai-strip.stripprefix.prefixes=/ai"
      - "traefik.http.routers.ai.middlewares=secure-headers,rate-limit,ai-strip"
```

### WebSocket Service

```yaml
services:
  websocket:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.ws.rule=Host(`ws.example.com`)"
      - "traefik.http.routers.ws.entrypoints=websecure"
      - "traefik.http.services.ws.loadbalancer.server.port=8080"
      # Sticky sessions for WebSocket
      - "traefik.http.services.ws.loadbalancer.sticky.cookie=true"
      - "traefik.http.services.ws.loadbalancer.sticky.cookie.httpOnly=true"
```

## Weighted Load Balancing (Canary)

```yaml
# traefik/dynamic/canary.yml
http:
  services:
    api-weighted:
      weighted:
        services:
          - name: api-stable
            weight: 90
          - name: api-canary
            weight: 10

    api-stable:
      loadBalancer:
        servers:
          - url: "http://api-v1:8080"

    api-canary:
      loadBalancer:
        servers:
          - url: "http://api-v2:8080"

  routers:
    api-canary:
      rule: "Host(`api.example.com`)"
      service: api-weighted
      entryPoints:
        - websecure
```

## Path-Based Routing (File Config)

```yaml
# traefik/dynamic/routes.yml
http:
  routers:
    api-v1:
      rule: "Host(`api.example.com`) && PathPrefix(`/v1`)"
      service: api
      entryPoints:
        - websecure
      middlewares:
        - secure-headers
        - rate-limit

    api-v2:
      rule: "Host(`api.example.com`) && PathPrefix(`/v2`)"
      service: api-v2
      entryPoints:
        - websecure

  services:
    api:
      loadBalancer:
        servers:
          - url: "http://api:8080"
        healthCheck:
          path: /health
          interval: 10s

    api-v2:
      loadBalancer:
        servers:
          - url: "http://api-v2:8080"
```

## Kubernetes IngressRoute

```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: api
  namespace: myapp
spec:
  entryPoints:
    - websecure
  routes:
    - match: Host(`api.example.com`)
      kind: Rule
      services:
        - name: api
          port: 80
      middlewares:
        - name: rate-limit
        - name: secure-headers
  tls:
    certResolver: letsencrypt
---
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: rate-limit
  namespace: myapp
spec:
  rateLimit:
    average: 100
    burst: 50
```

## TLS Configuration

```yaml
# traefik/dynamic/tls.yml
tls:
  options:
    default:
      minVersion: VersionTLS12
      cipherSuites:
        - TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
        - TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384
        - TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305
      curvePreferences:
        - secp521r1
        - secp384r1

    modern:
      minVersion: VersionTLS13
```

## Health Checks

```yaml
# traefik/dynamic/healthcheck.yml
http:
  services:
    api:
      loadBalancer:
        servers:
          - url: "http://api-1:8080"
          - url: "http://api-2:8080"
          - url: "http://api-3:8080"
        healthCheck:
          path: /health
          interval: 10s
          timeout: 3s
          scheme: http
          headers:
            X-Health-Check: traefik
```

## Monitoring - Prometheus Queries

```promql
# Request rate by service
sum(rate(traefik_service_requests_total[5m])) by (service)

# Error rate
sum(rate(traefik_service_requests_total{code=~"5.."}[5m])) by (service)
/ sum(rate(traefik_service_requests_total[5m])) by (service)

# Response time p99
histogram_quantile(0.99,
  sum(rate(traefik_service_request_duration_seconds_bucket[5m])) by (le, service)
)

# Open connections
traefik_entrypoint_open_connections
```

## Best Practices

1. **Always use TLS** - Redirect HTTP to HTTPS
   ```yaml
   entryPoints:
     web:
       http:
         redirections:
           entryPoint:
             to: websecure
   ```

2. **Set security headers** - Prevent XSS, clickjacking
   ```yaml
   middlewares:
     secure-headers:
       headers:
         frameDeny: true
         browserXssFilter: true
   ```

3. **Rate limit public endpoints** - Prevent abuse
   ```yaml
   middlewares:
     rate-limit:
       rateLimit:
         average: 100
         burst: 50
   ```

4. **Use health checks** - Route traffic to healthy backends
   ```yaml
   services:
     api:
       loadBalancer:
         healthCheck:
           path: /health
           interval: 10s
   ```

5. **Enable access logs** - For debugging and auditing
   ```yaml
   accessLog:
     format: json
   ```

## Related Skills

- `kubernetes`: K8s ingress controller
- `docker-containers`: Docker provider
- `jwt-auth`: Auth middleware
- `opentelemetry`: Tracing integration
