# Delta for ci-execution

New capability (`openspec/specs/` is empty). Behavior-preserving: every requirement below is a
preservation contract for behavior observable TODAY.

## ADDED Requirements

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

Naming MUST be a function of `resolved.source` ONLY. When `resolved.source === "auto"`, ids MUST be
bare (`lint`, `compile`, `test`) and labels MUST be unsuffixed (`Lint: <cmd>`, `Lint passed`,
`Lint failed`). For any other source, ids MUST be `${phase}:${runner.name}` and labels MUST carry
`[name]`. Naming MUST NOT be keyed on `runners.length` or any runner-count predicate.

#### Scenario: Auto emits bare ids

- GIVEN zero-config detection of a node repo
- WHEN `runCI` runs
- THEN step ids are `lint`, `compile`, `test` with no `:` suffix

#### Scenario: Single-runner config still emits suffixed ids (R3 guard)

- GIVEN a `ci.yaml` with EXACTLY ONE runner named `api`
- WHEN `runCI` runs
- THEN step ids are `lint:api`, `compile:api`, `test:api`

#### Scenario: Stack override emits suffixed ids

- GIVEN `--stack node` on a node repo (`resolved.source === "stack-override"`)
- WHEN `runCI` runs
- THEN ids are suffixed exactly as they are today (B1 is preserved, not fixed)

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
codes MUST be unchanged. No `ci.yaml` schema key MAY be added; schema version 1 stays locked and
still rejects unknown keys.

#### Scenario: Hook-invoked flag set still works

- GIVEN `javi-forge ci --quick --no-docker --no-security --no-ci-ghagga`
- WHEN it runs
- THEN docker-check, security and ghagga steps are suppressed exactly as before
- AND a failing command yields the same non-zero exit code

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

The refactor MUST NOT reduce measured line or branch coverage below the slice-1
baseline recorded in `design.md` (lines 88.34%, branches 78.88%), and MUST NOT
lower the configured thresholds in `vitest.config.ts`.

The configured 80% branch floor is currently UNMET on `main` (77.97%). That gap
is pre-existing, is not introduced or closed by this change, and is tracked as
COV-1 in `docs/BACKLOG.md` — out of scope here.

#### Scenario: Coverage gate after deleting the legacy executor

- GIVEN the legacy executor is deleted
- WHEN `pnpm test:coverage` runs
- THEN measured lines >= 88.34 and branches >= 78.88, with the configured thresholds unchanged
