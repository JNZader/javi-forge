Revisá el PR actual con foco en correctitud, seguridad y mantenibilidad.

## Pasos

1. Corré `git diff main...HEAD` o `git diff origin/main...HEAD` para ver todos los cambios.
2. Revisá el diff completo antes de comentar.
3. Verificá cada uno de los checkpoints de la lista.
4. Generá un reporte estructurado con hallazgos.

## Checkpoints

### Correctitud
- [ ] La lógica es correcta para el caso happy path
- [ ] Los edge cases están manejados (null, empty, overflow)
- [ ] El error handling es apropiado y no silencia errores
- [ ] Las condiciones de race condition están consideradas

### Seguridad
- [ ] No hay SQL injection posible
- [ ] Input validation en límites del sistema
- [ ] No hay secrets en el diff
- [ ] Autenticación/autorización correcta

### Tests
- [ ] Los tests cubren el comportamiento cambiado
- [ ] Hay tests para edge cases críticos
- [ ] Los tests no son frágiles (no dependen de orden o timing)

### Mantenibilidad
- [ ] El código es legible sin comentarios explicativos
- [ ] No hay duplicación innecesaria
- [ ] Los nombres son descriptivos

## Formato de Reporte

```
## Code Review

### Blockers
- [archivo:línea] descripción del problema

### Suggestions
- [archivo:línea] mejora sugerida

### Questions
- [archivo:línea] pregunta de clarificación

### Positivos
- Buen patrón en X
```
