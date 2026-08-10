# ci-gates Specification

## Purpose

Declarable named quality gates in `.javi-forge/ci.yaml`. A repo declares `gates:` under
`version: 2`; the CLI runs them as a repo-level phase AFTER the runner loop, executed
host-native (modeled on the security/ghagga phase — NOT through `runStep`), with
blocking/informative outcome semantics and optional changed-files scoping. Gates become
config, not code.

## Requirements

### Requirement: version:2 schema negotiation (additive, fail-closed preserved)

The config loader MUST accept `version` in the set `{1, 2}`. `gates` MUST be valid ONLY when
`version === 2`. Under `version: 2`, `runners` MUST be OPTIONAL when `gates` is present (a
gates-only repo is valid); a `version: 2` config declaring NEITHER `runners` nor `gates` MUST
fail closed (nothing to run).
A `version: 1` config MUST continue to parse byte-identically to today. Unknown top-level or
gate keys MUST still fail closed. A `version: 1` config containing a `gates` key MUST fail with
a named error: `"gates require version: 2"`. This named error MUST take precedence over the generic
unknown-key error: the allowed-key set MUST be computed AFTER reading `version`, so a v1 config with
`gates` reports `"gates require version: 2"`, NOT `unknown field "gates"`.

#### Scenario: v1 config parses byte-identically (regression)

- GIVEN a `version: 1` config with only `runners`
- WHEN it is parsed
- THEN the parsed result is identical to the pre-change result, and no gate machinery runs

#### Scenario: gates rejected under version 1

- GIVEN a `version: 1` config that declares `gates:`
- WHEN it is parsed or validated
- THEN parsing fails with the named error "gates require version: 2"

#### Scenario: gates-only repo is valid under version 2

- GIVEN a `version: 2` config with `gates:` and NO `runners`
- WHEN it is parsed or validated
- THEN it is accepted (runners optional under v2)

#### Scenario: unknown key still fails closed

- GIVEN a `version: 2` config with an unknown top-level key or an unknown gate field
- WHEN it is parsed or validated
- THEN parsing fails closed with an unknown-key error

### Requirement: Gate schema and field validation

Each gate MUST declare a tag-safe, unique `id` and a `run` (`string` or `string[]`). `mode` MUST
be one of `blocking | informative` (default `blocking`). `scope` MUST be one of `all | changed`
(default `all`). `baseline` (path) and `env` (record of string→string) are OPTIONAL. A duplicate
`id` MUST fail with a named error. An invalid `mode` or `scope` value MUST fail with a named error
naming the offending field.

#### Scenario: valid gate with defaults

- GIVEN a gate with `id` and `run` only
- WHEN it is parsed
- THEN `mode` defaults to `blocking` and `scope` defaults to `all`

#### Scenario: duplicate id rejected

- GIVEN two gates sharing the same `id`
- WHEN it is validated
- THEN validation fails with a named duplicate-id error

#### Scenario: invalid mode or scope rejected

- GIVEN a gate with `mode: warn` or `scope: staged`
- WHEN it is validated
- THEN validation fails with a named error identifying the invalid field and value

#### Scenario: id must be tag-safe

- GIVEN a gate whose `id` contains characters outside the tag-safe pattern
- WHEN it is validated
- THEN validation fails with a named error

### Requirement: Gate execution phase and outcome semantics

Gates MUST run as a repo-level phase AFTER all runners, each executed HOST-NATIVE (a spawned
process at the repo root, modeled on the native security/ghagga phase), NOT through `runStep`'s
Docker branch (which requires a runner and a resolved image that gates do not have). The native gate
executor MUST return the child exit code (it MUST NOT merely throw), so the outcome collector and
the JSON `exitCode` field are populatable. Running gates inside Docker is a deferred follow-up (it
needs gate-image resolution) and is OUT OF SCOPE for version 2. A BLOCKING gate whose command exits
non-zero MUST fail the build (process exits non-zero). An INFORMATIVE gate whose command exits
non-zero MUST report status `warning`, MUST leave the process exit code at 0, and MUST NOT abort the
remaining gates or runners. Informative gates MUST NEVER fail the build. For a multi-command gate,
commands MUST run in order and STOP at the first non-zero exit (fail-fast, matching the runner
precedent); that first non-zero code is the gate's reported `exitCode`.

The gate phase MUST run on every real CI run — both full mode and `--quick` mode — and MUST be
skipped ONLY in `detect` and `shell` modes. A blocking gate MUST NOT be silently skipped under
`--quick` (that path is the pre-push hook, where a blocking gate matters most).

#### Scenario: gates run under quick mode

- GIVEN a `blocking` gate and `ci --quick`
- WHEN the run executes
- THEN the gate phase runs (it is NOT skipped) and a failing blocking gate still fails the build

#### Scenario: gates skipped in detect and shell modes

- GIVEN a config with gates
- WHEN `ci` runs in `detect` or `shell` mode
- THEN no gate command executes

#### Scenario: blocking gate failure fails the build

- GIVEN a `blocking` gate whose command exits 1
- WHEN the gate phase runs
- THEN the process exits non-zero

#### Scenario: informative gate failure never fails the build

- GIVEN an `informative` gate whose command exits 1
- WHEN the gate phase runs
- THEN the gate status is `warning`, the process exit code stays 0, and subsequent gates still run

#### Scenario: gate env reaches the gate command

- GIVEN a gate with `env: { FOO: "bar" }`
- WHEN the gate command runs
- THEN `FOO=bar` is present in the gate command's environment, injected via the child-process env
  map and NEVER string-interpolated into the `run` string
- AND gate `env` entries spread LAST over the engine-injected keys (`CI`,
  `JAVI_FORGE_CHANGED_FILES`), so a gate MAY override them (documented last-wins precedence)

### Requirement: scope:changed loud-degrade contract

For a gate with `scope: changed`, when a base ref resolves and the changed-file set is non-empty,
the gate MUST run. When a base ref resolves and the changed-file set is empty, the gate MUST be
SKIPPED. When NO base ref resolves, the gate MUST be SKIPPED with a named warning and MUST NOT
widen to `scope: all`. When a base ref RESOLVES but the changed-file computation FAILS (e.g. the
base sha is absent from local history under a CI shallow clone, so `git diff <base>...HEAD` errors),
the gate MUST ALSO be SKIPPED with a named warning; it MUST NOT widen to `scope: all` and MUST NOT
crash the gate phase.

#### Scenario: shallow-clone / missing base ref skips loudly, never widens or crashes

- GIVEN a `scope: changed` gate and a base ref that resolves but is NOT in local history (shallow clone)
- WHEN the gate phase runs
- THEN the changed-file computation error is caught, the gate is skipped with a named warning, it does
  NOT run as `scope: all`, and the gate phase does not crash

#### Scenario: changed scope runs on non-empty diff

- GIVEN a `scope: changed` gate, a resolvable base ref, and a non-empty changed-file set
- WHEN the gate phase runs
- THEN the gate executes with the changed-file set available to it

#### Scenario: empty changed set skips the gate

- GIVEN a `scope: changed` gate, a resolvable base ref, and an EMPTY changed-file set
- WHEN the gate phase runs
- THEN the gate is skipped (status `skipped`) and does not execute

#### Scenario: no base ref skips loudly, never widens

- GIVEN a `scope: changed` gate and NO resolvable base ref
- WHEN the gate phase runs
- THEN the gate is skipped with a named warning AND does NOT run as `scope: all`

### Requirement: ci validate extended to gates

`ci validate` MUST validate the entire `gates` block and surface every schema error above
(version gating, duplicate id, invalid mode/scope, tag-unsafe id, unknown key) WITHOUT executing
any gate command.

#### Scenario: validate surfaces gate schema errors without executing

- GIVEN a config with a duplicate gate id and an invalid `mode`
- WHEN `ci validate` runs
- THEN it reports both errors and no gate command is executed

### Requirement: Gate-run JSON output

When `--json` is passed on the `ci` RUN path, gate-run output MUST be a single JSON object
`{ ok, exitCode, gates: [{ id, mode, scope, status, blocking, changedFiles?, exitCode?, reason? }] }`,
with Ink/step chatter suppressed. This is a NEW headless run branch (the `--json` flag is today
consumed only by `ci validate`, never by the Ink-rendered run path): it MUST bypass the Ink render,
collect gate outcomes, print the object, and set the process exit code EXPLICITLY (the Ink error
boundary is not reached without a render). `ok` MUST be `false` if and only if a BLOCKING gate
errored; informative gate failures MUST keep `ok: true`. Each gate entry's `exitCode` for a failing
gate is its first non-zero command's code.

Because `ok` is scoped to blocking GATES, a blocking RUNNER/phase failure (or any crash) can make the
run fail while `ok` stays `true`. The object MUST therefore ALSO carry a TOP-LEVEL `exitCode` (the
process exit code: non-zero on ANY run failure, including a runner failure or crash), so a consumer
reading the object alone is never fooled by `ok: true` on a failed run.

A degraded/skipped `scope: changed` gate MUST carry an optional per-gate `reason` string, so the
loud-degrade (base ref null, changed-file resolution failure under a shallow clone, or empty changed
set) is visible to the JSON consumer and not only in the Ink stream.

KNOWN LIMITATION: the changed-file set injected to a gate via `$JAVI_FORGE_CHANGED_FILES` is
newline-joined; a repo path containing a literal newline would corrupt line-based parsing. This is a
low-likelihood edge and is accepted as a documented caveat rather than switching to NUL-joining.

#### Scenario: JSON shape and ok on blocking failure

- GIVEN a run with one failing `blocking` gate and one failing `informative` gate, `--json` set
- WHEN the gate phase completes
- THEN the JSON has `ok: false`, the blocking gate entry has `status: "error"` and `blocking: true`,
  and the informative gate entry has `status: "warning"` with `ok` still driven only by the blocker

#### Scenario: JSON ok stays true when only informative fails

- GIVEN a run whose only failing gate is `informative`, `--json` set
- WHEN the gate phase completes
- THEN `ok: true` and the process exit code is 0

#### Scenario: degraded scope:changed gate carries a reason in JSON

- GIVEN a `scope: changed` gate whose changed-file computation fails (shallow clone), `--json` set
- WHEN the gate phase completes
- THEN the gate entry has `status: "skipped"` AND a `reason` naming the degrade cause

#### Scenario: top-level exitCode exposes a runner failure despite ok:true

- GIVEN a run where a blocking RUNNER/phase fails (not a gate), `--json` set
- WHEN the headless run completes
- THEN the JSON `ok` stays `true` (no blocking gate errored) BUT the top-level `exitCode` is non-zero,
  so a consumer keying on the object sees the run failure
```
