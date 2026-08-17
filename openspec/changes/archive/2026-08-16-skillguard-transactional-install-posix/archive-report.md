# Archive Report — skillguard-transactional-install-posix (Slice 3a)

**Archived:** 2026-08-16
**Status:** COMPLETE — implemented, verified (PASS), merged to `main`, released in `javi-forge@1.30.0`.
**Amends:** `skillguard-hooks-ownership-doctor` (Slice 2) / `skillguard-pretooluse-hook` (Slice 1), both archived 2026-08-16.

## Summary

Slice 3a "Transactional install/repair" — the MUTATION side of managed Claude-hook
management, on an agent-agnostic POSIX secure-fs foundation. It grows the throwing Slice-2
seams into real, atomic, fail-closed install/repair:

- `src/lib/secure-fs-transaction.ts` (NEW) — agent-agnostic `PlatformSecureFs` interface +
  `runTransaction`: parent-chain ownership/mode gate, timestamped backups, staged writes,
  asset-then-settings rename ordering, guarded rollback that STOPs on lost proof.
- `src/lib/secure-fs-posix.ts` (NEW) — Linux `getfacl` / macOS `/bin/ls -lde` adapters,
  fail-closed; `selectSecureFs(platform)` returns null on win32.
- `src/lib/__fixtures__/fake-secure-fs.ts` (NEW) — host-independent fake for tests.
- `src/lib/claude-hook-settings.ts` — write-plan helpers `planLegacyCohortExcision`,
  `planForceReplace` (keyed on `matcherExact` per §324 / JD-A-001), `buildManagedContainer`,
  `deepStructuralEqual`; exported `MANAGED_MATCHER` / `LEGACY_COHORT`.
- `src/lib/claude-hook-manager.ts` — internal `_run(projectDir,mode,options,deps)` seam +
  public `installClaudePreToolUse` / `repairClaudePreToolUse` + `report` on
  `ClaudeHookMutationResult`; Windows → `windows-secure-object-unavailable`.

Still deferred: Slice 3b (Windows secure-object `.ps1` helper + manifest binding + Windows
CI job) and Slice 4 (CLI dispatch `hooks install/doctor/repair claude` + init wiring +
effective-execution matrix).

## Delivery

- 4 chained PRs #57 (settings-helpers) → #58 (posix-adapter) → #59 (transaction-engine,
  `size:exception`) → #60 (manager-wiring), merged to `main` via **chain-collapse (option B)**:
  merged top-down into the feature bases (0 releases), then #57→main once → a **single**
  release. main HEAD `e0b5409b`. All 4 PRs show MERGED; version churn = 0.
- Released as `javi-forge@1.30.0` (npm + GitHub release + tag).

## Verification (see verify-report.md)

PASS: 8/8 requirements, 19/19 scenarios; JD-A-001 confirmed in code; post-apply Judgment Day
(two blind judges) APPROVED / CONFIRMED-CLOSED. Gates on main HEAD: `pnpm test` 2235 pass /
2 skip / 0 fail; coverage 91.35 lines / 81.67 branches; `tsc` clean (src + test); `pnpm lint`
exit 0 (8 non-failing warnings); `pnpm package:check` exit 0 (385 files). Manifest/package.json
inert (only the 1.29.0→1.30.0 bump; `windowsSecureObject` still null).

## Locked decisions

Agent-agnostic split (policy core + secure-fs infra are agnostic; POSIX adapter is the first
platform binding); `planForceReplace` refuses only when the matcher is EDITED AND siblings>0
(§324 / JD-A-001); rollback STOPs on lost ownership proof rather than proceeding blind;
asset-then-settings rename ordering so a crash never leaves settings pointing at a missing asset.

## Size

Full-slice `src/` diff (`5842f376~1..e0b5409b`): 2799 insertions / 11 files (~3x the ~915-line
forecast). Per-commit granularity honored (all commits ≤398 lines). Total `size:exception`
explicitly ratified by the user after the code-vs-test breakdown (the 4-PR split was the
deliberate response to the overage).

## Spec sync

`specs/skillguard-transactional-install-posix/spec.md` (plain spec, new capability, no delta
markers) synced to `openspec/specs/skillguard-transactional-install-posix/spec.md`.

## Non-blocking backlog (carried forward)

- **JD-B-001** `secure-fs-transaction.ts:506` — rollback restore `renameInDir` result unchecked; append STOP on restore-rename failure.
- **JD-B-002** `secure-fs-posix.ts:274-296` — `captureFile` should assert `S_ISREG`.
- **LINT-001** remove unused `repairClaudePreToolUse` import in `claude-hook-manager.test.ts:22`.

## Remaining arc work

- **Slice 3b** — Windows secure-object `.ps1` helper + manifest binding + Windows CI job.
- **Slice 4** — CLI dispatch (`hooks install/doctor/repair claude`), init wiring, effective-execution matrix.
- **Agent-agnostic arc** — OpenCode / Codex input-envelope + config adapters (after the Claude arc completes).

## Engram traceability

- proposal/design/tasks: `sdd/skillguard-transactional-install-posix/*`
- verify-report: `sdd/skillguard-transactional-install-posix/verify-report` (#15333)
- delivery: `sdd/skillguard-transactional-install-posix/delivery` (#15332)
- archive-report: `sdd/skillguard-transactional-install-posix/archive-report`
