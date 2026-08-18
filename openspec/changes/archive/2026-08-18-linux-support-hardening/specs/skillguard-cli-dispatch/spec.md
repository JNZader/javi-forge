# Delta for skillguard-cli-dispatch

## MODIFIED Requirements

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
