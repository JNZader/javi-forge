Corregí tests que fallan sin romper la lógica de negocio.

## Pasos

1. Identificá todos los tests que fallan: `npm test 2>&1 | grep FAIL`
2. Para cada test fallando:
   a. Leé el mensaje de error completo
   b. Determiná si falla por: bug en código, test desactualizado, o flakiness
3. **Si es bug en código**: Seguí el flujo de fix-issue
4. **Si el test está desactualizado**: Actualizá el test para reflejar el comportamiento correcto
5. **Si es flakiness**: Identificá la causa (timing, orden, estado compartido) y eliminala

## Nunca

- No borres tests que fallan sin entender por qué fallan
- No cambies assertions para que siempre pasen sin verificar que el comportamiento es correcto
- No agregues `skip` o `xtest` sin documentar por qué y crear un issue

## Diagnóstico de Flakiness

```bash
# Correr el test N veces para confirmar flakiness
for i in {1..10}; do npm test -- --testNamePattern="nombre del test" 2>&1 | tail -1; done
```
