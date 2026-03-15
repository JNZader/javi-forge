---
name: using-git-worktrees
description: >
  Gestiona múltiples branches en paralelo con Git worktrees para mantener contextos separados.
  Trigger: worktree, trabajo en paralelo, hotfix mientras desarrollás, múltiples branches simultáneos
tools:
  - Bash
  - Read
metadata:
  author: project-starter-framework
  version: "1.0"
  tags: [git, workflow, branches, parallel]
  updated: "2026-02"
---

# Git Worktrees Skill

## ¿Qué son los Worktrees?

Git worktrees permiten tener múltiples branches del mismo repositorio checked out simultáneamente en directorios separados. Ideal para:

- Hacer un hotfix urgente sin perder el trabajo en progreso
- Revisar otro branch sin stashing
- Correr tests de dos versiones en paralelo

## Comandos Esenciales

```bash
# Ver worktrees actuales
git worktree list

# Crear worktree para branch existente
git worktree add ../proyecto-hotfix hotfix/critical-bug

# Crear worktree con nuevo branch desde main
git worktree add -b feature/nueva ../proyecto-nueva main

# Eliminar worktree
git worktree remove ../proyecto-hotfix

# Limpiar referencias huérfanas
git worktree prune
```

## Flujo de Trabajo

### Hotfix Urgente Durante Feature Development

```bash
# Situación: trabajando en feature/dashboard, llega bug urgente

# 1. Crear worktree para el hotfix (sin afectar tu trabajo)
git worktree add ../mi-proyecto-hotfix -b hotfix/login-crash main

# 2. Ir al worktree del hotfix
cd ../mi-proyecto-hotfix

# 3. Hacer el fix, testear, commitear
git commit -m "fix(auth): prevent crash on empty session"
git push origin hotfix/login-crash

# 4. Volver a tu feature
cd ../mi-proyecto

# 5. Limpiar después del merge
git worktree remove ../mi-proyecto-hotfix
```

### Comparar Implementaciones

```bash
# Tener la versión actual y la refactorizada corriendo en paralelo
git worktree add ../proyecto-v2 refactor/new-arch

# Terminal 1: cd ../mi-proyecto && go run . -port 8080
# Terminal 2: cd ../proyecto-v2 && go run . -port 8081
# Comparar comportamiento
```

## Convenciones de Naming

Usar directorios hermanos al repo principal:

```
~/projects/
  mi-proyecto/          # repo principal
  mi-proyecto-hotfix/   # worktree hotfix
  mi-proyecto-review/   # worktree para revisar PR
```

## Limitaciones

- No podés hacer checkout del mismo branch en dos worktrees
- Los stashes son compartidos (cuidado al usar `git stash`)
- Algunos IDEs no detectan múltiples worktrees automáticamente

## Related Skills

- git-github
- git-workflow
