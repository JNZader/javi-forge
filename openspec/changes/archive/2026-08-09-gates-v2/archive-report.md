# Archive Report — gates-v2

**Change**: gates-v2 — declarable named quality gates in `.javi-forge/ci.yaml`
**Artifact store**: hybrid
**Archived**: 2026-08-09 → `openspec/changes/archive/2026-08-09-gates-v2/`
**Verdict inherited**: PASS WITH WARNINGS (0 CRITICAL) — verify-report engram #13390
**Merged main @**: bbfd22f (project HEAD at archive: 03a4f26)

## Delivered Capability

Operationalized the biogas gate model (M1-M13) as portable, repo-declared quality gates:

- **Additive `version: 2` schema** — accept-set `{1,2}`; a `version: 1` config parses
  byte-identically to before (fleet consumer consorcio-canalero ships v1, unaffected).
  `gates` valid ONLY under v2; `runners` OPTIONAL under v2 when `gates` present; v2 with
  neither fails closed. `gates`-under-v1 → named `"gates require version: 2"` before the
  generic unknown-key error (allowed-key set computed AFTER reading `version`).
- **Gate schema** — tag-safe unique `id`, `run` (`string | string[]`), `mode`
  (`blocking | informative`, default blocking), `scope` (`all | changed`, default all),
  optional `baseline` + `env`.
- **Repo-level gate phase** — runs AFTER the runner loop, host-native (`runGateNative`
  spawns `bash -c` at repo root, RETURNS the child exit code — modeled on runSemgrep/runGhagga,
  NOT `runStep`). Blocking fail → aggregate throw → exit 1; informative fail → status
  `warning`, exit 0, remaining gates continue. Multi-command gate = fail-fast, first non-zero
  is the reported `exitCode`. Runs in full AND `--quick`; skipped only in detect/shell.
- **scope:changed loud-degrade** — new injectable `src/lib/git-diff.ts` (forge-agnostic
  base-ref chain: GitLab MR/push, GitHub, local merge-base). Base null → SKIP + named reason;
  changedFiles throw (shallow clone/missing ref) → CATCH → SKIP + named reason; empty set →
  SKIP. NEVER widens to `all`, NEVER crashes the phase.
- **Headless JSON** — NEW non-Ink `--json` run branch (bypasses Ink render, collects gate
  outcomes, prints `{ok, exitCode, gates[]}`, sets own process exit code). `ok` false iff a
  BLOCKING gate errored; top-level `exitCode` non-zero on ANY run failure (runner/crash) so a
  consumer is never fooled by `ok:true` on a failed run.
- **Native-only in v1** — Docker-per-gate deferred (needs gate-image resolution); `docker.ts`
  untouched, `CIGateConfig` has no `image` field.
- **ci-execution deltas** — B1 (step-id naming re-keyed on IMPLICIT auto+stack-override → bare
  vs EXPLICIT config → suffixed; R3 single-runner-config guard preserved), B2 (`ci --shell`
  honors runner `image`/`build-context`), `CIStepStatus += "warning"` (both UI Records updated),
  and the JDA-003 fix re-scoping the blanket "no schema key" lock to v1-only (v2 additive) that
  resolved the live-spec self-contradiction.

## Delivery — 4 sequential stacked-to-main PRs

| PR | Slice | Scope | Release |
|----|-------|-------|---------|
| #8 | 1 | schema `{1,2}` + gate validation + `ci validate` extension + B1 + B2 | 1.11.0 |
| #9 | 2 | `git-diff.ts` fully tested, UNWIRED (revert-clean) | 1.12.0 |
| #10 | 3 | gate execution + `warning` status vocab + prologue guard | 1.13.0 |
| #11 | 4 | scope:changed + baseline + env + headless JSON | 1.14.0 |

Releases 1.10.x → 1.14.0. Each `semantic-release` cut only fires on GREEN main CI per slice —
independent corroboration of the apply-phase evidence (validate EXIT=0, 1468 passed / 4 skipped,
tsc clean, biome clean, coverage floors held). Merge SHAs are recorded in the PR history; the
final merged-main verification point is bbfd22f.

## Task Completion — 33/33 [x]

All four slices' tasks are checked in `tasks.md`. Task Completion Gate PASSED at archive; no
stale unchecked implementation tasks; no reconciliation required.

## Judgment-Day Arc

- **design**: REJECT (3 CRITICAL) → fix → APPROVED. Fixes folded in: native-only gate backend
  (`runGateNative` returns exit code; `runStep` Docker branch structurally unusable), gates-only
  zero-runner prologue guard (no `runners[0]` deref crash), named-error ordering (allowed-key set
  after `version`), loud-degrade extended to BOTH null base AND changedFiles throw, headless JSON
  as a NEW non-Ink branch.
- **slice 1**: clean — double-APPROVE.
- **slice 2**: clean.
- **slice 3**: CRITICAL signal-death false-green → fix → APPROVED. `runGateNative` maps a null
  child code (signal death) to `128+signum` or 1, so a signal-killed blocking gate cannot exit 0.
- **slice 4**: APPROVE → polish → APPROVED.

## Highest-Stakes Invariants — both confirmed impossible on merged main

- (a) Blocking / signal-killed gate → exit 0? **NO** — null code mapped to 128+signum/1;
  non-zero → blockingFailures → aggregate throw → exit 1; `collectGateOutcomes.exitCode=1` on
  blockingErrored||threw; dispatch `process.exit(result.exitCode)`. No render-boundary dependency.
- (b) scope:changed resolution failure → silently run as `all` or pass a blocking gate? **NO** —
  base-null and changedFiles-throw both resolve to `{kind:"skip",reason}`; gate SKIPPED (loud,
  reason in Ink + JSON), never re-run as all, phase never crashes.

## Deferred Follow-ups (promoted to docs/BACKLOG.md for visibility)

- **GATE-1** Docker-per-gate execution (JDA-001) — OUT OF SCOPE for v2; needs gate-image resolution.
- **GATE-2** No per-gate timeout (JDB-002).
- **GATE-3** Missing end-to-end dispatch→collector→process.exit seam test (JDB-102).
- **GATE-4** Monorepo changed-files repo-root relativity (documented, not solved).
- **GATE-5** Newline-in-path corruption in `$JAVI_FORGE_CHANGED_FILES` (JDB-103, accepted caveat).

## Specs Synced (source of truth)

| Domain | Action | Details |
|--------|--------|---------|
| ci-gates | Created | NEW capability promoted whole — 6 requirements (version:2 negotiation, gate schema/validation, execution phase + outcome semantics, scope:changed loud-degrade, ci validate extended, gate-run JSON) |
| ci-execution | Updated | 2 MODIFIED (step-id naming re-keyed IMPLICIT/EXPLICIT with R3 guard preserved; preserved-flag contract re-scoped v1-locked/v2-additive — JDA-003 fix) + 1 ADDED (B2 shell honors runner image/build-context). All ci-engine-unification content NOT touched by gates-v2 preserved. |

Post-merge, the live `openspec/specs/ci-execution/spec.md` is NO longer self-contradictory
(the blanket "no schema key / v1 locked" now explicitly scoped to v1, v2 additive).

## Artifact Traceability (engram observation IDs)

| Artifact | Topic | Engram ID |
|----------|-------|-----------|
| proposal | sdd/gates-v2/proposal | #13157 |
| design | sdd/gates-v2/design | #13168 |
| tasks | sdd/gates-v2/tasks | #13217 |
| verify-report | sdd/gates-v2/verify-report | #13390 |
| archive-report | sdd/gates-v2/archive-report | (this record) |

Filesystem artifacts (moved to `openspec/changes/archive/2026-08-09-gates-v2/`): exploration.md,
proposal.md, design.md, tasks.md, specs/ci-gates/spec.md, specs/ci-execution/spec.md,
review-ledger.md, verify-report.md, archive-report.md.

## SDD Cycle Complete

gates-v2 was planned, implemented across 4 stacked PRs, verified (PASS WITH WARNINGS, 0 CRITICAL),
and archived. Spec source of truth updated. Ready for the next change.
