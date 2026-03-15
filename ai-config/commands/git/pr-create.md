Creá un Pull Request para el branch actual con descripción completa.

## Pasos

1. Verificá que todos los cambios estén committed: `git status`
2. Determiná el branch base (normalmente `main` o `develop`)
3. Corré `git log origin/main..HEAD --oneline` para ver los commits del PR
4. Corré `git diff origin/main...HEAD --stat` para el resumen de cambios
5. Generá la descripción usando el template

## Template de PR

```markdown
## ¿Qué hace este PR?

[Descripción concisa del cambio y su propósito]

## ¿Por qué?

[Contexto y motivación. Linkear el issue si existe: Closes #123]

## Cambios principales

- [ ] Cambio 1
- [ ] Cambio 2

## Testing

- [ ] Tests unitarios pasan
- [ ] Tests de integración pasan
- [ ] Testeo manual completado

## Screenshots / evidencia

[Si aplica]
```

## Comando gh

```bash
gh pr create --title "type(scope): descripción" --body "$(cat pr-body.md)" --base main
```
