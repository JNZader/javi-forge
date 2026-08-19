# Design: Agent-Agnostic SkillGuard — Codex Adapter

## Technical Approach

Approach A (proposal id 15746): keep the audited pure policy engine and secure-fs
untouched; add a per-agent **adapter** contract and a **Codex adapter**. Slice 0
lifts the two Claude literals out of the shared `.mjs` into an injected per-agent
config, behavior-identical for Claude. Then the Codex adapter adds an `apply_patch`
file-write shim, a trust-aware install/doctor, and a `codex` CLI subcommand. Grounded
in the live-binary facts pinned in engram id 15743 (codex-cli 0.147.0).

## Architecture Decisions

### Decision: Config injection = command-arg agent selector (single shared asset)

| Option | Tradeoff | Decision |
|--------|----------|----------|
| (a) env var → JSON config | Per-hook env is not reliably settable under either host; fragile | Reject |
| (b) per-agent thin entry importing shared engine | 2 assets + 2 SHAs; changes install/asset model | Reject |
| (c) `node <asset> --agent=<id>`, embedded config registry | ONE asset, ONE manifest SHA, arg injected by install writer, works identically under both hosts (`command:"node <asset> <args>"`) | **Choose** |

**Rationale**: (c) keeps the manifest `historical[]` SHA-rotation model intact and the
`evaluate*` engine pure. The asset gains a frozen `AGENT_CONFIGS` map keyed by agent id:
`{ managedSet, projectDir: {envVar|null}, marker }`. `--agent` missing/unknown →
fail-closed (`throw "invalid-config"` → exit 2). Claude's entry supplies today's exact
values (`.claude/...` set, `CLAUDE_PROJECT_DIR`, `claude-pretooluse` marker) → byte-behavior
identical. Claude asset SHA rotates once via `historical[]` (behavior unchanged).

### Decision: project-dir resolution per agent

`canonicalizePolicyPath` (`.mjs:62-67`) and `isManaged` (`:117-127`) currently derive
`PROJECT_ROOT` from the asset directory + expand `${CLAUDE_PROJECT_DIR}`. Under Codex the
asset lives at `~/.codex/...`, NOT in-repo, so asset-relative root is wrong. Config
resolves project root: Claude = env var (unchanged); Codex = **envelope `cwd`** (always
present, required field per id 15743). `isManaged` takes the resolved root as a param
instead of the module constant.

### Decision: apply_patch file-write shim (NEW security surface)

Codex delivers `tool_name="apply_patch"`, patch text in `tool_input.command`, **no
`file_path`** (id 15743). `evaluateEvent` (`:745-753`) must, for `apply_patch`, extract
EVERY target path, canonicalize each vs `cwd`, and run `evaluateFile` per path. The pure
`evaluateFile`/`isManaged`/`isSensitivePolicyKey` engine is reused unchanged.

## Interfaces / Contracts

### apply_patch parser (precise pseudocode)

```
parseApplyPatchPaths(command) -> string[] | FAIL:
  if typeof command !== "string": FAIL("invalid-event")
  lines = command.split(/\r?\n/)
  if lines[0].trim() !== "*** Begin Patch": FAIL("invalid-event")   # fail-closed
  seenEnd = false; paths = []
  for line in lines[1..]:
    if line.trim() === "*** End Patch": seenEnd = true; break
    m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line)
    if m: paths.push(m[2]); continue
    mv = /^\*\*\* Move to: (.+)$/.exec(line)      # rename target (defensive)
    if mv: paths.push(mv[1]); continue
    # body lines (+/-/space/@@/index) are ignored
  if !seenEnd: FAIL("invalid-event")             # truncated patch
  if paths.length === 0: FAIL("invalid-event")   # header-less → cannot prove safe
  return paths   # trimmed; reject any containing "\0" -> FAIL
```

Then: `for p of paths: if !evaluateFile("apply_patch", canonicalize(p, {base: cwd})).allowed: return deny`. `apply_patch` treated as a write tool (not `Read`) so the managed-config rule fires.

### Fail-closed rules (apply_patch)
1. Non-string command, missing `*** Begin Patch`, or missing `*** End Patch` → DENY.
2. Zero extractable paths → DENY (a patch touching files we can't parse could hide a managed-path write).
3. Any path containing NUL or that fails canonicalization → DENY.
4. Multi-file patch: ALL paths checked; ANY managed/sensitive hit → DENY.
5. Any parser throw → the existing `main()` catch → `denyAndExit` (exit 2). Fail-open residual (spawn/timeout, `.mjs:6-7`) is the host's, unchanged.

### THE TRUST MECHANISM — resolution

**Verified (engram id 15743, live binary 2026-08-18)**: hooks are stable + default-ON;
each hook needs a `trusted_hash` in `~/.codex/config.toml` under
`[hooks.state."<abs-hook-path>:pre_tool_use:0:0"]`; **untrusted hooks are silently
skipped** unless `--dangerously-bypass-hook-trust`. **NOT verified** (no Bash/WebFetch in
this phase): the exact hash algorithm (sha256 of the command string vs hook file vs config
entry) and whether a `codex hooks trust` subcommand exists.

**Strategy = report-the-trust-step + doctor detection (fail-closed).** We do NOT
compute-and-write a `trusted_hash` we cannot prove reproducible: a wrong-but-present hash
would still leave the hook skipped while making doctor believe it is trusted — the exact
fail-open theater this arc exists to kill. Install therefore:
(i) writes `~/.codex/hooks.json` + `config.toml [features] hooks` via secure-fs transaction;
(ii) at apply-time probes `codex hooks --help` / `codex --help`; if a native trust
subcommand exists, invoke it (safest programmatic path); else
(iii) doctor reports `NOT effectively running — grant trust with: <exact command>`.

Config shape written transactionally (secure-fs `TransactionComponent{path,desired}`):
```toml
[features]
hooks = true
# [hooks.state."<abs>:pre_tool_use:0:0"] trusted_hash — written ONLY if the
# algorithm is confirmed reproducible during Slice apply; else left to codex/user.
```
`hooks.json` = Claude-identical schema: `{hooks:{PreToolUse:[{matcher, hooks:[{type:"command", command:"node <asset> --agent=codex", timeout}]}]}}`.

### Codex doctor / execution matrix (reuse ExecutionReport `runnable|blocked|inconclusive`)

| Probe | blocked when | Source |
|-------|--------------|--------|
| `[features] hooks` | `= false` | `config.toml` |
| **trust state** | no `[hooks.state."<path>:...:0:0"]` entry (untrusted → NOT running) | `config.toml` |
| asset currency | asset SHA ∉ manifest current∪historical | manifest |
| settings/registration | `hooks.json` entry missing/foreign | `hooks.json` |
| node-on-PATH | absent / `<` min major (heuristic, `manager:700`) | PATH |

Verdict precedence `blocked > inconclusive > runnable` reused from `ExecutionReport`
(`manager:342-357`). Codex hook is `command:"node …"` (id 15743) → node-on-PATH row applies unchanged.

### Adapter interface + CLI

```ts
interface AgentAdapter {
  id: "claude" | "codex";
  configPaths: { hooksFile: string; featuresFile?: string; dropInDir?: string };
  managedSet: string[];              // relative protected paths -> AGENT_CONFIGS
  projectDir: { envVar: string | null }; // null => envelope cwd
  settingsSchema: SettingsClassifier; // reuse claude-hook-settings (identical schema)
  marker: string;
  emitDeny: "exit2+stderr";          // shared -> both hosts
  install/doctor/repair(cwd): Promise<number>;
  trust?: { detect(cfg): TrustState; grantCommand(hookPath): string };
}
```
Generalize `src/cli/dispatch/hooks.tsx:36` from `cli.input[2] !== "claude"` to an
**agent registry** lookup (`REGISTRY[cli.input[2]]`); unknown agent → usage + exit 1.
Reuse `secure-fs-transaction.ts` for all `~/.codex/*` writes.

## Threat Matrix (applicable — new parser + process integration)

| Row | Applicable | Safe/failure behavior | RED test |
|-----|-----------|-----------------------|----------|
| Executable-file/path classification | Yes | apply_patch multi-path canonicalized vs cwd; managed hit → DENY | patch adding `.claude/settings.json` → exit 2 |
| Malformed/truncated input | Yes | missing Begin/End, 0 paths, NUL → DENY (exit 2) | fuzz truncated patch → deny |
| Process integration (trust fail-open) | Yes | untrusted install → doctor `blocked`, never silent-runnable | doctor on untrusted hook → blocked |
| project-dir spoof | Yes | codex uses envelope `cwd`; relative escape normalized by `canonicalizePolicyPath` | patch with `../` to managed → deny |

## Migration / Rollout

Slice 0 changes only the asset (SHA rotates via `historical[]`), no Claude behavior change.
Codex adapter is additive (new CLI target, new `~/.codex` writes). No data migration.

## Slice / PR plan

| Slice | Scope | Size / budget |
|-------|-------|---------------|
| **0 core-extraction** | AGENT_CONFIGS registry + `--agent`; param `isManaged`/project-root; Claude byte-behavior identical; manifest SHA rotate | S (~150-250 LOC, low risk) |
| **1 apply_patch shim** | parser + `evaluateEvent` apply_patch branch + fail-closed tests | S-M (~150 LOC, security-critical, 3vr) |
| **2 codex adapter + install/doctor** | AgentAdapter iface, codex config paths, secure-fs writes, feature/trust/currency doctor matrix, CLI registry | M (~250-350 LOC) |

Likely 3 PRs. **Stays untouched**: `evaluate*` engine + utility state machines, secure-fs
POSIX/Windows + transaction proof logic, Claude adapter observable behavior, settings
classifier schema. 400-line budget: Slice 2 nears it — split doctor from install if it exceeds.

## Open Questions (sub-decisions flagged)

- [ ] **Trust strategy (highest risk)**: compute-and-write `trusted_hash` (only if the
  algorithm is proven reproducible during Slice-2 apply against the live binary) vs
  report-the-command. Design defaults to REPORT + doctor-detect; upgrade only on proof.
- [ ] Confirm `*** Move to:` appears in real codex apply_patch output (design extracts it defensively regardless).
- [ ] Confirm whether a native `codex hooks trust` subcommand exists (`codex hooks --help`) for the programmatic path.
- [ ] Acceptance = real Codex install + `apply_patch` against a managed path DENIED end-to-end on this box, and untrusted install reported `blocked` by doctor.
