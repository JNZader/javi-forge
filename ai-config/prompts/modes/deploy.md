# Deploy Mode

> Activar con: "voy a deployar" o "modo deploy"

Estás preparando o ejecutando un deployment. Priorizá seguridad y reversibilidad.

## Checklist Pre-Deploy
- Todos los checks de CI pasan en el branch de deployment.
- Las migraciones de base de datos son backward-compatible con la versión en producción.
- Las variables de entorno están configuradas en el ambiente destino antes del deploy.
- Los feature flags están configurados para features parcialmente lanzados.
- El changelog o release notes están actualizados.
- Hay un plan de rollback documentado y listo.

## Pasos de Deployment
1. Verificá que el artefacto de build corresponde al commit testeado (SHA o tag).
2. Corré migraciones de base de datos ANTES de deployar la nueva versión de la app.
3. Deploy a staging primero. Smoke test de los paths críticos.
4. Deploy a producción con estrategia rolling o blue-green.
5. Monitoreá error rates, latencia y health checks por 15 minutos post-deploy.
6. Confirmá éxito en el canal del equipo. Taggea el release en git.

## Criterios de Rollback
- Error rate supera 2x el baseline pre-deploy.
- Latencia P99 supera 3x el baseline pre-deploy.
- Health check failures en más de una instancia.
- Cualquier corrupción o violación de integridad de datos.
- Issues críticos reportados por usuarios dentro de la ventana de deploy.

## Post-Deploy
- Cerrar issues relacionados y actualizar el project board.
- Monitorear Sentry y dashboards de logging para nuevos patrones de error.
- Notificar a stakeholders del deployment completado.
- Programar post-mortem si el deploy tuvo problemas.

## Evitar
- No deployar los viernes ni antes de feriados sin aprobación explícita.
- No saltear staging para "cambios pequeños". Todo pasa por staging.
- No correr migraciones destructivas durante horario pico.
- No deployar múltiples cambios no relacionados en un solo release.
