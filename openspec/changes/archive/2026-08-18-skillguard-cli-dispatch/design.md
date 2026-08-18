# Design: SkillGuard Slice 4a — CLI dispatch + init wiring

## Technical Approach

Wire the three already-tested library functions in `src/lib/claude-hook-manager.ts`
(`installClaudePreToolUse` :710, `repairClaudePreToolUse` :716, `doctorClaudePreToolUse` :317)
to (1) a new console-only command module and (2) the `init` security step. No Ink, no new
library logic, `runTransaction`/secure-fs untouched. The doctor renderer reports effective
execution as **inconclusive** — never a fabricated RUNNABLE (4b owns real host-probing).

## Resolved Open Items

### (a) init UI/prompt flow — DERIVE, do not add a prompt

Real mechanism: `OptionSelector.tsx` renders a checkbox list (`OPTIONS` :13-62, "Security
Hooks" default true) and emits a flat boolean object to `handleOptionsConfirm`
(`App.tsx:102`). When `securityHooks` is on, the flow advances to the existing
`HookProfileSelector` (`App.tsx:242-247`) → `handleHookProfileConfirm` (:128) →
`runInit`, which builds the **only** `InitOptions` object and calls `initProject`
(`App.tsx:156-176`). Grep confirms App.tsx is the sole `InitOptions` construction site;
CI/batch mode reuses it via `OptionSelector`'s auto-confirm (`OptionSelector.tsx:94-107`).

**Decision**: gate `claudePreToolUseGuard` on `securityHooks` alone — NO new
checkbox, NO new prompt. Derive it at the single `initProject` call site:

```ts
claudePreToolUseGuard: opts.securityHooks
```

EVERY profile that opts into security hooks — Minimal, Standard, and Strict — installs the
guard (per user decision: it is a security feature and Minimal must not silently ship
without it). A project that skipped security hooks at `init` installs the guard later via
the new `hooks install claude` CLI command. This leaves `OptionSelector.tsx` (Props,
onConfirm shape, CI auto-confirm) **untouched**.

### (b) fallback routing — branch before the fallthrough

`handleHooks` (`hooks.tsx:14-35`) checks `cli.input[1] === "run"` (:20) then falls through
to `console.log(HOOKS_HELP_TEXT); process.exit(input[1] === undefined ? 0 : 1)` (:33-34).
Insert `install|doctor|repair` branches **after** the `run` block and **before** the
fallthrough. `input[1]` = subcommand, `input[2]` = target (`claude`):

```ts
const sub = cli.input[1];
if (sub === "install" || sub === "doctor" || sub === "repair") {
  if (cli.input[2] !== "claude") {
    console.error(`Usage: javi-forge hooks ${sub} claude`);
    process.exit(1);
  }
  const { runClaudeHookCommand } = await import("../../commands/claude-hooks.js");
  process.exit(await runClaudeHookCommand(sub, process.cwd(), { force: cli.flags.force === true }));
}
// existing fallthrough unchanged
```

Preserves every `hooks.test.ts` expectation: `hooks run …` (checked first), `hooks`
alone → help+0, `hooks bogus` typo → not one of the four → fallthrough help+1 (:81-86).

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| init opt-in surface | Derive `claudePreToolUseGuard` from `securityHooks` at the one call site (all profiles incl. Minimal) | New OptionSelector checkbox | Zero UI-shape churn; guard ships with security hooks regardless of profile |
| Honest execution stub | Command **renderer** prints `execution: inconclusive`; library struct unchanged | Add `execution` field to `ClaudeHookDoctorReport` now | Keeps library untouched; reserved slot (:97) stays for 4b; no false RUNNABLE |
| doctor exit code | **0 always** (informational, not a gate — per spec; unhealthy verdict is printed, not signalled by exit); exit **2 reserved** for 4b INCONCLUSIVE | unhealthy→1 (stale) / emit 2 in 4a | doctor is diagnostic; 4a cannot determine effective execution — must not claim exit-2 |
| command test seams | `runClaudeHookCommand(sub, dir, opts, deps={})` injecting the 3 lib fns + log/logError | Direct import only | Mirrors `RunHookDeps` (`hooks.ts:301`); console-capture harness reuse |

## Data Flow

    hooks.tsx (dispatch)
      ├─ run       → commands/hooks.ts runHook           (unchanged)
      ├─ install   → claude-hooks.ts → installClaudePreToolUse → renderMutation → exit
      ├─ doctor    → claude-hooks.ts → doctorClaudePreToolUse → renderDoctor(+inconclusive) → exit
      └─ repair    → claude-hooks.ts → repairClaudePreToolUse → renderMutation → exit

    App.tsx runInit ──(guard = securityHooks (all profiles))──▶ initProject
      └─ stepSecurityHooks: guard? installClaudePreToolUse : skip   (legacy copy deleted)

## File Changes

| File | Action | Description |
|---|---|---|
| `src/commands/claude-hooks.ts` | Create | Console-only `runClaudeHookCommand`; renders `ClaudeHookMutationResult`/`ClaudeHookDoctorReport`; maps outcomes → exit codes; prints honest `inconclusive` execution |
| `src/cli/dispatch/hooks.tsx` | Modify | Route install/doctor/repair before fallthrough; wrong target → exit 1; update stale `Only subcommand` doc comment (:1-9) |
| `src/cli/help.ts` | Modify | Extend `HOOKS_HELP_TEXT` (:169-189) with the 3 subcommands + `--force`; `force` flag already in FLAGS_SCHEMA (:214) |
| `src/commands/init/steps/security.ts` | Modify | Delete copy-if-absent legacy branch (:76-88); when `claudePreToolUseGuard`, call `installClaudePreToolUse`, fold result into step report; keep ci.yaml merge; extend dry-run message |
| `src/types/index.ts` | Modify | Add `claudePreToolUseGuard: boolean` to `InitOptions` (:17-38) |
| `src/ui/App.tsx` | Modify | Set `claudePreToolUseGuard` at the `initProject` call (:156-176), derived from profile |

`src/ui/OptionSelector.tsx` — **no change** (derivation makes it unnecessary).

## Interfaces / Contracts

```ts
// src/commands/claude-hooks.ts
export type ClaudeHookSub = "install" | "doctor" | "repair";
export interface ClaudeHookCmdDeps {
  install?: typeof installClaudePreToolUse;
  doctor?: typeof doctorClaudePreToolUse;
  repair?: typeof repairClaudePreToolUse;
  log?: (m: string) => void;
  logError?: (m: string) => void;
}
export function runClaudeHookCommand(
  sub: ClaudeHookSub, projectDir: string,
  opts: { force?: boolean }, deps?: ClaudeHookCmdDeps,
): Promise<number>; // exit code
```

Exit-code mapping:

| Command | Outcome | Exit |
|---|---|---|
| install / repair claude | `result.ok === true` | 0 |
| install / repair claude | `result.ok === false` (errors/refusal) | 1 |
| doctor claude | any (healthy or unhealthy) | 0 (informational) |
| doctor claude | (unhealthy verdict printed, exit still 0) | 0 |
| any | target ≠ `claude` | 1 |
| — | (INCONCLUSIVE effective-execution) | **2 — reserved for 4b, never emitted in 4a** |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Command | install/repair ok→0 & fail→1; doctor exits 0 always (healthy & unhealthy); doctor prints `inconclusive`, never `RUNNABLE`; force forwarded | New `claude-hooks.test.ts`, inject fake lib fns, capture log/err/exit (model on `hooks.test.ts`) |
| Dispatch | install/doctor/repair route to command & exit with its code; wrong target→1; `hooks run` unchanged; `hooks bogus`→help+1; `hooks`→help+0 | Extend `hooks.test.ts`, mock `claude-hooks.js` |
| Init wiring | legacy copy gone; guard true (incl. Minimal)→installer called; securityHooks off→skipped; dry-run never installs | Extend `security.test.ts`, inject/mock `installClaudePreToolUse` |

## Migration / Rollout

No data migration. Additive wiring on a feature branch — revert restores prior behavior;
init rollback restores the copy-if-absent branch. Library functions untouched.

## Open Questions

- [ ] None blocking. Sub-decision flagged for the record: `claudePreToolUseGuard` is
      **derived** from `securityHooks` (all profiles incl. Minimal; not a new prompt) and doctor exit stays **0/1** in 4a
      (exit 2 reserved for 4b). Both are intentional, reviewed against the locked parent design.
