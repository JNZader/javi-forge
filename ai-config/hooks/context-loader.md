---
name: context-loader
description: Al iniciar sesión, carga el estado del proyecto (git, TODOs pendientes, últimos cambios). Trigger: SessionStart
event: SessionStart
action: execute
metadata:
  author: project-starter-framework
  version: "1.0"
---

# Context Loader Hook

> Carga contexto del proyecto automáticamente al iniciar cada sesión AI.

## Propósito

Proporcionar contexto inmediato al AI sobre el estado actual del proyecto sin necesidad de preguntarlo manualmente cada vez.

## Información Cargada

### Estado Git
- Branch actual y commits recientes (`git log --oneline -5`)
- Cambios sin commitear (`git status --short`)
- Archivos modificados recientemente

### TODOs y Tasks
- Busca archivos `TODO.md`, `TASKS.md`, `.todo`
- Extrae líneas con `TODO:`, `FIXME:`, `HACK:` del código

### Config del Proyecto
- `package.json` → nombre, versión, scripts principales
- Lenguaje/runtime detectado (Go, Python, Node, Rust, Java)
- Stack inferido de archivos presentes

## Comportamiento

1. **Ejecuta** al inicio de cada sesión Claude Code
2. **Recopila** información de estado en menos de 2 segundos
3. **Inyecta** un resumen compacto al contexto inicial
4. **No bloquea** ni modifica archivos

## Implementación Claude Code

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{ "type": "command", "command": "echo '=== PROJECT CONTEXT ===' && git branch --show-current 2>/dev/null && git log --oneline -3 2>/dev/null && echo '--- Status ---' && git status --short 2>/dev/null | head -10 && echo '--- Recent TODOs ---' && grep -r 'TODO:\\|FIXME:' --include='*.go' --include='*.ts' --include='*.py' -l 2>/dev/null | head -5 && echo '=== END CONTEXT ===' || true" }]
      }
    ]
  }
}
```

## Configuración

Puedes personalizar qué información se carga editando el comando según el stack del proyecto:

```bash
# Para proyectos Go
grep -r 'TODO:\|FIXME:' --include='*.go' .

# Para proyectos TypeScript/Node
cat package.json | jq '{name,version,scripts}' 2>/dev/null

# Para proyectos Python
cat pyproject.toml 2>/dev/null | head -20
```

## Notas

Este hook es read-only — nunca modifica archivos. El overhead es mínimo (< 500ms en proyectos normales).
