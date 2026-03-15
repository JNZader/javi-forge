---
name: task-artifact
description: Creates a structured task directory with blank artifact files at session start. Directory is organized by domain, date, and task slug.
event: SessionStart
action: execute

metadata:
  author: project-starter-framework
  version: "1.0"
  updated: "2026-02"
---

# Task Artifact Hook

> Scaffolds a task workspace directory at the start of each session.

## Purpose

Automatically creates a `tasks/<domain>/<YYYY-MM-DD>/<task-slug>/` directory structure
with blank artifact files, so every session has a consistent place to capture research,
plans, file changes, and verification steps.

## Evento

- **Trigger:** SessionStart
- **Action:** execute
- **Condition:** When a session begins with a clear task or feature in mind

## Domain Detection

The `<domain>` is inferred from keywords in the first user message:

| Keywords | Domain |
|----------|--------|
| `git`, `commit`, `branch`, `merge`, `rebase` | `git` |
| `test`, `spec`, `coverage`, `mock`, `TDD` | `testing` |
| `feature`, `implement`, `build`, `create`, `add` | `development` |
| `bug`, `fix`, `error`, `broken`, `debug` | `bugfix` |
| `refactor`, `clean`, `extract`, `simplify` | `refactoring` |
| `deploy`, `CI`, `pipeline`, `docker`, `k8s` | `devops` |
| `security`, `vulnerability`, `auth`, `CVE` | `security` |
| `docs`, `README`, `documentation`, `guide` | `docs` |
| *(default)* | `general` |

## Directory Structure Created

```
tasks/
└── <domain>/
    └── <YYYY-MM-DD>/
        └── <task-slug>/
            ├── research.md
            ├── plan.md
            ├── files-edited.md
            └── verification.md
```

## Lógica

```
SI first message contains task keywords
ENTONCES infer domain and task-slug from message
  CREATE tasks/<domain>/<YYYY-MM-DD>/<task-slug>/
  CREATE research.md with ## Research header
  CREATE plan.md with ## Plan header
  CREATE files-edited.md with ## Files Changed header
  CREATE verification.md with checklist
SINO skip (no task directory needed for questions/exploration)
```

## Implementación

### Para Claude Code

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": ".*",
        "command": "bash .ai-config/scripts/task-artifact.sh \"$CLAUDE_SESSION_FIRST_MESSAGE\""
      }
    ]
  }
}
```

### Script: .ai-config/scripts/task-artifact.sh

```bash
#!/bin/bash
# Usage: task-artifact.sh "<first message>"
DOMAIN=$(echo "$1" | grep -qiE "git|commit|branch|merge" && echo "git" || \
         echo "$1" | grep -qiE "test|spec|coverage|mock|TDD" && echo "testing" || \
         echo "$1" | grep -qiE "bug|fix|error|broken|debug" && echo "bugfix" || \
         echo "$1" | grep -qiE "refactor|clean|extract" && echo "refactoring" || \
         echo "$1" | grep -qiE "deploy|CI|pipeline|docker" && echo "devops" || \
         echo "development")

DATE=$(date +%Y-%m-%d)
SLUG=$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | cut -c1-40)
DIR="tasks/$DOMAIN/$DATE/$SLUG"

mkdir -p "$DIR"
echo -e "## Research\n\n_Add findings here_" > "$DIR/research.md"
echo -e "## Plan\n\n_Add steps here_" > "$DIR/plan.md"
echo -e "## Files Changed\n\n_Auto-populated_" > "$DIR/files-edited.md"
echo -e "## Verification Checklist\n\n- [ ] Tests pass\n- [ ] No regressions\n- [ ] Docs updated" > "$DIR/verification.md"
echo "📁 Task workspace: $DIR"
```

## Template Files

See `tasks/_TEMPLATE/` for the canonical blank file templates.
