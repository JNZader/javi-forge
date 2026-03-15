---
name: obsidian-brain-workflow
description: >
  Guide for working with Obsidian Brain project memory: Kanban board, Dataview inline fields,
  Templater templates, and wave integration.
  Trigger: obsidian brain, kanban board, project memory, dataview, session tracking
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: project-starter-framework
  version: "1.0"
  tags: [workflow, obsidian, kanban, dataview, memory, sessions]
  updated: "2026-02"
---

# Obsidian Brain Workflow

Manage project memory using Obsidian-compatible markdown with Kanban, Dataview, and Templater.

## Session Start Checklist

At the beginning of every session:

1. **Read CONTEXT.md** - Current project state
   ```bash
   cat .project/Memory/CONTEXT.md
   ```

2. **Check KANBAN.md** - Active tasks and their lanes
   ```bash
   cat .project/Memory/KANBAN.md
   ```

3. **Review BLOCKERS.md** - Any open blockers
   ```bash
   grep "status:: open" .project/Memory/BLOCKERS.md
   ```

4. **Create session file** - Copy template or use Templater
   ```bash
   cp .project/Sessions/TEMPLATE.md .project/Sessions/$(date +%Y-%m-%d).md
   ```

## KANBAN.md Format

The Kanban board uses Obsidian Kanban plugin format. Each lane is an H2 heading, each task is a checkbox item.

```markdown
---
kanban-plugin: board
---

## Backlog
- [ ] T-001 Setup monorepo #wave
- [ ] T-005 Add monitoring

## En Progreso
- [ ] T-002 Configure CI #wave

## Review
- [ ] T-003 Add linters #wave

## Completado
- [x] T-000 Init project

**Complete**
```

### Moving Tasks Between Lanes

**Without Obsidian (AI CLI or manual edit):**
- Cut the `- [ ]` line from one H2 section
- Paste it under the target H2 section
- When completing: change `- [ ]` to `- [x]`

**With Obsidian:**
- Drag and drop cards between lanes

### Tags

- `#wave` - Part of current wave
- `#blocker` - Has an associated blocker
- `#review` - Needs review

## Dataview Inline Fields

Memory files use Dataview inline fields for automatic queries. Format: `key:: value`

### Required Fields Reference

| File | Required Fields | Notes |
|------|----------------|-------|
| DECISIONS.md (ADRs) | `type:: adr`, `status::`, `date::` | Without these, DASHBOARD queries return empty |
| BLOCKERS.md | `type:: blocker`, `status::`, `impact::`, `date::` | `impact` values: `alto`, `medio`, `bajo` |
| Sessions/*.md | frontmatter `type: session`, `date`, `phase`, `wave` | Use YAML frontmatter, not inline fields |

### ADR Fields (DECISIONS.md)

```markdown
## ADR-002: Use PostgreSQL

type:: adr
status:: aceptada
date:: 2026-01-15
```

### Blocker Fields (BLOCKERS.md)

```markdown
### BLOCKER-003: Docker build fails

type:: blocker
status:: open
impact:: alto
date:: 2026-01-20
```

### Valid Status Values

| File | Valid Statuses |
|------|---------------|
| ADRs | `pendiente`, `aceptada`, `rechazada`, `deprecada` |
| Blockers | `open`, `investigating`, `resolved`, `workaround` |

### Resolving a Blocker

When resolving, update both the inline field and the content:

```markdown
### BLOCKER-003: Docker build fails

type:: blocker
status:: resolved
impact:: alto
date:: 2026-01-20

**Solucion:**
Changed base image from alpine to debian-slim.
```

## Wave + Kanban Integration

KANBAN.md is for day-to-day task tracking. WAVES.md is the historical record.

### Creating a Wave

1. Add tasks to KANBAN.md Backlog with `#wave` tag
2. Run `./scripts/new-wave.sh "T-001 T-002 T-003"`
3. Move tagged tasks to "En Progreso" in KANBAN.md

### Completing a Wave

1. Move all wave tasks to "Completado" in KANBAN.md
2. Run `./scripts/new-wave.sh --complete`
3. Remove `#wave` tags from completed tasks

## Templates

### Manual (without Templater)

Copy the template file and fill in placeholders:

```bash
# New session
cp .project/Sessions/TEMPLATE.md .project/Sessions/2026-01-15.md

# New ADR - append to DECISIONS.md using the template at the bottom
# New Blocker - append to BLOCKERS.md using the template at the bottom
```

### With Templater (Obsidian)

Use Ctrl+T (or Cmd+T) to insert templates that auto-fill dates and prompt for values:

- `Session.md` - Creates session with current date, prompts for phase/wave/branch
- `ADR.md` - Creates ADR entry, prompts for number/title/context/decision
- `Blocker.md` - Creates blocker entry, prompts for number/title/impact

## Session End Checklist

At the end of every session:

1. **Update CONTEXT.md** - Reflect current state
2. **Update KANBAN.md** - Move tasks to correct lanes
3. **Complete session file** - Fill summary section
4. **Record blockers** - If any new ones appeared
5. **Record decisions** - If any ADRs were made

## Dashboard

DASHBOARD.md contains Dataview queries that auto-update in Obsidian:
- Recent decisions
- Active blockers
- Recent sessions

Without Obsidian, it shows as code blocks (read-only reference).
