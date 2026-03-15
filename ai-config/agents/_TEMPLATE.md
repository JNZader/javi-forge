---
# =============================================================================
# AGENT TEMPLATE
# =============================================================================
# Compatible con: Claude Code, OpenCode, y otros AI CLIs
# =============================================================================

name: mi-agente
description: >
  Descripción breve del agente.
  Qué hace y cuándo usarlo.
trigger: >
  Palabras clave o contexto que activa este agente.
  Ejemplo: "review code", "run tests", "generate docs"

# Herramientas disponibles para el agente
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob

# Configuración opcional
config:
  model: sonnet  # sonnet | opus | haiku
  max_turns: 10
  autonomous: false  # true = no pide confirmación

# Metadatos
metadata:
  author: tu-usuario
  version: "1.0"
  tags: [review, testing, docs]
---

# [Nombre del Agente]

> [Descripción de una línea]

## Objetivo

[Qué hace este agente y por qué existe]

## Cuándo Usar

- [ ] Condición 1 que activa el agente
- [ ] Condición 2
- [ ] Condición 3

## Instrucciones

### Paso 1: [Nombre del paso]

[Instrucciones detalladas]

```bash
# Ejemplo de comando si aplica
```

### Paso 2: [Nombre del paso]

[Instrucciones detalladas]

## Criterios de Éxito

- [ ] Criterio 1 verificable
- [ ] Criterio 2 verificable
- [ ] Criterio 3 verificable

## Ejemplos

### Ejemplo 1: [Título]

**Input:**
```
[Ejemplo de prompt o contexto]
```

**Output esperado:**
```
[Ejemplo de resultado]
```

## Anti-Patterns

- ❌ No hacer: [cosa a evitar]
- ❌ No hacer: [otra cosa a evitar]

## Notas

[Notas adicionales, limitaciones, o consideraciones]
