# Proposal: SkillGuard Transactional Install/Repair (POSIX write path)

## Decision

Amend `skillguard-pretooluse-hook` with **Slice 3a ("Transactional install/repair", POSIX write path)**: implement the two throwing seams `installClaudePreToolUse` / `repairClaudePreToolUse` (`src/lib/claude-hook-manager.ts:403-414`) as a real, idempotent, transactional write path on Linux and macOS, driven by the Slice-2 9-state classifier and the design's state→action matrix. A dedicated `src/lib/secure-fs-transaction.ts` owns staging/backup/rename/rollback behind a `PlatformSecureFs` adapter interface; the manager stays a thin orchestrator (classify via Slice 2 → plan via Slice-2 pure planners → run the transaction). The POSIX ACL/parent-chain adapters are implemented here; the Windows secure-object implementation is **defined-but-deferred** to Slice 3b. No CLI dispatch, no init wiring, no effective-execution matrix, no uninstall command.

## Relationships and Delivery

- `amends: skillguard-pretooluse-hook`; `depends-on:` Slices 1 (runtime MJS + manifest) and 2 (read-only classifier + doctor + pure planners), both merged to `main` and released in javi-forge@1.29.0; never supersedes or resets parent review/attempt history.
- 3a/3b sub-split of the design's single "Transactional install/repair" slice (design.md:530, forecast 720-800 lines — realistically >800). **3a = POSIX write path** (this change). **3b = `skillguard-transactional-install-windows`** (separate later change): the Windows secure-object `.ps1` helper + `installerHelpers.windowsSecureObject` manifest binding + `package:check` gate + `windows-latest` `manager` CI job + DACL/reparse/network refusal tests.
- Chained PR, base off current `main`. Forecast **~600-780 changed lines** (transaction module + POSIX adapters + manager wiring + injected-seam fault tests, tests included); each work unit `<400` lines, PR `<800`. Splitting POSIX from Windows is the entire point of the sub-split; if 3a still forecasts >800 before implementation review, split the fault-test suite with its owning behavior rather than compress transactional safety — flag it as a size decision, do not silently breach.
- Slice 4 (CLI dispatch, `init` rewiring, effective-execution matrix, `hooks uninstall`) remains blocked on this slice's mutation primitive; Slice 3b remains blocked on the `PlatformSecureFs` interface this slice defines.

## Why

Slice 2 shipped exact-state recognition but left both mutation seams throwing `unimplemented: Slice 3 transaction`. Nothing can install, upgrade, migrate, or repair the managed guard yet — the read side proves ownership, the write side does not exist. Slice 3a is the load-bearing mutation primitive: without a tested, idempotent, ownership-safe POSIX transaction (held-handle parent-chain gate + same-directory exclusive backups + temp/fsync/exact-mode/rename + guarded reverse-order rollback), Slice 4 would have no safe operation to dispatch and the arc's core promise — never clobber a user's Claude settings or assets — would be unbacked on the platforms where most consumers run today.

Splitting POSIX from Windows keeps the irreversible-I/O change reviewable inside the 800-line budget and lets the host-independent transaction core plus the two POSIX adapters land and be exercised by injected-seam fault tests before the Windows secure-object helper (its own packaging, CI job, and DACL threat model) is introduced.

## What Changes — In Scope

- **New `src/lib/secure-fs-transaction.ts`** owning the transaction machinery (staging, same-directory exclusive backups, atomic temp+fsync+rename, guarded reverse-order rollback, transaction-created-directory cleanup) behind a **`PlatformSecureFs` adapter interface**. The manager remains the orchestrator: Slice-2 `classifyAssetState` / `classifySettingsFile` → Slice-2 pure planners (`planManagedClaudeHookMerge`, `planManagedClaudeHookRemoval`, `canonicalizeSettingsEntry`) → transaction. Slice-2 code **grows in place**; it is not relocated.
- **`installClaudePreToolUse` / `repairClaudePreToolUse`** implemented over the full design state→action matrix, per component (asset + settings-entry): `absent`→install, `released-outdated`→upgrade, `exact-legacy`→migrate the complete proven cohort only, `edited-managed`→refuse (repair `--force` only after a byte-exact eligible backup), `foreign`/`symlink`/`non-regular`/`malformed`/partial-legacy→refuse untouched, `managed-current`→idempotent no-op with **zero write** (bytes + mtime preserved).
- **Parent-chain gate (POSIX)**: held no-follow (`O_DIRECTORY|O_NOFOLLOW`) directory handles from root through each target parent; `dev`+`ino` identity captured on handle and revalidated on reopened path immediately before and after every pathname mutation; effective-uid-or-root ownership with no group/other write bits on every controlling directory; POSIX ACL adapter proof. One-segment-at-a-time exclusive `.claude`/`.claude/hooks` creation at mode `0o700` (never blind recursive mkdir), each opened/verified/held before use.
- **POSIX ACL adapters only**: Linux `getfacl --absolute-names --numeric --omit-header` (locale `C`, bounded timeout); macOS `/bin/ls -lde` (locale `C`, bounded timeout). Fail-closed on tool-absent, parse error, unsupported-filesystem result, any named user/group / `mask::` / `default:*` / inherited ACL entry, or output change during preflight → `unsupported-posix-acl` / `unsafe-parent-chain` refusal before target mutation. Never degrade to mode-only preservation, never strip an ACL.
- **Same-directory exclusive backups**: `<original-basename>.javi-forge.bak.<YYYYMMDDTHHMMSSmmmZ>.<8-lowercase-hex>`, created with `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` at mode `0o600`, bounded 8-candidate nonce retry, bytes not written before restrictive creation succeeds; backup contains complete prior bytes at the exact source mode with proven ACL absence, access never broader than source.
- **Atomic write + commit + rollback**: same-directory `<basename>.javi-forge.tmp.<pid>.<8hex>` exclusive/no-follow at `0o600` → write → `handle.sync()` → apply exact prior mode → verify mode + ACL absence → sync metadata → revalidate held chain → same-directory rename → parent `fsync`. Commit **asset first, settings second**. Guarded reverse-order rollback that restores prior bytes/mode (or unlinks a previously absent target) and removes only identity-matched empty transaction-created directories, and **stops for manual recovery on lost proof / concurrent post-write change**.
- **Reconcile `ClaudeHookMutationResult`**: add the `report: ClaudeHookDoctorReport` field the design interface carries (design.md:411-417) but the Slice-2 stub (`claude-hook-manager.ts:396-401`) omits; install/repair return it.
- **Injectable seams for host-independent tests**: clock, 8-hex nonce, the `PlatformSecureFs` adapter, and fs-fault injection points — so identity/ACL/tool/handle/rename faults are exercised deterministically without root or a special host.
- **Reuse** Slice-2 pure planners + `safe-read.ts` `safeReadFile`; settings re-serialized 2-space + trailing newline preserving unrelated keys/order (Decision 6); expose the tested transaction primitive and reuse `planManagedClaudeHookRemoval` (Decision 7) — but ship **no** uninstall dispatch.

## Non-Goals

- The Windows secure-object `.ps1` helper implementation, `installerHelpers.windowsSecureObject` manifest binding, `assets/claude-hooks/javi-forge-windows-secure-object.ps1` creation/hashing, the `package:check` gate for it, and the `windows-latest` `manager` CI job + DACL/reparse/network refusal tests → **Slice 3b (`skillguard-transactional-install-windows`)**. On Windows in 3a, install/repair refuses with a clear `windows-secure-object-unavailable` (or `unsafe-parent-chain`) until 3b lands; the `PlatformSecureFs` interface is defined here, its Windows implementation is not.
- Any CLI dispatch route (`javi-forge hooks install/doctor/repair claude`), `src/cli/dispatch/hooks.tsx` / `help.ts` changes, `javi-forge init` rewiring (`src/commands/init/steps/security.ts`), the effective-execution RUNNABLE/BLOCKED/INCONCLUSIVE matrix + policy-source inventory, and any `hooks uninstall claude` command → **Slice 4**.
- Per-skill attribution; governing unknown / MCP / Web tools; any change to the Slice-1 runtime policy corpus or the Slice-2 read-only classifier/doctor semantics.

## Scope Decision

- **Mode**: Reduction.
- **Justification**: The incoming scope is the design's single "Transactional install/repair" slice, which the exploration forecasts at 720-800 lines and realistically >800 once the Windows secure-object helper, its packaging, its CI job, and its DACL threat model are counted — a defendable breach of the 800-line review budget for irreversible-I/O code. Rather than accept it whole or request a size exception, this proposal **reduces** 3a to the POSIX write path plus the platform-agnostic transaction core and the `PlatformSecureFs` interface, and carves the entire Windows surface into a separately-scoped follow-on (3b). POSIX install/repair is complete and idempotent on its own; deferring Windows does not leave a half-working platform — it refuses cleanly and reversibly until 3b. The reduction is the mechanism that keeps a security-sensitive mutation change reviewable, not a deferral of required safety.

## Installed-Consumer Impact

Library-only mutation primitive with no public dispatch. Global linuxbrew/npm consumers and the ~8 Git-hook repositories are **not** auto-rewritten and see no behavior change until Slice 4 wires init/CLI. Adding `report` to `ClaudeHookMutationResult` changes an interface introduced in Slice 2 that has no runtime callers yet (the seams throw), so no consumer of the result shape exists to break. POSIX hosts lacking `getfacl` / `/bin/ls -lde` or on shared/group-writable parent trees get a safe refusal with actionable remediation, never a weaker write.

## Risks and Rollback

| Risk | Level | Mitigation |
|---|---|---|
| Settings or local assets clobbered during a partial two-target transaction | High | Full parent-chain preflight, exact ownership, structural merge, asset-first/settings-second commit, backup-before-force, guarded reverse-order rollback that stops on lost proof. |
| Parent swap-out/swap-back or ACL loss redirects/broadens a replacement | High | Held no-follow directory handles + `dev`+`ino` revalidation around every mutation, private-chain gate (effective-uid/root, no group/other write), POSIX ACL adapter refusing any extended/inconclusive state; documented as the boundary, not portable dirfd-relative atomicity. |
| Windows path silently no-ops or half-writes without the secure-object helper | High | 3a refuses on Windows with `windows-secure-object-unavailable`/`unsafe-parent-chain` before any mutation; the helper + DACL tests are a hard prerequisite in 3b. |
| Transaction core diverges from Slice-2 recognition / Slice-4 dispatch | Med | Manager stays a thin orchestrator over Slice-2 planners; transaction is a dedicated module behind `PlatformSecureFs`; no classifier logic duplicated. |
| ACL/host-dependent behavior makes tests flaky or host-bound | Med | Clock, nonce, `PlatformSecureFs` adapter, and fs-fault points are injectable; adapter fault tests never skip; real-ACL fixture tests skip only when the host lacks the capability. |
| 3a still breaches the 800-line budget | Med | Forecast ~600-780 with Windows carved out; if it approaches 800 before review, split the fault-test suite with its owning behavior and flag a size decision — never defer safety tests to an unprotected PR. |

**Rollback**: revert only this child — restore the two seams to their throwing stubs, remove `src/lib/secure-fs-transaction.ts` + its tests, revert the `report`-field addition to `ClaudeHookMutationResult`, and drop the manager wiring. No parent history, Slice-1 runtime, or Slice-2 recognition/doctor is touched. Because no public dispatch or init wiring exists yet, no installed project can have been mutated through this slice.

## Success Criteria

- [ ] `installClaudePreToolUse` / `repairClaudePreToolUse` implement the full state→action matrix per component; `managed-current` is a byte- and mtime-exact zero-write no-op.
- [ ] POSIX install/repair is idempotent: re-running on current content performs no write; absent→install, released-outdated→upgrade, exact-legacy→migrate the complete cohort only, edited-managed→refuse (force only after eligible byte-exact backup), foreign/symlink/non-regular/malformed/partial-legacy→refuse untouched.
- [ ] Parent-chain gate refuses unsupported/untrusted-writable chains and any POSIX ACL state it cannot prove safe (`unsafe-parent-chain` / `unsupported-posix-acl`) before target mutation; backups/replacements never discard an extended ACL or broaden access.
- [ ] Backups follow the exact `<base>.javi-forge.bak.<ISO-ms>.<8hex>` naming, are created `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` 0o600 with nonce retry, and contain complete prior bytes at exact source mode.
- [ ] Atomic write path (temp → fsync → exact-mode → rename → parent fsync, asset-first/settings-second) and guarded reverse-order rollback are exercised by injected fs-fault tests; rollback stops on lost proof.
- [ ] `ClaudeHookMutationResult` carries `report: ClaudeHookDoctorReport`; install/repair return it.
- [ ] `PlatformSecureFs` interface is defined; POSIX (Linux `getfacl`, macOS `/bin/ls -lde`) adapters implemented; Windows refuses cleanly with `windows-secure-object-unavailable`/`unsafe-parent-chain`.
- [ ] Slice-2 pure planners and `safeReadFile` are reused; settings re-serialized 2-space + trailing newline preserving unrelated keys/order.
- [ ] No CLI dispatch, init wiring, effective-execution matrix, uninstall command, or Windows secure-object helper/packaging/CI is introduced.
- [ ] Clock, nonce, `PlatformSecureFs`, and fs-fault points are injectable so the suite runs host-independently without root.

## Open Questions

None blocking — the load-bearing decisions are locked from exploration: **Approach 2** (dedicated transaction module + `PlatformSecureFs`, manager as thin orchestrator), the **3a/3b POSIX-vs-Windows sub-split**, the **`report`-field reconciliation**, and **no uninstall dispatch** (Decision 7). To confirm during spec/design: the exact refusal-reason token for the Windows-deferred path (`windows-secure-object-unavailable` proposed here vs. reusing `unsafe-parent-chain`), to be settled without widening 3a scope.
