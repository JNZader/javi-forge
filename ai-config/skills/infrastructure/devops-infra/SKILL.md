---
name: devops-infra
description: >
  DevOps patterns with Docker multi-stage builds, Kubernetes manifests, GitHub Actions CI/CD, and Terraform.
  Trigger: DevOps, CI/CD, GitHub Actions, Kubernetes, K8s, Terraform, Docker, Helm, deployment, infrastructure
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [devops, docker, kubernetes, github-actions, terraform, ci-cd]
  updated: "2026-02"
---

# DevOps & Infrastructure

Production-ready DevOps patterns for containerization, orchestration, and CI/CD.

## Stack

```yaml
docker: "25.0"
docker-compose: "2.24"
kubernetes: "1.29"
kubectl: "1.29"
helm: "3.14"
terraform: "1.7"
```

## Rust Multi-Stage Dockerfile

```dockerfile
FROM rust:1.76-slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM gcr.io/distroless/cc-debian12
WORKDIR /app
COPY --from=builder /app/target/release/app /app/app
EXPOSE 8080
ENTRYPOINT ["/app/app"]
```

## Go Multi-Stage Dockerfile

```dockerfile
FROM golang:1.22-bookworm AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/api ./cmd/api

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/api /app/api
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/app/api"]
```

## Python Dockerfile

```dockerfile
FROM python:3.11-slim-bookworm AS builder

WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir build && python -m build --wheel

FROM python:3.11-slim-bookworm
WORKDIR /app
COPY --from=builder /app/dist/*.whl ./
RUN pip install --no-cache-dir *.whl && rm *.whl
COPY src/ ./src/
USER nobody
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

## Docker Compose Dev

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 5s

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]

  api:
    build:
      context: .
      dockerfile: Dockerfile.dev
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgres://app:app@postgres:5432/app
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./src:/app/src
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
```

## Kubernetes Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: app
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8080"
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
      containers:
        - name: api
          image: ghcr.io/org/api:latest
          ports:
            - containerPort: 8080
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: app-secrets
                  key: DATABASE_URL
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 15
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 10
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: app
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: api
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api
  namespace: app
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

## GitHub Actions CI

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: "1.22"

      - name: Lint
        uses: golangci/golangci-lint-action@v4

      - name: Test
        run: go test -race -coverprofile=coverage.out ./...

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: app:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## GitHub Actions CD

```yaml
name: CD

on:
  push:
    tags:
      - "v*"

env:
  REGISTRY: ghcr.io

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Login to Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ github.repository }}:${{ github.ref_name }}
            ${{ env.REGISTRY }}/${{ github.repository }}:latest

      - name: Deploy to Kubernetes
        run: |
          echo "${{ secrets.KUBE_CONFIG }}" | base64 -d > kubeconfig
          kubectl --kubeconfig=kubeconfig set image deployment/api api=${{ env.REGISTRY }}/${{ github.repository }}:${{ github.ref_name }}
          kubectl --kubeconfig=kubeconfig rollout status deployment/api
```

## Terraform GKE Module

```hcl
variable "project_id" { type = string }
variable "region" { type = string }
variable "cluster_name" { type = string }

resource "google_container_cluster" "primary" {
  name     = var.cluster_name
  location = var.region
  project  = var.project_id

  remove_default_node_pool = true
  initial_node_count       = 1

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  release_channel {
    channel = "REGULAR"
  }
}

resource "google_container_node_pool" "primary" {
  name       = "primary"
  cluster    = google_container_cluster.primary.name
  location   = var.region

  autoscaling {
    min_node_count = 1
    max_node_count = 10
  }

  node_config {
    machine_type = "e2-standard-4"
    disk_size_gb = 100

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }
}

output "cluster_endpoint" {
  value = google_container_cluster.primary.endpoint
}
```

## OpenTelemetry Collector

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  batch:
    timeout: 10s
  memory_limiter:
    check_interval: 1s
    limit_mib: 1000

exporters:
  prometheus:
    endpoint: "0.0.0.0:8889"
  otlp/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp/jaeger]
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
```

## Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Docker images | kebab-case | `edge-api`, `cloud-api` |
| K8s resources | kebab-case | `api-deployment` |
| K8s namespaces | kebab-case | `app-prod` |
| Terraform vars | snake_case | `project_id` |
| Workflows | kebab-case | `ci.yml`, `cd.yml` |
| Env vars | SCREAMING_SNAKE | `DATABASE_URL` |

## Related Skills

- `kubernetes`: Container orchestration
- `docker-containers`: Multi-stage builds
- `git-workflow`: Branch strategies
- `opentelemetry`: Observability setup
