# Archive Report — skillguard-hooks-ownership-doctor (Slice 2)

**Archived:** 2026-08-16
**Status:** COMPLETE — implemented, verified (PASS), merged to `main`, released in `javi-forge@1.29.0`.
**Amends:** `skillguard-pretooluse-hook` (Slice 1, also archived 2026-08-16).

## Summary

Slice 2 "Ownership & doctor" — the READ-ONLY side of managed Claude-hook recognition:
a pure `src/lib/claude-hook-settings.ts` (protocol-shape validation, asset-SHA-decoupled
canonical settings-entry identity, exact v0 legacy recognition, removal/merge planning)
and a read-only subset of `src/lib/claude-hook-manager.ts` (asset classification via
`safeReadFile`, the 9-state per-component classifier, and `doctorClaudePreToolUse` as a
library function + report struct). `manifest.settingsEntries.current` populated under an
append-only guard. No filesystem mutation (Slice 3), no CLI dispatch / init wiring (Slice 4).

## Delivery

- PR #55 → `main`, merged `9dbe96b9` (2026-08-16), size:exception (1736 product lines, approved).
- Released as `javi-forge@1.29.0` (npm + GitHub release + tag) alongside the Slice-1 runtime.

## Verification (see verify-report.md)

PASS clean: 8/8 requirements, 34/34 scenarios; all locked decisions confirmed; 0 CRITICAL/WARNING.
`review-risk` adversarial pass: 0 BLOCKER/CRITICAL (2 `info` defense-in-depth notes carried to design.md for the Slice-3 writer). `pnpm validate`/`test:coverage` (91.05/82.2)/`package:check` green.

## Locked decisions

Approach-1 two-module split (Slice 3 grows the manager); ① doctor = library (CLI + effective-execution matrix are Slice 4); ② canonical settings hash normalizes the live asset SHA token out.

## Spec sync

`specs/skillguard-hooks-ownership-doctor/spec.md` synced to `openspec/specs/skillguard-hooks-ownership-doctor/spec.md`.

## Remaining arc work

- **Slice 3** — transactional install/repair (the throwing seams in `claude-hook-manager.ts`).
- **Slice 4** — CLI dispatch (`hooks install/doctor/repair claude`), init wiring, effective-execution matrix.
- Slice-3 defense-in-depth notes recorded in this change's design.md (canonicalize drops unknown handler keys → structural not byte identity; `<ASSET_SHA256>` placeholder collision is inert).
