# Proposal: gates-v2 — declarable named quality gates in `.javi-forge/ci.yaml`

## Intent

Operationalize the biogas gate model (M1–M13) as portable, repo-declared quality gates.
A repo declares named `gates:` in `ci.yaml`; the CLI runs them as a repo-level phase with
blocking/informative semantics and optional changed-files scoping. This is the payoff of
the ci-engine-unification arc: gates become config, not code.

## Scope

### In Scope
- `version: 2` ADDITIVE schema: accept-set `{1,2}`; `gates` valid only when `version===2`;
  `runners` OPTIONAL under v2 (gates-only repos); fail-closed on unknown keys preserved.
- Gate schema: `id`, `run` (string|string[]), `mode` (blocking|informative, def blocking),
  `scope` (all|changed, def all), `baseline?`, `env?`. Repo-level phase after the runner loop.
- `ci validate` extended to validate the gates schema.
- B1 fix (bare-by-implicit-name) + B2 fix (`--shell` honors runner.image/buildContext).
- `CIStepStatus += "warning"` for informative mode (+ both UI Records, non-failing exit).
- New injectable `src/lib/git-diff.ts` diff engine (base-ref chain, forge-agnostic, loud-degrade).
- Gate-run JSON via existing `--json` flag.

### Out of Scope
- Flipping default `version` 1→2 (stays additive; v1 parses byte-identically).
- Forward-compat shim for old binaries reading v2 (contract: upgrade binary, then opt in).
- Separate `gates.yaml` file / second discovery path.
- Changing auto-detect fleet behavior or the archived single-runner-CONFIG-suffixed rule.

## Scope Decision

- **Mode**: Selective
- **Justification**: Incoming scope is already the minimal high-value slice — additive
  schema + gate phase + diff engine, with B1/B2 folded in as one-touch cleanup. No
  expansion (env-for-Docker is gated on verification, not assumed); no reduction that
  would ship gates without the loud-degrade diff engine that makes `scope:changed` safe.

## Capabilities

### New Capabilities
- `ci-gates`: `version:2` schema negotiation, the `gates` block, the repo-level gate phase
  (blocking/informative outcome collector), the `src/lib/git-diff.ts` base-ref/changed-files
  engine, and the gate-run `--json` shape.

### Modified Capabilities
- `ci-execution`: (1) step-id naming re-keyed on IMPLICIT (auto + stack-override → bare) vs
  EXPLICIT (config → suffixed) — MODIFIES the "Stack override emits suffixed ids" scenario;
  the "Single-runner config still emits suffixed ids (R3 guard)" scenario is PRESERVED.
  (2) `CIStepStatus` gains `"warning"`. (3) `ci --shell` honors `runner.image`/`buildContext`.

## Approach

Gates run AFTER the runner loop, alongside security/ghagga (ci.ts:639-691 template), each
executed through the existing `runStep` (native/Docker parity), wrapped in a non-throwing
outcome collector: blocking failure → throw (exit 1); informative failure →
`report(…,"warning",…)`, no throw. `scope:changed` consumes `$JAVI_FORGE_CHANGED_FILES`
from `git-diff.ts`; if no base-ref resolves, changed-scope gates SKIP with a NAMED warning
— never silently widen to `all`. Env passed as a child-process env map, not string-spliced
into the shell `run`. Delivered as a 4-PR sequential chain, each ≤400 production lines.

### Slicing (4-PR chain, sequential)
1. Schema `version:2` + `gates` validation + extend `ci validate` + B1 decision + B2 fix. (additive, LOW)
2. `git-diff.ts` fully tested, UNWIRED (pure base-ref table test + mocked execFileAsync + 1 real-git IT). (LOW)
3. `CIStepStatus += warning` + non-throwing gate runner + `mode`/`scope:all` through runCI + UI. (status-vocab ripple, HIGH)
4. `scope:changed` wiring + `baseline` + `env` + gate-run JSON. Split baseline/env out if >400. (HIGH)

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/ci-config.ts` | Modified | Accept-set `{1,2}`, `gates` whitelist + schema validation |
| `src/lib/git-diff.ts` | New | Base-ref chain + changed-files, injectable env/cwd |
| `src/commands/ci.ts` | Modified | Status vocab, gate phase, B1 naming, B2 `--shell` fix |
| `src/commands/ci-validate.ts`, `src/cli/dispatch/ci.tsx` | Modified | Validate gates + gate-run JSON |
| `src/ui/CI.tsx` | Modified | `warning` icon/color (theme.warning exists) |
| `src/cli/help.ts` | Modified | Reuse existing `--json`; no new flag |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Docker `env:` needs `-e` plumbing; `runInContainer` support UNVERIFIED | High | **Design-phase gate**: verify `runInContainer` env support; if absent, scope `env:` to native-only in v1 OR add plumbing as explicit work |
| Diff engine silently widens `scope:changed`→`all` | Med | Loud-degrade contract: SKIP + named warning; table-driven test of base-ref precedence |
| `env` string-spliced into shell `run` (injection surface) | Med | Pass via child-process env map only, never interpolate into `run` |
| Monorepo: changed-files repo-root vs `runner.directory` cwd mismatch | Med | Design phase resolves gate cwd + changed-files relativity |
| Slice-3 status-vocab ripple exceeds 400 lines | Med | Sliced alone; UI Records + JSON + switches audited pre-apply |
| B1 silently renames stack-override steps | Med | Explicit decision pinned by characterization test in slice 1 |

## Rollback Plan

Additive and opt-in: the one fleet consumer (consorcio-canalero) ships `version:1`, unaffected.
Revert = unpublish/patch-release the binary; v1 configs keep parsing byte-identically.
Per-slice revert is clean since each PR is autonomous (slice 2 ships unwired).

## Dependencies

- `git` on PATH for `scope:changed` (already used by init/git.ts); absent/unresolved base
  degrades loudly, does not crash `scope:all` gates.
- semantic-release ships the binary; consumers opt into `version:2` when ready.

## Success Criteria

- [ ] A repo declaring `version:2` + `gates:` runs them; v1 configs parse byte-identically.
- [ ] Blocking gate failure → exit 1; informative failure → `warning` status, exit 0.
- [ ] `scope:changed` with no resolvable base-ref SKIPS with a named warning (never widens).
- [ ] `ci validate` reports gate-schema errors; unknown keys still fail closed.
- [ ] B1 (stack-override bare) and B2 (`--shell` honors image/buildContext) pinned by tests.
- [ ] Gate-run `--json` emits the `{ok,gates[]}` shape; exit 0 unless a blocking gate errored.
- [ ] `runInContainer` env support resolved before `env:`-for-Docker is promised.
