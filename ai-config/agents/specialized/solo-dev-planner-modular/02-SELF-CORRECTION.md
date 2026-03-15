---
name: solo-dev-planner-self-correction
description: "Módulo 2: Auto-fix y context management"
---

# 🔄 Solo Dev Planner - Self-Correction & Context Management

> Módulo 2 de 6: Autonomía del agente con auto-fix y context optimizado

## 📚 Relacionado con:
- 01-CORE.md (Filosofía base)
- 03-PROGRESSIVE-SETUP.md (Usa estos scripts en setup)
- 06-OPERATIONS.md (Mise tasks)

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
