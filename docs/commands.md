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

## ai providers

Generate, test, and apply portable AI provider catalogs for Gentle Pi and
OpenCode without copying machine-local secrets.

```bash
javi-forge ai providers export-free /tmp/free-providers --target both
javi-forge ai providers convert pi opencode /tmp/pi-to-opencode --config ~/.pi/agent/models.json
javi-forge ai providers smoke-test /tmp/pi-smoke --runtime pi --provider openrouter-free --env-file ~/.config/javi-forge/secrets/providers.env
javi-forge ai providers smoke-test /tmp/opencode-smoke --runtime opencode --provider google --env-file ~/.config/javi-forge/secrets/providers.env
javi-forge ai providers apply-scope /tmp/opencode-smoke/smoke.jsonl --target opencode --opencode-config /tmp/opencode.json --dry-run
profile_dir="$(mktemp -d "${TMPDIR:-/tmp}/javi-forge-model-profiles.XXXXXX")"
javi-forge ai providers profile-plan "$profile_dir" --pass-list /tmp/opencode-smoke/javi-forge-provider-smoke-<timestamp>.pass.tsv --limit 8
javi-forge ai providers profile-plan "$profile_dir" --pass-list /tmp/opencode-smoke/javi-forge-provider-smoke-<timestamp>.jsonl --preset community-backend-opencode-go --limit 8
javi-forge ai providers profile-export "$profile_dir/model-assignment.profiles.generated.json" --target opencode
javi-forge ai providers profile-apply /tmp/opencode.model-profiles.generated.json --pass-list /tmp/opencode-smoke/smoke.jsonl --target opencode --opencode-config /tmp/opencode.json --dry-run
```

`apply-scope` only accepts evidence with at least one passing model. It rejects
smoke-test `--dry-run` JSONL and empty/no-pass inputs instead of clearing model
configuration from preview artifacts. Pi requires `--pi-settings` and OpenCode
requires `--opencode-config`; there is no homedir default.

### OpenCode smoke-test behavior

When `--runtime opencode` is used without `--config`, `javi-forge` discovers the
currently visible OpenCode model list by running `opencode models`. This catches
built-in providers and whitelists that are not represented as `provider.models`
inside `opencode.json`.

OpenCode probes are intentionally low-noise:

- run sequentially, never concurrently;
- run from a clean working directory (`--smoke-cwd`, default: OS temp dir);
- call `opencode run --pure`;
- use the lightweight OpenCode agent from `--opencode-agent` (default: `title`);
- write JSONL, markdown summary, and `.pass.tsv` artifacts for repeatable
  retests and scoped apply.
- with `--dry-run`, write selected rows as `dry_run` and leave `.pass.tsv`
  empty, so preview output cannot be confused with passing provider evidence.

Pass `--config ~/.config/opencode/opencode.json` only when you deliberately want
to test the provider metadata declared in that file instead of the active
runtime-visible model list.

### Provider smoke-test flags

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--runtime` | string | `pi` | Runtime to probe: `pi` or `opencode` |
| `--config` | string | runtime default | Provider catalog/config path. For OpenCode, omit to discover via `opencode models` |
| `--provider` | string | — | Exact provider id filter |
| `--family` | string | — | Provider/model/name substring filter |
| `--model` | string | — | Model id substring filter |
| `--status` | string | — | Retest only rows with this status from `--report` |
| `--report` | string | — | Previous JSONL report used by `--status` |
| `--limit` | number | — | Maximum selected routes to probe |
| `--include-local` | boolean | `false` | Include local providers such as Ollama |
| `--env-file` | string | — | Load machine-local provider keys; values are never written to reports |
| `--pi-command` | string | `pi` | Pi executable |
| `--opencode-command` | string | `opencode` | OpenCode executable |
| `--opencode-agent` | string | `title` | OpenCode agent used by smoke probes |
| `--smoke-cwd` | string | OS temp dir for OpenCode | Working directory for smoke commands |
| `--timeout` | number | `30` | Per-model timeout in seconds |

### Model assignment profile plans

`javi-forge ai providers profile-plan <output-dir> --pass-list <pass.tsv|report.jsonl>`
turns smoke-tested provider evidence into advisory SDD model-assignment files:

- `model-assignment.profiles.generated.json`
- `model-assignment.profiles.generated.md`

The generated plan groups passing models into:

- `sdd-strong` — architecture, design, verification, review, and high-ambiguity
  decisions;
- `sdd-mid` — implementation, remediation, and multi-file debugging;
- `sdd-cheap` — specs, tasks, archive summaries, and low-risk continuation.

This command does **not** edit Pi, OpenCode, Codex, Cursor, Grok, provider auth,
secrets, or runtime configuration. It only writes advisory artifacts under the
requested output directory. Use `--dry-run` to preview file paths and selected
counts without writing. Generated files are created exclusively; rerun into a
fresh directory instead of overwriting existing artifacts. Do not feed profile
plans from smoke-test dry-run output; `profile-plan` rejects dry-run JSONL
reports, and dry-run smoke pass lists are intentionally empty.

Use `--preset community-backend-opencode-go` to generate a smoke-evidence-gated
pilot plan from the community OpenCode Go backend SDD/JD assignment. The preset
is still advisory: every referenced model must appear in the passing evidence,
the global coordinator/default remains out of scope, and runtime config remains
unchanged until `profile-apply` is run with explicit `--pi-settings` or
`--opencode-config`.

### Model assignment profile export previews

`javi-forge ai providers profile-export <profile-plan.json> [output-dir] --target pi|opencode|codex|both`
turns a generated `model-assignment.profiles.generated.json` plan into advisory
target-specific previews. Omitting `output-dir` writes beside the input plan.

- `--target pi` writes `pi.model-profiles.generated.json`.
- `--target opencode` writes `opencode.model-profiles.generated.json`.
- `--target both` writes both Pi and OpenCode previews.
- `--target codex` writes `codex.model-profiles.generated.md`, a report-only
  warning: Pi/OpenCode provider references are not Codex GPT-5.6 model IDs.

Every preview records its source plan path, generated time, routing, candidate
provider/model splits, and warnings. These files are not applied configuration:
the command never modifies Pi or OpenCode settings, Codex configuration, secrets,
credentials, auth/provider state, or runtime configuration. Use `--dry-run` to
list planned paths without writing. Generated preview files use exclusive create,
so rerun into a fresh output directory rather than overwriting an artifact.

### Model assignment profile apply

`javi-forge ai providers profile-apply <overlay.json> --pass-list <pass.tsv|report.jsonl> --target pi|opencode --pi-settings|--opencode-config <path> [--dry-run]`
applies one generated overlay to one runtime config. There is no homedir default:
Pi requires `--pi-settings`, OpenCode requires `--opencode-config`.

- `--target pi` merges the overlay into `modelProfiles` and must leave
  `defaultProvider`, `defaultModel`, and `enabledModels` unchanged.
- `--target opencode` sets `agent.<phase>.model` only for routing phases that
  already exist. Missing phases fail closed. Protected agents (`build`, `plan`,
  `gentle-orchestrator`, `dangerous-gentleman`, `title`, `summary`, `compaction`)
  are refused. `provider` auth/state is not modified.
- `--target both` and `--target codex` are refused.
- `--pass-list` must contain real passing models. Dry-run smoke JSONL and empty
  pass lists are rejected.
- A timestamped sibling backup is created with exclusive create (`*.bak-<UTC>`).
- `--dry-run` validates and prints paths without writing.

Restore a backup with:

```bash
javi-forge ai providers profile-apply --rollback /tmp/opencode.json.bak-20260916T120000Z --target opencode --opencode-config /tmp/opencode.json
```

---

## preparation

Run read-only production preparation diagnostics.
For the complete operator sequence, failure handling, and rollback notes, see
[Preparation operator runbook](preparation-runbook.md).

```bash
javi-forge preparation template --output preparation.config.example.json
javi-forge preparation outputs-template --output preparation.outputs.example.json
javi-forge preparation policy --json
javi-forge preparation digest --file /usr/bin/bwrap --json
javi-forge preparation readiness --config preparation.config.json --outputs preparation.outputs.json --approval preparation.approval.json --json
javi-forge preparation preflight --config preparation.config.json
javi-forge preparation preflight --config preparation.config.json --json
javi-forge preparation bind --config preparation.config.json --outputs preparation.outputs.json --json
javi-forge preparation approval-message --binding <hex> --json
javi-forge preparation approval-check --config preparation.config.json --binding <hex> --approval preparation.approval.json --json
javi-forge preparation approval-revoke --config preparation.config.json --binding <hex> --approval preparation.approval.json --json
javi-forge preparation status-ok --file opencode-status-ok.json --session ses_example --json
```

The template command writes an operator-owned JSON config skeleton with the exact
keys the preflight parser accepts. It writes with exclusive create by default and
requires `--force` to replace an existing file. The template contains no private
key, secret, approval evidence, model credential or generated artifact.

The outputs-template command writes an operator-owned six-output JSON skeleton
for the binding step. It writes with exclusive create by default and requires
`--force` to replace an existing file. The values are empty strings for the
operator to fill; the command does not stage outputs or generate helper code.

The policy command prints the compiled fixed preparation policy and output names.
It is read-only and does not read operator config, output files, approval
evidence, worker paths, or runtime state.

The digest command computes a SHA-256 digest for one bounded regular file. It
prints only the digest and byte length; it refuses empty, oversized, symlink, or
non-regular files. Operators can use it to fill pinned digest fields without
printing worker/source/launcher contents.

The preflight command parses an exact production preparation configuration,
checks the configured cwd/destination against policy, validates the Ed25519
public key shape, verifies the operator-owned state/control directories, confirms
the destination is absent for the non-overwrite run, and measures pinned
worker/source/launcher digests.

The readiness command recomputes the production binding from the config and
outputs, then verifies the approval evidence against that computed binding. It
prints only bounded binding and approval metadata, never output payload contents
or approval evidence, and it does not consume approvals, execute the worker,
stage outputs, contact a model, deploy, publish, release, or write generated
artifacts.

The bind command additionally parses an exact six-output JSON object and computes
the production approval binding for an external operator signer. It prints only
bounded measurements and the binding, never the output payload contents.

The approval-message command prepares the exact domain-separated message and
payload an external operator signer must sign for a binding. It may generate a
nonce and bounded timestamps, but it never reads a private key and never signs.

The approval-check command reads the operator-owned approval evidence, verifies
the Ed25519 signature and binding with the public key in the production config,
and reports only bounded approval metadata. It does not print the approval
evidence, signature, or payload body, and it does not consume the nonce.

The approval-revoke command verifies the same evidence and binding, then writes
only the exclusive `revoked` terminal marker in the operator-owned state
directory. It does not print the approval evidence, signature, or payload body,
execute the worker, stage outputs, consume an approval, contact a model, deploy,
publish, release, or write generated artifacts.

The status-ok command validates one bounded captured OpenCode StructuredOutput
response file for the fixed source-only `{"status":"ok"}` contract and session
identity. It prints only the bounded status result; it does not contact OpenCode,
call a model, use credentials, verify or consume approval evidence, execute the
worker, stage outputs, deploy, publish, release, or write generated artifacts.

These commands do **not** execute the worker, stage outputs, sign approvals,
contact a model, deploy, publish, release, or write generated artifacts.
`readiness` is a read-only gate: it verifies approval evidence but never consumes
it. Only `approval-revoke` writes state, and that state is the bounded terminal
revocation marker.

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
`doctor opencode` classifies those two installed files and reports effective
execution as `inconclusive` / exit `2`, because installed bytes do not prove
that an OpenCode runtime discovered, loaded, or executed the plugin.

Grok Build installation writes a `PreToolUse` registration and adjacent policy
runtime under `~/.grok/hooks/`. The registration intentionally matches only
`run_terminal_command`, `read_file`, and `search_replace`, which map to the
shared Bash/Read/Edit policy surfaces. `doctor grok` classifies the registration
and policy bytes and reports effective execution as `inconclusive` / exit `2`,
because installed bytes do not prove that Grok discovered, loaded, or invoked
the hook. On Linux, install/repair uses the same secure filesystem proof chain
as Claude and needs `getfacl` from the `acl` package.

Cursor installation merges a `preToolUse` registration into
`~/.cursor/hooks.json` and writes an adjacent policy runtime under
`~/.cursor/hooks/`. The registration uses `failClosed: true` and matches
`Shell`, `Read`, `Write`, and `Delete`, which map to the shared
Bash/Read/Write/Edit policy surfaces. `doctor cursor` classifies the
registration and policy bytes and reports effective execution as
`inconclusive` / exit `2`, because installed bytes do not prove that Cursor
discovered, loaded, or invoked the hook. On Linux, install/repair uses the same
secure filesystem proof chain as Claude and needs `getfacl` from the `acl`
package.

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
`doctor opencode` remains read-only and reports runtime discovery/loading/
execution as inconclusive until a reliable OpenCode runtime evidence mechanism
exists.

### Grok Build global hook boundary

The Grok installer owns only `~/.grok/hooks/javi-forge-skillguard-pre-tool-use.json`
and its adjacent `.mjs` policy runtime. The policy also refuses writes to those
two current-user global targets, while project-scoped protection covers
`.grok/config.toml`, `.grok/hooks/`, `AGENTS.md`, and the existing Claude
configuration boundary. Foreign, malformed, symlink, and non-regular targets
remain fail-closed even with `--force`.

`doctor grok` remains read-only and reports runtime discovery/loading/execution
as inconclusive until a reliable Grok runtime evidence mechanism exists.

### Cursor global hook boundary

The Cursor installer owns only `~/.cursor/hooks.json` and
`~/.cursor/hooks/javi-forge-skillguard-pre-tool-use.mjs`. The policy also refuses
writes to those two current-user global targets, while project-scoped protection
covers `.cursor/hooks/`, `.cursor/hooks.json`, `.cursor/rules/`, `AGENTS.md`,
and the existing Claude configuration boundary. Foreign hook registrations are
preserved when the managed hook is added; malformed, symlink, and non-regular
targets remain fail-closed even with `--force`.

`doctor cursor` remains read-only and reports runtime discovery/loading/execution
as inconclusive until a reliable Cursor runtime evidence mechanism exists.

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
