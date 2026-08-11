# Verify Report — hook-consolidation

**Change**: `hook-consolidation` · **Repo**: `/home/javier/programacion/platform/javi-forge`
**Verdict**: PASS (archive-ready) · **Verified against**: `main` @ `6ec0f02e` (PRs #35–#40, slices S1a–S5)
**Severity census**: CRITICAL 0 / WARNING 2 (both advisory, non-blocking) / SUGGESTION 0
**Artifact store**: hybrid · **Engram source of record**: `sdd/hook-consolidation/verify-report` (obs #13849)

> This file is a filesystem mirror of the canonical Engram verify-report observation #13849.
> `sdd-verify` ran read-only and could not write it; `sdd-archive` mirrored it into the change
> folder so the archived audit trail carries its verify record.

## What

Verify PASS (archive-ready) for SDD change `hook-consolidation` against merged `main` @ `6ec0f02e`
(PRs #35–#40, slices S1a–S5). CRITICAL 0 / WARNING 2 (both advisory, non-blocking).

## Why

Read-only verification phase — confirm every spec requirement/scenario, design decision D1–D9,
migration matrix rows a–g, and every `tasks.md` box is realized and tested on `main` before archive.

## Where

`openspec/changes/hook-consolidation/{specs/hook-dispatch/spec.md, specs/ci-hook-install/spec.md,
design.md, tasks.md}`; verify-report mirrored to
`openspec/changes/hook-consolidation/verify-report.md`.

## Evidence

- Test suite `npx vitest run --exclude '**/.claude/**'` → 94 files passed, **1674 passed, 2 skipped,
  0 failed**.
- **5 mechanisms consolidated**: dispatcher (`src/commands/hooks.ts`) registers ci + tdd + secrets +
  permissions + deps sections. `tdd-pipeline.ts` deleted;
  `installTddHooks`/`installTddPipelineHook`/`generateTddHook`/`generateTddPipelineHook`/`stepHookProfile`
  no longer defined (only comment/test refs). All 6 `templates/security-hooks/*` bash bodies deleted;
  `claude-settings-security.json` kept; `stepSecurityHooks` no longer copies `ci-local/hooks/security/`.
- **DOC-004 fixed**: `assets/hooks/{pre-commit,pre-push}` say "setup + lint + compile + gates — no
  tests, no coverage".
- **D6** atomic hooksPath guard in `installCIHooks` (`ci.ts`): 5-step detect-before-mutate + JDA-002
  worktree scope + fail-closed refuse on scoped-read failure; every refuse = zero mutation.
- **D9 / K-005 dead**: `secrets.ts`/`permissions.ts` use `-z` + `split("\0")` + `execFileAsync` argv
  (no shell/xargs/whitespace split). Doctor Security advisories: commit-signing (L4+L6) +
  branch-protection (L5).
- **JD-B-001 fixed**: `resolveCIRunners` (`ci.ts:437-473`) falls through to auto-detect when config
  declares neither runners nor gates (hooks-only `ci.yaml` NOT a no-op).
- **Manifest**: pre-commit v2, pre-push v3, commit-msg v2 (append-only historical).

## Warnings carried forward (advisory — do NOT block archive)

- **W1** — `src/cli/dispatch/ci.tsx:111` stale `"Hooks call javi-forge ci (with npx fallback)"`
  string; deferred to the docs pass per the S5 constraint.
- **W2** — `includeIf` / conditional-scope `hooksPath` residual edge, documented in D6 (scoped
  `--global`/`--system` reads do not cover a value injected only via an `[includeIf]` conditional
  include).

Both WARNINGs are advisory-only and are recorded as Phase-5 docs/spec-pass follow-ups.

## Next

`sdd-archive`.
