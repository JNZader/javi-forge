# Tasks: agent-agnostic-codex

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | S0 ~150-250 · S1 ~150 · S2 ~250-350 (split if >400) |
| 400-line budget risk | Medium (per-slice Low; S2 may split doctor/install) |
| Chained PRs recommended | Yes |
| Suggested split | PR-1 S0 core-extraction → PR-2 S1 apply_patch → PR-3 S2 adapter+install+doctor |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| S0 | Inject per-agent config; Claude byte-identical | PR-1 | `pnpm test -- skillguard` | Claude prev-denied event still denies | `.mjs` AGENT_CONFIGS + manifest historical[] revertable alone |
| S1 | apply_patch path parser + matcher (3vr) | PR-2 | `pnpm test -- apply-patch` | Real captured codex apply_patch envelope | parseApplyPatchPaths + matcher removable |
| S2 | Codex adapter + install + doctor | PR-3 | `pnpm test -- codex-adapter` | Real codex install+deny on this box | Codex adapter + CLI registry entry removable |

## Phase S0: core-extraction (PR-1, behavior-identical) — RED→GREEN

- [x] S0.1 RED→GREEN: Claude prev-denied/allowed events still produce byte-identical verdicts through the real `--agent=claude` packaged process (integration exec corpus + parity probes).
- [x] S0.2 RED→GREEN: missing/unknown `--agent` → fail-closed `denyAndExit` exit 2 with `invalid-config` stderr.
- [x] S0.3 RED→GREEN: outgoing asset+settings SHAs appended to manifest `historical[]` so an installed prior copy classifies `released-outdated` (existing classifyAssetState/classifySettingsEntry historical→released-outdated tests + guard-test historical pins).
- [x] S0.4 GREEN: frozen `AGENT_CONFIGS` map `{managedSet, projectDir:{envVar|null}, marker}` in shared `.mjs`; Claude entry = today's EXACT values; codex defined minimally.
- [x] S0.5 GREEN: parse `--agent=<id>` in `main()`; unknown/missing → `fail("invalid-config")` → main catch → `denyAndExit` exit 2.
- [x] S0.6 GREEN: `isManaged` (managedSet+projectRoot params) + threaded `resolveProjectRoot` (Claude=`CLAUDE_PROJECT_DIR` else cwd); `evaluate*`/utility state machines byte-untouched (call sites only).
- [x] S0.7 GREEN: appended outgoing asset sha (`5dc2a5…`) + outgoing settings canonical (`038c59…`) to manifest `historical[]`; Claude install command → `node <asset> --agent=claude`; updated fixture, doctor commandShapeExact, guard test.

## Phase S1: apply_patch shim (PR-2, security-critical, 3vr) — RED→GREEN

- [x] S1.1 RED: managed path add/update/delete → deny; benign path → allow.
- [x] S1.2 RED: multi-file patch with one managed path → deny (fail-closed).
- [x] S1.3 RED: malformed/truncated/no-Begin/no-End/zero-path/NUL/non-string → deny.
- [x] S1.4 GREEN: `parseApplyPatchPaths(command)` — require `*** Begin Patch`/`*** End Patch`; extract every `*** Add/Update/Delete File:` (+ confirmed-present `*** Move to:`); reject NUL/truncated/zero-path.
- [x] S1.5 GREEN: canonicalize each path relative to cwd; run `evaluateFile("apply_patch", ...)` (WRITE class) per path; any managed/sensitive/canonicalize-fail → DENY.
- [x] S1.6 GREEN: wire `apply_patch` matcher into `evaluateEvent`.
- [x] S1.7 VERIFY: confirmed exact apply_patch grammar against a REAL captured codex-cli 0.147.0 envelope (2026-08-18); `*** Move to:` CONFIRMED emitted for renames.

## Phase S2: codex adapter + install + doctor (PR-3, split doctor/install if >400) — RED→GREEN

- [x] S2.1 RED→GREEN: install writes `~/.codex/hooks.json` + `config.toml [features] hooks=true`; idempotent re-run (`codex-hook-manager.test.ts` install suite, fake secure-fs).
- [x] S2.2 RED→GREEN: `[features] hooks=false` → doctor blocked; no `[hooks.state."<path>:pre_tool_use:0:0"]` (untrusted) → blocked; asset SHA ∉ manifest → blocked; hooks.json missing/foreign → blocked (doctor execution-matrix suite).
- [x] S2.3 RED→GREEN: CLI routes `codex`; unknown agent → usage + exit 1 (`src/cli/dispatch/hooks.test.ts` + `codex-hooks.test.ts`).
- [x] S2.4 GREEN: `AgentAdapter` interface `{id, configPaths, managedSet, projectDir, settingsSchema(reuse claude-hook-settings), marker, emitDeny, trust:{detect, grantCommand}}` in `src/lib/agent-adapter.ts`; Claude + Codex both implement (chose ADDITIVE routing — Codex through adapter, Claude keeps its exact existing path → byte-identical).
- [x] S2.5 GREEN: Codex install via secure-fs transaction (SAME ancestor gate — additive `layout` seam on `runTransaction`, proof primitives untouched); write hooks.json + features; DETECT trust; when untrusted report exact "run codex and approve the hook" step (report-the-trust-step, NOT compute-and-write).
- [x] S2.6 GREEN: Codex doctor reuses ExecutionReport `{runnable|blocked|inconclusive}` (precedence blocked>inconclusive>runnable) + `probeNodeOnPath` heuristic.
- [x] S2.7 GREEN: generalized `src/cli/dispatch/hooks.tsx` `!== "claude"` → lazy agent-command registry accepting `claude`+`codex`; unknown/missing → usage + exit 1.
- [x] S2.8 ACCEPTANCE (REAL, codex-cli 0.147.0 on this Linux box): secure install into throwaway HOME; real `codex exec` (gpt-5.6-sol) attempted `apply_patch *** Update File: .claude/settings.json` → PreToolUse hook FIRED + BLOCKED (`path.managed-config`), file not modified. Untrusted (non-bypass) run SKIPPED the hook (managed file WAS written) → confirms doctor `blocked`. Real `~/.codex` untouched; throwaways cleaned.

## Untouched (guard)

`evaluate*` engine, utility state machines, secure-fs POSIX/Windows + transaction proof, Claude OBSERVABLE behavior, settings-schema classifier, Windows adapter.
