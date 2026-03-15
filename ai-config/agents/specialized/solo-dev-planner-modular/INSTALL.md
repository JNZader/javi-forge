---
name: solo-dev-planner-install
description: "Guía de instalación del Solo Dev Planner"
---

# 📦 Guía de Instalación - Solo Dev Planner Modular

## 🎯 Opción 1: Skill Modular con Loader (RECOMENDADO)

### Estructura de Carpetas

```
.claude/
└── agents/
    └── specialized/
        └── solo-dev-planner/              ← Crear esta carpeta
            ├── solo-dev-planner.md        ← Loader principal
            ├── 00-INDEX.md
            ├── 01-CORE.md
            ├── 02-SELF-CORRECTION.md
            ├── 03-PROGRESSIVE-SETUP.md
            ├── 04-DEPLOYMENT.md
            ├── 05-TESTING.md
            └── 06-OPERATIONS.md
```

### Pasos de Instalación

#### 1. Crear Carpeta

```bash
# Windows (PowerShell)
mkdir -p "$env:USERPROFILE\.claude\agents\specialized\solo-dev-planner"

# macOS/Linux
mkdir -p ~/.claude/agents/specialized/solo-dev-planner
```

#### 2. Copiar Archivos

Copia todos los archivos de `solo-dev-planner-modular/` a la carpeta creada:

```bash
# Windows (PowerShell)
Copy-Item -Path ".\solo-dev-planner-modular\*" -Destination "$env:USERPROFILE\.claude\agents\specialized\solo-dev-planner\" -Recurse

# macOS/Linux
cp -r solo-dev-planner-modular/* ~/.claude/agents/specialized/solo-dev-planner/
```

#### 3. Verificar Instalación

```bash
# Windows
dir "$env:USERPROFILE\.claude\agents\specialized\solo-dev-planner"

# macOS/Linux
ls -la ~/.claude/agents/specialized/solo-dev-planner/
```

**Deberías ver:**
```
solo-dev-planner.md           ← Loader principal
00-INDEX.md
01-CORE.md
02-SELF-CORRECTION.md
03-PROGRESSIVE-SETUP.md
04-DEPLOYMENT.md
05-TESTING.md
06-OPERATIONS.md
README.md
```

### Uso

```
Usuario: @solo-dev-planner quiero empezar un proyecto nuevo

Claude:
1. Lee solo-dev-planner.md (identifica módulos necesarios)
2. Carga 01-CORE.md + 03-PROGRESSIVE-SETUP.md
3. Responde basándose en esos módulos
```

---

## 🎯 Opción 2: Skill Único Consolidado (ALTERNATIVA)

Si prefieres el enfoque tradicional (un solo archivo):

### Estructura

```
.claude/
└── agents/
    └── specialized/
        └── solo-dev-planner.md            ← Un solo archivo
```

### Pasos

1. **Usar el archivo monolítico:**
```bash
# Copia solo-dev-planner-v2.md
cp solo-dev-planner-v2.md ~/.claude/agents/specialized/solo-dev-planner.md
```

2. **Uso:**
```
@solo-dev-planner quiero empezar un proyecto
```

**Ventajas:**
- ✅ Más simple (1 archivo)
- ✅ Funciona como antes

**Desventajas:**
- ❌ 13k líneas (lento)
- ❌ Más tokens consumidos
- ❌ Menos navegable

---

## 🎯 Opción 3: Multi-Skills (AVANZADO)

Crear un skill separado por módulo:

### Estructura

```
.claude/agents/specialized/
├── solo-dev-core.md              ← 01-CORE
├── solo-dev-selfcorrection.md    ← 02-SELF-CORRECTION
├── solo-dev-setup.md             ← 03-PROGRESSIVE-SETUP
├── solo-dev-deployment.md        ← 04-DEPLOYMENT
├── solo-dev-testing.md           ← 05-TESTING
└── solo-dev-operations.md        ← 06-OPERATIONS
```

### Uso

```
@solo-dev-core explica la filosofía
@solo-dev-deployment cómo deployar a Koyeb
@solo-dev-testing configura testcontainers
```

**Ventajas:**
- ✅ Máxima especialización
- ✅ Mínimos tokens por skill

**Desventajas:**
- ❌ 6 skills diferentes
- ❌ Usuario tiene que recordar cuál usar

---

## 📊 Comparación de Opciones

| Aspecto | Opción 1: Modular | Opción 2: Monolítico | Opción 3: Multi-Skills |
|---------|-------------------|----------------------|------------------------|
| **Archivos** | 1 carpeta, 8 files | 1 archivo | 6 archivos |
| **Comando** | @solo-dev-planner | @solo-dev-planner | @solo-dev-core, etc |
| **Tokens/sesión** | 5k-10k | 40k | 3k-8k |
| **Navegación** | ✅ Fácil | ⚠️ Difícil | ✅ Muy fácil |
| **Mantenimiento** | ✅ Simple | ⚠️ Complejo | ✅ Simple |
| **Setup** | ⚠️ Carpeta | ✅ 1 archivo | ⚠️ 6 archivos |
| **Recomendado para** | Uso general | Simplicidad | Power users |

---

## 🚀 **Recomendación Final**

### **Para la mayoría de usuarios: Opción 1 (Modular)**

```bash
# 1. Crear carpeta
mkdir -p ~/.claude/agents/specialized/solo-dev-planner

# 2. Copiar todo
cp -r solo-dev-planner-modular/* ~/.claude/agents/specialized/solo-dev-planner/

# 3. Usar
@solo-dev-planner <tu pregunta>
```

**Claude automáticamente:**
- ✅ Identifica qué módulo necesitas
- ✅ Lee solo ese módulo
- ✅ Responde eficientemente

---

## 🎮 Ejemplos de Uso (Opción 1)

### Ejemplo 1: Nuevo Proyecto

```
Tú: @solo-dev-planner quiero empezar un proyecto TypeScript desde cero

Claude:
1. Identifica: Necesita 01-CORE + 03-PROGRESSIVE-SETUP
2. Lee ambos módulos
3. Responde: "Perfecto, vamos a usar Progressive Setup..."
   → Explica FASE 1: MVP (15 min)
   → Da comandos concretos
```

### Ejemplo 2: Troubleshooting

```
Tú: @solo-dev-planner mis tests están fallando y no sé por qué

Claude:
1. Identifica: Necesita 02-SELF-CORRECTION
2. Lee módulo completo
3. Responde: "Vamos a usar el auto-fix protocol..."
   → Ejecuta: mise run fix:auto
   → Explica el proceso de 3 intentos
```

### Ejemplo 3: Deploy

```
Tú: @solo-dev-planner listo para deployar, cuál plataforma recomendás?

Claude:
1. Identifica: Necesita 04-DEPLOYMENT
2. Lee módulo completo
3. Responde: "Te recomiendo Koyeb porque..."
   → Compara Koyeb vs Railway vs Coolify
   → Setup paso a paso
```

---

## 🔧 Troubleshooting de Instalación

### Problema: "No encuentro la carpeta .claude"

**Solución:**
```bash
# Crearla manualmente
mkdir -p ~/.claude/agents/specialized

# O en Windows
mkdir "$env:USERPROFILE\.claude\agents\specialized"
```

### Problema: "@solo-dev-planner no funciona"

**Verificaciones:**
1. ¿Está el archivo loader `solo-dev-planner.md` en la carpeta?
2. ¿Tiene el frontmatter YAML correcto?
3. ¿Están todos los módulos en la misma carpeta?

**Verificar estructura:**
```bash
ls ~/.claude/agents/specialized/solo-dev-planner/
```

### Problema: "Claude no carga los módulos"

**Causa:** El loader debe usar herramienta `read` para leer módulos.

**Solución:** Asegúrate que `solo-dev-planner.md` tiene:
```yaml
---
name: solo-dev-planner
tools: Write, Read, MultiEdit, Bash, Grep, Glob, GitHub_MCP
---
```

---

## 📝 Checklist Post-Instalación

```
☑ Carpeta creada: ~/.claude/agents/specialized/solo-dev-planner/
☑ 8 archivos copiados (loader + 7 módulos)
☑ Loader tiene el frontmatter correcto
☑ Probado con: @solo-dev-planner test
☑ Claude responde correctamente
```

---

## 🎉 ¡Listo!

**Ahora puedes usar:**

```
@solo-dev-planner quiero empezar un proyecto nuevo
@solo-dev-planner cómo configuro testcontainers
@solo-dev-planner deployar a koyeb
@solo-dev-planner troubleshoot tests
@solo-dev-planner setup rápido
```

**Claude automáticamente cargará los módulos necesarios y responderá eficientemente.** 🚀

---

## 💡 Tips Avanzados

### Tip 1: Context Script

Cuando uses Claude Code, primero ejecuta:
```bash
mise run context
```

Esto genera un JSON con el estado completo del proyecto que Claude puede leer rápidamente.

### Tip 2: Combinar con Projects

Puedes subir la carpeta completa a un Claude Project para tener acceso permanente sin prefijo `@`:

```
1. Crear Project
2. Subir carpeta solo-dev-planner/
3. Claude tiene acceso automático
```

### Tip 3: Actualizar Módulos

Para actualizar solo un módulo:
```bash
# Reemplaza solo el módulo específico
cp 04-DEPLOYMENT.md ~/.claude/agents/specialized/solo-dev-planner/
```

---

**¿Dudas? Consulta `00-INDEX.md` dentro de la carpeta para guía completa de navegación.**
