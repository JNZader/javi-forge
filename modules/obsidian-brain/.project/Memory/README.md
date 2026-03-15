# Project Memory (Obsidian Brain)

> Archivos de memoria persistente para AI CLIs y documentacion del proyecto.
> Funciona como markdown plano sin Obsidian. Con Obsidian, agrega Kanban visual, queries Dataview y templates Templater.

## Estructura

```
Memory/
├── CONTEXT.md    <- Estado actual del proyecto (leer al inicio)
├── DECISIONS.md  <- ADRs (Architecture Decision Records)
├── BLOCKERS.md   <- Problemas encontrados y soluciones
├── WAVES.md      <- Historial de oleadas de trabajo
├── KANBAN.md     <- Board visual de tareas (plugin Kanban)
├── DASHBOARD.md  <- Metricas y queries (plugin Dataview)
└── README.md     <- Este archivo
```

## Flujo de Trabajo

### Al iniciar sesion:
1. Leer `CONTEXT.md` para recordar estado
2. Revisar `KANBAN.md` para tareas activas
3. Revisar `BLOCKERS.md` para issues pendientes
4. Crear sesion: copiar `../Sessions/TEMPLATE.md` como `../Sessions/YYYY-MM-DD.md`
   - Con Obsidian: usar Templater (Ctrl+T > Session) que auto-llena fecha y prompts
   - Sin Obsidian: copiar TEMPLATE.md y reemplazar placeholders manualmente

### Durante la sesion:
5. Mover tareas en `KANBAN.md` entre lanes
6. Documentar blockers si aparecen (usar inline fields: `type:: blocker`, `status:: open`)
7. Registrar decisiones importantes como ADRs (usar inline fields: `type:: adr`, `status::`)

### Al finalizar:
8. Actualizar `CONTEXT.md`
9. Completar sesion del dia

## Templates disponibles

En `../Templates/` hay templates de Templater (requieren plugin):
- **Session.md** - Sesion con fecha automatica y prompts
- **ADR.md** - Decision de arquitectura con prompts
- **Blocker.md** - Blocker con prompts

Sin Templater, usar los templates inline que estan al final de DECISIONS.md y BLOCKERS.md.

## Con Obsidian

Si abres el proyecto como vault de Obsidian:
- **KANBAN.md** se renderiza como board visual (drag & drop)
- **DASHBOARD.md** ejecuta queries Dataview automaticamente
- **Templates/** permite crear sesiones y ADRs con Templater
- Los links `[[ARCHIVO]]` navegan entre notas

## Sin Obsidian

Todo funciona como markdown plano:
- **KANBAN.md** se edita moviendo lineas entre secciones H2
- **DASHBOARD.md** muestra bloques de codigo (sin ejecutar)
- Las sesiones se crean copiando TEMPLATE.md manualmente
- Los links `[[ARCHIVO]]` se ven como texto plano (no navegables)
