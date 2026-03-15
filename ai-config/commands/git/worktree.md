Gestioná Git worktrees para trabajar en múltiples branches en paralelo.

## ¿Cuándo usar worktrees?

- Necesitás hacer un hotfix urgente mientras trabajás en una feature
- Querés revisar otro branch sin perder tu trabajo en progreso
- Correr tests de dos versiones en paralelo

## Comandos Principales

```bash
# Listar worktrees existentes
git worktree list

# Crear nuevo worktree para un branch existente
git worktree add ../proyecto-hotfix hotfix/critical-bug

# Crear nuevo worktree con nuevo branch
git worktree add -b feature/nueva-feature ../proyecto-nueva main

# Eliminar worktree cuando ya no se necesita
git worktree remove ../proyecto-hotfix

# Limpiar referencias de worktrees eliminados manualmente
git worktree prune
```

## Flujo Recomendado

1. Creá el worktree en un directorio hermano al proyecto principal
2. Abrí el worktree en una terminal separada (o tab)
3. Trabajá independientemente en cada directorio
4. Al terminar: `git worktree remove` + merge/PR normal

## Precauciones

- No editéis el mismo archivo en dos worktrees simultáneamente
- Cada worktree comparte el historial git pero tiene su propio working tree
- Los stashes son compartidos entre worktrees del mismo repo
