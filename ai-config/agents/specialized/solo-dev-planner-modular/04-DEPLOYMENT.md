---
name: solo-dev-planner-deployment
description: "Módulo 4: Deploy con Koyeb, Railway, Coolify"
---

# ☁️ Solo Dev Planner - Simple Deployment

> Módulo 4 de 6: Deploy económico con Koyeb, Railway, Coolify

## 📚 Relacionado con:
- 01-CORE.md (CI/CD base)
- 03-PROGRESSIVE-SETUP.md (Fase Beta)
- 06-OPERATIONS.md (Secrets management)

---


### Filosofía: PaaS First, AWS Después

**Para Solo Devs:**
```
❌ AWS: 
   - Setup 2-3 horas (IAM, VPC, RDS, Secrets Manager)
   - $50-200/mes
   - Overkill para comenzar

✅ Railway/Koyeb/Coolify:
   - Setup 5 minutos
   - git push deploy
   - $0-20/mes
   - Perfecto para solo dev
```

### Comparativa Completa

| Plataforma | Precio/mes | Free Tier | Deploy | DB Incluido | Edge Global | Ideal Para |
|------------|------------|-----------|--------|-------------|-------------|------------|
| **Koyeb** ⭐ | $0-15 | ✅ 2 servicios | git push | ✅ PostgreSQL | ✅ 6 regiones | MVPs globales, SaaS |
| **Railway** | $5-20 | $5 crédito | git push | ✅ PostgreSQL | ❌ US only | Simplicidad, hobby |
| **Coolify** | $5 VPS | ❌ Self-host | git push | ✅ PostgreSQL | Depende | Control total, barato |
| **Render** | $7-25 | ✅ Limitado | git push | ✅ PostgreSQL | ❌ US/EU | Alternative a Railway |
| **Fly.io** | $5-20 | ✅ Crédito | fly deploy | ❌ Separado | ✅ Global | Go, Rust, edge apps |
| AWS (manual) | $30-50+ | ❌ Complejo | CI/CD custom | ❌ RDS manual | ✅ | Apps enterprise |

---

## 1. Koyeb - Global Edge Deploy (Recomendado) ⭐

### ¿Por Qué Koyeb?

```
✅ Free tier GENEROSO (2 servicios, sin tarjeta)
✅ Global edge (6 regiones: US, EU, Asia)
✅ Deploy automático desde GitHub
✅ PostgreSQL integrado (1 click)
✅ SSL automático + Custom domains
✅ Zero-downtime deploys
✅ Auto-scaling
✅ Logs en tiempo real
✅ Health checks automáticos

Perfecto para:
- MVPs que quieres lanzar rápido
- SaaS con usuarios internacionales
- APIs que necesitan baja latencia global
```

### Setup Koyeb

```bash
# 1. Instalar CLI
curl -fsSL https://koyeb-cli.s3.amazonaws.com/install.sh | bash

# Verificar
koyeb version

# 2. Login
koyeb login

# 3. Deploy desde GitHub (automático)
koyeb app create my-api \
  --git github.com/user/repo \
  --git-branch main \
  --git-buildCommand "bun install && bun run build" \
  --git-runCommand "bun run start" \
  --ports 8080:http \
  --regions fra,was,sin  # Frankfurt, Washington, Singapore

# 4. Agregar PostgreSQL
koyeb database create my-db \
  --engine postgres \
  --version 16

# 5. Conectar DB al servicio
koyeb service update my-api \
  --env DATABASE_URL=@database:my-db:connection_string
```

### Configuración koyeb.yaml

```yaml
# .koyeb.yml - Deploy configuration
services:
  - name: api
    type: web
    
    # Build
    build:
      context: .
      dockerfile: Dockerfile  # O usar buildpacks automáticos
    
    # Networking
    ports:
      - port: 8080
        protocol: http
    
    # Regions (hasta 6 simultáneas)
    regions:
      - fra  # Frankfurt, Germany
      - was  # Washington DC, USA
      - sin  # Singapore
      # - par  # Paris, France
      # - sfo  # San Francisco, USA
      # - syd  # Sydney, Australia
    
    # Instance type
    instance:
      type: free  # O: nano, small, medium, large
    
    # Auto-scaling
    scaling:
      min: 1
      max: 3
      targets:
        - type: cpu
          value: 80  # Scale cuando CPU > 80%
    
    # Environment variables
    env:
      - name: NODE_ENV
        value: production
      - name: DATABASE_URL
        secret: DATABASE_URL  # From Koyeb secrets
      - name: REDIS_URL
        secret: REDIS_URL
      - name: JWT_SECRET
        secret: JWT_SECRET
    
    # Health checks
    health_check:
      http:
        path: /health
        port: 8080
        interval: 30s
        timeout: 10s
        grace_period: 60s
    
    # Resources
    resources:
      cpu: 1
      memory: 512Mi
```

### Secrets Management en Koyeb

```bash
# Crear secrets
koyeb secret create JWT_SECRET --value "your-secret-key-here"
koyeb secret create DATABASE_URL --value "postgresql://..."
koyeb secret create STRIPE_SECRET_KEY --value "sk_live_..."

# Listar secrets
koyeb secret list

# Actualizar secret
koyeb secret update JWT_SECRET --value "new-secret"

# Usar en servicio (ya configurado en koyeb.yaml)
env:
  - name: JWT_SECRET
    secret: JWT_SECRET
```

### Mise Tasks para Koyeb

```toml
# .mise.toml

[tasks."deploy:setup:koyeb"]
description = "Setup Koyeb deployment"
run = """
#!/usr/bin/env bash

echo "🌍 Setting up Koyeb (Global Edge Deploy)..."
echo ""

# Check CLI
if ! command -v koyeb &> /dev/null; then
  echo "Installing Koyeb CLI..."
  curl -fsSL https://koyeb-cli.s3.amazonaws.com/install.sh | bash
fi

# Login
echo "Please login to Koyeb:"
koyeb login

# Get project name
read -p "Project name: " PROJECT_NAME
read -p "GitHub repo (user/repo): " GITHUB_REPO

# Create app
koyeb app create $PROJECT_NAME \
  --git github.com/$GITHUB_REPO \
  --git-branch main \
  --ports 8080:http \
  --regions fra,was

echo ""
echo "✅ Koyeb configured!"
echo "Dashboard: https://app.koyeb.com"
echo ""
echo "Next steps:"
echo "  1. Add secrets: koyeb secret create KEY --value VALUE"
echo "  2. Deploy: git push origin main"
"""

[tasks."deploy:koyeb"]
description = "Deploy to Koyeb"
run = """
echo "🚀 Deploying to Koyeb..."
koyeb service redeploy $(koyeb service list -o json | jq -r '.[0].id')
echo "✅ Deployed! Check: https://app.koyeb.com"
"""

[tasks."logs:koyeb"]
description = "Tail Koyeb logs"
run = """
SERVICE_ID=$(koyeb service list -o json | jq -r '.[0].id')
koyeb service logs $SERVICE_ID --follow
"""

[tasks."status:koyeb"]
description = "Check Koyeb service status"
run = "koyeb service list"
```

---

## 2. Railway - La Más Simple

### ¿Por Qué Railway?

```
✅ UI más intuitiva
✅ Setup más rápido
✅ PostgreSQL con 1 click
✅ Variables de entorno fáciles
✅ Logs en tiempo real hermosos
✅ $5 crédito gratis/mes
✅ Perfect para hobby projects

Ideal para:
- Prototipos rápidos
- Apps que no necesitan edge global
- Cuando quieres la máxima simplicidad
```

### Setup Railway

```bash
# 1. Instalar CLI
npm install -g @railway/cli

# O con Homebrew
brew install railway

# 2. Login
railway login

# 3. Inicializar proyecto
railway init

# Seleccionar:
#   - Create new project
#   - Link to GitHub repo (opcional)

# 4. Agregar PostgreSQL
railway add
# Seleccionar: PostgreSQL

# 5. Deploy
railway up

# Railway automáticamente:
# - Detecta tu lenguaje
# - Construye la app
# - Despliega
# - Genera URL
```

### Configuración railway.json

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "./Dockerfile"
  },
  "deploy": {
    "numReplicas": 1,
    "sleepApplication": false,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Secrets en Railway

```bash
# Via CLI
railway variables set JWT_SECRET="your-secret"
railway variables set DATABASE_URL="postgres://..."

# Via UI (más fácil)
# Dashboard > Variables > Add Variable
```

### Mise Tasks para Railway

```toml
[tasks."deploy:setup:railway"]
description = "Setup Railway deployment"
run = """
echo "🚂 Setting up Railway..."

if ! command -v railway &> /dev/null; then
  echo "Installing Railway CLI..."
  npm install -g @railway/cli
fi

railway login
railway init

echo ""
echo "Add PostgreSQL:"
railway add

echo "✅ Railway configured!"
echo "Deploy: railway up"
"""

[tasks."deploy:railway"]
description = "Deploy to Railway"
run = "railway up --detach"

[tasks."logs:railway"]
description = "Tail Railway logs"
run = "railway logs"

[tasks."open:railway"]
description = "Open Railway dashboard"
run = "railway open"
```

---

## 3. Coolify - Self-Hosted PaaS

### ¿Por Qué Coolify?

```
✅ 100% self-hosted (tu servidor)
✅ Más barato (~$5/mes en Hetzner)
✅ Control total
✅ Open source
✅ UI como Vercel/Railway
✅ Docker Compose nativo
✅ Git push deploy
✅ SSL automático (Let's Encrypt)

Ideal para:
- Quieres controlar todo
- Presupuesto muy limitado
- Múltiples proyectos en 1 servidor
- No quieres vendor lock-in
```

### Setup Coolify en Hetzner

```bash
# ═══════════════════════════════════════════════════════════
# 1. CREAR VPS EN HETZNER
# ═══════════════════════════════════════════════════════════
# Ir a: https://console.hetzner.cloud
# Crear proyecto
# Crear servidor:
#   - Location: tu región más cercana
#   - Image: Ubuntu 24.04
#   - Type: CPX11 (2 vCPU, 2 GB RAM, 40 GB SSD) - €4.51/mes
#   - Networking: IPv4 + IPv6
#   - SSH Key: agregar tu clave pública

# ═══════════════════════════════════════════════════════════
# 2. SSH AL SERVIDOR
# ═══════════════════════════════════════════════════════════
ssh root@YOUR_SERVER_IP

# ═══════════════════════════════════════════════════════════
# 3. INSTALAR COOLIFY (UN COMANDO)
# ═══════════════════════════════════════════════════════════
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# Esto instala:
# - Docker
# - Docker Compose
# - Coolify
# - Traefik (reverse proxy)
# - PostgreSQL para Coolify

# ═══════════════════════════════════════════════════════════
# 4. ACCEDER A COOLIFY UI
# ═══════════════════════════════════════════════════════════
# Abrir en navegador:
# http://YOUR_SERVER_IP:8000

# Primera vez:
# - Crear cuenta admin
# - Configurar dominio (opcional)
# - Conectar GitHub

# ═══════════════════════════════════════════════════════════
# 5. DESPLEGAR TU APP DESDE UI
# ═══════════════════════════════════════════════════════════
# En Coolify UI:
# 1. New Resource > Application
# 2. Connect GitHub repo
# 3. Configure:
#    - Build pack: auto-detect
#    - Port: 8080
#    - Environment variables
# 4. Deploy

# Coolify automáticamente:
# - Clona el repo
# - Construye con Dockerfile o buildpacks
# - Configura reverse proxy
# - Genera SSL cert
# - Despliega
```

### docker-compose.yml para Coolify

Coolify usa tu `docker-compose.yml` nativo:

```yaml
# docker-compose.yml (Coolify lo usa tal cual)
version: '3.8'

services:
  api:
    build: .
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      JWT_SECRET: ${JWT_SECRET}
    depends_on:
      - db
      - redis
    restart: unless-stopped
  
  db:
    image: postgres:16-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    restart: unless-stopped
  
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Secrets en Coolify

```bash
# Via UI (más fácil):
# Project > Environment Variables > Add
# Checkbox "Secret" para ocultar valor

# Variables disponibles automáticamente:
# - DATABASE_URL (si agregaste PostgreSQL)
# - Todas las que agregues manualmente
```

### Mise Tasks para Coolify

```toml
[tasks."deploy:setup:coolify"]
description = "Setup Coolify deployment"
run = """
echo "🏠 Setting up Coolify (Self-Hosted)..."
echo ""
echo "Steps:"
echo "  1. Create Hetzner VPS ($5/mes)"
echo "  2. SSH and run: curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash"
echo "  3. Access: http://YOUR_IP:8000"
echo "  4. Connect GitHub repo"
echo "  5. Deploy!"
echo ""
echo "Docs: https://coolify.io/docs"
"""

[tasks."deploy:coolify"]
description = "Deploy via git push (Coolify watches repo)"
run = """
echo "📤 Pushing to trigger Coolify deploy..."
git push origin main
echo "✅ Coolify will auto-deploy"
echo "Check dashboard: http://YOUR_IP:8000"
"""
```

---

## 4. Mise Tasks Universales para Deployment

```toml
# .mise.toml - Tasks que funcionan con cualquier plataforma

[env]
# Configurar plataforma default
DEPLOY_PLATFORM = "koyeb"  # O: railway, coolify, render

[tasks.deploy]
description = "Deploy to configured platform"
run = """
#!/usr/bin/env bash

PLATFORM=${DEPLOY_PLATFORM:-koyeb}

echo "🚀 Deploying to $PLATFORM..."

case $PLATFORM in
  koyeb)
    mise run deploy:koyeb
    ;;
  railway)
    mise run deploy:railway
    ;;
  coolify)
    echo "Coolify deploys automatically from git push"
    git push origin main
    ;;
  render)
    echo "Render deploys automatically from git push"
    git push origin main
    ;;
  *)
    echo "❌ Unknown platform: $PLATFORM"
    echo "Set DEPLOY_PLATFORM in .mise.toml to: koyeb, railway, coolify, or render"
    exit 1
    ;;
esac
"""

[tasks.logs]
description = "Tail production logs"
run = """
PLATFORM=${DEPLOY_PLATFORM:-koyeb}

case $PLATFORM in
  koyeb)
    mise run logs:koyeb
    ;;
  railway)
    mise run logs:railway
    ;;
  *)
    echo "Logs command not configured for $PLATFORM"
    ;;
esac
"""

[tasks.status]
description = "Check deployment status"
run = """
PLATFORM=${DEPLOY_PLATFORM:-koyeb}

case $PLATFORM in
  koyeb)
    mise run status:koyeb
    ;;
  railway)
    railway status
    ;;
  *)
    echo "Status command not configured for $PLATFORM"
    ;;
esac
"""

[tasks."deploy:open"]
description = "Open deployment dashboard"
run = """
PLATFORM=${DEPLOY_PLATFORM:-koyeb}

case $PLATFORM in
  koyeb)
    open https://app.koyeb.com
    ;;
  railway)
    railway open
    ;;
  coolify)
    echo "Open: http://YOUR_SERVER_IP:8000"
    ;;
  render)
    open https://dashboard.render.com
    ;;
esac
"""
```

---

## 🔐 Secrets Management por Plataforma

### Koyeb

```bash
# Crear secret
koyeb secret create JWT_SECRET --value "your-secret"

# En koyeb.yaml
env:
  - name: JWT_SECRET
    secret: JWT_SECRET

# Rotar secret
koyeb secret update JWT_SECRET --value "new-secret"
koyeb service redeploy my-api
```

### Railway

```bash
# CLI
railway variables set JWT_SECRET="your-secret"

# UI (recomendado)
# Dashboard > Variables > New Variable
# Name: JWT_SECRET
# Value: your-secret
```

### Coolify

```
# UI únicamente
# Project > Environment Variables
# Key: JWT_SECRET
# Value: your-secret
# ☑ Secret (hide value)
```

---

## 📊 Costos Realistas Comparados

### Hobby Project (1,000 req/día)

```
Koyeb:    $0/mes        (free tier)
Railway:  $5/mes        (con crédito incluido)
Coolify:  €5/mes        (VPS Hetzner)
Render:   $0/mes        (free tier limitado)
AWS:      $30-50/mes    (EC2 micro + RDS)
```

### Production (10,000 req/día)

```
Koyeb:    $7-15/mes     (nano instance + DB)
Railway:  $20-30/mes    (starter + DB)
Coolify:  €10/mes       (VPS más grande)
Render:   $25-40/mes    (starter + DB)
AWS:      $100-200/mes  (small EC2 + RDS + varios)
```

### High Traffic (100,000+ req/día)

```
Koyeb:    $40-80/mes    (medium + scaling)
Railway:  $80-150/mes   (pro plan)
Coolify:  €40/mes       (multiple VPS)
Render:   $150-300/mes  (professional)
AWS:      $500-1000/mes (optimizado)
```

---

## 🎯 Recomendación Final por Caso de Uso

### Para MVPs y Prototipos
**→ Koyeb (free tier)**
- $0/mes
- Global edge
- Perfecto para validar idea

### Para Hobby Projects
**→ Railway o Coolify**
- Railway: Si quieres simplicidad ($5/mes)
- Coolify: Si quieres ahorrar (€5/mes)

### Para SaaS Globales
**→ Koyeb**
- Edge deployment
- Baja latencia mundial
- Auto-scaling

### Para Control Total
**→ Coolify**
- Tu servidor, tus reglas
- Múltiples proyectos
- Más barato a largo plazo

### Para Escalar Después
**Cualquiera →** Migrar a AWS cuando:
- > 1M requests/mes
- Necesitas servicios específicos (Lambda, S3, etc.)
- Tienes presupuesto para DevOps

---

## 📝 Changelog y Documentación Automática

### Feature Flags con Mise Integrado

```yaml
# .solo-dev/config.yml - Configuración Completa
features:
  # ═══════════════════════════════════════════════════════════
  # HERRAMIENTAS BASE
  # ═══════════════════════════════════════════════════════════
  mise:
    enabled: true  # ✅ Herramienta principal (reemplaza nvm, pyenv, husky, etc.)
    auto_install: true
    version_management: true
    task_runner: true
    git_hooks: true
  
  # ═══════════════════════════════════════════════════════════
  # CHANGELOG Y DOCUMENTACIÓN
  # ═══════════════════════════════════════════════════════════
  changelog:
    enabled: true
    mode: 'simple'  # 'simple' (Release Please) o 'advanced' (Git Cliff)
  
  documentation:
    enabled: true
    mode: 'simple'  # 'simple' (manual) o 'advanced' (AI + on-demand)
    ai:
      provider: 'gemini'  # 'gemini', 'openai', 'anthropic'
      auto_readme: false
      auto_api_docs: false  # on-demand por defecto
  
  # ═══════════════════════════════════════════════════════════
  # VALIDACIÓN Y CALIDAD
  # ═══════════════════════════════════════════════════════════
  pre_commit_hooks:
    enabled: true  # ✅ Recomendado (via Mise)
    validate_lint: true
    validate_tests: true  # Solo tests de archivos modificados
    validate_commit_message: true
  
  code_coverage:
    enabled: true  # ✅ Recomendado
    provider: 'codecov'  # 'codecov' o 'coveralls'
    min_coverage: 80
    fail_under_threshold: false  # Solo warning
  
  performance_benchmarks:
    enabled: false  # Activar si tienes problemas de performance
    fail_on_regression: false
    threshold_percent: 20  # Fallar si regresión >20%
  
  # ═══════════════════════════════════════════════════════════
  # SEGURIDAD Y MANTENIMIENTO
  # ═══════════════════════════════════════════════════════════
  dependency_updates:
    enabled: true  # ✅ Recomendado (Dependabot)
    schedule: 'weekly'  # 'daily', 'weekly', 'monthly'
    auto_merge_patch: false  # Auto-merge updates de patch (0.0.X)
    group_updates: true
  
  security_scanning:
    enabled: true  # ✅ Recomendado
    snyk: false
    github_code_scanning: true
  
  # ═══════════════════════════════════════════════════════════
  # DEPLOYMENT Y MONITORING
  # ═══════════════════════════════════════════════════════════
  health_checks:
    enabled: true  # ✅ Crítico para auto-merge
    endpoint: '/health'
    timeout_seconds: 30
    retry_count: 3
  
  auto_rollback:
    enabled: true  # ✅ Crítico - safety net
    on_health_check_fail: true
    on_error_rate_spike: false  # Requiere monitoring
  
  cloud_cost_estimation:
    enabled: false  # ❌ Desactivado por defecto
    provider: 'infracost'  # 'infracost' para Terraform/AWS
    fail_above_monthly: 100  # USD
  
  # ═══════════════════════════════════════════════════════════
  # NOTIFICACIONES
  # ═══════════════════════════════════════════════════════════
  notifications:
    discord:
      enabled: false  # ❌ Desactivado por defecto
      webhook_url_secret: 'DISCORD_WEBHOOK'
      notify_on:
        - 'merge'
        - 'deploy'
        - 'rollback'
    
    slack:
      enabled: false
      webhook_url_secret: 'SLACK_WEBHOOK'
      notify_on:
        - 'merge'
        - 'deploy'
        - 'rollback'
    
    email:
      enabled: false
      notify_on:
        - 'rollback'
        - 'security_alert'
  
  # ═══════════════════════════════════════════════════════════
  # PLANNING Y ORGANIZACIÓN
  # ═══════════════════════════════════════════════════════════
  planning:
    time_estimation: true  # ✅ Agregar estimaciones a pasos
    complexity_rating: true  # 🟢 Baja, 🟡 Media, 🔴 Alta
    mermaid_diagrams: true  # Generar diagramas de arquitectura
    github_issues: true  # Crear issues por cada paso
```

---

## 🚀 Mise: Herramienta Universal (Version Manager + Task Runner + Hooks)

### ¿Por qué Mise?

```
❌ Antes (múltiples herramientas):
- nvm (Node versions)
- pyenv (Python versions)
- gvm (Go versions)
- jenv (Java versions)
- Husky (Git hooks, solo Node)
- Make/Just (Task runner)
- dotenv (Env management)

✅ Con Mise (una sola herramienta):
- ✅ Version management (todos los lenguajes)
- ✅ Task runner (scripts universales)
- ✅ Git hooks (cualquier lenguaje)
- ✅ Env management (.env nativo)
- ✅ Auto-activation (al entrar al dir)
- ✅ Escrito en Rust (ultra rápido)
```

### Instalación

```bash
# ═══════════════════════════════════════════════════════════
# INSTALACIÓN
# ═══════════════════════════════════════════════════════════

# Homebrew (macOS/Linux) - RECOMENDADO
brew install mise

# Script oficial (Linux/macOS)
curl https://mise.run | sh

# Cargo (Rust)
cargo install mise

# apt (Ubuntu/Debian)
apt update && apt install -y mise

# Verificar instalación
mise --version
```

### Activación en Shell

```bash
# ═══════════════════════════════════════════════════════════
# ACTIVAR EN TU SHELL (IMPORTANTE)
# ═══════════════════════════════════════════════════════════

# Zsh (macOS default)
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc

# Bash
echo 'eval "$(mise activate bash)"' >> ~/.bashrc
source ~/.bashrc

# Fish
echo 'mise activate fish | source' >> ~/.config/fish/config.fish

# Verificar
cd /tmp && mkdir test-mise && cd test-mise
mise use node@20
node --version  # Debería mostrar v20.x
```

---

## 📋 Configuración Universal (.mise.toml)

### Template Completo para Solo-Dev-Planner

```toml
# .mise.toml - Configuración universal para cualquier lenguaje
# Este archivo define: versiones, tareas, hooks, y variables de entorno

min_version = "2024.1.0"

# ═══════════════════════════════════════════════════════════
# VERSION MANAGEMENT (auto-detecta y activa al entrar al dir)
# ═══════════════════════════════════════════════════════════
[tools]
# Solo incluye los lenguajes que uses en tu proyecto
# Mise auto-detecta cuáles están presentes

# JavaScript/TypeScript
node = "20.11.0"           # LTS, reemplaza nvm
bun = "1.0.25"             # Runtime moderno

# Python
python = "3.12.1"          # Reemplaza pyenv
uv = "latest"              # Package manager

# Go
go = "1.22.0"              # Reemplaza gvm

# Java/Kotlin
java = "temurin-21"        # Reemplaza jenv/sdkman

# Rust
rust = "stable"            # Reemplaza rustup

# Herramientas adicionales (opcionales)
terraform = "1.7.0"
kubectl = "1.29.0"
helm = "3.14.0"

# También puedes usar ranges:
# node = "20"              # Latest 20.x
# python = ">=3.11"        # Cualquier 3.11+
# go = "latest"            # Última versión

# ═══════════════════════════════════════════════════════════
# ENVIRONMENT VARIABLES
# ═══════════════════════════════════════════════════════════
[env]
# Variables del proyecto
NODE_ENV = "development"
LOG_LEVEL = "debug"
PORT = "8080"

# Database
DATABASE_URL = "postgresql://localhost:5432/mydb"
REDIS_URL = "redis://localhost:6379"

# Paths
_.path = ["./bin", "./node_modules/.bin", "$PATH"]

# Cargar desde archivos
_.file = [".env", ".env.local"]

# Por environment
[env.production]
NODE_ENV = "production"
LOG_LEVEL = "info"

# ═══════════════════════════════════════════════════════════
# TASK RUNNER (scripts universales multi-lenguaje)
# ═══════════════════════════════════════════════════════════

[tasks.dev]
description = "Start development server"
run = """
#!/usr/bin/env bash
set -e

echo "🚀 Starting development server..."

if [ -f "package.json" ]; then
  echo "📦 Detected Node/Bun project"
  if command -v bun &> /dev/null; then
    bun run dev
  else
    npm run dev
  fi
elif [ -f "pyproject.toml" ]; then
  echo "🐍 Detected Python project"
  if command -v uv &> /dev/null; then
    uv run fastapi dev app/main.py
  else
    python -m uvicorn app.main:app --reload
  fi
elif [ -f "go.mod" ]; then
  echo "🐹 Detected Go project"
  if command -v air &> /dev/null; then
    air
  else
    go run cmd/api/main.go
  fi
elif [ -f "build.gradle.kts" ]; then
  echo "☕ Detected Java/Kotlin project"
  ./gradlew bootRun
elif [ -f "Cargo.toml" ]; then
  echo "🦀 Detected Rust project"
  cargo watch -x run
else
  echo "❌ Could not detect project type"
  exit 1
fi
"""
alias = "d"

[tasks.test]
description = "Run tests"
run = """
#!/usr/bin/env bash
set -e

echo "🧪 Running tests..."

if [ -f "package.json" ]; then
  if command -v bun &> /dev/null; then
    bun test
  else
    npm test
  fi
elif [ -f "pyproject.toml" ]; then
  if command -v uv &> /dev/null; then
    uv run pytest
  else
    pytest
  fi
elif [ -f "go.mod" ]; then
  go test ./...
elif [ -f "build.gradle.kts" ]; then
  ./gradlew test
elif [ -f "Cargo.toml" ]; then
  cargo test
fi
"""
alias = "t"

[tasks."test:changed"]
description = "Run tests only for changed files"
run = "./scripts/test-changed.sh"

[tasks.lint]
description = "Lint code"
run = """
#!/usr/bin/env bash
set -e

echo "🔍 Linting code..."

if [ -f "biome.json" ]; then
  echo "Using Biome..."
  bunx @biomejs/biome check .
elif [ -f ".golangci.yml" ]; then
  echo "Using golangci-lint..."
  golangci-lint run
elif [ -f "pyproject.toml" ] && grep -q "ruff" pyproject.toml; then
  echo "Using Ruff..."
  ruff check .
elif [ -f "build.gradle.kts" ]; then
  echo "Using Spotless..."
  ./gradlew spotlessCheck
elif [ -f "Cargo.toml" ]; then
  echo "Using Clippy..."
  cargo clippy
fi
"""
alias = "l"

[tasks.format]
description = "Format code"
run = """
#!/usr/bin/env bash
set -e

echo "🎨 Formatting code..."

if [ -f "biome.json" ]; then
  bunx @biomejs/biome format --write .
elif [ -f "go.mod" ]; then
  gofmt -w .
  goimports -w .
elif [ -f "pyproject.toml" ] && grep -q "ruff" pyproject.toml; then
  ruff format .
elif [ -f "build.gradle.kts" ]; then
  ./gradlew spotlessApply
elif [ -f "Cargo.toml" ]; then
  cargo fmt
fi
"""
alias = "f"

[tasks.build]
description = "Build for production"
run = """
#!/usr/bin/env bash
set -e

echo "🏗️  Building for production..."

if [ -f "package.json" ]; then
  if command -v bun &> /dev/null; then
    bun run build
  else
    npm run build
  fi
elif [ -f "pyproject.toml" ]; then
  echo "Python projects typically don't need building"
elif [ -f "go.mod" ]; then
  go build -o bin/app cmd/api/main.go
elif [ -f "build.gradle.kts" ]; then
  ./gradlew build
elif [ -f "Cargo.toml" ]; then
  cargo build --release
fi
"""
alias = "b"
depends = ["lint", "test"]  # Corre lint y test primero

[tasks."db:start"]
description = "Start database containers"
run = "docker compose up -d db redis"

[tasks."db:migrate"]
description = "Run database migrations"
run = """
#!/usr/bin/env bash
if [ -f "go.mod" ]; then
  migrate -path migrations -database "$DATABASE_URL" up
elif [ -f "pyproject.toml" ]; then
  alembic upgrade head
fi
"""
depends = ["db:start"]

[tasks."db:seed"]
description = "Seed database with test data"
run = "./scripts/seed.sh"
depends = ["db:migrate"]

[tasks.clean]
description = "Clean build artifacts"
run = """
#!/usr/bin/env bash
rm -rf dist/ build/ target/ node_modules/.cache
echo "✨ Cleaned build artifacts"
"""

[tasks.install]
description = "Install dependencies"
run = """
#!/usr/bin/env bash
set -e

echo "📦 Installing dependencies..."

if [ -f "package.json" ]; then
  if command -v bun &> /dev/null; then
    bun install
  else
    npm install
  fi
elif [ -f "pyproject.toml" ]; then
  if command -v uv &> /dev/null; then
    uv sync
  else
    pip install -e .
  fi
elif [ -f "go.mod" ]; then
  go mod download
elif [ -f "build.gradle.kts" ]; then
  ./gradlew build --refresh-dependencies
elif [ -f "Cargo.toml" ]; then
  cargo fetch
fi

echo "✅ Dependencies installed"
"""

[tasks.ci]
description = "Run full CI pipeline locally"
run = "mise run lint && mise run test && mise run build"

# ═══════════════════════════════════════════════════════════
# GIT HOOKS (con feature flags)
# ═══════════════════════════════════════════════════════════

[hooks.pre-commit]
run = """
#!/usr/bin/env bash
set -e

echo "🎣 Running pre-commit hooks..."

# Leer feature flags de config
CONFIG_FILE=".solo-dev/config.yml"
LINT_ENABLED="true"
TEST_ENABLED="true"

if [ -f "$CONFIG_FILE" ]; then
  if command -v yq &> /dev/null; then
    LINT_ENABLED=$(yq eval '.features.pre_commit_hooks.validate_lint' "$CONFIG_FILE" 2>/dev/null || echo "true")
    TEST_ENABLED=$(yq eval '.features.pre_commit_hooks.validate_tests' "$CONFIG_FILE" 2>/dev/null || echo "true")
  fi
fi

# Lint (si está habilitado)
if [ "$LINT_ENABLED" = "true" ]; then
  echo "🎨 Running linter..."
  mise run lint || {
    echo "❌ Lint failed. Run 'mise run format' to auto-fix."
    exit 1
  }
fi

# Tests (solo archivos cambiados, si está habilitado)
if [ "$TEST_ENABLED" = "true" ]; then
  echo "🧪 Running tests on changed files..."
  mise run test:changed || {
    echo "❌ Tests failed. Fix and try again."
    exit 1
  }
fi

echo "✅ Pre-commit checks passed!"
"""

[hooks.commit-msg]
run = """
#!/usr/bin/env bash

# Leer feature flags
CONFIG_FILE=".solo-dev/config.yml"
VALIDATE_ENABLED="true"

if [ -f "$CONFIG_FILE" ]; then
  if command -v yq &> /dev/null; then
    VALIDATE_ENABLED=$(yq eval '.features.pre_commit_hooks.validate_commit_message' "$CONFIG_FILE" 2>/dev/null || echo "true")
  fi
fi

if [ "$VALIDATE_ENABLED" != "true" ]; then
  exit 0
fi

# Validar formato Conventional Commits
msg=$(cat "$1")

if ! echo "$msg" | grep -qE '^(feat|fix|docs|style|refactor|perf|test|chore|ci|build|revert)(\(.+\))?: .+'; then
  echo "❌ Invalid commit message format"
  echo ""
  echo "Commit message must follow Conventional Commits:"
  echo "  feat(scope): add new feature"
  echo "  fix(scope): fix bug"
  echo "  docs: update documentation"
  echo ""
  echo "Types: feat, fix, docs, style, refactor, perf, test, chore"
  exit 1
fi

# Verificar longitud del subject
subject=$(echo "$msg" | head -1)
if [ ${#subject} -gt 72 ]; then
  echo "❌ Subject line too long (max 72 characters)"
  exit 1
fi

echo "✅ Commit message validated"
"""

[hooks.pre-push]
run = """
#!/usr/bin/env bash
set -e

echo "🚀 Running pre-push hooks..."

# Correr suite completa de tests
echo "🧪 Running full test suite..."
mise run test

# Build
echo "🏗️  Building project..."
mise run build

echo "✅ Pre-push checks passed!"
"""

# ═══════════════════════════════════════════════════════════
# SETTINGS
# ═══════════════════════════════════════════════════════════
[settings]
experimental = true
legacy_version_file = true  # Soporta .nvmrc, .python-version, etc.
```

---

## 🎯 Uso Diario con Mise

### Setup Inicial del Proyecto

```bash
# 1. Entrar al proyecto
cd mi-proyecto

# 2. Definir versiones (crea .mise.toml automáticamente)
mise use node@20 python@3.12 go@1.22

# 3. Instalar todas las versiones
mise install

# 4. Instalar dependencias del proyecto
mise run install

# 5. Setup git hooks
mise hook-env

# 6. Verificar que todo funciona
mise doctor
mise current

# 7. Listo! 🎉
mise run dev
```

### Comandos del Día a Día

```bash
# ═══════════════════════════════════════════════════════════
# VERSION MANAGEMENT
# ═══════════════════════════════════════════════════════════

# Ver versiones activas
mise current

# Listar versiones disponibles
mise ls-remote node
mise ls-remote python

# Instalar versión específica
mise install node@21.5.0

# Usar versión globalmente (en todos los proyectos)
mise use -g node@20

# Ver todas las herramientas instaladas
mise list

# Actualizar herramientas
mise upgrade

# ═══════════════════════════════════════════════════════════
# TASK RUNNER
# ═══════════════════════════════════════════════════════════

# Correr tareas
mise run dev          # Start dev server
mise run test         # Run tests
mise run lint         # Lint code
mise run format       # Format code
mise run build        # Build for production

# Ver tareas disponibles
mise tasks

# Usar aliases (más corto)
mise x d              # = mise run dev
mise x t              # = mise run test
mise x l              # = mise run lint

# Correr múltiples tareas
mise run lint test build

# Correr en background
mise run dev &

# ═══════════════════════════════════════════════════════════
# ENVIRONMENT MANAGEMENT
# ═══════════════════════════════════════════════════════════

# Ver variables de entorno
mise env

# Exportar env vars al shell actual
eval "$(mise env)"

# Ver variable específica
mise env | grep DATABASE_URL

# Correr comando con env
mise exec -- printenv DATABASE_URL

# Cambiar environment
mise env --profile production

# ═══════════════════════════════════════════════════════════
# GIT HOOKS
# ═══════════════════════════════════════════════════════════

# Hooks se activan automáticamente
git commit -m "feat: nueva feature"
# → pre-commit hook corre automáticamente

git push
# → pre-push hook corre automáticamente

# Skip hooks si es necesario
MISE_SKIP_HOOKS=1 git commit -m "feat: skip hooks"
# O
git commit -m "feat: skip" --no-verify

# ═══════════════════════════════════════════════════════════
# DEBUGGING
# ═══════════════════════════════════════════════════════════

# Ver qué está haciendo Mise
mise doctor

# Ver logs detallados
MISE_DEBUG=1 mise run dev

# Ver qué hooks están activos
mise hook-env --status

# Limpiar cache
mise cache clear
```

### Auto-activation (Magia ✨)

```bash
# Cuando entras a un directorio con .mise.toml,
# Mise activa automáticamente las versiones correctas

cd ~/proyectos/api-node
# → Node 20, Bun latest activados ✨
node --version  # v20.11.0

cd ~/proyectos/api-python
# → Python 3.12, uv activados ✨
python --version  # 3.12.1

cd ~/proyectos/api-go
# → Go 1.22 activado ✨
go version  # go1.22.0

# SIN HACER NADA MANUAL 🎉
```

---

## 📦 Scripts Mejorados con Mise

### scripts/test-changed.sh (optimizado con Mise)

```bash
#!/usr/bin/env bash
# scripts/test-changed.sh - Solo tests de archivos modificados

set -e

echo "🧪 Running tests on changed files..."

# Obtener archivos modificados (staged)
CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$CHANGED_FILES" ]; then
  echo "No files changed, skipping tests"
  exit 0
fi

# Detectar stack usando Mise
if mise current node &> /dev/null; then
  # TypeScript/JavaScript
  echo "📦 Detected TypeScript/JavaScript project"
  
  TEST_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|js|tsx|jsx)$' | \
    sed 's/src/tests/' | \
    sed 's/\.ts$/.test.ts/' | \
    sed 's/\.js$/.test.js/' | \
    xargs -I {} find . -name $(basename {}) 2>/dev/null || true)
  
  if [ -n "$TEST_FILES" ]; then
    if command -v bun &> /dev/null; then
      bun test $TEST_FILES
    else
      npm test -- $TEST_FILES
    fi
  else
    echo "No test files found for changed files"
