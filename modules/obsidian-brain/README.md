# Obsidian Brain

> Vault de Obsidian integrado al proyecto: Kanban visual, queries Dataview, templates Templater.
> Todo funciona como markdown plano sin Obsidian instalado.

## Instalacion

### Automatica (recomendado)

```bash
./scripts/init-project.sh
# Elegir opcion 1: obsidian-brain
```

### Manual

```bash
# 1. Copiar estructura de memoria y config Obsidian
cp -r optional/obsidian-brain/.project tu-proyecto/
cp -r optional/obsidian-brain/.obsidian tu-proyecto/

# 2. Copiar scripts de oleadas
cp optional/obsidian-brain/new-wave.sh tu-proyecto/scripts/
cp optional/obsidian-brain/new-wave.ps1 tu-proyecto/scripts/
chmod +x tu-proyecto/scripts/new-wave.sh

# 3. Agregar lineas al .gitignore
cat optional/obsidian-brain/.obsidian-gitignore-snippet.txt >> tu-proyecto/.gitignore
```

## Estructura

```
proyecto/                          <- Vault root
├── .obsidian/                     <- Config Obsidian (pre-configurada)
│   ├── app.json                   <- Settings (relative links, ignore filters)
│   ├── appearance.json            <- Tema, fuente, CSS snippets habilitados
│   ├── bookmarks.json             <- Acceso rapido a CONTEXT, KANBAN, DASHBOARD
│   ├── core-plugins.json          <- Core plugins habilitados
│   ├── core-plugins-migration.json
│   ├── community-plugins.json     <- Kanban + Dataview + Templater
│   ├── daily-notes.json           <- Auto-crear sesiones en Sessions/
│   ├── graph.json                 <- Filtros y colores para graph view
│   ├── hotkeys.json               <- Ctrl+T = insertar template Templater
│   ├── snippets/
│   │   └── project-memory.css     <- Estilos para inline fields y Kanban
│   └── plugins/
│       ├── obsidian-kanban/data.json
│       ├── dataview/data.json
│       └── templater-obsidian/data.json
├── .project/
│   ├── Attachments/               <- Imagenes y archivos adjuntos
│   ├── Memory/
│   │   ├── CONTEXT.md             <- Estado actual del proyecto
│   │   ├── DECISIONS.md           <- ADRs con inline fields Dataview
│   │   ├── BLOCKERS.md            <- Problemas con inline fields Dataview
│   │   ├── WAVES.md               <- Historial de oleadas
│   │   ├── KANBAN.md              <- Board visual (plugin Kanban)
│   │   ├── DASHBOARD.md           <- Queries automaticas (plugin Dataview)
│   │   └── README.md
│   ├── Sessions/
│   │   └── TEMPLATE.md            <- Template manual para sesiones
│   └── Templates/
│       ├── Session.md             <- Template Templater para sesiones
│       ├── ADR.md                 <- Template Templater para ADRs
│       └── Blocker.md             <- Template Templater para blockers
└── scripts/
    ├── new-wave.sh                <- Gestion de oleadas (bash)
    └── new-wave.ps1               <- Gestion de oleadas (PowerShell)
```

## Plugins Requeridos

Los `data.json` estan pre-configurados. Solo necesitas instalar los plugins desde Obsidian:

1. Abrir Obsidian > Settings > Community Plugins > Browse
2. Instalar: **Kanban**, **Dataview**, **Templater**
3. Habilitar los 3 plugins

La configuracion se aplica automaticamente desde los `data.json` ya incluidos.

### Pre-configurado

- **Ctrl+T** - Insertar template Templater (sesion, ADR, blocker)
- **Daily Notes** - Al hacer click en "Open today's daily note", crea sesion en `.project/Sessions/` usando el template de Templater
- **Bookmarks** - CONTEXT, KANBAN, DASHBOARD, DECISIONS, BLOCKERS en acceso rapido
- **Graph View** - Memory files en azul, Sessions en violeta, build artifacts filtrados
- **CSS Snippet** - `project-memory.css` activo: resalta inline fields y status badges
- **Core templates desactivado** - Se usa Templater en su lugar (mas potente, sin conflicto)

### Seguridad

- **Templater:** `enable_system_commands: false` (no ejecuta comandos del sistema)
- **Dataview:** `enableDataviewJs: false` (no ejecuta JavaScript arbitrario)

## Workflow

### Con Obsidian

1. Abrir proyecto como vault
2. Usar KANBAN.md como board visual (drag & drop entre lanes)
3. Crear sesiones con Templater (Ctrl+T > Session)
4. Ver DASHBOARD.md para metricas automaticas
5. Las oleadas se gestionan con `new-wave.sh` y se reflejan en WAVES.md

### Sin Obsidian (markdown plano)

1. Editar KANBAN.md moviendo lineas entre secciones H2
2. Copiar TEMPLATE.md para crear sesiones manualmente
3. DASHBOARD.md muestra bloques de codigo sin ejecutar
4. Todo el workflow funciona igual, solo sin la parte visual

## KANBAN.md

El board tiene 4 lanes:

```markdown
## Backlog
- [ ] Tarea por hacer #wave

## En Progreso
- [ ] Tarea activa

## Review
- [ ] Tarea en revision

## Completado
- [x] Tarea terminada
```

### Mover tareas
- **Con Obsidian:** drag & drop entre lanes
- **Sin Obsidian:** cortar/pegar la linea `- [ ]` a la seccion correspondiente
- **Con AI CLI:** mover la linea entre secciones H2

### Tags utiles
- `#wave` - Pertenece a oleada activa
- `#blocker` - Tiene un blocker asociado
- `#review` - Necesita revision

## Oleadas (Waves)

KANBAN.md es para el dia a dia. WAVES.md es el historial de oleadas:

```bash
# Ver oleada actual
./scripts/new-wave.sh --list

# Crear oleada
./scripts/new-wave.sh "T-001 T-002 T-003"

# Completar oleada
./scripts/new-wave.sh --complete
```

## Inline Fields vs Frontmatter

Obsidian Brain usa dos formatos de metadata segun el tipo de archivo:

- **Inline fields** (`key:: value`) - Para ADRs y Blockers dentro de DECISIONS.md y BLOCKERS.md.
  Se usan porque multiples entradas conviven en el mismo archivo. Dataview los detecta como campos
  de la seccion H2/H3 donde aparecen.

- **YAML frontmatter** (`key: value` en bloque `---`) - Para archivos individuales como sesiones
  (un archivo por dia). Obsidian los muestra en el panel de propiedades.

No mezclar: usar inline fields dentro de secciones, frontmatter al inicio de archivos individuales.

## Inline Fields (Dataview)

Los archivos usan inline fields para queries automaticas. Formato: `key:: value`

### Campos obligatorios por tipo

| Tipo de entrada | Campos requeridos | Valores validos |
|-----------------|-------------------|-----------------|
| ADR | `type:: adr`, `status::`, `date::` | status: `pendiente`, `aceptada`, `rechazada`, `deprecada` |
| Blocker | `type:: blocker`, `status::`, `impact::`, `date::` | status: `open`, `investigating`, `resolved`, `workaround`. impact: `alto`, `medio`, `bajo` |
| Session | frontmatter `type: session`, `date`, `phase`, `wave` | phase: `Foundation`, `MVP`, `Alpha`, `Beta` |

### Ejemplo real (ADR)

```markdown
## ADR-002: Usar PostgreSQL en vez de SQLite

type:: adr
status:: aceptada
date:: 2026-01-15

### Contexto
Necesitamos soporte para queries concurrentes y full-text search.

### Decision
Usar PostgreSQL 16 con pgx driver.
```

### Ejemplo real (Blocker)

```markdown
### BLOCKER-002: Docker build falla en CI

type:: blocker
status:: open
impact:: alto
date:: 2026-01-20

**Descripcion:**
El build de Docker falla con error de memoria en GitHub Actions.
```

Estos campos permiten a Dataview generar tablas automaticas en DASHBOARD.md. Sin los campos, las queries devuelven resultados vacios.

## Git

### Se commitea
- `.obsidian/app.json` - Settings compartidos
- `.obsidian/appearance.json` - Tema y CSS snippets
- `.obsidian/bookmarks.json` - Bookmarks compartidos
- `.obsidian/core-plugins.json` - Core plugins
- `.obsidian/core-plugins-migration.json` - Migration flags
- `.obsidian/community-plugins.json` - Lista de plugins
- `.obsidian/daily-notes.json` - Config de daily notes
- `.obsidian/graph.json` - Config del graph view
- `.obsidian/hotkeys.json` - Atajos de teclado
- `.obsidian/snippets/*.css` - CSS snippets del proyecto
- `.obsidian/plugins/*/data.json` - Configuracion de plugins

### Se ignora (.gitignore)
- `.obsidian/workspace.json` - Layout personal
- `.obsidian/workspace/` - Workspace data
- `.obsidian/cache/` - Cache
- `.obsidian/plugins/*/main.js` - Binarios de plugins
- `.obsidian/plugins/*/styles.css` - Estilos de plugins
- `.obsidian/plugins/*/manifest.json` - Manifiestos de plugins
- `.trash/` - Papelera de Obsidian

## Verificacion Post-Instalacion

Despues de instalar, verificar que existan:

```bash
# Archivos de memoria
ls .project/Memory/CONTEXT.md .project/Memory/KANBAN.md .project/Memory/DASHBOARD.md

# Config Obsidian
ls .obsidian/app.json .obsidian/community-plugins.json

# Plugins pre-configurados
ls .obsidian/plugins/obsidian-kanban/data.json
ls .obsidian/plugins/dataview/data.json
ls .obsidian/plugins/templater-obsidian/data.json

# Scripts
ls scripts/new-wave.sh scripts/new-wave.ps1

# Gitignore (debe contener lineas de Obsidian)
grep "obsidian" .gitignore
```

## Migracion desde VibeKanban

Si ya usas vibekanban:

1. Copiar `.obsidian/` al proyecto
2. Crear `KANBAN.md` y `DASHBOARD.md` en `.project/Memory/`
3. Agregar frontmatter YAML a archivos existentes (CONTEXT, DECISIONS, etc.)
4. Agregar inline fields Dataview a ADRs y blockers existentes
5. Actualizar `.gitignore` con el snippet de Obsidian
