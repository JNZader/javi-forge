# Spec: ci-execution

Source of truth for the `javi-forge ci` execution engine.

Established by change `ci-engine-unification` (archived `2026-08-08`), which merged its
`ADDED Requirements` delta into this — previously empty — main spec tree. Every requirement below is
a preservation contract for behavior observable on `main` @ `d58cdbb`.

## Requirements

### Requirement: Single execution path

`runCI` MUST execute every resolved runner through ONE executor regardless of `resolved.source`
(`auto` | `config` | `stack-override`). `runStep` MUST remain the only execution leaf. No second
per-source executor MAY exist.

#### Scenario: Auto resolution uses the configured executor

- GIVEN a repo with no `.javi-forge/ci.yaml`
- WHEN `runCI` runs in full mode
- THEN the emitted step stream is identical (ids, labels, order, statuses) to the pre-change stream
- AND no legacy-only code path is invoked

#### Scenario: Image name is threaded, not re-derived

- GIVEN Docker mode with an auto-resolved runner
- WHEN the prologue resolves the image
- THEN that resolved image name is passed explicitly to the phase steps
- AND the executor does NOT re-derive the name from the stack

### Requirement: Step-id and label naming keyed on resolution source

Naming MUST be a function of whether the runner NAME is IMPLICIT or EXPLICIT. The name is IMPLICIT
when `resolved.source === "auto"` (zero-config detection) OR `resolved.source === "stack-override"`
(`--stack`), because in both cases the user never named the runner. The name is EXPLICIT when
`resolved.source === "config"` (a runner named in `ci.yaml`). When the name is IMPLICIT, ids MUST be
bare (`lint`, `compile`, `test`) and labels MUST be unsuffixed (`Lint: <cmd>`, `Lint passed`,
`Lint failed`). When the name is EXPLICIT, ids MUST be `${phase}:${runner.name}` and labels MUST
carry `[name]`. Naming MUST NOT be keyed on `runners.length` or any runner-count predicate.
(Previously: naming was keyed on `resolved.source` such that ONLY `auto` produced bare ids and
`stack-override` produced suffixed ids; B1 flips `stack-override` to bare because its name is
implicit.)

#### Scenario: Auto emits bare ids

- GIVEN zero-config detection of a node repo
- WHEN `runCI` runs
- THEN step ids are `lint`, `compile`, `test` with no `:` suffix

#### Scenario: Single-runner config still emits suffixed ids (R3 guard)

- GIVEN a `ci.yaml` with EXACTLY ONE runner named `api`
- WHEN `runCI` runs
- THEN step ids are `lint:api`, `compile:api`, `test:api`

#### Scenario: Stack override emits bare ids (B1 fix)

- GIVEN `--stack node` on a node repo (`resolved.source === "stack-override"`)
- WHEN `runCI` runs
- THEN step ids are bare `lint`, `compile`, `test` with no `:` suffix, because the name is implicit

### Requirement: Preserved step order

Global order MUST be unchanged: docker-check → auto image build → `.context/` refresh → per-runner
[required-tool check → setup → lint → compile → test → per-runner security] → top-level Semgrep →
GHAGGA. The per-runner `security` phase (`security:<runner>`, driven by `runner.securityCmds` and
skipped when the mode is not `full` or `--no-security` is given) runs LAST inside each runner, after
`test` and before the top-level Semgrep step; it MUST NOT be dropped or reordered. The auto image
build MUST occur BEFORE the `.context/` refresh step (R5).

#### Scenario: Image build precedes context refresh

- GIVEN auto resolution in Docker mode
- WHEN the step stream is captured
- THEN the image-build step index is lower than the `.context/` refresh step index

#### Scenario: Tool check precedes setup

- GIVEN a configured runner with `requiredTools`
- WHEN a required tool is missing
- THEN the run fails before any setup command executes

### Requirement: Preserved flag, mode and exit-code contract

The CLI contract MUST be unchanged: `--quick`, `--no-docker`, `--no-security`, `--no-ci-ghagga`,
bare `javi-forge ci`, `detect` mode and `shell` mode keep their current names and semantics. Exit
codes MUST be unchanged. Schema `version: 1` stays byte-locked and still rejects unknown keys.
Schema `version: 2` is ADDITIVE (see the `ci-gates` capability): under `version: 2`, the `gates`
key is permitted and `runners` is OPTIONAL when `gates` is present (a `version: 2` config with
neither `runners` nor `gates` fails closed). The "no schema key MAY be added"
rule applies to `version: 1` ONLY; it MUST NOT be read as forbidding the additive `version: 2`
schema. (Previously: "No `ci.yaml` schema key MAY be added; schema version 1 stays locked and still
rejects unknown keys." — that blanket lock is re-scoped here to v1, because v2 is additive.)

#### Scenario: Hook-invoked flag set still works

- GIVEN `javi-forge ci --quick --no-docker --no-security --no-ci-ghagga`
- WHEN it runs
- THEN docker-check, security and ghagga steps are suppressed exactly as before
- AND a failing command yields the same non-zero exit code

#### Scenario: version 1 stays locked

- GIVEN a `version: 1` config with any unknown top-level key
- WHEN it is parsed
- THEN parsing fails closed exactly as before (v1 rejects unknown keys)

#### Scenario: version 2 is additive

- GIVEN a `version: 2` config that declares `gates` and no `runners`
- WHEN it is parsed
- THEN it is accepted (v2 permits `gates` and makes `runners` optional)

#### Scenario: Detect mode emits only the detect step

- GIVEN `detect` mode for any source
- WHEN `runCI` runs
- THEN exactly one step is emitted and no runner phase executes

### Requirement: Auto path inherits configured phases as no-ops

Routing `auto` through the unified executor MUST be observationally neutral: `setupCmds`,
`securityCmds` and `requiredTools` are empty for auto, so the setup phase, the per-runner security
phase and the fail-closed tool check MUST emit NO steps for auto today. `noSecurity` MUST be
propagated into the executor context.

#### Scenario: Auto emits no setup, per-runner security or tool-check steps

- GIVEN auto resolution in full mode
- WHEN `runCI` runs
- THEN no step id matching `setup*`, `security:*` or `tools*` is emitted

### Requirement: Characterization tests before the collapse

The behaviors uncovered today (exploration Q4 items 1, 2, 3, 8, 10) MUST be pinned by passing tests
BEFORE the executor collapse lands: auto+Docker end-to-end (Docker-gated, skipped when absent),
global step ORDER, compile running as `--user root` in Docker, `--stack` step ids as they are today,
and EXECUTING generated hooks rather than grepping substrings. Pre-existing tests MUST pass
unchanged; the only test edits allowed are ADDED tests.

#### Scenario: Collapse lands on a green safety net

- GIVEN the characterization suite is merged and green
- WHEN the executor collapse is applied
- THEN every characterization test still passes with no assertion edited

### Requirement: Coverage must not regress

The refactor MUST NOT reduce measured line or branch coverage, measured as a
SAME-RUN DELTA: at each slice's verify step `npx vitest run --coverage` MUST be
run TWICE on the same machine in the same session — once with the working tree
at the merge-base (the previous slice's head) and once at the slice head — with
the identical command and environment. Both lines and branches MUST satisfy
`head >= base` (tolerance 0), compared as PERCENTAGES (covered/total) — never raw covered counts, which legitimately shrink on deletion refactors — with the measured ±1-branch inter-run jitter counting as equal. The configured thresholds in `vitest.config.ts`
MUST NOT be lowered.

Absolute coverage percentages MUST NOT be used as the gate. They are stale one
commit after they are written, and they vary by environment because the
Docker-gated integration suites run on a developer box and `skipIf` out in CI.
Recorded percentages are informative context only and MUST carry their commit
and environment.

The configured 80% branch floor is currently UNMET on `main` (77.97%). That gap
is pre-existing, is not introduced or closed by this change, and is tracked as
COV-1 in `docs/BACKLOG.md` — out of scope here. The delta gate is independent of
it: the delta can pass while the configured threshold still fails.

#### Scenario: Coverage gate after deleting the legacy executor

- GIVEN the legacy executor is deleted
- WHEN `npx vitest run --coverage` is run on the merge-base tree and then on the slice head, same machine and same session
- THEN head lines >= base lines AND head branches >= base branches, with the configured thresholds unchanged

### Requirement: Shell mode honors runner image and build context (B2)

When `ci --shell` targets a runner that pins an `image` or `build-context`, shell mode MUST use
THAT image/build context, NOT the auto-detected stack default derived from the primary runner's
stack type.

#### Scenario: Shell uses the pinned runner image

- GIVEN a runner with a pinned `image` (or `build-context`) distinct from the auto-detected stack default
- WHEN `ci --shell` targets that runner
- THEN the shell container is built from the pinned `image`/`build-context`, not the stack default

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
