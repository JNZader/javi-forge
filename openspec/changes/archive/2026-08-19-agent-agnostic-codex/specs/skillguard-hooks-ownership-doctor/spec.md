# Delta for skillguard-hooks-ownership-doctor

## ADDED Requirements

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
