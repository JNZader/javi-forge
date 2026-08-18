# Delta for skillguard-pretooluse-hook

## MODIFIED Requirements

### Requirement: Install, doctor, and repair provide explicit idempotent UX

The CLI MUST expose `javi-forge hooks install claude`, `javi-forge hooks doctor claude`, and `javi-forge hooks repair claude [--force]`.

`install` MUST install absent objects, no-op on current objects, and automatically replace only exact released-outdated or complete exact known legacy cohorts. `doctor` MUST be read-only and MUST report the asset and settings entry separately (version/hash, command/args shape, matcher, Node availability, ownership state, remediation, five-tool coverage, host spawn/timeout residual), plus an `execution: { status: "runnable" | "blocked" | "inconclusive"; blockers: string[]; unknownSources: string[] }` field independent of `report.healthy`. It MUST read each readable settings source it probes (project, local, user, static managed OS paths, `managed-settings.d/*.json`) as a scalar-flag classifier: `disableAllHooks: true` in ANY readable source, or `allowManagedHooksOnly: true` in a managed source, is a blocker (source recorded in `blockers`). A source that is unreadable (permission error, not absence), server-delivered, or otherwise unverifiable — including safe-mode observed only from the doctor's own process — is recorded in `unknownSources` and MUST NOT be treated as clear. `status` is `blocked` if `blockers` is non-empty (checked first, even alongside a simultaneous unknown source); otherwise `inconclusive` if `unknownSources` is non-empty; otherwise `runnable` only when the managed asset and settings are current, every relevant local source was read successfully, and none set a blocking flag. `inconclusive` and `blocked` MUST NEVER be silently promoted to `runnable`. Exit code follows `status`: `runnable` → `0`, `blocked` → `1`, `inconclusive` → `2`. `blockers` and `unknownSources` MUST use committed stable order. The doctor MUST NOT invoke or scrape the `claude` binary to compute `execution`; it reads only static local files and its own process environment.

Doctor MUST additionally surface two read-only host-capability rows, each ALWAYS present in the report (also when the capability is satisfied) so absence is never silent:

1. **ACL capability** — whether the POSIX ACL adapter (`getfacl` on Linux) is resolvable, surfaced as its OWN `installCapability` report section, DISTINCT from the execution matrix. `getfacl` is an INSTALL-TIME dependency of the transactional gate; the installed runtime hook does not invoke it, so an absent `getfacl` MUST NOT add an entry to `blockers` or `unknownSources`, MUST NOT flip `execution.status`, and MUST NOT change the doctor exit code — a current, firing guard on a host without `getfacl` remains `runnable`/exit `0`. When the adapter is NOT resolvable the section MUST carry the `acl`-package remediation, and when a guard-currency blocker (`guard:*`) ALREADY exists the remediation line MUST additionally join `report.remediation` (there the user must install and cannot). A probe error/timeout is reported as `unknown` INSIDE the section only.
2. **node-on-PATH** — whether a `node` executable resolves independently of the diagnosing process (for example by resolving and running `node --version`). This row MUST be DISTINCT from the existing `process.versions.node` Node-availability row and MUST be labelled a HEURISTIC, because javi-forge's `PATH` only proxies the `PATH` Claude Code will use to spawn the exec-form handler. When `node` does not resolve on `PATH`, doctor MUST record an entry in exactly one fail-closed collection and MUST NOT report `status: "runnable"` for that run. A SUCCESSFUL node-on-PATH probe MUST NOT by itself raise confidence: it MUST NOT clear an existing blocker or unknown source, and MUST NOT be rendered as proof that the guard will spawn.

The flag classifier (`scanExecutionFlags`) MUST treat a PRESENT-but-INVALID (non-boolean) `disableAllHooks` or `allowManagedHooksOnly` value per the documented Claude Code semantics — an invalid value is treated as `true` — and therefore MUST classify it as a blocker, or at minimum as an unknown source. Silently ignoring an invalid value and reporting the source as clear is PROHIBITED: an invalid value on a source where the flag is authoritative MUST NEVER yield `status: "runnable"`.
(Previously: the doctor reported no ACL-capability row, measured Node availability only from its own `process.versions.node`, and matched the two blocking flags with a strict `=== true` comparison, so an invalid non-boolean value was silently treated as clear and could produce a false `runnable`.)

`repair` without force MUST restore missing and exact-outdated managed pieces; `repair --force` MAY replace edited-managed objects only after required backups succeed. Repeating any successful command against its resulting runnable state MUST produce no further file changes; current files MUST remain byte- and mtime-stable.

#### Scenario: Install is idempotent

- GIVEN a healthy current managed installation
- WHEN `javi-forge hooks install claude` runs again
- THEN it reports the installation as current
- AND settings, asset bytes, and mtimes remain unchanged

#### Scenario: Doctor is read-only

- GIVEN any absent, healthy, outdated, edited-managed, foreign-collision, or partial installation state
- WHEN `javi-forge hooks doctor claude` runs
- THEN it reports each component's state and the `execution` field without changing bytes, mtimes, or creating backups

#### Scenario: disableAllHooks in any readable source blocks

- GIVEN one of project, local, user, or managed settings is readable and sets `disableAllHooks: true`
- WHEN doctor evaluates `execution`
- THEN `status` is `blocked`, that source is named in `blockers`, and doctor exits `1`

#### Scenario: allowManagedHooksOnly in managed settings blocks

- GIVEN managed settings are readable and set `allowManagedHooksOnly: true`
- WHEN doctor evaluates `execution`
- THEN `status` is `blocked`, the managed source is named in `blockers`, and doctor exits `1`

#### Scenario: All-clear local sources produce runnable

- GIVEN the managed asset and settings entry are current, every relevant local settings source is readable, none sets a blocking flag or is unknown, and both host-capability rows are satisfied
- WHEN doctor evaluates `execution`
- THEN `status` is `runnable`, `blockers` and `unknownSources` are empty, and doctor exits `0`

#### Scenario: Unreadable user settings force inconclusive

- GIVEN user settings exist but cannot be read (permission error, not absence)
- WHEN doctor evaluates `execution`
- THEN `status` is `inconclusive`, that source is named in `unknownSources`, and doctor exits `2`

#### Scenario: Present-but-unreadable managed path forces inconclusive

- GIVEN a static managed settings path or `managed-settings.d/*.json` entry exists but cannot be read
- WHEN doctor evaluates `execution`
- THEN `status` is `inconclusive`, the source is named in `unknownSources`, and doctor exits `2`
- AND doctor never reports `runnable` for that run

#### Scenario: Safe-mode observation is never silently cleared

- GIVEN `CLAUDE_CODE_SAFE_MODE=1` or `--safe-mode` is observed in the doctor's own process
- WHEN doctor evaluates `execution`
- THEN it records the caveat and reflects it in `inconclusive`/`unknownSources` rather than treating the diagnosed session as proven clear

#### Scenario: A higher-precedence settings file with unrelated keys does not block

- GIVEN user settings are readable and present but set neither `disableAllHooks` nor `allowManagedHooksOnly`
- AND project settings are readable and clear
- WHEN doctor evaluates `execution`
- THEN the project hook is NOT reported blocked merely because the higher-precedence file exists
- AND `status` is `runnable` if every other source is clear

#### Scenario: Repair without force restores safe drift

- GIVEN a managed component is missing or exactly matches a known released outdated version and no unsafe collision exists
- WHEN `javi-forge hooks repair claude` runs
- THEN it restores the current managed object without requiring force
- AND a second repair is a byte- and mtime-stable no-op

#### Scenario: Force is limited to edited-managed content

- GIVEN an edited-managed asset or settings entry
- WHEN repair runs without `--force`
- THEN it refuses and identifies backup plus `repair claude --force` as the eligible path

#### Scenario: ACL capability is reported when satisfied

- GIVEN `getfacl` is resolvable on the host
- WHEN doctor runs
- THEN the report contains an explicit ACL-capability row stating the adapter is resolvable
- AND the row adds no entry to `blockers` or `unknownSources`

#### Scenario: Absent getfacl is never silent — and never gates execution

- GIVEN `getfacl` is not resolvable on a Linux host AND the managed guard is installed and current
- WHEN doctor runs
- THEN the `installCapability` section reports the adapter as absent and carries the `acl`-package remediation
- AND `blockers` and `unknownSources` gain NO entry for it, `execution.status` remains `runnable`, and doctor exits `0`
- AND the absence is visible in the rendered output (never silent)

#### Scenario: Absent getfacl joins report.remediation when the guard needs installing

- GIVEN `getfacl` is not resolvable AND a guard-currency blocker (`guard:*`) exists (guard absent or not current)
- WHEN doctor runs
- THEN `execution.status` is `blocked` (by the guard-currency blocker, not the ACL row)
- AND the `acl`-package remediation line joins `report.remediation` so the user knows what to install first

#### Scenario: The ACL probe mutates nothing

- GIVEN any host state
- WHEN doctor evaluates the ACL-capability row
- THEN it only resolves and inspects the adapter read-only
- AND no file, directory, or setting is created, modified, or removed

#### Scenario: node-on-PATH is a row distinct from process.versions.node

- GIVEN the diagnosing process itself runs on a supported Node version
- WHEN doctor runs
- THEN the report contains a node-on-PATH row resolved independently of `process.versions.node`
- AND the two rows are separately identifiable, and the node-on-PATH row is labelled a heuristic

#### Scenario: Absent node on PATH is never silent

- GIVEN `node` does not resolve on `PATH` while the diagnosing process still reports its own Node version
- WHEN doctor evaluates `execution`
- THEN the node-on-PATH row reports it as unresolved
- AND exactly one entry naming node-on-PATH appears in `blockers` or `unknownSources`, with `status` `blocked` or `inconclusive` accordingly
- AND `status` is never `runnable` for that run

#### Scenario: A successful node-on-PATH probe never inflates confidence

- GIVEN `node` resolves on `PATH` and an unrelated source is already recorded in `unknownSources`
- WHEN doctor evaluates `execution`
- THEN the node-on-PATH row is reported as a heuristic observation only
- AND it does not clear the unknown source, `status` remains `inconclusive`, and the output makes no claim that the guard is confirmed spawnable

#### Scenario: Invalid string `disableAllHooks` never clears

- GIVEN a readable settings source sets `disableAllHooks` to the string `"true"`
- WHEN doctor evaluates `execution`
- THEN that source is recorded in `blockers` (or at minimum `unknownSources`) and is never treated as clear
- AND `status` is not `runnable` and doctor does not exit `0`

#### Scenario: Invalid numeric `disableAllHooks` never clears

- GIVEN a readable settings source sets `disableAllHooks` to the number `1`
- WHEN doctor evaluates `execution`
- THEN that source is recorded in `blockers` (or at minimum `unknownSources`) and is never treated as clear
- AND `status` is not `runnable`

#### Scenario: Null `disableAllHooks` never clears

- GIVEN a readable settings source sets `disableAllHooks` to `null`
- WHEN doctor evaluates `execution`
- THEN that source is recorded in `blockers` (or at minimum `unknownSources`) and is never treated as clear
- AND `status` is not `runnable`

#### Scenario: Object `disableAllHooks` never clears

- GIVEN a readable settings source sets `disableAllHooks` to an object such as `{}`
- WHEN doctor evaluates `execution`
- THEN that source is recorded in `blockers` (or at minimum `unknownSources`) and is never treated as clear
- AND `status` is not `runnable`

#### Scenario: Invalid string `allowManagedHooksOnly` never clears

- GIVEN a readable managed settings source sets `allowManagedHooksOnly` to the string `"true"`
- WHEN doctor evaluates `execution`
- THEN the managed source is recorded in `blockers` (or at minimum `unknownSources`) and is never treated as clear
- AND `status` is not `runnable` and doctor does not exit `0`

#### Scenario: Invalid numeric `allowManagedHooksOnly` never clears

- GIVEN a readable managed settings source sets `allowManagedHooksOnly` to the number `1`
- WHEN doctor evaluates `execution`
- THEN the managed source is recorded in `blockers` (or at minimum `unknownSources`) and is never treated as clear
- AND `status` is not `runnable`

#### Scenario: Null `allowManagedHooksOnly` never clears

- GIVEN a readable managed settings source sets `allowManagedHooksOnly` to `null`
- WHEN doctor evaluates `execution`
- THEN the managed source is recorded in `blockers` (or at minimum `unknownSources`) and is never treated as clear
- AND `status` is not `runnable`

#### Scenario: Object `allowManagedHooksOnly` never clears

- GIVEN a readable managed settings source sets `allowManagedHooksOnly` to an object such as `{}`
- WHEN doctor evaluates `execution`
- THEN the managed source is recorded in `blockers` (or at minimum `unknownSources`) and is never treated as clear
- AND `status` is not `runnable`

#### Scenario: An absent flag key is still clear

- GIVEN a readable settings source that omits both `disableAllHooks` and `allowManagedHooksOnly`
- WHEN doctor evaluates `execution`
- THEN the source is treated as clear (absence is not an invalid value)
- AND `status` may still be `runnable` if every other check passes
