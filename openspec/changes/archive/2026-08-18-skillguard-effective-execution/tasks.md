# Tasks: skillguard-effective-execution (Slice 4b)

Single work-unit, single PR. Strict TDD (RED commit compiles and fails for the
right reason, GREEN commit makes it pass — no combined red+green commits).
Order is RED → GREEN per component, components ordered bottom-up through the
Slice-2 pure/impure boundary: settings classifier → manager probe/verdict →
command render/exit → full command-test rewrite → gates.

Confirmed sub-decisions baked in below (do not re-litigate during apply):
- Node `<22` stays on the health axis (residual note), never a `runnable` gate input.
- Guard-not-current (`asset.state`/`settings.state !== managed-current`) is a
  `guard:*` entry in `blockers` → `blocked`. Not a fourth status.
- Server-delivered managed policy and unset/session safe-mode are CONSTANT
  `residual` caveats, always rendered, never per-run `unknownSources` entries —
  `runnable` must stay reachable.

## 1. Settings classifier — `src/lib/claude-hook-settings.ts`

- [x] **1.1 [RED]** Add `claude-hook-settings.test.ts` (or extend the existing
      settings test file) with a truth table for a new pure `scanExecutionFlags(parsed)`:
      - `disableAllHooks: true` (strict boolean `true`) → flagged
      - `allowManagedHooksOnly: true` → flagged
      - non-boolean / truthy-but-not-`true` (`"true"`, `1`) → NOT flagged
      - absent keys / non-object input → NOT flagged
      Assert the return shape matches `ExecutionFlagScan` from the design
      (`{disableAllHooks: boolean; allowManagedHooksOnly: boolean}`).
      Run to confirm RED (function does not exist yet — compile/type failure is
      the expected RED, not a runtime assertion failure).
      — Satisfies: spec scenarios "disableAllHooks in any readable source blocks",
      "allowManagedHooksOnly in managed settings blocks" (classifier half only;
      source-mapping is manager work in §2).

- [x] **1.2 [GREEN]** Implement `ExecutionFlagScan` type + `scanExecutionFlags(parsed)`
      in `claude-hook-settings.ts`. Pure function, zero fs, reuses `isPlainObject`.
      Export both. Confirm 1.1 passes.

## 2. Manager probe + verdict — `src/lib/claude-hook-manager.ts`

- [x] **2.1 [RED]** Add `ExecutionReport` and `ExecutionProbeEnv` type-only
      assertions plus a first failing test in `claude-hook-manager.test.ts`
      for `resolveManagedSettingsPaths(platform)`: darwin →
      `/Library/Application Support/ClaudeCode/managed-settings.json` +
      `.../managed-settings.d`; linux (and a WSL-flavored env, still reporting
      `linux`) → `/etc/claude-code/...`; win32 →
      `C:\Program Files\ClaudeCode\...`. Confirm RED (function undefined).
      — Satisfies: design "Managed OS paths" note; no direct spec scenario, but
      required by every managed-source scenario below.

- [x] **2.2 [GREEN]** Implement `resolveManagedSettingsPaths`. Confirm 2.1 green.

- [x] **2.3 [RED]** Add tests for `probeExecutionSource(path)` against real temp
      fixtures only (no real `/etc` or `/Library`), covering every branch in the
      design's read-outcome table:
      - absent (ENOENT) → `clear`
      - symlink → `unknown("symlink")` (build via `fs.symlink` in a temp dir)
      - malformed JSON → `unknown("invalid-json")`
      - unreadable-but-present (simulate via a stub in `ExecutionProbeEnv`/injected
        read, NOT chmod-000 — avoid root flakiness) → `unknown(reason)`,
        distinct from absent
      - parsed OK, `disableAllHooks: true` → `blocking("disableAllHooks")`
      - parsed OK, `allowManagedHooksOnly: true` → `blocking("allowManagedHooksOnly")`
      - parsed OK, no flags → `clear`
      Confirm RED.
      — Satisfies: spec scenarios "Unreadable user settings force inconclusive",
      "Present-but-unreadable managed path forces inconclusive".

- [x] **2.4 [GREEN]** Implement `probeExecutionSource`, reusing `lstatNoFollow` +
      `safeReadFile` + `JSON.parse` + `scanExecutionFlags`. Confirm 2.3 green.

- [x] **2.5 [RED]** Add tests for `listManagedDropIns(dir)`: ENOENT → `[]`;
      present dir → sorted `*.json` entries only (stable order). Use the
      injectable `listDir` seam from `ExecutionProbeEnv` for the fs-free path and
      a real temp dir for the integration path. Confirm RED.

- [x] **2.6 [GREEN]** Implement `listManagedDropIns` (one new confined `readdir`
      surface). Confirm 2.5 green.

- [x] **2.7 [RED]** Add the full `probeExecution(env, componentStates)` verdict
      matrix as tests, each pointing every source (project/local/user/managed
      file/drop-ins) at temp fixtures via injected `ExecutionProbeEnv`:
      1. All-clear local sources + `managed-current` asset/settings → `runnable`,
         `blockers: []`, `unknownSources: []`.
      2. `disableAllHooks: true` at project source → `blocked`,
         `blockers` names the project source.
      3. `disableAllHooks: true` at local source → `blocked`, names local.
      4. `disableAllHooks: true` at user source → `blocked`, names user.
      5. `disableAllHooks: true` at managed source → `blocked`, names managed.
      6. `allowManagedHooksOnly: true` at the managed source → `blocked`.
      7. `allowManagedHooksOnly: true` at a NON-managed source (e.g. project) →
         inert — that source does NOT block on this flag (still may be `clear`
         or `blocked` on a different flag if also set).
      8. Malformed JSON at any one source, rest clear → `inconclusive`,
         `unknownSources` names it, `blockers: []`.
      9. Symlinked managed file → `inconclusive` (`unknown` from managed source).
      10. Guard-not-current: `asset.state !== "managed-current"` (e.g.
          `edited-managed`) with all sources otherwise clear → `blocked`,
          `blockers` contains a `guard:asset=...` entry.
      11. Guard-not-current: `settings.state !== "managed-current"` → `blocked`,
          `blockers` contains a `guard:settings=...` entry.
      12. `CLAUDE_CODE_SAFE_MODE` set-truthy in `env` → `residual` includes the
          safe-mode caveat; safe-mode alone (with everything else clear/current)
          does NOT move `unknownSources` and does NOT block `runnable` from being
          reachable in a separate case — confirm the confirmed sub-decision:
          residual is CONSTANT and never gates status by itself. (If the spec's
          "Safe-mode observation is never silently cleared" scenario is read to
          require it in `unknownSources`, that scenario is satisfied by rendering
          it as a residual caveat that is ALWAYS present — assert the design's
          resolution explicitly here so intent is pinned in test.)
      13. `CLAUDE_CODE_SAFE_MODE` unset → `residual` still includes the constant
          server/safe-mode caveat lines (present every run, per design §"Verdict
          Algorithm").
      14. Simultaneous blocker + unknown source → `blocked` wins (precedence
          check — blockers checked first even with a live unknown).
      15. Stable order: multiple blockers/unknowns assert a committed array order
          (source order: project, local, user, managed, drop-ins sorted).
      Confirm RED (function undefined / wrong shape).
      — Satisfies: spec scenarios "disableAllHooks in any readable source blocks",
      "allowManagedHooksOnly in managed settings blocks", "All-clear local sources
      produce runnable", "Unreadable user settings force inconclusive",
      "Present-but-unreadable managed path forces inconclusive", "Safe-mode
      observation is never silently cleared", "A higher-precedence settings file
      with unrelated keys does not block"; plus the three confirmed sub-decisions
      (node axis, guard-blocker, constant residual).

- [x] **2.8 [GREEN]** Implement `probeExecution`: iterate sources in stable
      order via `probeExecutionSource`, collect `blocking`/`unknown` results into
      `blockers`/`unknownSources` with source-tagged messages, apply the
      guard-currency check against the already-computed `asset`/`settings`
      component states, compute the constant `residual` caveats (server-delivered
      policy + safe-mode phrasing), apply precedence
      (`blockers≠∅→blocked`, else `unknownSources≠∅→inconclusive`, else
      `runnable`). Confirm all of 2.7 green.

- [x] **2.9 [RED]** Add a test on `doctorClaudePreToolUse` asserting the
      `execution` field is present on `ClaudeHookDoctorReport` and independent of
      `healthy` (spec scenario "Runnable and healthy are independent" — a
      current+healthy install with one unreadable managed source still reports
      `healthy: true` and `execution.status: "inconclusive"`). Confirm RED.

- [x] **2.10 [GREEN]** Add `execution: ExecutionReport` to
      `ClaudeHookDoctorReport` (fills the reserved slot noted at the current
      `// Slice 4 adds: execution: {...}` comment), wire `probeExecution` into
      `doctorClaudePreToolUse` after `healthy` is computed, threading an
      `options?.execution?: ExecutionProbeEnv` seam through `doctorClaudePreToolUse`'s
      existing `options` param. Confirm 2.9 green plus full manager suite.

## 3. Command render + exit gate — `src/commands/claude-hooks.ts`

- [x] **3.1 [RED]** In `claude-hooks.test.ts`, add the fixture default
      `execution: { status: "runnable", blockers: [], unknownSources: [],
      residual: [] }` to `doctorReport()`, then add NEW tests (kept separate from
      the rewritten tests in §4) for the render+exit contract:
      - `execution.status: "blocked"` with `blockers: [...]` → exit `1`, output
        lists every blocker in order, output does NOT contain "runnable".
      - `execution.status: "inconclusive"` with `unknownSources: [...]` → exit
        `2`, output lists every unknown source in order, output does NOT contain
        "runnable".
      - `execution.status: "runnable"` → exit `0`, output contains "runnable".
      - `residual` entries are always printed regardless of status.
      Confirm RED (renderDoctor still hardcodes inconclusive/exit 0).
      — Satisfies: spec "Blocked output lists the blocking source", "Inconclusive
      output lists the unknown source", exit-code mapping requirement.

- [x] **3.2 [GREEN]** Replace the `renderDoctor` stub (current lines ~59-79):
      remove the hardcoded "execution: inconclusive ... deferred to 4b" log line
      and the "always exit 0" comment/behavior; print `execution.status`, then
      `blockers` (stable order, only if non-empty), `unknownSources` (stable
      order, only if non-empty), then `residual` (always, if non-empty); return
      the mapped exit code (`runnable`→0, `blocked`→1, `inconclusive`→2) instead
      of the current unconditional `0`. Update `runClaudeHookCommand`'s doctor
      branch to return `renderDoctor`'s new return value (already does — confirm
      no change needed there beyond the stub itself). Update the file-header
      "Honest-execution constraint" comment block (lines 7-11) — it currently
      documents the 4a-deferred stub and must be corrected to describe the 4b
      real gate, or removed if now redundant with the design doc. Confirm 3.1
      green.

## 4. Full command-test rewrite — `src/commands/claude-hooks.test.ts`

- [x] **4.1 [RED]** Rewrite the 3 stub-era tests that assert the superseded
      4a "always 0 / never RUNNABLE" invariant:
      - `:134` "doctor: unhealthy report still returns 0 and prints remediation"
        → rename/rewrite to inject `execution: {status: "blocked", blockers:
        ["guard:asset=edited-managed"], unknownSources: [], residual: []}` and
        assert exit `1` + blockers printed (per design's exact mapping table).
      - `:152` "doctor: prints execution inconclusive and NEVER RUNNABLE (healthy
        fixture)" → rewrite to inject `execution: {status: "runnable", ...}` and
        assert exit `0` + output contains "runnable".
      - `:163` "doctor: NEVER prints RUNNABLE (unhealthy fixture)" → rewrite to
        inject `execution: {status: "inconclusive", unknownSources: [...], ...}`
        and assert exit `2` + `unknownSources` printed, output does NOT contain
        "runnable".
      Run the full `claude-hooks.test.ts` file — confirm these 3 fail against
      the OLD renderDoctor (still RED at this point if done before 3.2; if done
      after 3.2, this step folds into 3.1's verification — sequence 3.1→3.2→4.1
      is acceptable as long as 4.1's final state is green against the new
      renderDoctor).
      — Satisfies design's exact "Test (old) → New contract" table.

- [x] **4.2 [GREEN]** Confirm all of `claude-hooks.test.ts` is green (§3's new
      tests + §4.1's rewritten tests + all untouched existing tests for
      install/repair, which are unaffected).

## 5. Gates

- [x] **5.1** `pnpm validate` clean (lint + typecheck + format).
- [x] **5.2** `pnpm test:coverage` green, thresholds held: ≥85% lines, ≥80%
      branches. Pay particular attention to `probeExecution`'s branch count
      (12+ verdict paths) — add targeted unit cases if coverage gaps appear
      rather than lowering the threshold.
- [x] **5.3** Confirm total diff stays within the ≤400-line work-unit size gate
      (four files: 2 lib modules + 1 command + 1 command-test rewrite, each
      additive/localized per the design's file-change table — no unrelated
      churn). If the diff forecasts over 400 lines, split §2 (settings+manager)
      from §3+§4 (command+test) into two PRs rather than cutting test coverage.
- [x] **5.4** Manual smoke: run `javi-forge hooks doctor claude` against a real
      local checkout in each of the three states (runnable / blocked via a
      temp `disableAllHooks:true` in `.claude/settings.local.json` / inconclusive
      via an unreadable managed path or safe-mode env var) and eyeball the exit
      code + printed lines match the design's render contract. (Real-usage
      verification per user convention — not just green tests.)

## Task-to-requirement traceability

| Task(s) | Spec scenario / requirement |
|---|---|
| 1.1-1.2 | `scanExecutionFlags` truth table (classifier half of both blocking scenarios) |
| 2.3-2.4 | Unreadable user settings force inconclusive; Present-but-unreadable managed path forces inconclusive |
| 2.7 (#2-6) | disableAllHooks in any readable source blocks; allowManagedHooksOnly in managed settings blocks |
| 2.7 (#7) | A higher-precedence settings file with unrelated keys does not block |
| 2.7 (#1) | All-clear local sources produce runnable |
| 2.7 (#10-11) | Guard-not-current → blocked (confirmed sub-decision, fills spec's implicit gap) |
| 2.7 (#12-13) | Safe-mode observation is never silently cleared (as constant residual, confirmed sub-decision) |
| 2.7 (#14) | `blocked` checked first even with a simultaneous unknown (spec precedence clause) |
| 2.7 (#15), 3.1, 3.2 | Stable order requirement (both requirements) |
| 2.9-2.10 | Runnable and healthy are independent |
| 3.1-3.2 | Blocked output lists the blocking source; Inconclusive output lists the unknown source; exit-code mapping (0/1/2) |
| 4.1-4.2 | Design's "Test (old) → New contract" table; 4a "never RUNNABLE / always 0" invariant deliberately superseded |
| 5.1-5.4 | Non-functional gates (strict_tdd, coverage, size, real-usage verification) |
