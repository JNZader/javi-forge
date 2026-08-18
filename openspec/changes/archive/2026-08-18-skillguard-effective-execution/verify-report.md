# Verify Report — skillguard-effective-execution (Slice 4b)

**Status: PASS** · CRITICAL: 0 (1 found + fixed) · WARNING: 0
**Verified:** 2026-08-18 · main `fbea6c4e` · shipped in `javi-forge@1.33.0`

## Executive summary

Slice 4b (the fail-closed effective-execution matrix) is spec-complete and correct.
`hooks doctor claude` now computes a real `execution: runnable | blocked | inconclusive`
verdict and gates its exit code 0/1/2, superseding 4a's honest `inconclusive` stub. All
requirements / 15 scenarios map to code + passing tests. Both review lenses (risk +
reliability) converged on one CRITICAL false-`runnable` path, which was fixed and
re-verified. Released 1.33.0. Slice-1/2/3 runtime + secure-fs untouched.

## Requirement coverage (2 req / 15 scenarios — PASS)

- **Blocking flags** — `disableAllHooks: true` (any readable source) / `allowManagedHooksOnly: true`
  (managed source only, INERT elsewhere per the merge model) → `blocked`, source in `blockers`.
  `scanExecutionFlags` (`claude-hook-settings.ts`, strict `=== true`); per-source probe in
  `claude-hook-manager.ts`.
- **Runnable** — only when every readable local source is clear AND the guard is
  `managed-current`; never promoted from an `unknown`. `probeExecution`.
- **Inconclusive (fail-closed)** — any unreadable (symlink/EACCES/io/too-large/binary),
  malformed-JSON, or unenumerable managed drop-in dir → `unknownSources` → `inconclusive`,
  NEVER clear. `probeExecutionSource` + the fixed `listManagedDropIns`.
- **Precedence-correct** — hooks MERGE; a higher-precedence file with unrelated keys does
  NOT block. Verified.
- **Exit gate** — runnable→0, blocked→1, inconclusive→2 (`claude-hooks.ts`); the 3 old 4a
  always-0/never-RUNNABLE stub tests rewritten to the new contract.
- **Renderer** — deterministic ordered output (status + blockers + unknownSources +
  residual caveats always shown); `execution.status` independent of `report.healthy`.
- **No CLI scraping** — reads static files only; never shells out to `claude`.

## Corrected model (verified vs official Claude Code docs)

Hooks MERGE across settings levels (do NOT override); only `disableAllHooks` /
`allowManagedHooksOnly` / safe-mode block a project hook. Server-delivered managed policy
+ `claude doctor`/`--debug` scraping are unreadable/unsupported → SUPERSEDED from the parent
design, always contributing `unknown` (rendered as a constant residual caveat).

## Review + the fixed CRITICAL

`review-risk` + `review-reliability` both flagged the SAME defect (convergent): `listManagedDropIns`
swallowed EVERY readdir error to `[]`, so an admin-locked `managed-settings.d/` (mode 0700)
holding a `disableAllHooks` drop-in read by a non-root doctor → false `runnable` (the one
prohibited outcome). FIXED: errno-discriminated (ENOENT/ENOTDIR→empty; any other→`unreadable`→
`unknownSources`→inconclusive) + a RED-proven regression test. `scoped re-review APPROVED`;
no new false-runnable, no over-refusal.

## Gate results

- CI (authoritative): the merge to main → `test` + `runtime` + Cloudflare all green; release ran → 1.33.0.
- Local: the 4b slice tests (settings + manager-execution + command) — **100 passed** on main;
  strict TDD RED→GREEN per group; coverage 91.64 lines / 82.22 branches (≥85/80... lines 91.64≥85, branches 82.22≥80).
- Known non-issue: `src/e2e/aggressive.e2e.test.ts` fails LOCALLY (TTY/Ink stale-`dist` artifact,
  unrelated to this slice) — passes in CI (which builds `dist` fresh).

## Size gate

`size:exception` — ~888 total changed lines (product ~331 < 400; the rest is the essential
15-case verdict-matrix test coverage). Single PR (#67) per the design's call.

## Verdict

PASS. In trunk (`fbea6c4e`), released `1.33.0`, CI green, the convergent CRITICAL fixed +
re-verified, no false-`runnable` path. Ready for `sdd-archive`.

Engram: `sdd/skillguard-effective-execution/verify-report`.
