Identificá y eliminá código muerto (código que nunca se ejecuta o no se usa).

## Tipos de Código Muerto

- Funciones/métodos nunca llamados
- Variables declaradas pero nunca leídas
- Branches de condicionales que nunca se ejecutan (unreachable code)
- Imports que no se usan
- Features flags siempre false/true
- Código después de `return` / `throw`

## Detección

```bash
# TypeScript/JavaScript
npx ts-prune  # funciones no usadas
npx knip      # exports no usados

# Go
go vet ./...

# Python
vulture . --min-confidence 80

# General: buscar con grep
grep -r "function\|def\|func " --include="*.ts" | grep -v test
```

## Proceso Seguro

1. Identificá el código candidato a eliminar
2. Buscá todos los usos en el codebase (grep exhaustivo)
3. Verificá que no se usa vía reflection, dynamic imports o configuración externa
4. Eliminá el código
5. Corré el suite completo de tests
6. Si pasan: commit `refactor: remove dead code in X`

## Precaución

Algunos "dead code" es intencional: hooks de lifecycle, handlers registrados dinámicamente, código de compatibility. Verificá antes de eliminar.
