---
name: docker-containers
description: >
  Docker containerization patterns with multi-stage builds, Docker Compose, and production best practices.
  Trigger: Docker, Dockerfile, docker-compose, container, multi-stage build, containerization
tools:
  - Read
  - Write
  - Bash
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [docker, containers, devops, multi-stage, compose]
  updated: "2026-02"
---

# Docker Containerization

Production-ready Docker patterns with multi-stage builds and Docker Compose.

## Multi-Stage Builds

### Go Application

```dockerfile
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/api ./cmd/api

# Runtime
FROM alpine:3.19

RUN apk --no-cache add ca-certificates tzdata

WORKDIR /app
COPY --from=builder /bin/api .
COPY --from=builder /app/migrations ./migrations

RUN adduser -D -g '' appuser
USER appuser

EXPOSE 8080
ENTRYPOINT ["./api"]
```

### Rust Application

```dockerfile
FROM rust:1.76-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

# Cache dependencies
RUN cargo new --bin app
WORKDIR /app/app
COPY Cargo.toml Cargo.lock ./
RUN cargo build --release && rm src/*.rs target/release/deps/app*

# Build
COPY src ./src
RUN cargo build --release

# Runtime
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/app/target/release/app .

RUN useradd -r -s /bin/false appuser
USER appuser

ENTRYPOINT ["./app"]
```

### Python FastAPI

```dockerfile
FROM python:3.12-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /wheels -r requirements.txt

# Runtime
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y libpq5 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /wheels /wheels
RUN pip install --no-cache /wheels/*

COPY src/ ./src/

RUN useradd -r -s /bin/false appuser
USER appuser

ENV PYTHONPATH=/app/src
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Node.js/Astro

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Runtime
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

RUN adduser -D appuser
USER appuser

ENV HOST=0.0.0.0 PORT=4321
EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
```

## Docker Compose Development

```yaml
version: '3.8'

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
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  api:
    build:
      context: ./apps/api
      dockerfile: Dockerfile.dev
    ports:
      - "8080:8080"
    environment:
      - DATABASE_URL=postgres://app:app@postgres:5432/app
      - REDIS_URL=redis://redis:6379
    volumes:
      - ./apps/api:/app
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile.dev
    ports:
      - "4321:4321"
    environment:
      - API_URL=http://api:8080
    volumes:
      - ./apps/web/src:/app/src
    depends_on:
      - api

volumes:
  postgres_data:
  redis_data:
```

## Development Dockerfile (Hot Reload)

### Go with Air

```dockerfile
FROM golang:1.22-alpine

WORKDIR /app

RUN go install github.com/cosmtrek/air@latest

COPY go.mod go.sum ./
RUN go mod download

COPY . .

EXPOSE 8080
CMD ["air", "-c", ".air.toml"]
```

### Python with Reload

```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir watchfiles

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/

ENV PYTHONPATH=/app/src
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

## .dockerignore

```
.git
.github
.gitignore
.env
.env.*
!.env.example

**/node_modules
**/dist
**/build
**/__pycache__
**/*.pyc
**/target
**/bin

.vscode
.idea
*.swp

**/coverage
**/.pytest_cache

*.md
!README.md
docs/

Dockerfile*
docker-compose*
.docker

*.db
*.sqlite
data/
```

## BuildKit Cache Mounts

```dockerfile
# Go with cache mount
FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -o /bin/api ./cmd/api
```

```dockerfile
# Python with cache mount
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt
```

## Multi-Platform Build

```dockerfile
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS builder

ARG TARGETOS
ARG TARGETARCH

WORKDIR /app
COPY . .

RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -o /bin/api ./cmd/api
```

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/org/api:latest \
  --push .
```

## Health Checks

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -q --spider http://localhost:8080/health || exit 1
```

```yaml
# docker-compose
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

## Secrets Management

```yaml
services:
  api:
    secrets:
      - db_password
      - jwt_secret
    environment:
      - DB_PASSWORD_FILE=/run/secrets/db_password
      - JWT_SECRET_FILE=/run/secrets/jwt_secret

secrets:
  db_password:
    file: ./secrets/db_password.txt
  jwt_secret:
    file: ./secrets/jwt_secret.txt
```

## Best Practices

1. **Use specific versions** - `golang:1.22-alpine` not `golang:latest`
2. **Non-root user** - Always `USER appuser`
3. **Multi-stage builds** - Separate build and runtime
4. **Layer ordering** - Dependencies first (cached), source last
5. **Minimal base images** - Alpine or distroless
6. **Health checks** - Always include for orchestration
7. **BuildKit** - Enable for cache mounts and parallel builds

## Common Commands

```bash
# Build
docker compose build
docker compose build --no-cache api

# Run
docker compose up -d
docker compose up -d --build

# Logs
docker compose logs -f api

# Shell access
docker compose exec api sh
docker compose exec postgres psql -U app

# Cleanup
docker system prune -a
docker volume prune
```

## Related Skills

- `kubernetes`: Orchestration deployment
- `devops-infra`: CI/CD integration
- `traefik-proxy`: Container routing
- `go-backend`: Go container builds
