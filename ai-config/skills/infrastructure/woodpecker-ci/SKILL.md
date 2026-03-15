---
name: woodpecker-ci
description: >
  Woodpecker CI pipeline patterns for container-native CI with Gitea/Forgejo.
  Trigger: Woodpecker, woodpecker CI, .woodpecker.yml, Gitea CI, Forgejo CI, self-hosted CI
tools:
  - Read
  - Write
  - Bash
metadata:
  author: project-starter-framework
  version: "1.0"
  tags: [ci, woodpecker, gitea, forgejo, self-hosted, devops]
  updated: "2026-02"
---

# Woodpecker CI

Container-native CI/CD for Gitea/Forgejo. Each step runs in an isolated container.

## When to Use

- Self-hosted CI with Gitea or Forgejo
- Container-native pipelines (every step = container)
- Monorepo with independent workflows per service

## Pipeline Syntax

### Basic Pipeline

```yaml
# .woodpecker.yml
when:
  - event: tag
  - event: manual
  - event: push
    branch: main

steps:
  - name: build
    image: node:20-alpine
    commands:
      - npm ci
      - npm run build

  - name: test
    image: node:20-alpine
    commands:
      - npm test
```

### Services (Databases, Caches)

```yaml
services:
  - name: postgres
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: test

steps:
  - name: test
    image: golang:1.23-bookworm
    environment:
      DATABASE_URL: "postgres://test:test@postgres:5432/test?sslmode=disable"
    commands:
      - go test ./...
```

### Secrets

```yaml
steps:
  - name: deploy
    image: alpine:latest
    environment:
      DEPLOY_TOKEN:
        from_secret: deploy_token
      REGISTRY_PASSWORD:
        from_secret: registry_password
    commands:
      - echo "$DEPLOY_TOKEN" | some-deploy-tool login
```

### When Conditions

```yaml
when:
  # Event types
  - event: push
  - event: pull_request
  - event: tag
  - event: manual
  - event: cron

  # Branch filtering
  - event: push
    branch: main

  # Path filtering (monorepo)
  - path: "packages/api/**"

  # Combined
  - event: push
    branch: main
    path: "src/**"
```

### Matrix Builds

```yaml
matrix:
  GO_VERSION:
    - "1.22"
    - "1.23"

steps:
  - name: test
    image: golang:${GO_VERSION}-bookworm
    commands:
      - go test ./...
```

### Docker Builds

```yaml
steps:
  - name: docker
    image: woodpeckerci/plugin-docker-buildx
    settings:
      repo: registry.example.com/my-app
      tag: ${CI_COMMIT_TAG}
      dockerfile: Dockerfile
    when:
      - event: tag
```

## Monorepo Pattern

Woodpecker natively supports multiple pipeline files. Place each in `.woodpecker/`:

```
.woodpecker/
  frontend.yml    # Independent workflow
  backend.yml     # Independent workflow
  summary.yml     # depends_on: [frontend, backend]
```

```yaml
# .woodpecker/backend.yml
when:
  - path: "packages/backend/**"

steps:
  - name: build
    image: golang:1.23-bookworm
    commands:
      - cd packages/backend
      - go build ./...
```

```yaml
# .woodpecker/summary.yml
depends_on:
  - frontend
  - backend

steps:
  - name: summary
    image: alpine:latest
    commands:
      - echo "All services built"
```

## Critical Patterns

### Pattern 1: Step Failure Handling

```yaml
# Allow a step to fail without failing the pipeline
steps:
  - name: lint
    image: golangci/golangci-lint:latest
    commands:
      - golangci-lint run
    failure: ignore  # Pipeline continues even if lint fails
```

### Pattern 2: Environment Variables

```yaml
# CI-provided variables
# ${CI_COMMIT_TAG}       - Git tag
# ${CI_COMMIT_SHA}       - Full commit SHA
# ${CI_COMMIT_BRANCH}    - Branch name
# ${CI_REPO_NAME}        - Repository name
# ${CI_PIPELINE_NUMBER}  - Pipeline number
```

### Pattern 3: Conditional Steps

```yaml
steps:
  - name: deploy
    image: alpine:latest
    commands:
      - ./deploy.sh
    when:
      - event: tag
      - event: push
        branch: main
```

## Anti-Patterns

### No `cache:` Directive

Woodpecker does not have a declarative `cache:` like GitLab CI.

```yaml
# Wrong - this syntax does not exist in Woodpecker
cache:
  paths:
    - node_modules/

# Correct - mount volumes on the Woodpecker server config
# or accept fresh installs per build
steps:
  - name: build
    image: node:20-alpine
    commands:
      - npm ci
      - npm run build
```

### No `stages:` Keyword

Steps run sequentially by default. Use `depends_on` for multi-pipeline ordering.

```yaml
# Wrong - stages don't exist in Woodpecker
stages:
  - build
  - test

# Correct - steps run in order, use depends_on between pipelines
steps:
  - name: build
    image: node:20-alpine
    commands:
      - npm run build

  - name: test
    image: node:20-alpine
    commands:
      - npm test
```

### No `image:` at Top Level

Each step defines its own image.

```yaml
# Wrong - no global image
image: node:20-alpine
steps:
  - name: build
    commands:
      - npm run build

# Correct - image per step
steps:
  - name: build
    image: node:20-alpine
    commands:
      - npm run build
```

## Quick Reference

| Task | Syntax |
|------|--------|
| Run on tags | `when: [{event: tag}]` |
| Run on push to main | `when: [{event: push, branch: main}]` |
| Path filter | `when: [{path: "src/**"}]` |
| Use secret | `environment: {VAR: {from_secret: name}}` |
| Allow failure | `failure: ignore` |
| Docker build | `image: woodpeckerci/plugin-docker-buildx` |
| Pipeline dependency | `depends_on: [other-pipeline]` |
| Manual trigger | `when: [{event: manual}]` |

## Differences vs GitHub Actions / GitLab CI

| Feature | GitHub Actions | GitLab CI | Woodpecker |
|---------|---------------|-----------|------------|
| Config file | `.github/workflows/*.yml` | `.gitlab-ci.yml` | `.woodpecker.yml` or `.woodpecker/*.yml` |
| Execution | VMs or containers | Containers | Containers (always) |
| Caching | `actions/cache` | `cache:` directive | Server-side volumes |
| Secrets | `${{ secrets.X }}` | `$VARIABLE` | `from_secret: x` |
| Monorepo | Path filters in `on:` | `rules: changes:` | Multiple `.yml` + `path:` |
| Hosting | GitHub cloud | GitLab cloud/self | Self-hosted only |

## Resources

- [Woodpecker CI Docs](https://woodpecker-ci.org/docs/intro)
- [Pipeline Syntax](https://woodpecker-ci.org/docs/usage/pipeline-syntax)
- [Plugins Index](https://woodpecker-ci.org/plugins)

## Related Skills

- `devops-infra`: CI/CD integration patterns
- `docker-containers`: Container builds
- `ci-local-guide`: Local CI validation
