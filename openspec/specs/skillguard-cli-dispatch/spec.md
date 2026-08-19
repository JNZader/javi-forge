# skillguard-cli-dispatch Specification

## Purpose

Slice 4a wires the already-tested Claude PreToolUse guard library (`installClaudePreToolUse`, `doctorClaudePreToolUse`, `repairClaudePreToolUse`) to a real CLI surface and to `init`, so the guard becomes installable/inspectable/repairable without inventing new security logic. It is behavioral: it does not prescribe UI mechanism (console formatting choices, init prompt widget) beyond exit codes and the honest-execution constraint. The effective-execution matrix (RUNNABLE/BLOCKED/INCONCLUSIVE) is explicitly OUT of scope — deferred to Slice 4b.

## Requirements

### Requirement: `hooks install claude` renders the mutation result and exits accordingly

`javi-forge hooks install claude` MUST call `installClaudePreToolUse(projectDir)` and render its `ClaudeHookMutationResult` (`ok`, `changed`, `backups`, `errors`, `report`) as human-readable console output. The process MUST exit `0` when `ok` is `true` and a non-zero code when `ok` is `false` (refusal or failure).

When a rendered refusal carries a remediation (notably the ACL-adapter-absent remediation naming the `acl` package), the CLI MUST print that remediation text alongside the refusal reason. It MUST NOT render such a refusal as a bare internal reason code or a bare `getfacl absent` string with no actionable next step. The same rendering contract applies to `repair`, which renders results identically to `install`.
(Previously: the CLI rendered `errors` verbatim, so an ACL-adapter-absent refusal surfaced as an opaque reason with no remediation.)

#### Scenario: Fresh install succeeds

- GIVEN no managed asset or settings entry exists in the target project
- WHEN `javi-forge hooks install claude` runs
- THEN it calls `installClaudePreToolUse(projectDir)`, prints the changed paths, and exits `0`

#### Scenario: Install refuses on an unsafe state

- GIVEN the asset or settings entry is in a state the installer refuses without `--force` (e.g. `edited-managed`)
- WHEN `javi-forge hooks install claude` runs
- THEN `ok` is `false`, the console prints the refusal reason(s) from `errors`, and the process exits non-zero

#### Scenario: Adapter-absent refusal renders the package remediation

- GIVEN `getfacl` is not resolvable and the installer refuses with the ACL-adapter-absent remediation
- WHEN `javi-forge hooks install claude` runs
- THEN the console output names the `acl` package with the `apt install acl` / `apk add acl` / `dnf install acl` examples
- AND the process exits non-zero

#### Scenario: A refusal with remediation is never rendered bare

- GIVEN any refusal whose detail carries a remediation
- WHEN the CLI renders the mutation result
- THEN the output contains the remediation text, not only the internal reason code
- AND `repair` renders the identical remediation for the same refusal

### Requirement: `hooks doctor claude` renders the doctor report and never fabricates execution status

`javi-forge hooks doctor claude` MUST call `doctorClaudePreToolUse(projectDir)` and render the `ClaudeHookDoctorReport` (asset state, settings state, `healthy`, `remediation`, `hostResidual`). It MUST report `execution` as explicitly `inconclusive` or omit it entirely. It MUST NOT print, imply, or default to `RUNNABLE` in Slice 4a under any input.

#### Scenario: Doctor reports component health

- GIVEN a project with any combination of asset/settings ownership states
- WHEN `javi-forge hooks doctor claude` runs
- THEN it prints `healthy`, per-component state, and `remediation[]`, and exits `0` regardless of `healthy`'s value (doctor is informational, not a gate)

#### Scenario: Doctor never fabricates RUNNABLE

- GIVEN both components classify as `managed-current` and Node satisfies the minimum version
- WHEN `javi-forge hooks doctor claude` renders output
- THEN the output does NOT contain the literal execution verdict `RUNNABLE`
- AND execution status is either omitted or rendered as `inconclusive`, with no claim that the guard is confirmed live

### Requirement: `hooks repair claude [--force]` renders the mutation result and exits accordingly

`javi-forge hooks repair claude` MUST call `repairClaudePreToolUse(projectDir, { force })`, forwarding `--force` when the flag is present, and render the result identically to install (same success/refusal exit-code contract).

#### Scenario: Repair without --force refuses an edited-managed component

- GIVEN a managed component is `edited-managed`
- WHEN `javi-forge hooks repair claude` runs without `--force`
- THEN `ok` is `false`, the refusal reason is printed, and the process exits non-zero

#### Scenario: Repair with --force overwrites

- GIVEN a managed component is `edited-managed`
- WHEN `javi-forge hooks repair claude --force` runs
- THEN `repairClaudePreToolUse` is called with `force: true`, the mutation proceeds, and the process exits `0` on success

### Requirement: New subcommands route before the unknown-subcommand fallback

The `hooks` dispatcher MUST route `install claude`, `doctor claude`, and `repair claude [--force]` to their handlers before falling through to the help+exit-1 unknown-subcommand branch. Existing `hooks run <pre-commit|pre-push>` behavior MUST be unchanged, and any other unrecognized subcommand MUST still print help and exit `1`.

#### Scenario: New subcommands are not swallowed by the fallback

- GIVEN the dispatcher receives `hooks install claude`, `hooks doctor claude`, or `hooks repair claude`
- WHEN dispatch routes the command
- THEN the matching handler runs and the help+exit-1 fallback is never reached

#### Scenario: `hooks run` is unaffected

- GIVEN `javi-forge hooks run pre-commit` or `pre-push`
- WHEN dispatch routes the command
- THEN it behaves exactly as before this change (unchanged code path)

#### Scenario: Unknown subcommand still falls back

- GIVEN `javi-forge hooks bogus`
- WHEN dispatch routes the command
- THEN it prints `HOOKS_HELP_TEXT` and exits `1`

### Requirement: `init` installs the managed guard transactionally instead of scaffolding the legacy file

`init` MUST NOT scaffold `.claude/settings.json` from the legacy `claude-settings-security.json` template (the file whose full-byte SHA-256 equals `LEGACY_FILE_SHA256`). When the Claude PreToolUse guard opt-in (`claudePreToolUseGuard`) is enabled, `init` MUST install the guard via `installClaudePreToolUse` (or the equivalent transactional path), not a copy-if-absent scaffold. When the opt-in is not enabled, `init` MUST NOT create or modify any Claude-hook-related file.

A guard install refusal or failure MUST be REPORTED to the user (including its remediation, when present) and MUST NOT abort the remainder of the security step: the hook-profile merge (`setHookFeature` wiring for secrets, permissions, and dependency checks) MUST still run and be persisted. The guard outcome and the hook-profile outcome are INDEPENDENT — a refused guard MUST NOT be reported as installed, and a merged profile MUST NOT be silently dropped because the guard refused.
(Previously: the security step returned early on a guard refusal, so the unrelated hook-profile merge never ran and its secrets/deps wiring was lost.)

#### Scenario: Opted-in init installs the real managed guard

- GIVEN `claudePreToolUseGuard` is `true` for the selected init options
- WHEN `init` runs the security-hooks step
- THEN it invokes the transactional installer and the resulting `.claude/settings.json`/asset carry the managed marker — never the legacy scaffold content

#### Scenario: Opted-out init leaves no stale Claude-hook artifact

- GIVEN `claudePreToolUseGuard` is `false` (security hooks NOT selected at init — note: all profiles incl. Minimal that DO select security hooks install the guard)
- WHEN `init` runs the security-hooks step
- THEN no `.claude/hooks/` asset or `.claude/settings.json` managed entry is created by this step

#### Scenario: Legacy scaffold path is retired

- GIVEN any init profile
- WHEN the security-hooks step runs
- THEN it never copies `templates/security-hooks/claude-settings-security.json` into `.claude/settings.json`

#### Scenario: getfacl-less host still completes init with profiles merged

- GIVEN a host where `getfacl` is not resolvable and `claudePreToolUseGuard` is `true`
- WHEN `init` runs the security-hooks step
- THEN the guard install refuses and is reported as NOT installed, with the `acl`-package remediation shown
- AND the hook-profile merge still runs, so the secrets/permissions/dependency wiring is persisted
- AND `init` completes rather than aborting the step

#### Scenario: A refused guard is never reported as installed

- GIVEN the guard install refused for any reason during `init`
- WHEN `init` summarizes the security step
- THEN the guard is reported as not installed together with its reason
- AND the successful hook-profile merge is reported separately, not as evidence the guard is active

### Requirement: Help text documents the new subcommands

`HOOKS_HELP_TEXT` MUST document `hooks install claude`, `hooks doctor claude`, and `hooks repair claude [--force]` alongside the existing `run` usage, so `hooks --help` and the unknown-subcommand fallback both show complete usage.

#### Scenario: Help lists all four subcommand families

- GIVEN `javi-forge hooks --help`
- WHEN the help text renders
- THEN it lists `run`, `install claude`, `doctor claude`, and `repair claude [--force]`

### Requirement: New command output is console-only

The new command module MUST use `console.log`/`console.error` plus `process.exit`, matching `hooks.tsx`/`security.ts` conventions. It MUST NOT render via Ink.

#### Scenario: No Ink import in the new command module

- GIVEN the new `src/commands/claude-hooks.ts` module
- WHEN its output is produced for install/doctor/repair
- THEN it writes via `console.log`/`console.error` and exits via `process.exit`, with no Ink component render

### Requirement: `hooks install|doctor|repair` accept a per-agent target including `codex`

The `hooks` dispatcher MUST generalize agent selection beyond the Claude-only
`!== "claude"` guard to accept a per-agent target. It MUST route
`hooks install codex`, `hooks doctor codex`, and `hooks repair codex [--force]` to the
Codex adapter handlers, preserving the existing exit-code and rendering contract
(`install`/`repair` exit `0` on success and non-zero on refusal; `doctor` is
informational and exits per its execution status). Existing `claude` behavior MUST be
unchanged, and an unknown agent MUST print usage and exit `1`.

#### Scenario: Codex subcommands route to the Codex adapter

- GIVEN `hooks install codex`, `hooks doctor codex`, or `hooks repair codex`
- WHEN dispatch routes the command
- THEN the matching Codex adapter handler runs and the help+exit-1 fallback is never reached

#### Scenario: Claude subcommands are unchanged

- GIVEN `hooks install claude`, `hooks doctor claude`, or `hooks repair claude`
- WHEN dispatch routes the command
- THEN it behaves exactly as before this change

#### Scenario: Unknown agent falls back to usage

- GIVEN `hooks install <unknown-agent>`
- WHEN dispatch routes the command
- THEN it prints usage/help and exits `1`

### Requirement: Help text documents the Codex agent target

`HOOKS_HELP_TEXT` MUST document the `codex` target for `install`, `doctor`, and
`repair [--force]` alongside the existing `claude` target and `run` usage.

#### Scenario: Help lists the Codex target

- GIVEN `javi-forge hooks --help`
- WHEN the help text renders
- THEN it lists `install|doctor|repair` for both `claude` and `codex`
