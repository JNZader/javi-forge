# codex-adapter Specification

## Purpose

Define the Codex CLI adapter for the SkillGuard PreToolUse guard: a thin config plus
three shims (apply_patch file-write parsing, project-dir from `cwd`, hook trust) layered
on the shared agnostic core. Grounded in the verified Codex model (codex-cli 0.147.0,
real captured envelopes): hooks are stable and default-ON, the envelope MATCHES the
shipped `.mjs` field names, and exit-2+stderr deny is DROP-IN. The adapter reuses the
same `.mjs` subprocess asset. This spec describes outcomes; the exact `trusted_hash`
computation is a design open item (design MUST pin it or fall back to the documented
trust-step outcome — the trust requirement holds either way).

## Requirements

### Requirement: Codex Bash sensitive and critical commands are denied

Installed as a Codex `PreToolUse` hook, the guard MUST deny a Codex `Bash` event whose
`tool_input.command` is a sensitive or critical command, using the same deny classes as
the Claude Bash policy (destructive ops, pipe-to-shell, sensitive-file access, force
push, managed-hook tampering). Denial MUST use exit `2` + bounded stderr, or the deny
stdout form with a non-empty reason. A command outside the deny corpus MUST exit `0`.

#### Scenario: Codex sensitive Bash command is denied

- GIVEN the guard is installed and trusted as a Codex `PreToolUse` hook
- WHEN a Codex event delivers `tool_name:"Bash"` with a sensitive/critical `command`
- THEN the guard denies it (exit `2` + bounded stderr, or deny stdout with a reason)

#### Scenario: Codex benign Bash command is allowed

- GIVEN the trusted Codex hook
- WHEN a Codex `Bash` event carries a command outside every deny class
- THEN the guard writes nothing and exits `0`

### Requirement: Codex file writes via apply_patch protect managed-config paths

Codex delivers file writes as `tool_name:"apply_patch"` with the target path inside the
`tool_input.command` patch text (`*** Add File: <p>`, `*** Update File: <p>`,
`*** Delete File: <p>`), with NO `file_path` field. The adapter MUST match `apply_patch`
and parse the affected path(s) from the patch text, then apply the managed-config
protection: a patch that adds, updates, or deletes a managed path (`.claude/...`,
managed settings, `.javi-forge/ci.yaml`, and the Codex-managed `.codex/hooks.json`
itself) MUST be DENIED; a patch touching only non-managed paths MUST be ALLOWED. A
malformed or unparseable patch MUST fail closed (deny) rather than silently allow.

#### Scenario: apply_patch that writes a managed path is denied

- GIVEN a trusted Codex hook
- WHEN an `apply_patch` event's patch text adds, updates, or deletes a managed-config path
- THEN the guard denies the event with a bounded managed-path reason and no file content

#### Scenario: apply_patch on a benign path is allowed

- GIVEN a trusted Codex hook
- WHEN an `apply_patch` event touches only non-managed paths
- THEN the guard exits `0` silently

#### Scenario: Malformed patch fails closed

- GIVEN a trusted Codex hook
- WHEN an `apply_patch` event carries patch text the parser cannot resolve to a path
- THEN the guard fails closed (denies) rather than allowing the write

### Requirement: Project-dir resolves from the envelope cwd under Codex

Codex sets no `CLAUDE_PROJECT_DIR` (and no `CODEX_PROJECT_DIR`). When the Claude
project-dir env var is unset, the adapter's project-dir-relative logic MUST use the
envelope `cwd` field so managed paths expressed relative to the project root are still
recognized and protected.

#### Scenario: cwd-relative managed path is protected under Codex

- GIVEN a Codex event with the Claude project-dir env var unset and `cwd` set to the project root
- WHEN the guard resolves a managed path expressed relative to `cwd`
- THEN it recognizes the path as managed and denies a write/edit/delete of it

### Requirement: Codex install leaves the hook effectively running or reports the trust step

`hooks install codex` MUST leave the guard in an EFFECTIVELY-RUNNING state: it MUST
either establish Codex hook trust (record the `trusted_hash`) so the hook actually
fires, OR clearly report that trust must still be granted and exactly how. It MUST NOT
silently install an untrusted (therefore skipped) hook and report success as if the
project were protected. Re-running install MUST be idempotent.

#### Scenario: Install yields a trusted, firing hook or names the remaining step

- GIVEN a project with no Codex guard installed
- WHEN `hooks install codex` runs
- THEN either the hook is installed AND trusted (fires), or install reports the exact remaining trust step
- AND install never reports "protected" while the hook is untrusted-and-skipped

#### Scenario: Re-running install is idempotent

- GIVEN a trusted, current Codex guard installation
- WHEN `hooks install codex` runs again
- THEN it reports the installation as current and changes no bytes, paths, or trust state

### Requirement: Codex install uses the same transactional fail-closed secure-fs

The Codex adapter MUST write `~/.codex/hooks.json` and the `config.toml` trust state
through the SAME transactional, fail-closed secure-fs used by Claude (owned paths,
ancestor safety gate, atomic rename, refusal on unsafe targets). It MUST NOT introduce a
weaker write path for Codex.

#### Scenario: Codex install refuses fail-closed on an unsafe target

- GIVEN a Codex config target whose ancestor chain is unsafe (untrusted-writable parent, symlink, non-regular)
- WHEN `hooks install codex` preflights the write
- THEN it refuses without mutating any Codex target, exactly as the Claude installer would

### Requirement: A real Codex install-and-deny is verified end-to-end

Acceptance MUST include a REAL Codex install-and-deny on a Linux host: install the guard
as a Codex hook, run a real `codex` `Bash` event and a real `apply_patch` event against
a managed path, and observe the deny. An untrusted install MUST be reported by doctor as
NOT effectively running.

#### Scenario: Real Codex managed-path deny is observed

- GIVEN the guard installed and trusted as a Codex `PreToolUse` hook on this Linux box
- WHEN a real `codex` `apply_patch` targets a managed path and a real `codex` `Bash` runs a sensitive command
- THEN both are denied end-to-end, and an untrusted install is reported by doctor as not running
