---
name: learning-log
description: Al finalizar sesión, guarda un resumen de lo aprendido y los commits realizados. Trigger: SessionEnd
event: SessionEnd
action: execute
metadata:
  author: project-starter-framework
  version: "1.0"
---

# Learning Log Hook

> Registra automáticamente los aprendizajes y cambios de cada sesión AI.

## Propósito

Crear un historial de sesiones que documente decisiones técnicas, problemas encontrados y soluciones aplicadas — útil para onboarding, debugging futuro y mejora continua.

## Información Registrada

### Por Sesión
- Fecha y hora de la sesión
- Branch y commits realizados durante la sesión
- Archivos modificados (lista compacta)
- Resumen de cambios (del último commit message)

### Formato de Log

```markdown
## 2026-02-25 — feat(auth): add refresh tokens

**Branch:** feature/t-42-refresh-tokens
**Commits:** 3
**Files changed:** src/auth/token.go, src/auth/refresh.go, tests/auth_test.go

**Notes:** Implemented JWT refresh token flow with Redis-backed token rotation.
Issues: Had to handle concurrent refresh requests with mutex.
```

## Comportamiento

1. **Ejecuta** al cerrar cada sesión Claude Code
2. **Recopila** commits realizados desde inicio de sesión
3. **Escribe** entrada al log `.ai-session-log.md` (gitignored)
4. **Rota** el log cuando supera 1000 líneas

## Implementación Claude Code

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "hooks": [{ "type": "command", "command": "LOG='.ai-session-log.md'; DATE=$(date '+%Y-%m-%d %H:%M'); BRANCH=$(git branch --show-current 2>/dev/null); COMMITS=$(git log --oneline --since='8 hours ago' 2>/dev/null | head -5); echo \"\\n## $DATE — $BRANCH\\n\\n$COMMITS\" >> $LOG 2>/dev/null || true" }]
      }
    ]
  }
}
```

## Configuración del .gitignore

Agregar al `.gitignore` del proyecto:
```
.ai-session-log.md
```

O committear el log si se quiere historial compartido con el equipo.

## Notas

El log es local por defecto. Para compartir con el equipo, quitar de `.gitignore` y commitear periódicamente con `chore: update AI session log`.
