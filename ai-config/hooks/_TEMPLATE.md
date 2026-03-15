---
# =============================================================================
# HOOK TEMPLATE
# =============================================================================
# Hooks se ejecutan en respuesta a eventos del AI CLI
# =============================================================================

name: mi-hook
description: Descripción del hook

# Evento que dispara el hook
# Opciones: PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd
event: PreToolUse

# Filtrar por herramientas específicas (opcional)
# Si no se especifica, aplica a todas
tools:
  - Bash
  - Write

# Filtrar por patrón en el contenido (opcional)
match_pattern: "rm -rf|drop table|delete from"

# Acción: block | warn | log | execute
action: block

metadata:
  author: tu-usuario
  version: "1.0"
---

# [Nombre del Hook]

> [Descripción de una línea]

## Propósito

[Qué hace este hook y por qué existe]

## Evento

- **Trigger:** [PreToolUse | PostToolUse | Stop | etc.]
- **Herramientas:** [Lista de herramientas o "todas"]
- **Condición:** [Cuándo se activa]

## Lógica

```
SI [condición]
ENTONCES [acción]
SINO [alternativa]
```

## Implementación

### Para Claude Code

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "command": "echo 'Validating...'"
      }
    ]
  }
}
```

### Para OpenCode

```yaml
hooks:
  pre_tool_use:
    - tool: Bash
      action: validate
```

## Ejemplos

### Ejemplo 1: Hook activa

**Contexto:**
```
[Descripción del contexto]
```

**Resultado:**
```
[Qué hace el hook]
```

## Notas

[Consideraciones adicionales]
