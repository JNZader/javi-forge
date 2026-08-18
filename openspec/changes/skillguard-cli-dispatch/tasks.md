# Tasks: skillguard-cli-dispatch (Slice 4a)

Single work-unit / single PR. Mechanical wiring of already-tested library functions
(`installClaudePreToolUse`, `doctorClaudePreToolUse`, `repairClaudePreToolUse` in
`src/lib/claude-hook-manager.ts`) to a CLI surface and to `init`. strict_tdd: every
behavioral change gets a RED test before the GREEN implementation. Gates:
`pnpm validate` (typecheck + typecheck:test + lint + test) and `pnpm test:coverage`
(85% lines / 80% branches).

Size forecast: ~110 lines new command module + ~170 lines new command test +
~20 lines dispatch + ~70 lines dispatch test additions + ~15 lines help text +
~10 lines init-step net (delete legacy branch, add installer call) + ~50 lines
init-step test additions + 2 one-line type/UI edits ≈ **420-450 changed lines**
across create+modify. This is at/slightly over the nominal 400-line work-unit
guideline but stays ONE PR per design's explicit call ("mechanical wiring,
should fit one work-unit") — no natural sub-slice boundary exists (dispatch,
command module, and init step are mutually pointless without each other). Flag
at PR time; split only if `pnpm validate`/review flags real complexity, not line
count alone.

---

## 0. Foundation (blocks compilation of everything else)

- [ ] **T0.1** — Add `claudePreToolUseGuard: boolean` to `InitOptions` in
      `src/types/index.ts` (after `securityHooks`/`hookProfile`, :17-38).
      No test — pure type addition; downstream tests (T5, T6) will fail to
      compile without it, which is the intended forcing function.
- [ ] **T0.2** — Update the `makeOptions()` fixture in
      `src/commands/init/steps/security.test.ts` (:43-65) to include
      `claudePreToolUseGuard: true` in the defaults (override per-test where a
      scenario needs it `false`). Required so the existing 10 passing tests keep
      compiling after T0.1 — do this before writing new RED tests in T6.

## 1. `src/commands/claude-hooks.ts` — new command module

RED:
- [ ] **T1.1** — Create `src/commands/claude-hooks.test.ts` (model on
      `src/cli/dispatch/hooks.test.ts`'s inject-fake-deps + capture
      log/error/exit harness). Cover, injecting fake `install`/`doctor`/`repair`
      deps via `ClaudeHookCmdDeps`:
      - `install`: `result.ok === true` → prints changed paths, exits `0`.
      - `install`: `result.ok === false` → prints `errors[]`, exits `1`.
      - `doctor`: `report.healthy === true` → prints per-component state +
        `remediation[]`, exits `0`.
      - `doctor`: `report.healthy === false` → same shape, still exits `0`
        (doctor is informational per spec Scenario "Doctor reports component
        health" — not a pass/fail gate).
      - `doctor`: output asserted to contain `inconclusive` (or omit execution
        entirely) and **never** contain the literal string `RUNNABLE`, for both
        healthy and unhealthy fixtures.
      - `repair` without `--force` on an `edited-managed` fixture → `ok: false`,
        refusal printed, exit `1`.
      - `repair` with `--force`: assert the injected `repair` fn is called with
        `{ force: true }`; `ok: true` fixture → exit `0`.
      - `install`/`doctor`/`repair` all resolve via `console.log`/`console.error`
        only (spy-based, matching the `hooks.test.ts` harness) — no Ink import in
        the module (grep-assertable or just structural by construction).
      This file will fail to import `runClaudeHookCommand` until T1.2 exists —
      that import failure is the RED state.

GREEN:
- [ ] **T1.2** — Create `src/commands/claude-hooks.ts`:
      - `export type ClaudeHookSub = "install" | "doctor" | "repair"`
      - `export interface ClaudeHookCmdDeps { install?; doctor?; repair?; log?; logError?; }`
        defaulting each to the real `installClaudePreToolUse` /
        `doctorClaudePreToolUse` / `repairClaudePreToolUse` import and
        `console.log`/`console.error`.
      - `export async function runClaudeHookCommand(sub, projectDir, opts: { force?: boolean }, deps: ClaudeHookCmdDeps = {}): Promise<number>`
      - `install`/`repair` branch: call the lib fn (`repair` forwards
        `{ force: opts.force }`), render `changed`/`backups`/`errors` from
        `ClaudeHookMutationResult`, return `0` if `ok` else `1`.
      - `doctor` branch: call `doctorClaudePreToolUse`, render `healthy`,
        `settings`/`asset` state+detail, `node`, `remediation[]`,
        `hostResidual`; print the execution line as literally
        `execution: inconclusive` (never derive/print `RUNNABLE` — exit `2` is
        NOT emitted in 4a, reserved for 4b); return `0` always (doctor is
        informational per spec).
      - Console-only: `console.log`/`console.error`, no Ink import — matches
        spec Requirement "New command output is console-only".
      - Run T1.1 → confirm GREEN. Run `pnpm typecheck:test` + `pnpm test
        src/commands/claude-hooks.test.ts`.

## 2. `src/cli/dispatch/hooks.tsx` — routing

RED:
- [ ] **T2.1** — Extend `src/cli/dispatch/hooks.test.ts`: add
      `vi.mock("../../commands/claude-hooks.js", () => ({ runClaudeHookCommand: vi.fn() }))`
      alongside the existing `runHook` mock. Add cases:
      - `hooks install claude` → `runClaudeHookCommand` called with
        `("install", process.cwd(), { force: false })`, exits with its resolved
        code.
      - `hooks doctor claude` → same shape, `"doctor"`.
      - `hooks repair claude --force` → `opts.force` is `true`.
      - `hooks install <wrong-target>` (e.g. `hooks install foo`) →
        `runClaudeHookCommand` NOT called, `console.error` prints
        `Usage: javi-forge hooks install claude`, exits `1`. Same for `doctor`/
        `repair` with a wrong/missing target.
      - Regression guards (already covered by existing tests, keep green):
        `hooks run pre-commit` unaffected, `hooks` alone → help + exit `0`,
        `hooks bogus` → help + exit `1`.
      These new cases fail (RED) because `hooks.tsx` doesn't route
      install/doctor/repair yet.

GREEN:
- [ ] **T2.2** — Modify `src/cli/dispatch/hooks.tsx`:
      - Insert the `install|doctor|repair` branch immediately after the `run`
        block (:29) and before the fallthrough (:31-34), per design's Data Flow
        snippet: check `sub = cli.input[1]`, if one of the three and
        `cli.input[2] !== "claude"` → `console.error` usage + exit `1`; else
        lazy-`import("../../commands/claude-hooks.js")` and
        `process.exit(await runClaudeHookCommand(sub, process.cwd(), { force: cli.flags.force === true }))`.
      - Update the stale module doc comment (:1-9): "Only subcommand: `hooks
        run …`" is no longer true — describe all four subcommand families.
      - Run T2.1 → confirm GREEN.

## 3. `src/cli/help.ts` — help text

RED:
- [ ] **T3.1** — Add a case to `hooks.test.ts` (or a small dedicated
      `help.test.ts` case if one already covers `HOOKS_HELP_TEXT`) asserting
      `HOOKS_HELP_TEXT` contains `install claude`, `doctor claude`,
      `repair claude`, and `--force`. (Spec Requirement "Help text documents the
      new subcommands", scenario "Help lists all four subcommand families".)
      Fails against current `HOOKS_HELP_TEXT` (:169-189), which only documents
      `run`.

GREEN:
- [ ] **T3.2** — Extend `HOOKS_HELP_TEXT` in `src/cli/help.ts` (:169-189) with
      the three new subcommands and `--force` under `Subcommands`/`Examples`
      (the `force` flag already exists in `FLAGS_SCHEMA`, :214 — no schema
      change needed). Run T3.1 → confirm GREEN.

## 4. `src/ui/App.tsx` — derive the opt-in (mechanical, no dedicated test file)

- [ ] **T4.1** — At the `initProject` call in `runInit` (:156-176), add
      `claudePreToolUseGuard: opts.securityHooks` to the constructed
      `InitOptions` object. Derivation is `opts.securityHooks` ALONE — not
      gated on `hookProfile` (per design decision: Minimal profile installs the
      guard too, since it's a security feature, not a profile-scaled one).
      No `App.test.tsx` exists today (confirmed: no test file references
      `initProject` calls), so this one-line change has no direct unit test;
      correctness for the "all profiles incl. Minimal" behavior is verified via
      the `claudePreToolUseGuard: true` path exercised in T6's init-step tests
      and via manual `--batch` smoke-check at PR time (init flow builds
      `InitOptions` at this single site per design's grep confirmation).

## 5. `src/commands/init/steps/security.ts` — install wiring

RED:
- [ ] **T5.1** — Extend `src/commands/init/steps/security.test.ts` (after T0.2's
      fixture update). Add:
      - `vi.mock("../../../lib/claude-hook-manager.js", () => ({ installClaudePreToolUse: vi.fn() }))`
        and import the mocked fn.
      - `claudePreToolUseGuard: true` (any `hookProfile`, incl. `"minimal"`) →
        `installClaudePreToolUse` is called with `projectDir`, and its result is
        folded into the step's `detail`/status (assert on the mock call and on
        the reported step, matching the existing `report()`-based assertions in
        this file).
      - `claudePreToolUseGuard: false` → `installClaudePreToolUse` is NOT
        called, no `.claude/` artifact write attempted.
      - Update/replace the two now-obsolete "KEEPS the .claude/settings.json
        copy" / "does NOT overwrite an existing .claude/settings.json" tests:
        the legacy copy-if-absent branch is being deleted, so these must assert
        the *new* behavior (installer called with guard true) or be removed if
        superseded by the new assertion above — do not leave tests asserting
        the legacy `fs.copy` scaffold path.
      - `dry-run` with `claudePreToolUseGuard: true` → `installClaudePreToolUse`
        is NOT called (extend the existing dry-run test's assertions), and the
        dry-run detail message mentions the guard alongside the hooks preset.
      - Keep the existing profile-preset (`strict`/`standard`/`minimal` →
        `setHookFeature` calls) tests passing unchanged — `ci.yaml` merge logic
        is untouched by this slice.
      These new/changed assertions fail (RED) against the current legacy
      copy-if-absent implementation.

GREEN:
- [ ] **T5.2** — Modify `src/commands/init/steps/security.ts`:
      - Delete the copy-if-absent legacy branch (:76-88, the `settingsSrc`/
        `fs.pathExists`/`fs.copy` block).
      - When `options.claudePreToolUseGuard` is true (new destructure from
        `options`), call `installClaudePreToolUse(projectDir)` (import from
        `../../../lib/claude-hook-manager.js`) and fold `ok`/`changed`/`errors`
        into the step's `report(...)` call (status `done` on `ok`, `error` with
        `errors.join(...)` detail otherwise — follow the file's existing
        try/catch-to-`report("error", ...)` convention at :111-113).
      - Keep the `ci.yaml` `setHookFeature` merge loop (:90-101) unchanged.
      - Extend the dry-run message (:65-73) to also mention the guard install
        when `claudePreToolUseGuard` is true, without calling the installer.
      - When `claudePreToolUseGuard` is false, do nothing Claude-hook-related
        (no `.claude/hooks/` asset, no `.claude/settings.json` managed entry) —
        satisfies spec scenario "Opted-out init leaves no stale Claude-hook
        artifact".
      - Update the module doc comment (:30-44) — the "Copies the kiteguard-style
        runtime settings… (KEPT — this is a real feature)" line is no longer
        true; describe the new installer call instead.
      - Run T5.1 → confirm GREEN.

## 6. Full-suite verification

- [ ] **T6.1** — `pnpm validate` (typecheck + typecheck:test + lint + test) —
      all green, including every regression case listed in T2.1/T5.1.
- [ ] **T6.2** — `pnpm test:coverage` — confirm 85% lines / 80% branches on the
      new/changed files (`claude-hooks.ts` is a brand-new module and needs its
      own coverage, not just a ride on existing suite totals).
- [ ] **T6.3** — Manual smoke: `node dist/... hooks --help` shows all four
      subcommand families (or `pnpm build && node bin/... hooks --help` per
      repo's actual dev-run command) — confirms T3.2 renders correctly outside
      the test harness. `hooks install claude` / `hooks doctor claude` /
      `hooks repair claude` against a scratch dir — confirms exit codes and
      that `doctor` never prints `RUNNABLE`.
- [ ] **T6.4** — Confirm no leftover references to
      `templates/security-hooks/claude-settings-security.json` as an init-time
      copy source (grep for `claude-settings-security.json` outside
      `security.test.ts`'s now-updated fixtures/comments and outside the
      template file itself, which may still exist on disk unreferenced or be
      removed in a follow-up — out of scope for this slice unless dead-code
      lint flags it).
