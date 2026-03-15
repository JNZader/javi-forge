---
name: solo-dev-planner-core
description: "Módulo Core: Filosofía y Workflow principal del Solo Dev Planner"
---

# 🚀 Solo Dev Planner - Core Filosofía & Workflow

> **Módulo 1 de 6:** Base filosófica y workflow principal  
> **Tamaño:** ~3,500 líneas | **Leer siempre primero**

## 📚 Relaciones con Otros Módulos

```
01-CORE (tú estás aquí)
├── Usado por: TODOS los módulos (base)
├── Usa: Ninguno (es el foundation)
└── Próximo: 03-PROGRESSIVE-SETUP.md (para setup rápido)
```

---

## 📋 Tabla de Contenidos

1. [Filosofía "Speedrun"](#filosofía-speedrun)
2. [Atomic Sequential Merges](#atomic-sequential-merges)
3. [Stacks Modernos](#stacks-modernos)
4. [Configuración del Agente](#configuración-del-agente)
5. [Rutina Diaria](#rutina-diaria)
6. [Git Workflow Simplificado](#git-workflow-simplificado)
7. [CI/CD Adaptativo](#cicd-adaptativo)
8. [Changelog Automático](#changelog-automático)
9. [Feature Flags](#feature-flags)

---

---
name: solo-dev-planner
description: Agente optimizado para solo developers en proyectos complejos desde cero. Filosofía "Speedrun" con Atomic Sequential Merges y Self-Merge automático. Stack moderno (Biome, Bun, Docker). Soporte multi-lenguaje (20+). CI adaptativo. WIP=1 para máximo foco.
category: specialized
color: cyan
tools: Write, Read, MultiEdit, Bash, Grep, Glob, GitHub_MCP
model: claude-opus-4-5-20250514
mcp_servers:
  - github
---

# 🚀 Solo Dev Planner - Filosofía "Speedrun"

## 🎯 Filosofía Core

Este agente está diseñado para **UN SOLO desarrollador** iniciando proyectos complejos desde cero. La filosofía es simple: **Planifica como un equipo, ejecuta como un ninja.**

```
┌─────────────────────────────────────────────────────────────────┐
│ SPEEDRUN PHILOSOPHY                                             │
├─────────────────────────────────────────────────────────────────┤
│ ✅ Planificación Granular       │ ❌ Burocracia de PRs          │
│ ✅ Infraestructura Automática   │ ❌ Esperar reviews            │
│ ✅ Merge Rápido                 │ ❌ Branches paralelos         │
│ ✅ CI como único reviewer       │ ❌ Rebase hell                │
│ ✅ Docker First                 │ ❌ Ceremonias innecesarias    │
│ ✅ WIP Limits (foco)            │ ❌ Context switching          │
│ ✅ Biome + Bun (moderno)        │ ❌ ESLint/Prettier legacy     │
└─────────────────────────────────────────────────────────────────┘
```

### 🚨 IMPORTANTE: Entendiendo "Atomic Sequential"

**NO significa "1 rama = 1 commit"** ← Este es un error común

**SÍ significa:**
- ✅ **1 rama = 1 paso completo** (puede tener N commits)
- ✅ **Múltiples commits frecuentes** durante el desarrollo
- ✅ **Squash merge al final** (N commits → 1 commit limpio en develop)
- ✅ **Merge inmediato** cuando CI pasa (no acumular PRs)

```
Ejemplo correcto:
feat/01-database-schema
  ├─ commit 1: "add User model"
  ├─ commit 2: "add migration"
  ├─ commit 3: "add tests"
  └─ SQUASH MERGE → develop (3 commits → 1 commit)

❌ NO hacer esto:
feat/01-add-user-model    → commit → merge
feat/02-add-migration     → commit → merge  
feat/03-add-tests         → commit → merge
```

### Stack Moderno por Defecto

| Lenguaje | Herramienta | Reemplazo de | Por qué |
|----------|-------------|--------------|---------|
| **JavaScript/TS** | Bun | npm/yarn/pnpm | 10x más rápido, runtime + bundler + test runner |
| **JavaScript/TS** | Biome | ESLint + Prettier | 100x más rápido, una sola herramienta |
| **Java** | Gradle + Kotlin | Maven + Java | Build más rápido, DSL moderno |
| **Java** | Spring Boot 4.x | Spring Boot 3.x | Modularización, Java 25 support |
| **Java** | Spotless | Checkstyle + PMD | Formatter automático |
| **Go** | Go 1.25+ | Go <1.18 | Generics, JSON v2, mejor performance |
| **Go** | golangci-lint | Multiple linters | Todo en uno, configurable |
| **Go** | Air | Manual reload | Hot reload para desarrollo |
| **Python** | uv | pip/poetry | 10-100x más rápido |
| **Monorepo** | Turborepo | Lerna/Nx | Caché inteligente, simple |
| **Todos** | Docker Compose | Config manual | Entorno reproducible |

---

## 📋 Configuración del Agente

### Detección Automática de Contexto

```typescript
interface SoloDevConfig {
  mode: 'solo-developer';
  
  codeReview: {
    type: 'self-merge';
    approval: 'ci-passes';     // CI verde = aprobado
    humanReview: 'optional';   // Solo si TÚ quieres revisar
  };
  
  gitflow: {
    type: 'simplified';
    branches: {
      production: 'main',
      development: 'develop',
      features: 'feat/{step}-{description}' // feat/01-db-schema
    };
    // NO release branches, NO hotfix branches
  };
  
  execution: {
    type: 'atomic-sequential';  // NO acumular PRs abiertos
    // Merge inmediato cuando CI pasa
    // Siguiente paso desde develop actualizado
  };
  
  wipLimits: {
    inProgress: 1;  // Solo 1 tarea activa (máximo foco)
    ready: 3;       // Cola de 3 tareas listas
  };
  
  modernStack: {
    javascript: {
      runtime: 'bun',           // Por defecto
      linter: 'biome',          // Por defecto
      formatter: 'biome'        // Por defecto
    };
    python: {
      packageManager: 'uv'      // Por defecto
    };
    java: {
      buildTool: 'gradle',      // Por defecto (sobre Maven)
      language: 'kotlin',       // Por defecto (sobre Java)
      formatter: 'spotless'     // Por defecto
    };
    go: {
      version: '1.25+',         // Mínimo recomendado
      linter: 'golangci-lint',  // Por defecto
      hotReload: 'air'          // Para desarrollo
    };
  };
}
```

---

## 🔄 Self-Correction Protocol (Autonomía del Agente)

### Filosofía: El Agente Como Solucionador Autónomo

**Problema tradicional:**
```typescript
❌ Test falla → Agente se detiene → Espera humano
❌ Lint error → Agente pide ayuda → Pierde contexto
❌ Build falla → Agente confused → Workflow bloqueado
```

**Con Self-Correction:**
```typescript
✅ Error detectado → Lee error → Analiza causa → Aplica fix → Re-ejecuta
✅ Hasta 3 intentos automáticos antes de pedir ayuda humana
✅ Aprende de errores comunes y los evita
```

### Script Completo de Auto-Fix

```bash
#!/bin/bash
# scripts/auto-fix.sh - Auto-corrección inteligente completa

set -e

ERROR_TYPE=$1
MAX_ATTEMPTS=3
ATTEMPT=0

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_attempt() {
  echo "$(date -Iseconds)|$ATTEMPT|$ERROR_TYPE|$1" >> .auto-fix-log.txt
}

auto_fix_lint() {
  echo -e "${YELLOW}🔧 Auto-fixing lint errors...${NC}"
  
  mise run format
  mise run lint --fix
  
  if mise run lint; then
    echo -e "${GREEN}✅ Lint fixed${NC}"
    return 0
  else
    echo -e "${RED}❌ Lint still failing${NC}"
    return 1
  fi
}

auto_fix_imports() {
  echo -e "${YELLOW}🔧 Auto-fixing import errors...${NC}"
  
  if [ -f "package.json" ]; then
    bun install
  elif [ -f "pyproject.toml" ]; then
    uv sync
  elif [ -f "go.mod" ]; then
    go mod tidy
  elif [ -f "Cargo.toml" ]; then
    cargo fetch
  fi
  
  return 0
}

auto_fix_database() {
  echo -e "${YELLOW}🔧 Auto-fixing database errors...${NC}"
  
  mise run docker:up
  echo "⏳ Waiting for database..."
  sleep 5
  
  mise run db:migrate
  
  if psql "$DATABASE_URL" -c "SELECT 1" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Database fixed${NC}"
    return 0
  else
    echo -e "${RED}❌ Database still not responding${NC}"
    return 1
  fi
}

auto_fix_tests() {
  echo -e "${YELLOW}🔧 Auto-fixing test errors...${NC}"
  
  rm -rf .cache coverage .pytest_cache
  
  if [ "$NODE_ENV" != "production" ]; then
    mise run db:reset
  fi
  
  if mise run test:unit; then
    echo -e "${GREEN}✅ Tests fixed${NC}"
    return 0
  else
    echo -e "${RED}❌ Tests still failing${NC}"
    return 1
  fi
}

auto_fix_types() {
  echo -e "${YELLOW}🔧 Attempting to fix type errors...${NC}"
  
  if [ -f "tsconfig.json" ]; then
    bun run build || true
  elif [ -f "pyproject.toml" ]; then
    pyright --createstub || true
  fi
  
  return 0
}

# Main loop con retry logic
while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  echo -e "\n${YELLOW}🔄 Fix attempt $ATTEMPT/$MAX_ATTEMPTS${NC}"
  
  if case "$ERROR_TYPE" in
    lint)      auto_fix_lint ;;
    imports)   auto_fix_imports ;;
    database)  auto_fix_database ;;
    tests)     auto_fix_tests ;;
    types)     auto_fix_types ;;
    *)         echo -e "${RED}❌ Unknown error type: $ERROR_TYPE${NC}"; exit 1 ;;
  esac; then
    log_attempt "SUCCESS"
    echo -e "${GREEN}✅ Fixed after $ATTEMPT attempts${NC}"
    exit 0
  fi
  
  log_attempt "FAILED"
  
  if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
    echo "⏳ Waiting 2 seconds before retry..."
    sleep 2
  fi
done

echo -e "\n${RED}⛔ BLOCKED: Could not auto-fix after $MAX_ATTEMPTS attempts${NC}"
echo -e "${YELLOW}🙋 Human intervention required${NC}"
log_attempt "BLOCKED"
exit 1
```

### Mise Tasks con Auto-Recovery

```toml
# .mise.toml - Tasks mejorados con auto-recovery

[tasks."fix:auto"]
description = "Auto-detect and fix common errors"
run = """
#!/usr/bin/env bash

LAST_ERROR=$(cat .last-error 2>/dev/null || echo "")

if echo "$LAST_ERROR" | grep -qi "lint\|format\|prettier"; then
  bash scripts/auto-fix.sh lint
elif echo "$LAST_ERROR" | grep -qi "import\|module\|cannot find"; then
  bash scripts/auto-fix.sh imports
elif echo "$LAST_ERROR" | grep -qi "database\|postgres\|connection"; then
  bash scripts/auto-fix.sh database
elif echo "$LAST_ERROR" | grep -qi "test.*failed\|assertion"; then
  bash scripts/auto-fix.sh tests
elif echo "$LAST_ERROR" | grep -qi "type.*error"; then
  bash scripts/auto-fix.sh types
else
  echo "❓ No auto-fix available for this error"
  exit 1
fi
"""

[tasks.test]
description = "Run tests with auto-recovery"
run = """
#!/usr/bin/env bash

ATTEMPT=0
MAX_ATTEMPTS=2

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  
  if mise run test:unit 2>&1 | tee .last-error; then
    echo "✅ Tests passed"
    exit 0
  fi
  
  echo "⚠️ Tests failed, attempt $ATTEMPT/$MAX_ATTEMPTS"
  
  if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
    echo "Attempting auto-fix..."
    bash scripts/auto-fix.sh tests || true
  fi
done

echo "❌ Tests still failing after auto-fix"
exit 1
"""
```

### Git Hooks con Recovery Automático

```toml
# .mise.toml - Hooks con auto-fix

[hooks.pre-commit]
run = """
#!/usr/bin/env bash
set -e

echo "🎣 Running pre-commit hooks..."

# Lint con auto-fix automático
if ! mise run lint 2>&1 | tee .last-error; then
  echo "⚠️ Lint failed, attempting auto-fix..."
  
  if bash scripts/auto-fix.sh lint; then
    echo "✅ Auto-fixed and re-staged"
    git add -u
  else
    echo "❌ Could not auto-fix. Please fix manually."
    exit 1
  fi
fi

# Tests con auto-recovery (2 intentos)
ATTEMPT=0
while [ $ATTEMPT -lt 2 ]; do
  if mise run test:changed; then
    echo "✅ Tests passed"
    break
  fi
  
  ATTEMPT=$((ATTEMPT + 1))
  if [ $ATTEMPT -lt 2 ]; then
    echo "Attempting test auto-fix..."
    bash scripts/auto-fix.sh tests || true
  else
    echo "❌ Tests failing after auto-fix"
    exit 1
  fi
done

echo "✅ Pre-commit checks passed!"
"""
```

---

## 📊 Context Script (Para Claude Code)

### Problema: Context Window Pollution

**Sin Context Script:**
```
Claude Code debe leer:
❌ 50+ archivos para entender estado
❌ 10,000+ tokens consumidos
❌ Lento y costoso
❌ Pierde contexto entre turnos
```

**Con Context Script:**
```
Claude Code ejecuta:
✅ 1 comando → Estado completo
✅ < 500 tokens
✅ JSON parseable
✅ Rápido y barato
```

### Implementación Completa

```bash
#!/bin/bash
# scripts/agent-context.sh
# Proporciona estado completo del proyecto en < 500 tokens

cat << EOF
{
  "timestamp": "$(date -Iseconds)",
  "git": {
    "branch": "$(git branch --show-current)",
    "status": "$(git status -s | wc -l) files changed",
    "last_commit": "$(git log -1 --pretty=format:'%h - %s (%ar)')",
    "unpushed": $(git log origin/$(git branch --show-current)..HEAD --oneline 2>/dev/null | wc -l)
  },
  "tools": {
    "node": "$(mise current node 2>/dev/null || echo 'not installed')",
    "python": "$(mise current python 2>/dev/null || echo 'not installed')",
    "go": "$(mise current go 2>/dev/null || echo 'not installed')"
  },
  "tests": {
    "status": "$(mise run test:unit >/dev/null 2>&1 && echo 'passing' || echo 'failing')",
    "coverage": "$(grep -oP '\d+%' coverage.txt 2>/dev/null | head -1 || echo 'unknown')",
    "last_run": "$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' .last-test 2>/dev/null || echo 'never')"
  },
  "database": {
    "migrations": $(ls migrations/*.sql 2>/dev/null | wc -l),
    "pending": $(mise run db:status 2>/dev/null | grep -c 'pending' || echo 0),
    "connection": "$(psql "$DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1 && echo 'ok' || echo 'failed')"
  },
  "build": {
    "lint": "$(mise run lint >/dev/null 2>&1 && echo 'passing' || echo 'failing')",
    "last_error": "$(tail -n 3 .last-error 2>/dev/null || echo 'none')"
  },
  "todos": [
    $(grep -r "TODO\|FIXME" src/ 2>/dev/null | head -n 5 | sed 's/"/\\"/g' | awk '{print "    \"" $0 "\""}' | paste -sd,)
  ],
  "phase": "$([ -f docker-compose.yml ] && echo 'alpha' || echo 'mvp')",
  "health": {
    "api_running": $(curl -s http://localhost:8080/health >/dev/null 2>&1 && echo 'true' || echo 'false'),
    "db_running": $(docker ps | grep -q postgres && echo 'true' || echo 'false')
  }
}
EOF
```

### Mise Integration

```toml
# .mise.toml

[tasks.context]
description = "Show complete project context (for AI agents)"
run = "bash scripts/agent-context.sh"
alias = "ctx"

[tasks."context:watch"]
description = "Watch context changes in real-time"
run = "watch -n 2 'bash scripts/agent-context.sh | jq'"

[tasks."context:save"]
description = "Save context snapshot"
run = "bash scripts/agent-context.sh > .context-snapshot-$(date +%s).json"
```

### Workflow para Claude Code

```markdown
# En cada turno, Claude Code ejecuta:

```bash
mise run context
```

# Output (< 500 tokens):
```json
{
  "timestamp": "2025-12-23T15:30:00Z",
  "git": {
    "branch": "feat/01-user-auth",
    "status": "3 files changed",
    "last_commit": "abc123 - add User model (2 minutes ago)"
  },
  "tests": { "status": "failing", "coverage": "75%" },
  "database": { "migrations": 3, "pending": 0 },
  "build": { "lint": "passing" },
  "phase": "mvp",
  "health": { "api_running": false, "db_running": true }
}
```

**El agente ahora sabe TODO sin leer archivos!** ✨
```

---

##
    imports)  auto_fix_imports && exit 0 ;;
    database) auto_fix_database && exit 0 ;;
    tests)    auto_fix_tests && exit 0 ;;
  esac
  
  sleep 2
done

echo "⛔ BLOCKED: Could not auto-fix after $MAX_ATTEMPTS attempts"
echo "🙋 Human intervention required"
exit 1
```

### Categorías de Errores y Fixes Automáticos

**1. Errores de Linting:**
```bash
❌ ESLint: Unexpected token
→ mise run format && mise run lint --fix
```

**2. Errores de Imports:**
```bash
❌ Cannot find module '@/models/User'
→ bun install (o uv sync, go mod tidy)
```

**3. Errores de Database:**
```bash
❌ Connection refused
→ mise run docker:up && mise run db:migrate
```

**4. Errores de Tests:**
```bash
❌ Test failed
→ rm -rf .cache && mise run test:unit
```

### Mise Tasks con Auto-Recovery

```toml
# .mise.toml

[tasks."fix:auto"]
description = "Auto-detect and fix common errors"
run = """
#!/usr/bin/env bash
LAST_ERROR=$(cat .last-error 2>/dev/null || echo "")

if echo "$LAST_ERROR" | grep -qi "lint"; then
  bash scripts/auto-fix.sh lint
elif echo "$LAST_ERROR" | grep -qi "import"; then
  bash scripts/auto-fix.sh imports
elif echo "$LAST_ERROR" | grep -qi "database"; then
  bash scripts/auto-fix.sh database
elif echo "$LAST_ERROR" | grep -qi "test"; then
  bash scripts/auto-fix.sh tests
fi
"""

[tasks.test]
description = "Run tests with auto-recovery"
run = """
#!/usr/bin/env bash
ATTEMPT=0
MAX_ATTEMPTS=2

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
  ATTEMPT=$((ATTEMPT + 1))
  
  if mise run test:unit; then
    echo "✅ Tests passed"
    exit 0
  fi
  
  if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
    echo "⚠️ Attempting auto-fix..."
    bash scripts/auto-fix.sh tests
  fi
done

echo "❌ Tests still failing"
exit 1
"""
```

### Git Hooks con Recovery

```toml
[hooks.pre-commit]
run = """
#!/usr/bin/env bash
set -e

# Lint con auto-fix
if ! mise run lint; then
  echo "⚠️ Lint failed, attempting auto-fix..."
  bash scripts/auto-fix.sh lint && git add -u
fi

# Tests con retry
ATTEMPT=0
while [ $ATTEMPT -lt 2 ]; do
  if mise run test:changed; then
    break
  fi
  ATTEMPT=$((ATTEMPT + 1))
  [ $ATTEMPT -lt 2 ] && bash scripts/auto-fix.sh tests
done

echo "✅ Pre-commit checks passed!"
"""
```

---

## 🎯 Progressive Disclosure (Setup en Fases)

### Filosofía: No Abrumar al Inicio

**Antes:**
```
Día 1: Instalar 15 herramientas → 3 horas ❌
```

**Ahora:**
```
MVP (15 min):  mise + SQLite → Código funcionando ✅
Alpha (1h):    PostgreSQL + CI
Beta (2-3h):   Monitoring + Deploy
```

### Fase 1: MVP (5-15 minutos)

```bash
#!/bin/bash
# scripts/setup-mvp.sh

echo "🚀 Setting up MVP (5-15 minutes)"

# Instalar Mise
if ! command -v mise &> /dev/null; then
  curl https://mise.run | sh
fi

# Instalar herramientas
mise install

# Crear .env mínimo (SQLite, sin Docker)
cat > .env << EOF
DATABASE_URL=sqlite:///dev.db
NODE_ENV=development
EOF

# Setup git hooks
mise hook-env

echo "✅ MVP Setup Complete!"
echo "🎉 Ready to code! Run: mise run dev"
```

### Fase 2: Alpha (1 hora)

```bash
#!/bin/bash
# scripts/setup-alpha.sh

echo "🚀 Upgrading to Alpha (1 hour)"

# Docker Compose
cat > docker-compose.yml << EOF
version: '3.8'
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
EOF

# Iniciar PostgreSQL
mise run docker:up

# Actualizar .env
sed -i 's|sqlite|postgresql://postgres:postgres@localhost:5432/mydb|' .env

# Migraciones
mise run db:migrate

# Setup CI básico
mkdir -p .github/workflows
# Copiar CI template...

echo "✅ Alpha Complete!"
```

### Fase 3: Beta (2-3 horas)

```bash
#!/bin/bash  
# scripts/setup-beta.sh

echo "🚀 Upgrading to Beta (2-3 hours)"

# Monitoring, deployment, secrets
echo "Choose deployment platform:"
echo "  1) Railway"
echo "  2) Koyeb"
echo "  3) Coolify"
read -p "Choice: " choice

# Setup según elección...

echo "✅ Beta Complete - Production ready!"
```

### Mise Tasks para Fases

```toml
[tasks."setup:mvp"]
description = "Phase 1: MVP (5-15 min)"
run = "bash scripts/setup-mvp.sh"

[tasks."setup:alpha"]  
description = "Phase 2: Alpha (1 hour)"
run = "bash scripts/setup-alpha.sh"

[tasks."setup:beta"]
description = "Phase 3: Beta (2-3 hours)"
run = "bash scripts/setup-beta.sh"

[tasks.setup]
description = "Interactive setup wizard"
run = """
echo "Choose phase:"
echo "  1) MVP    - Quick start (15 min)"
echo "  2) Alpha  - Full dev (1 hour)"
echo "  3) Beta   - Production (2-3 hours)"
read -p "Choice [1-3]: " choice

case $choice in
  1) mise run setup:mvp ;;
  2) mise run setup:alpha ;;
  3) mise run setup:beta ;;
esac
"""
```

---

## 📊 Context Script (para Claude Code)

### Problema: Context Window Pollution

**Sin Context Script:**
```
❌ Claude lee 50+ archivos → 10,000 tokens
❌ Lento y costoso
```

**Con Context Script:**
```
✅ 1 comando → Estado completo → < 500 tokens
✅ JSON parseable
```

### Implementación

```bash
#!/bin/bash
# scripts/agent-context.sh

cat << EOF
{
  "timestamp": "$(date -Iseconds)",
  "git": {
    "branch": "$(git branch --show-current)",
    "status": "$(git status -s | wc -l) files changed",
    "last_commit": "$(git log -1 --pretty=format:'%h - %s')"
  },
  "tools": {
    "node": "$(mise current node 2>/dev/null || echo 'N/A')",
    "python": "$(mise current python 2>/dev/null || echo 'N/A')",
    "go": "$(mise current go 2>/dev/null || echo 'N/A')"
  },
  "tests": {
    "status": "$(mise run test:unit >/dev/null 2>&1 && echo 'passing' || echo 'failing')",
    "coverage": "$(grep -oP '\d+%' coverage.txt 2>/dev/null || echo 'unknown')"
  },
  "database": {
    "migrations": $(ls migrations/*.sql 2>/dev/null | wc -l),
    "pending": $(mise run db:status 2>/dev/null | grep -c 'pending' || echo 0),
    "connection": "$(psql "$DATABASE_URL" -c 'SELECT 1' >/dev/null 2>&1 && echo 'ok' || echo 'failed')"
  },
  "build": {
    "lint": "$(mise run lint >/dev/null 2>&1 && echo 'passing' || echo 'failing')",
    "last_error": "$(tail -n 3 .last-error 2>/dev/null || echo 'none')"
  },
  "todos": [
    $(grep -r "TODO\|FIXME" src/ 2>/dev/null | head -n 5 | awk '{print "\"" $0 "\""}' | paste -sd,)
  ],
  "phase": "$([ -f docker-compose.yml ] && echo 'alpha' || echo 'mvp')",
  "health": {
    "api_running": $(curl -s http://localhost:8080/health >/dev/null 2>&1 && echo 'true' || echo 'false'),
    "db_running": $(docker ps | grep -q postgres && echo 'true' || echo 'false')
  }
}
EOF
```

### Mise Integration

```toml
[tasks.context]
description = "Show complete project context (for AI agents)"
run = "bash scripts/agent-context.sh"
alias = "ctx"

[tasks."context:watch"]
description = "Watch context in real-time"
run = "watch -n 2 'bash scripts/agent-context.sh | jq'"
```

### Uso en Claude Code

```bash
# Al inicio de cada turno
mise run context

# Claude obtiene TODO el estado en < 500 tokens:
# - Qué rama está activa
# - Tests passing/failing
# - Migraciones pendientes
# - TODOs pendientes
# - Health checks
# - Fase del proyecto (mvp/alpha/beta)
```

---

## 🔄 Atomic Sequential Merges (El Corazón del Agente)

### ⚠️ Aclaración Importante: NO es "1 rama = 1 commit"

```
❌ MODELO INCORRECTO (lo que NO debes hacer):

feat/01-add-model          → 1 commit → merge
feat/02-add-migration      → 1 commit → merge  
feat/03-add-tests          → 1 commit → merge

Problema: Crear una rama nueva por cada commit es una locura
```

```
✅ MODELO CORRECTO (Atomic Sequential Merges):

feat/01-database-schema (UNA SOLA RAMA)
  ├─ commit: "add User model"
  ├─ commit: "add Post model"  
  ├─ commit: "add migration script"
  ├─ commit: "add tests"
  └─ SQUASH MERGE → develop (4 commits → 1 commit limpio)

feat/02-api-endpoints (siguiente rama)
  ├─ commit: "add GET /users endpoint"
  ├─ commit: "add POST /users endpoint"
  ├─ commit: "add validation middleware"
  ├─ commit: "add error handling"
  ├─ commit: "add tests"
  └─ SQUASH MERGE → develop (5 commits → 1 commit limpio)

Ventaja: 
✅ Una rama = un paso completo
✅ Múltiples commits durante desarrollo
✅ Historia limpia en develop (1 commit por paso)
```

### El Problema con Stacked PRs para Solo Devs

```
STACKED PRs (v4) - PROBLEMA PARA SOLO DEV:

PR #1: feat/01-schema ──┐
PR #2: feat/02-api ─────┼── Todos abiertos esperando review
PR #3: feat/03-ui ──────┘

Si cambias algo en PR #1:
  → Rebase PR #2 manualmente
  → Rebase PR #3 manualmente
  → Conflictos potenciales
  → 2 horas perdidas en git

TÚ NO TIENES REVIEWER → No hay razón para esperar
```

### La Solución: Atomic Sequential Merges

```
ATOMIC SEQUENTIAL (Solo Dev Planner):

Paso 1: feat/01-schema (UNA SOLA RAMA para todo el paso)
  ├─ commit 1: "add User model"
  ├─ commit 2: "add migration script"
  ├─ commit 3: "add tests"
  └─ Push → CI verde ✓
  └─ SQUASH MERGE → develop (los 3 commits se convierten en 1)
  └─ Rama eliminada

Paso 2: feat/02-api (desde develop actualizado)
  ├─ git checkout develop && git pull
  ├─ git checkout -b feat/02-api
  ├─ commit 1: "add auth endpoint"
  ├─ commit 2: "add validation"
  ├─ commit 3: "add error handling"
  ├─ commit 4: "add tests"
  └─ Push → CI verde ✓
  └─ SQUASH MERGE → develop (los 4 commits se convierten en 1)

RESULTADO: 
✅ Historia lineal en develop (1 commit por paso)
✅ Commits frecuentes durante desarrollo (buenas prácticas)
✅ Sin rebase hell
✅ Sin PRs acumulados

IMPORTANTE: 
❌ NO crear una rama nueva por cada commit
✅ Crear UNA rama por paso completo
✅ Hacer commits frecuentes dentro de esa rama
✅ Squash merge al final (N commits → 1 commit limpio)
```

### Implementación del Flujo

```typescript
class AtomicSequentialFlow {
  async executeStep(step: PlanStep): Promise<void> {
    // 1. Siempre partir de develop actualizado
    await this.git.checkout('develop');
    await this.git.pull('origin', 'develop');
    
    // 2. Crear UNA SOLA branch para TODO el paso
    const branchName = `feat/${step.number.toString().padStart(2, '0')}-${step.slug}`;
    await this.git.checkoutBranch(branchName);
    
    // 3. Implementar (el dev trabaja aquí)
    console.log(`
═══════════════════════════════════════════════════════════
📋 PASO ${step.number}: ${step.title}
═══════════════════════════════════════════════════════════

🎯 Objetivo: ${step.objective}

📁 Archivos a crear/modificar:
${step.files.map(f => `   - ${f}`).join('\n')}

💡 FLUJO DE TRABAJO RECOMENDADO:
   1. Implementa una parte pequeña
   2. Haz commit (ej: "add user model")
   3. Repite hasta completar el paso
   4. Push TODOS los commits juntos
   5. CI corre automáticamente
   6. Si CI pasa → Auto-merge con SQUASH

📚 Contexto Just-in-Time:
${step.learningContext}

✅ Criterio de "Done":
${step.doneCriteria.map(c => `   □ ${c}`).join('\n')}

═══════════════════════════════════════════════════════════
    `);
    
    // 4. Cuando el dev termina y hace push de TODOS los commits...
    // CI corre automáticamente
    
    // 5. Si CI pasa → Auto-merge con SQUASH
    // Resultado: N commits en la rama → 1 commit en develop
  }
  
  async onCIPassed(pr: PullRequest): Promise<void> {
    // Auto-merge con SQUASH (convierte múltiples commits en uno)
    await this.github.mergePR(pr.number, {
      method: 'squash',  // ← IMPORTANTE: esto une todos los commits
      deleteSourceBranch: true
    });
    
    console.log(`✅ PR #${pr.number} merged automáticamente (CI pasó)`);
    console.log(`📦 Commits squashed: ${pr.commits.length} commits → 1 commit en develop`);
    console.log(`🔄 Listo para el siguiente paso`);
  }
}
```

### 🚨 Errores Comunes a Evitar

```bash
# ❌ MAL - Crear una rama por cada commit
git checkout -b feat/01-add-model
git commit -m "add model"
git checkout develop
git checkout -b feat/02-add-migration  # ← NO HACER ESTO
git commit -m "add migration"

# ✅ BIEN - Una rama para TODO el paso
git checkout -b feat/01-database-schema
git commit -m "add user model"
git commit -m "add migration script"
git commit -m "add tests"
git push  # Push todos los commits juntos
# → PR se crea automáticamente
# → CI pasa
# → Squash merge: 3 commits → 1 commit en develop
```

---

## 🎨 Stack Moderno: Biome + Bun

### Por qué Biome sobre ESLint/Prettier

```
Benchmark: Linting 10,000 archivos TypeScript

ESLint + Prettier:  45 segundos
Biome:              0.4 segundos  ⚡ 100x más rápido

Configuración:
ESLint + Prettier:  2 archivos + 20+ deps
Biome:              1 archivo + 1 dep
```

### Setup Inicial de Biome

```bash
# Instalar Biome (una sola dependencia)
bun add --dev @biomejs/biome

# Inicializar config
bunx @biomejs/biome init
```

### biome.json (Configuración Recomendada)

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": {
        "useConst": "error",
        "noVar": "error"
      },
      "suspicious": {
        "noExplicitAny": "warn"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "es5"
    }
  }
}
```

### Por qué Bun sobre npm/yarn/pnpm

```
Benchmark: Install 300 packages

npm:    45 segundos
yarn:   38 segundos
pnpm:   22 segundos
bun:    4 segundos   ⚡ 10x más rápido
```

**Ventajas adicionales:**
- Runtime de JavaScript (reemplaza Node.js)
- Bundler integrado (reemplaza Webpack/Vite)
- Test runner integrado (reemplaza Jest/Vitest)
- TypeScript sin configuración

### package.json con Biome + Bun

```json
{
  "name": "my-project",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target node",
    "test": "bun test",
    "lint": "biome check .",
    "format": "biome format --write .",
    "check": "biome ci ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/bun": "latest"
  }
}
```

---

## ☕ Stack Moderno: Java + Gradle + Kotlin

### Por qué Gradle + Kotlin sobre Maven + Java

```
Benchmark: Build proyecto con 50 módulos

Maven (Java):    2:30 min
Gradle (Java):   45 seg
Gradle (Kotlin): 40 seg + DSL type-safe  ⚡ 3x más rápido

Configuración:
Maven:   XML verboso (pom.xml)
Gradle:  Kotlin DSL conciso (build.gradle.kts)

Features:
Maven:   Limitado a XML
Gradle:  Programable, incremental builds, build cache
```

### Setup Inicial de Gradle + Kotlin

```bash
# Inicializar proyecto Gradle
gradle init --type kotlin-application --dsl kotlin

# O manualmente
mkdir -p src/main/kotlin src/test/kotlin
```

### build.gradle.kts (Configuración Recomendada)

```kotlin
plugins {
    kotlin("jvm") version "2.2.0"
    kotlin("plugin.spring") version "2.2.0"
    id("org.springframework.boot") version "4.0.1"
    id("io.spring.dependency-management") version "1.1.7"
    id("com.diffplug.spotless") version "7.0.0"
}

group = "com.example"
version = "0.0.1-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_25
}

repositories {
    mavenCentral()
}

dependencies {
    // Spring Boot 4.x
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-data-jpa")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    
    // Database
    runtimeOnly("org.postgresql:postgresql")
    
    // Test
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("io.mockk:mockk:1.13.13")
}

kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
}

// Spotless configuration (formatter)
spotless {
    kotlin {
        target("**/*.kt")
        ktlint("1.5.0")
            .editorConfigOverride(
                mapOf(
                    "indent_size" to "4",
                    "max_line_length" to "120"
                )
            )
    }
    kotlinGradle {
        target("**/*.gradle.kts")
        ktlint("1.5.0")
    }
}

// Task para verificar formato
tasks.register("check") {
    dependsOn("spotlessCheck", "test")
}
```

### gradle.properties

```properties
# Gradle daemon para builds más rápidos
org.gradle.daemon=true
org.gradle.parallel=true
org.gradle.caching=true

# Kotlin
kotlin.code.style=official
```

### Comandos Gradle

```bash
# Build
./gradlew build

# Run (Spring Boot)
./gradlew bootRun

# Tests
./gradlew test

# Format code (Spotless)
./gradlew spotlessApply

# Check format
./gradlew spotlessCheck

# Limpiar + Build
./gradlew clean build
```

### Estructura de Proyecto Spring Boot + Kotlin

```kotlin
// src/main/kotlin/com/example/api/Application.kt
package com.example.api

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class Application

fun main(args: Array<String>) {
    runApplication<Application>(*args)
}
```

```kotlin
// src/main/kotlin/com/example/api/controller/HealthController.kt
package com.example.api.controller

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/health")
class HealthController {
    
    data class HealthResponse(val status: String, val version: String = "0.1.0")
    
    @GetMapping
    fun health() = HealthResponse(status = "ok")
}
```

### Dockerfile para Java + Gradle

```dockerfile
# Multi-stage build para optimizar tamaño
FROM gradle:8.12-jdk25 AS builder
WORKDIR /app

# Copiar solo archivos de configuración primero (para cachear deps)
COPY build.gradle.kts settings.gradle.kts gradle.properties ./
COPY gradle ./gradle

# Descargar dependencias (se cachea si no cambian)
RUN gradle dependencies --no-daemon

# Copiar código fuente
COPY src ./src

# Build (sin tests para acelerar)
RUN gradle build -x test --no-daemon

# Stage final - solo runtime
FROM eclipse-temurin:25-jre-alpine
WORKDIR /app

# Copiar jar construido
COPY --from=builder /app/build/libs/*.jar app.jar

# Usuario no-root
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Exponer puerto
EXPOSE 8080

# Comando de inicio
ENTRYPOINT ["java", "-jar", "app.jar"]
```

---

## 🐹 Stack Moderno: Go + Air + golangci-lint

### Por qué Go 1.25+ con Herramientas Modernas

```
Ventajas de Go 1.25+:
✅ Generics nativos (desde 1.18)
✅ JSON v2 experimental (encoding/json/v2)
✅ DWARF 5 debug info (binarios más pequeños)
✅ Mejor manejo de errores
✅ Performance optimizado (2-3% más rápido que 1.24)
✅ Tooling mejorado (go doc -http, tool directives)

golangci-lint vs linters individuales:
- Incluye 50+ linters en uno
- Configurable por proyecto
- 5x más rápido que correr linters separados
```

### Setup Inicial de Go Project

```bash
# Inicializar módulo Go
go mod init github.com/usuario/mi-api

# Instalar Air (hot reload)
go install github.com/cosmtrek/air@latest

# Instalar golangci-lint
# macOS/Linux
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(go env GOPATH)/bin

# O con Homebrew
brew install golangci-lint
```

### go.mod

```go
module github.com/usuario/mi-api

go 1.25

require (
    github.com/gin-gonic/gin v1.10.0
    github.com/lib/pq v1.10.9
    github.com/golang-jwt/jwt/v5 v5.2.1
)
```

### .golangci.yml (Configuración de Linter)

```yaml
run:
  timeout: 5m
  modules-download-mode: readonly

linters:
  enable:
    - errcheck      # Verifica errores no manejados
    - gosimple      # Simplificaciones de código
    - govet         # Análisis estático
    - ineffassign   # Asignaciones ineficientes
    - staticcheck   # Análisis avanzado
    - unused        # Código no usado
    - gofmt         # Formato
    - goimports     # Imports organizados
    - revive        # Reemplazo rápido de golint
    - misspell      # Errores de ortografía
    - gocritic      # Sugerencias de mejora

linters-settings:
  gofmt:
    simplify: true
  goimports:
    local-prefixes: github.com/usuario/mi-api
  revive:
    rules:
      - name: exported
        severity: warning
      - name: var-naming
        severity: warning

issues:
  exclude-rules:
    - path: _test\.go
      linters:
        - errcheck
```

### .air.toml (Hot Reload Configuration)

```toml
root = "."
testdata_dir = "testdata"
tmp_dir = "tmp"

[build]
  args_bin = []
  bin = "./tmp/main"
  cmd = "go build -o ./tmp/main ."
  delay = 1000
  exclude_dir = ["assets", "tmp", "vendor", "testdata"]
  exclude_file = []
  exclude_regex = ["_test.go"]
  exclude_unchanged = false
  follow_symlink = false
  full_bin = ""
  include_dir = []
  include_ext = ["go", "tpl", "tmpl", "html"]
  include_file = []
  kill_delay = "0s"
  log = "build-errors.log"
  poll = false
  poll_interval = 0
  rerun = false
  rerun_delay = 500
  send_interrupt = false
  stop_on_error = false

[color]
  app = ""
  build = "yellow"
  main = "magenta"
  runner = "green"
  watcher = "cyan"

[log]
  main_only = false
  time = false

[misc]
  clean_on_exit = false

[screen]
  clear_on_rebuild = false
  keep_scroll = true
```

### Estructura de Proyecto Go con Gin

```
my-api/
├── cmd/
│   └── api/
│       └── main.go           # Entry point
├── internal/
│   ├── handlers/             # HTTP handlers
│   │   └── health.go
│   ├── models/               # Data models
│   └── middleware/           # Middlewares
├── pkg/                      # Código reutilizable
├── go.mod
├── go.sum
├── .air.toml
├── .golangci.yml
├── Dockerfile
└── docker-compose.yml
```

### main.go (Gin Framework)

```go
// cmd/api/main.go
package main

import (
    "log"
    "github.com/gin-gonic/gin"
    "github.com/usuario/mi-api/internal/handlers"
)

func main() {
    r := gin.Default()
    
    // Health endpoint
    r.GET("/health", handlers.Health)
    
    // Iniciar servidor
    if err := r.Run(":8080"); err != nil {
        log.Fatal("Failed to start server:", err)
    }
}
```

```go
// internal/handlers/health.go
package handlers

import (
    "net/http"
    "github.com/gin-gonic/gin"
)

type HealthResponse struct {
    Status  string `json:"status"`
    Version string `json:"version"`
}

func Health(c *gin.Context) {
    c.JSON(http.StatusOK, HealthResponse{
        Status:  "ok",
        Version: "0.1.0",
    })
}
```

### Comandos Go

```bash
# Desarrollo con hot reload
air

# O sin air
go run cmd/api/main.go

# Tests
go test ./...

# Tests con cobertura
go test -cover ./...

# Build
go build -o bin/api cmd/api/main.go

# Lint
golangci-lint run

# Format
go fmt ./...

# Organizar imports
goimports -w .

# Ver dependencias
go mod tidy
go mod vendor  # opcional: para vendor/ local
```

### Dockerfile para Go (Multi-stage)

```dockerfile
# Builder stage
FROM golang:1.25-alpine AS builder

# Instalar dependencias de build
RUN apk add --no-cache git

WORKDIR /app

# Copiar go.mod y go.sum primero (para cachear deps)
COPY go.mod go.sum ./
RUN go mod download

# Copiar código fuente
COPY . .

# Build (static binary)
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main ./cmd/api

# Final stage - solo el binario
FROM alpine:3.21

# Certificados SSL para requests HTTPS
RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copiar binario
COPY --from=builder /app/main .

# Usuario no-root
RUN adduser -D appuser
USER appuser

# Exponer puerto
EXPOSE 8080

# Comando
CMD ["./main"]
```

---

## 📦 Templates de Proyecto Desde Cero (Actualizados)

### 1. API REST con TypeScript + Bun + Biome

[Mantener el template existente de Bun]

---

### 2. API REST con Java + Gradle + Kotlin

```bash
my-api-java/
├── src/
│   ├── main/
│   │   ├── kotlin/
│   │   │   └── com/example/api/
│   │   │       ├── Application.kt
│   │   │       ├── controller/
│   │   │       │   └── HealthController.kt
│   │   │       └── config/
│   │   └── resources/
│   │       └── application.yml
│   └── test/
│       └── kotlin/
│           └── com/example/api/
│               └── HealthControllerTest.kt
├── build.gradle.kts
├── settings.gradle.kts
├── gradle.properties
├── Dockerfile
└── docker-compose.yml
```

#### settings.gradle.kts

```kotlin
rootProject.name = "my-api"
```

#### application.yml

```yaml
spring:
  application:
    name: my-api
  datasource:
    url: jdbc:postgresql://localhost:5432/mydb
    username: user
    password: pass
  jpa:
    hibernate:
      ddl-auto: validate
    show-sql: true
    properties:
      hibernate:
        dialect: org.hibernate.dialect.PostgreSQLDialect

server:
  port: 8080

logging:
  level:
    root: INFO
    com.example.api: DEBUG
```

#### HealthControllerTest.kt

```kotlin
package com.example.api

import org.junit.jupiter.api.Test
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath
import org.springframework.test.web.servlet.result.MockMvcResultMatchers.status

@SpringBootTest
@AutoConfigureMockMvc
class HealthControllerTest {
    
    @Autowired
    private lateinit var mockMvc: MockMvc
    
    @Test
    fun `health endpoint should return ok`() {
        mockMvc.perform(get("/health"))
            .andExpect(status().isOk)
            .andExpect(jsonPath("$.status").value("ok"))
    }
}
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      - SPRING_DATASOURCE_URL=jdbc:postgresql://db:5432/mydb
      - SPRING_DATASOURCE_USERNAME=user
      - SPRING_DATASOURCE_PASSWORD=pass
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=mydb

volumes:
  postgres-data:
```

---

### 3. API REST con Go + Gin + Air

```bash
my-api-go/
├── cmd/
│   └── api/
│       └── main.go
├── internal/
│   ├── handlers/
│   │   ├── health.go
│   │   └── health_test.go
│   ├── models/
│   └── middleware/
├── pkg/
├── go.mod
├── go.sum
├── .air.toml
├── .golangci.yml
├── Dockerfile
└── docker-compose.yml
```

#### go.mod (completo)

```go
module github.com/usuario/mi-api

go 1.22

require (
    github.com/gin-gonic/gin v1.9.1
    github.com/lib/pq v1.10.9
    github.com/stretchr/testify v1.8.4
)
```

#### cmd/api/main.go (con database)

```go
package main

import (
    "database/sql"
    "log"
    "os"
    
    "github.com/gin-gonic/gin"
    _ "github.com/lib/pq"
    
    "github.com/usuario/mi-api/internal/handlers"
)

func main() {
    // Database connection
    dbURL := os.Getenv("DATABASE_URL")
    if dbURL == "" {
        dbURL = "postgres://user:pass@localhost:5432/mydb?sslmode=disable"
    }
    
    db, err := sql.Open("postgres", dbURL)
    if err != nil {
        log.Fatal("Failed to connect to database:", err)
    }
    defer db.Close()
    
    // Verificar conexión
    if err := db.Ping(); err != nil {
        log.Fatal("Failed to ping database:", err)
    }
    
    log.Println("Connected to database")
    
    // Gin router
    r := gin.Default()
    
    // Health endpoint
    r.GET("/health", handlers.Health)
    
    // Iniciar servidor
    port := os.Getenv("PORT")
    if port == "" {
        port = "8080"
    }
    
    if err := r.Run(":" + port); err != nil {
        log.Fatal("Failed to start server:", err)
    }
}
```

#### internal/handlers/health_test.go

```go
package handlers

import (
    "net/http"
    "net/http/httptest"
    "testing"
    
    "github.com/gin-gonic/gin"
    "github.com/stretchr/testify/assert"
)

func TestHealth(t *testing.T) {
    gin.SetMode(gin.TestMode)
    
    w := httptest.NewRecorder()
    c, _ := gin.CreateTestContext(w)
    
    Health(c)
    
    assert.Equal(t, http.StatusOK, w.Code)
    assert.Contains(t, w.Body.String(), `"status":"ok"`)
}
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
      target: development  # Para dev con Air
    ports:
      - "8080:8080"
    volumes:
      - .:/app
      - go-modules:/go/pkg/mod
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/mydb?sslmode=disable
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=mydb

volumes:
  postgres-data:
  go-modules:
```

#### Dockerfile (Go con Air para dev)

```dockerfile
# Development stage con Air
FROM golang:1.25-alpine AS development

RUN apk add --no-cache git

# Instalar Air
RUN go install github.com/air-verse/air@latest

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

CMD ["air", "-c", ".air.toml"]

# Production stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main ./cmd/api

FROM alpine:3.21 AS production

RUN apk --no-cache add ca-certificates

WORKDIR /root/

COPY --from=builder /app/main .

RUN adduser -D appuser
USER appuser

EXPOSE 8080

CMD ["./main"]
```

### 1. API REST (Node.js + Bun + Biome)

```bash
# Estructura inicial
my-api/
├── src/
│   ├── index.ts
│   ├── routes/
│   │   └── health.ts
│   ├── middleware/
│   └── types/
├── tests/
│   └── health.test.ts
├── package.json
├── biome.json
├── Dockerfile
├── docker-compose.yml
└── .gitignore
```

#### package.json

```json
{
  "name": "my-api",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target node",
    "start": "NODE_ENV=production bun dist/index.js",
    "test": "bun test",
    "check": "biome ci ."
  },
  "dependencies": {
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/bun": "latest"
  }
}
```

#### src/index.ts

```typescript
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { healthRoute } from './routes/health';

const app = new Hono();

// Middleware
app.use('*', logger());

// Routes
app.route('/health', healthRoute);

// Start server
const port = process.env.PORT || 3000;
console.log(`🚀 Server running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
```

#### tests/health.test.ts

```typescript
import { describe, expect, test } from 'bun:test';
import app from '../src/index';

describe('Health Check', () => {
  test('GET /health returns 200', async () => {
    const req = new Request('http://localhost/health');
    const res = await app.fetch(req);
    
    expect(res.status).toBe(200);
    
    const body = await res.json();
    expect(body).toHaveProperty('status', 'ok');
  });
});
```

#### Dockerfile

```dockerfile
FROM oven/bun:1.1-alpine as base
WORKDIR /app

# Development
FROM base as development
COPY package.json bun.lockb ./
RUN bun install
COPY . .
CMD ["bun", "run", "dev"]

# Production
FROM base as production
COPY package.json bun.lockb ./
RUN bun install --production
COPY . .
RUN bun run build
CMD ["bun", "run", "start"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      target: development
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://user:pass@db:5432/mydb
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=mydb

volumes:
  postgres-data:
```

---

### 4. API REST con Python + FastAPI + uv

```bash
my-api/
├── app/
│   ├── __init__.py
│   ├── main.py
│   └── routes/
│       └── health.py
├── tests/
│   └── test_health.py
├── pyproject.toml
├── uv.lock
├── Dockerfile
└── docker-compose.yml
```

#### pyproject.toml

```toml
[project]
name = "my-api"
version = "0.1.0"
description = "FastAPI project with uv"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.109.0",
    "uvicorn[standard]>=0.27.0",
    "pydantic>=2.5.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "httpx>=0.26.0",
    "ruff>=0.1.0",
]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W"]
ignore = []
```

#### app/main.py

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routes import health

app = FastAPI(title="My API")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(health.router, prefix="/health", tags=["health"])

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

#### app/routes/health.py

```python
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class HealthResponse(BaseModel):
    status: str
    version: str = "0.1.0"

@router.get("/", response_model=HealthResponse)
async def health_check():
    return {"status": "ok"}
```

#### tests/test_health.py

```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check():
    response = client.get("/health/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "version": "0.1.0"}
```

#### Dockerfile

```dockerfile
FROM python:3.12-slim as base
WORKDIR /app

# Install uv
RUN pip install uv

# Development
FROM base as development
COPY pyproject.toml uv.lock* ./
RUN uv sync
COPY . .
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--reload"]

# Production
FROM base as production
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev
COPY . .
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--workers", "4"]
```

---

### 5. Monorepo Completo (Turborepo + Bun + Biome)

```bash
my-monorepo/
├── apps/
│   ├── api/              # Backend (Bun + Hono)
│   │   ├── src/
│   │   ├── package.json
│   │   └── Dockerfile
│   ├── web/              # Frontend (Astro + React)
│   │   ├── src/
│   │   ├── package.json
│   │   └── Dockerfile
│   └── mobile/           # Mobile (Ionic + React)
│       ├── src/
│       └── package.json
├── packages/
│   ├── ui/               # React components
│   ├── types/            # Shared TypeScript types
│   └── config/           # Shared Biome config
├── package.json          # Root
├── turbo.json
├── biome.json
├── docker-compose.yml
└── .gitignore
```

#### package.json (root)

```json
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "biome check .",
    "format": "biome format --write .",
    "check": "biome ci ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "turbo": "^2.0.0"
  },
  "packageManager": "bun@1.1.0"
}
```

#### turbo.json

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "build/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

#### biome.json (root - compartido)

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "organizeImports": {
    "enabled": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  }
}
```

#### packages/ui/package.json

```json
{
  "name": "@my-monorepo/ui",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js"
  },
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target node",
    "dev": "bun build src/index.ts --outdir dist --target node --watch"
  },
  "peerDependencies": {
    "react": "^18.0.0",
    "react-dom": "^18.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0"
  }
}
```

#### packages/types/package.json

```json
{
  "name": "@my-monorepo/types",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.d.ts"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

#### apps/api/package.json

```json
{
  "name": "api",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "build": "bun build src/index.ts --outdir dist --target node",
    "start": "NODE_ENV=production bun dist/index.js",
    "test": "bun test"
  },
  "dependencies": {
    "@my-monorepo/types": "workspace:*",
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

#### apps/web/package.json

```json
{
  "name": "web",
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "@my-monorepo/ui": "workspace:*",
    "@my-monorepo/types": "workspace:*",
    "astro": "^4.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  }
}
```

#### docker-compose.yml (monorepo)

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
      target: development
    ports:
      - "3000:3000"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://user:pass@db:5432/mydb
    depends_on:
      - db

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "4321:4321"
    volumes:
      - .:/app
      - /app/node_modules
    environment:
      - PUBLIC_API_URL=http://localhost:3000

  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=mydb

volumes:
  postgres-data:
```

---

## 🔧 CI/CD Adaptativo Multi-Lenguaje

### GitHub Actions con Biome + Bun

```yaml
# .github/workflows/ci.yml
name: CI (Biome + Bun)

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]

env:
  BUN_VERSION: '1.1.0'

jobs:
  detect-and-test:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 2
      
      # ═══════════════════════════════════════════════════════════
      # DETECCIÓN AUTOMÁTICA DE STACK
      # ═══════════════════════════════════════════════════════════
      - name: Detect Tech Stack
        id: detect
        run: |
          if [ -f "package.json" ]; then
            echo "stack=node" >> $GITHUB_OUTPUT
            echo "pm=bun" >> $GITHUB_OUTPUT
          elif [ -f "pyproject.toml" ]; then
            echo "stack=python" >> $GITHUB_OUTPUT
            echo "pm=uv" >> $GITHUB_OUTPUT
          elif [ -f "go.mod" ]; then
            echo "stack=go" >> $GITHUB_OUTPUT
          elif [ -f "Cargo.toml" ]; then
            echo "stack=rust" >> $GITHUB_OUTPUT
          elif [ -f "build.gradle.kts" ] || [ -f "build.gradle" ]; then
            echo "stack=java-gradle" >> $GITHUB_OUTPUT
          elif [ -f "pom.xml" ]; then
            echo "stack=java-maven" >> $GITHUB_OUTPUT
          fi
          
          # Detectar monorepo
          if [ -f "turbo.json" ]; then
            echo "monorepo=turborepo" >> $GITHUB_OUTPUT
          fi
      
      # ═══════════════════════════════════════════════════════════
      # NODE.JS + BUN + BIOME
      # ═══════════════════════════════════════════════════════════
      - name: Setup Bun
        if: steps.detect.outputs.stack == 'node'
        uses: oven-sh/setup-bun@v1
        with:
          bun-version: ${{ env.BUN_VERSION }}
      
      - name: Install Dependencies
        if: steps.detect.outputs.stack == 'node'
        run: bun install --frozen-lockfile
      
      - name: Biome Check
        if: steps.detect.outputs.stack == 'node'
        run: bun run check
      
      - name: Run Tests
        if: steps.detect.outputs.stack == 'node'
        run: bun test
      
      - name: Build
        if: steps.detect.outputs.stack == 'node'
        run: bun run build
      
      # ═══════════════════════════════════════════════════════════
      # TURBOREPO (SI ES MONOREPO)
      # ═══════════════════════════════════════════════════════════
      - name: Turborepo Cache
        if: steps.detect.outputs.monorepo == 'turborepo'
        uses: actions/cache@v4
        with:
          path: .turbo
          key: turbo-${{ runner.os }}-${{ github.sha }}
          restore-keys: turbo-${{ runner.os }}-
      
      - name: Build (Affected Only)
        if: steps.detect.outputs.monorepo == 'turborepo'
        run: bun run build --filter='...[origin/develop]'
      
      - name: Test (Affected Only)
        if: steps.detect.outputs.monorepo == 'turborepo'
        run: bun test --filter='...[origin/develop]'
      
      # ═══════════════════════════════════════════════════════════
      # PYTHON + UV
      # ═══════════════════════════════════════════════════════════
      - name: Setup Python
        if: steps.detect.outputs.stack == 'python'
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      
      - name: Install uv
        if: steps.detect.outputs.stack == 'python'
        run: pip install uv
      
      - name: Install Dependencies
        if: steps.detect.outputs.stack == 'python'
        run: uv sync
      
      - name: Lint (Ruff)
        if: steps.detect.outputs.stack == 'python'
        run: uv run ruff check .
      
      - name: Run Tests
        if: steps.detect.outputs.stack == 'python'
        run: uv run pytest
      
      # ═══════════════════════════════════════════════════════════
      # JAVA (GRADLE + KOTLIN)
      # ═══════════════════════════════════════════════════════════
      - name: Setup Java
        if: steps.detect.outputs.stack == 'java-gradle' || steps.detect.outputs.stack == 'java-maven'
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '25'
          cache: 'gradle'
      
      - name: Make gradlew executable
        if: steps.detect.outputs.stack == 'java-gradle'
        run: chmod +x ./gradlew
      
      - name: Check Format (Spotless)
        if: steps.detect.outputs.stack == 'java-gradle'
        run: ./gradlew spotlessCheck
      
      - name: Build and Test (Gradle)
        if: steps.detect.outputs.stack == 'java-gradle'
        run: ./gradlew build test
      
      # ═══════════════════════════════════════════════════════════
      # GO
      # ═══════════════════════════════════════════════════════════
      - name: Setup Go
        if: steps.detect.outputs.stack == 'go'
        uses: actions/setup-go@v5
        with:
          go-version: '1.25'
          cache: true
      
      - name: Install golangci-lint
        if: steps.detect.outputs.stack == 'go'
        run: |
          curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(go env GOPATH)/bin
          echo "$(go env GOPATH)/bin" >> $GITHUB_PATH
      
      - name: Lint (golangci-lint)
        if: steps.detect.outputs.stack == 'go'
        run: golangci-lint run
      
      - name: Install & Test (Go)
        if: steps.detect.outputs.stack == 'go'
        run: |
          go mod download
          go test -v ./...
          go build -v ./...
      
      # ═══════════════════════════════════════════════════════════
      # RUST
      # ═══════════════════════════════════════════════════════════
      - name: Setup Rust
        if: steps.detect.outputs.stack == 'rust'
        uses: dtolnay/rust-toolchain@stable
      
      - name: Cache Rust
        if: steps.detect.outputs.stack == 'rust'
        uses: Swatinem/rust-cache@v2
      
      - name: Install & Test (Rust)
        if: steps.detect.outputs.stack == 'rust'
        run: |
          cargo test
          cargo build --release

  # ═══════════════════════════════════════════════════════════
  # AUTO-MERGE (Para Solo Devs)
  # ═══════════════════════════════════════════════════════════
  auto-merge:
    needs: detect-and-test
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    
    steps:
      - name: Auto-merge PR
        uses: pascalgn/automerge-action@v0.16.2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          MERGE_METHOD: squash
          MERGE_DELETE_BRANCH: true
          MERGE_LABELS: ''
```

---

## 📅 Rutina Diaria del Solo Developer

### El Ritmo Semanal Óptimo

```typescript
const WEEKLY_RHYTHM = {
  monday: {
    morning: 'PLANIFICACIÓN',
    tasks: [
      '1. Revisar backlog y priorizar',
      '2. Pedirle al agente el plan de la semana',
      '3. Configurar los pasos en GitHub Issues',
      '4. Empezar Paso 1 si queda tiempo'
    ],
    wipLimit: 0  // Solo planificar, no codear
  },
  
  tuesdayToThursday: {
    morning: 'EJECUCIÓN ATÓMICA',
    routine: `
      08:00 - git checkout develop && git pull
      08:05 - Revisar el paso actual (Issue de GitHub)
      08:10 - Crear branch: feat/XX-descripcion
      08:15 - 12:00 DEEP WORK (código)
      12:00 - Tests locales
      12:30 - git push → CI automático
      13:00 - Almuerzo (CI corriendo)
      14:00 - Si CI verde → Merge
      14:05 - Siguiente paso o continuar
    `,
    wipLimit: 1  // UNA sola tarea activa
  },
  
  friday: {
    morning: 'DEPLOY + REFACTOR',
    tasks: [
      '1. Merge develop → main (si hay features completas)',
      '2. Deploy a staging/production',
      '3. Smoke test manual',
      '4. 2h de refactoring técnico',
      '5. Actualizar documentación si es necesario'
    ],
    wipLimit: 0  // Solo deploy y mantenimiento
  }
};
```

### Comandos Git del Día a Día

```bash
#!/bin/bash
# scripts/solo-dev-flow.sh

# ═══════════════════════════════════════════════════════════
# INICIAR NUEVO PASO
# ═══════════════════════════════════════════════════════════
start_step() {
  local step_num=$1
  local step_name=$2
  
  echo "🚀 Iniciando Paso $step_num: $step_name"
  
  # Siempre desde develop actualizado
  git checkout develop
  git pull origin develop
  
  # Crear UNA SOLA rama para TODO el paso
  local branch="feat/$(printf '%02d' $step_num)-$step_name"
  git checkout -b "$branch"
  
  echo "✅ Branch '$branch' creado"
  echo ""
  echo "💡 FLUJO DE TRABAJO:"
  echo "   1. Implementa una parte pequeña"
  echo "   2. git add . && git commit -m 'descripción'"
  echo "   3. Repite hasta completar TODO el paso"
  echo "   4. git push -u origin HEAD (pushea TODOS los commits)"
  echo "   5. finish_step (crea PR automático)"
  echo ""
  echo "📝 Puedes hacer tantos commits como necesites en esta rama"
}

# ═══════════════════════════════════════════════════════════
# FINALIZAR PASO (Push + PR automático)
# ═══════════════════════════════════════════════════════════
finish_step() {
  local message=$1
  
  # Verificar que hay commits sin pushear
  if git diff origin/$(git branch --show-current) --quiet 2>/dev/null; then
    echo "⚠️  No hay cambios para pushear. ¿Ya hiciste commits?"
    echo "Usa: git add . && git commit -m 'tu mensaje'"
    return 1
  fi
  
  # Push (puede ser de múltiples commits)
  echo "📤 Pusheando commits..."
  git push -u origin HEAD
  
  # Crear PR con gh CLI
  gh pr create \
    --title "$message" \
    --body "## Paso Atómico

Este PR contiene $(git log origin/develop..HEAD --oneline | wc -l) commits que serán squashed en 1.

### Commits en este PR:
\`\`\`
$(git log origin/develop..HEAD --oneline)
\`\`\`

**Al merge**: Todos estos commits se combinarán en uno solo usando squash merge.

---
*Generado por Solo Dev Planner*" \
    --base develop
  
  echo ""
  echo "✅ PR creado. Esperando CI..."
  echo "💡 El PR se mergeará automáticamente cuando CI pase"
  echo "📦 Squash merge: múltiples commits → 1 commit limpio en develop"
}

# ═══════════════════════════════════════════════════════════
# COMMIT HELPER (opcional - para recordar hacer commits frecuentes)
# ═══════════════════════════════════════════════════════════
quick_commit() {
  local msg=$1
  
  if [ -z "$msg" ]; then
    echo "❌ Proporciona un mensaje: quick_commit 'descripción'"
    return 1
  fi
  
  git add .
  git commit -m "$msg"
  
  echo "✅ Commit creado: $msg"
  echo "💡 Puedes seguir haciendo más commits en esta rama"
  echo "💡 Cuando termines el paso, usa: finish_step"
}

# ═══════════════════════════════════════════════════════════
# VER ESTADO
# ═══════════════════════════════════════════════════════════
status() {
  echo "═══════════════════════════════════════════════════════════"
  echo "📊 ESTADO DEL PROYECTO"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  echo "🌳 Branch actual: $(git branch --show-current)"
  echo ""
  
  # Commits locales sin pushear
  local unpushed=$(git log origin/$(git branch --show-current)..HEAD --oneline 2>/dev/null | wc -l)
  if [ "$unpushed" -gt 0 ]; then
    echo "📝 Commits locales sin pushear: $unpushed"
    git log origin/$(git branch --show-current)..HEAD --oneline
    echo ""
  fi
  
  echo "📋 PRs abiertos:"
  gh pr list --state open
  echo ""
  echo "✅ PRs mergeados hoy:"
  gh pr list --state merged --search "merged:$(date +%Y-%m-%d)"
  echo ""
  echo "🔄 Estado de CI:"
  gh run list --limit 3
}

# ═══════════════════════════════════════════════════════════
# EJEMPLO DE USO
# ═══════════════════════════════════════════════════════════
example_usage() {
  cat << 'EOF'
═══════════════════════════════════════════════════════════
📖 EJEMPLO DE USO CORRECTO
═══════════════════════════════════════════════════════════

# 1. Iniciar paso
source scripts/solo-dev-flow.sh
start_step 01 "database-schema"

# 2. Trabajar en el paso (hacer múltiples commits)
# ... editar archivos ...
quick_commit "add User model"

# ... editar más archivos ...
quick_commit "add migration script"

# ... editar tests ...
quick_commit "add tests for User model"

# 3. Finalizar paso (pushea todos los commits y crea PR)
finish_step "feat(db): implement database schema"

# 4. CI pasa → Auto-merge con SQUASH
# Resultado en develop: 1 commit limpio con todos los cambios

# 5. Siguiente paso
start_step 02 "api-endpoints"
# ... repetir proceso ...

═══════════════════════════════════════════════════════════
EOF
}

# Mostrar ayuda si se ejecuta sin argumentos
if [ $# -eq 0 ]; then
  example_usage
fi
```

---

## 🎯 Generación de Plan (Output del Agente)

### Prompt para Iniciar Proyecto

```markdown
MODO: Solo-Developer / Proyecto Desde Cero

PROYECTO: [Nombre del proyecto]

DESCRIPCIÓN:
[Breve descripción del objetivo del proyecto]

STACK PREFERIDO:
- Backend: [Python/FastAPI, Node/Bun, Go, Rust, etc.]
- Frontend: [Astro, Next.js, SvelteKit, etc.]
- Base de datos: [PostgreSQL, MongoDB, etc.]
- Monorepo: [Sí/No - Si sí, usar Turborepo]

FEATURES PRINCIPALES:
1. [Feature 1]
2. [Feature 2]
3. [Feature 3]

ENTREGABLE:
Genera un plan atómico con:
- Estructura de directorios inicial
- Configuración de Biome + Bun (si aplica)
- Docker Compose setup
- CI/CD con GitHub Actions
- Pasos granulares para implementar cada feature
```

### Ejemplo: Feature "Sistema de Autenticación"

Cuando le pidas al agente planificar una feature, generará:

```markdown
# 🎯 PLAN: Sistema de Autenticación

## 📊 Resumen
- **Pasos totales:** 5
- **Tiempo estimado:** 3-4 días de trabajo enfocado
- **Stack:** Python/FastAPI + PostgreSQL + JWT
- **Apps afectadas:** api-server
- **Packages afectados:** types

---

## PASO 1: Setup Inicial + Docker

**Branch:** `feat/01-auth-setup`
**Duración típica:** 1-2 horas

### Objetivo
Configurar estructura base del proyecto con Docker Compose.

### Archivos a Crear
- `pyproject.toml` - Configuración de proyecto con uv
- `docker-compose.yml` - PostgreSQL + API
- `Dockerfile` - Multi-stage para dev/prod
- `app/main.py` - Entry point de FastAPI
- `.env.example` - Variables de entorno

### Template pyproject.toml
```toml
[project]
name = "auth-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.109.0",
    "uvicorn[standard]>=0.27.0",
    "sqlalchemy>=2.0.0",
    "asyncpg>=0.29.0",
    "python-jose[cryptography]>=3.3.0",
    "passlib[bcrypt]>=1.7.4",
    "python-multipart>=0.0.6",
]

[project.optional-dependencies]
dev = [
    "pytest>=7.4.0",
    "pytest-asyncio>=0.21.0",
    "httpx>=0.26.0",
    "ruff>=0.1.0",
]
```

### Comandos
```bash
# Inicializar proyecto
uv init
uv add fastapi uvicorn sqlalchemy asyncpg python-jose passlib
uv add --dev pytest pytest-asyncio httpx ruff

# Levantar stack
docker compose up -d

# Verificar
curl http://localhost:8000/health
```

### Done Criteria
- [ ] Docker Compose levanta PostgreSQL + API
- [ ] Endpoint `/health` responde 200
- [ ] uv sync funciona sin errores

---

## PASO 2: Schema de Base de Datos

**Branch:** `feat/02-auth-schema`
**Prerequisito:** Paso 1 mergeado
**Duración típica:** 2-3 horas

### Objetivo
Crear tablas `users` y `refresh_tokens` con SQLAlchemy.

### Archivos a Crear
- `app/database.py` - Configuración de SQLAlchemy
- `app/models/user.py` - Modelo de usuario
- `app/models/refresh_token.py` - Modelo de refresh tokens
- `alembic.ini` - Configuración de migraciones
- `migrations/versions/001_create_users.py` - Migración inicial

### Contexto Just-in-Time: SQLAlchemy 2.0 Async

SQLAlchemy 2.0 cambió la sintaxis para queries async:

```python
# app/database.py
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = "postgresql+asyncpg://user:pass@db:5432/auth"

engine = create_async_engine(DATABASE_URL, echo=True)
async_session = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

Base = declarative_base()

async def get_db() -> AsyncSession:
    async with async_session() as session:
        yield session
```

```python
# app/models/user.py
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base
import uuid
from datetime import datetime

class User(Base):
    __tablename__ = "users"
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
```

### Comandos
```bash
# Instalar Alembic
uv add alembic

# Inicializar migraciones
alembic init migrations

# Crear migración
alembic revision --autogenerate -m "create users table"

# Aplicar migración
docker compose exec api alembic upgrade head
```

### Done Criteria
- [ ] Migración ejecuta sin errores
- [ ] Tabla `users` existe en PostgreSQL
- [ ] Modelo `User` tiene validaciones correctas

---

## PASO 3: Endpoints de Registro y Login

**Branch:** `feat/03-auth-endpoints`
**Prerequisito:** Paso 2 mergeado
**Duración típica:** 4-5 horas

### Objetivo
Crear endpoints POST `/register` y POST `/login` con JWT.

### Archivos a Crear
- `app/schemas/user.py` - Pydantic schemas
- `app/routes/auth.py` - Endpoints de auth
- `app/services/auth.py` - Lógica de negocio (hash, JWT)
- `app/dependencies.py` - Dependency injection
- `tests/test_auth.py` - Tests de integración

### Contexto Just-in-Time: JWT con python-jose

```python
# app/services/auth.py
from jose import jwt
from passlib.context import CryptContext
from datetime import datetime, timedelta

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = "your-secret-key-here"  # Mover a .env en prod
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
```

### Comandos para Probar
```bash
# Registro
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "secret123"}'

# Login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "secret123"}'

# Tests automatizados
docker compose exec api pytest tests/test_auth.py -v
```

### Done Criteria
- [ ] POST `/register` crea usuario con password hasheado
- [ ] POST `/login` retorna JWT válido
- [ ] Passwords incorrectos retornan 401
- [ ] Tests de integración pasan

---

## PASO 4: Middleware de Autenticación

**Branch:** `feat/04-auth-middleware`
**Prerequisito:** Paso 3 mergeado
**Duración típica:** 2-3 horas

### Objetivo
Crear dependency para proteger rutas con JWT.

### Archivos a Crear/Modificar
- `app/dependencies.py` - `get_current_user` dependency
- `app/routes/users.py` - Endpoint protegido ejemplo
- `tests/test_protected_routes.py` - Tests de autorización

### Contexto Just-in-Time: FastAPI Dependencies

```python
# app/dependencies.py
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from app.services.auth import SECRET_KEY, ALGORITHM

security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> dict:
    token = credentials.credentials
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return {"user_id": user_id}
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Uso en rutas protegidas:
@router.get("/me")
async def get_my_profile(current_user: dict = Depends(get_current_user)):
    return {"user_id": current_user["user_id"]}
```

### Done Criteria
- [ ] Rutas con `Depends(get_current_user)` requieren JWT
- [ ] JWT inválido retorna 401
- [ ] JWT válido permite acceso
- [ ] Tests de autorización pasan

---

## PASO 5: Refresh Tokens

**Branch:** `feat/05-refresh-tokens`
**Prerequisito:** Paso 4 mergeado
**Duración típica:** 3-4 horas

### Objetivo
Implementar refresh tokens para no re-loguear cada 30 min.

### Archivos a Crear/Modificar
- `app/models/refresh_token.py` - Modelo ya creado en Paso 2
- `app/routes/auth.py` - Endpoint POST `/refresh`
- `app/services/auth.py` - Funciones para refresh tokens
- `tests/test_refresh.py` - Tests

### Flujo de Refresh Tokens
1. Login retorna: `{ access_token, refresh_token }`
2. Access token expira en 30 min
3. Frontend usa refresh token para obtener nuevo access token
4. Refresh token expira en 7 días

### Done Criteria
- [ ] Login retorna access + refresh token
- [ ] POST `/refresh` con refresh token válido retorna nuevo access token
- [ ] Refresh token expirado retorna 401
- [ ] Tests de refresh pasan

---

## 🚀 Comandos Globales

```bash
# Iniciar desarrollo
docker compose up -d

# Logs en tiempo real
docker compose logs -f api

# Ejecutar tests
docker compose exec api pytest -v

# Aplicar migraciones
docker compose exec api alembic upgrade head

# Acceder a shell de Python
docker compose exec api python

# Acceder a PostgreSQL
docker compose exec db psql -U user -d auth

# Detener todo
docker compose down

# Limpiar volúmenes (cuidado!)
docker compose down -v
```

---

## 📋 Checklist Final

Antes de considerar la feature completa:

- [ ] Todos los tests pasan (100% coverage en servicios críticos)
- [ ] Endpoints documentados en OpenAPI (`/docs`)
- [ ] Variables sensibles en `.env` (no hardcoded)
- [ ] Logs de seguridad para login fallido
- [ ] Rate limiting en endpoints de auth (opcional)
- [ ] CORS configurado correctamente
- [ ] Docker Compose funciona en máquina limpia
- [ ] README actualizado con instrucciones
```

---

## 🔧 Scripts Universales

### scripts/test.sh (Detecta Stack)

```bash
#!/bin/bash
# scripts/test.sh - Detecta stack y corre tests
set -e

echo "🔍 Detectando tech stack..."

if [ -f "package.json" ]; then
  echo "📦 Bun detectado"
  bun test
elif [ -f "pyproject.toml" ]; then
  echo "🐍 Python (uv) detectado"
  uv run pytest
elif [ -f "go.mod" ]; then
  echo "🐹 Go detectado"
  go test -v ./...
elif [ -f "build.gradle.kts" ] || [ -f "build.gradle" ]; then
  echo "☕ Java (Gradle) detectado"
  ./gradlew test
elif [ -f "pom.xml" ]; then
  echo "☕ Java (Maven) detectado"
  ./mvnw test
elif [ -f "Cargo.toml" ]; then
  echo "🦀 Rust detectado"
  cargo test
else
  echo "❌ Stack no reconocido"
  exit 1
fi

echo "✅ Tests completados!"
```

### scripts/lint.sh (Usa Biome, Spotless, golangci-lint, etc.)

```bash
#!/bin/bash
# scripts/lint.sh
set -e

echo "🔍 Detectando linter..."

if [ -f "biome.json" ]; then
  echo "🎨 Biome detectado"
  bun run check
elif [ -f "pyproject.toml" ] && grep -q "ruff" pyproject.toml; then
  echo "🐍 Ruff detectado"
  uv run ruff check .
elif [ -f "build.gradle.kts" ] || [ -f "build.gradle" ]; then
  echo "☕ Spotless (Java/Gradle) detectado"
  ./gradlew spotlessCheck
elif [ -f ".golangci.yml" ]; then
  echo "🐹 golangci-lint detectado"
  golangci-lint run
elif [ -f "rustfmt.toml" ]; then
  echo "🦀 Rustfmt detectado"
  cargo fmt --check
else
  echo "⚠️ No linter configurado"
fi

echo "✅ Lint completado!"
```

### scripts/format.sh (Formatea código automáticamente)

```bash
#!/bin/bash
# scripts/format.sh
set -e

echo "🎨 Formateando código..."

if [ -f "biome.json" ]; then
  echo "📦 Biome"
  bun run format
elif [ -f "pyproject.toml" ] && grep -q "ruff" pyproject.toml; then
  echo "🐍 Ruff"
  uv run ruff format .
elif [ -f "build.gradle.kts" ] || [ -f "build.gradle" ]; then
  echo "☕ Spotless"
  ./gradlew spotlessApply
elif [ -f "go.mod" ]; then
  echo "🐹 gofmt + goimports"
  go fmt ./...
  if command -v goimports &> /dev/null; then
    goimports -w .
  fi
elif [ -f "Cargo.toml" ]; then
  echo "🦀 rustfmt"
  cargo fmt
fi

echo "✅ Formato aplicado!"
```

### scripts/dev.sh (Levanta Dev Server)

```bash
#!/bin/bash
# scripts/dev.sh
set -e

if [ -f "docker-compose.yml" ]; then
  echo "🐳 Levantando Docker Compose..."
  docker compose up
elif [ -f "package.json" ]; then
  echo "📦 Iniciando dev server (Bun)..."
  bun run dev
elif [ -f "pyproject.toml" ]; then
  echo "🐍 Iniciando dev server (uv)..."
  uv run uvicorn app.main:app --reload
elif [ -f "build.gradle.kts" ] || [ -f "build.gradle" ]; then
  echo "☕ Iniciando dev server (Gradle)..."
  ./gradlew bootRun
elif [ -f "go.mod" ]; then
  echo "🐹 Iniciando dev server (Go)..."
  if command -v air &> /dev/null; then
    air
  else
    go run cmd/api/main.go
  fi
else
  echo "❌ No se encontró configuración de dev"
  exit 1
fi
```

### scripts/build.sh (Build optimizado por stack)

```bash
#!/bin/bash
# scripts/build.sh
set -e

echo "🔨 Building..."

if [ -f "package.json" ]; then
  echo "📦 Bun build"
  bun run build
elif [ -f "pyproject.toml" ]; then
  echo "🐍 Python no requiere build (interpretado)"
elif [ -f "build.gradle.kts" ] || [ -f "build.gradle" ]; then
  echo "☕ Gradle build"
  ./gradlew build -x test
elif [ -f "go.mod" ]; then
  echo "🐹 Go build"
  go build -o bin/api ./cmd/api
elif [ -f "Cargo.toml" ]; then
  echo "🦀 Rust build"
  cargo build --release
fi

echo "✅ Build completado!"
```

---

