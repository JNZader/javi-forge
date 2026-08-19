# skillguard-hooks-ownership-doctor Specification

## Purpose

This specification amends `skillguard-pretooluse-hook` with Slice 2 ("Ownership and doctor", read-only). It defines exact, fixture-backed recognition of the managed Claude `PreToolUse` guard so a later transactional slice can trust ownership state instead of inventing it at mutation time. It delivers, as host-independent library behavior, the nine-state ownership classifier for both managed components, exact v0 legacy recognition, deterministic canonical settings-entry identity, and a component-level read-only doctor report. It is defense in depth for the installer, not a mutation, install, repair, CLI route, or effective-execution inventory: those remain in later slices.

## Terms and Decision Classes

The following terms are normative:

| Term | Meaning |
|---|---|
| **asset** | The project-local runtime file `.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs`. |
| **settings-entry** | The owned `hooks.PreToolUse` matcher-group handler inside `.claude/settings.json`. |
| **component** | Either the asset or the settings-entry, classified independently. |
| **managed marker (asset)** | The exact first-line comment `// javi-forge-managed: claude-pretooluse v1`. |
| **managed marker (settings-entry)** | A command handler whose `statusMessage` begins with the exact prefix `javi-forge-global-pretooluse:v1:sha256:`. |
| **manifest** | `assets/claude-hooks/manifest.json`, the packaged source of truth binding released asset and settings-entry identities. |
| **recomputed identity** | A SHA-256 the evaluator computes itself over observed bytes or canonical structure. A claimed hash carried in a marker is never accepted as identity. |
| **canonical settings-entry serialization** | The deterministic normalized form of the managed matcher group used to compute the settings-entry `canonicalSha256`. |
| **v0 legacy cohort** | The complete one-of-each set of four objects from `templates/security-hooks/claude-settings-security.json`: two Bash `PreToolUse` objects, one `Write|Edit` `PreToolUse` object, and one Bash `PostToolUse` object. |
| **doctor report** | The read-only component-level struct returned by the library doctor function. |
| **read-only** | No scenario in this specification performs, requires, or plans a filesystem mutation, backup, or write. |

The nine component states are exactly:

`absent | managed-current | released-outdated | exact-legacy | edited-managed | foreign | symlink | non-regular | malformed`

## Requirements

### Requirement: Asset ownership is classified into exactly one of nine states

The classifier MUST reduce the asset to exactly one of `absent | managed-current | released-outdated | exact-legacy | edited-managed | foreign | symlink | non-regular | malformed`, deterministically and from observed bytes only. It MUST `lstat` the path without following links: a symlink MUST be `symlink` and a directory, socket, device, FIFO, or other non-regular object MUST be `non-regular`, before any content read. A missing path (`ENOENT`) MUST be `absent`. For a regular file it MUST read the bytes, require the exact managed marker as the first line, then recompute the full-file SHA-256 and compare it to `manifest.asset.sha256` for `managed-current` and to each `manifest.asset.historical[]` entry for `released-outdated`. A regular file bearing the exact marker but no known hash MUST be `edited-managed`. A regular file without the exact marker MUST be `foreign`, never managed. The classifier MUST NOT infer ownership from filename, path, or a partial marker.

#### Scenario: Missing asset is absent

- GIVEN the asset path does not exist
- WHEN the classifier `lstat`s the path and observes `ENOENT`
- THEN it reports the asset state `absent` without reading any bytes

#### Scenario: Symlinked asset is never followed

- GIVEN the asset path is a symbolic link, regardless of its target
- WHEN the classifier `lstat`s the path
- THEN it reports the asset state `symlink` without following the link or reading target bytes

#### Scenario: Non-regular asset object is classified before content read

- GIVEN the asset path is a directory, socket, device, or FIFO
- WHEN the classifier `lstat`s the path
- THEN it reports the asset state `non-regular` without reading content

#### Scenario: Exact packaged bytes are managed-current

- GIVEN the asset is a regular file whose first line is the exact managed marker and whose full bytes hash to `manifest.asset.sha256`
- WHEN the classifier recomputes the full-file SHA-256
- THEN it reports the asset state `managed-current`

#### Scenario: Prior released bytes are released-outdated

- GIVEN the asset is a regular file whose first line is the exact managed marker and whose recomputed full-file SHA-256 matches an entry in `manifest.asset.historical[]` rather than the current hash
- WHEN the classifier compares the recomputed hash to the manifest
- THEN it reports the asset state `released-outdated`

#### Scenario: Marked but unknown-hash asset is edited-managed

- GIVEN the asset is a regular file bearing the exact managed marker but whose recomputed full-file SHA-256 matches neither the current nor any historical manifest hash
- WHEN the classifier evaluates the recomputed hash
- THEN it reports the asset state `edited-managed`
- AND it does not treat any hash text embedded in the file as proof of identity

#### Scenario: Unmarked regular asset is foreign

- GIVEN the asset is a regular file whose first line is not the exact managed marker
- WHEN the classifier inspects the marker line
- THEN it reports the asset state `foreign` regardless of filename or path resemblance

### Requirement: Settings-entry ownership is classified into exactly one of nine states

The classifier MUST reduce the settings-entry to exactly one of the nine states independently of the asset, from parsed structure only. It MUST `lstat` `.claude/settings.json` without following links: a symlink MUST be `symlink` and a non-regular object MUST be `non-regular`. A missing file MUST be `absent`. A regular file that is not valid JSON, or is valid JSON but not an object with an object `hooks` and, when present, an array `hooks.PreToolUse`, MUST be `malformed`. Within a valid container the classifier MUST locate the managed marker by the exact `statusMessage` prefix `javi-forge-global-pretooluse:v1:sha256:`, then recompute the canonical structural SHA-256 of that handler's matcher group and compare it to `manifest.settingsEntries.current.canonicalSha256` for `managed-current` and to each `manifest.settingsEntries.historical[]` entry for `released-outdated`. A marked group whose canonical hash is unknown, more than one exact managed marker, or a marker inside an invalid container MUST be `edited-managed`. When no managed marker is present, the classifier MUST apply the v0 legacy recognition rules; a valid container with neither a managed marker nor recognized exact legacy MUST be `foreign`. A similar path, command, args, matcher, filename, or partial marker MUST NOT prove ownership.

#### Scenario: Missing settings file is absent

- GIVEN `.claude/settings.json` does not exist
- WHEN the classifier `lstat`s the path and observes `ENOENT`
- THEN it reports the settings-entry state `absent`

#### Scenario: Symlinked settings file is never followed

- GIVEN `.claude/settings.json` is a symbolic link
- WHEN the classifier `lstat`s the path
- THEN it reports the settings-entry state `symlink` without following the link

#### Scenario: Structurally invalid settings are malformed

- GIVEN `.claude/settings.json` is a regular file that is not valid JSON, or is valid JSON lacking an object `hooks` or a non-array `hooks.PreToolUse`
- WHEN the classifier parses and validates the container
- THEN it reports the settings-entry state `malformed`
- AND it does not attempt marker or legacy recognition

#### Scenario: Exact canonical group is managed-current

- GIVEN a valid settings container holds exactly one handler whose `statusMessage` starts with `javi-forge-global-pretooluse:v1:sha256:` and whose recomputed canonical group hash equals `manifest.settingsEntries.current.canonicalSha256`
- WHEN the classifier recomputes the canonical structural hash
- THEN it reports the settings-entry state `managed-current`

#### Scenario: Prior canonical group is released-outdated

- GIVEN a valid settings container holds the managed marker whose recomputed canonical group hash matches an entry in `manifest.settingsEntries.historical[]` rather than the current hash
- WHEN the classifier compares the recomputed hash to the manifest
- THEN it reports the settings-entry state `released-outdated`

#### Scenario: Marked but unknown or duplicated group is edited-managed

- GIVEN a valid settings container holds the exact managed marker but the recomputed canonical hash is unknown, or the container holds more than one exact managed marker
- WHEN the classifier evaluates the marked handler(s)
- THEN it reports the settings-entry state `edited-managed`
- AND it does not trust the version or hash text claimed inside the `statusMessage`

#### Scenario: Resembling unmarked handler is foreign

- GIVEN a valid settings container holds a handler that resembles the managed path, command, args, or matcher but lacks the exact managed marker and is not recognized exact legacy
- WHEN the classifier inspects markers and legacy rules
- THEN it reports the settings-entry state `foreign`

### Requirement: Claimed hashes are never trusted as identity

For both components the classifier MUST establish identity only by recomputing SHA-256 over observed bytes (asset) or the canonical structural serialization (settings-entry). A hash embedded in the asset body, a hash claimed in the settings `statusMessage`, a version number, a filename, a command shape, or a matcher MUST NOT by itself prove that a component is managed-current, released-outdated, or exact-legacy.

#### Scenario: Forged asset hash text does not prove identity

- GIVEN an asset file bearing the exact marker whose body also contains a text copy of the current manifest hash, but whose recomputed full-file SHA-256 differs from every known manifest hash
- WHEN the classifier recomputes the hash rather than reading the embedded text
- THEN it reports `edited-managed` and does not report `managed-current`

#### Scenario: Forged settings statusMessage hash does not prove identity

- GIVEN a settings handler whose `statusMessage` claims the current canonical hash but whose recomputed canonical group hash differs from every known manifest hash
- WHEN the classifier recomputes the canonical structural hash
- THEN it reports `edited-managed` and does not report `managed-current`

### Requirement: Exact v0 legacy is recognized by full-file hash or complete cohort only

Legacy recognition MUST be finite, committed, and byte- or structure-exact. A settings file whose complete bytes hash to the v0 legacy SHA-256 `b4638222ecddc2daac6ec3339596d853a626906bbd1233d789d80a319325c68d` MUST be `exact-legacy`. Inside a larger valid settings container, `exact-legacy` MUST require exactly one deep-structural-equality match for each of the four v0 legacy cohort objects — the two Bash `PreToolUse` objects, the one `Write|Edit` `PreToolUse` object, and the one Bash `PostToolUse` object. A container with fewer than all four cohort members, a duplicate of any member, or any one-byte-edited member MUST be `foreign` (partial-legacy) and MUST NOT be recognized as legacy. No normalized shell text, substring, matcher resemblance, or partial cohort MAY prove legacy ownership.

#### Scenario: Whole-file v0 scaffold is exact-legacy

- GIVEN `.claude/settings.json` bytes hash exactly to the v0 legacy SHA-256 `b4638222…`
- WHEN the classifier recomputes the full-file hash
- THEN it reports the settings-entry state `exact-legacy`

#### Scenario: Complete embedded cohort is exact-legacy

- GIVEN a larger valid settings container holds exactly one deep-equal instance of each of the four v0 legacy cohort objects among its hooks
- WHEN the classifier matches the cohort by deep structural equality
- THEN it reports the settings-entry state `exact-legacy`
- AND every non-cohort sibling is left unclaimed by legacy recognition

#### Scenario: Partial cohort is foreign, never legacy

- GIVEN a valid settings container holds only one, two, or three of the four cohort objects
- WHEN the classifier evaluates cohort completeness
- THEN it reports the settings-entry state `foreign` as a partial-legacy cohort
- AND it does not report `exact-legacy`

#### Scenario: Duplicated cohort member is foreign

- GIVEN a valid settings container holds two deep-equal copies of one cohort member alongside the others
- WHEN the classifier detects the duplicate
- THEN it reports the settings-entry state `foreign` and refuses legacy recognition

#### Scenario: One-byte-edited cohort member breaks legacy recognition

- GIVEN a valid settings container holds a cohort that differs from the exact v0 objects by a single byte in any member
- WHEN the classifier applies deep structural equality
- THEN the edited member fails to match and the classifier reports `foreign`, not `exact-legacy`

### Requirement: Canonical settings-entry serialization is deterministic and asset-SHA independent

The canonical serialization used to compute the settings-entry `canonicalSha256` MUST be deterministic and independent of the live asset hash. It MUST use a fixed key order, the exact matcher `Bash|PowerShell|Read|Write|Edit`, a nested command handler with `type: "command"`, `command: "node"`, the single `${CLAUDE_PROJECT_DIR}` project-local MJS argument, `timeout: 30`, and the repository JSON convention of two-space indentation plus a trailing newline. Before hashing, the serialization MUST normalize the asset-SHA token out of the `statusMessage`: the trailing `:sha256:<ASSET_SHA256>` segment MUST be replaced with a fixed placeholder so the canonical identity does not change when the asset hash rotates. The same input group MUST always produce the same canonical hash regardless of the host OS, locale, or original key insertion order.

#### Scenario: Canonical hash is invariant under asset-SHA rotation

- GIVEN two managed settings groups identical except for the `<ASSET_SHA256>` value in each `statusMessage`
- WHEN the classifier normalizes the asset-SHA token to the fixed placeholder and computes each canonical hash
- THEN both groups produce the same `canonicalSha256`

#### Scenario: Key insertion order does not change canonical identity

- GIVEN two managed settings groups with identical values but different JSON key insertion order
- WHEN each is canonically serialized with the fixed key order
- THEN both produce identical canonical bytes and identical `canonicalSha256`

#### Scenario: Canonical serialization is host-independent

- GIVEN the same managed settings group is canonicalized on Linux, macOS, and Windows under differing `LANG` and `PATH`
- WHEN the canonical hash is computed on each host
- THEN the canonical bytes and `canonicalSha256` are identical across hosts

### Requirement: The read-only doctor reports component state without mutation

The doctor MUST return a component-level report struct that includes: `settings.state`, `asset.state` with its `version` and `sha256` when known, `node.available` and `node.version` (a Node `>=22` check), `matcherExact`, `commandShapeExact`, `coverage` naming exactly the five tools `Bash`, `PowerShell`, `Read`, `Write`, `Edit`, a `hostResidual` string disclosing that spawn/start/timeout failures continue through Claude's permission flow, and a `remediation[]` list. `healthy` MUST be true only when both components are `managed-current`, the matcher and command shape are exact, and Node `>=22` is available; otherwise `healthy` MUST be false. The doctor MUST derive every field from classification and read-only inspection and MUST NOT change bytes, mtimes, or create backups. This slice's doctor is component-level only; it MUST NOT compute an effective-execution `RUNNABLE`/`BLOCKED`/`INCONCLUSIVE` verdict, evaluate `disableAllHooks`, `settings.local`, user precedence, MDM, or safe mode, and MUST NOT expose a CLI route.

#### Scenario: Healthy report requires both components current and Node ok

- GIVEN both components classify as `managed-current`, the matcher and command shape are exact, and Node `>=22` is available
- WHEN the doctor builds the report
- THEN `healthy` is true
- AND `coverage` lists exactly `Bash`, `PowerShell`, `Read`, `Write`, `Edit` and `hostResidual` discloses the spawn/start/timeout fail-open residual

#### Scenario: Any non-current component makes the report unhealthy

- GIVEN at least one component classifies as anything other than `managed-current`, or the matcher/command shape is inexact, or Node is `<22`/unavailable
- WHEN the doctor builds the report
- THEN `healthy` is false
- AND `remediation[]` names the actionable next step for each non-healthy component state

#### Scenario: Doctor never claims fully secure or fail-closed

- GIVEN any component state
- WHEN the doctor builds the report
- THEN it always includes the `hostResidual` disclosure
- AND it does not emit a `secure` or `fail-closed` verdict

#### Scenario: Doctor is read-only

- GIVEN any absent, current, outdated, legacy, edited-managed, foreign, symlink, non-regular, or malformed state on either component
- WHEN the doctor runs
- THEN it reports each component's state and remediation without changing bytes, mtimes, or creating backups

#### Scenario: Doctor does not compute effective-execution or expose a CLI route

- GIVEN both components are `managed-current` with an exact shape
- WHEN the doctor builds the report
- THEN it reports component-level state only
- AND it produces no `RUNNABLE`/`BLOCKED`/`INCONCLUSIVE` verdict, no `disableAllHooks`/`settings.local`/user/MDM/safe-mode evaluation, and no CLI dispatch

### Requirement: The manifest binds a canonical settings-entry identity append-only

The manifest MUST populate `settingsEntries.current` with `{ version, canonicalSha256 }` — the deterministic canonical hash of the current managed matcher group with the asset-SHA token normalized out — replacing the prior `null`. Populating it MUST update the existing Slice-1 asset-contract assertion that pins `settingsEntries.current` to `null`. The settings-entry historical list MUST be append-only: a released settings-entry identity, once recorded as current, MUST be moved to `settingsEntries.historical[]` before a new current identity is set, and MUST NOT be silently rewritten or dropped. Recognition MUST accept the current identity as `managed-current` and every historical identity as `released-outdated`.

#### Scenario: Current settings-entry identity is populated

- GIVEN the manifest previously carried `settingsEntries.current: null`
- WHEN this slice binds the canonical identity
- THEN `settingsEntries.current` is `{ version, canonicalSha256 }` and the asset-contract assertion pinning it to `null` is updated to the populated value

#### Scenario: Released settings identity is preserved append-only

- GIVEN a released settings-entry identity is recorded as `settingsEntries.current`
- WHEN a later canonical identity replaces it
- THEN the prior identity is appended to `settingsEntries.historical[]` before the new current is set
- AND no previously released settings identity is removed or overwritten

#### Scenario: Historical settings identity classifies as released-outdated

- GIVEN a settings group whose recomputed canonical hash equals a `settingsEntries.historical[]` entry
- WHEN the classifier compares it to the manifest
- THEN it reports `released-outdated`, proving the append-only guarantee is honored by recognition

### Requirement: Recognition and planning perform no filesystem mutation

Every classifier, canonical-serialization, legacy-recognition, doctor, and removal-planning behavior in this slice MUST be read-only. No scenario MAY perform or require a filesystem write, backup, temporary file, rename, or directory creation. Any removal or merge planning MUST produce a plan only; it MUST NOT execute the plan. The transactional install/repair primitive remains outside this slice.

#### Scenario: Classification does not write

- GIVEN any component in any of the nine states
- WHEN the classifier and doctor inspect it
- THEN no file, backup, temp, or directory is created, modified, renamed, or removed

#### Scenario: Removal planning is pure

- GIVEN a proven managed settings-entry and asset
- WHEN removal planning runs
- THEN it returns a plan describing the exact managed objects to remove
- AND it performs no mutation and does not execute the plan

### Requirement: Codex doctor reports a fail-closed effective-execution matrix

`hooks doctor codex` MUST reuse the fail-closed execution-matrix semantics
(`runnable | blocked | inconclusive`) and MUST report the guard as NOT effectively
running whenever any of these hold: Codex hooks are disabled (`[features] hooks=false`),
the hook is installed but UNTRUSTED (no valid `trusted_hash` → silently skipped), or the
asset/`hooks.json` settings drifted from the managed identity. It MUST NOT report
`runnable` when the hook would be skipped. The untrusted state MUST map to NOT runnable.
Doctor MUST remain read-only and derive the verdict from static local inspection of the
Codex config paths and trust state.

#### Scenario: Hooks-disabled Codex is not runnable

- GIVEN a Codex config with `[features] hooks=false`
- WHEN `hooks doctor codex` evaluates execution
- THEN `status` is `blocked` (not runnable) and doctor reports the guard as not effectively running

#### Scenario: Installed-but-untrusted Codex hook is not runnable

- GIVEN the Codex guard is installed but its `trusted_hash` is absent or invalid (the hook is silently skipped)
- WHEN `hooks doctor codex` evaluates execution
- THEN `status` is `blocked` (or the fail-closed non-runnable state) and doctor MUST NOT report `runnable`

#### Scenario: Drifted Codex asset or settings is not runnable

- GIVEN the Codex asset or `hooks.json` entry has drifted from the managed identity
- WHEN `hooks doctor codex` evaluates execution
- THEN it reports the drift and does not report `runnable`

#### Scenario: Trusted, current, hooks-enabled Codex is runnable

- GIVEN Codex hooks are enabled, the asset and `hooks.json` entry are managed-current, and the `trusted_hash` is valid
- WHEN `hooks doctor codex` evaluates execution
- THEN `status` is `runnable` only when every fail-closed check passes

### Requirement: Codex ownership classification is agent-parameterized

The nine-state ownership classifier MUST recognize the Codex-managed asset and
`~/.codex/hooks.json` settings-entry using the Codex adapter's paths and marker, applying
the same strict recomputed-identity rules as Claude (no ownership inferred from filename,
path, or a partial marker). Claude classification MUST be unchanged.

#### Scenario: Codex managed identity is recognized without inferring from path

- GIVEN a Codex asset and `hooks.json` entry bearing the Codex managed marker with recomputed identity matching the manifest
- WHEN the classifier runs for the Codex agent
- THEN it reports `managed-current`, and a resembling-but-unmarked object is `foreign`
