---
name: solo-dev-planner-operations
description: "Módulo 6: DB Migrations, Secrets, Monitoring, Mise"
---

# 🛠️ Solo Dev Planner - Operations & DevOps

> Módulo 6 de 6: DB Migrations, Secrets, Monitoring, Mise

## 📚 Relacionado con:
- 01-CORE.md (Filosofía base)
- 02-SELF-CORRECTION.md (Auto-fix DB issues)
- 03-PROGRESSIVE-SETUP.md (Usa Mise en todas las fases)
- 04-DEPLOYMENT.md (Secrets por plataforma)
- 05-TESTING.md (Mise tasks para tests)

---

```bash
# .gitignore
.env
.env.local
.env.*.local
```

### Mise Integration

```toml
# .mise.toml
[env]
# Cargar desde archivos
_.file = [".env", ".env.local"]

# O definir directamente (solo para non-sensitive)
NODE_ENV = "development"
PORT = "8080"
LOG_LEVEL = "debug"
```

### Validación de Secrets

```typescript
// src/config/env.ts
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32, 'JWT secret must be at least 32 characters'),
  API_KEY: z.string().optional(),
  
  // Production only
  STRIPE_SECRET_KEY: z.string().startsWith('sk_').optional(),
  SENDGRID_API_KEY: z.string().startsWith('SG.').optional(),
});

export const env = envSchema.parse(process.env);

// Uso
import { env } from '@/config/env';
console.log(env.DATABASE_URL); // Type-safe!
```

```python
# app/config/env.py
from pydantic_settings import BaseSettings
from pydantic import Field, validator

class Settings(BaseSettings):
    NODE_ENV: str = "development"
    DATABASE_URL: str = Field(..., min_length=1)
    REDIS_URL: str = Field(..., min_length=1)
    JWT_SECRET: str = Field(..., min_length=32)
    
    # Production only
    STRIPE_SECRET_KEY: str | None = None
    SENDGRID_API_KEY: str | None = None
    
    @validator('JWT_SECRET')
    def validate_jwt_secret(cls, v, values):
        if values.get('NODE_ENV') == 'production' and len(v) < 64:
            raise ValueError('JWT secret must be 64+ chars in production')
        return v
    
    class Config:
        env_file = '.env'
        case_sensitive = True

settings = Settings()
```

---

## 🔄 Opción 2: Doppler (Recomendado para equipos)

### ¿Qué es Doppler?

```
✅ Central secrets store
✅ Sincronización automática
✅ Versionado de secrets
✅ Diferentes environments (dev, staging, prod)
✅ CLI para desarrollo local
✅ Gratis para proyectos pequeños
```

### Setup

```bash
# Instalar Doppler CLI
brew install dopplerhq/cli/doppler

# Login
doppler login

# Setup en proyecto
cd mi-proyecto
doppler setup
# Selecciona: Project > Config (dev, staging, prod)

# Ver secrets
doppler secrets

# Actualizar secret
doppler secrets set JWT_SECRET "new-secret-value"
```

### Uso con Mise

```toml
# .mise.toml
[env]
# Cargar secrets desde Doppler
_.source = ["doppler://dev"]

# Overrides locales (opcional)
_.file = [".env.local"]
```

### Uso directo

```bash
# Correr comando con secrets de Doppler
doppler run -- bun dev
doppler run -- python app/main.py

# O configurar en mise
[tasks.dev]
run = "doppler run -- bun dev"
```

### GitHub Actions Integration

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Doppler CLI
        uses: dopplerhq/cli-action@v3
      
      - name: Run tests with Doppler
        env:
          DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}
        run: |
          doppler run -- mise run test
```

---

## 🔄 Opción 3: Infisical (Open Source alternativa)

### ¿Qué es Infisical?

```
✅ Open source Doppler alternative
✅ Self-hostable
✅ Similar features
✅ Gratis
```

### Setup

```bash
# Instalar CLI
brew install infisical/get-cli/infisical

# Login
infisical login

# Init proyecto
infisical init

# Pull secrets
infisical secrets
```

```toml
# .mise.toml
[tasks.dev]
run = "infisical run -- bun dev"
```

---

## 🔒 GitHub Secrets (CI/CD)

### Setup de Secrets

```bash
# Via GitHub UI
# Settings > Secrets and variables > Actions > New repository secret

# O via GitHub CLI
gh secret set DATABASE_URL --body "postgresql://..."
gh secret set JWT_SECRET --body "super-secret-key"
gh secret set DOPPLER_TOKEN --body "dp.st.xxx"
```

### Uso en Workflows

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    runs-on: ubuntu-latest
    
    env:
      # Secrets como environment variables
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      REDIS_URL: ${{ secrets.REDIS_URL }}
      JWT_SECRET: ${{ secrets.JWT_SECRET }}
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Run tests
        run: mise run test
      
      - name: Deploy
        if: github.ref == 'refs/heads/main'
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
        run: mise run deploy
```

### Environment Secrets

```yaml
# Para múltiples environments
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production  # O staging, development
    
    steps:
      - name: Deploy
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}  # Del environment
        run: mise run deploy
```

---

## 🔐 Production Secrets (AWS Secrets Manager)

### TypeScript/Node

```typescript
// src/utils/secrets.ts
import { 
  SecretsManagerClient, 
  GetSecretValueCommand 
} from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: 'us-east-1' });

export async function getSecret(secretName: string) {
  try {
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretName })
    );
    
    return JSON.parse(response.SecretString!);
  } catch (error) {
    console.error('Error retrieving secret:', error);
    throw error;
  }
}

// Uso
const dbCreds = await getSecret('prod/database');
const DATABASE_URL = `postgresql://${dbCreds.username}:${dbCreds.password}@${dbCreds.host}:${dbCreds.port}/${dbCreds.database}`;
```

### Python

```python
# app/utils/secrets.py
import boto3
import json
from functools import lru_cache

client = boto3.client('secretsmanager', region_name='us-east-1')

@lru_cache(maxsize=128)
def get_secret(secret_name: str) -> dict:
    try:
        response = client.get_secret_value(SecretId=secret_name)
        return json.loads(response['SecretString'])
    except Exception as e:
        print(f"Error retrieving secret: {e}")
        raise

# Uso
db_creds = get_secret('prod/database')
DATABASE_URL = f"postgresql://{db_creds['username']}:{db_creds['password']}@{db_creds['host']}:{db_creds['port']}/{db_creds['database']}"
```

---

## 🔄 Rotation Strategy

### Scheduled Rotation

```toml
# .mise.toml
[tasks."secrets:rotate"]
description = "Rotate secrets (run monthly)"
run = """
#!/usr/bin/env bash
set -e

echo "🔄 Starting secret rotation..."

# Generar nuevo JWT secret
NEW_JWT_SECRET=$(openssl rand -base64 64)

# Actualizar en Doppler/Infisical
doppler secrets set JWT_SECRET "$NEW_JWT_SECRET" --config prod

# Actualizar en AWS Secrets Manager
aws secretsmanager update-secret \
  --secret-id prod/jwt-secret \
  --secret-string "$NEW_JWT_SECRET"

# Trigger rolling deployment para aplicar nuevos secrets
mise run deploy:rolling

echo "✅ Secret rotation complete"
echo "⚠️  Remember to update GitHub secrets if needed"
"""

[tasks."secrets:audit"]
description = "Audit secrets usage"
run = """
#!/usr/bin/env bash

echo "📊 Secrets Audit Report"
echo ""

# Check for hardcoded secrets
echo "🔍 Scanning for hardcoded secrets..."
gitleaks detect --no-git --verbose

# Check .env files
echo ""
echo "📁 .env files in repo (should be none):"
find . -name ".env" -not -path "./node_modules/*"

# Check secret age (si usas Doppler)
echo ""
echo "⏰ Secret last updated:"
doppler secrets
"""
```

### Automatic Detection

```yaml
# .github/workflows/secrets-scan.yml
name: Secret Scanning

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Run Gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

## 🎯 Best Practices

### 1. Never Commit Secrets

```bash
# .gitignore
.env
.env.local
.env.*.local
*.pem
*.key
secrets/
```

### 2. Use Different Keys per Environment

```
dev-jwt-secret-123
staging-jwt-secret-456
prod-jwt-secret-789
```

### 3. Minimum Permissions

```json
// IAM Policy para CI/CD
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:*:*:secret:prod/*"
    }
  ]
}
```

### 4. Audit Logging

```typescript
// Log secret access (pero NO los valores)
logger.info({
  action: 'secret_accessed',
  secretName: 'database_password',
  userId: currentUser.id,
  timestamp: new Date(),
});
```

### 5. Secret Validation

```typescript
// Validar formato antes de usar
const API_KEY_REGEX = /^sk-[a-zA-Z0-9]{48}$/;

if (!API_KEY_REGEX.test(env.API_KEY)) {
  throw new Error('Invalid API key format');
}
```

---

## 📊 Monitoring & Observability

### Los 3 Pilares

```
1. Logs     → ¿Qué pasó?
2. Metrics  → ¿Cómo está el sistema?
3. Traces   → ¿Dónde está el problema?
```

---

## 📝 Structured Logging

### TypeScript (Pino)

```typescript
// src/utils/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Uso
logger.info({ userId: 123, action: 'login' }, 'User logged in');
logger.error({ err, userId: 123 }, 'Failed to create user');
logger.warn({ apiKey: 'hidden' }, 'API rate limit approaching');

// Context logging
const childLogger = logger.child({ requestId: '123' });
childLogger.info('Processing request');
childLogger.error('Request failed');
```

### Python (structlog)

```python
# app/utils/logger.py
import structlog
import logging

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.UnicodeDecoder(),
        structlog.processors.JSONRenderer()
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    logger_factory=structlog.stdlib.LoggerFactory(),
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

# Uso
logger.info("user_login", user_id=123, ip_address="192.168.1.1")
logger.error("database_error", error=str(e), query=query)
logger.warning("rate_limit", api_key="hidden", requests=95)

# Context
log = logger.bind(request_id="123")
log.info("processing_request")
log.error("request_failed")
```

### Go (Zap)

```go
// internal/logger/logger.go
package logger

import (
    "go.uber.org/zap"
    "go.uber.org/zap/zapcore"
)

var Log *zap.Logger

func Init() {
    config := zap.NewProductionConfig()
    config.EncoderConfig.TimeKey = "timestamp"
    config.EncoderConfig.EncodeTime = zapcore.ISO8601TimeEncoder
    
    var err error
    Log, err = config.Build()
    if err != nil {
        panic(err)
    }
}

// Uso
logger.Log.Info("user logged in",
    zap.Int("user_id", 123),
    zap.String("action", "login"),
)

logger.Log.Error("failed to create user",
    zap.Error(err),
    zap.Int("user_id", 123),
)
```

---

## 🏥 Health Checks Avanzados

### Endpoint Completo

```typescript
// src/routes/health.ts
import { Hono } from 'hono';
import { db } from '@/db';
import { redis } from '@/redis';

const health = new Hono();

health.get('/', async (c) => {
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.VERSION || 'unknown',
    uptime: process.uptime(),
    
    // Database check
    database: await checkDatabase(),
    
    // Cache check
    cache: await checkRedis(),
    
    // External APIs
    external: await checkExternalAPIs(),
    
    // System metrics
    system: {
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
        percentage: (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100,
      },
      cpu: process.cpuUsage(),
    },
  };
  
  // Determine overall health
  const allHealthy = [
    checks.database,
    checks.cache,
    checks.external,
  ].every(check => check.status === 'ok');
  
  checks.status = allHealthy ? 'ok' : 'degraded';
  
  return c.json(checks, allHealthy ? 200 : 503);
});

async function checkDatabase() {
  try {
    await db.execute('SELECT 1');
    return { status: 'ok', latency: 10 };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

async function checkRedis() {
  try {
    await redis.ping();
    return { status: 'ok' };
  } catch (error) {
    return { status: 'error', error: error.message };
  }
}

async function checkExternalAPIs() {
  const apis = [
    { name: 'stripe', url: 'https://api.stripe.com/healthcheck' },
    { name: 'sendgrid', url: 'https://api.sendgrid.com/v3/health' },
  ];
  
  const results = await Promise.all(
    apis.map(async (api) => {
      try {
        const start = Date.now();
        const res = await fetch(api.url);
        const latency = Date.now() - start;
        
        return {
          name: api.name,
          status: res.ok ? 'ok' : 'error',
          latency,
        };
      } catch (error) {
        return {
          name: api.name,
          status: 'error',
          error: error.message,
        };
      }
    })
  );
  
  return {
    status: results.every(r => r.status === 'ok') ? 'ok' : 'degraded',
    apis: results,
  };
}

export default health;
```

---

## 📈 Metrics (Prometheus Format)

```typescript
// src/routes/metrics.ts
import { Hono } from 'hono';
import { register, Counter, Histogram, Gauge } from 'prom-client';

const metrics = new Hono();

// Define metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route'],
  buckets: [0.1, 0.5, 1, 2, 5],
});

export const activeConnections = new Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
});

// Endpoint
metrics.get('/', async (c) => {
  return c.text(await register.metrics());
});

export default metrics;

// Middleware para tracking
export function metricsMiddleware() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    activeConnections.inc();
    
    await next();
    
    const duration = (Date.now() - start) / 1000;
    httpRequestsTotal.labels(c.req.method, c.req.path, c.res.status).inc();
    httpRequestDuration.labels(c.req.method, c.req.path).observe(duration);
    activeConnections.dec();
  };
}
```

---

## 🔍 Error Tracking (Sentry)

### Setup

```bash
# Instalar
bun add @sentry/node @sentry/profiling-node
```

```typescript
// src/utils/sentry.ts
import * as Sentry from '@sentry/node';
import { ProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  
  // Performance monitoring
  tracesSampleRate: 0.1, // 10% of requests
  
  // Profiling
  profilesSampleRate: 0.1,
  integrations: [
    new ProfilingIntegration(),
  ],
  
  // Release tracking
  release: process.env.VERSION,
  
  // Ignore health checks
  beforeSend(event, hint) {
    if (event.request?.url?.includes('/health')) {
      return null;
    }
    return event;
  },
});

// Middleware
export function sentryMiddleware() {
  return async (c: Context, next: Next) => {
    try {
      await next();
    } catch (error) {
      Sentry.captureException(error, {
        user: { id: c.get('userId') },
        tags: {
          route: c.req.path,
          method: c.req.method,
        },
      });
      throw error;
    }
  };
}

// Manual tracking
Sentry.captureMessage('Something went wrong', {
  level: 'warning',
  user: { id: userId },
  extra: { context: 'payment_processing' },
});
```

---

## 🎯 Application Performance Monitoring (APM)

### OpenTelemetry Setup

```typescript
// src/utils/telemetry.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});

sdk.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => console.log('Telemetry shut down'))
    .catch(err => console.error('Error shutting down telemetry', err));
});
```

---

## 🛠️ Local Development Experience

### Hot Reload por Lenguaje

#### TypeScript (Bun)

```json
// package.json
{
  "scripts": {
    "dev": "bun --watch src/index.ts"
  }
}
```

```toml
# .mise.toml
[tasks.dev]
run = "bun --watch src/index.ts"
```

#### Python (watchfiles)

```toml
[tasks.dev]
run = "watchfiles 'uvicorn app.main:app --reload' app/"
```

#### Go (Air)

```toml
# .air.toml
root = "."
tmp_dir = "tmp"

[build]
  cmd = "go build -o ./tmp/main cmd/api/main.go"
  bin = "./tmp/main"
  include_ext = ["go", "tmpl", "html"]
  exclude_dir = ["tmp", "vendor", "node_modules"]
  delay = 1000
  
[color]
  main = "magenta"
  watcher = "cyan"
  build = "yellow"
  runner = "green"

[log]
  time = true
```

```toml
# .mise.toml
[tasks.dev]
run = "air"
```

---

## 🗄️ Database GUI Tools

```toml
# .mise.toml

[tasks."db:studio"]
description = "Open database GUI"
run = """
#!/usr/bin/env bash

if grep -q "drizzle" package.json 2>/dev/null; then
  echo "🎨 Opening Drizzle Studio..."
  bunx drizzle-kit studio
  
elif grep -q "prisma" package.json 2>/dev/null; then
  echo "🎨 Opening Prisma Studio..."
  bunx prisma studio
  
else
  echo "💡 Install a GUI tool:"
  echo "  - TablePlus: https://tableplus.com"
  echo "  - DBeaver: https://dbeaver.io"
  echo "  - pgAdmin: https://www.pgadmin.org"
  echo ""
  echo "Connection string: $DATABASE_URL"
fi
"""

[tasks."db:gui"]
description = "Copy connection string to clipboard"
run = """
echo "$DATABASE_URL" | pbcopy
echo "✅ Connection string copied to clipboard"
echo "Paste it in TablePlus, DBeaver, or pgAdmin"
"""
```

---

## 🐛 Debug Configuration

### VSCode (.vscode/launch.json)

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Bun",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "bun",
      "runtimeArgs": ["--inspect-wait", "--watch", "src/index.ts"],
      "console": "integratedTerminal",
      "env": {
        "NODE_ENV": "development"
      }
    },
    {
      "name": "Debug Python",
      "type": "python",
      "request": "launch",
      "module": "uvicorn",
      "args": ["app.main:app", "--reload"],
      "jinja": true,
      "env": {
        "PYTHONPATH": "${workspaceFolder}"
      }
    },
    {
      "name": "Debug Go",
      "type": "go",
      "request": "launch",
      "mode": "debug",
      "program": "${workspaceFolder}/cmd/api",
      "env": {
        "DATABASE_URL": "${env:DATABASE_URL}"
      }
    },
    {
      "name": "Debug Tests",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "bun",
      "runtimeArgs": ["test", "--inspect-wait"],
      "console": "integratedTerminal"
    }
  ]
}
```

---

## 📦 Docker Compose para Dev

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - .:/app
      - /app/node_modules  # No overwrite node_modules
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/mydb
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    command: mise run dev
  
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
  
  # Herramientas de desarrollo
  mailhog:
    image: mailhog/mailhog
    ports:
      - "1025:1025"  # SMTP
      - "8025:8025"  # Web UI
  
  adminer:
    image: adminer
    ports:
      - "8081:8080"
    environment:
      ADMINER_DEFAULT_SERVER: db

volumes:
  postgres_data:
```

```toml
# .mise.toml
[tasks."docker:up"]
run = "docker compose up -d"

[tasks."docker:down"]
run = "docker compose down"

[tasks."docker:logs"]
run = "docker compose logs -f api"

[tasks."docker:shell"]
run = "docker compose exec api sh"
```

---

## ☁️ Deployment Simple (Railway/Koyeb/Coolify)

### Filosofía: PaaS First, AWS Después

**Para Solo Devs:**
```
❌ AWS: Setup 2-3 horas, $50-200/mes, IAM/VPC/RDS → Overkill
✅ Railway/Koyeb/Coolify: Setup 5 min, $0-20/mes, git push → Perfecto
```

### Comparativa de Plataformas

| Plataforma | Precio/mes | Free Tier | Deploy | DB Incluido | Edge |
|------------|-----------|-----------|--------|-------------|------|
| **Koyeb** | $0-15 | ✅ Generoso | git push | ✅ PostgreSQL | ✅ Global |
| **Railway** | $5-20 | $5 crédito | git push | ✅ PostgreSQL | ❌ |
| **Coolify** | $5 | ❌ (self-hosted) | git push | ✅ PostgreSQL | Depende |
| **Render** | $7-25 | ✅ Limitado | git push | ✅ PostgreSQL | ❌ |
| **AWS** | $30-50+ | Complejo | CI/CD manual | Setup manual | ❌ |

---

## 🌍 Koyeb (Recomendado - Global Edge)

### Por qué Koyeb es Ideal para Solo Devs

```
✅ Free Tier Generoso:
   - 2 servicios gratis
   - $2.50 crédito/mes
   - No tarjeta requerida

✅ Global Edge Deployment:
   - Deploy en 6 regiones mundiales
   - Latencia baja global
   - Auto-scaling incluido

✅ Super Simple:
   - git push deploy automático
   - UI intuitiva
   - PostgreSQL con 1 click
   - SSL automático

✅ Features Pro:
   - Zero-downtime deploys
   - Health checks automáticos
   - Docker support nativo
   - Logs en tiempo real
```

### Setup Rápido

```bash
# 1. Instalar CLI
curl -fsSL https://koyeb-cli.s3.amazonaws.com/install.sh | bash

# O con Mise
mise use koyeb@latest

# 2. Login
koyeb login

# 3. Deploy desde GitHub (automático)
koyeb app create my-api \
  --git github.com/user/repo \
  --git-branch main \
  --git-buildCommand "bun install && bun run build" \
  --git-runCommand "bun run start" \
  --ports 8080:http \
  --regions fra,was  # Frankfurt + Washington

# 4. Agregar PostgreSQL
koyeb service create-database my-db \
  --type postgres \
  --plan free

# 5. Listo! 🎉
```

### koyeb.yaml (Configuración Declarativa)

```yaml
# .koyeb.yml
services:
  - name: api
    type: web
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - port: 8080
        protocol: http
    env:
      - name: NODE_ENV
        value: production
      - name: DATABASE_URL
        secret: DATABASE_URL
      - name: JWT_SECRET
        secret: JWT_SECRET
    regions:
      - fra  # Frankfurt (Europa)
      - was  # Washington (US Este)
    instance:
      type: free  # O: nano ($7), small ($14)
    scaling:
      min: 1
      max: 3
    health_check:
      http:
        path: /health
        port: 8080
        initial_delay: 10
        timeout: 5
```

### Secrets en Koyeb

```bash
# Crear secrets
koyeb secret create DATABASE_URL --value "postgresql://..."
koyeb secret create JWT_SECRET --value "your-secret-here"

# Listar secrets
koyeb secret list

# Actualizar secret
koyeb secret update JWT_SECRET --value "new-secret"
```

### Mise Tasks para Koyeb

```toml
# .mise.toml

[tasks."deploy:koyeb"]
description = "Deploy to Koyeb (Global Edge)"
run = """
echo "🌍 Deploying to Koyeb..."
koyeb service redeploy my-api
echo "✅ Deployed globally!"
koyeb service get my-api --output json | jq '.status'
"""

[tasks."logs:koyeb"]
description = "Tail Koyeb logs"
run = "koyeb service logs my-api --follow"

[tasks."secrets:koyeb"]
description = "List Koyeb secrets"
run = "koyeb secret list"
```

---

## 🚂 Railway (Más Simple)

### Por qué Railway

```
✅ La interfaz más intuitiva
✅ $5 de crédito gratis
✅ PostgreSQL con 1 click
✅ Deploy instantáneo
✅ Logs hermosos
```

### Setup

```bash
# 1. Instalar CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Init proyecto
railway init

# 4. Agregar PostgreSQL
railway add
# Seleccionar: PostgreSQL

# 5. Deploy
railway up

# 6. Ver en producción
railway open
```

### railway.json

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
    "restartPolicyType": "ON_FAILURE"
  }
}
```

### Mise Tasks

```toml
[tasks."deploy:railway"]
description = "Deploy to Railway"
run = """
echo "🚂 Deploying to Railway..."
railway up --detach
railway open
"""

[tasks."logs:railway"]
run = "railway logs"
```

---

## 🐳 Coolify (Self-Hosted PaaS)

### Por qué Coolify

```
✅ 100% self-hosted (open source)
✅ Más barato (~$5/mes en Hetzner)
✅ Control total sobre infraestructura
✅ UI tipo Vercel/Railway
✅ Sin vendor lock-in
```

### Setup en Hetzner

```bash
# 1. Crear VPS en Hetzner
# CPX11: 2 vCPU, 2 GB RAM = $5/mes

# 2. SSH al servidor
ssh root@your-server-ip

# 3. Instalar Coolify (1 comando)
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash

# 4. Abrir UI
# http://your-server-ip:8000

# 5. Desde UI:
# - Conectar GitHub
# - Agregar proyecto
# - Deploy automático al push
```

### Costos Reales

```
Hetzner CPX11:  $5/mes (2GB RAM, 40GB SSD)
Hetzner CPX21:  $10/mes (4GB RAM, 80GB SSD)
Hetzner CPX31:  $20/mes (8GB RAM, 160GB SSD)

vs

Railway:  $5-20/mes (sin control del servidor)
Koyeb:    $0-15/mes (sin control del servidor)
AWS EC2:  $30+/mes (complejo de configurar)
```

---

## 🎯 Deployment Universal (Mise Tasks)

```toml
# .mise.toml

[env]
DEPLOY_PLATFORM = "koyeb"  # O "railway", "coolify", "render"

[tasks.deploy]
description = "Deploy to configured platform"
run = """
#!/usr/bin/env bash

PLATFORM=${DEPLOY_PLATFORM:-koyeb}

case $PLATFORM in
  koyeb)
    echo "🌍 Deploying to Koyeb (Global Edge)..."
    koyeb service redeploy my-api
    ;;
  railway)
    echo "🚂 Deploying to Railway..."
    railway up --detach
    ;;
  coolify)
    echo "🐳 Deploying to Coolify..."
    echo "Coolify deploys automatically from git push"
    git push coolify main
    ;;
  render)
    echo "🎨 Deploying to Render..."
    echo "Render deploys automatically from git push"
    git push render main
    ;;
  *)
    echo "❌ Unknown platform: $PLATFORM"
    exit 1
    ;;
esac

echo "✅ Deployed to $PLATFORM!"
"""

[tasks.logs]
description = "Tail production logs"
run = """
PLATFORM=${DEPLOY_PLATFORM:-koyeb}

case $PLATFORM in
  koyeb) koyeb service logs my-api --follow ;;
  railway) railway logs ;;
  *) echo "Logs not configured for $PLATFORM" ;;
esac
"""

[tasks."db:url"]
description = "Get production DATABASE_URL"
run = """
PLATFORM=${DEPLOY_PLATFORM:-koyeb}

case $PLATFORM in
  koyeb) koyeb secret get DATABASE_URL ;;
  railway) railway variables get DATABASE_URL ;;
  *) echo "Not configured for $PLATFORM" ;;
esac
"""
```

---

## 🔐 Secrets Management por Plataforma

### Koyeb

```bash
# Crear
koyeb secret create JWT_SECRET --value "xxx"

# Ver (oculto)
koyeb secret list

# Actualizar
koyeb secret update JWT_SECRET --value "new"

# En código: process.env.JWT_SECRET
```

### Railway

```bash
# Via CLI
railway variables set JWT_SECRET="xxx"

# Via UI
# Dashboard > Variables > Add Variable

# En código: process.env.JWT_SECRET
```

### Coolify

```bash
# Via UI únicamente
# Project > Environment Variables > Add
# ✅ Checkbox "Secret" para ocultar

# En código: process.env.JWT_SECRET
```

---

## 🔄 Migración desde otras herramientas

### Desde nvm/pyenv/etc

```bash
# Mise detecta automáticamente archivos de versiones existentes
# .nvmrc, .python-version, .ruby-version, etc.

# Migrar automáticamente
mise install

# Verificar
mise current

# Opcional: Crear .mise.toml explícito
mise use node@$(cat .nvmrc)

# Puedes eliminar los archivos viejos
rm .nvmrc .python-version .ruby-version
```

### Desde Husky

```bash
# 1. Desinstalar Husky
npm uninstall husky
rm -rf .husky

# 2. Instalar Mise
brew install mise

# 3. Crear .mise.toml con hooks (ver template arriba)

# 4. Activar hooks
mise hook-env

# 5. Listo! Los hooks están activos
git commit -m "feat: migrated to mise"
```

### Desde Pre-commit (Python)

```bash
# 1. Desinstalar pre-commit
pip uninstall pre-commit
rm .pre-commit-config.yaml

# 2. Convertir hooks a .mise.toml
# Ver sección [hooks] en template arriba

# 3. Activar
mise hook-env

# 4. Más rápido y menos dependencias ✅
```

### Por qué usar Pre-commit Hooks

```
❌ Sin hooks:
Desarrollador → commit → push → CI falla por lint → frustración

✅ Con hooks:
Desarrollador → commit → hooks validan → fix local → commit exitoso
```

### Setup con Husky (JavaScript/TypeScript)

```bash
# Instalar Husky
npm install --save-dev husky
npx husky init

# O con Bun
bun add --dev husky
bunx husky init
```

**package.json:**
```json
{
  "scripts": {
    "prepare": "husky"
  }
}
```

**.husky/pre-commit:**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

echo "🎣 Running pre-commit hooks..."

# Leer config
LINT_ENABLED=$(grep -A1 "validate_lint:" .solo-dev/config.yml | tail -1 | awk '{print $2}')
TEST_ENABLED=$(grep -A1 "validate_tests:" .solo-dev/config.yml | tail -1 | awk '{print $2}')

# Lint
if [ "$LINT_ENABLED" = "true" ]; then
  echo "🎨 Running linter..."
  ./scripts/lint.sh || {
    echo "❌ Lint failed. Fix errors and try again."
    exit 1
  }
fi

# Tests (solo archivos modificados)
if [ "$TEST_ENABLED" = "true" ]; then
  echo "🧪 Running tests on changed files..."
  ./scripts/test-changed.sh || {
    echo "❌ Tests failed. Fix and try again."
    exit 1
  }
fi

echo "✅ Pre-commit checks passed!"
```

**.husky/commit-msg:**
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

COMMIT_ENABLED=$(grep -A1 "validate_commit_message:" .solo-dev/config.yml | tail -1 | awk '{print $2}')

if [ "$COMMIT_ENABLED" = "true" ]; then
  npx --no -- commitlint --edit "$1"
fi
```

### Setup para Python

```bash
# Instalar pre-commit
pip install pre-commit

# O con uv
uv add --dev pre-commit
```

**.pre-commit-config.yaml:**
```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.5.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
  
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.1.9
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
  
  - repo: local
    hooks:
      - id: pytest-changed
        name: Run pytest on changed files
        entry: ./scripts/test-changed.sh
        language: system
        pass_filenames: false
```

```bash
# Instalar hooks
pre-commit install
```

### Setup para Go

**scripts/pre-commit-go.sh:**
```bash
#!/bin/bash
set -e

echo "🎣 Running Go pre-commit hooks..."

# Leer config
LINT_ENABLED=$(yq eval '.features.pre_commit_hooks.validate_lint' .solo-dev/config.yml)
TEST_ENABLED=$(yq eval '.features.pre_commit_hooks.validate_tests' .solo-dev/config.yml)

# Format
echo "🎨 Running gofmt..."
gofmt -w .

# Lint
if [ "$LINT_ENABLED" = "true" ]; then
  echo "🔍 Running golangci-lint..."
  golangci-lint run --fix
fi

# Tests
if [ "$TEST_ENABLED" = "true" ]; then
  echo "🧪 Running tests..."
  go test -short ./...
fi

echo "✅ Go pre-commit checks passed!"
```

### Setup para Java/Kotlin

**.git/hooks/pre-commit:**
```bash
#!/bin/bash
set -e

echo "🎣 Running Java/Kotlin pre-commit hooks..."

# Spotless (format)
echo "🎨 Running Spotless..."
./gradlew spotlessApply

# Tests rápidos
echo "🧪 Running unit tests..."
./gradlew test --tests "*Test"

echo "✅ Java pre-commit checks passed!"
```

### Script Universal: test-changed.sh

```bash
#!/bin/bash
# scripts/test-changed.sh - Solo tests de archivos modificados

set -e

echo "🧪 Running tests on changed files..."

# Obtener archivos modificados
CHANGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)

if [ -z "$CHANGED_FILES" ]; then
  echo "No files changed, skipping tests"
  exit 0
fi

# Detectar stack
if [ -f "package.json" ]; then
  # TypeScript/JavaScript - Bun
  echo "📦 Detecting TypeScript/JavaScript files..."
  
  TEST_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(ts|js|tsx|jsx)$' | sed 's/\.ts$/.test.ts/' | sed 's/\.js$/.test.js/' | xargs -I {} find . -name {} 2>/dev/null || true)
  
  if [ -n "$TEST_FILES" ]; then
    bun test $TEST_FILES
  else
    echo "No test files found for changed files"
  fi

elif [ -f "pyproject.toml" ]; then
  # Python
  echo "🐍 Detecting Python files..."
  
  PY_FILES=$(echo "$CHANGED_FILES" | grep '\.py$' || true)
  
  if [ -n "$PY_FILES" ]; then
    # Ejecutar solo tests relacionados
    uv run pytest --verbose $PY_FILES
  fi

elif [ -f "go.mod" ]; then
  # Go
  echo "🐹 Detecting Go files..."
  
  GO_FILES=$(echo "$CHANGED_FILES" | grep '\.go$' | sed 's/_test\.go$//' | sed 's/\.go$//' || true)
  
  if [ -n "$GO_FILES" ]; then
    # Ejecutar tests de paquetes modificados
    PACKAGES=$(echo "$GO_FILES" | xargs -I {} dirname {} | sort -u | sed 's|^|./|' | tr '\n' ' ')
    go test -short $PACKAGES
  fi

elif [ -f "build.gradle.kts" ]; then
  # Java/Kotlin
  echo "☕ Detecting Java/Kotlin files..."
  
  JAVA_FILES=$(echo "$CHANGED_FILES" | grep -E '\.(java|kt)$' || true)
  
  if [ -n "$JAVA_FILES" ]; then
    # Ejecutar solo unit tests (rápidos)
    ./gradlew test --tests "*Test"
  fi
fi

echo "✅ Changed files tests passed!"
```

### Bypass Hooks (cuando sea necesario)

```bash
# Saltar hooks en casos excepcionales
git commit --no-verify -m "feat: commit sin validación"

# O configurar temporalmente
export HUSKY=0
git commit -m "feat: sin hooks"
unset HUSKY
```

---

## 📊 Code Coverage Tracking

### Setup con Codecov

**codecov.yml:**
```yaml
coverage:
  status:
    project:
      default:
        target: auto
        threshold: 5%  # Permitir 5% de bajada
        informational: true  # No fallar CI
    patch:
      default:
        target: 80%
        informational: true

comment:
  behavior: default
  layout: "header, diff, flags, components"
  require_changes: false
```

**En CI (agregar a detect-and-test job):**
```yaml
# Después de run tests
- name: Generate Coverage Report
  if: always()
  run: |
    if [ -f "package.json" ]; then
      bun test --coverage
    elif [ -f "pyproject.toml" ]; then
      uv run pytest --cov=app --cov-report=xml
    elif [ -f "go.mod" ]; then
      go test -coverprofile=coverage.out ./...
      go tool cover -html=coverage.out -o coverage.html
    elif [ -f "build.gradle.kts" ]; then
      ./gradlew jacocoTestReport
    fi

- name: Upload to Codecov
  uses: codecov/codecov-action@v4
  if: env.CODE_COVERAGE_ENABLED == 'true'
  with:
    token: ${{ secrets.CODECOV_TOKEN }}
    files: ./coverage.xml,./coverage.out
    flags: unittests
    fail_ci_if_error: false
```

### Setup GitHub Secrets

```bash
# 1. Registrarse en https://codecov.io
# 2. Agregar repo
# 3. Copiar token
# 4. GitHub repo > Settings > Secrets > New secret
# Name: CODECOV_TOKEN
# Value: [tu-token]
```

### Badge en README

```markdown
[![codecov](https://codecov.io/gh/usuario/repo/branch/main/graph/badge.svg)](https://codecov.io/gh/usuario/repo)
```

---

## ⚡ Performance Benchmarks

### Setup para TypeScript (Bun)

**bench/api.bench.ts:**
```typescript
import { bench, describe } from 'bun:test';
import { app } from '../src/index';

describe('API Performance', () => {
  bench('GET /users', async () => {
    await app.request('/users');
  });
  
  bench('POST /users', async () => {
    await app.request('/users', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    });
  });
});
```

### Setup para Go

**internal/handlers/users_bench_test.go:**
```go
package handlers

import (
    "net/http/httptest"
    "testing"
    "github.com/gin-gonic/gin"
)

func BenchmarkGetUsers(b *testing.B) {
    gin.SetMode(gin.TestMode)
    router := gin.New()
    router.GET("/users", GetUsers)
    
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        w := httptest.NewRecorder()
        req := httptest.NewRequest("GET", "/users", nil)
        router.ServeHTTP(w, req)
    }
}
```

### CI Workflow

```yaml
# .github/workflows/benchmark.yml
name: Performance Benchmarks

on:
  pull_request:
    branches: [main, develop]

jobs:
  benchmark:
    runs-on: ubuntu-latest
    if: github.event.repository.topics contains 'performance'
    
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Setup Environment
        run: |
          # Detectar stack e instalar
          if [ -f "package.json" ]; then
            curl -fsSL https://bun.sh/install | bash
          elif [ -f "go.mod" ]; then
            # Go ya viene instalado
            go version
          fi
      
      - name: Run Benchmarks
        id: bench
        run: |
          if [ -f "package.json" ]; then
            bun bench > bench-current.txt
          elif [ -f "go.mod" ]; then
            go test -bench=. -benchmem ./... | tee bench-current.txt
          fi
      
      - name: Download Baseline
        uses: actions/cache@v3
        with:
          path: bench-baseline.txt
          key: benchmark-baseline-${{ github.base_ref }}
      
      - name: Compare with Baseline
        run: |
          if [ -f "bench-baseline.txt" ]; then
            ./scripts/compare-bench.sh bench-baseline.txt bench-current.txt
          else
            echo "No baseline found, saving current as baseline"
            cp bench-current.txt bench-baseline.txt
          fi
      
      - name: Save Baseline
        uses: actions/cache/save@v3
        with:
          path: bench-baseline.txt
          key: benchmark-baseline-${{ github.head_ref }}
      
      - name: Comment PR
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const report = fs.readFileSync('bench-report.md', 'utf8');
            
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: report
            });
```

**scripts/compare-bench.sh:**
```bash
#!/bin/bash
# Comparar benchmarks y generar reporte

BASELINE=$1
CURRENT=$2

echo "# 📊 Performance Benchmark Report" > bench-report.md
echo "" >> bench-report.md

# Lógica de comparación (simplificada)
# Extraer métricas y comparar
# Si regresión >20%, marcar como ⚠️

echo "| Benchmark | Baseline | Current | Change |" >> bench-report.md
echo "|-----------|----------|---------|--------|" >> bench-report.md

# Parsear y comparar...
# grep, awk, cálculos de porcentaje

echo "" >> bench-report.md
echo "✅ No significant regressions detected" >> bench-report.md
```

### Características
- ✅ Cero configuración compleja
- ✅ Agnóstico al lenguaje
- ✅ Changelog automático desde commits
- ✅ Versionado semántico automático
- ✅ GitHub releases automáticos

### Setup Inicial

#### 1. Configurar Conventional Commits

```bash
# Instalar commitlint (opcional pero recomendado)
npm install --save-dev @commitlint/cli @commitlint/config-conventional

# O con bun
bun add --dev @commitlint/cli @commitlint/config-conventional
```

**commitlint.config.js**
```javascript
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // Nueva funcionalidad
        'fix',      // Bug fix
        'docs',     // Solo documentación
        'style',    // Formato (no afecta código)
        'refactor', // Refactorización
        'perf',     // Mejora de performance
        'test',     // Tests
        'chore',    // Mantenimiento
        'ci',       // Cambios en CI
      ],
    ],
  },
};
```

#### 2. GitHub Actions Workflow

```yaml
# .github/workflows/release-please.yml
name: Release Please

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          # Funciona con cualquier lenguaje
          release-type: simple
          
          # Opcional: personalizar
          changelog-types: |
            [
              {"type":"feat","section":"✨ Features","hidden":false},
              {"type":"fix","section":"🐛 Bug Fixes","hidden":false},
              {"type":"docs","section":"📚 Documentation","hidden":false},
              {"type":"chore","section":"🔧 Miscellaneous","hidden":true},
              {"type":"refactor","section":"♻️ Code Refactoring","hidden":false},
              {"type":"perf","section":"⚡ Performance Improvements","hidden":false}
            ]
```

#### 3. Formato de Commits

```bash
# Features
git commit -m "feat(api): add user authentication endpoint"
git commit -m "feat(ui): add dark mode toggle"

# Bug Fixes
git commit -m "fix(db): resolve connection timeout issue"
git commit -m "fix(auth): handle expired token correctly"

# Documentation
git commit -m "docs: update API documentation"
git commit -m "docs(readme): add installation instructions"

# Refactoring
git commit -m "refactor(api): simplify error handling"

# Performance
git commit -m "perf(db): optimize query with index"

# Chores (no aparecen en CHANGELOG)
git commit -m "chore: update dependencies"
git commit -m "chore(deps): bump typescript to 5.3"
```

#### 4. CHANGELOG.md Generado Automáticamente

```markdown
# Changelog

## [1.2.0](https://github.com/user/repo/compare/v1.1.0...v1.2.0) (2025-12-23)

### ✨ Features

* **api:** add user authentication endpoint ([abc123](https://github.com/user/repo/commit/abc123))
* **ui:** add dark mode toggle ([def456](https://github.com/user/repo/commit/def456))

### 🐛 Bug Fixes

* **db:** resolve connection timeout issue ([ghi789](https://github.com/user/repo/commit/ghi789))
* **auth:** handle expired token correctly ([jkl012](https://github.com/user/repo/commit/jkl012))

### 📚 Documentation

* update API documentation ([mno345](https://github.com/user/repo/commit/mno345))
* **readme:** add installation instructions ([pqr678](https://github.com/user/repo/commit/pqr678))

### ♻️ Code Refactoring

* **api:** simplify error handling ([stu901](https://github.com/user/repo/commit/stu901))

### ⚡ Performance Improvements

* **db:** optimize query with index ([vwx234](https://github.com/user/repo/commit/vwx234))
```

---

## 🏥 Health Checks y Auto-Rollback

### Health Check Endpoint (Implementación por Lenguaje)

#### TypeScript (Hono/Bun)
```typescript
// src/routes/health.ts
import { Hono } from 'hono';

const health = new Hono();

health.get('/', (c) => {
  // Verificar conexiones críticas
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION || '1.0.0',
    uptime: process.uptime(),
    database: 'ok',  // Verificar DB connection
    memory: {
      used: process.memoryUsage().heapUsed,
      total: process.memoryUsage().heapTotal,
    },
  };
  
  return c.json(checks, 200);
});

export default health;
```

#### Python (FastAPI)
```python
# app/routes/health.py
from fastapi import APIRouter, Response
from datetime import datetime
import psutil

router = APIRouter()

@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "1.0.0",
        "memory": {
            "percent": psutil.virtual_memory().percent,
            "available": psutil.virtual_memory().available,
        },
        "cpu_percent": psutil.cpu_percent(interval=1),
    }
```

#### Go (Gin)
```go
// internal/handlers/health.go
package handlers

import (
    "net/http"
    "runtime"
    "time"
    "github.com/gin-gonic/gin"
)

func Health(c *gin.Context) {
    var m runtime.MemStats
    runtime.ReadMemStats(&m)
    
    c.JSON(http.StatusOK, gin.H{
        "status": "ok",
        "timestamp": time.Now().Format(time.RFC3339),
        "version": "1.0.0",
        "memory": gin.H{
            "alloc": m.Alloc,
            "total": m.TotalAlloc,
        },
    })
}
```

#### Java/Kotlin (Spring Boot)
```kotlin
// src/main/kotlin/com/example/api/controller/HealthController.kt
package com.example.api.controller

import org.springframework.boot.actuate.health.Health
import org.springframework.boot.actuate.health.HealthIndicator
import org.springframework.stereotype.Component
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

@RestController
class HealthController(private val healthIndicator: CustomHealthIndicator) {
    
    @GetMapping("/health")
    fun health() = healthIndicator.health()
}

@Component
class CustomHealthIndicator : HealthIndicator {
    override fun health(): Health {
        return Health.up()
            .withDetail("timestamp", System.currentTimeMillis())
            .withDetail("version", "1.0.0")
            .build()
    }
}
```

### Health Check Workflow

```yaml
# .github/workflows/health-check.yml
name: Health Check

on:
  workflow_run:
    workflows: ["CI/CD Pipeline"]
    types:
      - completed
    branches: [main]

jobs:
  health-check:
    runs-on: ubuntu-latest
    if: |
      github.event.workflow_run.conclusion == 'success' &&
      contains(github.event.workflow_run.head_branch, 'main')
    
    steps:
      - name: Wait for Deployment
        run: |
          echo "⏳ Waiting for deployment to stabilize..."
          sleep 30
      
      - name: Read Config
        id: config
        run: |
          # Simular lectura de config (en real, descargar del repo)
          echo "enabled=true" >> $GITHUB_OUTPUT
          echo "endpoint=/health" >> $GITHUB_OUTPUT
          echo "timeout=30" >> $GITHUB_OUTPUT
          echo "retry=3" >> $GITHUB_OUTPUT
      
      - name: Check Health Endpoint
        id: health
        if: steps.config.outputs.enabled == 'true'
        run: |
          ENDPOINT="${{ steps.config.outputs.endpoint }}"
          TIMEOUT="${{ steps.config.outputs.timeout }}"
          RETRY="${{ steps.config.outputs.retry }}"
          
          URL="${{ secrets.PRODUCTION_URL }}${ENDPOINT}"
          
          for i in $(seq 1 $RETRY); do
            echo "🔍 Attempt $i/$RETRY: Checking $URL"
            
            RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" \
              --max-time $TIMEOUT \
              "$URL" || echo "FAIL")
            
            if [ "$RESPONSE" = "200" ]; then
              echo "✅ Health check passed!"
              echo "status=healthy" >> $GITHUB_OUTPUT
              exit 0
            fi
            
            echo "⚠️  Health check failed with code: $RESPONSE"
            
            if [ $i -lt $RETRY ]; then
              echo "Retrying in 10 seconds..."
              sleep 10
            fi
          done
          
          echo "❌ Health check failed after $RETRY attempts"
          echo "status=unhealthy" >> $GITHUB_OUTPUT
          exit 1
      
      - name: Trigger Rollback
        if: |
          failure() &&
          steps.config.outputs.enabled == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.actions.createWorkflowDispatch({
              owner: context.repo.owner,
              repo: context.repo.repo,
              workflow_id: 'rollback.yml',
              ref: 'main',
              inputs: {
                reason: 'Health check failed after deployment',
                triggered_by: 'health-check-workflow'
              }
            });
      
      - name: Create Issue on Failure
        if: failure()
        uses: actions/github-script@v7
        with:
          script: |
            await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🚨 Health Check Failed - Investigation Required',
              body: `## Health Check Failure
              
              **Workflow:** ${context.workflow}
              **Commit:** ${context.sha.substring(0, 7)}
              **Time:** ${new Date().toISOString()}
              
              ### Details
              - Health endpoint did not respond correctly after deployment
              - Automatic rollback has been initiated
              - Please investigate the root cause
              
              ### Actions Taken
              - ✅ Rollback workflow triggered
              - ⏳ Waiting for rollback completion
              
              cc @${context.actor}`,
              labels: ['bug', 'critical', 'auto-rollback']
            });
```

### Rollback Workflow

```yaml
# .github/workflows/rollback.yml
name: Auto Rollback

on:
  workflow_dispatch:
    inputs:
      reason:
        description: 'Reason for rollback'
        required: true
        type: string
      triggered_by:
        description: 'What triggered this rollback'
        required: false
        type: string
        default: 'manual'

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  rollback:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: main
      
      - name: Configure Git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
      
      - name: Get Last Known Good Commit
        id: last-good
        run: |
          # Buscar último commit antes del actual que pasó health checks
          CURRENT_SHA=$(git rev-parse HEAD)
          
          # Revertir al commit anterior
          PREVIOUS_SHA=$(git rev-parse HEAD~1)
          
          echo "current=$CURRENT_SHA" >> $GITHUB_OUTPUT
          echo "previous=$PREVIOUS_SHA" >> $GITHUB_OUTPUT
      
      - name: Revert to Last Good State
        run: |
          echo "🔄 Reverting from ${{ steps.last-good.outputs.current }}"
          echo "   to ${{ steps.last-good.outputs.previous }}"
          
          # Revert el último commit
          git revert HEAD --no-edit
          
          # Push
          git push origin main
          
          echo "✅ Rollback completed"
      
      - name: Create Rollback Issue
        uses: actions/github-script@v7
        with:
          script: |
            const issue = await github.rest.issues.create({
              owner: context.repo.owner,
              repo: context.repo.repo,
              title: '🔄 Rollback Executed - Action Required',
              body: `## Automatic Rollback Executed
              
              **Reason:** ${{ inputs.reason }}
              **Triggered by:** ${{ inputs.triggered_by }}
              **Time:** ${new Date().toISOString()}
              
              ### Commits Affected
              - ❌ Reverted: \`${{ steps.last-good.outputs.current }}\`
              - ✅ Restored: \`${{ steps.last-good.outputs.previous }}\`
              
              ### Next Steps
              1. Investigate the root cause of the failure
              2. Fix the issue locally
              3. Test thoroughly before re-deploying
              4. Create a new PR with the fix
              
              ### Investigation Checklist
              - [ ] Review logs for errors
              - [ ] Check health check endpoint
              - [ ] Verify database migrations
              - [ ] Test in staging environment
              - [ ] Document findings
              
              cc @${context.actor}`,
              labels: ['rollback', 'incident', 'high-priority']
            });
            
            console.log(\`Issue created: #\${issue.data.number}\`);
      
      - name: Notify Team (Discord)
        if: env.DISCORD_ENABLED == 'true'
        run: |
          curl -X POST ${{ secrets.DISCORD_WEBHOOK }} \
            -H "Content-Type: application/json" \
            -d '{
              "content": "🚨 **ROLLBACK EXECUTED** 🚨",
              "embeds": [{
                "title": "Automatic Rollback",
                "description": "${{ inputs.reason }}",
                "color": 15158332,
                "fields": [
                  {
                    "name": "Triggered By",
                    "value": "${{ inputs.triggered_by }}",
                    "inline": true
                  },
                  {
                    "name": "Reverted Commit",
                    "value": "`${{ steps.last-good.outputs.current }}`",
                    "inline": true
                  }
                ],
                "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
              }]
            }'
```

---

## 🔒 Dependency Updates y Security Scanning

### Dependabot Configuration

```yaml
# .github/dependabot.yml
version: 2

updates:
  # ═══════════════════════════════════════════════════════════
  # JavaScript/TypeScript (npm/Bun)
  # ═══════════════════════════════════════════════════════════
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
    open-pull-requests-limit: 10
    
    # Agrupar updates relacionados
    groups:
      dev-dependencies:
        patterns:
          - "@types/*"
          - "*eslint*"
          - "prettier"
          - "@biomejs/*"
        update-types:
          - "minor"
          - "patch"
      
      production-dependencies:
        patterns:
          - "*"
        update-types:
          - "patch"
    
    # Auto-merge para patches
    # (requiere habilitar en repo settings)
    reviewers:
      - "your-username"
    labels:
      - "dependencies"
      - "auto-merge"
  
  # ═══════════════════════════════════════════════════════════
  # Python
  # ═══════════════════════════════════════════════════════════
  - package-ecosystem: "pip"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      dev-dependencies:
        patterns:
          - "pytest*"
          - "ruff"
          - "black"
      production-dependencies:
        patterns:
          - "fastapi"
          - "uvicorn"
          - "sqlalchemy"
  
  # ═══════════════════════════════════════════════════════════
  # Go
  # ═══════════════════════════════════════════════════════════
  - package-ecosystem: "gomod"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      all-dependencies:
        patterns:
          - "*"
  
  # ═══════════════════════════════════════════════════════════
  # Java/Kotlin (Gradle)
  # ═══════════════════════════════════════════════════════════
  - package-ecosystem: "gradle"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      spring-dependencies:
        patterns:
          - "org.springframework.boot:*"
          - "org.springframework:*"
      kotlin-dependencies:
        patterns:
          - "org.jetbrains.kotlin:*"
  
  # ═══════════════════════════════════════════════════════════
  # GitHub Actions
  # ═══════════════════════════════════════════════════════════
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    groups:
      actions:
        patterns:
          - "*"
```

### Auto-merge Dependabot PRs (Patches)

```yaml
# .github/workflows/dependabot-auto-merge.yml
name: Dependabot Auto-Merge

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    
    steps:
      - name: Fetch PR Details
        id: pr
        uses: actions/github-script@v7
        with:
          script: |
            const pr = await github.rest.pulls.get({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_number: context.issue.number
            });
            
            const title = pr.data.title;
            
            // Detectar si es patch update
            const isPatch = title.includes('patch') || 
                           /bump.*from \d+\.\d+\.\d+ to \d+\.\d+\.\d+$/.test(title);
            
            console.log(`PR title: ${title}`);
            console.log(`Is patch: ${isPatch}`);
            
            return { isPatch };
      
      - name: Enable Auto-merge
        if: fromJSON(steps.pr.outputs.result).isPatch
        run: gh pr merge --auto --squash "${{ github.event.pull_request.number }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Approve PR
        if: fromJSON(steps.pr.outputs.result).isPatch
        run: gh pr review --approve "${{ github.event.pull_request.number }}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

### GitHub Code Scanning (CodeQL)

```yaml
# .github/workflows/codeql.yml
name: CodeQL Security Scan

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
  schedule:
    - cron: '0 6 * * 1'  # Lunes a las 6am

jobs:
  analyze:
    name: Analyze
    runs-on: ubuntu-latest
    
    permissions:
      actions: read
      contents: read
      security-events: write
    
    strategy:
      fail-fast: false
      matrix:
        language: ['javascript', 'python', 'go', 'java']
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}
          queries: security-extended,security-and-quality
      
      - name: Autobuild
        uses: github/codeql-action/autobuild@v3
      
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
        with:
          category: "/language:${{ matrix.language }}"
```

### Características
- ✅ Control total del formato del changelog
- ✅ Documentación generada por AI (Gemini)
- ✅ README.md automático
- ✅ Docs API automáticas por lenguaje
- ✅ Deploy a GitHub Pages

### Setup Avanzado

#### 1. Git Cliff para Changelog

**Instalación:**
```bash
# macOS
brew install git-cliff

# Linux
cargo install git-cliff

# O descargar binario
wget https://github.com/orhun/git-cliff/releases/download/v1.4.0/git-cliff-1.4.0-x86_64-unknown-linux-gnu.tar.gz
```

**cliff.toml**
```toml
[changelog]
header = """
# 📋 Changelog

Todos los cambios notables de este proyecto se documentan aquí.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

"""

body = """
{% if version %}\
    ## [{{ version | trim_start_matches(pat="v") }}] - {{ timestamp | date(format="%Y-%m-%d") }}
{% else %}\
    ## [Unreleased]
{% endif %}\

{% for group, commits in commits | group_by(attribute="group") %}
    ### {{ group | striptags | trim | upper_first }}
    {% for commit in commits %}
        - {% if commit.scope %}**{{ commit.scope }}:** {% endif %}\
            {% if commit.breaking %}[**breaking**] {% endif %}\
            {{ commit.message | upper_first }} \
            ([{{ commit.id | truncate(length=7, end="") }}]({{ commit.link }}))
    {% endfor %}
{% endfor %}\n
"""

trim = true
footer = """
<!-- generated by git-cliff -->
"""

[git]
conventional_commits = true
filter_unconventional = true
split_commits = false

commit_parsers = [
    { message = "^feat", group = "✨ Features" },
    { message = "^fix", group = "🐛 Bug Fixes" },
    { message = "^doc", group = "📚 Documentation" },
    { message = "^perf", group = "⚡ Performance" },
    { message = "^refactor", group = "♻️ Refactor" },
    { message = "^style", group = "🎨 Styling" },
    { message = "^test", group = "🧪 Testing" },
    { message = "^chore\\(release\\): prepare for", skip = true },
    { message = "^chore\\(deps\\)", skip = true },
    { message = "^chore\\(pr\\)", skip = true },
    { message = "^chore\\(pull\\)", skip = true },
    { message = "^chore|^ci", group = "🔧 Miscellaneous" },
    { body = ".*security", group = "🔒 Security" },
    { message = "^revert", group = "⏪ Revert" },
]

protect_breaking_commits = false
filter_commits = false
tag_pattern = "v[0-9].*"
skip_tags = "v0.1.0-beta.1"
ignore_tags = ""
topo_order = false
sort_commits = "oldest"

[bump]
features_always_bump_minor = true
breaking_always_bump_major = true
```

**GitHub Actions:**
```yaml
# .github/workflows/changelog-advanced.yml
name: Changelog (Advanced)

on:
  push:
    branches:
      - main
    tags:
      - 'v*'

jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Install git-cliff
        run: |
          wget https://github.com/orhun/git-cliff/releases/download/v1.4.0/git-cliff-1.4.0-x86_64-unknown-linux-gnu.tar.gz
          tar -xzf git-cliff-1.4.0-x86_64-unknown-linux-gnu.tar.gz
          chmod +x git-cliff
          sudo mv git-cliff /usr/local/bin/
      
      - name: Generate Changelog
        run: |
          git-cliff -o CHANGELOG.md
      
      - name: Commit Changelog
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add CHANGELOG.md
          git commit -m "docs: update CHANGELOG.md" || echo "No changes"
          git push
```

#### 2. Documentación AI con Gemini (Gratuita)

**scripts/generate-docs.js**
```javascript
import { GoogleGenerativeAI } from '@google/generative-ai';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function analyzeCodebase() {
  // Leer estructura del proyecto
  const structure = getProjectStructure('.');
  
  // Leer archivos principales
  const mainFiles = [
    'package.json',
    'src/index.ts',
    'src/main.py',
    'cmd/api/main.go',
    // ... detectar automáticamente
  ].filter(f => existsSync(f));
  
  const codeContext = mainFiles.map(f => ({
    path: f,
    content: readFileSync(f, 'utf-8')
  }));
  
  return { structure, codeContext };
}

async function generateREADME() {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  
  const { structure, codeContext } = await analyzeCodebase();
  
  const prompt = `
Analiza este proyecto y genera un README.md profesional en markdown.

ESTRUCTURA DEL PROYECTO:
${JSON.stringify(structure, null, 2)}

ARCHIVOS PRINCIPALES:
${codeContext.map(f => `
### ${f.path}
\`\`\`
${f.content}
\`\`\`
`).join('\n')}

GENERA UN README.md QUE INCLUYA:

1. Título y descripción breve del proyecto
2. Características principales
3. Tech stack detectado
4. Requisitos previos
5. Instalación paso a paso
6. Uso con ejemplos
7. Estructura del proyecto
8. Scripts disponibles
9. Testing
10. Contribución (opcional)
11. Licencia

IMPORTANTE:
- Usa emojis apropiados
- Formato markdown limpio
- Ejemplos de código con syntax highlighting
- Badges relevantes (build status, license, etc.)
- TOC si el README es largo

RESPONDE SOLO CON EL CONTENIDO DEL README.MD, SIN EXPLICACIONES ADICIONALES.
`;

  const result = await model.generateContent(prompt);
  const readme = result.response.text();
  
  writeFileSync('README.md', readme);
  console.log('✅ README.md generado automáticamente');
}

function getProjectStructure(dir, depth = 0, maxDepth = 3) {
  if (depth > maxDepth) return null;
  
  const items = readdirSync(dir, { withFileTypes: true });
  const structure = {};
  
  for (const item of items) {
    // Ignorar node_modules, .git, etc.
    if (['node_modules', '.git', 'dist', 'build', '.next'].includes(item.name)) {
      continue;
    }
    
    if (item.isDirectory()) {
      structure[item.name] = getProjectStructure(
        join(dir, item.name),
        depth + 1,
        maxDepth
      );
    } else {
      structure[item.name] = 'file';
    }
  }
  
  return structure;
}

// Ejecutar
generateREADME().catch(console.error);
```

**package.json (para proyectos Node/Bun):**
```json
{
  "scripts": {
    "docs:generate": "bun run scripts/generate-docs.js"
  },
  "devDependencies": {
    "@google/generative-ai": "^0.21.0"
  }
}
```

**GitHub Actions con Gemini:**
```yaml
# .github/workflows/auto-docs.yml
name: Auto Documentation (AI)

on:
  push:
    branches: [main]
    paths:
      - 'src/**'
      - 'cmd/**'
      - 'app/**'
      - '!README.md'

jobs:
  generate-docs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install @google/generative-ai
      
      - name: Generate README with Gemini
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: bun run scripts/generate-docs.js
      
      - name: Generate API Docs (language-specific)
        run: |
          if [ -f "package.json" ]; then
            # TypeScript/JavaScript
            npx typedoc --out docs/api src/
          elif [ -f "pyproject.toml" ]; then
            # Python
            pip install pdoc3
            pdoc --html --output-dir docs/api app/
          elif [ -f "go.mod" ]; then
            # Go
            go install golang.org/x/tools/cmd/godoc@latest
            mkdir -p docs/api
            # Generar docs estáticas
          elif [ -f "build.gradle.kts" ]; then
            # Kotlin/Java
            ./gradlew dokkaHtml
            mv build/dokka/html docs/api
          fi
      
      - name: Commit Documentation
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add README.md docs/
          git commit -m "docs: auto-update documentation [skip ci]" || echo "No changes"
          git push
      
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs
```

#### 3. Configurar GitHub Pages

```bash
# En GitHub repo settings:
# Settings > Pages > Source > gh-pages branch
```

---

---

## 📢 Notificaciones (Discord / Slack)

### Discord Webhooks

#### Setup
```bash
# 1. En tu servidor Discord
# Server Settings > Integrations > Webhooks > New Webhook

# 2. Copiar Webhook URL

# 3. GitHub Settings > Secrets
# Name: DISCORD_WEBHOOK
# Value: https://discord.com/api/webhooks/...
```

#### Workflow de Notificaciones

```yaml
# .github/workflows/notifications.yml
name: Notifications

on:
  workflow_run:
    workflows: ["CI/CD Pipeline"]
    types: [completed]
  
  issues:
    types: [opened, labeled]

jobs:
  discord-notify:
    runs-on: ubuntu-latest
    if: vars.DISCORD_ENABLED == 'true'
    
    steps:
      - name: Notify Merge Success
        if: |
          github.event.workflow_run.conclusion == 'success' &&
          github.event.workflow_run.event == 'pull_request'
        run: |
          curl -X POST ${{ secrets.DISCORD_WEBHOOK }} \
            -H "Content-Type: application/json" \
            -d '{
              "embeds": [{
                "title": "✅ PR Auto-Merged",
                "description": "CI passed and PR was automatically merged",
                "color": 3066993,
                "fields": [
                  {
                    "name": "Branch",
                    "value": "'"${{ github.event.workflow_run.head_branch }}"'",
                    "inline": true
                  },
                  {
                    "name": "Author",
                    "value": "'"${{ github.event.workflow_run.actor.login }}"'",
                    "inline": true
                  }
                ],
                "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
              }]
            }'
```

### Slack Webhooks (Similar config)

[Documentación similar a Discord pero para Slack]

### Configurar en Variables

```bash
# GitHub repo > Settings > Variables > Actions
# DISCORD_ENABLED = false  (por defecto)
# SLACK_ENABLED = false    (por defecto)
```

---

## ⏱️ Estimación de Tiempo en Planes

[Sección completa con templates y ejemplos de estimación]

---

## 💰 Cloud Cost Estimation (Desactivado por defecto)

[Sección completa con Infracost]

---

## 🎯 Modo Híbrido (Recomendado): Simple + Docs On-Demand

### Filosofía
```
Durante desarrollo:
✅ Release Please (changelog automático)
✅ Commits convencionales
✅ Sin complicaciones

Cuando estés listo (feature completa, v1.0, etc.):
✅ Ejecutar workflow manual de documentación
✅ Generar docs API según tu lenguaje
✅ Deploy automático a GitHub Pages
```

### Ventajas
- ✅ **Lo mejor de ambos mundos**
- ✅ **No genera docs en cada commit** (innecesario)
- ✅ **Control total sobre cuándo documentar**
- ✅ **Bajo overhead durante desarrollo**

---

## 📚 Documentación API On-Demand

### Setup: Workflow Manual con Detección Automática

```yaml
# .github/workflows/docs-api.yml
name: Generate API Documentation

on:
  # Trigger manual desde GitHub UI
  workflow_dispatch:
    inputs:
      deploy_to_pages:
        description: 'Deploy to GitHub Pages?'
        required: true
        default: 'true'
        type: boolean
  
  # O automático en releases
  release:
    types: [published]
  
  # O automático en tags
  push:
    tags:
      - 'v*'

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  detect-and-generate:
    runs-on: ubuntu-latest
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      # ═══════════════════════════════════════════════════════════
      # DETECCIÓN AUTOMÁTICA DE LENGUAJE
      # ═══════════════════════════════════════════════════════════
      - name: Detect Language
        id: detect
        run: |
          if [ -f "package.json" ]; then
            echo "language=typescript" >> $GITHUB_OUTPUT
            echo "📦 TypeScript/JavaScript detectado"
          elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
            echo "language=python" >> $GITHUB_OUTPUT
            echo "🐍 Python detectado"
          elif [ -f "go.mod" ]; then
            echo "language=go" >> $GITHUB_OUTPUT
            echo "🐹 Go detectado"
          elif [ -f "build.gradle.kts" ] || [ -f "build.gradle" ]; then
            echo "language=java" >> $GITHUB_OUTPUT
            echo "☕ Java/Kotlin detectado"
          elif [ -f "Cargo.toml" ]; then
            echo "language=rust" >> $GITHUB_OUTPUT
            echo "🦀 Rust detectado"
          else
            echo "language=unknown" >> $GITHUB_OUTPUT
            echo "❌ Lenguaje no detectado"
            exit 1
          fi
      
      # ═══════════════════════════════════════════════════════════
      # TYPESCRIPT / JAVASCRIPT - TypeDoc
      # ═══════════════════════════════════════════════════════════
      - name: Setup Node
        if: steps.detect.outputs.language == 'typescript'
        uses: actions/setup-node@v4
        with:
          node-version: 20
      
      - name: Generate TypeScript Docs
        if: steps.detect.outputs.language == 'typescript'
        run: |
          # Instalar TypeDoc
          npm install -g typedoc
          
          # Generar docs
          typedoc \
            --out docs/api \
            --entryPointStrategy expand \
            --exclude "**/*.test.ts" \
            --exclude "**/*.spec.ts" \
            --excludePrivate \
            --theme default \
            src/
          
          echo "✅ TypeDoc generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # PYTHON - Sphinx
      # ═══════════════════════════════════════════════════════════
      - name: Setup Python
        if: steps.detect.outputs.language == 'python'
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      
      - name: Generate Python Docs
        if: steps.detect.outputs.language == 'python'
        run: |
          # Instalar Sphinx y tema
          pip install sphinx sphinx-rtd-theme sphinx-autodoc-typehints
          
          # Crear estructura si no existe
          if [ ! -d "docs" ]; then
            sphinx-quickstart docs \
              --project="API Documentation" \
              --author="Auto-generated" \
              --release="1.0" \
              --language="en" \
              --sep \
              --ext-autodoc \
              --ext-viewcode \
              --no-batchfile
          fi
          
          # Generar documentación automática
          sphinx-apidoc -o docs/source app/
          
          # Build HTML
          sphinx-build -b html docs/source docs/api
          
          echo "✅ Sphinx generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # GO - pkgsite (Go's official doc server)
      # ═══════════════════════════════════════════════════════════
      - name: Setup Go
        if: steps.detect.outputs.language == 'go'
        uses: actions/setup-go@v5
        with:
          go-version: '1.25'
      
      - name: Generate Go Docs
        if: steps.detect.outputs.language == 'go'
        run: |
          # Instalar pkgsite
          go install golang.org/x/pkgsite/cmd/pkgsite@latest
          
          # Generar documentación estática
          mkdir -p docs/api
          
          # Extraer docs en formato HTML
          pkgsite -http=:6060 &
          PKGSITE_PID=$!
          sleep 5
          
          # Descargar páginas HTML (ejemplo para módulo principal)
          MODULE_NAME=$(go list -m)
          wget -r -np -nH --cut-dirs=1 -P docs/api http://localhost:6060/$MODULE_NAME
          
          kill $PKGSITE_PID
          
          echo "✅ Go docs generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # JAVA/KOTLIN - Dokka
      # ═══════════════════════════════════════════════════════════
      - name: Setup Java
        if: steps.detect.outputs.language == 'java'
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '25'
      
      - name: Generate Java/Kotlin Docs
        if: steps.detect.outputs.language == 'java'
        run: |
          # Asegurar que Dokka está en build.gradle.kts
          if ! grep -q "dokka" build.gradle.kts; then
            echo "⚠️  Dokka no configurado. Agregando plugin..."
            sed -i '1i id("org.jetbrains.dokka") version "1.9.20"' build.gradle.kts
          fi
          
          # Generar docs
          ./gradlew dokkaHtml
          
          # Mover a docs/api
          mkdir -p docs/api
          cp -r build/dokka/html/* docs/api/
          
          echo "✅ Dokka generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # RUST - rustdoc
      # ═══════════════════════════════════════════════════════════
      - name: Setup Rust
        if: steps.detect.outputs.language == 'rust'
        uses: dtolnay/rust-toolchain@stable
      
      - name: Generate Rust Docs
        if: steps.detect.outputs.language == 'rust'
        run: |
          # Generar docs
          cargo doc --no-deps --document-private-items
          
          # Mover a docs/api
          mkdir -p docs/api
          cp -r target/doc/* docs/api/
          
          echo "✅ Rustdoc generado en docs/api"
      
      # ═══════════════════════════════════════════════════════════
      # CREAR INDEX.HTML PERSONALIZADO
      # ═══════════════════════════════════════════════════════════
      - name: Create Custom Index
        run: |
          cat > docs/index.html << 'EOF'
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>API Documentation</title>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
              }
              .container {
                background: white;
                border-radius: 20px;
                padding: 60px;
                max-width: 600px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center;
              }
              h1 {
                font-size: 3em;
                margin-bottom: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
              }
              p {
                color: #666;
                font-size: 1.2em;
                margin-bottom: 40px;
              }
              .btn {
                display: inline-block;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 40px;
                border-radius: 50px;
                text-decoration: none;
                font-weight: 600;
                transition: transform 0.3s, box-shadow 0.3s;
                font-size: 1.1em;
              }
              .btn:hover {
                transform: translateY(-3px);
                box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
              }
              .meta {
                margin-top: 40px;
                padding-top: 40px;
                border-top: 1px solid #eee;
                color: #999;
                font-size: 0.9em;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>📚 API Documentation</h1>
              <p>Documentación completa generada automáticamente</p>
              <a href="./api/index.html" class="btn">Ver Documentación →</a>
              <div class="meta">
                <p>Generado el: $(date '+%Y-%m-%d %H:%M:%S')</p>
                <p>Commit: $(git rev-parse --short HEAD)</p>
              </div>
            </div>
          </body>
          </html>
          EOF
          
          echo "✅ Index personalizado creado"
      
      # ═══════════════════════════════════════════════════════════
      # DEPLOY A GITHUB PAGES
      # ═══════════════════════════════════════════════════════════
      - name: Deploy to GitHub Pages
        if: inputs.deploy_to_pages == 'true' || github.event_name == 'release'
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs
          cname: docs.tudominio.com  # Opcional: custom domain
      
      # ═══════════════════════════════════════════════════════════
      # COMMIT DOCS AL REPO (OPCIONAL)
      # ═══════════════════════════════════════════════════════════
      - name: Commit Docs to Repo
        if: inputs.deploy_to_pages == 'false'
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/
          git commit -m "docs: update API documentation [skip ci]" || echo "No changes"
          git push
      
      - name: Summary
        run: |
          echo "## 📚 Documentación Generada" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          echo "✅ Lenguaje detectado: **${{ steps.detect.outputs.language }}**" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY
          
          if [ "${{ inputs.deploy_to_pages }}" == "true" ]; then
            echo "🌐 Documentación desplegada en: https://${{ github.repository_owner }}.github.io/${{ github.event.repository.name }}/" >> $GITHUB_STEP_SUMMARY
          else
            echo "📁 Documentación guardada en el branch gh-pages" >> $GITHUB_STEP_SUMMARY
          fi
```

---

## 🎮 Cómo Usar el Modo Híbrido

### Durante el Desarrollo (Diario)

```bash
# 1. Trabajar normalmente con commits convencionales
git commit -m "feat(api): add user endpoint"
git commit -m "test(api): add user tests"
git commit -m "fix(db): resolve connection issue"

# 2. Push a main
git push origin main

# 3. Release Please genera changelog automáticamente ✅
# Sin generar docs API (innecesario en cada commit)
```

### Cuando Quieras Documentar (On-Demand)

**Opción 1: Manual desde GitHub UI**
```
1. Ve a tu repo en GitHub
2. Actions tab
3. "Generate API Documentation" workflow
4. Click "Run workflow"
5. Selecciona "Deploy to GitHub Pages: true"
6. Run workflow
```

**Opción 2: Desde CLI con gh**
```bash
# Generar y desplegar docs
gh workflow run docs-api.yml -f deploy_to_pages=true

# Solo generar (sin deploy)
gh workflow run docs-api.yml -f deploy_to_pages=false
```

**Opción 3: Automático en Releases**
```bash
# Crear release tag
git tag v1.0.0
git push origin v1.0.0

# Workflow se ejecuta automáticamente:
# 1. Genera docs API
# 2. Deploy a GitHub Pages
```

---

## 🔧 Configuración de GitHub Pages

### Setup Inicial (Solo una vez)

```bash
# 1. En tu repo de GitHub
# Settings > Pages

# 2. Source
Source: Deploy from a branch
Branch: gh-pages / (root)

# 3. Save

# 4. Tu documentación estará en:
# https://usuario.github.io/repo-name/
```

### Custom Domain (Opcional)

```yaml
# En el workflow, descomentar:
cname: docs.tudominio.com

# Luego en GitHub Settings > Pages:
# Custom domain: docs.tudominio.com
```

---

## 📋 Configuración para cada Lenguaje

### TypeScript/JavaScript (TypeDoc)

**Agregar a package.json:**
```json
{
  "scripts": {
    "docs": "typedoc --out docs/api src/"
  },
  "devDependencies": {
    "typedoc": "^0.25.0"
  }
}
```

**typedoc.json (opcional):**
```json
{
  "entryPoints": ["src/index.ts"],
  "out": "docs/api",
  "theme": "default",
  "excludePrivate": true,
  "excludeExternals": true
}
```

### Python (Sphinx)

**docs/source/conf.py:**
```python
project = 'My API'
extensions = [
    'sphinx.ext.autodoc',
    'sphinx.ext.viewcode',
    'sphinx.ext.napoleon',
    'sphinx_autodoc_typehints',
]

html_theme = 'sphinx_rtd_theme'
```

### Go (pkgsite)

**go.mod debe estar configurado:**
```go
module github.com/usuario/repo

go 1.25
```

### Java/Kotlin (Dokka)

**Agregar a build.gradle.kts:**
```kotlin
plugins {
    id("org.jetbrains.dokka") version "1.9.20"
}

tasks.dokkaHtml.configure {
    outputDirectory.set(file("docs/api"))
}
```

### Rust (rustdoc)

**Cargo.toml:**
```toml
[package]
name = "my-api"
version = "0.1.0"
documentation = "https://usuario.github.io/repo/"

[lib]
name = "my_api"
path = "src/lib.rs"
```

---

## 📊 Comparativa de Workflows

| Aspecto | Solo Simple | Solo Avanzado | **Híbrido** |
|---------|-------------|---------------|-------------|
| **Changelog** | Automático | Automático | ✅ Automático |
| **Docs API** | Manual | Cada commit | ✅ On-demand |
| **Overhead** | Bajo | Alto | ✅ Bajo |
| **Control** | Medio | Alto | ✅ Alto |
| **GitHub Pages** | No | Sí | ✅ Sí |
| **Recomendado para** | Proyectos pequeños | Proyectos públicos | ✅ **Solo devs** |

---

## 💡 Tips y Best Practices

### 1. Cuándo Generar Docs

```bash
✅ GENERAR:
- Antes de un release (v1.0.0, v2.0.0)
- Después de completar una feature grande
- Cuando vayas a compartir el repo públicamente
- Cada sprint/semana (si trabajas así)

❌ NO GENERAR:
- En cada commit
- Durante desarrollo activo
- En branches de feature
```

### 2. Badge en README

```markdown
## 📚 Documentación

[![Docs](https://img.shields.io/badge/docs-latest-blue.svg)](https://usuario.github.io/repo/)

[Ver documentación completa →](https://usuario.github.io/repo/)
```

### 3. Script Local

```bash
# scripts/generate-docs-local.sh
#!/bin/bash

if [ -f "package.json" ]; then
  npm run docs
elif [ -f "pyproject.toml" ]; then
  sphinx-build -b html docs/source docs/api
elif [ -f "go.mod" ]; then
  pkgsite -http=:6060
elif [ -f "build.gradle.kts" ]; then
  ./gradlew dokkaHtml
fi

echo "✅ Docs generados localmente en docs/api"
echo "🌐 Abre: file://$(pwd)/docs/api/index.html"
```

---

## 🎯 Resumen del Modo Híbrido

```
┌─────────────────────────────────────────────────────────────┐
│ DURANTE DESARROLLO (DIARIO)                                 │
├─────────────────────────────────────────────────────────────┤
│ git commit -m "feat: nueva feature"                         │
│ git push                                                     │
│ → Release Please genera CHANGELOG ✅                        │
│ → Sin generar docs API (rápido) ✅                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ CUANDO ESTÉS LISTO (ON-DEMAND)                              │
├─────────────────────────────────────────────────────────────┤
│ GitHub UI > Actions > "Generate API Documentation"          │
│ → Detecta lenguaje automáticamente ✅                       │
│ → Genera docs API ✅                                        │
│ → Deploy a GitHub Pages ✅                                  │
│ → https://usuario.github.io/repo/ 🌐                        │
└─────────────────────────────────────────────────────────────┘
```

**Perfecto para solo developers que quieren changelog automático sin el overhead de generar docs en cada commit!** 🚀

### Opción 1: Variables de Entorno

```yaml
# .github/workflows/main.yml
env:
  CHANGELOG_MODE: simple  # o 'advanced'
  DOCS_MODE: simple       # o 'advanced'

jobs:
  release:
    if: env.CHANGELOG_MODE == 'simple'
    # ... usar Release Please
  
  release-advanced:
    if: env.CHANGELOG_MODE == 'advanced'
    # ... usar Git Cliff
```

### Opción 2: Archivo de Configuración

```yaml
# .solo-dev/config.yml
features:
  changelog:
    enabled: true
    mode: simple  # 'simple' | 'advanced'
  
  documentation:
    enabled: true
    mode: simple  # 'simple' | 'advanced'
    ai:
      provider: gemini  # 'gemini' | 'openai' | 'anthropic'
      auto_readme: true
      auto_api_docs: true
```

**Script para leer config:**
```bash
# scripts/read-config.sh
#!/bin/bash

CONFIG_FILE=".solo-dev/config.yml"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "simple"  # Default
  exit 0
fi

# Usar yq para parsear YAML (o Python/Node)
CHANGELOG_MODE=$(yq eval '.features.changelog.mode' "$CONFIG_FILE")
echo "$CHANGELOG_MODE"
```

**En GitHub Actions:**
```yaml
- name: Read Config
  id: config
  run: |
    mode=$(bash scripts/read-config.sh)
    echo "changelog_mode=$mode" >> $GITHUB_OUTPUT

- name: Release Please (Simple)
  if: steps.config.outputs.changelog_mode == 'simple'
  uses: googleapis/release-please-action@v4

- name: Git Cliff (Advanced)
  if: steps.config.outputs.changelog_mode == 'advanced'
  run: git-cliff -o CHANGELOG.md
```

---

## 🔑 Setup de Gemini API (Gratuita)

### 1. Obtener API Key

```bash
# 1. Ve a https://makersuite.google.com/app/apikey
# 2. Crea un nuevo API key
# 3. Copia la key
```

### 2. Agregar a GitHub Secrets

```bash
# En tu repo de GitHub:
# Settings > Secrets and variables > Actions > New repository secret

Name: GEMINI_API_KEY
Value: [tu-api-key]
```

### 3. Límites Gratuitos de Gemini

```
Gemini 1.5 Flash (Gratis):
✅ 15 requests por minuto
✅ 1 millón de tokens por minuto
✅ 1500 requests por día

Suficiente para:
- Generar README cada push
- Actualizar docs automáticamente
- Analizar codebase completo
```

---

## 📊 Comparativa: Simple vs Avanzado vs Híbrido

| Característica | Simple (Release Please) | Avanzado (Git Cliff + AI) | **Híbrido (Recomendado)** |
|----------------|------------------------|---------------------------|---------------------------|
| **Setup** | 1 archivo YAML | Múltiples archivos | 2 archivos YAML |
| **Changelog** | Automático básico | Formato 100% personalizable | ✅ Automático básico |
| **Docs API** | No incluido | Cada commit | ✅ On-demand manual |
| **Versionado** | Semver automático | Manual o automático | ✅ Semver automático |
| **README AI** | No | Automático | Opcional (manual) |
| **GitHub Pages** | No | Sí | ✅ Sí (on-demand) |
| **Overhead** | Bajo | Alto | ✅ Bajo |
| **Control** | Medio | Alto | ✅ Alto |
| **Costo** | Gratis | Gratis (con Gemini) | ✅ Gratis |
| **Mantenimiento** | Bajo | Medio | ✅ Bajo |
| **Ideal para** | Proyectos simples | Proyectos públicos complejos | ✅ **Solo developers** |

---

## 🚀 Recomendación

### ⭐ Empieza con Híbrido (Lo mejor de ambos mundos)

```yaml
# Setup inicial (5 minutos)
1. Release Please para changelog ✅
2. Workflow de docs on-demand ✅
3. Deploy a GitHub Pages cuando quieras ✅

# Uso diario
- Commits convencionales
- Push a main
- CHANGELOG automático
- Sin overhead de docs

# Cuando quieras documentar
- Click en "Run workflow"
- Docs generados en 2-3 min
- Deploy automático a GitHub Pages
```

---

## 💡 Tips

1. **Commitizen**: Helper para commits convencionales
```bash
npm install -g commitizen
commitizen init cz-conventional-changelog --save-dev --save-exact

# Usar
git cz
```

2. **Husky**: Validar commits antes de commit
```bash
npm install --save-dev husky
npx husky init
echo "npx --no -- commitlint --edit \$1" > .husky/commit-msg
```

3. **VSCode Extension**: Conventional Commits
```json
// .vscode/extensions.json
{
  "recommendations": [
    "vivaxy.vscode-conventional-commits"
  ]
}
```

### Documentación Oficial

**JavaScript/TypeScript:**
- **Biome:** https://biomejs.dev
- **Bun:** https://bun.sh/docs
- **Turborepo:** https://turbo.build/repo/docs

**Python:**
- **uv:** https://github.com/astral-sh/uv
- **FastAPI:** https://fastapi.tiangolo.com
- **Ruff:** https://docs.astral.sh/ruff

**Java:**
- **Gradle:** https://docs.gradle.org
- **Kotlin:** https://kotlinlang.org/docs
- **Spring Boot 4:** https://spring.io/projects/spring-boot
- **Spotless:** https://github.com/diffplug/spotless
- **Java 25 Release Notes:** https://openjdk.org/projects/jdk/25/

**Go:**
- **Go 1.25 Docs:** https://go.dev/doc/go1.25
- **Gin Framework:** https://gin-gonic.com/docs
- **Air (hot reload):** https://github.com/air-verse/air
- **golangci-lint:** https://golangci-lint.run

**Otros:**
- **Hono (Bun framework):** https://hono.dev
- **Docker Compose:** https://docs.docker.com/compose

### Comparativas (Por qué Stack Moderno)

#### Biome vs ESLint+Prettier (JavaScript/TypeScript)
```
Lint 10,000 archivos TypeScript:
ESLint + Prettier:  45s
Biome:              0.4s  (100x más rápido)

Instalación:
ESLint + Prettier:  npm install eslint @typescript-eslint/* prettier eslint-config-prettier eslint-plugin-prettier
Biome:              bun add --dev @biomejs/biome

Configuración:
ESLint + Prettier:  .eslintrc.js + .prettierrc + 15 líneas de config
Biome:              biome.json con 10 líneas
```

#### Bun vs npm (JavaScript/TypeScript)
```
Install 300 packages:
npm:     45s
pnpm:    22s
bun:     4s   (10x más rápido que npm)

Test runner:
npm:     Requiere Jest/Vitest
bun:     Integrado (bun test)

TypeScript:
npm:     Requiere ts-node o compilación
bun:     Ejecuta .ts directamente
```

#### Gradle (Kotlin DSL) vs Maven (Java)
```
Build proyecto con 50 módulos:
Maven:           150s
Gradle (Groovy): 60s
Gradle (Kotlin): 45s   (3x más rápido que Maven)

Configuración:
Maven:   XML verboso, limitado
Gradle:  Kotlin DSL, type-safe, programable

Caché:
Maven:   Básico
Gradle:  Incremental builds + build cache + dependency cache
```

#### Go 1.25+ vs versiones antiguas
```
Ventajas de Go 1.25+:
✅ Generics nativos (desde 1.18)
✅ JSON v2 experimental (GOEXPERIMENT=jsonv2)
✅ Better error handling
✅ Improved performance (2-3% faster than 1.24)
✅ DWARF 5 debug info (binarios más pequeños)
✅ Built-in fuzzing
✅ Workspace mode para monorepos
✅ New WaitGroup.Go() method

golangci-lint vs linters separados:
Múltiples linters:  go vet && golint && staticcheck && ... (5+ comandos)
golangci-lint:      golangci-lint run (1 comando, 50+ linters)
Tiempo:             5x más rápido
```

#### uv vs pip (Python)
```
Install 100 packages:
pip:     120s
poetry:  45s
uv:      4s   (30x más rápido que pip)

Resolución de dependencias:
pip:     Lenta, a veces falla
uv:      Rápida, determinística
```

---

## 🎯 Cuándo Usar Este Agente

### ✅ USA este agente si:
- Eres **un solo desarrollador**
- Inicias **proyectos desde cero**
- Quieres **las mejores prácticas modernas** (Biome, Bun, Docker)
- Prefieres **merge rápido** sobre PRs acumulados
- Trabajas en **proyectos complejos** (monorepos, multi-stack)
- Usas o quieres usar **Turborepo** para monorepos

### ❌ NO uses este agente si:
- Trabajas en **equipo** (necesitas code review humano)
- Mantienes **proyectos legacy** (con ESLint/npm ya configurado)
- Tu proyecto es **muy simple** (un script, no necesita CI/CD)
- Prefieres **herramientas tradicionales** (npm, ESLint)

---

## 🚀 Inicio Rápido (Progressive Setup)

### Filosofía: 3 Fases Progresivas

```
Fase MVP (15 min):    SQLite + Mise → Código funcionando ✅
Fase Alpha (1h):      PostgreSQL + Docker + CI
Fase Beta (2-3h):     Monitoring + Deploy + Production
```

---

## 🎯 FASE 1: MVP (5-15 minutos)

**Objetivo:** Código funcionando LO MÁS RÁPIDO POSIBLE

### Paso 1: Instalar Mise (una sola vez)

```bash
# Homebrew (macOS/Linux) - RECOMENDADO
brew install mise

# O script oficial
curl https://mise.run | sh

# Activar en tu shell
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc

# Verificar
mise --version
mise doctor
```

### Paso 2: Setup MVP del Proyecto

```bash
cd mi-proyecto

# Ejecutar setup MVP automático
mise run setup:mvp

# O manual:
# 1. Definir versiones
mise use node@20           # TypeScript/JavaScript
mise use python@3.12       # Python
mise use go@1.22           # Go
mise use java@temurin-21   # Java/Kotlin

# 2. Instalar versiones
mise install

# 3. Crear .env mínimo (SQLite, sin Docker)
cat > .env << EOF
DATABASE_URL=sqlite:///dev.db
NODE_ENV=development
LOG_LEVEL=debug
JWT_SECRET=dev-secret-change-in-production
EOF

# 4. Instalar dependencias
mise run install

# 5. Setup git hooks
mise hook-env

# 6. Inicializar DB (SQLite local)
touch dev.db

echo "✅ MVP Setup Complete!"
echo "🎉 Listo para codear! → mise run dev"
```

### Verificar Setup

```bash
# Ver contexto del proyecto
mise run context

# Output:
{
  "phase": "mvp",
  "tools": { "node": "20.11.0" },
  "database": { "connection": "ok" }
}
```

### Comandos MVP

```bash
mise run dev      # Iniciar servidor
mise run test     # Correr tests
mise run lint     # Lint código
mise run context  # Ver estado
```

**⏱️ Tiempo total: 5-15 minutos**

**✅ Ya puedes empezar a codear!**

---

## 🚀 FASE 2: Alpha (1 hora)

**Objetivo:** Entorno profesional con PostgreSQL + Docker + CI

**Cuándo:** Cuando tu proyecto crece y necesitas DB real

### Paso 1: Ejecutar Upgrade a Alpha

```bash
# Automático
mise run setup:alpha

# O manual (ver abajo)
```

### Paso 2: Setup Manual (si prefieres control)

```bash
# 1. Crear Docker Compose
cat > docker-compose.yml << 'EOF'
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
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
EOF

# 2. Iniciar servicios
mise run docker:up
sleep 5

# 3. Actualizar .env
sed -i 's|sqlite:///dev.db|postgresql://postgres:postgres@localhost:5432/mydb|' .env

# 4. Aplicar migraciones
mise run db:migrate

# 5. Setup CI básico
mkdir -p .github/workflows

cat > .github/workflows/ci.yml << 'EOF'
name: CI

on:
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Mise
        run: |
          curl https://mise.run | sh
          eval "$(mise activate bash)"
      
      - run: mise install
      - run: mise run install
      - run: mise run test
      - run: mise run build
EOF

echo "✅ Alpha Setup Complete!"
```

### Configurar Branch Protection

```
GitHub > Settings > Branches > Add rule para "develop"

✅ Require pull request before merging
✅ Require approvals: 0 (no reviewers para solo dev)
✅ Require status checks to pass
   └─ CI tests
✅ Allow auto-merge
✅ Require linear history (recomendado)
```

**⏱️ Tiempo total: ~1 hora**

**✅ Ahora tienes entorno profesional!**

---

## 🎯 FASE 3: Beta (2-3 horas)

**Objetivo:** Production-ready con monitoring y deploy

**Cuándo:** Cuando quieres deployar a producción

### Paso 1: Ejecutar Upgrade a Beta

```bash
mise run setup:beta
```

### Paso 2: Elegir Plataforma de Deploy

```bash
echo "Choose deployment platform:"
echo "  1) Koyeb     - Global edge, free tier generoso"
echo "  2) Railway   - Lo más simple"
echo "  3) Coolify   - Self-hosted"
read -p "Choice [1-3]: " choice
```

#### Opción 1: Koyeb (Recomendado)

```bash
# Instalar CLI
curl -fsSL https://koyeb-cli.s3.amazonaws.com/install.sh | bash

# Login
koyeb login

# Deploy
koyeb app create my-api \
  --git github.com/user/repo \
  --git-branch main \
  --regions fra,was

# Agregar secrets
koyeb secret create DATABASE_URL --value "postgresql://..."
koyeb secret create JWT_SECRET --value "your-secret"
```

#### Opción 2: Railway

```bash
# Instalar CLI
npm install -g @railway/cli

# Login y deploy
railway login
railway init
railway add  # Agregar PostgreSQL
railway up
```

### Paso 3: Setup Monitoring

```bash
# 1. Error tracking (Sentry)
bun add @sentry/node

# 2. Logs estructurados
bun add pino

# 3. Metrics
# (Ver sección de Monitoring más adelante)
```

### Comandos de Producción

```bash
mise run deploy        # Deploy a plataforma configurada
mise run logs          # Ver logs de producción
mise run db:url        # Get DATABASE_URL
mise run secrets:list  # Listar secrets
```

**⏱️ Tiempo total: 2-3 horas**

**✅ Producción lista!**

---

## 📊 Comparación de Fases

| Aspecto | MVP | Alpha | Beta |
|---------|-----|-------|------|
| **Tiempo setup** | 15 min | 1 hora | 2-3 horas |
| **Database** | SQLite | PostgreSQL | PostgreSQL (producción) |
| **Docker** | ❌ | ✅ | ✅ |
| **CI/CD** | ❌ | ✅ Básico | ✅ Completo |
| **Deploy** | Local | Local | ✅ Cloud |
| **Monitoring** | Console | Console | ✅ Sentry + Logs |
| **Secrets** | .env | .env | ✅ Vault |

---

## 🎯 Workflow Recomendado

```bash
# DÍA 1: Empezar rápido
mise run setup:mvp
# → 15 minutos → Código funcionando

# SEMANA 1-2: Cuando crece
mise run setup:alpha  
# → 1 hora → Entorno profesional

# MES 1: Cuando quieres deployar
mise run setup:beta
# → 2-3 horas → Production ready
```

---

## 🔧 Comandos Universales (Todas las Fases)

```bash
# Desarrollo
mise run dev           # Start dev server
mise run test          # Run tests
mise run lint          # Check code quality
mise run format        # Auto-fix formatting

# Context (para Claude Code)
mise run context       # Ver estado completo

# Database
mise run db:migrate    # Apply migrations
mise run db:studio     # Open DB GUI

# Auto-fix
mise run fix:auto      # Auto-fix errores comunes

# Git
git commit -m "feat: nueva feature"
# → Pre-commit hooks corren automáticamente
```

---

## 🆘 Si Algo Falla

### Tests fallan

```bash
# Auto-fix intenta resolver
mise run fix:tests

# O manual
rm -rf .cache coverage
mise run test
```

### Lint falla

```bash
mise run fix:lint
# O
mise run format
```

### Database no conecta

```bash
mise run fix:database
# O
mise run docker:up
sleep 5
mise run db:migrate
```

---

## 👥 Onboarding de Nuevo Developer

```bash
# 1. Clonar repo
git clone repo
cd repo

# 2. Setup automático (según fase del proyecto)
mise run setup:mvp    # O setup:alpha, setup:beta

# 3. Listo!
mise run dev

# ✨ Sin configurar nvm, pyenv, docker manualmente
```

---

## 🎯 Progressive Disclosure - Setup en Fases

### Filosofía: No Abrumar al Inicio

**Problema del setup tradicional:**
```
Día 1: Instalar 15 herramientas     → 3 horas
       Configurar Docker            → 1 hora
       Setup CI/CD                  → 1 hora
       Configurar monitoring        → 30 min
       Setup secrets                → 30 min
       ═══════════════════════════════════════
       Total: 6 horas antes de escribir código ❌
```

**Con Progressive Disclosure:**
```
MVP (15 min):   ✅ mise + SQLite → Código funcionando
Alpha (1h):     ✅ PostgreSQL + CI básico
Beta (2-3h):    ✅ Monitoring + Deploy en producción
```

---

## 📦 FASE 1: MVP - Speedrun (5-15 minutos) ⭐ START HERE

### Objetivo: Código Funcionando AHORA

```bash
#!/bin/bash
# scripts/setup-mvp.sh

echo "🚀 Solo Dev Setup - MVP (5-15 minutos)"
echo ""

# ═══════════════════════════════════════════════════════════
# 1. INSTALAR MISE (si no está instalado)
# ═══════════════════════════════════════════════════════════
if ! command -v mise &> /dev/null; then
  echo "📦 Installing Mise..."
  
  if command -v brew &> /dev/null; then
    brew install mise
  else
    curl https://mise.run | sh
  fi
  
  echo 'eval "$(mise activate bash)"' >> ~/.bashrc
  source ~/.bashrc
  
  echo "✅ Mise installed"
fi

# ═══════════════════════════════════════════════════════════
# 2. INSTALAR HERRAMIENTAS DEL PROYECTO
# ═══════════════════════════════════════════════════════════
echo ""
echo "📦 Installing project tools..."
mise install

# ═══════════════════════════════════════════════════════════
# 3. CREAR .ENV MÍNIMO (SQLite - SIN Docker)
# ═══════════════════════════════════════════════════════════
if [ ! -f .env ]; then
  cat > .env << 'EOF'
# ═══════════════════════════════════════════════════════════
# MVP Environment (SQLite Local - No Docker needed)
# ═══════════════════════════════════════════════════════════
DATABASE_URL=sqlite:///dev.db
NODE_ENV=development
LOG_LEVEL=debug
PORT=8080

# Secrets (cambiar en producción)
JWT_SECRET=dev-secret-change-me-in-production

# External APIs (opcional - dejar vacío si no usas)
API_KEY=
STRIPE_SECRET_KEY=
SENDGRID_API_KEY=
EOF
  echo "✅ Created .env with SQLite"
else
  echo "⚠️  .env already exists, skipping"
fi

# ═══════════════════════════════════════════════════════════
# 4. INICIALIZAR SQLite (archivo local)
# ═══════════════════════════════════════════════════════════
echo ""
echo "🗄️ Initializing SQLite database..."
touch dev.db
echo "✅ SQLite database created: dev.db"

# ═══════════════════════════════════════════════════════════
# 5. INSTALAR DEPENDENCIAS DEL PROYECTO
# ═══════════════════════════════════════════════════════════
echo ""
echo "📦 Installing project dependencies..."
mise run install

# ═══════════════════════════════════════════════════════════
# 6. SETUP GIT HOOKS BÁSICOS
# ═══════════════════════════════════════════════════════════
echo ""
echo "🎣 Setting up git hooks..."
mise hook-env

# ═══════════════════════════════════════════════════════════
# 7. CREAR SCRIPTS FOLDER
# ═══════════════════════════════════════════════════════════
mkdir -p scripts

# ═══════════════════════════════════════════════════════════
# DONE!
# ═══════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║  ✅ MVP Setup Complete!                            ║"
echo "╠════════════════════════════════════════════════════╣"
echo "║  🎉 Ready to code!                                 ║"
echo "║                                                    ║"
echo "║  Run: mise run dev                                 ║"
echo "║                                                    ║"
echo "║  Database: SQLite (dev.db)                         ║"
echo "║  No Docker needed                                  ║"
echo "║  No CI/CD yet                                      ║"
echo "║                                                    ║"
echo "║  ⏭️  Next step:                                     ║"
echo "║  When ready, run: ./scripts/setup-alpha.sh        ║"
echo "║  (Upgrades to PostgreSQL + CI)                     ║"
echo "╚════════════════════════════════════════════════════╝"
```

**Tiempo total: 5-15 minutos ✅**

### Qué Incluye el MVP

```
✅ Mise instalado y configurado
✅ Herramientas del stack (node/python/go)
✅ SQLite local (sin Docker)
✅ .env con configuración básica
✅ Git hooks funcionando
✅ Dependencias instaladas
✅ Listo para: mise run dev

❌ Docker (no necesario aún)
❌ PostgreSQL (SQLite es suficiente)
❌ CI/CD (manual testing está OK)
❌ Monitoring (overkill para MVP)
```

---

## 🚀 FASE 2: Alpha - Full Dev Environment (1 hora)

### Objetivo: PostgreSQL + CI/CD + Docker

```bash
#!/bin/bash
# scripts/setup-alpha.sh

echo "🚀 Solo Dev Setup - Alpha (1 hora)"
echo ""
echo "Upgrading from MVP to Alpha..."
echo "  ✅ Docker Compose"
echo "  ✅ PostgreSQL"
echo "  ✅ Migraciones"
echo "  ✅ CI/CD básico"
echo ""

# ═══════════════════════════════════════════════════════════
# 1. SETUP DOCKER COMPOSE
# ═══════════════════════════════════════════════════════════
echo "🐳 Setting up Docker Compose..."

if [ ! -f docker-compose.yml ]; then
  cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  db:
    image: postgres:16-alpine
    container_name: ${PROJECT_NAME:-myapp}-db
    environment:
      POSTGRES_DB: ${DB_NAME:-mydb}
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
  
  redis:
    image: redis:7-alpine
    container_name: ${PROJECT_NAME:-myapp}-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
EOF
  echo "✅ Created docker-compose.yml"
else
  echo "⚠️  docker-compose.yml already exists"
fi

# ═══════════════════════════════════════════════════════════
# 2. INICIAR DOCKER CONTAINERS
# ═══════════════════════════════════════════════════════════
echo ""
echo "🚀 Starting Docker containers..."
mise run docker:up

echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 5

# Verificar que PostgreSQL está listo
until docker exec $(docker ps -q -f name=db) pg_isready -U postgres > /dev/null 2>&1; do
  echo "  Waiting..."
  sleep 2
done

echo "✅ PostgreSQL is ready"

# ═══════════════════════════════════════════════════════════
# 3. ACTUALIZAR .env A POSTGRESQL
# ═══════════════════════════════════════════════════════════
echo ""
echo "🔄 Updating .env to use PostgreSQL..."

# Backup .env
cp .env .env.mvp.backup

# Actualizar DATABASE_URL
sed -i.bak 's|DATABASE_URL=sqlite:///dev.db|DATABASE_URL=postgresql://postgres:postgres@localhost:5432/mydb|' .env

# Agregar REDIS_URL si no existe
if ! grep -q "REDIS_URL" .env; then
  echo "REDIS_URL=redis://localhost:6379" >> .env
fi

rm .env.bak

echo "✅ .env updated (backup: .env.mvp.backup)"

# ═══════════════════════════════════════════════════════════
# 4. APLICAR MIGRACIONES
# ═══════════════════════════════════════════════════════════
echo ""
echo "🗄️ Running database migrations..."
sleep 2

if mise run db:migrate 2>/dev/null; then
  echo "✅ Migrations applied"
else
  echo "⚠️  No migrations found or migration command not configured"
  echo "   Run manually: mise run db:migrate"
fi

# ═══════════════════════════════════════════════════════════
# 5. SETUP CI/CD BÁSICO
# ═══════════════════════════════════════════════════════════
echo ""
echo "🔧 Setting up GitHub Actions CI..."

mkdir -p .github/workflows

if [ ! -f .github/workflows/ci.yml ]; then
  cat > .github/workflows/ci.yml << 'EOF'
name: CI

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Bun
        if: hashFiles('package.json') != ''
        uses: oven-sh/setup-bun@v1
      
      - name: Setup Python
        if: hashFiles('pyproject.toml') != ''
        uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      
      - name: Setup Go
        if: hashFiles('go.mod') != ''
        uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      
      - name: Install dependencies
        run: |
          if [ -f "package.json" ]; then
            bun install
          elif [ -f "pyproject.toml" ]; then
            pip install uv && uv sync
          elif [ -f "go.mod" ]; then
            go mod download
          fi
      
      - name: Run tests
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/testdb
        run: |
          if [ -f "package.json" ]; then
            bun test
          elif [ -f "pyproject.toml" ]; then
            pytest
          elif [ -f "go.mod" ]; then
            go test ./...
          fi
      
      - name: Run linter
        run: |
          if [ -f "biome.json" ]; then
            bunx @biomejs/biome check .
          elif [ -f "pyproject.toml" ]; then
            ruff check .
          elif [ -f ".golangci.yml" ]; then
            golangci-lint run
          fi
EOF
  echo "✅ Created .github/workflows/ci.yml"
else
  echo "⚠️  CI workflow already exists"
fi

# ═══════════════════════════════════════════════════════════
# 6. CREAR .dockerignore
# ═══════════════════════════════════════════════════════════
if [ ! -f .dockerignore ]; then
  cat > .dockerignore << 'EOF'
node_modules
.git
.github
dist
build
target
*.log
.env
.env.*
!.env.example
coverage
.pytest_cache
__pycache__
*.pyc
EOF
  echo "✅ Created .dockerignore"
fi

# ═══════════════════════════════════════════════════════════
# DONE!
# ═══════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║  ✅ Alpha Setup Complete!                          ║"
echo "╠════════════════════════════════════════════════════╣"
echo "║  Services running:                                 ║"
echo "║    • PostgreSQL (localhost:5432)                   ║"
echo "║    • Redis (localhost:6379)                        ║"
echo "║                                                    ║"
echo "║  CI/CD configured:                                 ║"
echo "║    • .github/workflows/ci.yml                      ║"
echo "║                                                    ║"
echo "║  📋 Manual steps:                                  ║"
echo "║    1. Go to GitHub > Settings > Branches           ║"
echo "║    2. Add protection rule for 'develop'            ║"
echo "║    3. Enable:                                      ║"
echo "║       - Require status checks (CI)                 ║"
echo "║       - Allow auto-merge                           ║"
echo "║                                                    ║"
echo "║  ⏭️  Next step:                                     ║"
echo "║  When ready, run: ./scripts/setup-beta.sh         ║"
echo "║  (Adds monitoring + production deploy)             ║"
echo "╚════════════════════════════════════════════════════╝"
```

**Tiempo total: 1 hora ✅**

---

## 🎖️ FASE 3: Beta - Production Ready (2-3 horas)

### Objetivo: Monitoring + Deploy + Secrets Management

```bash
#!/bin/bash
# scripts/setup-beta.sh

echo "🚀 Solo Dev Setup - Beta (2-3 horas)"
echo ""
echo "Upgrading from Alpha to Beta (Production-Ready)..."
echo ""

# ═══════════════════════════════════════════════════════════
# 1. ELEGIR PLATAFORMA DE DEPLOYMENT
# ═══════════════════════════════════════════════════════════
echo "☁️  Choose deployment platform:"
echo ""
echo "  1) Koyeb    - Global edge + free tier (Recommended)"
echo "  2) Railway  - Simple + affordable ($5-20/mes)"
echo "  3) Coolify  - Self-hosted PaaS ($5/mes)"
echo "  4) Render   - Alternative to Railway"
echo "  5) Skip     - Configure manually later"
echo ""
read -p "Enter choice [1-5]: " deploy_choice

case $deploy_choice in
  1)
    echo "Setting up Koyeb..."
    mise run deploy:setup:koyeb
    ;;
  2)
    echo "Setting up Railway..."
    mise run deploy:setup:railway
    ;;
  3)
    echo "Setting up Coolify..."
    mise run deploy:setup:coolify
    ;;
  4)
    echo "Setting up Render..."
    mise run deploy:setup:render
    ;;
  5)
    echo "Skipping deployment setup"
    ;;
  *)
    echo "Invalid choice, skipping"
    ;;
esac

# ═══════════════════════════════════════════════════════════
# 2. SETUP ERROR TRACKING (Sentry)
# ═══════════════════════════════════════════════════════════
echo ""
echo "📊 Setup error tracking? (Sentry)"
read -p "Install Sentry? [y/N]: " sentry_choice

if [[ $sentry_choice =~ ^[Yy]$ ]]; then
  echo "Setting up Sentry..."
  
  if [ -f "package.json" ]; then
    bun add @sentry/node @sentry/profiling-node
  elif [ -f "pyproject.toml" ]; then
    uv add sentry-sdk
  elif [ -f "go.mod" ]; then
    go get github.com/getsentry/sentry-go
  fi
  
  echo "✅ Sentry SDK installed"
  echo "📋 Manual: Get DSN from https://sentry.io and add to .env"
fi

# ═══════════════════════════════════════════════════════════
# 3. SETUP SECRETS MANAGEMENT
# ═══════════════════════════════════════════════════════════
echo ""
echo "🔐 Setup secrets management?"
echo "  1) Doppler  - Cloud secrets (Recommended)"
echo "  2) Infisical - Open source alternative"
echo "  3) Manual   - Use .env files only"
read -p "Enter choice [1-3]: " secrets_choice

case $secrets_choice in
  1)
    echo "Install Doppler: brew install dopplerhq/cli/doppler"
    echo "Then run: doppler login && doppler setup"
    ;;
  2)
    echo "Install Infisical: brew install infisical/get-cli/infisical"
    echo "Then run: infisical login && infisical init"
    ;;
  3)
    echo "Using .env files (make sure they're in .gitignore)"
    ;;
esac

# ═══════════════════════════════════════════════════════════
# 4. CREAR HEALTH CHECKS
# ═══════════════════════════════════════════════════════════
echo ""
echo "🏥 Setting up health checks..."

# El código ya está en la sección de Monitoring del skill

echo "✅ Health check endpoints ready"
echo "   Test: curl http://localhost:8080/health"

# ═══════════════════════════════════════════════════════════
# DONE!
# ═══════════════════════════════════════════════════════════
echo ""
echo "╔════════════════════════════════════════════════════╗"
echo "║  ✅ Beta Setup Complete!                           ║"
echo "║  🎉 Your project is PRODUCTION-READY!              ║"
echo "╠════════════════════════════════════════════════════╣"
echo "║  Deployment configured                             ║"
echo "║  Error tracking ready                              ║"
echo "║  Secrets management configured                     ║"
echo "║  Health checks implemented                         ║"
echo "║                                                    ║"
echo "║  🚀 You can now:                                   ║"
echo "║    • Deploy: mise run deploy                       ║"
echo "║    • Monitor: Check your error tracking dashboard  ║"
echo "║    • Scale: Your platform handles it automatically ║"
echo "╚════════════════════════════════════════════════════╝"
```

---

## 🎮 Mise Tasks para Setup Progresivo

```toml
# .mise.toml - Agregar estas tasks

[tasks."setup:mvp"]
description = "Phase 1: MVP setup (5-15 min) - START HERE"
run = "bash scripts/setup-mvp.sh"

[tasks."setup:alpha"]
description = "Phase 2: Alpha setup (1 hour) - PostgreSQL + CI"
run = "bash scripts/setup-alpha.sh"

[tasks."setup:beta"]
description = "Phase 3: Beta setup (2-3 hours) - Production ready"
run = "bash scripts/setup-beta.sh"

[tasks.setup]
description = "Interactive setup wizard"
run = """
#!/usr/bin/env bash

clear
echo "╔════════════════════════════════════════════════════╗"
echo "║       🚀 Solo Dev Setup Wizard                     ║"
echo "╠════════════════════════════════════════════════════╣"
echo "║                                                    ║"
echo "║  Choose your setup phase:                          ║"
echo "║                                                    ║"
echo "║  1) MVP   - Quick start (5-15 min)                 ║"
echo "║     SQLite + Basic tools                           ║"
echo "║     Perfect for: Prototyping, learning             ║"
echo "║                                                    ║"
echo "║  2) Alpha - Full dev env (1 hour)                  ║"
echo "║     PostgreSQL + Docker + CI/CD                    ║"
echo "║     Perfect for: Serious projects                  ║"
echo "║                                                    ║"
echo "║  3) Beta  - Production (2-3 hours)                 ║"
echo "║     Monitoring + Deploy + Secrets                  ║"
echo "║     Perfect for: Launch-ready apps                 ║"
echo "║                                                    ║"
echo "║  4) Full  - All phases in sequence                 ║"
echo "║     MVP → Alpha → Beta (3-4 hours)                 ║"
echo "║                                                    ║"
echo "╚════════════════════════════════════════════════════╝"
echo ""
read -p "Enter choice [1-4]: " choice

case $choice in
  1)
    mise run setup:mvp
    ;;
  2)
    mise run setup:alpha
    ;;
  3)
    mise run setup:beta
    ;;
  4)
    echo "Running full setup..."
    mise run setup:mvp && \
    read -p "MVP complete. Continue to Alpha? [Y/n]: " cont && \
    [[ $cont =~ ^[Yy]?$ ]] && mise run setup:alpha && \
    read -p "Alpha complete. Continue to Beta? [Y/n]: " cont && \
    [[ $cont =~ ^[Yy]?$ ]] && mise run setup:beta
    ;;
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac
"""
```

---

## 🚀 Inicio Rápido con Mise (Modo Manual - Legacy)

### Paso 1: Instalar Mise (una sola vez en tu máquina)

```bash
# Homebrew (macOS/Linux) - RECOMENDADO
brew install mise

# O script oficial
curl https://mise.run | sh

# Activar en tu shell
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc
source ~/.zshrc

# Verificar
mise --version
mise doctor
```

### Paso 2: Setup del Proyecto

```bash
cd mi-proyecto

# Definir versiones según tu stack
mise use node@20           # TypeScript/JavaScript
mise use python@3.12       # Python
mise use go@1.22           # Go
mise use java@temurin-21   # Java/Kotlin

# Instalar versiones
mise install

# Verificar
mise current
```

### Paso 3: Crear .mise.toml (Config Universal)

```toml
# .mise.toml - Copiar el template completo de arriba
# Incluye: tools, tasks, hooks, env vars

[tools]
# Solo tus lenguajes
node = "20"

[tasks.dev]
run = "bun run dev"

[tasks.test]
run = "bun test"

[hooks.pre-commit]
run = "mise run lint && mise run test:changed"
```

### Paso 4: Activar Git Hooks

```bash
# Mise detecta .mise.toml y activa hooks automáticamente
mise hook-env

# Verificar que funciona
git commit -m "test: verificar hooks"
# → Debería correr lint y tests
```

### Paso 5: Configurar Feature Flags

```bash
mkdir -p .solo-dev
cat > .solo-dev/config.yml << EOF
features:
  mise: { enabled: true }
  pre_commit_hooks: { enabled: true }
  changelog: { enabled: true, mode: 'simple' }
  health_checks: { enabled: true }
  auto_rollback: { enabled: true }
EOF
```

### Paso 6: Copiar Scripts Universales

```bash
mkdir scripts
# Copiar scripts/test-changed.sh, scripts/lint.sh, scripts/dev.sh
chmod +x scripts/*.sh
```

### Paso 7: Configurar GitHub Branch Protection

```
GitHub Settings > Branches > Add rule > develop

✅ Require a pull request before merging
✅ Require approvals: 0 (no reviewers)
✅ Require status checks to pass
   └─ Status check: detect-and-test
✅ Allow auto-merge
❌ Require signed commits (opcional)
✅ Require linear history (recomendado)
```

### Paso 8: Copiar GitHub Actions

```bash
mkdir -p .github/workflows
# Copiar workflows: ci.yml, release-please.yml, docs-api.yml
```

### Paso 9: Workflow de Desarrollo

```bash
# Usar comandos de Mise en lugar de scripts
mise run dev           # En vez de ./scripts/dev.sh
mise run test          # En vez de ./scripts/test.sh
mise run lint          # En vez de ./scripts/lint.sh

# Desarrollo de features
git checkout -b feat/01-database-schema

# Commits con hooks automáticos
git commit -m "feat(db): add User model"
# → mise corre lint + tests automáticamente

git commit -m "feat(db): add migration"
git commit -m "test(db): add tests"

# Push y PR
git push origin feat/01-database-schema
gh pr create --title "feat(db): implement database schema"

# CI → Tests → Auto-merge con squash
```

### Paso 10: Onboarding de Nuevo Developer

```bash
# Nuevo developer solo necesita:

# 1. Instalar Mise
brew install mise
echo 'eval "$(mise activate zsh)"' >> ~/.zshrc

# 2. Clonar y setup
git clone repo
cd repo
mise install        # Instala TODAS las versiones correctas

# 3. Listo!
mise run dev

# ✨ No necesita instalar nvm, pyenv, gvm, etc. manualmente
```

```bash
# Pedir plan al agente (usa el prompt de ejemplo)
# El agente genera un plan con pasos atómicos

# Iniciar primer paso
source scripts/solo-dev-flow.sh
start_step 01 "setup-inicial"

# ... trabajar en el paso ...

# Finalizar paso (push + PR)
finish_step "feat(setup): configure project structure"

# CI corre automáticamente
# Si CI pasa → Auto-merge
# Continuar con siguiente paso
```

---

## 📦 Comandos de Inicialización por Stack

### Node.js + Bun + Biome

```bash
# Inicializar proyecto
bun init

# Instalar Biome
bun add --dev @biomejs/biome

# Configurar Biome
bunx @biomejs/biome init

# Actualizar package.json
cat > package.json <<EOF
{
  "name": "my-project",
  "type": "module",
  "scripts": {
    "dev": "bun run --hot src/index.ts",
    "build": "bun build src/index.ts --outdir dist",
    "test": "bun test",
    "check": "biome ci ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "@types/bun": "latest"
  }
}
EOF

# Crear estructura
mkdir -p src tests
echo 'console.log("Hello, Bun!");' > src/index.ts
```

### Python + uv

```bash
# Instalar uv (si no lo tienes)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Inicializar proyecto
uv init my-project
cd my-project

# Añadir dependencias
uv add fastapi uvicorn
uv add --dev pytest ruff

# Crear estructura
mkdir -p app tests
echo 'from fastapi import FastAPI\napp = FastAPI()' > app/main.py
```

### Java + Gradle + Kotlin

```bash
# Opción 1: Con Gradle wrapper
gradle init --type kotlin-application --dsl kotlin --test-framework junit-jupiter --package com.example.api --project-name my-api

# Opción 2: Crear estructura manualmente
mkdir -p my-api-java
cd my-api-java

# Crear estructura de directorios
mkdir -p src/main/kotlin/com/example/api
mkdir -p src/main/resources
mkdir -p src/test/kotlin/com/example/api

# Crear settings.gradle.kts
cat > settings.gradle.kts <<EOF
rootProject.name = "my-api"
EOF

# Crear build.gradle.kts (copiar del template anterior)

# Crear Application.kt
cat > src/main/kotlin/com/example/api/Application.kt <<EOF
package com.example.api

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class Application

fun main(args: Array<String>) {
    runApplication<Application>(*args)
}
EOF

# Inicializar Git
git init

# Crear gradle wrapper
gradle wrapper --gradle-version 8.12

# Verificar
./gradlew build
```

### Go + Air + golangci-lint

```bash
# Inicializar módulo Go
mkdir my-api-go && cd my-api-go
go mod init github.com/usuario/mi-api

# Crear estructura
mkdir -p cmd/api internal/handlers internal/models internal/middleware pkg

# Crear main.go básico
cat > cmd/api/main.go <<EOF
package main

import (
    "log"
    "github.com/gin-gonic/gin"
)

func main() {
    r := gin.Default()
    
    r.GET("/health", func(c *gin.Context) {
        c.JSON(200, gin.H{"status": "ok"})
    })
    
    if err := r.Run(":8080"); err != nil {
        log.Fatal("Failed to start server:", err)
    }
}
EOF

# Instalar dependencias
go get github.com/gin-gonic/gin

# Instalar Air (hot reload)
go install github.com/cosmtrek/air@latest

# Crear .air.toml (copiar del template anterior)

# Instalar golangci-lint
# macOS/Linux
curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b $(go env GOPATH)/bin

# Crear .golangci.yml (copiar del template anterior)

# Verificar
go run cmd/api/main.go
```

### Monorepo (Turborepo + Bun)

```bash
# Crear estructura
mkdir my-monorepo && cd my-monorepo
mkdir -p apps/api apps/web packages/ui packages/types

# Inicializar root
bun init

# Instalar Turborepo
bun add --dev turbo

# Crear configuración
cat > package.json <<EOF
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "test": "turbo run test",
    "check": "biome ci ."
  },
  "devDependencies": {
    "@biomejs/biome": "^1.9.4",
    "turbo": "^2.0.0"
  },
  "packageManager": "bun@1.1.0"
}
EOF

# Copiar turbo.json y biome.json (ver templates arriba)
```

---

## 🎬 Ejemplo Completo: Proyecto Desde Cero

### Prompt Inicial al Agente

```markdown
MODO: Solo-Developer / Proyecto Desde Cero

PROYECTO: Task Manager API

DESCRIPCIÓN:
API REST para gestionar tareas con autenticación JWT.
Los usuarios pueden crear, editar, eliminar y marcar como completas sus tareas.

STACK (elige uno):

Opción 1 - TypeScript:
- Backend: Bun + Hono
- Linter/Formatter: Biome
- DB: PostgreSQL
- Docker: Sí
- CI/CD: GitHub Actions

Opción 2 - Python:
- Backend: Python/FastAPI + PostgreSQL
- Package Manager: uv
- Linter: Ruff
- Docker: Sí
- CI/CD: GitHub Actions

Opción 3 - Java:
- Backend: Spring Boot 4 + Kotlin
- Build: Gradle (Kotlin DSL)
- Formatter: Spotless
- Java: 25 (LTS)
- DB: PostgreSQL
- Docker: Sí
- CI/CD: GitHub Actions

Opción 4 - Go:
- Backend: Go 1.25 + Gin
- Linter: golangci-lint
- Hot Reload: Air
- DB: PostgreSQL
- Docker: Sí
- CI/CD: GitHub Actions

FEATURES:
1. Sistema de autenticación (registro, login, JWT)
2. CRUD de tareas (create, read, update, delete)
3. Filtros (por estado: pending, completed, all)
4. Paginación en listado de tareas

ENTREGABLE:
Genera un plan atómico con:
- Setup inicial (Docker + PostgreSQL)
- Esquema de BD (users + tasks)
- Endpoints de auth
- Endpoints de tasks
- Tests de integración
```

### Output del Agente

El agente generará un plan similar al ejemplo de "Sistema de Autenticación" mostrado arriba, pero adaptado a "Task Manager API" con 6-8 pasos atómicos.

Cada paso incluirá:
- Archivos a crear
- Código de ejemplo
- Comandos para probar
- Criterios de "Done"

---

## 🔍 Troubleshooting Común

### JavaScript/TypeScript

**Problema: CI falla en auto-merge**
```bash
# Verificar que GitHub Actions tenga permisos
# Settings > Actions > General > Workflow permissions
# ✅ Read and write permissions

# Verificar que auto-merge esté habilitado
gh pr view --json autoMergeRequest
```

**Problema: Biome no formatea**
```bash
# Verificar config
cat biome.json

# Ejecutar manualmente
bun run format

# Ver qué archivos ignora
bun biome format --verbose
```

### Python

**Problema: uv no encuentra paquetes**
```bash
# Limpiar cache
uv cache clean

# Re-instalar
rm uv.lock
uv sync
```

### Java

**Problema: Gradle no compila Kotlin**
```bash
# Verificar versión de Kotlin plugin
./gradlew dependencies | grep kotlin

# Limpiar build cache
./gradlew clean

# Rebuild desde cero
./gradlew clean build --refresh-dependencies
```

**Problema: Spotless falla**
```bash
# Ver qué archivos están mal formateados
./gradlew spotlessCheck

# Aplicar formato automáticamente
./gradlew spotlessApply
```

### Go

**Problema: Air no detecta cambios**
```bash
# Verificar .air.toml
cat .air.toml

# Verificar que Air está instalado
which air

# Correr con logs verbose
air -d
```

**Problema: golangci-lint muy lento**
```bash
# Usar cache
golangci-lint cache clean
golangci-lint run --fast

# Solo linters específicos
golangci-lint run --disable-all --enable=errcheck,gosimple
```

**Problema: Dependencias de Go no se descargan**
```bash
# Limpiar módulos
go clean -modcache

# Re-descargar
go mod download

# Verificar proxy
go env GOPROXY
```

---

*Solo Dev Planner v2 - Stack Moderno para Proyectos Desde Cero*
