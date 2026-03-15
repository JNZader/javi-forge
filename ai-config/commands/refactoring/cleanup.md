Limpiá el código del archivo o módulo actual sin cambiar su comportamiento.

## Qué Limpiar

1. **Código comentado**: Eliminar código comentado que no se usa (está en git history)
2. **Console.log / print debug**: Remover logging de debug temporal
3. **Variables no usadas**: Identificar con linter e eliminar
4. **Imports no usados**: Limpiar imports innecesarios
5. **Lógica duplicada**: Extraer a función/método compartido
6. **Magic numbers**: Reemplazar con constantes con nombre descriptivo
7. **Comentarios obvios**: Eliminar comentarios que repiten lo que hace el código

## Proceso

1. Corré el linter para identificar issues automáticamente
2. Revisá el archivo buscando los items de la lista
3. Hacé los cambios en pequeños commits agrupados por tipo
4. Corré los tests después de cada grupo de cambios
5. Commit: `refactor(scope): clean up X`

## Regla de Oro

**Si el comportamiento cambia, no es cleanup — es un bug o una feature.**
Corré los tests antes y después. Si fallan, revertí.
