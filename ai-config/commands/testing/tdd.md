Implementá una feature usando Test-Driven Development (TDD).

## Ciclo Red-Green-Refactor

1. **RED**: Escribí un test que falla para el comportamiento deseado
2. **GREEN**: Escribí el código mínimo para que el test pase
3. **REFACTOR**: Mejorá el código sin romper los tests

## Pasos

1. Definí el comportamiento esperado en lenguaje natural
2. Escribí el test primero (debe fallar — confirmá que falla)
3. Implementá solo lo necesario para pasar el test
4. Corré el test (debe pasar)
5. Refactorizá si hay duplicación u oportunidades de mejora
6. Repetí para el siguiente comportamiento

## Reglas TDD

- **Un test a la vez**: Focus en un comportamiento específico
- **Test mínimo**: El test más simple que falla
- **Código mínimo**: Solo lo necesario para pasar, nada más
- **No adelantarse**: No implementar funcionalidad sin test previo
- **Refactor only on green**: Solo refactorizá cuando todos los tests pasan

## Estructura de Tests

```
describe("Componente/Función", () => {
  it("debe hacer X cuando Y", () => {
    // Arrange
    // Act  
    // Assert
  })
})
```
