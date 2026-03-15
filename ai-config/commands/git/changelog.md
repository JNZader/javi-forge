Generá un CHANGELOG desde los commits recientes siguiendo Keep a Changelog.

## Pasos

1. Corré `git log --oneline --no-merges $(git describe --tags --abbrev=0)..HEAD` para commits desde último tag.
2. Si no hay tag: `git log --oneline --no-merges -30`
3. Agrupá los commits por tipo (feat, fix, refactor, etc.)
4. Generá la entrada de CHANGELOG en formato Keep a Changelog.

## Formato

```markdown
## [Unreleased] — YYYY-MM-DD

### Added
- Nueva funcionalidad X (feat commits)

### Fixed  
- Corrección de Y (fix commits)

### Changed
- Cambio en Z (refactor commits)

### Security
- Parche de seguridad W (fix(security) commits)
```

## Reglas

- Solo incluir commits visibles para usuarios (no `chore`, `style`, `ci` internos)
- Agrupar múltiples commits relacionados en una sola entrada si tienen el mismo scope
- Linkear issues cuando el commit los menciona (#123)
