Analizá la cobertura de tests e identificá gaps críticos.

## Pasos

1. Corré el coverage report del proyecto:
   - Go: `go test ./... -coverprofile=coverage.out && go tool cover -html=coverage.out`
   - Node/TS: `npm run test:coverage` o `vitest --coverage`
   - Python: `pytest --cov=src --cov-report=html`
2. Identificá archivos con cobertura < 70%
3. Revisá paths de código no cubiertos — enfocate en:
   - Manejo de errores
   - Edge cases (nil, empty, boundary values)
   - Paths de autenticación/autorización
4. Priorizá tests para código crítico primero

## Métricas Objetivo

| Tipo | Mínimo | Objetivo |
|------|--------|----------|
| Statements | 70% | 85% |
| Branches | 60% | 80% |
| Functions | 75% | 90% |
| Lines | 70% | 85% |

## Lo Que NO Necesita Tests

- Getters/setters triviales sin lógica
- Código generado automáticamente
- Configuración estática (constantes)
- Código de terceros
