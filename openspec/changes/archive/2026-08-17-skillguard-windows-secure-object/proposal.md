# Proposal: SkillGuard Windows Secure-Object Binding (Slice 3b)

## Intent

Slice 3a shipped transactional install/repair on an agent-agnostic POSIX secure-fs (released 1.30.1), but the win32 path refuses with `windows-secure-object-unavailable` (`claude-hook-manager.ts:600-608`) because `selectSecureFs(win32)` returns `null` (`secure-fs-posix.ts:401-408`). Windows users get no fail-closed install/repair. Slice 3b delivers the Windows analog with the same supply-chain and fail-closed guarantees the POSIX adapter provides.

## Scope

### In Scope
- Packaged, dependency-free `assets/claude-hooks/javi-forge-windows-secure-object.ps1` (ACL proof + exclusive create + explicit DACLs + FlushFileBuffers).
- Win32 `PlatformSecureFs` (all 11 methods, `secure-fs-transaction.ts:54-119`); wire `selectSecureFs(win32)` to return it.
- Manifest binding `installerHelpers.windowsSecureObject:{name,sha256}` (currently `null`); flip guard test `claude-hook-assets.test.ts:61`; extend `scripts/verify-package-contents.mjs` / `pnpm package:check` for the `.ps1` (fail on omission or hash mismatch).
- Windows CI job on the existing `windows-latest` lane (`.github/workflows/claude-hook-windows.yml`) running win32 secure-fs + manager tests with real DACL/reparse-point/network-path behavior.
- Keep `runTransaction` untouched/agnostic; agnostic core tested via the existing fake, win32-specific behavior via the real runner.

### Out of Scope
- CLI dispatch (`hooks install/doctor/repair claude`), init wiring, effective-execution matrix — deferred to Slice 4.
- OpenCode/Codex agent-agnostic adapters — separate later arc.

## Scope Decision

- **Mode**: Selective
- **Justification**: The four pieces are the minimal high-value slice that closes the win32 fail-closed gap while inheriting the already-locked `.ps1`/manifest shape; Slice 4 (CLI/init) is real but lower-leverage and correctly deferred.

## Capabilities

### New Capabilities
- `skillguard-transactional-install-windows`: win32 secure-object helper + `PlatformSecureFs` adapter, manifest digest binding, package gate, and real-runner CI.

### Modified Capabilities
- None (POSIX capability and `runTransaction` stay untouched).

## Approach

Approach 1 (locked by parent + 3a designs): bundled digest-bound `.ps1` no-dependency helper invoked via `child_process`, sha256-bound in `manifest.json` exactly like the `.mjs`. Rationale (from explore): only option consistent with 3a Decision 1 ("one place a shell tool runs") and Decision 2 (never degrade silently); symmetric supply-chain story; testable with the same synchronous fake plus a real-Windows-runner job. Approaches 2 (native addon) and 3 (weaker guarantee) were rejected in exploration.

## Design-Phase Open Questions (do NOT resolve here)

1. Windows ACL-clean predicate — NT has no "ACL absent" state; needs a fail-closed analog to POSIX Decision 2 (inheritance flags, explicit-vs-inherited ACEs, trusted-SID set).
2. Invocation protocol — per-call spawn vs one framed-stdin session process per transaction; CI-latency and fault-injection tradeoff.
3. Empirical verification on the real `windows-latest` runner that FlushFileBuffers-on-directory-handle substitutes for POSIX fsync-parent, and that `FILE_FLAG_OPEN_REPARSE_POINT` refuses symlinks/junctions like `O_NOFOLLOW`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `assets/claude-hooks/javi-forge-windows-secure-object.ps1` | New | Windows secure-object helper |
| `src/lib/secure-fs-windows.ts` | New | win32 `PlatformSecureFs` |
| `src/lib/secure-fs-posix.ts:401-408` | Modified | Add win32 branch to `selectSecureFs` |
| `assets/claude-hooks/manifest.json` | Modified | Flip `windowsSecureObject` null → `{name,sha256}` |
| `src/__tests__/claude-hook-assets.test.ts:61` | Modified | Assert real sha256 binding |
| `scripts/verify-package-contents.mjs` | Modified | Add `.ps1` to REQUIRED_FILES |
| `.github/workflows/claude-hook-windows.yml` | Modified | Add win32 secure-fs/manager job |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Fail-closed win32 behavior only verifiable on `windows-latest` (dev box is Linux); inspection insufficient | High | Mandatory real-runner CI job asserting DACL/reparse/flush behavior before merge |
| ACL-clean predicate mis-modeled (no "absent ACL" state) | Med | Design-phase decision + real-runner assertions |
| `claude-hook-assets.test.ts:61` still pins `null` → change looks green while shipping nothing | Med | Flip the guard test first |

## Rollback Plan

Revert the `selectSecureFs` win32 branch to `null` and restore `manifest.json` `windowsSecureObject:null` + the `:61` guard. POSIX behavior and `runTransaction` are untouched, so win32 returns to `windows-secure-object-unavailable` (current, safe fail-closed state). No data migration involved.

## Dependencies

- Slice 3a POSIX secure-fs / `runTransaction` (merged, released 1.30.1).
- Existing `windows-latest` CI lane.

## Success Criteria

- [ ] `selectSecureFs(win32)` returns a working `PlatformSecureFs`; `_run` mutates transactionally instead of refusing.
- [ ] `.ps1` present, digest-bound in manifest, enforced by `pnpm package:check`; `claude-hook-assets.test.ts` asserts the real sha256.
- [ ] Windows CI job green on real `windows-latest` proving DACL/reparse/flush fail-closed behavior.
- [ ] `runTransaction` unchanged; agnostic core still passes via the fake.
