Creá un plan estructurado antes de implementar una feature o cambio complejo.

## Cuándo Planificar Primero

- Feature nueva que toca múltiples archivos o servicios
- Cambio que requiere migración de datos
- Refactoring de componente crítico
- Cualquier tarea > 2 horas estimadas

## Template de Plan

```markdown
## Feature: [nombre]

### Problema
[Qué problema resuelve]

### Solución Propuesta
[Descripción técnica de la solución]

### Archivos Afectados
- `src/x.go` — añadir función Y
- `tests/x_test.go` — tests para Y
- `api/routes.go` — registrar nuevo endpoint

### Orden de Implementación
1. Paso 1 (independiente)
2. Paso 2 (depende de 1)
3. Paso 3

### Riesgos
- Riesgo A → Mitigación A
- Riesgo B → Mitigación B

### Criterios de Done
- [ ] Feature funciona para casos normales
- [ ] Edge cases cubiertos
- [ ] Tests pasan
- [ ] Documentación actualizada
```

## Principios

- Planificá a nivel de archivos y funciones, no de líneas
- Identificá dependencias entre pasos
- Empezá por lo más incierto o riesgoso
- Un plan es una guía, no un contrato — actualizarlo está bien
