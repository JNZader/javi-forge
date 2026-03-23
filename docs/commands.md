# Commands

## init

Bootstrap a new project. This is the default command.

```bash
npx javi-forge init [options]
```

### Steps

1. **git init** — Initialize a git repository (skips if `.git/` exists)
2. **git hooks** — Copy `ci-local/` and configure `core.hooksPath` (see `ci init` for a lighter alternative)
3. **CI template** — Generate CI workflow for your stack and provider
4. **.gitignore** — Copy from template (skip if exists)
5. **dependabot.yml** — Generate for GitHub (skip for other providers)
6. **Memory module** — Install engram, obsidian-brain, or memory-simple
7. **AI sync** — Run `javi-ai sync --target all` to generate per-CLI configs
8. **SDD** — Create `openspec/` directory with README
9. **GHAGGA** — Install review system and copy workflow (optional)
10. **Manifest** — Write `.javi-forge/manifest.json`

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | boolean | `false` | Preview without writing |
| `--stack` | string | — | Stack: `node`, `python`, `go`, `rust`, `java-gradle`, `java-maven`, `elixir` |
| `--ci` | string | — | CI: `github`, `gitlab`, `woodpecker` |
| `--memory` | string | — | Memory: `engram`, `obsidian-brain`, `memory-simple`, `none` |
| `--project-name` | string | — | Project name |
| `--ghagga` | boolean | `false` | Enable GHAGGA review |
| `--batch` | boolean | `false` | Non-interactive mode |

### Examples

```bash
npx javi-forge init
npx javi-forge init --stack node --ci github
npx javi-forge init --stack go --ci gitlab --memory engram --batch
npx javi-forge init --dry-run --project-name app --stack node --ci github --batch
```

---

## ci init

Install git hooks directly into `.git/hooks/` without copying files into the project. This is the **recommended approach for existing repositories**.

```bash
npx javi-forge ci init
```

### What it does

Installs three hooks in `.git/hooks/`:

| Hook | Description |
|------|-------------|
| `pre-commit` | Runs `javi-forge ci` with `--no-docker` by default, npx fallback |
| `pre-push` | Runs `javi-forge ci`, npx fallback |
| `commit-msg` | Runs `javi-forge ci` commit message validation, npx fallback |

Each hook references `javi-forge ci` directly with an `npx` fallback if the binary is not found. No files are copied into the project tree.

### When to use

- **New projects**: `javi-forge init` handles everything (copies `ci-local/` and configures `core.hooksPath`)
- **Existing repos**: Use `javi-forge ci init` — lighter, no `ci-local/` directory needed

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--no-docker` | boolean | `true` (pre-commit) | Disable Docker in hook execution |
| `--no-ci-ghagga` | boolean | `false` | Disable GHAGGA checks in hooks |

---

## analyze

Run repoforge skills analysis on the current project.

```bash
npx javi-forge analyze [--dry-run]
```

### What it does

Delegates to the [repoforge](https://github.com/Gentleman-Programming/repoforge) CLI to analyze your codebase and recommend skills. Requires `repoforge` to be installed.

### Prerequisites

```bash
pip install repoforge
```

### Example

```bash
npx javi-forge analyze
npx javi-forge analyze --dry-run
```

---

## doctor

Show a comprehensive health report.

```bash
npx javi-forge doctor
```

### What it checks

| Section | Checks |
|---------|--------|
| **System Tools** | git, docker, semgrep, node, pnpm |
| **Framework Structure** | templates/, modules/, ai-config/, workflows/, schemas/, ci-local/ |
| **Stack Detection** | Looks for package.json, go.mod, Cargo.toml, build.gradle, pom.xml, etc. |
| **Project Manifest** | `.javi-forge/manifest.json` — project name, stack, creation date |
| **Installed Modules** | engram, obsidian-brain, memory-simple, ghagga |
