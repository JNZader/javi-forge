# Archive Report — ci-engine-unification

**Change**: `ci-engine-unification` · **Repo**: `/home/javier/programacion/platform/javi-forge`
**Archived**: `2026-08-08` → `openspec/changes/archive/2026-08-08-ci-engine-unification/`
**Artifact store**: hybrid (filesystem + Engram) · **Final tree**: `main` @ `d58cdbb`
**Verification verdict**: PASS WITH WARNINGS — 0 CRITICAL, 3 WARNING (all resolved before archive), 2 SUGGESTION.
**Cycle status**: CLOSED.

## 1. Delivery

| Slice | Scope | PR | Merge SHA |
|---|---|---|---|
| 1 | Characterization safety net (ADDED tests only, zero production change) | #1 | `c9b5e66` |
| 2 | Executor collapse — `runLegacySteps` deleted, `runStep` the single leaf (net −17 production lines) | #2 | `c4ea116` |
| 3a | Hook assets + `manifest.json` + `HOOK_ASSETS_DIR` + guard tests (additive, zero runtime change) | #3 | `0eb9ce6` |
| 3b | Hook classification, backup, `--force`, packaging, inline-constant deletion | #4 | `d58cdbb` |

Releases cut along the way: **v1.7.1** (`da58083`), **v1.8.0** (`279e5f8`), **v1.9.0**.

**Tasks**: 48/48 complete (`[x]`), zero unchecked. Task Completion Gate PASSED with no stale-checkbox
reconciliation — no exceptional repair was needed or performed.

## 2. Adversarial verification — 10 judgment-day rounds

| Phase | Rounds | Outcome |
|---|---|---|
| design | 2 | REJECT → fix → APPROVED |
| slice 1 | 3 | 2 fix rounds → APPROVED |
| slice 2 | 2 | clean double-APPROVE, no fix round |
| slice 3a | 2 | APPROVE + post-round hardening (PURE-FILE forward-maintenance guard made append-only) |
| slice 3b | 2 | CRITICAL (exec bit lost on overwrite path) → fix → APPROVED |

The slice-3b CRITICAL is the headline catch: overwriting a non-executable hook left it at 0644 and
git skips a non-executable hook **silently**. The fix promoted "mode 0755 on EVERY write path" from
an implementation detail to a spec-level MUST (`ci-hook-install` → "Classify before write").

**Ledger census** (`review-ledger.md`): **48 fixed · 32 info · 2 superseded · 0 open**.

## 3. Specs merged into the source of truth

`openspec/specs/` was empty before this change, so both deltas were pure `ADDED Requirements` and were
promoted whole into new main specs (heading normalized from `## ADDED Requirements` to `## Requirements`;
every requirement and scenario carried over verbatim, nothing dropped, nothing invented).

| Domain | Action | Content |
|---|---|---|
| `ci-execution` | Created `openspec/specs/ci-execution/spec.md` | 7 requirements added, 0 modified, 0 removed |
| `ci-hook-install` | Created `openspec/specs/ci-hook-install/spec.md` | 9 requirements added, 0 modified, 0 removed |

Two sanctioned deviations are recorded in the archived artifacts rather than hidden:

1. **Task 1.10** — hooks are executed directly via their shebang (`spawn(hookPath)`), not through
   `sh <hook>`: the templates declare `#!/bin/bash` and use bash arrays, which dash cannot parse.
   Executing the file directly is what git actually does.
2. **Slice 3b** — one pre-existing assertion in `ci-init.integration.test.ts` ("overwrites existing
   hooks") was *inverted*, not weakened: it encoded exactly the clobbering behavior the new
   "No-clobber policy for foreign and edited hooks" requirement deletes. The "ADDED tests only" rule
   governs the executor collapse and cannot bind a test asserting behavior a spec in this same change
   reverses.

A third methodological correction worth carrying forward: the coverage gate was restated mid-flight
from absolute percentages to a **same-run delta** (`npx vitest run --coverage` on the merge-base then
on the slice head, same machine and session, `head >= base` on lines and branches, compared as
percentages). Absolutes were unusable — they are stale one commit later and swing by environment
because the Docker-gated integration suites run on a dev box and `skipIf` out in CI. All four slice
gates passed as deltas.

## 4. Deferred work — parked, not forgotten

Tracked in `docs/BACKLOG.md`, deliberately out of scope here:

`B1` (stack-override emits suffixed ids — frozen on purpose, not fixed) · `B2` · `B3` · `ENV-1` ·
`HOOKS-1` · `JF-DOCS-1` · `COV-1` (configured 80% branch floor already unmet on `main` at 77.97% —
pre-existing, orthogonal to the delta gate) · `COV-2` · `SEC-1` · follow-up `JDA7-012`.

Non-blocking suggestions from verification: **SUG-1** apply-progress records "362 files" (stale by one —
the parked `python.Dockerfile`); **SUG-2** `runSemgrep`/`runGhagga` keep their own top-level spawns
(pre-existing, never in scope) — name them explicitly when gates-v2 unifies skip semantics.

## 5. What this SDD unblocks

Two follow-up changes are now cheap because the seams exist and are documented:

1. **Fleet adoption of the richer `ci-local` hook content.** The versioned marker + manifest
   (`historical[]` with `firstCommit 5587b3b`) is exactly the mechanism that makes a content swap
   safe: every hook deployed by any released `ci init` classifies as `legacy-v0` (census: one
   historical variant per hook, byte-identical to HEAD), so an upgrade lands automatically across the
   ~8 consumer repos without a single refusal or a fleet brick. Adopting `ci-local/hooks/*` was
   explicitly forbidden *in this change* to keep it behavior-preserving; the next change is where it
   belongs.
2. **gates-v2**, on the documented seams: single executor phase list (`ci.ts:854`, iterated at `:879`),
   `runStep` as the only leaf (`ci.ts:913`, two call sites, both inside `runRunner`), exported
   `CIStepStatus` (`ci.ts:46`), config whitelist locked at version 1 (`ci-config.ts` untouched), and
   the `--json` precedent (`help.ts:133`, a global flag deliberately NOT wired into `ci`).

## 6. Traceability

**Filesystem (archived, audit trail — never modify)**:
`openspec/changes/archive/2026-08-08-ci-engine-unification/` — `exploration.md`, `proposal.md`,
`specs/ci-execution/spec.md`, `specs/ci-hook-install/spec.md`, `design.md`, `tasks.md`,
`review-ledger.md`, `verify-report.md`, `archive-report.md`.

**Engram observations** (project `javier`):

| ID | Artifact |
|---|---|
| 12890 | `sdd/ci-engine-unification/verify-report` |
| 12885 | `sdd/ci-engine-unification/apply-progress` (cumulative, all 4 slices) |
| 12886 | `ci-execution` spec — coverage no-regression restated as a same-run delta |
| 12884 | tasks — delta coverage gate + shebang fix |
| 12883 | `ci-hook-install` spec reconciled to the shipped `HOOK_STATE` vocabulary |
| 12882 | design — "Coverage Guard (R4)" restated as a same-run delta |
| 12881 | decision — slice-2 coverage gate = no-regression vs measured baseline |
| 12877 | slice 3a merged (PR #3) + automatic v1.7.1 release |

**Gap, stated honestly**: no Engram observation carries the topic keys
`sdd/ci-engine-unification/proposal`, `/spec`, `/design` or `/tasks`. In hybrid mode the filesystem
copies under `openspec/changes/archive/2026-08-08-ci-engine-unification/` are the canonical record for
those four artifacts; Engram holds the amendment-level observations listed above plus the
verify-report and this archive report. Nothing was lost — but a pure-Engram reader would not find the
original proposal/design/tasks by topic key.
