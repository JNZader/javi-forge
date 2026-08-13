# Exploration: skillguard-runtime-gate (main @ 24661957)

> Mirror of engram `sdd/skillguard-runtime-gate/explore`. Hybrid store: this file + engram topic_key `sdd/skillguard-runtime-gate/explore`.

Objective: find every point where skills/plugins enter the machine and recommend where a fail-closed runtime gate must consume the skillguard scanner verdict so that `block` / `unscannable` skills are rejected at install/registration time. Change name: `skillguard-runtime-gate`.

## Verified current state (all verified file:line)

### 1. The scanner is 100% latent — verified
- `grep skill-scanner` yields exactly ONE match in the whole repo: `src/lib/skill-scanner.test.ts:19`. There is NO production import. The gate we build in this change is the scanner's FIRST production consumer.
- API surface (`src/lib/skill-scanner.ts`): `SkillScanVerdict` incl. `unscannable` (:48), `isRejectedVerdict()` (:57 — returns true ONLY for `block` | `unscannable`), `scanSkillContent` (:313), `computeVerdict` (:371), `scanSkillFile` (:433), `scanSkillsDirectory` (:506), `formatScanReport` (:550), `formatBatchReport` (:599).
- The `unscannable` verdict doc (:42-47) already mandates fail-closed treatment ("file could not be read → treat as rejected"); the scanner itself never throws for missing/binary/oversized files (tests :706-737) — it returns `unscannable`. So the gate only needs `isRejectedVerdict()` — blocking semantics already live in the scanner.

### 2. Install / registration paths (the gate candidates)
- **(A) `javi-forge plugin add <source>`** → `runPluginAdd` (`src/commands/plugin.ts:33`) → `installPlugin` (`src/lib/plugin.js` import at `src/commands/plugin.ts:10`). `installPlugin` performs STRUCTURAL validation only (plugin.json exists, name kebab-case, semver) — confirmed from `src/lib/plugin.test.ts` test names. NO security scan anywhere in this path. This is the primary entrypoint for third-party skills (plugins) entering the machine.
- **(B) `javi-forge skills auto-install`** (`src/cli/dispatch/skills-cmd.tsx:20` — valid actions doctor|budget|score|benchmark|auto|auto-install) → `autoInstallSkills` (`src/lib/auto-skill-install.ts:43`) copies skill folders into the skills dir. COPY-ONLY, NO scan.
- **(C) `init` step agent-skills** (`src/lib/agent-skills.ts`) writes an empty `skills.json` manifest (no skill content copied at init — low risk).
- **(D) `publishSkill`** (`src/lib/skill-publish.ts:50`) packages a skill dir → `plugin.json` for marketplace distribution. Publish path (supply-chain), NO scan.
- `src/commands/security.ts` is a dependency-audit baseline command (`security-baseline.json`), NOT a skill scanner — do not confuse.
- `registryGate` (`src/commands/skills/scoring.ts:361`) is a QUALITY threshold gate (score %, default 60 in `src/commands/skills/constants.ts:20`), ALSO latent (re-exported at `src/commands/skills.ts:34`, referenced only by tests). Not a security gate; keep separate.

### 3. Existing gate patterns in this codebase (style to follow)
- **Git hook install w/ SHA256 manifest**: `installCIHooks` (`src/commands/ci.ts:2422`), `MANIFEST_PATH` `assets/hooks/manifest.json` (pre-commit v2, pre-push v3, commit-msg v2). Generated hooks are BASH dispatchers (`assets/hooks/pre-commit`, `assets/hooks/pre-push`) → `javi-forge hooks run <name>` → exit 1 on failure. NOTE: javi-forge generates GIT hooks, NOT Claude Code PreToolUse hooks — there is NO existing PreToolUse-generation surface in this repo (that is a NEW artifact, see risks).
- **Hook section model** (`src/commands/hooks.ts`): `HookSection {id, blocking, run()}`, `SectionId = "secrets"|"permissions"|"tdd"|"deps"|"ci"`, `PRE_COMMIT_ORDER = [secrets, permissions, tdd, ci]`, `PRE_PUSH_ORDER = [deps, tdd, ci]`. Natural extension point if a runtime scan section is ever wanted.
- **Fail-closed config loader** (`src/lib/ci-config.ts`): `CIConfigError`, never returns partially-valid config — the house style for "if anything is off, refuse".

### 4. Reference pattern (microsoft/agent-governance-toolkit — fetched from GitHub raw, NO local checkout exists)
- `agent-governance-claude-code/hooks/hooks.json`: `PreToolUse` hook → `${CLAUDE_PLUGIN_ROOT}/bin/agt-node` + `hooks/pre-tool-use.mjs`, `timeout: 30`.
- `hooks/pre-tool-use.mjs`: `try { readHookInput; loadPolicy; evaluatePreToolUse } catch (e) { stderr "AGT governance denied the tool call because policy evaluation failed closed: ..." ; process.exit(2) }` — fails closed on ANY error.
- `lib/policy.mjs`: `USER_POLICY_ENV = AGT_CLAUDE_POLICY_PATH`, `AUDIT_PATH_ENV = AGT_CLAUDE_AUDIT_PATH`, `SUPPORTED_POLICY_SCHEMA_VERSION = 1`.
- `agent-governance-opencode/config/default-policy.json`: `"denyOnPolicyError": true`, `blockedToolCalls` commandPatterns (`rm -rf`, `curl|sh`, `wget|sh`, metadata endpoints 169.254.169.254 / 100.100.100.200 / metadata.google.internal).
- `_hardening.py` (env-var denylist LD_PRELOAD/NODE_OPTIONS/PYTHONSTARTUP) → 404 on current main. NOT verified from source. Flag as UNVERIFIED — do not cite as fact in design without re-checking.

## Where a gate can live — integration point comparison

| Option | Where | Pros | Cons |
|---|---|---|---|
| **(a) CLI install-time gate** | `installPlugin` (`src/lib/plugin.ts`) + `autoInstallSkills` (`src/lib/auto-skill-install.ts:43`); scan plugin's `skills/*/SKILL.md` via `scanSkillFile`/`scanSkillsDirectory`, refuse install when ANY verdict `block`/`unscannable` | Zero new artifact infra; reuses latent scanner + `isRejectedVerdict`; testable in vitest; blocks at the moment unconditioned code enters the machine; both entrypoints already route through these helpers | Does not protect skills copied by hand or by other tools; `skills auto` copies from node_modules (already-supplied) — needs semantics decision (advisory vs strict) |
| **(b) Generated PreToolUse hook** | shim hook + `javi-forge hooks run <tool-use>`-style dispatch, mirroring agent-governance-toolkit | Real-time protection at tool-invocation; matches reference pattern | **No existing generation surface** — git-hook generator ≠ agent-tool hook; new install/update/classify machinery, new manifest entries, runtime dep on CLI in hook; biggest effort |
| **(c) Both (gate now, hook later)** | (a) for install-time, (b) as follow-up slice via `src/commands/hooks.ts` `SectionId` extension | Defense in depth; install-time gate buys suppression of poisoned entry while hook infra is built separately | Two deliverables; (b) still carries all its cons |

## Recommendation
**Option (a) — CLI install-time gate**, in this order of hardening:
1. `installPlugin` (`src/lib/plugin.ts`) — after structural validation, before/at copy out of the temp dir: run `scanSkillsDirectory` (or `scanSkillFile` per skill) on the staged plugin's skills, and refuse install (return `{ success: false, error }`) iff `isRejectedVerdict(verdict)` for any scanned skill.
2. `autoInstallSkills` (`src/lib/auto-skill-install.ts:43`) — same gate per copied skill.
3. Gate BEFORE files land in `PLUGINS_DIR`/skills dir — scan the staging/intermediate location, not the final one (risk G-1).

Rationale: the scan blocking semantics already exist and are tested (`isRejectedVerdict`, fail-closed `unscannable`); the only missing piece is a CALL SITE. A PreToolUse hook (option b) has no existing generation surface in javi-forge and duplicates the whole hardened-install machinery for a brand-new artifact — disproportionate for this change; if a runtime hook is later wanted, `src/commands/hooks.ts` `SectionId` composition is the extension point (design-phase decision).

Required design-phase decisions for the user (see Propose-phase decisions).

## Test surface
- Scanner correctness already covered: `src/lib/skill-scanner.test.ts` — real-fs tmpdir integration `scanSkillFile`/`scanSkillsDirectory` (:661-768; binary/missing/oversized → `unscannable` + `isRejectedVerdict`, hidden-payload past column 10k → `block`, directory continues past binary), plus `isRejectedVerdict` unit tests earlier in the file.
- `src/lib/plugin.test.ts` mocks fs-extra wholesale (:5-17) — `installPlugin` gate tests must either mock `../skill-scanner.js` and assert call/refusal, or use a real tmpdir like the scanner tests do (house style for fs integration).
- `src/commands/plugin.test.ts` mocks `../lib/plugin.js` entirely (:5-12) — `runPluginAdd` gate propagation tests assert step detail text ("install failed: ...").
- `src/lib/auto-skill-install.test.ts` exists — add gate cases there.
- NEW tests for the gate itself: reject on `block`, reject on `unscannable` (missing/binary/oversized), pass through on `pass`, behavior under scanner-throw (expect fail-closed, scanner never throws by design — but gate MUST NOT swallow).
- House test framing: vitest 4, strict TDD (`opencode/config.yaml` `strict_tdd: true`), coverage lines 85 / branches 80, mutation testing via stryker.

## Risks
- **G-1 (high): race of placement.** Gate must run BEFORE skill files are written to their final location; scanning the final dir after copy leaves the window where a scanner-refusal still leaves files on disk. Mitigation: scan staged/intermediate path; if refusal, remove staging dir.
- **R-1 (high): reference API instability.** agent-governance-toolkit scheme broke between versions (v4→v5 per handoff); we IMITATE the fail-closed pattern only, never depend/vendor it. Do not pin behavior to their internals.
- **H-1 (medium): `_hardening.py` env-var denylist unverified.** The 404 means the handoff's LD_PRELOAD/NODE_OPTIONS/PYTHONSTARTUP denylist could not be confirmed from source. Design must either re-verify or omit those specifics.
- **L-1 (medium): scanner latency.** Zero production consumers today — the gate is debut usage; it has no regression baseline beyond its own new tests (which must cover `pass`/`block`/`unscannable`/throw).
- **L-2 (medium): `skills auto-install` false positives.** It copies from node_modules (developer-supplied, already on disk) — a strict gate there may block legitimate local skills; decision needed: advisory report vs strict refusal vs `--force`.
- **V-1 (low): developer trust friction.** Refusing installs without an escape hatch will annoy; decide `--force` semantics explicitly (mirror existing `--force` conventions in hooks/security).
- **P-1 (low): publish path un-gated.** `publishSkill` (`src/lib/skill-publish.ts:50`) distributes unscanned skills; gate it or document as out-of-scope.

## Propose-phase decisions for the user
1. Gate placement: `installPlugin` only, or also `autoInstallSkills` (recommended: both)? Optionally also gate `publishSkill` (P-1).
2. Escape hatch: `--force` to bypass `block`? or `--force` bypasses only `unscannable` (recommended), never `block`? Or no escape hatch (purest)?
3. `skills auto` semantics: strict refuse vs advisory (report-only) for node_modules-sourced skills (L-2).
4. Whether a later runtime (PreToolUse-hook) slice is wanted; if yes, `src/commands/hooks.ts` `SectionId` composition is the extension point (kept out of this change).
5. Message shape for refused installs: reuse `formatScanReport` output so users see exactly which threats blocked the install.