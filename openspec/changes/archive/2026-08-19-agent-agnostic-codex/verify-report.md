# Verify Report — agent-agnostic-codex

**Status: PASS** · CRITICAL: 0 · WARNING: 0 · (1 CONVERGENT MEDIUM fail-open + 1 BLOCKER bypass, both fixed pre-merge)
**Verified:** 2026-08-19 · main `11ded1b2` · shipped in `javi-forge@1.36.0`

## Executive summary

The SkillGuard PreToolUse guard now serves Codex CLI as well as Claude Code, via a shared
agnostic core + a thin Codex adapter. 3 chained slices (S0 core-extraction, S1 apply_patch
shim, S2 adapter/install/doctor/CLI), chain-collapsed → single release. Claude's observable
behavior is byte-identical throughout. **REAL end-to-end acceptance passed**: a live
`codex exec` apply_patch to a managed config path was BLOCKED by the guard, and the doctor
honestly reports the untrusted fail-open state as `blocked`.

## Requirement coverage (5 capabilities / 15 requirements / 32 scenarios — PASS)

- **agent-adapter-core (NEW)** — the `.mjs` per-agent config via `--agent=<id>` (`AGENT_CONFIGS`,
  fail-closed on unknown/missing selector); per-agent projectRoot (Claude asset-root, Codex cwd);
  the pure `evaluate*` engine untouched. Claude byte-identical (S0).
- **codex-adapter (NEW)** — install writes `~/.codex/hooks.json` + `config.toml [features] hooks=true`
  via the same transactional secure-fs; the apply_patch file-write shim; report-the-trust-step +
  the untrusted→blocked doctor; CLI `codex` subcommand.
- **skillguard-pretooluse-hook (delta)** — the `--agent` injection + the apply_patch matcher.
- **skillguard-cli-dispatch (delta)** — the agent registry (`AGENT_ADAPTERS`), unknown→exit 1.
- **skillguard-hooks-ownership-doctor (delta)** — the Codex execution matrix.

## The verified Codex model (live-binary, codex-cli 0.147.0)

Envelope MATCHES the shipped `.mjs`; deny = exit-2+stderr (drop-in); hooks stable+default-on;
config `~/.codex/hooks.json` + `config.toml`. NEEDS-SHIM (all implemented): file writes arrive as
`tool_name:"apply_patch"` (path in patch text incl. `*** Move to:` for renames — capture-verified);
no project-dir env var (use `cwd`); per-hook TRUST (`trusted_hash` in config.toml — untrusted =
silently skipped = the fail-open the doctor detects; no programmatic trust API → report-the-step).

## Reviews (per slice)

- **S0**: adversarial review CLEAN + 1 MEDIUM fixed pre-PR (env-unset projectRoot fallback followed
  cwd → a managed-write gap; per-agent fallback fix, byte-identical proven).
- **S1 (3vr, security surface)**: voice 1 found a **BLOCKER** — the shim realpath'd before
  `evaluateFile` so a symlinked `.claude` escaped the managed check (apply_patch bypass while Write
  denied). FIXED (lexical-first `lexicalizePolicyPath`, apply_patch≡Write); scoped re-review APPROVED
  (bypass closed, `canonicalizePolicyPath` extraction behavior-preserving, divergence=0). Voices 2+3
  CLEAN + folded a real-envelope golden + absolute/CRLF fixtures.
- **S2 (2 voices)**: CLEAN except 1 **CONVERGENT MEDIUM fail-open** (both voices) — a stale
  `[hooks.state]` trust entry after a hooks.json rewrite reported runnable. FIXED with TDD (rewrite
  invalidates our stale trust rows → doctor untrusted→blocked; no-op preserves valid trust) + 4
  quality folds (single-source registry, `--force`, seam runtime guard, fail-closed doctor tests).
  The `TransactionLayout` generalization verified behavior-preserving for Claude/POSIX/Windows.

## REAL end-to-end acceptance (S2.8, this Linux box, codex-cli 0.147.0)

Guard installed as a Codex PreToolUse hook (throwaway HOME); a real `codex exec` apply_patch to
`.claude/settings.json` → **BLOCKED** ("`.claude/settings.json was not modified`"). The same write
untrusted → silently skipped (fail-open) → doctor reported `blocked/untrusted`. Install→blocked/untrusted,
grant-trust→runnable/trusted, re-install→idempotent.

## Gates

- Final merge: `test` + `runtime` (windows) + both linux legs green; release → 1.36.0. Chain-collapse
  tree-verified (S0-branch == full arc). Local: coverage 91.77 lines / 82.25 branches (≥85/80); the
  `.mjs` asset SHA-rotated only in S0/S1 (S2 reuses it), historical[] absorbs each; Claude regression
  + 24 tx + 141 secure-fs green.
- Known non-issue: `src/e2e/aggressive.e2e.test.ts` local flake (pre-existing, env). The linux CI
  with-acl leg flaked twice on `apt-get` mirror hangs (re-run green) — a resilience follow-up.

## Size

3 chained PRs (#75/#76/#77), each `size:exception`.

## Residuals / follow-ups

- **OpenCode adapter** — the deferred second agent (in-process TS plugin, throw-to-deny, a known
  subagent-bypass partial-coverage gap #5894) — its own arc.
- **apt CI hardening** — the linux workflow's `apt-get` step should get retries + a step-level
  timeout (flaked ~4× this session; re-run always fixed it). A tiny workflow-only follow-up.
- **codex-hooks.ts renderer branch coverage** 76.74% (below 80 per-file; global passes) — a few
  renderer tests.
- **trusted_hash content-hash residual** — the doctor invalidates the trust entry on rewrite; if
  codex ever hashes asset content, the residual note documents re-approval is required.

## Verdict

PASS. In trunk (`11ded1b2`), released `1.36.0`, real Codex deny verified end-to-end, both a BLOCKER
bypass and a CONVERGENT fail-open fixed pre-merge, Claude byte-identical. Ready for archive.
