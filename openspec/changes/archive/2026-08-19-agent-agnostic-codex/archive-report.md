# Archive Report — agent-agnostic-codex

**Archived:** 2026-08-19
**Status:** COMPLETE — implemented, verified (PASS), merged to `main`, released `javi-forge@1.36.0`.
**Adds:** `agent-adapter-core`, `codex-adapter` (NEW). **Amends:** `skillguard-pretooluse-hook`,
`skillguard-cli-dispatch`, `skillguard-hooks-ownership-doctor`.

## Summary

Extends the SkillGuard PreToolUse guard beyond Claude Code to the **Codex CLI**, via a shared
agnostic core + a thin Codex adapter (Approach A). The user's original goal — make the guard
agent-agnostic — realized for its first additional agent, built entirely on the **live-binary-verified**
Codex model (codex-cli 0.147.0), not on contradictory docs.

3 chained slices, chain-collapsed → one release:
- **S0 core-extraction** (behavior-identical): the Claude-specific literals lifted out of the shared
  `.mjs` into an injected `AGENT_CONFIGS` registry selected by `--agent=<id>`; unknown/missing selector
  fail-closed; per-agent projectRoot; the pure `evaluate*` engine untouched. Claude byte-identical.
- **S1 apply_patch shim** (security-critical): Codex delivers file writes as `tool_name:"apply_patch"`
  with paths in the patch text (`*** Add/Update/Delete File:` + `*** Move to:` for renames —
  capture-verified). `parseApplyPatchPaths` extracts every target, resolves each LEXICALLY (no early
  realpath — mirrors Write/Edit) so `policyPathKeys` owns dual-key detection, runs the managed-config
  WRITE policy per path, fail-closed on any malformed patch.
- **S2 adapter/install/doctor/CLI**: install writes `~/.codex/hooks.json` + `config.toml` via the same
  transactional secure-fs (a new additive `TransactionLayout` seam; proof primitives byte-identical);
  the doctor's fail-closed execution matrix; the `AGENT_ADAPTERS` registry generalizing the CLI.

## The fail-open the arc turns on: Codex per-hook trust

Codex silently skips an UNTRUSTED PreToolUse hook (a `trusted_hash` in `config.toml`; no programmatic
trust API — trust is interactive). So an installed-but-untrusted guard is pure theater. The install
therefore **reports the trust step** (never fabricates a hash), and the doctor reports untrusted→**blocked**.
A hooks.json rewrite (upgrade) invalidates the now-stale trust rows so the doctor honestly reverts to
untrusted until re-approval — the fix for the convergent fail-open review finding.

## REAL acceptance

A live `codex exec` (codex-cli 0.147.0) apply_patch to `.claude/settings.json` was BLOCKED by the guard;
the same write untrusted was silently skipped and the doctor reported blocked/untrusted — end-to-end
proof on this box.

## Delivery

3 chained PRs #75 (S0) / #76 (S1) / #77 (S2), chain-collapsed (tree-verified S0-branch == full arc) →
single release `1.36.0` (main `11ded1b2`). Each `size:exception`. Review: S0 review + 1 MEDIUM fixed;
S1 3vr with a BLOCKER symlink bypass fixed + scoped re-review APPROVED; S2 2-voice with a CONVERGENT
fail-open fixed + 4 folds. Claude + the secure-fs proof engine untouched (byte-identical verified).

## Locked decisions

Approach A (shared core + per-agent adapters); config injection via `--agent=<id>` command arg on one
shared asset; per-agent projectRoot (Claude asset-root, Codex cwd); apply_patch lexical-first resolution;
trust = report-the-step + doctor detection (no compute-and-write); additive `TransactionLayout` (not a
fork); Codex reuses the shipped asset by absolute path. OpenCode deferred to its own arc.

## Spec sync

5 deltas merged into `openspec/specs/`: 2 new capabilities (agent-adapter-core, codex-adapter) + 3
amended (pretooluse-hook, cli-dispatch, hooks-ownership-doctor).

## Residuals / follow-ups

- **OpenCode adapter** (deferred second agent — in-process TS plugin, throw-to-deny, subagent-bypass
  partial coverage #5894) — its own arc.
- **apt CI hardening** (linux workflow `apt-get` retries + step timeout; flaked ~4× this session).
- **codex-hooks.ts renderer branch coverage** (76.74%, global passes).
- **trusted_hash content-hash residual** (documented; doctor invalidates on rewrite).

## Remaining arcs (the SkillGuard map)

Claude arc COMPLETE (1-4b) · Linux hardening COMPLETE · JD-P-001 COMPLETE · **Codex agnostic COMPLETE**.
Left: OpenCode adapter · container-engine-linux (podman/SELinux, needs Fedora) · macOS ancestor narrowing.

## Engram traceability

proposal 15746 / spec 15749 / design 15754 / tasks 15761 / codex-model 15743 / exploration 15733 /
apply-progress 15777 · topic prefix `sdd/agent-agnostic-codex/*` + `sdd/agent-agnostic/*`.
