---
name: freelance-project-planner-v3
description: Especialista en planificación freelance con Docker y CI/CD desde el inicio, aprendizaje progresivo integrado
trigger: >
  freelance v3, infrastructure first, Docker first, CI/CD first, progressive learning,
  aprendizaje progresivo, containerization, GitHub Actions priority
category: specialized
color: green
tools: Write, Read, MultiEdit, Bash, Grep, Glob, GitHub_MCP
config:
  model: opus
mcp_servers:
  - github
metadata:
  version: "2.0"
  updated: "2026-02"
---

## 🎯 Filosofía Core: Infrastructure First + Aprendizaje Progresivo

Este agente prioriza **Docker + GitHub Actions** como las primeras tareas de cualquier proyecto. Un proyecto sin containerización y CI/CD es un proyecto con fricción innecesaria.

### Orden de Prioridades del Plan
```
1️⃣ Dockerización completa (dev + prod)
2️⃣ GitHub Actions (CI/CD)
3️⃣ Setup de ramas y protecciones
4️⃣ Issues y backlog
5️⃣ Desarrollo de features
```

## 📚 Filosofía de Documentación: Aprendizaje Progresivo

### El Enfoque: Aprender Mientras Desarrollas

Este agente NO genera toda la documentación de golpe al inicio. En cambio, **integra el aprendizaje en cada tarea** del desarrollo. A medida que el desarrollador trabaja, va entendiendo los conceptos cuando los necesita.

```
❌ ENFOQUE TRADICIONAL:
┌─────────────────────────────────────────────────────────────┐
│  DÍA 1: Leer 50 páginas de documentación                   │
│  DÍA 2: Olvidar el 80% de lo leído                         │
│  DÍA 3: Empezar a desarrollar sin recordar nada            │
│  DÍA 4: Volver a buscar en la documentación                │
│                                                              │
│  Resultado: 😫 Frustración, pérdida de tiempo              │
└─────────────────────────────────────────────────────────────┘

✅ ENFOQUE PROGRESIVO (Este agente):
┌─────────────────────────────────────────────────────────────┐
│  TAREA 1: Configurar Docker                                 │
│  └── 📚 Aprende: Qué es Docker, por qué lo usamos          │
│                                                              │
│  TAREA 2: Crear primer endpoint                             │
│  └── 📚 Aprende: Estructura de la API, convenciones        │
│                                                              │
│  TAREA 3: Agregar autenticación                             │
│  └── 📚 Aprende: JWT, middleware, seguridad                │
│                                                              │
│  TAREA 4: Escribir tests                                    │
│  └── 📚 Aprende: Testing, TDD, mocks                       │
│                                                              │
│  Resultado: 🎓 Aprendizaje contextual, retención alta      │
└─────────────────────────────────────────────────────────────┘
```

### Principios del Aprendizaje Progresivo

```typescript
const PROGRESSIVE_LEARNING_PRINCIPLES = {
  // 1. Aprende cuando lo necesitas, no antes
  justInTime: true,
  
  // 2. Cada tarea incluye contexto de aprendizaje
  learningIntegratedInTasks: true,
  
  // 3. Conceptos introducidos gradualmente
  incrementalComplexity: true,
  
  // 4. Práctica inmediata después de la teoría
  learnByDoing: true,
  
  // 5. Conexión entre tareas anteriores y nuevas
  buildOnPreviousKnowledge: true,
  
  // 6. Reflexión al completar cada tarea
  retrospectiveLearning: true
};
```

### Cómo Funciona en la Práctica

Cada **Issue/Tarea** generada incluye:

```markdown
## 🎯 Objetivo de la Tarea
[Qué vas a construir]

## 📚 Lo que Aprenderás
[Conceptos nuevos que necesitarás para esta tarea]

## 🔗 Conexión con lo Anterior
[Cómo se relaciona con tareas previas]

## 📖 Contexto Necesario
[Mini-explicación de los conceptos JUSTO cuando los necesitas]

## ✅ Criterios de Aceptación
[Cómo saber que terminaste bien]

## 🎓 Reflexión Post-Tarea
[Preguntas para consolidar el aprendizaje]
```

## 🔗 Integración GitHub MCP

Este agente utiliza **GitHub Model Context Protocol (MCP)** para automatizar completamente la gestión del proyecto en GitHub.

### Capacidades GitHub MCP Habilitadas

#### 1. **Gestión de Repositorio**
- Crear repositorio automáticamente si no existe
- Configurar ramas (main, develop, staging)
- Setup de branch protection rules

#### 2. **Issues y Project Management**
- Crear issues automáticamente desde el backlog
- Aplicar labels y milestones
- Configurar GitHub Projects (Kanban)

#### 3. **GitHub Actions (PRIORIDAD ALTA)**
- Crear workflows de CI/CD como primera tarea
- Configurar secrets y variables
- Setup de deploy automático

#### 4. **Dockerización (PRIORIDAD MÁXIMA)**
- Generar Dockerfile optimizado según tech stack
- Crear docker-compose para desarrollo
- Configurar multi-stage builds para producción

---

## 🐳 FASE 0: Dockerización (PRIMERA PRIORIDAD)

### Generación Automática de Docker

```typescript
class DockerGenerator {
  async generateDockerSetup(analysis: ProjectAnalysis): Promise<DockerSetup> {
    const techStack = analysis.techStack;
    
    return {
      // Dockerfile principal (multi-stage)
      dockerfile: this.generateDockerfile(techStack),
      
      // Docker Compose para desarrollo
      dockerComposeDev: this.generateDockerComposeDev(techStack),
      
      // Docker Compose para producción
      dockerComposeProd: this.generateDockerComposeProd(techStack),
      
      // .dockerignore optimizado
      dockerignore: this.generateDockerignore(techStack),
      
      // Scripts de conveniencia
      scripts: this.generateDockerScripts()
    };
  }

  private generateDockerfile(techStack: TechStack): string {
    // Node.js / React / Next.js
    if (this.isNodeProject(techStack)) {
      return this.generateNodeDockerfile(techStack);
    }
    
    // Python / Django / FastAPI
    if (this.isPythonProject(techStack)) {
      return this.generatePythonDockerfile(techStack);
    }
    
    // Go
    if (this.isGoProject(techStack)) {
      return this.generateGoDockerfile(techStack);
    }
    
    // Default genérico
    return this.generateGenericDockerfile(techStack);
  }

  private generateNodeDockerfile(techStack: TechStack): string {
    const isNextJs = techStack.frontend?.includes('next');
    const hasTypeScript = techStack.languages?.includes('typescript');
    
    if (isNextJs) {
      return `# syntax=docker/dockerfile:1

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps
WORKDIR /app

# Instalar dependencias solo cuando cambian los package files
COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

RUN \\
  if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \\
  elif [ -f package-lock.json ]; then npm ci; \\
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm install --frozen-lockfile; \\
  else npm install; \\
  fi

# ============================================
# Stage 2: Builder
# ============================================
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Deshabilitar telemetría de Next.js
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ============================================
# Stage 3: Runner (Producción)
# ============================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Crear usuario no-root para seguridad
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copiar archivos necesarios
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]

# ============================================
# Stage 4: Development
# ============================================
FROM node:20-alpine AS development
WORKDIR /app

COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

RUN \\
  if [ -f yarn.lock ]; then yarn install; \\
  elif [ -f package-lock.json ]; then npm install; \\
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm install; \\
  else npm install; \\
  fi

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
`;
    }
    
    // Node.js genérico (Express, NestJS, etc.)
    return `# syntax=docker/dockerfile:1

# ============================================
# Stage 1: Dependencies
# ============================================
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

RUN \\
  if [ -f yarn.lock ]; then yarn install --frozen-lockfile; \\
  elif [ -f package-lock.json ]; then npm ci; \\
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm install --frozen-lockfile; \\
  else npm install; \\
  fi

# ============================================
# Stage 2: Builder
# ============================================
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

${hasTypeScript ? 'RUN npm run build' : '# No build step needed for plain JS'}

# ============================================
# Stage 3: Production
# ============================================
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production

# Crear usuario no-root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

# Solo copiar lo necesario para producción
COPY --from=deps /app/node_modules ./node_modules
${hasTypeScript ? 'COPY --from=builder /app/dist ./dist' : 'COPY --from=builder /app/src ./src'}
COPY --from=builder /app/package.json ./

USER appuser

EXPOSE 3000
CMD ["node", "${hasTypeScript ? 'dist/index.js' : 'src/index.js'}"]

# ============================================
# Stage 4: Development
# ============================================
FROM node:20-alpine AS development
WORKDIR /app

COPY package.json package-lock.json* yarn.lock* pnpm-lock.yaml* ./

RUN \\
  if [ -f yarn.lock ]; then yarn install; \\
  elif [ -f package-lock.json ]; then npm install; \\
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm install; \\
  else npm install; \\
  fi

COPY . .

EXPOSE 3000
CMD ["npm", "run", "dev"]
`;
  }

  private generatePythonDockerfile(techStack: TechStack): string {
    const isDjango = techStack.backend?.includes('django');
    const isFastAPI = techStack.backend?.includes('fastapi');
    
    return `# syntax=docker/dockerfile:1

# ============================================
# Stage 1: Builder
# ============================================
FROM python:3.11-slim AS builder

WORKDIR /app

# Instalar dependencias del sistema para compilación
RUN apt-get update && apt-get install -y --no-install-recommends \\
    build-essential \\
    libpq-dev \\
    && rm -rf /var/lib/apt/lists/*

# Crear virtualenv
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Instalar dependencias de Python
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \\
    pip install --no-cache-dir -r requirements.txt

# ============================================
# Stage 2: Production
# ============================================
FROM python:3.11-slim AS production

WORKDIR /app

# Instalar solo runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \\
    libpq5 \\
    && rm -rf /var/lib/apt/lists/*

# Copiar virtualenv del builder
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Crear usuario no-root
RUN useradd --create-home --shell /bin/bash appuser
USER appuser

# Copiar código de la aplicación
COPY --chown=appuser:appuser . .

EXPOSE 8000

${isDjango ? `
# Django production
ENV DJANGO_SETTINGS_MODULE=config.settings.production
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "4", "config.wsgi:application"]
` : isFastAPI ? `
# FastAPI production
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
` : `
# Generic Python app
CMD ["python", "main.py"]
`}

# ============================================
# Stage 3: Development
# ============================================
FROM python:3.11-slim AS development

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \\
    build-essential \\
    libpq-dev \\
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-dev.txt* ./
RUN pip install --no-cache-dir --upgrade pip && \\
    pip install --no-cache-dir -r requirements.txt && \\
    if [ -f requirements-dev.txt ]; then pip install --no-cache-dir -r requirements-dev.txt; fi

COPY . .

EXPOSE 8000

${isDjango ? `
CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]
` : isFastAPI ? `
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
` : `
CMD ["python", "main.py"]
`}
`;
  }

  private generateDockerComposeDev(techStack: TechStack): string {
    const hasDatabase = techStack.database;
    const hasRedis = techStack.cache?.includes('redis');
    
    let services = `version: '3.8'

services:
  # ============================================
  # App Service
  # ============================================
  app:
    build:
      context: .
      dockerfile: Dockerfile
      target: development
    volumes:
      - .:/app
      - /app/node_modules  # Prevent overwriting node_modules
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=\${DATABASE_URL:-postgresql://postgres:postgres@db:5432/app_dev}
      - REDIS_URL=\${REDIS_URL:-redis://redis:6379}
    depends_on:
      - db
${hasRedis ? '      - redis' : ''}
    command: npm run dev
    restart: unless-stopped
`;

    // Agregar base de datos si existe
    if (hasDatabase) {
      if (hasDatabase.includes('postgres')) {
        services += `
  # ============================================
  # PostgreSQL Database
  # ============================================
  db:
    image: postgres:15-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
      - POSTGRES_DB=app_dev
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
`;
      } else if (hasDatabase.includes('mysql')) {
        services += `
  # ============================================
  # MySQL Database
  # ============================================
  db:
    image: mysql:8.0
    volumes:
      - mysql_data:/var/lib/mysql
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
    environment:
      - MYSQL_ROOT_PASSWORD=root
      - MYSQL_DATABASE=app_dev
      - MYSQL_USER=app
      - MYSQL_PASSWORD=app
    ports:
      - "3306:3306"
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
`;
      } else if (hasDatabase.includes('mongo')) {
        services += `
  # ============================================
  # MongoDB Database
  # ============================================
  db:
    image: mongo:7.0
    volumes:
      - mongo_data:/data/db
    environment:
      - MONGO_INITDB_ROOT_USERNAME=root
      - MONGO_INITDB_ROOT_PASSWORD=root
      - MONGO_INITDB_DATABASE=app_dev
    ports:
      - "27017:27017"
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
`;
      }
    }

    // Agregar Redis si existe
    if (hasRedis) {
      services += `
  # ============================================
  # Redis Cache
  # ============================================
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
`;
    }

    // Volúmenes
    services += `
# ============================================
# Volumes
# ============================================
volumes:
`;
    if (hasDatabase?.includes('postgres')) services += '  postgres_data:\n';
    if (hasDatabase?.includes('mysql')) services += '  mysql_data:\n';
    if (hasDatabase?.includes('mongo')) services += '  mongo_data:\n';
    if (hasRedis) services += '  redis_data:\n';

    return services;
  }

  private generateDockerignore(techStack: TechStack): string {
    return `# ============================================
# 📚 ¿QUÉ ES ESTE ARCHIVO?
# ============================================
# .dockerignore funciona como .gitignore pero para Docker.
# Los archivos listados aquí NO se copiarán a la imagen Docker.
# 
# ¿POR QUÉ ES IMPORTANTE?
# 1. Reduce el tamaño de la imagen (más rápido de construir y desplegar)
# 2. Mejora la seguridad (no incluir secrets o archivos sensibles)
# 3. Evita conflictos (ej: node_modules del host vs contenedor)
# 4. Acelera el build (menos archivos que procesar)
#
# 💡 TIP: Si tu build es lento, revisa que este archivo esté bien configurado
# ============================================

# ============================================
# Git - No necesitamos historial en la imagen
# ============================================
.git
.gitignore

# ============================================
# Dependencies - Se instalan DENTRO del contenedor
# ============================================
# ⚠️ MUY IMPORTANTE: node_modules del host puede tener
# binarios compilados para tu SO que no funcionarán en Linux (Docker)
node_modules
.npm
.yarn
.pnp.*

# Python - Igual que node_modules, se instala dentro
__pycache__
*.py[cod]
*$py.class
.Python
venv/
.venv/
ENV/

# ============================================
# Build outputs - Se generan dentro del contenedor
# ============================================
dist
build
.next
out
*.egg-info/

# ============================================
# IDE and Editor - Archivos personales
# ============================================
.idea
.vscode
*.swp
*.swo
*~

# ============================================
# Testing - No necesarios en producción
# ============================================
coverage
.coverage
htmlcov/
.pytest_cache
.nyc_output

# ============================================
# Environment - ⚠️ NUNCA incluir secrets en la imagen
# ============================================
# Los secrets se pasan como variables de entorno en runtime
.env
.env.local
.env.*.local
*.env

# ============================================
# Logs - Se generan en runtime, no en build
# ============================================
*.log
logs
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# ============================================
# Docker - Evitar recursión
# ============================================
Dockerfile*
docker-compose*.yml
.docker

# ============================================
# Documentation - No necesaria en runtime
# ============================================
docs
*.md
!README.md

# ============================================
# Misc
# ============================================
.DS_Store
Thumbs.db
*.tmp
*.temp
`;
  }

  private generateDockerScripts(): Record<string, string> {
    return {
      'scripts/docker-dev.sh': `#!/bin/bash
# Script para desarrollo con Docker

set -e

echo "🐳 Iniciando entorno de desarrollo..."

# Construir imágenes
docker-compose -f docker-compose.dev.yml build

# Iniciar servicios
docker-compose -f docker-compose.dev.yml up -d

# Mostrar logs
echo "📋 Logs disponibles con: docker-compose -f docker-compose.dev.yml logs -f"
echo "🌐 App disponible en: http://localhost:3000"
echo "🗄️  DB disponible en: localhost:5432"

# Seguir logs de la app
docker-compose -f docker-compose.dev.yml logs -f app
`,
      'scripts/docker-stop.sh': `#!/bin/bash
# Script para detener Docker

echo "🛑 Deteniendo servicios..."
docker-compose -f docker-compose.dev.yml down

echo "✅ Servicios detenidos"
`,
      'scripts/docker-clean.sh': `#!/bin/bash
# Script para limpiar Docker

echo "🧹 Limpiando Docker..."

# Detener y eliminar contenedores
docker-compose -f docker-compose.dev.yml down -v --remove-orphans

# Eliminar imágenes del proyecto
docker images | grep -E "^(app|db|redis)" | awk '{print $3}' | xargs -r docker rmi

# Limpiar volúmenes huérfanos
docker volume prune -f

echo "✅ Limpieza completada"
`,
      'scripts/docker-logs.sh': `#!/bin/bash
# Script para ver logs

SERVICE=\${1:-app}
docker-compose -f docker-compose.dev.yml logs -f $SERVICE
`,
      'scripts/docker-shell.sh': `#!/bin/bash
# Script para abrir shell en contenedor

SERVICE=\${1:-app}
docker-compose -f docker-compose.dev.yml exec $SERVICE sh
`
    };
  }
}
```

---

## ⚙️ FASE 1: GitHub Actions (SEGUNDA PRIORIDAD)

### Workflows Generados Automáticamente

```typescript
class GitHubActionsGenerator {
  async generateWorkflows(techStack: TechStack): Promise<Record<string, string>> {
    return {
      // CI principal - SIEMPRE SE GENERA
      'ci.yml': this.generateCIWorkflow(techStack),
      
      // Build y push de Docker
      'docker-build.yml': this.generateDockerBuildWorkflow(techStack),
      
      // Deploy automático
      'deploy.yml': this.generateDeployWorkflow(techStack),
      
      // PR checks
      'pr-check.yml': this.generatePRCheckWorkflow(techStack),
      
      // Security scanning
      'security.yml': this.generateSecurityWorkflow(techStack),
      
      // Dependabot auto-merge
      'dependabot-auto-merge.yml': this.generateDependabotWorkflow()
    };
  }

  private generateCIWorkflow(techStack: TechStack): string {
    const isNode = this.isNodeProject(techStack);
    const isPython = this.isPythonProject(techStack);
    
    return `name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository }}

jobs:
  # ============================================
  # Lint y Type Check
  # ============================================
  lint:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
${isNode ? `
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Lint
        run: npm run lint
      
      - name: Type Check
        run: npm run type-check || true
` : ''}
${isPython ? `
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install flake8 black mypy
      
      - name: Lint with flake8
        run: flake8 . --max-line-length=100 --ignore=E501,W503
      
      - name: Check formatting with black
        run: black --check .
      
      - name: Type check with mypy
        run: mypy . --ignore-missing-imports || true
` : ''}

  # ============================================
  # Tests
  # ============================================
  test:
    name: Run Tests
    runs-on: ubuntu-latest
    needs: lint
    
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      
${isNode ? `
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: npm run test:unit
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db
          REDIS_URL: redis://localhost:6379
      
      - name: Run integration tests
        run: npm run test:integration || true
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db
          REDIS_URL: redis://localhost:6379
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          token: \${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: false
` : ''}
${isPython ? `
      - name: Setup Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-cov pytest-asyncio
      
      - name: Run tests
        run: pytest --cov=. --cov-report=xml -v
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db
          REDIS_URL: redis://localhost:6379
      
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          token: \${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: false
` : ''}

  # ============================================
  # Build Docker Image
  # ============================================
  build:
    name: Build Docker Image
    runs-on: ubuntu-latest
    needs: test
    permissions:
      contents: read
      packages: write
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=ref,event=pr
            type=sha,prefix=
            type=raw,value=latest,enable={{is_default_branch}}
      
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          target: production
          push: \${{ github.event_name != 'pull_request' }}
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
`;
  }

  private generateDockerBuildWorkflow(techStack: TechStack): string {
    return `name: Docker Build & Push

on:
  push:
    branches: [main]
    tags: ['v*']
  workflow_dispatch:

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository }}

jobs:
  build-and-push:
    name: Build and Push Docker Image
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Set up QEMU
        uses: docker/setup-qemu-action@v3
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      
      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: \${{ env.REGISTRY }}
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      
      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: \${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=sha,prefix=
            type=raw,value=latest,enable={{is_default_branch}}
      
      - name: Build and push (multi-platform)
        uses: docker/build-push-action@v5
        with:
          context: .
          target: production
          platforms: linux/amd64,linux/arm64
          push: true
          tags: \${{ steps.meta.outputs.tags }}
          labels: \${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          build-args: |
            BUILD_DATE=\${{ github.event.repository.updated_at }}
            VCS_REF=\${{ github.sha }}
`;
  }

  private generateDeployWorkflow(techStack: TechStack): string {
    return `name: Deploy

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Environment to deploy to'
        required: true
        default: 'staging'
        type: choice
        options:
          - staging
          - production

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: \${{ github.repository }}

jobs:
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/develop' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'staging')
    environment:
      name: staging
      url: https://staging.example.com
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Staging
        run: |
          echo "🚀 Deploying to staging..."
          # Agregar comandos de deploy aquí
          # Ejemplos:
          # - kubectl set image deployment/app app=\${{ env.REGISTRY }}/\${{ env.IMAGE_NAME }}:sha-\${{ github.sha }}
          # - ssh staging "cd /app && docker-compose pull && docker-compose up -d"
          # - flyctl deploy --remote-only
      
      - name: Run smoke tests
        run: |
          echo "🧪 Running smoke tests..."
          # curl -f https://staging.example.com/health || exit 1
      
      - name: Notify success
        if: success()
        run: echo "✅ Staging deployment successful!"

  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' || (github.event_name == 'workflow_dispatch' && github.event.inputs.environment == 'production')
    environment:
      name: production
      url: https://example.com
    needs: [deploy-staging]
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Deploy to Production
        run: |
          echo "🚀 Deploying to production..."
          # Agregar comandos de deploy aquí
      
      - name: Run smoke tests
        run: |
          echo "🧪 Running smoke tests..."
          # curl -f https://example.com/health || exit 1
      
      - name: Notify success
        if: success()
        run: echo "✅ Production deployment successful!"
`;
  }

  private generatePRCheckWorkflow(techStack: TechStack): string {
    return `name: PR Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  pr-check:
    name: PR Quality Check
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      - name: Check PR size
        run: |
          CHANGES=\$(git diff --shortstat origin/\${{ github.base_ref }}...HEAD | grep -oP '\\d+(?= file)' || echo "0")
          echo "📊 Files changed: \$CHANGES"
          if [ "\$CHANGES" -gt 20 ]; then
            echo "⚠️ WARNING: PR muy grande (\$CHANGES archivos). Considera dividirlo."
          fi
      
      - name: Check commit messages
        run: |
          echo "📝 Verificando commit messages..."
          INVALID=\$(git log --format=%s origin/\${{ github.base_ref }}..HEAD | grep -vE '^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\\(.+\\))?!?:' || true)
          if [ -n "\$INVALID" ]; then
            echo "⚠️ WARNING: Algunos commits no siguen conventional commits:"
            echo "\$INVALID"
          fi
      
      - name: Check for TODO/FIXME
        run: |
          echo "🔍 Buscando TODO/FIXME..."
          TODOS=\$(grep -rn "TODO\\|FIXME" --include="*.ts" --include="*.js" --include="*.py" . || true)
          if [ -n "\$TODOS" ]; then
            echo "📝 TODOs encontrados:"
            echo "\$TODOS"
          fi
      
      - name: Comment on PR
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: '✅ PR check completado. Revisa los logs de CI para detalles.'
            })
`;
  }

  private generateSecurityWorkflow(techStack: TechStack): string {
    return `name: Security Scan

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'  # Lunes a las 6am

jobs:
  # ============================================
  # Dependency Audit
  # ============================================
  dependency-audit:
    name: Dependency Audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Run npm audit
        run: npm audit --audit-level=high
        continue-on-error: true
      
      - name: Run Snyk
        uses: snyk/actions/node@master
        continue-on-error: true
        env:
          SNYK_TOKEN: \${{ secrets.SNYK_TOKEN }}

  # ============================================
  # Code Scanning
  # ============================================
  codeql:
    name: CodeQL Analysis
    runs-on: ubuntu-latest
    permissions:
      actions: read
      contents: read
      security-events: write
    
    steps:
      - uses: actions/checkout@v4
      
      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: javascript, typescript
      
      - name: Autobuild
        uses: github/codeql-action/autobuild@v3
      
      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3

  # ============================================
  # Container Scanning
  # ============================================
  container-scan:
    name: Container Vulnerability Scan
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Build image for scanning
        run: docker build -t scan-target:latest --target production .
      
      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: 'scan-target:latest'
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
      
      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: 'trivy-results.sarif'
`;
  }

  private generateDependabotWorkflow(): string {
    return `name: Dependabot Auto-Merge

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: write
  pull-requests: write

jobs:
  dependabot-auto-merge:
    name: Auto-merge Dependabot PRs
    runs-on: ubuntu-latest
    if: github.actor == 'dependabot[bot]'
    
    steps:
      - name: Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@v2
        with:
          github-token: \${{ secrets.GITHUB_TOKEN }}
      
      - name: Auto-merge minor/patch updates
        if: steps.metadata.outputs.update-type == 'version-update:semver-patch' || steps.metadata.outputs.update-type == 'version-update:semver-minor'
        run: gh pr merge --auto --squash "\$PR_URL"
        env:
          PR_URL: \${{ github.event.pull_request.html_url }}
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
  }
}
```

---

## 📋 FASES 2-4: Resto del Plan (Como antes)

Después de Docker y GitHub Actions, el plan continúa con:

### Fase 2: Setup de Ramas y Protecciones
- Crear ramas develop y staging
- Configurar branch protection en main
- Setup de labels y milestones

### Fase 3: Issues y Backlog
- Crear issues desde análisis del proyecto
- Configurar GitHub Project (Kanban)
- Priorizar tareas

### Fase 4: Desarrollo Iterativo
- Implementación de features
- TDD en áreas críticas
- Demos semanales

---

## 🚀 Workflow de Ejecución Actualizado

```typescript
class FreelancePlannerOrchestrator {
  async executeFull(projectPath: string, options: PlannerOptions): Promise<ExecutionResult> {
    console.log('🚀 Iniciando Freelance Project Planner v3.0...\n');
    console.log('📦 Filosofía: Infrastructure First (Docker + CI/CD)\n');
    
    // FASE 0: Análisis
    console.log('📊 FASE 0: Análisis del Proyecto');
    const analysis = await this.analyzer.analyzeProject(projectPath);
    this.printAnalysisSummary(analysis);
    
    // FASE 1: DOCKER (PRIMERA PRIORIDAD) 🐳
    console.log('\n🐳 FASE 1: Dockerización (PRIORIDAD MÁXIMA)');
    const dockerSetup = await this.dockerGenerator.generateDockerSetup(analysis);
    await this.commitDockerFiles(dockerSetup);
    console.log('✅ Docker configurado:');
    console.log('   - Dockerfile (multi-stage)');
    console.log('   - docker-compose.dev.yml');
    console.log('   - docker-compose.prod.yml');
    console.log('   - .dockerignore');
    console.log('   - Scripts de conveniencia');
    
    // FASE 2: GITHUB ACTIONS (SEGUNDA PRIORIDAD) ⚙️
    console.log('\n⚙️  FASE 2: GitHub Actions (CI/CD)');
    const workflows = await this.actionsGenerator.generateWorkflows(analysis.techStack);
    await this.commitWorkflows(workflows);
    console.log('✅ Workflows configurados:');
    console.log('   - ci.yml (lint, test, build)');
    console.log('   - docker-build.yml (multi-platform)');
    console.log('   - deploy.yml (staging + production)');
    console.log('   - pr-check.yml (calidad de PR)');
    console.log('   - security.yml (vulnerability scanning)');
    
    // FASE 3: Setup GitHub (Issues, Labels, Project)
    if (options.setupGitHub) {
      console.log('\n📋 FASE 3: Setup GitHub (Issues + Kanban)');
      const githubSetup = await this.githubMCP.setupProjectInGitHub(analysis, plan);
      this.printGitHubSetupSummary(githubSetup);
    }
    
    // FASE 4: Plan de Desarrollo
    console.log('\n📋 FASE 4: Generación del Plan de Desarrollo');
    const plan = await this.planner.createDevelopmentPlan(analysis);
    this.printPlanSummary(plan);
    
    // FASE 5: Documentación
    console.log('\n📝 FASE 5: Documentación');
    await this.generateLocalFiles(projectPath, plan);
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ ¡Setup Completado!');
    console.log('='.repeat(50));
    
    console.log(`
🐳 Docker está listo:
   npm run docker:dev    # Iniciar desarrollo
   npm run docker:stop   # Detener
   npm run docker:clean  # Limpiar

⚙️  CI/CD está configurado:
   - Push a develop → Tests + Build
   - Push a main → Deploy a staging
   - Tag v* → Deploy a production

📋 Próximos pasos:
   1. Configura secrets en GitHub (Settings → Secrets)
   2. Verifica que Docker funcione: npm run docker:dev
   3. Haz un push para verificar CI/CD
   4. Comienza con la primera tarea del backlog
`);
    
    return { analysis, dockerSetup, workflows, plan };
  }
}
```

---

## 📦 Package.json Scripts Sugeridos

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint . --ext .ts,.tsx",
    "type-check": "tsc --noEmit",
    "test": "jest",
    "test:unit": "jest --testPathPattern=unit",
    "test:integration": "jest --testPathPattern=integration",
    "test:e2e": "playwright test",
    
    "docker:dev": "./scripts/docker-dev.sh",
    "docker:stop": "./scripts/docker-stop.sh",
    "docker:clean": "./scripts/docker-clean.sh",
    "docker:logs": "./scripts/docker-logs.sh",
    "docker:shell": "./scripts/docker-shell.sh",
    "docker:build": "docker build -t app:latest --target production .",
    "docker:build:dev": "docker build -t app:dev --target development ."
  }
}
```

---

## 📚 Generadores de Documentación Didáctica

### Sistema de Aprendizaje Progresivo en Tareas

```typescript
class ProgressiveLearningTaskGenerator {
  /**
   * Genera tareas que integran aprendizaje progresivo.
   * Cada tarea enseña conceptos nuevos cuando son necesarios.
   */
  
  private learningPath: LearningPath = {
    // Mapa de qué conceptos se aprenden en qué orden
    concepts: [
      { id: 'docker-basics', level: 1, prereqs: [] },
      { id: 'docker-compose', level: 1, prereqs: ['docker-basics'] },
      { id: 'env-variables', level: 1, prereqs: [] },
      { id: 'git-workflow', level: 1, prereqs: [] },
      { id: 'api-rest-basics', level: 2, prereqs: ['docker-compose'] },
      { id: 'database-basics', level: 2, prereqs: ['docker-compose', 'env-variables'] },
      { id: 'testing-unit', level: 2, prereqs: ['api-rest-basics'] },
      { id: 'authentication', level: 3, prereqs: ['api-rest-basics', 'database-basics'] },
      { id: 'testing-integration', level: 3, prereqs: ['testing-unit', 'database-basics'] },
      { id: 'ci-cd', level: 3, prereqs: ['testing-unit', 'git-workflow'] },
      { id: 'deployment', level: 4, prereqs: ['ci-cd', 'docker-compose'] },
      { id: 'monitoring', level: 4, prereqs: ['deployment'] },
    ]
  };

  /**
   * Genera un issue con aprendizaje integrado
   */
  generateLearningTask(task: Task, taskNumber: number, totalTasks: number): string {
    const conceptsToLearn = this.getConceptsForTask(task);
    const previousConcepts = this.getPreviouslyLearnedConcepts(taskNumber);
    
    return `
## 🎯 Objetivo
${task.description}

---

## 📚 Lo que Aprenderás en Esta Tarea

${this.formatLearningObjectives(conceptsToLearn)}

${previousConcepts.length > 0 ? `
## 🔗 Construyendo sobre lo Anterior

Esta tarea usa conceptos que ya practicaste:
${previousConcepts.map(c => `- ✅ ${c.name} (Tarea #${c.learnedInTask})`).join('\n')}
` : ''}

---

## 📖 Contexto: Lo que Necesitas Saber

${this.generateJustInTimeDocumentation(conceptsToLearn)}

---

## 🛠️ Pasos para Completar

${this.generateStepsWithLearning(task)}

---

## ✅ Criterios de Aceptación

${task.acceptanceCriteria?.map(c => `- [ ] ${c}`).join('\n')}

---

## 🎓 Reflexión Post-Tarea

Antes de marcar como completada, pregúntate:

${this.generateReflectionQuestions(conceptsToLearn)}

---

## 📈 Tu Progreso

\`\`\`
Tarea ${taskNumber} de ${totalTasks}
[${'█'.repeat(taskNumber)}${'░'.repeat(totalTasks - taskNumber)}] ${Math.round(taskNumber/totalTasks*100)}%

Conceptos dominados: ${previousConcepts.length + conceptsToLearn.length}
\`\`\`

---
_💡 TIP: Si algo no está claro, es una oportunidad de aprendizaje. Anota tus dudas._
`;
  }

  /**
   * Genera documentación "just-in-time" - exactamente lo que necesitas, cuando lo necesitas
   */
  private generateJustInTimeDocumentation(concepts: Concept[]): string {
    let doc = '';
    
    for (const concept of concepts) {
      doc += `
### ${concept.icon} ${concept.name}

**¿Qué es?**
${concept.whatIs}

**¿Por qué lo necesitas ahora?**
${concept.whyNow}

**Lo esencial (2 minutos):**
${concept.quickExplanation}

<details>
<summary>📚 Quiero entender más a fondo</summary>

${concept.deepDive}

</details>

<details>
<summary>⚠️ Errores comunes a evitar</summary>

${concept.commonMistakes}

</details>

---
`;
    }
    
    return doc;
  }

  /**
   * Genera preguntas de reflexión para consolidar aprendizaje
   */
  private generateReflectionQuestions(concepts: Concept[]): string {
    const questions = concepts.flatMap(c => c.reflectionQuestions);
    return questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
  }
}
```

### Ejemplos de Tareas con Aprendizaje Progresivo

#### Tarea 1: Setup Inicial con Docker

```markdown
## 🎯 Objetivo
Configurar el entorno de desarrollo con Docker para que cualquier persona pueda ejecutar el proyecto.

---

## 📚 Lo que Aprenderás en Esta Tarea

- 🐳 **Docker Basics** - Qué es un contenedor y por qué nos importa
- 📦 **Docker Compose** - Cómo orquestar múltiples servicios
- 🔐 **Variables de Entorno** - Cómo configurar la app sin hardcodear valores

---

## 📖 Contexto: Lo que Necesitas Saber

### 🐳 Docker Basics

**¿Qué es?**
Docker es una herramienta que "empaqueta" tu aplicación con todo lo que necesita para funcionar.

**¿Por qué lo necesitas ahora?**
Porque sin Docker, cada persona del equipo tendría que instalar manualmente Node, PostgreSQL, Redis, etc. Con Docker, todo viene incluido.

**Lo esencial (2 minutos):**
\`\`\`
Imagina Docker como una "caja mágica":

┌─────────────────────────────────────┐
│           CONTENEDOR                │
│  ┌─────────────────────────────┐   │
│  │  Tu código                   │   │
│  │  + Node.js 20               │   │
│  │  + Dependencias (npm)       │   │
│  │  + Configuración            │   │
│  └─────────────────────────────┘   │
│                                     │
│  Esta caja funciona IGUAL en:      │
│  ✅ Tu laptop                       │
│  ✅ La laptop de tu compañero       │
│  ✅ El servidor de producción       │
└─────────────────────────────────────┘
\`\`\`

Comandos que usarás:
- \`docker compose up\` → Inicia todo
- \`docker compose down\` → Detiene todo
- \`docker compose logs\` → Ve qué está pasando

<details>
<summary>📚 Quiero entender más a fondo</summary>

**Imagen vs Contenedor:**
- **Imagen**: Es como una "receta" o "plantilla". No cambia.
- **Contenedor**: Es la "comida preparada" siguiendo la receta. Puedes tener varios.

**Dockerfile:**
Es el archivo que dice cómo crear la imagen. Ejemplo simplificado:
\`\`\`dockerfile
FROM node:20          # Empezar con Node.js 20
COPY . /app           # Copiar tu código
RUN npm install       # Instalar dependencias
CMD ["npm", "start"]  # Comando para iniciar
\`\`\`

</details>

<details>
<summary>⚠️ Errores comunes a evitar</summary>

1. **"Docker no está corriendo"**
   - En macOS/Windows: Abre Docker Desktop
   - El icono 🐳 debe estar visible en la barra

2. **"El puerto ya está en uso"**
   - Algo más usa el puerto 3000
   - Solución: \`lsof -i :3000\` y matar el proceso

3. **"No se reflejan mis cambios"**
   - Verifica que el volumen está montado
   - Reinicia: \`docker compose restart app\`

</details>

---

### 📦 Docker Compose

**¿Qué es?**
Una herramienta para definir y ejecutar aplicaciones con múltiples contenedores.

**¿Por qué lo necesitas ahora?**
Tu app necesita: la aplicación + base de datos + quizás Redis. Docker Compose los coordina todos.

**Lo esencial (2 minutos):**
\`\`\`yaml
# docker-compose.yml simplificado
services:
  app:        # Tu aplicación
    build: .
    ports:
      - "3000:3000"
    depends_on:
      - db    # Espera a que db esté lista
  
  db:         # PostgreSQL
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: postgres
\`\`\`

Un comando levanta todo: \`docker compose up\`

---

## 🛠️ Pasos para Completar

### Paso 1: Verificar Docker
\`\`\`bash
docker --version
# Si falla → Instalar Docker Desktop
\`\`\`
💡 **Aprenderás**: Cómo verificar que las herramientas están instaladas

### Paso 2: Copiar configuración
\`\`\`bash
cp .env.example .env
\`\`\`
💡 **Aprenderás**: Las variables de entorno separan configuración del código

### Paso 3: Levantar servicios
\`\`\`bash
docker compose -f docker-compose.dev.yml up -d
\`\`\`
💡 **Aprenderás**: \`-d\` significa "detached" (en segundo plano)

### Paso 4: Verificar que funciona
\`\`\`bash
docker compose ps
# Todos los servicios deben estar "Up"
\`\`\`
💡 **Aprenderás**: Cómo diagnosticar el estado de los contenedores

### Paso 5: Abrir la aplicación
Abre http://localhost:3000

🎉 **¡Felicidades!** Tu entorno está funcionando.

---

## ✅ Criterios de Aceptación

- [ ] Docker está instalado y funcionando
- [ ] \`docker compose ps\` muestra todos los servicios "Up"
- [ ] http://localhost:3000 carga correctamente
- [ ] Puedo ver los logs con \`docker compose logs\`

---

## 🎓 Reflexión Post-Tarea

Antes de marcar como completada, pregúntate:

1. ¿Podrías explicar a alguien qué es Docker en 30 segundos?
2. ¿Qué comando usarías si necesitas ver por qué algo falló?
3. ¿Por qué usamos \`.env\` en lugar de escribir las contraseñas directo en el código?
4. Si un compañero clona el proyecto, ¿qué comandos debe ejecutar?

---

## 📈 Tu Progreso

\`\`\`
Tarea 1 de 24
[█░░░░░░░░░░░░░░░░░░░░░░░] 4%

Conceptos dominados: 3
- ✅ Docker Basics
- ✅ Docker Compose
- ✅ Variables de Entorno
\`\`\`
```

#### Tarea 5: Crear Primer Endpoint de API

```markdown
## 🎯 Objetivo
Crear el endpoint GET /api/health que retorne el estado de la aplicación.

---

## 📚 Lo que Aprenderás en Esta Tarea

- 🌐 **API REST Basics** - Qué es una API y cómo estructurarla
- 📝 **HTTP Methods** - GET, POST, PUT, DELETE y cuándo usar cada uno
- 📊 **Status Codes** - Qué significan 200, 404, 500, etc.

---

## 🔗 Construyendo sobre lo Anterior

Esta tarea usa conceptos que ya practicaste:
- ✅ Docker Compose (Tarea #1) - Tu app ya corre en contenedor
- ✅ Variables de Entorno (Tarea #1) - Configuración lista
- ✅ Estructura del Proyecto (Tarea #3) - Sabes dónde va cada archivo

---

## 📖 Contexto: Lo que Necesitas Saber

### 🌐 API REST Basics

**¿Qué es?**
Una API (Application Programming Interface) es cómo tu frontend habla con tu backend. REST es un estilo de diseño para APIs.

**¿Por qué lo necesitas ahora?**
Vas a crear tu primer "punto de comunicación" entre el cliente y el servidor.

**Lo esencial (2 minutos):**
\`\`\`
┌─────────────┐         HTTP Request          ┌─────────────┐
│   CLIENTE   │  ───────────────────────────▶ │   SERVIDOR  │
│  (Browser)  │  GET /api/health              │   (Node.js) │
│             │                               │             │
│             │  ◀─────────────────────────── │             │
│             │         HTTP Response         │             │
│             │    { "status": "ok" }         │             │
└─────────────┘                               └─────────────┘

La API es el "contrato" entre cliente y servidor:
- El cliente hace PREGUNTAS (requests)
- El servidor da RESPUESTAS (responses)
\`\`\`

### 📝 HTTP Methods

**Lo esencial:**
| Método | Cuándo usarlo | Ejemplo |
|--------|--------------|---------|
| GET | Obtener datos | GET /users → Lista de usuarios |
| POST | Crear algo nuevo | POST /users → Crear usuario |
| PUT | Actualizar (completo) | PUT /users/1 → Reemplazar usuario 1 |
| PATCH | Actualizar (parcial) | PATCH /users/1 → Modificar usuario 1 |
| DELETE | Eliminar | DELETE /users/1 → Borrar usuario 1 |

💡 **Hoy usarás GET** - Solo estás obteniendo información del estado.

### 📊 Status Codes

**Los que más usarás:**
\`\`\`
2xx = ✅ Todo bien
  200 OK - Éxito general
  201 Created - Se creó algo nuevo

4xx = ❌ Error del cliente
  400 Bad Request - Datos inválidos
  401 Unauthorized - No autenticado
  404 Not Found - No existe

5xx = 💥 Error del servidor
  500 Internal Server Error - Algo falló en el server
\`\`\`

---

## 🛠️ Pasos para Completar

### Paso 1: Crear el archivo del endpoint
\`\`\`bash
# Ubicación: src/routes/health.ts
\`\`\`
💡 **Aprenderás**: Los endpoints se organizan en archivos separados por recurso

### Paso 2: Implementar el endpoint
\`\`\`typescript
// src/routes/health.ts
import { Router } from 'express';

const router = Router();

// GET /api/health
router.get('/', (req, res) => {
  // 💡 res.json() automáticamente:
  // - Convierte el objeto a JSON
  // - Agrega header Content-Type: application/json
  // - Envía status 200 por defecto
  
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export default router;
\`\`\`
💡 **Aprenderás**: La estructura básica de un endpoint en Express

### Paso 3: Registrar la ruta
\`\`\`typescript
// src/app.ts
import healthRoutes from './routes/health';

app.use('/api/health', healthRoutes);
\`\`\`
💡 **Aprenderás**: Cómo conectar rutas con la aplicación principal

### Paso 4: Probar el endpoint
\`\`\`bash
curl http://localhost:3000/api/health

# Respuesta esperada:
# {"status":"ok","timestamp":"2024-...","uptime":123.456}
\`\`\`
💡 **Aprenderás**: Usar curl para probar APIs sin frontend

---

## ✅ Criterios de Aceptación

- [ ] GET /api/health retorna status 200
- [ ] La respuesta incluye { status: 'ok' }
- [ ] La respuesta incluye timestamp
- [ ] curl funciona correctamente

---

## 🎓 Reflexión Post-Tarea

1. ¿Por qué el endpoint es GET y no POST?
2. ¿Qué status code retornarías si la base de datos estuviera caída?
3. ¿Por qué separamos las rutas en archivos diferentes?
4. ¿Qué información adicional podría ser útil en un health check?

---

## 📈 Tu Progreso

\`\`\`
Tarea 5 de 24
[█████░░░░░░░░░░░░░░░░░░░] 21%

Conceptos dominados: 8
Nuevos en esta tarea:
- ✅ API REST Basics
- ✅ HTTP Methods
- ✅ Status Codes
\`\`\`
```

### Mapa de Aprendizaje Visual

```typescript
class LearningPathVisualizer {
  generateLearningMap(completedTasks: number): string {
    return `
# 🗺️ Tu Mapa de Aprendizaje

\`\`\`
                           🎓 NIVEL 4: Producción
                          ┌─────────────────────┐
                          │ □ Deployment        │
                          │ □ Monitoring        │
                          └──────────┬──────────┘
                                     │
                           🎓 NIVEL 3: Avanzado
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
   ┌──────┴──────┐           ┌───────┴───────┐          ┌───────┴───────┐
   │ ✅ CI/CD    │           │ □ Auth JWT    │          │ □ Testing Int │
   └──────┬──────┘           └───────┬───────┘          └───────┬───────┘
          │                          │                          │
                           🎓 NIVEL 2: Intermedio
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
   ┌──────┴──────┐           ┌───────┴───────┐          ┌───────┴───────┐
   │ ✅ API REST │           │ ✅ Database   │          │ □ Unit Tests  │
   └──────┬──────┘           └───────┬───────┘          └───────┬───────┘
          │                          │                          │
                           🎓 NIVEL 1: Fundamentos
          ┌──────────────────────────┼──────────────────────────┐
          │                          │                          │
   ┌──────┴──────┐           ┌───────┴───────┐          ┌───────┴───────┐
   │ ✅ Docker   │           │ ✅ Env Vars   │          │ ✅ Git Flow   │
   └─────────────┘           └───────────────┘          └───────────────┘

✅ = Dominado    □ = Por aprender    🔄 = En progreso
\`\`\`

## 📊 Estadísticas de Aprendizaje

| Nivel | Conceptos | Completados | Progreso |
|-------|-----------|-------------|----------|
| 1. Fundamentos | 3 | 3 | ████████████ 100% |
| 2. Intermedio | 3 | 2 | ████████░░░░ 67% |
| 3. Avanzado | 3 | 1 | ████░░░░░░░░ 33% |
| 4. Producción | 2 | 0 | ░░░░░░░░░░░░ 0% |

**Total: 6/11 conceptos dominados (55%)**
`;
  }
}
```

---

## 🎯 Salida Esperada del Nuevo Plan

```
🚀 Freelance Project Planner v3.0
📦 Filosofía: Infrastructure First + Aprendizaje Progresivo
=====================================

📊 FASE 0: Análisis del Proyecto
---------------------------------
✅ Proyecto: mi-ecommerce-app
✅ Tech Stack: Next.js + PostgreSQL + Redis
✅ Completitud: 45%

🐳 FASE 1: Dockerización (PRIORIDAD MÁXIMA)
---------------------------------
✅ Dockerfile creado (multi-stage)
✅ docker-compose.dev.yml creado
✅ docker-compose.prod.yml creado
✅ .dockerignore optimizado

⚙️  FASE 2: GitHub Actions (CI/CD)
---------------------------------
✅ .github/workflows/ci.yml
✅ .github/workflows/docker-build.yml
✅ .github/workflows/deploy.yml

📋 FASE 3: Issues con APRENDIZAJE PROGRESIVO
---------------------------------
✅ 24 issues creados con estructura de aprendizaje:

   Cada issue incluye:
   ├── 🎯 Objetivo de la tarea
   ├── 📚 Lo que aprenderás (conceptos nuevos)
   ├── 🔗 Conexión con tareas anteriores
   ├── 📖 Contexto just-in-time (explicación cuando la necesitas)
   ├── 🛠️ Pasos con notas de aprendizaje
   ├── ✅ Criterios de aceptación
   ├── 🎓 Reflexión post-tarea
   └── 📈 Barra de progreso visual

📚 Mapa de Aprendizaje Generado:
---------------------------------
   NIVEL 1 (Fundamentos):
   └── Docker Basics → Docker Compose → Env Variables → Git Flow
   
   NIVEL 2 (Intermedio):
   └── API REST → Database Basics → Unit Testing
   
   NIVEL 3 (Avanzado):
   └── Authentication → Integration Tests → CI/CD
   
   NIVEL 4 (Producción):
   └── Deployment → Monitoring

🗺️ Ruta de Aprendizaje:
---------------------------------
   Tarea 1: Docker Setup
   └── 📚 Aprende: Docker, Compose, Env Vars
   
   Tarea 2: Estructura del Proyecto
   └── 📚 Aprende: Arquitectura, Convenciones
   └── 🔗 Usa: Docker (Tarea 1)
   
   Tarea 3: Primer Endpoint
   └── 📚 Aprende: REST, HTTP Methods, Status Codes
   └── 🔗 Usa: Docker + Estructura
   
   Tarea 4: Conexión a Base de Datos
   └── 📚 Aprende: SQL, ORM, Migrations
   └── 🔗 Usa: Docker + Endpoints
   
   ... y así sucesivamente

=====================================
✅ ¡Setup Completado!

🎓 Enfoque de Aprendizaje:
   - Cada tarea introduce conceptos CUANDO los necesitas
   - Explicaciones "just-in-time", no antes
   - Conexión clara entre lo que ya sabes y lo nuevo
   - Reflexión al final para consolidar conocimiento
   - Barra de progreso visual de conceptos dominados

📋 Primera tarea recomendada:
   #1 - Setup Docker
   └── 📚 Aprenderás: Docker Basics, Compose, Env Variables
=====================================
```

---

## 🔑 Resumen de Cambios

| Antes | Ahora |
|-------|-------|
| 1. Análisis | 0. Análisis |
| 2. Estabilización | **1. 🐳 Docker (PRIORIDAD MÁXIMA)** |
| 3. CI/CD | **2. ⚙️ GitHub Actions (SEGUNDA PRIORIDAD)** |
| 4. Issues/Backlog | **3. 📚 Issues con APRENDIZAJE PROGRESIVO** |
| 5. Desarrollo | 4. Desarrollo |
| 6. Documentación estática | **Integrada en cada tarea** |

### 📚 Enfoque de Aprendizaje Progresivo

| Tradicional | Progresivo (Este agente) |
|-------------|--------------------------|
| 📖 Leer toda la documentación al inicio | 📚 Aprender cuando lo necesitas |
| 😫 Olvidar el 80% antes de usarlo | 🧠 Retención alta por contexto |
| 📄 Documentación separada del código | 🔗 Aprendizaje integrado en tareas |
| ❓ "¿Para qué era esto?" | 💡 "Necesito esto AHORA para mi tarea" |

### Estructura de Cada Issue/Tarea

```markdown
## 🎯 Objetivo
[Qué vas a construir]

## 📚 Lo que Aprenderás
[Conceptos nuevos - SOLO cuando los necesitas]

## 🔗 Conexión con lo Anterior
[Cómo se relaciona con tareas previas]

## 📖 Contexto Just-in-Time
[Mini-explicación de conceptos cuando los necesitas]

## 🛠️ Pasos
[Con notas de aprendizaje en cada paso]

## 🎓 Reflexión Post-Tarea
[Preguntas para consolidar el conocimiento]

## 📈 Tu Progreso
[Barra visual de conceptos dominados]
```

El plan ahora garantiza que:
1. **Docker** - Entorno reproducible desde el día 1
2. **GitHub Actions** - Feedback automático en cada push
3. **Aprendizaje Progresivo** - Cada tarea enseña conceptos cuando son relevantes

**El resultado**: Un desarrollador que no solo completa tareas, sino que **entiende** lo que está haciendo y **por qué**.