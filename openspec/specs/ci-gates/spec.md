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
(default `all`). `baseline` (path), `env` (record of string→string) and `timeout` (a positive number
of seconds) are OPTIONAL. A duplicate `id` MUST fail with a named error. An invalid `mode` or `scope`
value MUST fail with a named error naming the offending field. A `timeout` that is not a positive
finite number (e.g. `0`, a negative, or a non-number) MUST fail with a named error naming the
`timeout` field. A gate WITHOUT `timeout` behaves exactly as before (no timeout, runs to completion).

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

#### Scenario: non-positive or non-numeric timeout rejected

- GIVEN a gate with `timeout: 0`, `timeout: -5`, or a non-numeric `timeout`
- WHEN it is validated
- THEN validation fails with a named error identifying the `timeout` field

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

When a gate declares an optional `timeout` (seconds), the timeout applies PER COMMAND (wall-clock,
matching the fail-fast model). A command still running after its timeout MUST be killed (SIGTERM,
escalated to SIGKILL after a short grace if the child ignores SIGTERM). Once the timeout has fired,
the executor MUST resolve a NON-ZERO exit code REGARDLESS of what the child reports — INCLUDING a
child that traps SIGTERM and exits 0 gracefully before the SIGKILL escalation. The invariant is
`timed-out ⇒ non-zero, ALWAYS`; the executor resolves the `timeout(1)` sentinel `124`. A timed-out
gate therefore MUST NOT be reported as passing. A timed-out BLOCKING gate MUST fail the build; a
timed-out INFORMATIVE gate MUST degrade to a `warning` and MUST NOT fail the build. A gate without
`timeout` MUST run to completion with no timer (backward-compatible).

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

#### Scenario: blocking gate timeout fails the build (no false-green)

- GIVEN a `blocking` gate with `timeout: 1` whose command hangs (e.g. `sleep 10`)
- WHEN the gate phase runs
- THEN the command is killed on expiry, the gate resolves NON-ZERO (never 0), and the build FAILS

#### Scenario: timed-out gate that traps SIGTERM and exits 0 still fails (no false-green)

- GIVEN a `blocking` gate with `timeout: 1` whose command traps SIGTERM and exits 0 before SIGKILL
- WHEN the gate phase runs
- THEN the timeout override resolves NON-ZERO (never the child's 0) and the build FAILS

#### Scenario: informative gate timeout degrades to a warning

- GIVEN an `informative` gate with `timeout: 1` whose command hangs
- WHEN the gate phase runs
- THEN the gate status is `warning`, the process exit code stays 0, and subsequent gates still run

#### Scenario: gate under its timeout completes normally

- GIVEN a gate with a `timeout` whose command finishes well within it
- WHEN the gate phase runs
- THEN the gate reports its normal result and no timer leaks (the run does not hang)

#### Scenario: gate env reaches the gate command

- GIVEN a gate with `env: { FOO: "bar" }`
- WHEN the gate command runs
- THEN `FOO=bar` is present in the gate command's environment, injected via the child-process env
  map and NEVER string-interpolated into the `run` string
- AND gate `env` entries spread LAST over the engine-injected keys (`CI`,
  `JAVI_FORGE_CHANGED_FILES`, `JAVI_FORGE_CHANGED_FILES_ABS`), so a gate MAY override them
  (documented last-wins precedence)

### Requirement: scope:changed loud-degrade contract

For a gate with `scope: changed`, when a base ref resolves and the changed-file set is non-empty,
the gate MUST run. When a base ref resolves and the changed-file set is empty, the gate MUST be
SKIPPED. When NO base ref resolves, the gate MUST be SKIPPED with a named warning and MUST NOT
widen to `scope: all`. When a base ref RESOLVES but the changed-file computation FAILS (e.g. the
base sha is absent from local history under a CI shallow clone, so `git diff <base>...HEAD` errors),
the gate MUST ALSO be SKIPPED with a named warning; it MUST NOT widen to `scope: all` and MUST NOT
crash the gate phase.

When a `scope: changed` gate runs, the engine MUST inject the changed-file set as two env
variables, in the SAME order:
- `JAVI_FORGE_CHANGED_FILES` — newline-joined, REPO-ROOT-RELATIVE paths (unchanged; backward
  compatible).
- `JAVI_FORGE_CHANGED_FILES_ABS` — newline-joined ABSOLUTE paths (`<projectDir>/<relpath>`,
  joined with the platform separator, no naive string concat). This is the cwd-INDEPENDENT form:
  a gate that `cd`s into a subdirectory can still resolve every changed file. A "cwd-relative"
  variant is intentionally NOT provided — at injection time the engine's cwd IS the repo root, so
  it would merely duplicate the repo-root-relative variant, while a gate's own runtime cwd is
  unknowable to the engine.

Neither variable is set for a gate whose `scope` is not `changed`. A NUL-joined variant
(`JAVI_FORGE_CHANGED_FILES_Z`) is intentionally NOT provided on EITHER the native or the
containerized path: a NUL byte cannot be carried in an environment variable (execve `environ`
entries are NUL-terminated C strings; Node's `child_process` throws ERR_INVALID_ARG_VALUE for a
NUL in an argv element OR a spawn env-map value), so injecting it would crash the gate at spawn
time. The documented caveat on `JAVI_FORGE_CHANGED_FILES` — a repo path containing a literal
newline corrupts line-based parsing — therefore stands; a gate needing absolute resolution uses
`JAVI_FORGE_CHANGED_FILES_ABS`.

#### Scenario: changed-file variants are absolute and same-order

- GIVEN a `scope: changed` gate, a resolvable base ref, and a non-empty changed-file set
- WHEN the gate command runs
- THEN `JAVI_FORGE_CHANGED_FILES_ABS` is present with each file as an absolute path
  (`<projectDir>/<relpath>`), newline-joined, in the SAME order as `JAVI_FORGE_CHANGED_FILES`

#### Scenario: changed-file variants absent when scope is not changed

- GIVEN a gate whose `scope` is not `changed`
- WHEN the gate command runs
- THEN neither `JAVI_FORGE_CHANGED_FILES` nor `JAVI_FORGE_CHANGED_FILES_ABS` is set in its
  environment

#### Scenario: NUL-joined variant is never injected

- GIVEN a `scope: changed` gate and a non-empty changed-file set
- WHEN the gate command runs (native or containerized)
- THEN `JAVI_FORGE_CHANGED_FILES_Z` is NOT present in its environment, AND the gate does not
  crash at spawn time

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

The same optional `reason` field MUST ALSO disambiguate a timed-out gate from a command that itself
exits 124. A gate that fails because its wall-clock `timeout` fired MUST carry `reason` naming the
timeout (e.g. `timed out after Ns`) on BOTH the blocking (`status: "error"`) and informative
(`status: "warning"`) outcomes; its `exitCode` stays the `timeout(1)` sentinel `124`. A gate whose
command genuinely exits 124 WITHOUT timing out MUST report the SAME `status`/`exitCode` but MUST NOT
carry a timeout `reason`. The disambiguation MUST key on the executor's real `timedOut` signal, NEVER
on the 124 value itself — that value is exactly the ambiguity. A consumer can therefore tell "bump the
timeout" (timeout `reason` present) from "fix the command" (no timeout `reason`) even though both
outcomes share `exitCode: 124`.

KNOWN LIMITATION: the changed-file set injected to a gate via `$JAVI_FORGE_CHANGED_FILES` is
newline-joined; a repo path containing a literal newline would corrupt line-based parsing. This is a
low-likelihood edge and is accepted as a documented caveat rather than switching to NUL-joining — a
NUL-joined variant is not merely undesirable but IMPOSSIBLE to deliver, since an env var cannot
carry a NUL byte (see the containerized-execution requirement). A gate needing unambiguous, cwd-
independent resolution uses `$JAVI_FORGE_CHANGED_FILES_ABS` (absolute paths, same order).

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

#### Scenario: timed-out gate is distinguishable from a genuine 124 in JSON

- GIVEN two blocking gates, `--json` set: one hangs under `timeout: 1` (wall-clock timeout) and one
  runs `exit 124` under a generous `timeout`
- WHEN the gate phase completes
- THEN both gate entries have `status: "error"` and `exitCode: 124`, BUT only the timed-out gate
  carries a `reason` matching `timed out`; the genuine-124 gate carries NO timeout `reason`
- AND an informative gate that times out carries the same `reason` with `status: "warning"` while the
  build stays green

#### Scenario: top-level exitCode exposes a runner failure despite ok:true

- GIVEN a run where a blocking RUNNER/phase fails (not a gate), `--json` set
- WHEN the headless run completes
- THEN the JSON `ok` stays `true` (no blocking gate errored) BUT the top-level `exitCode` is non-zero,
  so a consumer keying on the object sees the run failure

### Requirement: Optional gate image (containerized execution)

A gate MAY declare an optional `image` (a plain, digest-pinnable image ref). When present,
`image` MUST be a non-empty string; a missing/empty/non-string `image` MUST fail validation
with a named error identifying the `image` field. An `image` whose value starts with `-` MUST
fail validation with a named error (it would be parsed by `docker run` as a flag rather than an
image argument — docker-flag injection). `image` is valid ONLY under `version: 2`
and is ADDITIVE: a `version: 1` config and a `version: 2` gate WITHOUT `image` MUST parse and
behave byte-identically to today (native execution, `image` in the known-key set so it is not
an unknown-key failure).

#### Scenario: valid image gate accepted

- GIVEN a `version: 2` gate with `id`, `run`, and `image: "ghcr.io/acme/tool@sha256:…"`
- WHEN it is validated
- THEN validation passes and the gate is marked as containerized

#### Scenario: non-string or empty image rejected

- GIVEN a gate whose `image` is empty, missing-when-keyed, or a non-string
- WHEN it is validated
- THEN validation fails with a named error identifying the `image` field

#### Scenario: leading-dash image rejected

- GIVEN a gate whose `image` starts with `-` (e.g. `--privileged` or `-v /:/host`)
- WHEN it is validated
- THEN validation fails with a named error identifying the `image` field

#### Scenario: v2 gate without image is unchanged

- GIVEN a `version: 2` gate with no `image`
- WHEN it is parsed and run
- THEN it runs host-native exactly as before

### Requirement: Fail-closed containerized gate execution matrix

A gate WITH `image` MUST run its command inside a container built from that image (via the
host-uid runner path), NEVER host-native. When Docker is unavailable — `--no-docker` was
passed OR the Docker daemon is down — an image-declaring gate MUST be REFUSED via a named
error / failed step: it MUST NOT fall back to native execution and MUST NOT be silently
skipped or passed. For a BLOCKING gate the refusal is a build FAILURE; for an INFORMATIVE
gate it degrades to `warning` (never a false-green). A gate WITHOUT `image` MUST run
host-native ALWAYS, unchanged, even under `--no-docker`. This seam MUST apply at BOTH runGates
call sites (gates-only and full/quick).

#### Scenario: image gate runs containerized as host uid

- GIVEN an image gate and Docker available
- WHEN the gate phase runs
- THEN the command executes inside the image as the host uid:gid and artifacts stay host-owned

#### Scenario: image gate under --no-docker is refused (blocking fails build)

- GIVEN a blocking image gate and `--no-docker`
- WHEN the gate phase runs
- THEN the gate is REFUSED with a named error, does NOT run native, and the build FAILS

#### Scenario: image gate with Docker daemon down is refused

- GIVEN a blocking image gate and an unavailable Docker daemon
- WHEN the gate phase runs
- THEN the gate is REFUSED (never native/unpinned) and the build FAILS

#### Scenario: non-image gate under --no-docker runs native unchanged

- GIVEN a gate WITHOUT `image` and `--no-docker`
- WHEN the gate phase runs
- THEN it runs host-native exactly as today

### Requirement: Gate contract preserved under containerized execution

A containerized gate MUST preserve the full gate contract: blocking/informative outcome
semantics, the aggregate blocking throw, `scope: changed` skipping, and env delivery.
`$JAVI_FORGE_CHANGED_FILES`, `$JAVI_FORGE_CHANGED_FILES_ABS`, `$JAVI_FORGE_BASELINE`, `CI`, and
every `gate.env` entry MUST reach the containerized command via injected env pairs (gate.env
last-wins), NEVER string-interpolated into the `run` string.

The containerized gate's environment MUST be an EXPLICIT ALLOWLIST — `CI=true`,
`JAVI_FORGE_CHANGED_FILES` and `JAVI_FORGE_CHANGED_FILES_ABS` (both when `scope: changed`),
`JAVI_FORGE_BASELINE` (when a baseline is set), and the declared `gate.env` entries — and MUST
NOT include the host process environment. The ambient `process.env` MUST NOT be forwarded into
the container (neither as `-e` argv pairs nor otherwise), so host secrets are neither exposed on
the host process table nor injected into the (possibly third-party) image. The host-native path
is unaffected and MAY still receive the full host environment via its spawn env map.

`JAVI_FORGE_CHANGED_FILES_Z` (a NUL-joined variant) is NOT part of the allowlist and MUST NOT be
injected into a containerized gate — nor a native one. A NUL byte cannot be carried in an
environment variable: execve's `environ` is an array of NUL-terminated C strings, so a NUL inside
a value truncates it, and Node's `child_process` refuses it outright (ERR_INVALID_ARG_VALUE) for
a NUL in BOTH a `-e KEY=VALUE` argv element AND a spawn env-map value. Injecting it would crash
every `scope: changed` gate at spawn time, so it is omitted entirely rather than shipped broken.

#### Scenario: env, changed files, and baseline reach the container command

- GIVEN a containerized `scope: changed` gate with `env: { FOO: "bar" }` and a baseline
- WHEN the containerized command runs
- THEN `FOO`, `CI`, `JAVI_FORGE_CHANGED_FILES`, `JAVI_FORGE_CHANGED_FILES_ABS`, and
  `JAVI_FORGE_BASELINE` are present in its environment, injected as env pairs and never spliced
  into the command
- AND `JAVI_FORGE_CHANGED_FILES_ABS` holds the same files as `JAVI_FORGE_CHANGED_FILES`, in the
  same order, each as an absolute path
- AND `JAVI_FORGE_CHANGED_FILES_Z` is ABSENT (a NUL value cannot be delivered via `-e`)

#### Scenario: containerized gate does NOT receive an arbitrary host env var

- GIVEN a host process environment containing a secret (e.g. `AWS_SECRET_ACCESS_KEY`) that is
  NOT a `gate.env` entry, and a containerized gate with `env: { FOO: "bar" }`
- WHEN the containerized command runs
- THEN its environment contains ONLY `CI`, the applicable `JAVI_FORGE_*` pairs, and `FOO` — and
  the host secret from `process.env` is NOT passed to the gate container nor placed on the
  `docker run` argv

#### Scenario: blocking containerized gate failure fails the build

- GIVEN a blocking containerized gate whose command exits non-zero
- WHEN the gate phase runs
- THEN the process exits non-zero via the aggregate blocking throw

### Requirement: Containerized gate timeout disambiguation

A containerized gate that declares a `timeout` MUST have that timeout enforced by the executor
(a host-side wall-clock timer); on expiry the container MUST be terminated and the gate outcome
MUST resolve NON-ZERO regardless of the child's own exit, carrying a `reason` naming the timeout (same
GATE-6 disambiguation). A timed-out containerized gate MUST NOT false-green and MUST be
distinguishable — via the executor's deterministic `timedOut` signal, NEVER the raw 124 value —
from a command that itself exits 124. A containerized gate WITHOUT a declared `timeout` MUST
run UNBOUNDED, with no silent default cap (e.g. no 600s ceiling the native path never had).

The declared `timeout` budget for a containerized gate is total wall-clock and INCLUDES image
pull and container startup, unlike the native path (command time only). A cold pull MAY consume
the budget before the command starts; authors SHOULD pre-pull image-gate images or set generous
timeouts. This is documented known behavior, not a defect.

#### Scenario: containerized gate hangs under a declared timeout

- GIVEN a blocking containerized gate with `timeout: 1` whose command hangs
- WHEN the gate phase runs
- THEN the container is terminated host-side, the outcome resolves NON-ZERO with a `reason`
  matching `timed out`, and the build FAILS

#### Scenario: containerized command exits 124 without timing out

- GIVEN a blocking containerized gate that runs `exit 124` under a generous `timeout`
- WHEN the gate phase runs
- THEN the entry has `exitCode: 124` but carries NO timeout `reason` (timedOut is false)

#### Scenario: containerized gate without a timeout runs unbounded

- GIVEN a containerized gate that declares NO `timeout`
- WHEN the gate phase runs
- THEN no host-side timeout timer is armed and no silent 600s cap is imposed (unbounded like native)
