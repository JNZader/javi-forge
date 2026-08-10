# Delta for ci-execution

## ADDED Requirements

### Requirement: runInContainer arbitrary env injection

`runInContainer` MUST accept a caller-supplied env map and inject each entry as a discrete
`-e KEY=VALUE` argv pair, NEVER shell-spliced into the command string. The injection MUST be
additive to the existing hardcoded `CI=true` and MUST NOT alter the argv for callers that pass
no env map.

#### Scenario: env map becomes discrete -e argv pairs

- GIVEN a caller passes `{ FOO: "a b", BAR: "x;y" }`
- WHEN `runInContainer` builds the docker argv
- THEN it emits `-e FOO=a b` and `-e BAR=x;y` as argv pairs, with values never shell-split or
  interpolated into the command

#### Scenario: no env map leaves argv unchanged

- GIVEN a caller passes no env map (e.g. the existing runStep Docker caller)
- WHEN `runInContainer` builds the docker argv
- THEN the argv is identical to today (only `-e CI=true`)

### Requirement: DockerRunResult.timedOut deterministic signal

`DockerRunResult` MUST carry a `timedOut` boolean set DETERMINISTICALLY by the executor — NOT
inferred from a raw 124 exit code — so a container timeout is distinguishable from a command
that genuinely exits 124. This extension MUST be ADDITIVE: the existing `runStep` Docker caller
(which throws on non-zero) MUST be unaffected, and existing fields (`exitCode`, `stdout`,
`stderr`) MUST remain intact.

#### Scenario: container timeout sets timedOut true

- GIVEN a containerized command the executor terminates on a host-side timeout (docker stop)
- WHEN `runInContainer` returns
- THEN `timedOut` is `true` (set by the host timer before the kill, independent of the exit value)

#### Scenario: genuine 124 does not set timedOut

- GIVEN a containerized command that itself exits 124 without any timeout firing
- WHEN `runInContainer` returns
- THEN `exitCode` is 124 AND `timedOut` is `false`

#### Scenario: runStep throw-on-nonzero caller is unaffected

- GIVEN the existing `runStep` Docker caller that throws on a non-zero `exitCode`
- WHEN `DockerRunResult` gains `timedOut` and `DockerRunOptions` gains `env`
- THEN that caller compiles and behaves identically (additive-only extension)

### Requirement: Containerized command runs as host uid (ENV-1 composition)

A containerized gate MUST inherit `runInContainer`'s host-uid `--user uid:gid`, so any
artifacts written by the containerized command stay host-owned rather than root-owned.

#### Scenario: containerized gate artifacts stay host-owned

- GIVEN a containerized gate whose command writes a file into the bind-mounted work dir
- WHEN the gate completes
- THEN the file is owned by the host user, not root

### Requirement: Container image portability constraint

Because `runInContainer` wraps the command with `bash -c`, a `gate.image` MUST ship `bash`.
The timeout is enforced host-side (`docker stop`), so NO in-container `timeout` binary is
required (the design removed the in-container timeout wrapper). This is a documented KNOWN
CONSTRAINT: a distroless image lacking `bash` fails the gate rather than silently passing.

#### Scenario: image lacking bash fails the gate

- GIVEN a containerized gate whose `image` ships no `bash`
- WHEN the gate phase runs
- THEN the command fails (surfaced as a gate failure), never a silent pass
