---
name: block-dangerous-commands
description: Bloquea comandos peligrosos antes de ejecutar
event: PreToolUse
tools:
  - Bash
match_pattern: "rm -rf /|rm -rf ~|drop database|truncate table|:(){ :|:& };:|mkfs|dd if=|> /dev/sd|chmod -R 777 /|curl.*| bash|wget.*| sh"
action: block
metadata:
  author: project-starter-framework
  version: "1.0"
---

# Block Dangerous Commands Hook

> Previene ejecución de comandos potencialmente destructivos.

## Propósito

Interceptar comandos de Bash que podrían causar daño irreversible al sistema o datos.

## Comandos Bloqueados

| Patrón | Riesgo |
|--------|--------|
| `rm -rf /` | Borrar sistema completo |
| `rm -rf ~` | Borrar home directory |
| `drop database` | Eliminar base de datos |
| `truncate table` | Vaciar tablas |
| `:(){ :|:& };:` | Fork bomb |
| `mkfs` | Formatear disco |
| `dd if=` | Escritura directa a disco |
| `> /dev/sd*` | Sobrescribir disco |
| `chmod -R 777 /` | Permisos inseguros |
| `curl \| bash` | Ejecución remota |
| `wget \| sh` | Ejecución remota |

## Comportamiento

1. **Detecta** comando peligroso en input de Bash
2. **Bloquea** ejecución
3. **Notifica** al usuario con explicación
4. **Sugiere** alternativa segura si existe

## Implementación Claude Code

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo '$TOOL_INPUT' | grep -qE 'rm -rf /|rm -rf ~|drop database' && echo 'BLOCKED: Dangerous command detected' && exit 1 || exit 0"
          }
        ]
      }
    ]
  }
}
```

## Excepciones

Si necesitás ejecutar un comando bloqueado legítimamente:

1. Revisar el comando manualmente
2. Usar `--no-verify` o equivalente
3. Documentar la razón

## Notas

Este hook es una capa de seguridad adicional, no reemplaza el sentido común.
