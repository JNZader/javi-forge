---
name: generate-agents-md
description: Inspect project and auto-generate a cross-agent compatible AGENTS.md
category: workflow
---

# /generate-agents-md

Inspects the current project and generates a well-structured `AGENTS.md` compatible with all major AI coding agents (Claude Code, Codex, Gemini CLI, Copilot, OpenCode).

## Usage

```
/generate-agents-md
```

## Steps

### 1. Detect Project Stack

```bash
# Package manager
ls package.json pyproject.toml Cargo.toml go.mod pom.xml build.gradle 2>/dev/null

# Test runner
cat package.json | grep -E '"test"|"jest"|"vitest"' 2>/dev/null
ls pytest.ini setup.cfg .pytest.ini 2>/dev/null

# CI workflows
ls .github/workflows/*.yml 2>/dev/null | head -5

# PR title pattern from recent commits
git log --oneline -10 2>/dev/null
```

### 2. Generate AGENTS.md Structure

Output a file with these sections:

```markdown
# AGENTS.md

> Cross-agent configuration for AI coding assistants.
> Compatible with: Claude Code, OpenCode, Codex CLI, Gemini CLI, GitHub Copilot.

## Dev Environment

- **Language:** <detected>
- **Package manager:** <detected>
- **Node/Python/Go version:** <from .nvmrc / .python-version / go.mod>

## Setup

```bash
<install command: npm install / pip install -r requirements.txt / go mod tidy>
```

## Testing

```bash
<test command: npm test / pytest / go test ./...>
```

## Key Conventions

- <PR title format from git log, e.g., Conventional Commits>
- <branch naming from git branch -r>
- <code style: eslint/prettier/black/gofmt if config files found>

## Important Files

- `<main config file>` — <brief description>
- `<main entry point>` — <brief description>

## AI Agent Notes

- Always run tests before marking a task complete
- Never commit directly to main — use feature branches
- Follow existing code style; check linter config before writing new code
- For large changes, create a plan first with /workflows:plan
```

### 3. Save and Confirm

Save to project root as `AGENTS.md` and report what was detected vs. what defaulted to assumptions.
