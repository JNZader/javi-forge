# Auto-Invoke Rules

> Reglas de invocación automática de skills y agentes.
> **OBLIGATORIO:** Antes de realizar estas acciones, SIEMPRE carga la skill correspondiente.

---

## Skill Auto-Invoke Table

| Acción del Usuario | Skill a Cargar | Scope (Carpetas) |
|--------------------|----------------|------------------|
| Crear componente React/Astro | `frontend-web` | `src/`, `components/`, `pages/` |
| Crear componente Mantine UI | `mantine-ui` | `src/`, `components/` |
| Configurar Astro SSR | `astro-ssr` | `src/`, `astro.config.*` |
| Data fetching con React Query | `tanstack-query` | `src/`, `hooks/`, `api/` |
| Validar schemas/forms | `zod-validation` | `src/`, `schemas/`, `validators/` |
| Estado global Zustand | `zustand-state` | `src/`, `store/`, `stores/` |
| Crear endpoint Go/Chi | `chi-router` | `cmd/`, `internal/`, `api/` |
| Queries PostgreSQL con pgx | `pgx-postgres` | `internal/`, `repository/`, `db/` |
| Backend Go completo | `go-backend` | `cmd/`, `internal/`, `pkg/` |
| Crear endpoint FastAPI | `fastapi` | `src/`, `app/`, `api/` |
| Autenticación JWT | `jwt-auth` | `auth/`, `middleware/`, `security/` |
| Async Rust con Tokio | `tokio-async` | `src/`, `Cargo.toml` |
| IoT/MQTT messaging | `mqtt-rumqttc` | `src/`, `iot/`, `mqtt/` |
| Protocolo Modbus | `modbus-protocol` | `src/`, `industrial/`, `modbus/` |
| WebSockets real-time | `websockets` | `src/`, `ws/`, `realtime/` |
| Rust systems programming | `rust-systems` | `src/`, `Cargo.toml` |
| Time-series TimescaleDB | `timescaledb` | `db/`, `migrations/`, `sql/` |
| Cache Redis | `redis-cache` | `cache/`, `redis/`, `internal/` |
| SQLite embedded/mobile | `sqlite-embedded` | `db/`, `mobile/`, `offline/` |
| Analytics DuckDB | `duckdb-analytics` | `analytics/`, `data/`, `scripts/` |
| Deploy Kubernetes | `kubernetes` | `k8s/`, `deploy/`, `manifests/` |
| CI/CD DevOps | `devops-infra` | `.github/`, `ci/`, `docker/` |
| Docker containers | `docker-containers` | `Dockerfile*`, `docker-compose*` |
| Traefik routing | `traefik-proxy` | `traefik/`, `proxy/`, `ingress/` |
| Observability/tracing | `opentelemetry` | `observability/`, `telemetry/` |
| LangChain/LLM apps | `langchain` | `agents/`, `chains/`, `llm/` |
| AI/ML pipelines | `ai-ml` | `ml/`, `models/`, `training/` |
| ONNX model inference | `onnx-inference` | `models/`, `inference/`, `onnx/` |
| PyTorch training | `pytorch` | `training/`, `models/`, `nn/` |
| Scikit-learn ML | `scikit-learn` | `ml/`, `models/`, `sklearn/` |
| MLflow experiments | `mlflow` | `experiments/`, `mlruns/`, `mlflow/` |
| Vector databases/RAG | `vector-db` | `vectorstore/`, `embeddings/`, `rag/` |
| E2E tests Playwright | `playwright-e2e` | `tests/`, `e2e/`, `playwright/` |
| Unit tests Vitest | `vitest-testing` | `tests/`, `__tests__/`, `*.test.*` |
| Mobile Ionic/Capacitor | `mobile-ionic`, `ionic-capacitor` | `src/`, `mobile/`, `capacitor/` |
| Git workflow/branches | `git-workflow` | `.git/`, root |
| GitHub API/CLI | `git-github` | `.github/`, root |
| Technical documentation | `technical-docs` | `docs/`, `*.md` |
| Power BI reports | `powerbi` | `reports/`, `bi/`, `dashboards/` |

---

## Agent Auto-Invoke Table

| Contexto de Trabajo | Agente a Usar | Cuándo |
|---------------------|---------------|--------|
| Diseño de APIs | `api-designer` | Crear/diseñar REST, GraphQL, OpenAPI |
| Arquitectura backend | `backend-architect` | Diseño de servicios, microservicios |
| Frontend React | `react-pro` | Patterns avanzados React |
| Frontend Vue | `vue-specialist` | Vue 3, Composition API |
| Frontend Angular | `angular-expert` | Angular 17+, signals |
| TypeScript avanzado | `typescript-pro` | Tipos complejos, generics |
| Go development | `golang-pro` | Concurrencia, patterns Go |
| Rust systems | `rust-pro` | Memory safety, async Rust |
| Python development | `python-pro` | Async, type hints, FastAPI |
| Java/Spring | `java-enterprise` | Spring Boot, JPA |
| Code review | `code-reviewer` | Revisar PRs, quality checks |
| Testing strategy | `test-engineer` | Test planning, coverage |
| E2E testing | `e2e-test-specialist` | Playwright, Cypress |
| Security audit | `security-auditor` | OWASP, vulnerabilities |
| Performance | `performance-engineer` | Profiling, optimization |
| DevOps/CI-CD | `devops-engineer` | Pipelines, containers |
| Kubernetes | `kubernetes-expert` | K8s troubleshooting |
| Cloud architecture | `cloud-architect` | AWS, GCP, Azure design |
| Data engineering | `data-engineer` | ETL, data pipelines |
| ML/AI | `ai-engineer` | LLMs, ML production |
| Data science | `data-scientist` | Statistics, ML models |
| Documentation | `technical-writer` | Docs, guides, ADRs |

---

## Inventario Completo de Skills

> Incluye **todas** las skills disponibles (auto o manual). Las reglas automáticas siguen siendo las de la tabla anterior.

| Skill | Auto-Invoke | Scope/Notas |
|-------|------------|------------|
| `_TEMPLATE` | Manual | Plantilla |
| `ai-ml` | Manual | General |
| `analytics-concepts` | Manual | General |
| `analytics-spring` | Manual | General |
| `api-documentation` | Manual | General |
| `api-gateway` | Manual | General |
| `astro-ssr` | Auto | `src/`, `astro.config.*` |
| `bff-concepts` | Manual | General |
| `bff-spring` | Manual | General |
| `chaos-engineering` | Manual | General |
| `chaos-spring` | Manual | General |
| `chi-router` | Auto | `cmd/`, `internal/`, `api/` |
| `ci-local-guide` | Manual | General |
| `claude-automation-recommender` | Manual | General |
| `claude-md-improver` | Manual | General |
| `devops-infra` | Auto | `.github/`, `ci/`, `docker/` |
| `docker-containers` | Auto | `Dockerfile*`, `docker-compose*` |
| `docs-spring` | Manual | General |
| `duckdb-analytics` | Auto | `analytics/`, `data/`, `scripts/` |
| `error-handling` | Manual | General |
| `exceptions-spring` | Manual | General |
| `fastapi` | Auto | `src/`, `app/`, `api/` |
| `frontend-design` | Manual | General |
| `frontend-web` | Auto | `src/`, `components/`, `pages/` |
| `gateway-spring` | Manual | General |
| `git-github` | Auto | `.github/`, root |
| `git-workflow` | Auto | `.git/`, root |
| `go-backend` | Auto | `cmd/`, `internal/`, `pkg/` |
| `gradle-multimodule` | Manual | General |
| `graph-databases` | Manual | General |
| `graph-spring` | Manual | General |
| `graphql-concepts` | Manual | General |
| `graphql-spring` | Manual | General |
| `grpc-concepts` | Manual | General |
| `grpc-spring` | Manual | General |
| `ide-plugins` | Manual | General |
| `ide-plugins-intellij` | Manual | General |
| `ionic-capacitor` | Auto | `src/`, `mobile/`, `capacitor/` |
| `jwt-auth` | Auto | `auth/`, `middleware/`, `security/` |
| `kubernetes` | Auto | `k8s/`, `deploy/`, `manifests/` |
| `langchain` | Auto | `agents/`, `chains/`, `llm/` |
| `mantine-ui` | Auto | `src/`, `components/` |
| `mlflow` | Manual | General |
| `mobile-ionic` | Auto | `src/`, `mobile/`, `capacitor/` |
| `modbus-protocol` | Auto | `src/`, `industrial/`, `modbus/` |
| `mqtt-rumqttc` | Auto | `src/`, `iot/`, `mqtt/` |
| `mustache-templates` | Manual | General |
| `notifications-concepts` | Manual | General |
| `onnx-inference` | Auto | `models/`, `inference/`, `onnx/` |
| `opentelemetry` | Auto | `observability/`, `telemetry/` |
| `pgx-postgres` | Auto | `internal/`, `repository/`, `db/` |
| `playwright-e2e` | Auto | `tests/`, `e2e/`, `playwright/` |
| `powerbi` | Auto | `reports/`, `bi/`, `dashboards/` |
| `pytorch` | Auto | `training/`, `models/`, `nn/` |
| `recommendations-concepts` | Manual | General |
| `redis-cache` | Auto | `cache/`, `redis/`, `internal/` |
| `references/hooks-patterns` | Manual | Referencia |
| `references/mcp-servers` | Manual | Referencia |
| `references/plugins-reference` | Manual | Referencia |
| `references/skills-reference` | Manual | Referencia |
| `references/subagent-templates` | Manual | Referencia |
| `rust-systems` | Auto | `src/`, `Cargo.toml` |
| `scikit-learn` | Auto | `ml/`, `models/`, `sklearn/` |
| `search-concepts` | Manual | General |
| `search-spring` | Manual | General |
| `spring-boot-4` | Manual | General |
| `sqlite-embedded` | Auto | `db/`, `mobile/`, `offline/` |
| `tanstack-query` | Auto | `src/`, `hooks/`, `api/` |
| `technical-docs` | Auto | `docs/`, `*.md` |
| `testcontainers` | Manual | General |
| `timescaledb` | Auto | `db/`, `migrations/`, `sql/` |
| `tokio-async` | Auto | `src/`, `Cargo.toml` |
| `traefik-proxy` | Auto | `traefik/`, `proxy/`, `ingress/` |
| `vector-db` | Auto | `vectorstore/`, `embeddings/`, `rag/` |
| `vitest-testing` | Auto | `tests/`, `__tests__/`, `*.test.*` |
| `obsidian-brain-workflow` | Manual | `.project/`, `.obsidian/` |
| `wave-workflow` | Manual | General |
| `websockets` | Auto | `src/`, `ws/`, `realtime/` |
| `woodpecker-ci` | Manual | General |
| `zod-validation` | Auto | `src/`, `schemas/`, `validators/` |
| `zustand-state` | Auto | `src/`, `store/`, `stores/` |

---

## Inventario Completo de Agentes

> Incluye **todos** los agentes disponibles (auto o manual). Las reglas automáticas siguen siendo las de la tabla anterior.

| Agente | Auto-Invoke | Notas |
|--------|------------|-------|
| `_TEMPLATE` | Manual | Plantilla |
| `api-designer` | Auto | Diseño de APIs |
| `business-analyst` | Manual | Business |
| `product-strategist` | Manual | Business |
| `project-manager` | Manual | Business |
| `requirements-analyst` | Manual | Business |
| `technical-writer` | Auto | Documentation |
| `code-reviewer` | Auto | Code review |
| `code-reviewer-compact` | Manual | Quick review checklist |
| `ux-designer` | Manual | Creative |
| `ai-engineer` | Auto | ML/AI |
| `analytics-engineer` | Manual | Data/AI |
| `data-engineer` | Auto | Data engineering |
| `data-scientist` | Auto | Data science |
| `mlops-engineer` | Manual | Data/AI |
| `prompt-engineer` | Manual | Data/AI |
| `angular-expert` | Auto | Frontend Angular |
| `backend-architect` | Auto | Arquitectura backend |
| `database-specialist` | Manual | Development |
| `frontend-specialist` | Manual | Development |
| `fullstack-engineer` | Manual | Development |
| `golang-pro` | Auto | Go development |
| `java-enterprise` | Auto | Java/Spring |
| `javascript-pro` | Manual | Development |
| `nextjs-pro` | Manual | Development |
| `python-pro` | Auto | Python development |
| `react-pro` | Auto | Frontend React |
| `rust-pro` | Auto | Rust systems |
| `typescript-pro` | Auto | TypeScript avanzado |
| `vue-specialist` | Auto | Frontend Vue |
| `cloud-architect` | Auto | Cloud architecture |
| `deployment-manager` | Manual | Infra |
| `devops-engineer` | Auto | DevOps/CI-CD |
| `incident-responder` | Manual | Infra |
| `kubernetes-expert` | Auto | Kubernetes |
| `monitoring-specialist` | Manual | Infra |
| `performance-engineer` | Auto | Performance |
| `orchestrator` | Manual | Orquestación |
| `accessibility-auditor` | Manual | Quality |
| `dependency-manager` | Manual | Quality |
| `e2e-test-specialist` | Auto | E2E testing |
| `performance-tester` | Manual | Quality |
| `security-auditor` | Auto | Security audit |
| `test-engineer` | Auto | Testing strategy |
| `agent-generator` | Manual | Specialized |
| `blockchain-developer` | Manual | Specialized |
| `code-migrator` | Manual | Specialized |
| `context-manager` | Manual | Specialized |
| `documentation-writer` | Manual | Specialized |
| `ecommerce-expert` | Manual | Specialized |
| `embedded-engineer` | Manual | Specialized |
| `error-detective` | Manual | Specialized |
| `fintech-specialist` | Manual | Specialized |
| `freelance-project-planner` | Manual | Specialized |
| `freelance-project-planner-v2` | Manual | Specialized |
| `freelance-project-planner-v3` | Manual | Specialized |
| `freelance-project-planner-v4` | Manual | Specialized |
| `game-developer` | Manual | Specialized |
| `healthcare-dev` | Manual | Specialized |
| `mobile-developer` | Manual | Specialized |
| `parallel-plan-executor` | Manual | Specialized |
| `plan-executor` | Manual | Specialized |
| `solo-dev-planner-modular/00-INDEX` | Manual | Specialized docs |
| `solo-dev-planner-modular/01-CORE` | Manual | Specialized docs |
| `solo-dev-planner-modular/02-SELF-CORRECTION` | Manual | Specialized docs |
| `solo-dev-planner-modular/03-PROGRESSIVE-SETUP` | Manual | Specialized docs |
| `solo-dev-planner-modular/04-DEPLOYMENT` | Manual | Specialized docs |
| `solo-dev-planner-modular/05-TESTING` | Manual | Specialized docs |
| `solo-dev-planner-modular/06-OPERATIONS` | Manual | Specialized docs |
| `solo-dev-planner-modular/INSTALL` | Manual | Specialized docs |
| `solo-dev-planner-modular/README` | Manual | Specialized docs |
| `solo-dev-planner-modular/solo-dev-planner` | Manual | Specialized docs |
| `solo-dev-planner-modular/START-HERE` | Manual | Specialized docs |
| `solo-dev-planner-modular/WORKFLOW-DIAGRAM` | Manual | Specialized docs |
| `vibekanban-smart-worker` | Manual | Specialized |
| `workflow-optimizer` | Manual | Specialized |
| `spring-boot-4-expert` | Manual | Specialized |
| `template-writer` | Manual | Specialized |
| `test-runner` | Manual | Specialized |
| `wave-executor` | Manual | Specialized |

## Reglas de Invocación

### 1. Detección por Carpeta (Scope)
```
Si el archivo está en src/components/ → Cargar frontend-web, mantine-ui
Si el archivo está en internal/api/  → Cargar chi-router, go-backend
Si el archivo está en k8s/           → Cargar kubernetes, devops-infra
```

### 2. Detección por Extensión
```
*.tsx, *.jsx  → frontend-web, tanstack-query
*.go          → go-backend, chi-router
*.rs          → rust-systems, tokio-async
*.py          → fastapi, ai-ml
*.yaml (k8s)  → kubernetes
```

### 3. Detección por Contenido
```
import { useQuery }      → tanstack-query
import { z } from 'zod'  → zod-validation
from fastapi import      → fastapi
use tokio::              → tokio-async
```

---

## Ejemplo de Uso

**Usuario:** "Crea un componente de tabla con paginación"

**Proceso del Orquestador:**
1. Detecta: "componente" → Cargar `frontend-web`
2. Detecta: "tabla" → Cargar `mantine-ui` (tiene DataTable pattern)
3. Si hay data fetching → Cargar `tanstack-query`
4. Ejecutar con contexto de los 3 skills cargados

---

*Auto-generado. Mantener sincronizado con skills disponibles.*
