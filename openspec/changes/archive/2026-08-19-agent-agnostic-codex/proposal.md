# Proposal: Agent-Agnostic SkillGuard — Codex CLI Adapter

## Intent

SkillGuard's PreToolUse guard (policy engine + secure-fs + transactional install +
doctor) is shipped and hardened for Claude Code. The engine is already agnostic; only
Claude-specific literals are baked into the runtime `.mjs` and the TS install/dispatch
layer. Extend the guard to the **Codex CLI** via a shared agnostic core plus a thin Codex
adapter, so a second agent gets the same file-write and Bash protection.

**Verified Codex model (source of truth: engram `sdd/agent-agnostic/codex-model`, id 15743,
against codex-cli 0.147.0 + real captured envelopes)** — motivation, not assumption:
- Hooks are STABLE + default-ON (`[features] hooks=false` disables). Config: `~/.codex/hooks.json`
  + repo-local `<repo>/.codex/hooks.json` (+ config.toml). Schema IDENTICAL to Claude Code.
- Envelope MATCHES the shipped `.mjs` byte-for-byte (`cwd`, `hook_event_name`, `tool_name`,
  `tool_input`, `session_id`, ...). Deny via exit-2+stderr is DROP-IN.
- Bash protection is DROP-IN (`tool_name:"Bash"`, `tool_input.command` string).

## Agnostic split (engram `sdd/agent-agnostic/explore`, id 15733)

Already agnostic: `evaluate*` pure policy engine, secure-fs (posix/windows/transaction),
doctor skeleton, node-probe. Claude-specific to EXTRACT into injected per-agent config:
`isManaged()` protected-path set, `${CLAUDE_PROJECT_DIR}` expansion, `MANAGED_MARKER`;
TS-side `.claude/` paths, settings-schema classifier, `resolveManagedSettingsPaths`,
execution-flag semantics, CLI `!== "claude"` dispatch.

## The three Codex shims (NOT a drop-in)

1. **apply_patch (file-write):** Codex delivers `tool_name:"apply_patch"` (NOT Edit/Write);
   target path is buried in `tool_input.command` patch text (`*** Add/Update/Delete File: <path>`),
   no `file_path`. Managed-config file-write rules DO NOT fire without a matcher + patch-path parser.
2. **project-dir:** no `CODEX_PROJECT_DIR`; `${CLAUDE_PROJECT_DIR}` expansion is unset → use
   the envelope `cwd` field.
3. **trust (SECURITY-CRITICAL):** Codex enforces per-hook trust via `trusted_hash` in
   `config.toml [hooks.state."<path>:pre_tool_use:0:0"]`. An UNTRUSTED hook is SILENTLY SKIPPED
   → installed-but-untrusted = the exact fail-open the whole arc prevents. Install MUST establish
   trust (compute + record hash) or document the bypass; doctor MUST detect untrusted → NOT running.

## Scope

### In Scope (slices)
- **Slice 0 — core-extraction** (behavior-identical for Claude): lift Claude literals out of the
  shared `.mjs` (`isManaged` path-set + project-dir env name) into an injected per-agent config
  object; parameterize the marker. Claude adapter supplies exact current values → byte-identical
  Claude behavior. Asset SHA may rotate → handle via manifest `historical[]`.
- **Codex adapter:** (a) adapter config (paths, project-dir=cwd, managed-path set, marker);
  (b) apply_patch shim (matcher + parse patch paths); (c) trust-aware install/repair (write
  `trusted_hash` or documented bypass) + transactional secure-fs write of `~/.codex/hooks.json`;
  (d) Codex doctor execution matrix (hooks-disabled, installed-but-untrusted → NOT running,
  reusing the 4b fail-closed skeleton); (e) CLI `hooks install|doctor|repair codex`.

### Out of Scope
- OpenCode (separate later arc — different in-process mechanism, partial subagent coverage).
- Any change to the Claude adapter's OBSERVABLE behavior (Slice 0 is behavior-identical).

## Capabilities

### New Capabilities
- `agent-adapter-core`: agnostic core + per-agent adapter config abstraction (injected managed-path
  set, project-dir source, marker); Claude adapter as the reference implementation.
- `codex-adapter`: Codex config paths, apply_patch file-write shim, trust-aware install/repair,
  Codex doctor execution matrix, CLI `codex` subcommand.

### Modified Capabilities
- `skillguard-pretooluse-hook`: `.mjs` reads injected config instead of hardcoded Claude literals
  (Claude behavior byte-identical).
- `skillguard-cli-dispatch`: generalize `!== "claude"` to per-agent dispatch.
- `skillguard-hooks-ownership-doctor`: add Codex execution matrix (hooks-disabled + trust state).

## Approach

Approach A — shared agnostic core + thin per-agent adapters (rejected B: per-agent forks triple
the audit surface of 700+ audited security lines). Sequence: Slice 0 de-risks the extraction with
zero Codex code (Claude keeps working), then the Codex adapter slices layer on top. Codex reuses
the same `.mjs` subprocess asset; only config + the three shims + install/doctor wiring are new.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs` | Modified | Extract literals → injected config; add apply_patch matcher + patch-path parser |
| `src/lib/*adapter*` (new) | New | Per-agent adapter config (Claude + Codex) |
| `src/lib/claude-hook-manager.ts` / settings classifier | Modified | Generalize managed-path/settings resolution per adapter |
| `src/cli/dispatch/hooks.tsx` | Modified | Per-agent dispatch (drop `!== "claude"`) |
| Codex trust wiring (`config.toml [hooks.state]`) | New | Compute + record `trusted_hash` on install |
| Manifest | Modified | `historical[]` entry for rotated `.mjs` asset SHA |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| apply_patch parser mis-parses paths → file-write bypass | Med | New security-relevant surface; dedicated parser tests + 3vr |
| Trust not established → guard silently not running (fail-open) | High | Install writes `trusted_hash`; doctor reports untrusted = NOT effectively running |
| Slice 0 asset-SHA rotation breaks Claude manifest match | Med | Manifest `historical[]` (like sensitive-paths bump precedent) |
| Codex hook API drift (stable but young) | Low | Pin against codex-cli 0.147.0; doctor detects hooks-disabled |

## Rollback Plan

Codex is additive: `hooks install codex` writes only Codex-owned paths transactionally; revert by
removing `~/.codex/hooks.json` entry + `trusted_hash`. Slice 0 is behavior-identical for Claude —
if the injected-config refactor misbehaves, revert the `.mjs` + adapter commit; the Claude manifest
`historical[]` keeps the prior asset SHA valid.

## Dependencies

- Installed codex-cli with hooks stable (verified 0.147.0). No new npm deps expected.

## Success Criteria

- [ ] Slice 0 lands with Claude behavior byte-identical (existing Claude tests green, manifest `historical[]` covers SHA rotation).
- [ ] Codex adapter installs `~/.codex/hooks.json` transactionally AND establishes hook trust (or documents the bypass).
- [ ] apply_patch shim fires managed-config file-write protection on `*** Add/Update/Delete File:` targets.
- [ ] Codex doctor reports installed-but-untrusted and hooks-disabled as NOT effectively running.
- [ ] **Real end-to-end on this box**: a Codex `apply_patch` against a managed path is DENIED, and an untrusted install is reported by doctor as not running.
- [ ] 3vr review passed (security-relevant: new file-write parser + fail-open trust gap).
