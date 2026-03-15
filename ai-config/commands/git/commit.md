Analizá los cambios staged (`git diff --cached`) y generá un mensaje de commit siguiendo Conventional Commits.

## Pasos

1. Corré `git diff --cached --stat` para ver qué archivos cambiaron.
2. Corré `git diff --cached` para leer los cambios reales.
3. Determiná el tipo de commit:
   - `feat` - nueva funcionalidad
   - `fix` - corrección de bug
   - `refactor` - reestructuración sin cambio de comportamiento
   - `docs` - solo documentación
   - `test` - agregar o actualizar tests
   - `chore` - build, CI, dependencias
   - `perf` - mejora de performance
   - `style` - formateo, espacios
4. Identificá el scope del módulo/directorio más afectado.
5. Escribí una línea de subject concisa en imperativo (máx 72 chars).
6. Si el cambio no es trivial, agregá un cuerpo explicando **por qué** se hizo el cambio.
7. Presentá el mensaje de commit para aprobación antes de ejecutar.

## Formato

```
type(scope): línea de subject en modo imperativo

Cuerpo opcional explicando motivación y contexto.
BREAKING CHANGE: descripción si aplica.
```

## Reglas

- Subject: modo imperativo, sin punto final, máx 72 caracteres.
- Cuerpo: wrap a 80 chars, línea en blanco entre subject y cuerpo.
- Si hay múltiples cambios lógicos staged, sugerí dividir en commits separados.
- Nunca incluir archivos generados, lock files o artefactos de build sin intención explícita.
