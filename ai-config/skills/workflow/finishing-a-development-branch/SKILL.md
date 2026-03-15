---
name: finishing-a-development-branch
description: >
  Completa el ciclo de vida de un branch de desarrollo: tests, review, merge y limpieza.
  Trigger: terminar branch, cerrar feature, hacer merge, finalizar desarrollo, branch ready
tools:
  - Bash
  - Read
metadata:
  author: project-starter-framework
  version: "1.0"
  tags: [git, workflow, branches, merge, pr]
  updated: "2026-02"
---

# Finishing a Development Branch Skill

## Flujo Completo

### Fase 1: Preparación Local

```bash
# 1. Asegurate que el branch está actualizado
git fetch origin
git rebase origin/main

# 2. Corré todos los tests
go test ./... || npm test || pytest

# 3. Verificá el linter
golangci-lint run || npm run lint || ruff check .

# 4. Revisá los cambios una última vez
git diff origin/main...HEAD --stat
git log origin/main..HEAD --oneline
```

### Fase 2: Limpieza del Branch

```bash
# Revisá los commits — ¿tienen sentido? ¿hay commits de WIP para squashear?
git log origin/main..HEAD --oneline

# Si hay commits de WIP, squashear (opcional):
git rebase -i origin/main
# En el editor: cambiar 'pick' por 'squash' o 'fixup' en commits WIP
```

### Fase 3: Push y PR

```bash
# Push del branch
git push origin HEAD

# Crear PR (con gh CLI)
gh pr create \
  --title "feat(scope): descripción concisa" \
  --body "Closes #N

## Cambios
- Lista de cambios principales

## Testing
- Tests pasan localmente
- Testeado manualmente en [ambiente]" \
  --base main
```

### Fase 4: Post-Merge

```bash
# Después del merge aprobado:

# 1. Volver a main y actualizar
git checkout main
git pull origin main

# 2. Eliminar el branch local
git branch -d feature/mi-branch

# 3. Eliminar el branch remoto (si no lo hizo GitHub automáticamente)
git push origin --delete feature/mi-branch

# 4. Verificar en producción/staging si aplica
```

## Checklist de Branch Completion

- [ ] Rebase sobre main actualizado
- [ ] Todos los tests pasan
- [ ] Linter sin errores
- [ ] Commits limpios (sin WIP, sin mensajes genéricos)
- [ ] PR creado con descripción completa
- [ ] PR linkeado al issue/ticket
- [ ] Reviewer asignado
- [ ] Branch local y remoto eliminado post-merge

## Manejo de Conflictos

```bash
# Durante el rebase si hay conflictos:
git rebase origin/main
# [resolver conflictos en cada archivo]
git add .
git rebase --continue

# Si el rebase se complica:
git rebase --abort  # volver al estado anterior
# y resolverlo manualmente
```

## Related Skills

- git-github
- git-workflow
- verification-before-completion
- using-git-worktrees
