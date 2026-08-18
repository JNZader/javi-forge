# Verify Report — skillguard-cli-dispatch (Slice 4a)

**Status: PASS** · CRITICAL: 0 · WARNING: 1 (pre-accepted, non-blocking)
**Verified:** 2026-08-18 · main `11719771` · shipped in `javi-forge@1.32.0`

## Executive summary

Slice 4a (CLI dispatch + init wiring for the Claude PreToolUse guard) is spec-complete and
correct. All 7 requirements / 18 scenarios map to implementing code on `main` + passing
tests. Two independent review lenses (review-risk + review-reliability) returned CLEAN.
The library functions / `runTransaction` / secure-fs are untouched. Released 1.32.0.

## Requirement coverage (7/7, 18/18 — PASS)

- **R1-R3** `hooks install|doctor|repair claude` → `src/commands/claude-hooks.ts`
  (`runClaudeHookCommand`), routed in `src/cli/dispatch/hooks.tsx` after `run` / before the
  unknown-subcommand fallthrough. install/repair ok→0 / !ok→1; doctor informational (exit 0).
- **R4 honest execution stub** — doctor renders `execution: inconclusive`, NEVER a
  fabricated `RUNNABLE`; exit 2 reserved for 4b (never emitted). Verified by grep + 2 unit
  tests (`not.toContain("RUNNABLE")` for healthy AND unhealthy fixtures). review-risk CLEAN.
- **R5 init wiring** — `src/commands/init/steps/security.ts` retires the legacy
  copy-if-absent scaffold (`claude-settings-security.json` == `LEGACY_FILE_SHA256`) and
  installs the managed guard via `installClaudePreToolUse` for ALL profiles that enable
  security hooks (incl. Minimal — `claudePreToolUseGuard = opts.securityHooks`, per the
  ratified product decision). Guard-install failures are caught by the step's outer
  try/catch and reported (never thrown / never crash init).
- **R6 help** — `hooks --help` documents the 3 subcommands + `--force`.
- **R7 console-only** — new command file has no Ink; matches house exit-code conventions.

## Gate results

- **CI (authoritative)**: `ci.yml` builds (`pnpm build`) then runs `pnpm test:coverage`
  (full suite incl. `src/e2e/**` against the freshly-built `dist/`). The 4a merge commit
  `0920a2b3` → **CI success**; the release ran → `1.32.0`.
- **Local (non-e2e)**: `pnpm validate` typecheck/lint/unit all green; new module
  `src/commands/claude-hooks.ts` 100% lines / 88.88% branches; global 91.44 lines / 81.91 branches.

### Note on local e2e (`src/e2e/aggressive.e2e.test.ts`)

These e2e run the BUILT `dist/index.js` (an interactive Ink CLI) via `execFile`. Locally
they fail with **"Raw mode is not supported on the stdin provided to Ink"** — a TTY /
environment artifact of the local shell (the CLI is a React/Ink app), plus a stale local
`dist/` (repo convention is "never build after changes"). They are **NOT a regression**:
the same suite passes in CI, which builds `dist/` fresh and runs in a TTY-compatible
environment (CI success on the 4a merge). Running the CLI directly under a temp dir exits 0.
An investigation that hypothesized a guard-install init-crash was a red herring — the step's
outer try/catch already makes a guard refusal/throw non-fatal to init.

## Size gate

`size:exception` (~595 changed lines, dominated by a 213-line new test file + 19 one-line
`InitOptions` fixture edits; product surface ~150 lines). Single PR per the design's call.

## Gaps / residuals

- **WARNING (pre-accepted in design T4, non-blocking)**: the `App.tsx` derivation
  `claudePreToolUseGuard: opts.securityHooks` has no direct unit test (no `App.test.tsx`;
  covered by init-step tests + smoke). A regression to a wrong value would compile + pass.
  Backlog: add wizard→InitOptions test coverage.
- **Deferred to Slice 4b**: the effective-execution matrix (host-probing of
  disableAllHooks / allowManagedHooksOnly / settings.local.json / user settings / MDM /
  safe-mode). doctor's `execution` stays `inconclusive` until then.

## Verdict

PASS. Change is in trunk (`11719771`), released `1.32.0`, CI green (incl. e2e in CI), both
review lenses CLEAN. Ready for `sdd-archive`.

Engram: `sdd/skillguard-cli-dispatch/verify-report`.
