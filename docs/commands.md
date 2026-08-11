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
10. **Mock mode** — Generate `.env.example` and `.env` with mock values (optional)
11. **.context/** — Generate `INDEX.md` and `summary.md` with stack-aware project context
12. **CLAUDE.md** — Generate project-aware `CLAUDE.md` with stack, conventions, skills
13. **Manifest** — Write `.javi-forge/manifest.json`

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dry-run` | boolean | `false` | Preview without writing |
| `--stack` | string | — | Stack: `node`, `python`, `go`, `rust`, `java-gradle`, `java-maven`, `elixir` |
| `--ci` | string | — | CI: `github`, `gitlab`, `woodpecker` |
| `--memory` | string | — | Memory: `engram`, `obsidian-brain`, `memory-simple`, `none` |
| `--project-name` | string | — | Project name |
| `--ghagga` | boolean | `false` | Enable GHAGGA review |
| `--mock` | boolean | `false` | Enable mock-first mode |
| `--batch` | boolean | `false` | Non-interactive mode |

### Examples

```bash
npx javi-forge init
npx javi-forge init --stack node --ci github
npx javi-forge init --stack go --ci gitlab --memory engram --batch
npx javi-forge init --dry-run --project-name app --stack node --ci github --batch
```

---

## ci

Run the local CI simulation (lint + compile + test + security + ghagga).
Single-stack repositories need no configuration — the stack is auto-detected
from marker files. Hybrid repositories declare ordered runners in
`.javi-forge/ci.yaml` (see [CI Runners](ci-runners.md)).

```bash
javi-forge ci                                  # full run (Docker)
javi-forge ci --quick                          # lint + compile only
javi-forge ci --detect                         # show resolved runners and exit
javi-forge ci --stack python                   # force one stack (single-stack repos only)
javi-forge ci --config .javi-forge/ci.yaml     # explicit runner config
javi-forge ci --no-docker                      # run natively
```

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--quick` | boolean | `false` | Lint + compile only (used by the pre-commit hook) |
| `--shell` | boolean | `false` | Open an interactive shell in the CI container |
| `--detect` | boolean | `false` | Show resolved stack/runners and exit |
| `--config` | string | `.javi-forge/ci.yaml` if present | Versioned mixed-runner config |
| `--stack` | string | — | Explicit single-stack override (insufficient for hybrid repos) |
| `--no-docker` | boolean | `false` | Run commands natively |
| `--no-ci-ghagga` | boolean | `false` | Skip GHAGGA review |
| `--no-security` | boolean | `false` | Skip Semgrep scan |
| `--timeout` | number | `600` | Per-step timeout in seconds |

`--config` and `--stack` are mutually exclusive (rejected as ambiguous).

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
| **Security** | commit-signing advisory (`commit.gpgsign` + `user.signingkey`), branch-protection advisory (GitHub → `gh api` probe; GitLab/no-gh → skip-with-note) |
| **Framework Structure** | templates/, modules/, ai-config/, workflows/, schemas/, ci-local/ |
| **Stack Detection** | Looks for package.json, go.mod, Cargo.toml, build.gradle, pom.xml, etc. |
| **Project Manifest** | `.javi-forge/manifest.json` — project name, stack, creation date |
| **Installed Modules** | engram, obsidian-brain, memory-simple, ghagga |

---

## tdd init

Install a TDD-enforcing pre-commit hook that requires tests to pass before committing.

```bash
npx javi-forge tdd init
```

### What it does

Auto-detects your project stack and installs a `.git/hooks/pre-commit` hook with the correct test command:

| Stack | Test Command |
|-------|-------------|
| **node** | `npm test` / `pnpm run test` / `yarn run test` |
| **python** | `pytest` |
| **go** | `go test ./...` |

To bypass the hook: `git commit --no-verify`.

---

## hooks

Run the consolidated git-hook dispatcher. The static shims installed in
`.git/hooks/` delegate to this command — they contain no logic of their own, so
all composition is driven from `.javi-forge/ci.yaml`.

```bash
javi-forge hooks run pre-commit
javi-forge hooks run pre-push
```

Only `pre-commit` and `pre-push` are accepted; any other name prints usage and
exits 1 (fail-closed). A blocking section failure exits non-zero and blocks the
git operation. A `.javi-forge/ci.yaml` that fails to validate also exits 1 — a
broken config never silently skips a gate.

With **no** `hooks:` config, the dispatcher runs the default composition: the
quick native CI gate (setup + lint + compile + gates — **no tests, no
coverage**).

To bypass: `git commit --no-verify` (pre-push: `git push --no-verify`).

### `hooks:` config reference

Add a `hooks:` section to a **version 2** `.javi-forge/ci.yaml` to choose which
sections each hook composes. Sections run in a fixed cheap→expensive order,
fail-fast on the first blocking failure.

```yaml
version: 2
hooks:
  pre-commit:
    ci: true          # quick native CI gate (setup + lint + compile + gates)
    tdd: false        # run the stack test command
    secrets: false    # L1 staged-file secret scan
    permissions: false # L3 permission-boundary checks
  pre-push:
    ci: true          # quick native CI gate
    tdd: false        # false | "warn" (advisory, never blocks) | "strict"
    deps: false       # L2 dependency-audit ladder
```

| Hook | Section | Default | Meaning |
|------|---------|---------|---------|
| `pre-commit` | `ci` | `true` | Quick native CI gate |
| `pre-commit` | `tdd` | `false` | Run the stack test command |
| `pre-commit` | `secrets` | `false` | L1 staged-file secret scan |
| `pre-commit` | `permissions` | `false` | L3 permission-boundary checks |
| `pre-push` | `ci` | `true` | Quick native CI gate |
| `pre-push` | `tdd` | `false` | `false` \| `"warn"` (advisory) \| `"strict"` |
| `pre-push` | `deps` | `false` | L2 dependency-audit ladder |

Notes:

- `hooks:` requires `version: 2`. Declaring it under `version: 1` is rejected
  (`hooks require version: 2`).
- Only `pre-push.tdd` has a mode. `"warn"` prints but never blocks the push;
  `"strict"` (or `true`) blocks. Every other section is always blocking.
- A `hooks:`-only v2 config (no `runners:`/`gates:`) is valid.

### Migration notes

`installCIHooks` (used by both `ci init` and `init`) is the only writer of
`.git/hooks/`. It reconciles legacy setups on the next install:

- A repo whose **local** `core.hooksPath` is exactly `ci-local/hooks` is
  auto-migrated: the value is unset and the shims are installed, with a note
  explaining the config change.
- A **foreign** `core.hooksPath` (any other non-empty value, at any scope) or a
  foreign existing hook is left untouched — the installer refuses with zero
  writes. Re-run with `--force` to overwrite a foreign hook body (the previous
  body is backed up first). `--force` does **not** override a foreign
  `core.hooksPath`.
- A previously javi-forge-managed but outdated shim is silently upgraded — no
  `--force` needed.

---

## plugin

Manage javi-forge plugins.

```bash
npx javi-forge plugin <action> [target] [options]
```

### Actions

| Action | Description |
|--------|-------------|
| `add <org/repo>` | Install a plugin from GitHub |
| `remove <name>` | Remove an installed plugin |
| `list` | List installed plugins |
| `search [query]` | Search the plugin registry |
| `validate <dir>` | Validate a local plugin directory |
| `sync` | Auto-detect and wire installed plugins |
| `export <name>` | Export to Agent Skills spec (`skills.json`) |
| `export <name> --codex` | Export to Codex-compatible TOML subagent files |
| `import <dir>` | Import an Agent Skills spec package as a plugin |

### Examples

```bash
npx javi-forge plugin add mapbox/agent-skills
npx javi-forge plugin remove agent-skills
npx javi-forge plugin list
npx javi-forge plugin sync
npx javi-forge plugin export my-plugin
npx javi-forge plugin export my-plugin --codex
npx javi-forge plugin import ./agent-skills-pkg
```

---

## skills

Analyze and score installed AI skills.

```bash
npx javi-forge skills <action> [options]
```

### Actions

| Action | Description |
|--------|-------------|
| `doctor` | Health report (add `--deep` for conflict + duplicate detection) |
| `budget` | Token cost of loaded skills (add `-b N` for custom budget) |
| `score <name>` | Score a skill on quality dimensions (0-100) |
| `benchmark <name>` | Structural quality checks with pass/fail |

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--deep` | boolean | `false` | Enable conflict + duplicate detection (doctor) |
| `--budget, -b` | number | `8000` | Token budget limit |
| `--skills-dir` | string | `~/.claude/skills` | Custom skills directory |

### Examples

```bash
npx javi-forge skills doctor
npx javi-forge skills doctor --deep
npx javi-forge skills budget -b 12000
npx javi-forge skills score react-19
npx javi-forge skills benchmark typescript
```

---

## security

Track and detect security regressions with baseline snapshots.

```bash
npx javi-forge security <action>
```

### Actions

| Action | Description |
|--------|-------------|
| `baseline` | Create baseline from current audit findings |
| `check` | Check for regressions (exits non-zero if found) |
| `update` | Re-snapshot baseline (acknowledge current vulns) |

Supports: **node** (npm/pnpm/yarn), **python** (pip-audit), **go** (govulncheck), **rust** (cargo audit).

Baseline stored in `.javi-forge/security-baseline.json`.

### Examples

```bash
npx javi-forge security baseline
npx javi-forge security check
npx javi-forge security update
```

---

## llms-txt

Generate an AI-friendly `llms.txt` with compact project notation.

```bash
npx javi-forge llms-txt [--dry-run]
```

Scans project structure, dependencies, and entry points. Output is ~75% smaller than full documentation in token cost.
