# Engram - Persistent Memory for AI Agents

> Tu agente AI olvida todo cuando termina la sesion. Engram le da memoria persistente.

## Que es Engram

[Engram](https://github.com/Gentleman-Programming/engram) es un sistema de memoria persistente para agentes AI de coding.
Funciona como servidor MCP que permite a Claude Code, OpenCode, Cursor y otros agentes guardar y buscar memorias estructuradas entre sesiones.

## Comparacion con otros modulos de memoria

| Modulo | Para quien | Persistencia | Busqueda |
|--------|-----------|-------------|----------|
| `memory-simple` | Humanos | Archivo NOTES.md | Manual |
| `obsidian-brain` | Humanos | Vault Obsidian + Kanban | Dataview queries |
| **`engram`** | **Agentes AI** | **SQLite + FTS5** | **Full-text search** |

**Engram complementa a obsidian-brain:** uno es para humanos (docs, kanban, decisiones), el otro para agentes AI (patrones, bugfixes, contexto entre sesiones).

## Instalacion

### Opcion 1: Via init-project.sh (recomendado)

```bash
./scripts/init-project.sh
# Seleccionar opcion 5 en modulo de memoria
```

### Opcion 2: Manual

```bash
# Instalar binario
./optional/engram/install-engram.sh

# Copiar config MCP a tu proyecto
cp optional/engram/.mcp-config-snippet.json tu-proyecto/.mcp.json

# Agregar al .gitignore
cat optional/engram/.gitignore-snippet.txt >> tu-proyecto/.gitignore
```

### Opcion 3: Desde releases

```bash
# Linux/macOS
curl -fsSL https://github.com/Gentleman-Programming/engram/releases/latest/download/engram_$(uname -s)_$(uname -m).tar.gz | tar xz
sudo mv engram /usr/local/bin/

# Windows (PowerShell)
./optional/engram/install-engram.ps1
```

## Configuracion MCP

### Claude Code

Agregar a `.mcp.json` en la raiz del proyecto:

```json
{
  "mcpServers": {
    "engram": {
      "command": "engram",
      "args": ["mcp"],
      "env": {
        "ENGRAM_PROJECT": "mi-proyecto"
      }
    }
  }
}
```

### OpenCode

Engram incluye un plugin nativo para OpenCode:

```bash
# Copiar plugin
cp $(which engram)/../plugin/opencode/engram.ts ~/.opencode/plugins/
```

## Herramientas MCP Disponibles

Engram expone 10 herramientas via MCP:

| Herramienta | Descripcion |
|-------------|-------------|
| `mem_search` | Buscar memorias por texto (FTS5) |
| `mem_save` | Guardar observacion (bugfix, decision, patron) |
| `mem_get_observation` | Obtener contenido completo de una observacion |
| `mem_timeline` | Timeline cronologico alrededor de resultados |
| `mem_session_start` | Iniciar sesion de trabajo |
| `mem_session_end` | Finalizar sesion con resumen |
| `mem_session_list` | Listar sesiones recientes |
| `mem_stats` | Estadisticas de la base de memorias |
| `mem_search_sessions` | Buscar sesiones por texto |
| `mem_compact` | Compactar memorias antiguas |

### Patron de Busqueda Progresiva

Engram usa un modelo de 3 capas para optimizar tokens:

1. `mem_search` - Resultados compactos (titulo + tipo)
2. `mem_timeline` - Contexto cronologico
3. `mem_get_observation` - Contenido completo sin truncar

## Tipos de Observaciones

| Tipo | Cuando usar |
|------|------------|
| `decision` | Decisiones arquitecturales (ADRs) |
| `pattern` | Patrones de codigo recurrentes |
| `bugfix` | Bugs encontrados y sus soluciones |
| `convention` | Convenciones del proyecto |
| `learning` | Aprendizajes generales |

## Uso con Obsidian Brain

Engram y obsidian-brain son complementarios:

```
obsidian-brain (.project/Memory/)     engram (SQLite)
├── CONTEXT.md   → Estado humano      ├── Patterns     → Patrones del agente
├── KANBAN.md    → Tareas visuales    ├── Bugfixes     → Soluciones automaticas
├── DECISIONS.md → ADRs humanos       ├── Decisions     → Contexto del agente
└── BLOCKERS.md  → Issues humanos     └── Conventions   → Reglas aprendidas
```

Para instalar ambos, selecciona obsidian-brain (opcion 1) en init-project.sh y luego instala engram por separado con `install-engram.sh`.

## Privacidad

Engram incluye proteccion de privacidad en dos niveles:
- Tags `<private>` se eliminan antes de transmision HTTP
- En la capa de almacenamiento, contenido privado se reemplaza con `[REDACTED]`

## Sincronizacion con Git

Engram soporta sincronizar memorias via Git (para equipos):

```bash
engram sync push    # Exportar memorias
engram sync pull    # Importar memorias del equipo
```

Las memorias se exportan como JSONL comprimido con gzip.
