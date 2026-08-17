# Verify Report — skillguard-windows-secure-object (Slice 3b)

**Status: PASS** · CRITICAL: 0 · WARNING: 1 (documented residual)
**Verified:** 2026-08-17 · main `1795e9e5` · shipped in `javi-forge@1.31.0`

## Executive summary

Slice 3b (transactional install/repair on Windows via a digest-bound secure-object
`.ps1`) is spec-complete and correct. All 6 requirements / 18 scenarios map to
implementing code on `main` AND to test evidence — host-independent fake tests for the
agnostic core + win32 adapter, and the win32-gated integration test validated by the
real `windows-latest` CI job (**16/16 green** on the first-ever `.ps1` execution).
Design was APPROVED via 7-round judgment-day, empirically grounded against real
windows-latest ACLs. Delivered as 5 chained PRs #61-#65, merged via chain-collapse,
released 1.31.0.

## Note on a corrected verify finding

An automated sdd-verify pass raised a CRITICAL claiming the change was not in `main`.
That was a **false alarm from a stale local checkout** (the executor's read-only tools
could not `git fetch`, so it read a pre-merge `main`/`origin/main` ref at `ce2ba9e1`).
Ground truth verified after `git fetch`: `origin/main` = `1795e9e5`; the `.ps1`
(blob `6941d94b`) and `secure-fs-windows.ts` are present in `origin/main`; npm
`javi-forge` = `1.31.0`; tag `v1.31.0` = `1795e9e5`. The change IS in trunk and released.

## Requirement coverage (6/6 requirements, 18/18 scenarios — PASS)

- **R1** win32 `PlatformSecureFs` 11 methods + `proveManagedContainer`, fail-closed —
  `src/lib/secure-fs-windows.ts`; reparse/non-owner/exclusive-create/foreign-write/
  add-child/notFound scenarios proven by the 16-case win32 integration test (green CI).
- **R2** `selectSecureFs(win32)` wired, `_run` transactional — `secure-fs-posix.ts` win32
  branch; win32 mutates instead of `windows-secure-object-unavailable`. PASS.
- **R3** Digest binding tamper-evident — the on-disk `.ps1` sha256 ==
  `manifest.installerHelpers.windowsSecureObject.sha256` (`2289ef6a…`); tamper scenario F
  (0 spawns) green on CI; `pnpm package:check` enforces the `.ps1` ships. PASS.
- **R4** Guard test asserts the real binding (flipped from `null`) — `claude-hook-assets.test.ts`. PASS.
- **R5** Agnostic core + fake suite behavior-identical (additive only) — `runTransaction`
  untouched, no `process.platform` branch. PASS.
- **R6** Real `windows-latest` CI is the validation gate — `.github/workflows/claude-hook-windows.yml`
  ran the integration test **16/16** on the merge to main (PR #61 `runtime` check green). PASS.

## Gate results (exact, on main `1795e9e5`)

- `pnpm validate` — exit 0 · **2304 passed / 18 skipped** (106 files / 1 skipped).
- `pnpm test:coverage` — exit 0 · **Lines 91.43%** (≥85) · **Branches 81.85%** (≥80) ·
  Functions 91.63% · Statements 90.64%.
- The win32 integration test is SKIPPED on Linux by design (`describe.skipIf(process.platform !== "win32")`)
  and validated by the windows-latest CI (16/16) — the 18 skipped tests are expected, not a gap.

## Size gate

Pre-approved `size:exception`: PR #62 (win32 adapter ~831 product) and PR #63 (the `.ps1`
~1223). Per-commit granularity honored; ratified.

## Gaps / residuals

- **WARNING (documented residual, non-blocking)**: the REPARSE-4 identity-drift/TOCTOU
  scenario (a dir→junction swap between `openDir` and `revalidate`) is not scripted at
  runtime — the code path exists and the reparse-refusal surface is covered by REPARSE-1
  + ACL-9, but the mid-op swap needs an internal hook to script. Recorded, not silent.
- Accepted residuals (from design/JD): JDA6-002 (settings referencing an externally-deleted
  hook fails-to-load, no exec), JDB5-003(a) (contrived non-tool-created asset with a foreign
  file-ACE on settings-only = refuse-not-repair), elevated-runner current-user-owner-accept
  only synthesizable. Deferred: JDB5-003(b) asset re-capture on settings-only.

## Verdict

PASS. Change is in trunk (`1795e9e5`), released `1.31.0`, gates green, coverage over
floors, `.ps1` validated 16/16 on real Windows. Ready for `sdd-archive`.

Engram: `sdd/skillguard-windows-secure-object/verify-report`.
