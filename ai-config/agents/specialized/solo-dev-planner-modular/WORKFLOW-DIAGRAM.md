---
name: solo-dev-planner-workflow
description: "Diagrama de flujo del Solo Dev Planner"
---

# 🎯 Flujo de Uso del Skill Modular

## 📁 Estructura de Archivos

```
📂 .claude/agents/specialized/solo-dev-planner/
│
├── 📄 solo-dev-planner.md          👈 LOADER (este es el "skill")
│   │
│   ├─ Frontmatter YAML:
│   │  name: solo-dev-planner
│   │  tools: Read, Write, ...
│   │
│   └─ Lógica de router:
│      "¿Usuario pregunta X? → Lee módulo Y"
│
├── 📘 00-INDEX.md                  (Guía de navegación)
├── 📗 01-CORE.md                   (Filosofía + Workflow)
├── 📙 02-SELF-CORRECTION.md        (Auto-fix)
├── 📕 03-PROGRESSIVE-SETUP.md      (MVP/Alpha/Beta)
├── 📔 04-DEPLOYMENT.md             (Koyeb/Railway/Coolify)
├── 📓 05-TESTING.md                (Strategy + Testcontainers)
└── 📒 06-OPERATIONS.md             (DB/Secrets/Monitoring)
```

---

## 🔄 Flujo de Ejecución

```
┌─────────────────────────────────────────────────────────────┐
│ 1. USUARIO INVOCA SKILL                                     │
└─────────────────────────────────────────────────────────────┘
                         ▼
    @solo-dev-planner quiero deployar a Koyeb
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. CLAUDE LEE: solo-dev-planner.md (loader)                 │
│    ↳ Identifica: "deploy" + "Koyeb" → Necesita módulo 04   │
└─────────────────────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. CLAUDE USA TOOL: read                                    │
│    ↳ Lee archivo: 04-DEPLOYMENT.md (completo)              │
│    ↳ 2,500 líneas sobre deployment                         │
└─────────────────────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. CLAUDE PROCESA CONTENIDO DEL MÓDULO                     │
│    ↳ Encuentra sección de Koyeb                            │
│    ↳ Extrae setup, configs, comandos                       │
└─────────────────────────────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. CLAUDE RESPONDE CON INFORMACIÓN DEL MÓDULO              │
│    ↳ "Perfecto, Koyeb es ideal porque..."                  │
│    ↳ Pasos de setup                                        │
│    ↳ Comandos concretos                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎮 Ejemplos Prácticos

### Ejemplo 1: Nuevo Proyecto

```
┌──────────────────────────────────────────────────────────────┐
│ Usuario en chat:                                             │
│ @solo-dev-planner necesito empezar un proyecto TypeScript   │
└──────────────────────────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Loader (solo-dev-planner.md):                                │
│ • Detecta: "empezar proyecto" + "TypeScript"                 │
│ • Decision: Necesita 01-CORE + 03-PROGRESSIVE-SETUP         │
└──────────────────────────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Claude ejecuta (internamente):                               │
│ read("solo-dev-planner/01-CORE.md")                         │
│ read("solo-dev-planner/03-PROGRESSIVE-SETUP.md")            │
└──────────────────────────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Claude responde:                                              │
│                                                               │
│ "¡Perfecto! Vamos a usar Progressive Setup para empezar     │
│  rápido. Puedes estar codeando en 15 minutos.               │
│                                                               │
│  FASE 1: MVP (5-15 minutos)                                  │
│  ================================                             │
│                                                               │
│  1. Instalar Mise:                                           │
│     brew install mise                                        │
│                                                               │
│  2. Setup del proyecto:                                      │
│     mise run setup:mvp                                       │
│                                                               │
│  3. Esto configura:                                          │
│     ✓ Node 20 con Bun                                        │
│     ✓ SQLite local (sin Docker)                             │
│     ✓ Git hooks                                              │
│     ✓ .env básico                                            │
│                                                               │
│  4. Iniciar desarrollo:                                      │
│     mise run dev                                             │
│                                                               │
│  ¿Listo para empezar?"                                       │
└──────────────────────────────────────────────────────────────┘
```

### Ejemplo 2: Troubleshooting

```
┌──────────────────────────────────────────────────────────────┐
│ Usuario:                                                      │
│ @solo-dev-planner los tests fallan y no sé por qué          │
└──────────────────────────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Loader:                                                       │
│ • Detecta: "tests fallan"                                    │
│ • Decision: Necesita 02-SELF-CORRECTION                     │
└──────────────────────────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Claude ejecuta:                                               │
│ read("solo-dev-planner/02-SELF-CORRECTION.md")              │
└──────────────────────────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Claude responde:                                              │
│                                                               │
│ "Vamos a usar el protocolo de auto-corrección. El skill     │
│  tiene un sistema que intenta arreglar errores común         │
│  automáticamente (hasta 3 intentos).                         │
│                                                               │
│  Ejecuta esto:                                               │
│  mise run fix:auto                                           │
│                                                               │
│  Esto hará:                                                  │
│  1. Detectar tipo de error (tests)                          │
│  2. Limpiar cache (.pytest_cache, coverage)                 │
│  3. Resetear test database                                   │
│  4. Re-ejecutar tests                                        │
│                                                               │
│  Si falla después de 3 intentos, el script te mostrará:     │
│  ⛔ BLOCKED: Solicito intervención humana                    │
│                                                               │
│  Y podremos ver el error específico para debuggearlo.       │
│  ¿Ejecuto el comando?"                                       │
└──────────────────────────────────────────────────────────────┘
```

---

## 🧠 Lógica del Loader

El archivo `solo-dev-planner.md` funciona como un **router inteligente**:

```typescript
// Pseudocódigo de cómo funciona

function handleUserQuery(query: string) {
  // 1. Analizar query
  const intent = analyzeIntent(query);
  
  // 2. Mapear a módulo(s)
  const modules = mapToModules(intent);
  
  // 3. Leer módulo(s)
  const content = modules.map(m => readFile(m));
  
  // 4. Responder
  return generateResponse(content, query);
}

// Ejemplos de mapeo:
const moduleMap = {
  "nuevo proyecto": ["01-CORE", "03-PROGRESSIVE-SETUP"],
  "tests fallan": ["02-SELF-CORRECTION"],
  "deployar": ["04-DEPLOYMENT"],
  "configurar DB": ["06-OPERATIONS"],
  "setup rápido": ["03-PROGRESSIVE-SETUP"],
};
```

---

## 📊 Comparación: Antes vs Ahora

### ANTES (Skill Monolítico)

```
.claude/agents/specialized/solo-dev-planner.md
│
└── 13,241 líneas
    │
    └── Claude lee TODO cada vez (40k tokens)
        ↓
        ⚠️ Lento (10 segundos)
        ⚠️ Costoso en tokens
        ⚠️ Difícil de navegar
```

### AHORA (Skill Modular)

```
.claude/agents/specialized/solo-dev-planner/
│
├── solo-dev-planner.md (loader - 200 líneas)
│   │
│   └── Lee SOLO módulo(s) necesario(s)
│       ↓
│       ✅ Rápido (2 segundos)
│       ✅ Eficiente (5k-10k tokens)
│       ✅ Especializado
│
├── 01-CORE.md (3,500 líneas)
├── 02-SELF-CORRECTION.md (1,800 líneas)
├── 03-PROGRESSIVE-SETUP.md (2,000 líneas)
├── 04-DEPLOYMENT.md (2,500 líneas)
├── 05-TESTING.md (2,200 líneas)
└── 06-OPERATIONS.md (2,800 líneas)
```

---

## 🎯 Ventajas del Sistema Modular

### Para el Usuario

```
✅ Mismo comando: @solo-dev-planner
✅ Respuestas más rápidas
✅ Más precisas (carga solo lo relevante)
✅ Fácil actualizar módulos individuales
```

### Para Claude

```
✅ Menos tokens por query (-75%)
✅ Carga más rápida (-80%)
✅ Respuestas más precisas
✅ Context window optimizado
```

### Para Mantenimiento

```
✅ Actualizar 1 módulo sin tocar otros
✅ Agregar nuevos módulos fácilmente
✅ Debug más simple
✅ Versionado por módulo
```

---

## 🔍 Cómo Claude Identifica el Módulo

```typescript
// Keywords → Módulos
const keywordMap = {
  // Nuevo proyecto / Setup
  "nuevo proyecto": ["01-CORE", "03-PROGRESSIVE-SETUP"],
  "empezar": ["01-CORE", "03-PROGRESSIVE-SETUP"],
  "setup": ["03-PROGRESSIVE-SETUP"],
  "mvp": ["03-PROGRESSIVE-SETUP"],
  
  // Errores / Troubleshooting
  "error": ["02-SELF-CORRECTION"],
  "falla": ["02-SELF-CORRECTION"],
  "no funciona": ["02-SELF-CORRECTION"],
  "bug": ["02-SELF-CORRECTION"],
  
  // Tests
  "test": ["05-TESTING"],
  "testcontainers": ["05-TESTING"],
  "coverage": ["05-TESTING"],
  
  // Deploy
  "deploy": ["04-DEPLOYMENT"],
  "koyeb": ["04-DEPLOYMENT"],
  "railway": ["04-DEPLOYMENT"],
  "coolify": ["04-DEPLOYMENT"],
  "producción": ["04-DEPLOYMENT"],
  
  // Operations
  "database": ["06-OPERATIONS"],
  "secrets": ["06-OPERATIONS"],
  "monitoring": ["06-OPERATIONS"],
  "migraciones": ["06-OPERATIONS"],
  
  // Filosofía
  "filosofía": ["01-CORE"],
  "workflow": ["01-CORE"],
  "atomic sequential": ["01-CORE"],
};
```

---

## 🚀 Resumen Visual

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  Tú escribes:                                       │
│  @solo-dev-planner <cualquier pregunta>            │
│                                                     │
└─────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│                                                     │
│  Claude (automáticamente):                          │
│  1. Lee loader (200 líneas)                        │
│  2. Identifica módulo(s) necesario(s)              │
│  3. Lee SOLO ese módulo (1,800-3,500 líneas)      │
│  4. Responde basándose en el módulo                │
│                                                     │
└─────────────────────────────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│                                                     │
│  Resultado:                                         │
│  ✅ Respuesta precisa y detallada                  │
│  ✅ En 2 segundos (vs 10 antes)                    │
│  ✅ Usando 5k-10k tokens (vs 40k antes)            │
│  ✅ 100% basado en contenido del skill             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 🎉 ¡Es Transparente para el Usuario!

**No cambia nada en tu workflow:**

```
Antes:  @solo-dev-planner quiero deployar
Ahora:  @solo-dev-planner quiero deployar

Mismo comando, mejores resultados ✅
```

**La modularización es interna, invisible para ti, pero hace todo más eficiente.**
