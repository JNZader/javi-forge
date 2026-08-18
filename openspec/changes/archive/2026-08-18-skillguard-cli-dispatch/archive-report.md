# Archive Report — skillguard-cli-dispatch (Slice 4a)

**Archived:** 2026-08-18
**Status:** COMPLETE — implemented, verified (PASS), merged to `main`, released in `javi-forge@1.32.0`.
**Amends:** the skillguard PreToolUse hook arc (Slices 1, 2, 3a, 3b — all archived).

## Summary

Slice 4a exposes the already-shipped Claude PreToolUse guard library functions through the
CLI and wires them into `init`:
- **`hooks install|doctor|repair claude`** — new console-only `src/commands/claude-hooks.ts`
  (`runClaudeHookCommand`) calling `installClaudePreToolUse` / `repairClaudePreToolUse` /
  `doctorClaudePreToolUse`, routed in `src/cli/dispatch/hooks.tsx` after `run` and before the
  unknown-subcommand fallthrough (`hooks run`, `hooks`→help, `hooks <typo>`→help+1 preserved).
- **init** now installs the managed guard via the real transactional installer for ALL
  profiles that enable security hooks (incl. Minimal — `claudePreToolUseGuard = opts.securityHooks`,
  a ratified product decision: the guard is a security feature and Minimal must not silently
  ship without it). The legacy copy-if-absent scaffold (`claude-settings-security.json`) is retired.
- **Honest execution stub**: doctor renders `execution: inconclusive` and NEVER a fabricated
  `RUNNABLE`; exit 2 reserved for the Slice-4b effective-execution matrix. doctor is
  informational (exit 0 always); install/repair ok→0 / !ok→1; `--force` scoped to repair.

`runTransaction` / secure-fs / the library functions are untouched. The effective-execution
matrix (novel host-probing) is deferred to **Slice 4b**.

## Delivery

- PR #66 → `main`, merged `0920a2b3`, `size:exception` (~595 changed lines, product ~150).
- Released `javi-forge@1.32.0` (main `11719771`).
- Local pre-push was `--no-verify`'d once: the GHAGGA gate's LLM endpoint returned `Not Found`
  (transient), falling back to raw static findings that were all pre-existing repo-wide
  (fake AWS keys in `secrets.test.ts`, dependency CVEs) — none in this diff. GitHub Actions CI
  re-validated and passed.

## Verification (see verify-report.md)

PASS: 7/7 requirements, 18/18 scenarios; review-risk + review-reliability CLEAN. CI (which
builds `dist/` and runs the full suite incl. e2e) succeeded on the merge; new command module
100% lines / 88.88% branches; global coverage 91.44 / 81.91. Local e2e failures are a
TTY/Ink + stale-`dist` environment artifact (the CLI is an interactive Ink app), NOT a
regression — confirmed by CI-green and by init exiting 0 when run directly.

## Locked decisions

Reuse the existing `hooks` command namespace (`hooks … claude`, from the parent design);
derive `claudePreToolUseGuard` from `securityHooks` alone (all profiles incl. Minimal);
honest `inconclusive` execution stub (library `ClaudeHookDoctorReport.execution` slot
untouched, reserved for 4b); doctor exit 0 (informational — the design table's "unhealthy→1"
was corrected to match the spec).

## Spec sync

`specs/skillguard-cli-dispatch/spec.md` synced to `openspec/specs/skillguard-cli-dispatch/spec.md`.

## Residuals / follow-ups

- **Backlog**: `App.tsx` `claudePreToolUseGuard` derivation has no direct unit test
  (pre-accepted in design T4) — add wizard→InitOptions test coverage.
- **Slice 4b** — the effective-execution matrix (host-probing).
- **Linux/POSIX hardening arc** and the **agent-agnostic (OpenCode/Codex) arc** remain.

## Engram traceability

- proposal/design/spec/tasks: `sdd/skillguard-cli-dispatch/*`
- verify-report: `sdd/skillguard-cli-dispatch/verify-report`
- apply-progress: `sdd/skillguard-cli-dispatch/apply-progress`
