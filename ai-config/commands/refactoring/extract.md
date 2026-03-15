Extraé lógica duplicada o compleja a funciones/módulos separados.

## Cuándo Extraer

- La misma lógica aparece en 2+ lugares (DRY)
- Una función hace más de una cosa (SRP)
- Una función supera ~30-40 líneas
- Un bloque de código necesita un comentario para explicar qué hace

## Proceso

1. Identificá el bloque a extraer
2. Determiná el nombre descriptivo (verbo + sustantivo: `calculateTotal`, `validateEmail`)
3. Identificá los inputs (parámetros) y el output (valor de retorno)
4. Creá la función en el lugar apropiado (mismo archivo, módulo utilitario, o clase)
5. Reemplazá el bloque original con la llamada a la nueva función
6. Corré los tests
7. Repetí para cada ocurrencia duplicada

## Nombres de Funciones

- Debe describir QUÉ hace, no CÓMO lo hace
- Verbo en imperativo: `get`, `calculate`, `validate`, `transform`, `parse`
- Específico: `getUserById` > `getUser` > `get`
- Sin abreviaturas oscuras

## Commit

```
refactor(scope): extract X logic into Y function
```
