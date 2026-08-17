# Verify Report — skillguard-transactional-install-posix (Slice 3a)

**Status: PASS** (both original WARNINGs closed by orchestrator gate runs) · CRITICAL: 0
**Verified:** 2026-08-16 (post-merge; shipped in `javi-forge@1.30.0`, main HEAD `e0b5409b`)

## Executive summary

Slice 3a (transactional install/repair on a POSIX secure-fs foundation) is
spec-complete and correct. All 8 requirements / 19 scenarios map to implementing code
in the merged `main` tree AND to passing runtime tests. Delivered as 4 chained PRs
(#57–#60), merged via chain-collapse (option B) → a single release `1.30.0`. Post-apply
Judgment Day (two blind judges) already APPROVED / CONFIRMED-CLOSED the full slice.

## Requirement coverage (8/8 requirements, 19/19 scenarios — all PASS)

| Req | Implementation | Test evidence |
|---|---|---|
| R1 state→action matrix | `resolveAssetPlan`/`resolveSettingsPlan` `src/lib/claude-hook-manager.ts:444-521` | `claude-hook-manager.test.ts` + `claude-hook-manager.run.test.ts` (full matrix via fake `_run` seam) |
| R2 parent-chain gate | `gate()`/`gateStillValid()` `secure-fs-transaction.ts:255-296`; `proveOwnershipAndMode`/`openDirNoFollow` `secure-fs-posix.ts` | `secure-fs-transaction.test.ts` + `secure-fs-posix.test.ts` |
| R3 atomic write + backups | `runTransaction` capture/backup/stage `secure-fs-transaction.ts:298-364`; `writeBackup()` :430-458 | `secure-fs-transaction.test.ts` |
| R4 guarded rollback | `rollback()` `secure-fs-transaction.ts:460-513`, STOP-on-lost-proof :466-482 | `secure-fs-transaction.rollback.test.ts` |
| R5 settings merge fidelity | `applySettingsPlan`/`serializeSettings` `claude-hook-manager.ts:539-576` | `claude-hook-settings.test.ts` + manager tests |
| R6 Windows deferral | `selectSecureFs` null on win32 `secure-fs-posix.ts:395-402`; refuse `windows-secure-object-unavailable` `claude-hook-manager.ts:600-608` | `claude-hook-manager.test.ts:388` |
| R7 result contract | `ClaudeHookMutationResult.report` `claude-hook-manager.ts:406-412` | populated on every returned path |
| R8 host-independent testability | `src/lib/__fixtures__/fake-secure-fs.ts` (225 lines) | all engine/manager tests driven through the fake |

**JD-A-001 confirmed** (`claude-hook-settings.ts:565-589`): `matcherExact` → eligible
regardless of siblings; matcher edited + `siblingHandlers===0` → eligible; matcher edited
+ `siblingHandlers>0` → refused. Matches §324 / design Decision 8 exactly.

## Gate results (exact numbers, run on main HEAD `e0b5409b`)

- `pnpm test` (vitest): **105 files, 2235 passed, 2 skipped, 0 failed**.
- coverage: **Lines 91.35%** (≥85) · **Branches 81.67%** (≥80) · Statements 90.62% · Functions 91.94%. Exit 0.
- `npx tsc --noEmit`: exit 0. `tsc --project tsconfig.test.json --noEmit`: exit 0.
- **`pnpm lint` (biome): exit 0** — 8 non-failing warnings (see below).
- **`pnpm package:check`: exit 0** — 385 files (114 js, 114 declarations, 63 templates, 54 modules, 8 workflows).

### Lint warnings (8, all non-failing, exit 0)

- 7 pre-existing / intentional in test fixtures: 6× `noTemplateCurlyInString` (tests use
  literal `${...}` to exercise the guard's `${}` parsing) + 1× `noExplicitAny` already
  suppressed with `biome-ignore` (test-double signature).
- 1 slice-introduced, trivial: `noUnusedImports` on `claude-hook-manager.test.ts:22`
  (`repairClaudePreToolUse` imported unused). → backlog cleanup (batch with JD-B-001/002),
  not release-worthy on its own.

## Size gate

Full-slice `src/` diff (`5842f376~1..e0b5409b`): **2799 insertions across 11 files** — ~3x
the ~915-line design forecast. Per-commit granularity honored (largest single commit 398
lines; all 9 commits ≤398). The cumulative total exceeds the originally-framed per-PR
`size:exception` (#59 ~980). **User ratified the total by choosing the 4-PR split** after
being shown the code-vs-test line breakdown (the split was the deliberate response to the
3x overage). Recorded as accepted size:exception for the full slice.

## Package/manifest inertness (G.7) — confirmed

`git diff 5842f376~1 e0b5409b -- package.json manifest.json assets/claude-hooks/manifest.json`:
only the semantic-release bump (1.29.0→1.30.0); `installerHelpers.windowsSecureObject`
still `null`; no dependency added.

## Task reconciliation

All 14 tasks + 8 gates (G.1–G.8) in `tasks.md` checked `[x]`; every checkbox traces to a
concrete merged artifact. No stale/false checkmarks.

## Non-blocking backlog (pre-known, confirmed still open)

- **JD-B-001** `secure-fs-transaction.ts:506` — rollback restore `renameInDir` result
  unchecked; append STOP on restore-rename failure.
- **JD-B-002** `secure-fs-posix.ts:274-296` — `captureFile` should assert `S_ISREG`.
- **LINT-001** remove unused `repairClaudePreToolUse` import in `claude-hook-manager.test.ts:22`.

## Verdict

PASS. Correctness sound; both governance WARNINGs from the sdd-verify pass closed
(lint + package:check re-run green by orchestrator; size total ratified via the 4-PR
choice). Ready for `sdd-archive`.

Engram: `sdd/skillguard-transactional-install-posix/verify-report` (#15333).
