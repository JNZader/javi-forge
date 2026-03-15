# GHAGGA - AI Code Review for GitHub PRs

> Multi-Agent code review automatizado para Pull Requests de GitHub.

## Que es GHAGGA

[GHAGGA](https://github.com/JNZader/ghagga/) es un sistema de code review con IA que revisa automaticamente tus Pull Requests usando multiples proveedores LLM (Claude, GPT, Gemini).

## Arquitectura

```
GitHub PR → Webhook → Supabase Edge Function → Multi-LLM Review → PR Comments
                                    ↓
                              Dashboard React
```

### Componentes

| Componente | Stack | Descripcion |
|-----------|-------|-------------|
| Dashboard | React + Mantine + Vite | UI para configurar y monitorear reviews |
| Backend | Supabase + Deno Edge Functions | Procesa webhooks y orquesta reviews |
| Database | PostgreSQL + pgvector + pg_trgm | Almacena reviews, embeddings, busqueda |
| Analysis | Semgrep | Analisis estatico complementario |

### Modos de Review

| Modo | Descripcion | Cuando usar |
|------|-------------|-------------|
| **Simple** | Un solo LLM analiza el codigo | Reviews rapidas, bajo costo |
| **Workflow** | Pipeline multi-paso secuencial | Analisis profundo, cada paso especializado |
| **Consensus** | Multiples LLMs evaluan y votan | Maxima confiabilidad, reviews criticas |

## Opciones de Deployment

| Opcion | Complejidad | Costo | Cuando usar |
|--------|------------|-------|-------------|
| Reusable Workflow | Baja | Free tier | Solo quieres PR reviews, sin dashboard |
| Docker Compose | Media | Self-hosted | Equipo quiere dashboard, tiene servidor |
| Full Clone | Alta | Self-hosted | Necesitas personalizar logica de review |

### Costos de API
- **Simple mode**: ~$0.01-0.05 por review (1 LLM call)
- **Workflow mode**: ~$0.05-0.15 por review (multi-paso)
- **Consensus mode**: ~$0.15-0.50 por review (multiples LLMs)

## Instalacion

### Prerequisitos

- [Supabase CLI](https://supabase.com/docs/guides/cli)
- [Docker](https://docker.com) (para Supabase local)
- [Deno](https://deno.land) (para Edge Functions)
- Una GitHub App configurada

### Opcion 1: Reusable Workflow (CI)

En tu `.github/workflows/ci.yml`:

```yaml
jobs:
  review:
    uses: JNZader/project-starter-framework/.github/workflows/reusable-ghagga-review.yml@main
    with:
      ghagga-url: ${{ vars.GHAGGA_URL }}
    secrets:
      ghagga-token: ${{ secrets.GHAGGA_TOKEN }}
```

### Opcion 2: Docker Compose (este modulo)

```bash
# Desde tu proyecto
cp optional/ghagga/docker-compose.yml .
cp optional/ghagga/.env.example .env.ghagga

# Editar .env.ghagga con tus keys
# Levantar servicios
docker compose -f docker-compose.yml up -d
```

### Opcion 3: Full Clone (desarrollo)

```bash
# Clonar GHAGGA
git clone https://github.com/JNZader/ghagga.git
cd ghagga

# Levantar Supabase local
supabase start

# Configurar variables de entorno
cp .env.example .env
# Editar .env con tus API keys

# Servir Edge Functions
supabase functions serve

# Dashboard
cd dashboard && npm install && npm run dev
```

## Setup GitHub App

1. Ir a GitHub Settings > Developer settings > GitHub Apps
2. Crear nueva app con permisos:
   - **Pull requests**: Read & Write (para comentar)
   - **Contents**: Read (para leer codigo)
   - **Webhooks**: Activar para eventos `pull_request`
3. Configurar Webhook URL apuntando a tu instancia de GHAGGA
4. Generar Private Key y guardarla como secret

Ver guia completa: [GHAGGA - GitHub App Setup](https://github.com/JNZader/ghagga/blob/main/docs/GITHUB_APP_SETUP.md)

## Configuracion de Providers

GHAGGA soporta multiples proveedores LLM:

| Provider | Modelos | Variable de entorno |
|----------|---------|-------------------|
| Anthropic | claude-sonnet-4-20250514 | `ANTHROPIC_API_KEY` |
| OpenAI | gpt-4o, gpt-4-turbo | `OPENAI_API_KEY` |
| Google | gemini-2.0-flash, gemini-1.5-pro | `GOOGLE_API_KEY` |
| Azure OpenAI | gpt-4o (via Azure) | `AZURE_OPENAI_*` |

Configura al menos un provider en tu `.env`.

## Features Avanzadas

### Hebbian Learning

GHAGGA aprende de reviews anteriores para mejorar recomendaciones futuras.
Los patrones recurrentes se refuerzan automaticamente.

### Hybrid Search

Combina busqueda semantica (pgvector embeddings) con full-text search (pg_trgm) para encontrar codigo similar y reviews previas relevantes.

### Semgrep Integration

Ejecuta reglas Semgrep como complemento al analisis LLM, cubriendo patrones de seguridad OWASP.

## Integracion con el Framework

Cuando usas GHAGGA con project-starter-framework:

- **CI-Local** valida codigo antes del push (pre-commit, pre-push)
- **GHAGGA** revisa el PR despues del push (review automatico)
- **Ambos** usan Semgrep: CI-Local para chequeo local, GHAGGA para analisis profundo

```
Developer → CI-Local (pre-push) → Push → PR → GHAGGA Review → Merge
```
