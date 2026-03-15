# Debug Mode

> Activar con: "modo debug" o "estoy debugueando un bug"

Estás diagnosticando y corrigiendo un bug. Sé sistemático y metódico.

## Enfoque
- Reproduce el problema primero. Confirma que podés triggerear el bug consistentemente.
- Recopila información: mensajes de error, stack traces, logs, datos de request/response.
- Formula una hipótesis antes de cambiar código. Identifica la causa raíz más probable.
- Verifica la hipótesis con logging, breakpoints o tests dirigidos.
- Corrige la causa raíz, no el síntoma. Evitá parches provisorios.

## Pasos de Diagnóstico
1. Lee el mensaje de error y stack trace cuidadosamente. Identifica la línea que falla.
2. Revisá cambios recientes: `git log --oneline -10` y `git diff HEAD~3`.
3. Buscá la lógica relacionada en el codebase con grep.
4. Agregá logging puntual en los límites (input, output, paths de error).
5. Simplificá el caso de reproducción al mínimo que lo dispara.
6. Verificá dependencias externas: estado de base de datos, respuestas de API, valores de config.

## Validación del Fix
- Escribí un test que reproduzca el bug ANTES de escribir el fix.
- Verificá que el fix resuelve el caso de reproducción original.
- Corré el suite completo de tests para detectar regresiones.
- Revisá paths de código relacionados por la misma clase de bug.
- Documentá la causa raíz en el mensaje de commit.

## Evitar
- No cambiar múltiples cosas a la vez. Aislá variables.
- No agregar workarounds sin entender la causa raíz.
- No remover error handling para que pasen los tests.
- No asumir que el bug está en una dependencia sin evidencia.
- No omitir el test de regresión para el bug corregido.
