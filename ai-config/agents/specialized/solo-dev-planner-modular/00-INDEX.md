---
name: solo-dev-planner
description: "Agente optimizado para solo developers. Modular: carga solo lo que necesitas. Filosofía Speedrun con Atomic Sequential Merges. Production-ready desde día 1."
category: specialized
color: cyan
tools: Write, Read, MultiEdit, Bash, Grep, Glob
model: opus
---

# 🚀 Solo Dev Planner - Skill Modular

## 📚 Estructura del Skill

Este skill está dividido en **6 módulos especializados** + este índice maestro. Carga solo los módulos que necesites para cada sesión.

```
solo-dev-planner/
├── 00-INDEX.md                    ← Estás aquí
├── 01-CORE.md                     → Filosofía + Atomic Sequential
├── 02-SELF-CORRECTION.md          → Auto-fix protocol
├── 03-PROGRESSIVE-SETUP.md        → Setup en 3 fases (MVP/Alpha/Beta)
├── 04-DEPLOYMENT.md               → Koyeb, Railway, Coolify
├── 05-TESTING.md                  → Strategy + Testcontainers
└── 06-OPERATIONS.md               → Monitoring, Secrets, DB, Mise
```

---

## 🎯 Guía Rápida: ¿Qué Módulo Necesito?

### Para Comenzar un Proyecto Nuevo
```
Leer: 01-CORE.md + 03-PROGRESSIVE-SETUP.md
→ Entender filosofía + Setup rápido (15 min)
```

### Para Configurar CI/CD y Deployment
```
Leer: 04-DEPLOYMENT.md
→ Koyeb/Railway/Coolify completo
```

### Para Mejorar Tests
```
Leer: 05-TESTING.md
→ Strategy + Testcontainers
```

### Para Troubleshooting
```
Leer: 02-SELF-CORRECTION.md
→ Auto-fix de errores comunes
```

### Para Operaciones (DB, Secrets, Monitoring)
```
Leer: 06-OPERATIONS.md
→ Migrations, Secrets, Monitoring, Mise
```

---

## 📋 Contenido de Cada Módulo

### 01-CORE.md (~3,500 líneas)
**Filosofía y Workflow Core**

```
✓ Filosofía "Speedrun"
✓ Atomic Sequential Merges (explicación completa)
✓ Stacks modernos (TypeScript, Python, Go, Java)
✓ Configuración del agente
✓ Rutina diaria del desarrollador
✓ Git workflow simplificado
✓ CI/CD adaptativo
✓ Changelog automático
✓ Feature flags
```

**Cuándo leer:** 
- Comenzando proyecto nuevo
- Entender la filosofía del skill
- Configurar workflow de desarrollo

---

### 02-SELF-CORRECTION.md (~1,800 líneas)
**Autonomía y Auto-Fix**

```
✓ Protocolo de auto-corrección (3 intentos)
✓ Categorías de errores (lint, imports, DB, tests, types)
✓ Scripts auto-fix completos
✓ Context script para Claude Code (< 500 tokens)
✓ Logging de intentos
✓ Git hooks con recovery automático
✓ Mise tasks con retry logic
```

**Cuándo leer:**
- Tests fallan repetidamente
- Lint errors bloquean commits
- Database connection issues
- Optimizar para Claude Code

---

### 03-PROGRESSIVE-SETUP.md (~2,000 líneas)
**Setup en 3 Fases**

```
✓ FASE 1: MVP (5-15 minutos)
  - SQLite local, sin Docker
  - Git hooks básicos
  - Listo para codear

✓ FASE 2: Alpha (1 hora)
  - Docker + PostgreSQL
  - CI/CD básico
  - Redis incluido

✓ FASE 3: Beta (2-3 horas)
  - Deployment configurado
  - Monitoring + Error tracking
  - Secrets management
  - Production-ready
```

**Cuándo leer:**
- Setup inicial del proyecto
- Upgrade de MVP a producción
- Onboarding de nuevo desarrollador

---

### 04-DEPLOYMENT.md (~2,500 líneas)
**Deploy Simple y Económico**

```
✓ Koyeb (Global Edge) ⭐
  - Free tier generoso
  - 6 regiones globales
  - Setup completo

✓ Railway (Simplicidad)
  - UI intuitiva
  - $5/mes
  - PostgreSQL 1-click

✓ Coolify (Self-Hosted)
  - €5/mes en Hetzner
  - Control total
  - Setup paso a paso

✓ Comparativa de costos
✓ Secrets management por plataforma
✓ GitHub Actions integration
✓ Mise tasks universales
```

**Cuándo leer:**
- Listo para deployar MVP
- Elegir plataforma de hosting
- Configurar CI/CD para deploy
- Migrar de plataforma

---

### 05-TESTING.md (~2,200 líneas)
**Testing Robusto**

```
✓ Testing Strategy Completa
  - Pirámide 70/20/10
  - Unit tests por lenguaje
  - Integration tests
  - E2E con Playwright

✓ Testcontainers (DB Real)
  - TypeScript + Bun setup
  - Python + pytest setup
  - Go + testcontainers-go
  - Performance tips

✓ Test Data Factories
✓ Coverage configuration
✓ Mise tasks para testing
✓ Best practices
```

**Cuándo leer:**
- Configurar suite de tests
- Migrar de mocks a tests reales
- Mejorar coverage
- Setup de Testcontainers

---

### 06-OPERATIONS.md (~2,800 líneas)
**Operaciones y DevOps**

```
✓ Database Migrations
  - Drizzle (TypeScript)
  - Alembic (Python)
  - golang-migrate (Go)
  - Flyway (Java)

✓ Secrets Management
  - 4 niveles (local → production)
  - Doppler/Infisical
  - GitHub Secrets
  - AWS Secrets Manager

✓ Monitoring & Observability
  - Structured logging (Pino, structlog, Zap)
  - Health checks avanzados
  - Prometheus metrics
  - Sentry error tracking
  - OpenTelemetry APM

✓ Mise (Version Manager)
  - Setup completo
  - Tasks universales
  - Git hooks
  - Workflow automation

✓ Local Dev Experience
  - Hot reload por lenguaje
  - Database GUI tools
  - Docker Compose
  - Debug configurations
```

**Cuándo leer:**
- Configurar base de datos
- Setup de secrets
- Implementar monitoring
- Troubleshooting de producción
- Configurar Mise

---

## 🎮 Workflows Comunes

### 1. Nuevo Proyecto desde Cero

```bash
# Día 1: MVP
Leer: 01-CORE.md (sección Filosofía)
Leer: 03-PROGRESSIVE-SETUP.md (FASE 1: MVP)
Ejecutar: mise run setup:mvp
Tiempo: 30 minutos

# Día 2-3: Desarrollo
Leer: 05-TESTING.md (Unit tests)
Leer: 06-OPERATIONS.md (Mise tasks)
Tiempo: Desarrollo normal

# Semana 1: Alpha
Leer: 03-PROGRESSIVE-SETUP.md (FASE 2: Alpha)
Ejecutar: mise run setup:alpha
Tiempo: 1 hora

# Pre-Launch: Beta
Leer: 03-PROGRESSIVE-SETUP.md (FASE 3: Beta)
Leer: 04-DEPLOYMENT.md (Koyeb/Railway)
Ejecutar: mise run setup:beta
Tiempo: 2-3 horas
```

### 2. Troubleshooting de Errores

```bash
# Error en tests
Leer: 02-SELF-CORRECTION.md (Auto-fix tests)
Ejecutar: mise run fix:auto

# Error de lint
Leer: 02-SELF-CORRECTION.md (Auto-fix lint)
Ejecutar: bash scripts/auto-fix.sh lint

# Error de DB
Leer: 02-SELF-CORRECTION.md (Auto-fix database)
Leer: 06-OPERATIONS.md (Database Migrations)
Ejecutar: mise run fix:database
```

### 3. Deploy a Producción

```bash
# Elegir plataforma
Leer: 04-DEPLOYMENT.md (Comparativa completa)

# Setup deployment
Leer: 04-DEPLOYMENT.md (sección de tu plataforma)
Ejecutar: mise run deploy:setup:koyeb  # O railway/coolify

# Configurar secrets
Leer: 06-OPERATIONS.md (Secrets Management)

# Deploy
Ejecutar: mise run deploy
```

### 4. Mejorar Testing

```bash
# Entender strategy
Leer: 05-TESTING.md (Pirámide de testing)

# Agregar Testcontainers
Leer: 05-TESTING.md (Testcontainers por lenguaje)
Implementar setup

# Ejecutar
Ejecutar: mise run test:integration:tc
```

---

## 📊 Comparación: Modular vs Monolítico

| Aspecto | Monolítico (13k líneas) | Modular (6 archivos) |
|---------|-------------------------|----------------------|
| **Tamaño por archivo** | 13,241 líneas | 1,800-3,500 líneas |
| **Tokens por carga** | ~40,000 tokens | ~5,000-10,000 tokens |
| **Tiempo de carga** | ~10 segundos | ~2 segundos |
| **Navegación** | Difícil | Fácil por módulo |
| **Mantenimiento** | Complejo | Simple |
| **Para Claude Code** | Lento | Óptimo ✅ |

---

## 🎯 Recomendaciones de Uso

### Para Claude Projects
```
Opción A: Cargar módulo específico según necesidad
→ Más eficiente, menos tokens

Opción B: Cargar 2-3 módulos relacionados
→ Contexto completo para tarea específica

Opción C: Cargar todo (raramente necesario)
→ Solo para entender skill completo
```

### Para Claude Code
```
SIEMPRE usar modular:
→ Carga 01-CORE.md + módulo específico
→ Usa 02-SELF-CORRECTION.md para troubleshooting
→ Context window optimizado
```

---

## 🔄 Módulos Interdependientes

```
Dependencias:
├── Todos dependen de: 01-CORE.md
├── 03-PROGRESSIVE-SETUP.md usa:
│   ├── 02-SELF-CORRECTION.md (git hooks)
│   ├── 04-DEPLOYMENT.md (fase beta)
│   └── 06-OPERATIONS.md (mise, DB)
├── 04-DEPLOYMENT.md usa:
│   └── 06-OPERATIONS.md (secrets)
└── 05-TESTING.md usa:
    └── 06-OPERATIONS.md (mise tasks)

Orden recomendado de lectura:
1. 01-CORE.md (siempre primero)
2. Módulo específico según tarea
3. Módulos relacionados si necesario
```

---

## 📝 Resumen Ejecutivo de Cada Módulo

| Módulo | Tamaño | Para Qué | Cuándo |
|--------|--------|----------|--------|
| **01-CORE** | ~3,500 | Filosofía + Workflow | Siempre (base) |
| **02-SELF-CORRECTION** | ~1,800 | Auto-fix + Context | Troubleshooting |
| **03-PROGRESSIVE-SETUP** | ~2,000 | Setup rápido | Nuevo proyecto |
| **04-DEPLOYMENT** | ~2,500 | Deploy económico | Pre-launch |
| **05-TESTING** | ~2,200 | Tests robustos | Calidad código |
| **06-OPERATIONS** | ~2,800 | DB/Secrets/Monitoring | Operaciones |

---

## 🚀 Quick Start por Escenario

### Escenario 1: "Quiero empezar un proyecto YA"
```
1. Lee: 01-CORE.md (Filosofía, 10 min)
2. Lee: 03-PROGRESSIVE-SETUP.md (MVP, 5 min)
3. Ejecuta: mise run setup:mvp
4. Codea!
```

### Escenario 2: "Tengo errores que no puedo resolver"
```
1. Lee: 02-SELF-CORRECTION.md (completo)
2. Ejecuta: mise run fix:auto
3. Si falla 3x → Revisa logs en .auto-fix-log.txt
```

### Escenario 3: "Listo para producción"
```
1. Lee: 04-DEPLOYMENT.md (comparativa)
2. Elige plataforma (Koyeb recomendado)
3. Lee: 06-OPERATIONS.md (secrets)
4. Ejecuta: mise run deploy:setup:koyeb
5. Deploy: mise run deploy
```

### Escenario 4: "Quiero CI/CD enterprise-grade"
```
1. Lee: 01-CORE.md (CI/CD section)
2. Lee: 05-TESTING.md (completo)
3. Lee: 06-OPERATIONS.md (monitoring)
4. Implementa strategy completa
```

---

## 💡 Tips para Máxima Eficiencia

### Tip 1: Carga Incremental
```
No cargues todo de una vez.
→ Empieza con 01-CORE.md
→ Agrega módulos según avanzas
```

### Tip 2: Bookmark Secciones
```
Cada módulo tiene tabla de contenidos.
→ Navega directo a lo que necesitas
```

### Tip 3: Context Window Management
```
Para Claude Code:
→ Máximo 2-3 módulos simultáneos
→ Usa 02-SELF-CORRECTION.md context script
→ Reduce tokens dramáticamente
```

### Tip 4: Workflow Documentation
```
Documenta qué módulos usaste para qué:
→ README.md lista módulos activos
→ Onboarding más fácil
```

---

## 📚 Índice Detallado por Módulo

Ver cada módulo individual para tabla de contenidos completa.

**Total: ~14,800 líneas distribuidas en 6 módulos + índice**

---

## 🎉 Ventajas del Skill Modular

```
✅ Carga más rápida (2s vs 10s)
✅ Menos tokens consumidos (-75%)
✅ Navegación más fácil
✅ Mantenimiento simple
✅ Especialización por tarea
✅ Perfect para Claude Code
✅ Escalable a futuro
✅ Cada módulo es autocontenido
```

---

**Empieza leyendo `01-CORE.md` para entender la filosofía base, luego carga módulos según necesites.** 🚀
