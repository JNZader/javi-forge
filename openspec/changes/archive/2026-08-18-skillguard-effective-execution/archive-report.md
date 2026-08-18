# Archive Report — skillguard-effective-execution (Slice 4b)

**Archived:** 2026-08-18
**Status:** COMPLETE — implemented, verified (PASS), merged to `main`, released in `javi-forge@1.33.0`.
**Amends:** `skillguard-pretooluse-hook` (the doctor gains the `execution` verdict; completes the honest stub deferred by Slice 4a).

## Summary

Slice 4b replaces Slice 4a's honest `execution: inconclusive` doctor stub with a real
FAIL-CLOSED effective-execution matrix. `hooks doctor claude` now answers "does the managed
PreToolUse guard actually run?" with `runnable | blocked | inconclusive`, gates its exit
code 0/1/2, and lists the blockers / unknown sources / residual caveats so the reason is
visible. A false `runnable` is the one prohibited outcome.

Pieces:
- `src/lib/claude-hook-settings.ts` — pure `scanExecutionFlags` (strict `=== true`) for
  `disableAllHooks` / `allowManagedHooksOnly`.
- `src/lib/claude-hook-manager.ts` — `probeExecutionSource` (ENOENT→clear; everything
  unreadable/malformed→unknown, never clear), `resolveManagedSettingsPaths` (macOS/Linux/
  Windows + `managed-settings.d`), `listManagedDropIns` (errno-discriminated), `probeExecution`
  (verdict precedence blocked>inconclusive>runnable; guard-currency gate; server-policy +
  safe-mode as constant residual caveats). `execution` on `ClaudeHookDoctorReport`,
  independent of `report.healthy`.
- `src/commands/claude-hooks.ts` — deterministic render + exit gate (supersedes 4a's always-0).

## Corrected model (verified against official docs, not memory)

Hooks MERGE across settings levels — a project hook is NOT shadowed by higher-precedence
files; only `disableAllHooks` / `allowManagedHooksOnly` / safe-mode block it. Server-
delivered managed policy and `claude` CLI-output scraping are unreadable/unsupported and
were SUPERSEDED from the parent design — they always contribute `unknown` (a rendered
residual caveat), never a silent clear. Scope: Approach 2 (reduced honest core) — probe only
genuinely-readable local sources; `inconclusive` is the honest verdict wherever a source is
unverifiable.

## Delivery

- PR #67 → `main`, merged `7e2ce3c1`, released `1.33.0` (main `fbea6c4e`), `size:exception`
  (~888 total, product ~331). Single PR.

## Verification (see verify-report.md)

PASS. strict TDD; 100 slice tests green on main; coverage 91.64 lines / 82.22 branches; CI
(build + full suite incl. e2e) green on the merge. review-risk + review-reliability CLEAN
except one CONVERGENT CRITICAL — `listManagedDropIns` swallowed all readdir errors → false
`runnable` on an unreadable managed drop-in dir — FIXED (errno-discriminated → inconclusive)
+ regression test; scoped re-review APPROVED.

## Locked decisions

Approach 2 (reduced honest core); node<22 stays on the health axis (not the runnable gate);
guard-not-current → a `guard:*` blocker (→ blocked, not a 4th state); server-delivered policy
+ session safe-mode as constant residual caveats so `runnable` stays reachable while honest;
doctor exit gated 0/1/2 (supersedes 4a always-0, 3 stub tests rewritten).

## Spec sync

`specs/skillguard-pretooluse-hook/spec.md` (delta) synced into `openspec/specs/skillguard-pretooluse-hook/spec.md`.

## Residuals / follow-ups

- Genuinely-unobservable dimensions (server-delivered managed policy, the diagnosed session's
  safe-mode) are honest constant residual caveats, always rendered — accepted by design.
- Backlog (from 4a): `App.tsx` `claudePreToolUseGuard` derivation lacks a direct unit test.

## Remaining arc

The Claude arc's practical scope is now COMPLETE (Slices 1-4b). Remaining as separate arcs:
- **Linux/POSIX hardening arc** ("poner linux") — revisit the Slice-3a POSIX path with this arc's lessons.
- **Agent-agnostic arc** — OpenCode / Codex input-envelope + config adapters.

## Engram traceability

- proposal/design/spec/tasks: `sdd/skillguard-effective-execution/*`
- verify-report / apply-progress: same topic prefix.
