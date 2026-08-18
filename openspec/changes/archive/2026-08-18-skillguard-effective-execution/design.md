# Design: skillguard-effective-execution (Slice 4b)

## Technical Approach

Replace the 4a doctor stub (`src/commands/claude-hooks.ts:59-79`, hardcoded
`inconclusive` + `return 0`) with a real fail-closed `execution` verdict. Approach
2 (reduced honest core) is fixed: probe only genuinely-readable local settings
sources for two documented scalar flags, never shell to `claude`, never treat an
unreadable/unobservable source as clear. Split across the established Slice-2
pure/impure boundary: a pure flag classifier in `claude-hook-settings.ts`, impure
fs probes + verdict in `claude-hook-manager.ts`, render + exit gate in the command.
A false `runnable` is the single unacceptable outcome.

## Verdict Algorithm (fail-closed)

Per source, `probeExecutionSource(path)` → one of:
`clear` | `blocking(flag)` | `unknown(reason)`.

| Read outcome | Result |
|---|---|
| ENOENT / absent | `clear` (a non-existent file holds no flag — definitive negative) |
| symlink / non-regular / EACCES / io-error / too-large / binary | `unknown(reason)` — unreadable ≠ absent |
| malformed / invalid JSON | `unknown("invalid-json")` — never clear |
| parsed OK, `scanExecutionFlags` finds a blocker | `blocking(flag)` |
| parsed OK, no flag | `clear` |

`scanExecutionFlags(parsed)` (pure): `disableAllHooks === true` and
`allowManagedHooksOnly === true` (strict `=== true` only). Source→blocker mapping:
`disableAllHooks:true` at ANY source blocks; `allowManagedHooksOnly:true` blocks
ONLY from a managed source (inert elsewhere per docs — hooks MERGE, they don't
override).

**Sources probed** (stable order): project `.claude/settings.json`, local
`.claude/settings.local.json`, user `~/.claude/settings.json`, managed OS file,
then `managed-settings.d/*.json` (sorted). Plus `CLAUDE_CODE_SAFE_MODE` env:
set-truthy → `unknownSources` entry ("safe-mode observed in doctor process only");
unset → no effect (session safe-mode is unobservable, a documented residual).

**Guard-currency blocker**: `asset.state !== managed-current` OR
`settings.state !== managed-current` → append a `guard:*` blocker (a not-installed
hook cannot fire). `managed-current` transitively implies matcher/command
exactness (both fold into the canonical settings hash), so those are not
re-checked here. Node `<22` stays on the health axis (residual note), not a blocker.

**Verdict precedence** (blocked checked first, even with a simultaneous unknown):

    blockers ≠ ∅            → blocked      (exit 1)
    else unknownSources ≠ ∅ → inconclusive (exit 2)
    else                    → runnable     (exit 0)

`inconclusive`/`blocked` are NEVER promoted. `runnable` requires every relevant
local source read clear AND guard components current. Server-delivered managed
policy and session safe-mode are constant `residual` caveats always shown in the
render — honest limits, not per-run unknowns (else `runnable` is unreachable).

## Data Flow

    doctorClaudePreToolUse(projectDir, {execution: env})
      ├─ classifyAssetState / readSettings ─→ asset+settings states, healthy
      └─ probeExecution(env, componentStates)
           ├─ resolveManagedSettingsPaths(platform) → file + dropInDir
           ├─ [project, local, user, managed, dropin/*.json] → probeExecutionSource
           ├─ safe-mode env → unknown|∅
           ├─ guard-currency → guard:* blocker|∅
           └─ precedence → ExecutionReport
    renderDoctor(report) → prints status/blockers/unknownSources/residual
                         → exit map runnable0 / blocked1 / inconclusive2

## Module Layout & File Changes

| File | Action | Change |
|---|---|---|
| `src/lib/claude-hook-settings.ts` | Modify | Add pure `scanExecutionFlags(parsed)→{disableAllHooks,allowManagedHooksOnly}` + `ExecutionFlagScan` type. No fs; net-new (grep-confirmed no prior flag awareness). |
| `src/lib/claude-hook-manager.ts` | Modify | Add `ExecutionReport` type + `execution` field on `ClaudeHookDoctorReport` (fills reserved slot :97); `ExecutionProbeEnv` injectable; `resolveManagedSettingsPaths(platform)`; `probeExecutionSource` (reuse `lstatNoFollow`+`safeReadFile`+`JSON.parse`); `listManagedDropIns` (one new confined `readdir` surface, ENOENT→[]); `probeExecution`; wire into `doctorClaudePreToolUse` after `healthy`. |
| `src/commands/claude-hooks.ts` | Modify | `renderDoctor` prints execution block (ordered blockers, unknownSources, residual) and RETURNS the mapped exit code; doctor branch returns it (no longer always 0). |
| `src/commands/claude-hooks.test.ts` | Modify | Add `execution` default to `doctorReport()`; rewrite 3 tests; add matrix cases. |

## Interfaces

```ts
export interface ExecutionReport {
  status: "runnable" | "blocked" | "inconclusive";
  blockers: string[];       // "policy:disableAllHooks@user", "guard:settings=absent"
  unknownSources: string[]; // "managed:/etc/claude-code/managed-settings.json (EACCES)"
  residual: string[];       // constant: server-delivered policy, session safe-mode
}
export interface ExecutionProbeEnv {
  platform?: NodeJS.Platform; homeDir?: string; env?: NodeJS.ProcessEnv;
  managedFile?: string | null; managedDropInDir?: string | null; // test seams
  listDir?: (dir: string) => Promise<string[]>;
}
```

Managed OS paths: darwin `/Library/Application Support/ClaudeCode/…`, linux+WSL
`/etc/claude-code/…`, win32 `C:\Program Files\ClaudeCode\…` (`managed-settings.json`
+ `managed-settings.d`). WSL reports `linux` — no special case.

## Exit-Code Gate & Test Rewrite

Exit mapping lives in the COMMAND layer, driven solely by `report.execution.status`;
the verdict COMPUTATION is manager-tested with injected paths (clean separation —
command renders lib results).

| Test (old) | New contract |
|---|---|
| `:134` unhealthy still returns 0 | `execution:{status:"blocked",blockers:["guard:asset=edited-managed"]}` → **exit 1**, prints blockers |
| `:152` prints inconclusive, never RUNNABLE | `execution:{status:"runnable"}` → **exit 0**, prints "runnable" |
| `:163` never prints RUNNABLE | `execution:{status:"inconclusive",unknownSources:[…]}` → **exit 2**, prints unknownSources |

The 4a "never RUNNABLE / always 0" invariant is deliberately superseded (documented).

## Testing Strategy (host-independent)

| Layer | What | How |
|---|---|---|
| Unit (settings) | `scanExecutionFlags` truth table | Pure inputs; strict `=== true`, non-bool ignored |
| Unit (manager) | Every verdict branch | Real temp dir + inject `managedFile`/`managedDropInDir`/`homeDir`/`platform`/`env` — NEVER real `/etc` or `/Library`. Cases: all-clear+current→runnable; `disableAllHooks:true` per source→blocked; managed `allowManagedHooksOnly`→blocked, non-managed→clear; malformed/symlink→inconclusive; guard-not-current→blocked; safe-mode env set→inconclusive; blocked+unknown simultaneously→blocked |
| Unit (command) | Exit gate + ordered render | Inject fake doctor returning fixed `execution.status`; assert exit 0/1/2 + printed lists |

Determinism: prefer malformed-JSON or symlink fixtures for `unknown` (avoid
chmod-000 root flakiness).

## Open Questions (for orchestrator)

- [ ] Node `<22`: spec's runnable gate omits it, so a healthy-except-old-node
  install can read `runnable` while `report.healthy=false`. Recommend keeping per
  spec (node → health axis + residual note). Confirm.
- [ ] Guard-not-current is surfaced as a `guard:*` entry in `blockers` (fills the
  spec's implicit gap so a not-installed guard → `blocked`, not a fourth state).
  Confirm this interpretation.
- [ ] Server-delivered policy + unset safe-mode rendered as constant `residual`
  caveats (not per-run unknowns) so `runnable` stays reachable. Confirm phrasing.

## Migration / Rollout

No migration. Revert restores the stub + always-0 exit + 4a tests.
