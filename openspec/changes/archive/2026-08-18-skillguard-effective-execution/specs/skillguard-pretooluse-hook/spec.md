# Delta for skillguard-pretooluse-hook

## MODIFIED Requirements

### Requirement: Install, doctor, and repair provide explicit idempotent UX

The CLI MUST expose `javi-forge hooks install claude`, `javi-forge hooks doctor claude`, and `javi-forge hooks repair claude [--force]`.

`install` MUST install absent objects, no-op on current objects, and automatically replace only exact released-outdated or complete exact known legacy cohorts. `doctor` MUST be read-only and MUST report the asset and settings entry separately (version/hash, command/args shape, matcher, Node availability, ownership state, remediation, five-tool coverage, host spawn/timeout residual), plus an `execution: { status: "runnable" | "blocked" | "inconclusive"; blockers: string[]; unknownSources: string[] }` field independent of `report.healthy`. It MUST read each readable settings source it probes (project, local, user, static managed OS paths, `managed-settings.d/*.json`) as a scalar-flag classifier: `disableAllHooks: true` in ANY readable source, or `allowManagedHooksOnly: true` in a managed source, is a blocker (source recorded in `blockers`). A source that is unreadable (permission error, not absence), server-delivered, or otherwise unverifiable — including safe-mode observed only from the doctor's own process — is recorded in `unknownSources` and MUST NOT be treated as clear. `status` is `blocked` if `blockers` is non-empty (checked first, even alongside a simultaneous unknown source); otherwise `inconclusive` if `unknownSources` is non-empty; otherwise `runnable` only when the managed asset and settings are current, every relevant local source was read successfully, and none set a blocking flag. `inconclusive` and `blocked` MUST NEVER be silently promoted to `runnable`. Exit code follows `status`: `runnable` → `0`, `blocked` → `1`, `inconclusive` → `2`. `blockers` and `unknownSources` MUST use committed stable order. The doctor MUST NOT invoke or scrape the `claude` binary to compute `execution`; it reads only static local files and its own process environment.
(Previously: authoritative matrix classified server/MDM/current-launch sources and mixed a broader "unknown vs blocker precedence" model that assumed hooks could be shadowed by higher-precedence settings and implied CLI-output verification; superseded because hooks merge across levels — a project hook is blocked only by the two documented flags or safe-mode, and `claude doctor`/`--debug` scraping is undocumented and dropped.)

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

- GIVEN the managed asset and settings entry are current, every relevant local settings source is readable, and none sets a blocking flag or is unknown
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

## ADDED Requirements

### Requirement: Effective-execution output is deterministic and honest

The doctor renderer MUST print `blockers` and `unknownSources` in committed stable order so a human can see why a run is `blocked` or `inconclusive`. `execution.status` MUST be rendered independently of `report.healthy` — a `blocked` or `inconclusive` `execution.status` can co-occur with a healthy installation, and vice versa. The renderer MUST NOT print `runnable` unless the classifier genuinely proved it; when uncertain, it MUST print `inconclusive`.

#### Scenario: Blocked output lists the blocking source

- GIVEN `execution.status` is `blocked`
- WHEN doctor renders the report
- THEN it lists every entry in `blockers` in stable order
- AND it does not print `runnable`

#### Scenario: Inconclusive output lists the unknown source

- GIVEN `execution.status` is `inconclusive`
- WHEN doctor renders the report
- THEN it lists every entry in `unknownSources` in stable order
- AND it does not print `runnable`

#### Scenario: Runnable and healthy are independent

- GIVEN a current, healthy installation whose `execution.status` is `inconclusive` because a managed source is unreadable
- WHEN doctor renders the report
- THEN `report.healthy` is reported true while `execution.status` remains `inconclusive`
