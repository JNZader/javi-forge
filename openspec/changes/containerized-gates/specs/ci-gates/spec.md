# Delta for ci-gates

## ADDED Requirements

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
`$JAVI_FORGE_CHANGED_FILES`, `$JAVI_FORGE_BASELINE`, `CI`, and every `gate.env` entry MUST
reach the containerized command via injected env pairs (gate.env last-wins), NEVER
string-interpolated into the `run` string.

The containerized gate's environment MUST be an EXPLICIT ALLOWLIST — `CI=true`,
`JAVI_FORGE_CHANGED_FILES` (when `scope: changed`), `JAVI_FORGE_BASELINE` (when a baseline is
set), and the declared `gate.env` entries — and MUST NOT include the host process environment.
The ambient `process.env` MUST NOT be forwarded into the container (neither as `-e` argv pairs
nor otherwise), so host secrets are neither exposed on the host process table nor injected into
the (possibly third-party) image. The host-native path is unaffected and MAY still receive the
full host environment via its spawn env map.

#### Scenario: env, changed files, and baseline reach the container command

- GIVEN a containerized `scope: changed` gate with `env: { FOO: "bar" }` and a baseline
- WHEN the containerized command runs
- THEN `FOO`, `CI`, `JAVI_FORGE_CHANGED_FILES`, and `JAVI_FORGE_BASELINE` are present in its
  environment, injected as env pairs and never spliced into the command

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
