# Archive Report — skillguard-windows-secure-object (Slice 3b)

**Archived:** 2026-08-17
**Status:** COMPLETE — implemented, verified (PASS), merged to `main`, released in `javi-forge@1.31.0`.
**Amends:** `skillguard-transactional-install-posix` (Slice 3a) — the Windows half of the transactional install.

## Summary

Slice 3b activates the win32 secure-fs path: `selectSecureFs(win32)` now returns a real
adapter (was `null` / `windows-secure-object-unavailable`), so Claude-hook install/repair
runs transactionally and fail-closed on Windows with the same guarantees the POSIX slice
gives. The privileged ACL/owner/identity work is done by a packaged, digest-bound,
dependency-free PowerShell 5.1 helper (`assets/claude-hooks/javi-forge-windows-secure-object.ps1`)
invoked over a framed-stdin `HelperTransport` session; the TS side stays agnostic
(`runTransaction` gained no `process.platform` branch).

Key pieces:
- Agnostic core seam: `proveManagedContainer` (12th `PlatformSecureFs` method), the
  additive `notFound` refusal discriminator, and `ensureManagedContainer` with 4
  fail-closed branches (a present-but-unopenable managed container aborts the whole
  transaction; genuine ENOENT is the only safe skip).
- `src/lib/secure-fs-windows.ts` — win32 adapter over the injectable `HelperTransport`
  (`createPs1Session`: single `resolveBinding` + digest-verify-before-spawn, per-request +
  handshake timeout, close-terminal, idle watchdog gated on outstanding handles).
- The `.ps1` — Predicate A (object-type-aware path-endangering mask, `MapGenericMask`,
  INHERIT_ONLY skip, CREATOR OWNER owner-equivalent, TrustedInstaller owner-only), Predicate B
  (protected owner-only self-relative SD at `CREATE_NEW`), `proveManagedContainer`, delete-on-close
  `rmdir`, atomic rename + `FlushFileBuffers`, opaque identity, notFound status-2/3 only.
- Manifest digest binding + `package:check` enforcement + the windows-latest CI job.

## Design provenance

APPROVED via **7-round judgment-day** (two blind judges), the design converged as each
blocker narrowed: R1 (mode/held-handle/create-DACL/opaque) → R2 (ancestor-chain predicate
split into lenient runtime gate + strict creation) → R3 (real-`C:\` grants, inherit-only,
CREATOR OWNER, generic-mask) → R4 (repair-path managed-parent under-refusal → core seam) →
R5 (settings-only mirror → structural prove-every-run) → R6 (junction fail-open → notFound
discriminator) → R7 APPROVED. The pivot was **empirical grounding**: a throwaway
windows-latest probe captured the REAL ACLs (TrustedInstaller-owned `C:\` with
`Authenticated Users:FILE_ADD_SUBDIRECTORY`, inherit-only templates), validating the
predicate against reality instead of recalled ACLs.

## Delivery

5 chained PRs merged via **chain-collapse** (a GitHub 503 outage merged #64 out of order
mid-cascade; reconciled by re-syncing Phase 5 into branch-3 and verifying `...-1 tree ==
...-5 tree` before the final merge):
- #61 core seam · #62 win32 adapter (size:exception) · #63 `.ps1` (size:exception) ·
  #64 manifest binding + wiring + timeout gates · #65 windows CI + integration test.
- main `1795e9e5` · released `javi-forge@1.31.0` (single release, zero churn 1.30.1→1.31.0).

## Verification (see verify-report.md)

PASS: 6/6 requirements, 18/18 scenarios; `pnpm validate` green (2304 pass / 18 skip);
coverage 91.43 lines / 81.85 branches; digest binding tamper-evident. The `.ps1`'s
first-ever real execution passed **16/16** on windows-latest (transactional install +
idempotent, real `C:\` Predicate A, and every fail-closed refuse: JDA-401 / JDB5-001 /
JDA6-001 junction / foreign owner / raw GENERIC_WRITE·ALL / NULL DACL / reparse / non-dir /
exclusive-create / digest-tamper 0-spawns). Two CI-only fixes (NOT `.ps1` defects) to get
green: dropped Linux-only `package:check` from the win32 job (`/tmp` paths), and moved the
raw-SDDL fixture helper to pure .NET `SetAccessControl` (Get-Acl/Set-Acl fail to autoload
when powershell.exe 5.1 is spawned under the runner's pwsh 7).

## Locked decisions

Two-predicate split (lenient runtime gate = POSIX-analog, satisfiable by real ancestors;
strict creation posture for owned objects); TrustedInstaller trusted as ancestor-owner
only; digest-verify-before-spawn with a single binding resolution; framed-stdin session
with per-request timeout; `powershell.exe` 5.1 host.

## Spec sync

`specs/skillguard-transactional-install-windows/spec.md` (new capability) synced to
`openspec/specs/skillguard-transactional-install-windows/spec.md`.

## Residuals / follow-ups (non-blocking)

- REPARSE-4 identity-drift mid-op swap not scripted at runtime (surface covered by
  REPARSE-1 + ACL-9).
- JDA6-002 (settings referencing an externally-deleted hook fails-to-load, no exec);
  JDB5-003(a) (contrived non-tool-created asset with a foreign file-ACE on settings-only =
  refuse-not-repair); elevated-runner current-user-owner-accept only synthesizable.
- **Deferred**: JDB5-003(b) asset re-capture on settings-only.

## Remaining arc work

- **Slice 4** — CLI dispatch (`hooks install/doctor/repair claude`), init wiring, effective-execution matrix.
- **Linux/POSIX hardening arc** — revisit the shipped POSIX path (Slice 3a) with the
  structural lessons of this arc, as its own change.
- **Agent-agnostic arc** — OpenCode / Codex input-envelope + config adapters.
- Delete the grounding probe branch `feat/skillguard-windows-secure-object` (never merged).

## Engram traceability

- proposal/design: `sdd/skillguard-windows-secure-object/*`
- real-acl-ground-truth (#15384), review-ledger (#15398), apply-progress (#15410),
  apply-complete (#15430), verify-report (#15454), delivery (#15452)
