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
javi-forge ci --github-parity                  # native, reproducible subset of the GitHub test job
javi-forge ci --github-parity --json           # structured LOCAL/FOLLOW-UP parity evidence
javi-forge ci --detect                         # show resolved runners and exit
javi-forge ci --stack python                   # force one stack (single-stack repos only)
javi-forge ci --config .javi-forge/ci.yaml     # explicit runner config
javi-forge ci --no-docker                      # run natively
```

### Flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--quick` | boolean | `false` | Lint + compile only (used by the pre-commit hook) |
| `--github-parity` | boolean | `false` | Run the locally reproducible native subset of `.github/workflows/ci.yml`'s `test` job, including dependency restore. Labels reproducible checks as `LOCAL` evidence and CI-only/global side-effect gaps as `FOLLOW-UP` evidence; does not alter quick hooks or certify the complete workflow. |
| `--shell` | boolean | `false` | Open an interactive shell in the CI container |
| `--detect` | boolean | `false` | Show resolved stack/runners and exit |
| `--config` | string | `.javi-forge/ci.yaml` if present | Versioned mixed-runner config |
| `--stack` | string | — | Explicit single-stack override (insufficient for hybrid repos) |
| `--no-docker` | boolean | `false` | Run commands natively |
| `--no-ci-ghagga` | boolean | `false` | Skip GHAGGA review |
| `--no-security` | boolean | `false` | Skip Semgrep scan |
| `--timeout` | number | `600` | Per-step timeout in seconds, including each native GitHub parity command |

`--config` and `--stack` are mutually exclusive (rejected as ambiguous).

`ci --github-parity --json` bypasses Ink and emits schema version `1`:
`{ schemaVersion, mode: "github-parity", ok, exitCode, steps, summary, error? }`.
Each step preserves the user-facing `LOCAL`/`FOLLOW-UP` label and adds an
`evidenceClass` of `local`, `local-tool-missing`, `github-hosted`, or
`global-side-effect`. Follow-ups remain explicit evidence gaps; only local
command failures make `ok:false` / `exitCode:1`.

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

### Agent guard commands

The dispatcher also manages the optional PreToolUse guards for Claude Code and
Codex, plus the OpenCode global plugin, Grok Build global hook, and Cursor
global hook:

```bash
javi-forge hooks install claude
javi-forge hooks doctor claude
javi-forge hooks repair claude --force
javi-forge hooks install codex
javi-forge hooks doctor codex
javi-forge hooks repair codex --force
javi-forge hooks install opencode
javi-forge hooks doctor opencode
javi-forge hooks repair opencode --force
javi-forge hooks install grok
javi-forge hooks doctor grok
javi-forge hooks repair grok --force
javi-forge hooks install cursor
javi-forge hooks doctor cursor
javi-forge hooks repair cursor --force
```

`install` and `repair` exit `0` on success and non-zero on refusal or failure.
`doctor claude` is informational and exits `0`; `doctor codex` reports the
effective execution verdict: `0` runnable, `1` blocked, or `2` inconclusive.
Codex doctor checks `~/.codex/hooks.json`, `~/.codex/config.toml`, the managed
asset, Node availability, and the provider-trust boundary. A successful
registration does not prove provider trust or runtime execution; trust must be
reviewed and approved in Codex. When a managed Codex registration is
`released-outdated`, doctor recommends `javi-forge hooks install codex`.

OpenCode installation writes both the plugin and its policy runtime side by side
under `~/.config/opencode/plugins/`; the plugin imports the latter relatively.
`doctor opencode` is informational and classifies those two installed files. It
does not claim that an OpenCode runtime discovered, loaded, or executed them.

Grok Build installation writes a `PreToolUse` registration and adjacent policy
runtime under `~/.grok/hooks/`. The registration intentionally matches only
`run_terminal_command`, `read_file`, and `search_replace`, which map to the
shared Bash/Read/Edit policy surfaces. `doctor grok` is informational and
classifies the registration and policy bytes; it does not claim that Grok loaded
or executed them. On Linux, install/repair uses the same secure filesystem proof
chain as Claude and needs `getfacl` from the `acl` package.

Cursor installation merges a `preToolUse` registration into
`~/.cursor/hooks.json` and writes an adjacent policy runtime under
`~/.cursor/hooks/`. The registration uses `failClosed: true` and matches
`Shell`, `Read`, `Write`, and `Delete`, which map to the shared
Bash/Read/Write/Edit policy surfaces. `doctor cursor` is informational and
classifies the registration and policy bytes; it does not claim that Cursor
loaded or executed them. On Linux, install/repair uses the same secure
filesystem proof chain as Claude and needs `getfacl` from the `acl` package.

The `--force` option is only for edited managed assets. Foreign, malformed,
symlink, and non-regular hook content remains fail-closed and is not forcibly
overwritten.

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
- When `ci init` runs inside the `javi-forge` source checkout, it compares the
  running CLI package version with the checkout's `package.json`. If they differ,
  it prints a warning before/alongside install output: update the global CLI or
  run the local CLI (`node dist/index.js ci init`) before trusting hook activation.
  This catches the stale-global case where an old `javi-forge` on `PATH` installs
  older hook assets than the source tree you are looking at.

### Codex global configuration boundary

The Codex PreToolUse policy treats only the current host user's
`~/.codex/hooks.json` and `~/.codex/config.toml` as managed global write targets.
It does not protect the whole home directory or every `.codex` file, and existing
project-scoped protection remains unchanged. Reads remain permitted unless an
existing sensitive-path rule applies.
Legitimate agents are subject to the same boundary: writes to either selected
global file are blocked regardless of their intent.

This boundary neither installs nor activates a hook, changes trust, nor modifies
live configuration. Updating the bundled policy asset requires updating its
manifest SHA-256 and retaining the outgoing digest in manifest history so released
installations can be recognized for upgrade.

### OpenCode global plugin boundary

The OpenCode installer owns only the two managed files under the current user's
`~/.config/opencode/plugins/`. It does not edit `opencode.json`, project-local
configuration, or any other OpenCode file. Foreign, malformed, symlink, and
non-regular plugin targets remain fail-closed even with `--force`.

### Grok Build global hook boundary

The Grok installer owns only `~/.grok/hooks/javi-forge-skillguard-pre-tool-use.json`
and its adjacent `.mjs` policy runtime. The policy also refuses writes to those
two current-user global targets, while project-scoped protection covers
`.grok/config.toml`, `.grok/hooks/`, `AGENTS.md`, and the existing Claude
configuration boundary. Foreign, malformed, symlink, and non-regular targets
remain fail-closed even with `--force`.

### Cursor global hook boundary

The Cursor installer owns only `~/.cursor/hooks.json` and
`~/.cursor/hooks/javi-forge-skillguard-pre-tool-use.mjs`. The policy also refuses
writes to those two current-user global targets, while project-scoped protection
covers `.cursor/hooks/`, `.cursor/hooks.json`, `.cursor/rules/`, `AGENTS.md`,
and the existing Claude configuration boundary. Foreign hook registrations are
preserved when the managed hook is added; malformed, symlink, and non-regular
targets remain fail-closed even with `--force`.

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
