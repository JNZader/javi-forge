# Proposal: skillguard-effective-execution (Slice 4b — effective-execution matrix)

## Intent

Slice 4a ships the Claude PreToolUse guard doctor with an honest STUB: it prints
`execution: inconclusive` unconditionally and always exits 0
(`src/commands/claude-hooks.ts:59-79`). 4b replaces that stub with the real
`runnable | blocked | inconclusive` verdict, fail-closed, so `javi-forge hooks
doctor claude` can tell the truth about whether the installed hook will actually
fire — without ever fabricating a false "clear".

## Corrected/Verified Basis (from exploration, official 2026-08 Claude Code docs)

- **Hooks MERGE across settings levels; they do NOT override.** A project-level
  PreToolUse hook keeps running regardless of higher-precedence settings, UNLESS
  exactly one of: `disableAllHooks: true` (set at ANY level disables the
  non-managed project hook), `allowManagedHooksOnly: true` (managed-settings
  only), or safe-mode (`--safe-mode` / `CLAUDE_CODE_SAFE_MODE=1`). This corrects
  the parent design's implicit "precedence shadows lower hooks" framing.
- **Managed settings are readable local files** at fixed OS paths (macOS/Linux/WSL/
  Windows) plus `managed-settings.d/*.json` — BUT can also be server-delivered
  (unreadable → always `unknown`).
- **No scriptable API** for effective hook state. `claude doctor`/`--debug` output
  scraping is undocumented → DROPPED, never implemented.

## Scope

### In Scope
- Pure scalar-flag classifier in `src/lib/claude-hook-settings.ts`: given a parsed
  settings object, detect `disableAllHooks` / `allowManagedHooksOnly` → blocking.
- New fs probes in `src/lib/claude-hook-manager.ts` (via `safeReadFile`,
  unreadable ≠ absent) reading: project `.claude/settings.json`, local
  `.claude/settings.local.json`, user `~/.claude/settings.json`, and static OS
  managed paths + `managed-settings.d/*.json`; plus a `CLAUDE_CODE_SAFE_MODE` env
  check EXPLICITLY caveated as scoped to the doctor's own process, not the
  diagnosed session.
- Add `execution: { status: "runnable" | "blocked" | "inconclusive"; blockers:
  string[]; unknownSources: string[] }` to `ClaudeHookDoctorReport` (reserved slot
  at `claude-hook-manager.ts:97`).
- Replace the `renderDoctor` inconclusive stub with deterministic ordered matrix
  rendering (blockers + unknownSources listed).
- Change doctor exit from always-0 to the 3-way gate: `runnable`→0, `blocked`→1,
  `inconclusive`→2 (exit 2 reserved by 4a for exactly this).
- Rewrite the 3 superseded 4a tests (`claude-hooks.test.ts:134,152,163`) to assert
  the new contract.

### Out of Scope (SUPERSEDED from parent design — always contribute `unknown`)
- Server-delivered managed policy (categorically unreadable from disk).
- `claude doctor` / `claude --debug` CLI-output scraping (undocumented API — not
  implemented; never shell out to the `claude` binary).
- Plugin-only-customization probing beyond the two documented flags.

## Scope Decision

- **Mode**: Reduction.
- **Justification**: The parent design's full matrix (incl. a "resolved-settings
  probe") reopens the false-`runnable` risk via undocumented CLI scraping and
  server-delivered policy that cannot be read honestly. The reduced honest core
  captures ~80% of the value (real verdict on all locally-readable sources) at ~20%
  of the surface, keeps the probe deterministic/host-independent for tests, and is
  the ONLY scope that never lies.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `claude-pretooluse-hook`: doctor's effective-execution requirement changes from
  "always reports `inconclusive`, never a gate" (4a) to "reports the fail-closed
  3-way verdict and gates the exit code". `runnable` ONLY when every relevant
  source is readable AND none blocks; any unreadable/server-delivered/unknown
  source → `inconclusive` (NEVER promoted); any flag set → `blocked` with the
  source recorded in `blockers`.

## Execution Verdict Contract (fail-closed)

| Condition | status | exit |
|-----------|--------|------|
| every relevant source readable AND no blocking flag | `runnable` | 0 |
| any blocking flag (`disableAllHooks`/`allowManagedHooksOnly`) set | `blocked` | 1 |
| any source unreadable / server-delivered / unknown | `inconclusive` | 2 |

`inconclusive` is NEVER promoted to `runnable`/`blocked`. A false `runnable` is the
single unacceptable outcome. `execution.status` is an axis INDEPENDENT of
`report.healthy` (two axes — a healthy install can still be `blocked`).

## Test-Supersession & Exit-Code Change (intentional contract change)

The 3 existing 4a tests asserting "doctor always exits 0 / never RUNNABLE"
(`claude-hooks.test.ts:134,152,163`) are DELIBERATELY superseded. They must be
rewritten (not silently broken) to assert: `runnable`→0, `blocked`→1,
`inconclusive`→2, and that `runnable` appears only when the fixture proves every
source clear. This is a documented, intentional contract change over 4a's stub.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/claude-hook-settings.ts` | Modified | Add pure scalar blocking-flag classifier |
| `src/lib/claude-hook-manager.ts` | Modified | New source probes + `execution` field on report |
| `src/commands/claude-hooks.ts` | Modified | Real matrix renderer + 3-way exit gate |
| `src/commands/claude-hooks.test.ts` | Modified | Rewrite 3 superseded tests + add matrix cases |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| False `runnable` (the unacceptable outcome) | Low | Fail-closed: any unknown source forces `inconclusive`; unit tests lock the promotion ban |
| `inconclusive` is the COMMON real-world verdict (server-managed/enterprise envs can never be proven clear) | High | Accepted by user — this is the fail-closed contract working, not a defect; renderer lists `unknownSources` so the user sees WHY |
| Safe-mode env only reflects the doctor's own process | Certain | Explicit caveat in output; env check never alone promotes to `runnable` |
| Downstream depends on old always-0 exit | Low | Exit 2 was reserved by 4a; supersession documented in tests |

## Rollback Plan

Revert the 4b commit(s). The `execution` slot returns to unused, `renderDoctor`
returns to the hardcoded `inconclusive` line + `return 0`, and the 3 restored 4a
tests re-assert the stub contract. No persisted state or migration is involved.

## Dependencies

- Slices 1-3b + 4a merged/archived (done). Reuses `safeReadFile` (unreadable ≠
  absent) and the Slice-2 pure/impure boundary.

## Success Criteria

- [ ] `execution: { status; blockers; unknownSources }` present on every doctor report.
- [ ] `runnable`+exit 0 ONLY when all relevant sources are readable and none block.
- [ ] Any blocking flag → `blocked`+exit 1 with the source in `blockers`.
- [ ] Any unreadable/server-delivered/unknown source → `inconclusive`+exit 2, never promoted.
- [ ] Matrix output is deterministic and ordered (blockers then unknownSources).
- [ ] The 3 superseded 4a tests are rewritten to assert the 3-way gate; suite green.
- [ ] No shelling out to the `claude` binary anywhere in the diff.
