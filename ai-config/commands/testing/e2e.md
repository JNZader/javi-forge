Escribí o corré tests end-to-end para verificar flujos completos del sistema.

## Cuándo Usar E2E

- Flujos críticos de negocio (checkout, login, registro)
- Integraciones entre múltiples servicios
- Regresiones de bugs reportados por usuarios
- Smoke tests post-deploy

## Pasos para Escribir E2E

1. Identificá el flujo de usuario completo (inicio → fin)
2. Listá los pasos exactos del usuario
3. Definí los assertions en cada paso crítico
4. Usá selectores robustos (data-testid preferido sobre CSS classes)
5. Manejá estados asíncronos correctamente (waitFor, expect.poll)

## Principios

- **Independencia**: Cada test debe poder correr solo
- **Idempotencia**: Limpiar estado antes/después del test
- **Realismo**: Testear como el usuario real lo haría
- **Determinismo**: Evitar flakiness con waits explícitos

## Stack por Proyecto

- **Web**: Playwright o Cypress
- **Mobile**: Detox o Appium
- **API**: Supertest o Rest Assured
- **CLI**: expect o subprocess testing
