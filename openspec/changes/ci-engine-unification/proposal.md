# Proposal: CI Engine Unification

## Intent

`runCI` has TWO executors (`runLegacySteps` for `auto`, `runConfiguredRunner` for config/`--stack`) diverging in 6 accidental ways (command source, image resolution site, image-name re-derivation, `noSecurity` propagation, missing fail-closed tool checks, missing setup/security phases) — every future gate change must be written twice. Separately, `installCIHooks` overwrites any existing non-symlink hook with no marker, backup or warning (B4): data loss against ~8 consumer repos. Collapse to ONE executor and make hook installation classify-before-write, without changing observable CI behavior or hook CONTENT. Prerequisite for `gates-v2`.

## Scope

### In Scope

- **Slice 1 — characterization tests first**: legacy `auto` + Docker end-to-end (Docker-gated), global step ORDER, compile `--user root`, `--stack` step ids as they are TODAY, and EXECUTING the generated hooks (not grepping substrings).
- **Slice 2 — executor collapse**: delete `runLegacySteps`; route `auto` through the configured-runner executor; naming keyed on `resolved.source === "auto"` (bare ids) — NEVER on `runners.length`; thread the prologue-resolved image name explicitly.
- **Slice 3 — hook markers**: versioned marker + content hash; classify `absent | managed:vN | foreign | managed-but-edited`; refuse to clobber foreign/edited without explicit force; recognize unmarked byte-identical-to-historical content as `managed:v0`; extract the three templates to shipped asset files (`package.json` `files` + `package:check`).

### Out of Scope

- B1 (`--stack` emits suffixed ids), B2 (`--shell` ignores configured runners), B3 (dead defaults) → backlog, fix BETWEEN SDDs. B4 is fixed implicitly by slice 3's no-clobber policy.
- Adopting the richer `ci-local/hooks/*` content (stricter commit-msg, pre-push degrade) — behavior change for the fleet, separate future change.
- `gates-v2`. This refactor MUST leave the seams clean and MUST NOT add `ci.yaml` config keys (schema v1 stays locked).

## Scope Decision

- **Mode**: Selective
- **Justification**: Deliver only the two structural blockers (one executor, safe hook writes) plus the safety net that makes them verifiable; the richer hook content and the gate registry are real but lower-leverage and each carries fleet-visible behavior change, so they stay deferred behind the markers this change ships.

## Capabilities

### New Capabilities

- `ci-execution`: single-executor phase pipeline — runner resolution, phase order, step-id/label naming by resolution source, image threading, fail-closed tool checks.
- `ci-hook-install`: versioned marker + hash classification and the no-clobber write policy for `ci init`.

### Modified Capabilities

- None (`openspec/specs/` is currently empty).

## Approach

Exploration Approach 1 (executor) + A + C (hooks). `resolveCIRunners` already synthesizes a complete `ResolvedRunner` for `auto` with empty `setupCmds`/`securityCmds`/`requiredTools`, so routing `auto` through the configured executor is a no-op today and correct tomorrow. Naming becomes a function of `resolved.source`. Hook templates move to `assets/hooks/*`, read at install time, each carrying `# javi-forge-hook: {name} v1` plus a hash line.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/commands/ci.ts` | Modified | Delete `runLegacySteps`; source-aware naming; explicit image threading; marker/classify in `installCIHooks` |
| `assets/hooks/*` | New | The three hook templates, extracted verbatim |
| `package.json` | Modified | `files` entry for `assets/`; `package:check` update |
| `src/commands/ci.test.ts`, `src/__integration__/*` | Modified | Characterization tests added |
| `src/commands/tdd.ts`, `tdd-pipeline.ts` | Unchanged | Consume `detectCIStack` — public contract preserved |

## Compat Anchors (non-negotiable)

- Bare `auto` step ids pinned by `ci.test.ts:767-787`.
- `detectCIStack` / `CIStackInfo` is a SECOND public contract (`tdd.ts:124`, `tdd-pipeline.ts:135`) — not deleted, not reshaped.
- Frozen CLI flags used by installed hooks: `--quick --no-docker --no-security --no-ci-ghagga` and bare `javi-forge ci`.
- Coverage thresholds 85 lines / 80 branches MUST NOT be lowered (`openspec/config.yaml`).
- `ci.yaml` schema v1: no new keys.
- Auto image build stays BEFORE the `.context/` refresh step.

## Consumer Impact

Global linuxbrew install plus installed hooks in ~8 repos. Observable CI behavior must be byte-identical; the only consumer-visible change is that `ci init` now REFUSES to overwrite a foreign/edited hook. Legacy-content recognition is what prevents that refusal from bricking `ci init` for the entire existing fleet.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| R1 — legacy Docker path has zero coverage and self-CI runs `--no-docker` | High | Slice 1 lands Docker-gated e2e BEFORE the collapse |
| R2 — fleet runs OLD unmarked hooks and never re-inits | High | Historical-content hash table → classify as `managed:v0`, allow upgrade |
| R3 — naming keyed on `runners.length` would rename ids for single-runner CONFIGS | Med | Key strictly on `resolved.source === "auto"`; test both shapes |
| R4 — deleting a well-covered function drops measured coverage | Med | Slice 1 adds coverage first; same-run delta gate at each verify (`head >= base`, see design.md "Coverage Guard (R4)"); thresholds never lowered |
| R5 — image build silently moves after `.context/` refresh | Med | Step ORDER pinned by a slice-1 test; order decided explicitly, not by accident |
| R6 — schema v1 rejects unknown keys on older binaries | Low | No config keys added in this change |

## Rollback Plan

Three independent PRs, each revertible alone. Slice 1 is additive (tests only) — never needs reverting. Slice 2 revert restores `runLegacySteps` verbatim. Slice 3 revert restores in-TS templates and the old write path; already-installed marked hooks stay functional because the marker is a comment line. Published via semantic-release: if a regression escapes, `git revert` + patch release; consumers on linuxbrew re-upgrade, and hooks re-invoke the same frozen flags either way.

## Dependencies

- Docker + a `bash:5` style image for the slice-1 Docker-gated tests (skipped when absent, matching `ci-mixed.integration.test.ts`).
- An inventory of historical hook template bytes to build the `managed:v0` hash table.

## Success Criteria

- [ ] Observable behavior identical: step ids, labels, phase order, exit codes, flag contract unchanged.
- [ ] All pre-existing tests pass UNCHANGED; the only test-file edits are ADDED characterization tests.
- [ ] Slice 2 production diff is net-negative.
- [ ] Coverage stays >= 85 lines / 80 branches without lowering thresholds.
- [ ] `runLegacySteps` no longer exists; `runStep` is the only execution leaf.
- [ ] `ci init` on a repo with an old unmarked hook UPGRADES it; on a hand-edited or foreign hook it REFUSES and says why.
- [ ] Generated hooks are executed by tests, not grepped.
- [ ] Each slice under the 400-line review budget.

## Proposal question round

Scope is user-approved and not re-litigated. Two decisions remain open for design:

1. R5 — keep the auto image build in the prologue (order preserved, requires threading the resolved name) or accept the order flip? Proposal assumes **order preserved**.
2. Slice 3 — what is the escape hatch for a foreign/edited hook: a `--force` flag, a `.bak` backup, or refuse-only? Proposal assumes **refuse + explicit force flag**.
