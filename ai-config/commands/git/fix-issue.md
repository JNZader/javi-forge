Implementá el fix para un issue específico siguiendo el flujo completo.

## Pasos

1. **Entender**: Leé el issue completamente. Reproducí el problema si es posible.
2. **Branch**: Creá branch con convención `fix/t-{issue-number}-descripcion-corta`
   ```bash
   git checkout -b fix/t-42-null-pointer-in-auth
   ```
3. **Escribí el test**: Creá un test que falla reproduciendo el bug.
4. **Implementá el fix**: Hacé el cambio mínimo necesario para pasar el test.
5. **Verificá**: Corré todos los tests. Confirmá que no hay regresiones.
6. **Commit**: Usá el formato `fix(scope): descripción concisa — closes #N`
7. **PR**: Creá el PR linkeando el issue.

## Checklist

- [ ] Reproduje el bug localmente
- [ ] Escribí test de regresión que falla antes del fix
- [ ] El fix es el cambio mínimo necesario
- [ ] Todos los tests pasan
- [ ] El mensaje de commit linkea el issue
- [ ] El PR describe la causa raíz del bug
