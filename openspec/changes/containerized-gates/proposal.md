# Proposal: containerized-gates — optional `gate.image` execution

## Intent

A host-native gate passes-by-default in ways that are not exit-0: tool not installed, wrong tool version, or Docker down → runs unpinned or is bypassed silently. This is biogas M8 "pin everything" applied to gate EXECUTION. Add an OPTIONAL `gate.image` in `.javi-forge/ci.yaml` (`version: 2`, additive) so a gate MAY declare a digest-pinnable image and run containerized for REPRODUCIBILITY. Step 1 of the reproducibility arc; the full devcontainer is a separate future change.

## Scope

### In Scope
- `gate.image` = plain digest-pinnable image ref (verbatim passthrough, reusing the runner path); schema + validation + mutual-exclusion, `version: 2` additive.
- Route an image-declaring gate through `runInContainer`; extend `DockerRunOptions.env` (repeated `-e KEY=VALUE` argv pairs) and `DockerRunResult.timedOut` (deterministic, NOT keyed on raw 124).
- TARGETED fail-closed: gate WITH image + Docker down or `--no-docker` → REFUSE (step error, never silent native/unpinned). Gate WITHOUT image → native always.
- No-timeout containerized gate = UNBOUNDED (disable the in-container `timeout` wrapper when no `timeout` declared); declared timeout → in-container `timeout`.
- Thread `noDocker` + docker-availability into BOTH `runGates` call sites (ci.ts:535 gates-only, :760 full/quick).

### Out of Scope
- `gate.build-context` (needs a `stack` a gate lacks; marginal benefit) — deferred.
- Forcing the WHOLE `ci` run into a pinned image (= devcontainer direction) — separate future change.
- Inheriting a repo-default image (no runner to inherit from).

## Scope Decision

- **Mode**: Selective
- **Justification**: Incoming scope is already the minimal high-value slice — a digest-pinned per-gate image IS the reproducibility win. Build-context and whole-run pinning are real but lower-leverage tails explicitly deferred to keep the `runStep`-caller blast radius contained.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `ci-gates`: gate schema gains optional `image` (digest-ref, mutually exclusive with future build-context); execution semantics gain the targeted fail-closed matrix and the timed-out-in-container `reason` disambiguation.
- `ci-execution`: `runInContainer` gains `env` injection and `DockerRunResult.timedOut`, additively (must not break the throw-on-nonzero `runStep` caller at ci.ts:1010-1037).

## Approach

3 slices (delivery: ask-on-risk):
1. **Schema** (`ci-config.ts` + tests) — `image` on `CIGateConfig`/`GATE_FIELDS`/`validateGate`, mirror runner image validation + mutual-exclusion. Additive, LOW.
2. **Execution routing** (`docker.ts` + `ci.ts` runGates + tests) — `DockerRunOptions.env`, `DockerRunResult.timedOut`, route image-gate through `runInContainer`, adapt `{code,timedOut}`. HIGH 400-line risk (touches `runStep` contract). Keep additive.
3. **Fail-closed + timeout disambiguation** (both runGates sites + tests) — thread `noDocker`+`dockerOk`, refuse-on-image-without-Docker, resolve 124→`timedOut` (distinct signal/sentinel or `timeout -k` inspecting 124-vs-137), enforce unbounded-when-no-timeout.

ENV-1 composes for free: `runInContainer` already runs `--user uid:gid` → gate artifacts stay host-owned. This fail-closed discipline (refuse, never degrade) is the same policy the FUTURE hooks-ricos pre-push will adopt.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/ci-config.ts` | Modified | `image` field + validation + mutual-exclusion |
| `src/lib/docker.ts` | Modified | `DockerRunOptions.env`, `DockerRunResult.timedOut` (additive) |
| `src/commands/ci.ts` | Modified | route image-gates; thread fail-closed seam into runGates :535 + :760 |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Timeout 124 ambiguity (command-124 vs timed-out) | High | Set `timedOut` deterministically via distinct signal/sentinel or `timeout -k` 124-vs-137; never key on raw 124 |
| Slice-2 breaks `runStep` throw-on-nonzero caller | Med | Extend `DockerRunResult`/`DockerRunOptions` additively only; keep existing fields intact |
| Two fail-closed seams; gates-only path never calls `isDockerAvailable` | Med | Thread `noDocker`+availability into BOTH :535 and :760 |
| Arbitrary-image portability (busybox/distroless lack bash/timeout) | Med | Document KNOWN CONSTRAINT: gate.image must ship bash (+coreutils `timeout` if a timeout is declared) |

## Rollback Plan

Feature is purely additive under `version: 2`; a `version: 1` config parses byte-identically and native gates behave exactly as today. Revert = drop the `image` schema field + routing branch; no persisted state, no consumer migration. Published via semantic-release; a patch release reverts cleanly for the global linuxbrew install and ~8 hook consumers.

## Dependencies

- Existing `runInContainer` (`src/lib/docker.ts`) and `isDockerAvailable()`; Docker on PATH (optional; refusal is the fail-closed answer when absent).

## Success Criteria

- [ ] A digest-pinned image-gate runs containerized as host-uid (artifacts host-owned).
- [ ] An image-gate REFUSES (step error) when Docker is down or `--no-docker`; never runs native/unpinned.
- [ ] A gate WITHOUT an image is unchanged (native, unbounded when no timeout).
- [ ] A timed-out containerized gate is non-zero AND carries the timeout `reason` in JSON (distinguishable from a genuine 124).
- [ ] `version: 1` configs and the `runStep` Docker caller are unaffected.
