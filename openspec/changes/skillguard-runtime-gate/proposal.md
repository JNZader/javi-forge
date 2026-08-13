# Proposal: skillguard-runtime-gate

## Intent

Install-time fail-closed security gate for skills entering the machine. Today the skillguard scanner is **100% latent**: its only importer is `src/lib/skill-scanner.test.ts:19` — no production call site exists. `plugin add` runs only structural validation (`installPlugin`, `src/lib/plugin.ts:138` — manifest/name/semver, `:165-182`), then moves the clone into `PLUGINS_DIR` (`fs.move`, `:192`). `skills auto-install` is copy-only (`autoInstallSkills`, `src/lib/auto-skill-install.ts:43`, copy `:96-103`). A skill that exfiltrates credentials or injects code installs unconditionally. The scanner already provides the blocking primitive — `isRejectedVerdict()` (`src/lib/skill-scanner.ts:57`, true ONLY for `block`|`unscannable` `:58`) and fail-closed `unscannable` for unreadable files (`:42-47`, `scanSkillFile` returns it, never throws, `:448-459`). The only missing piece is a call site.

## Scope (user-locked decisions — fixed, not re-litigated)

### In Scope
- Gate **both** entrypoints strictly: `plugin add` (`runPluginAdd` → `installPlugin`) and `skills auto-install` (`autoInstallSkills`).
- Fail-closed: reject when `isRejectedVerdict()` is true on ANY staged skill (`block` **or** `unscannable`); any scanner/evaluation error → deny. Scan staging BEFORE files land in `PLUGINS_DIR` (G-1).
- `--force` bypasses ONLY `unscannable`; NEVER `block`.
- Refusal output reuses `formatScanReport`/`formatBatchReport` (`src/lib/skill-scanner.ts:550/:599`).
- Imitate the agent-governance-toolkit fail-closed pattern only; never depend on/vendor the package.

### Out of Scope
- Generated PreToolUse hook (agent-governance-toolkit style) — future slice; extension point `SectionId` composition (`src/commands/hooks.ts:41`).
- `publishSkill` gating (`src/lib/skill-publish.ts:50`) — P-1, follow-up.
- `_hardening.py` env-var denylist (LD_PRELOAD/NODE_OPTIONS/PYTHONSTARTUP) — 404 on main, unverified; only relevant to the hook slice, omitted here (H-1).
- `registryGate` quality scoring (`src/commands/skills/scoring.ts:361`) — separate concern, untouched.
- Hand-copied skills (no entrypoint), `init` agent-skills empty manifest (`src/lib/agent-skills.ts`).

## Capabilities

### New Capabilities
- `skill-install-gate`: fail-closed security gate at both install entrypoints (plugin add, skills auto-install) — rejection on `block`/`unscannable`, staging-before-placement, `--force` bounded to `unscannable`

### Modified Capabilities
- None (no existing spec's requirements change; `plugin add` is currently unspecced)

## Approach

**Option A (chosen) — CLI install-time gate.** `installPlugin`: between validation (`plugin.ts:165-182`) and `fs.move` (`:192`), run `scanSkillsDirectory(tmpDir)` on the staged clone (`:154`); any rejected verdict → `{ success: false, error }` with the report; the `finally` (`:216-220`) removes staging → nothing lands. `autoInstallSkills`: before `fs.copy` (`auto-skill-install.ts:96-103`), `scanSkillFile(sourceSkillMd)`; rejected → not copied, surfaced in a new `blocked` field of `SkillInstallResult`. Options gain `force?: boolean`.

**Option B (rejected now) — generated PreToolUse hook.** Real-time tool-invocation protection, but no generation surface exists (`src/commands/hooks.ts` composes GIT-hook sections only); new install/classify/manifest machinery plus runtime CLI dependency in hooks — disproportionate. Deferred as documented slice via `SectionId`.

**Locked semantics:** `--force` bypasses `unscannable` only (`block` always refuses); scanner throw/eval error → deny with the error, never swallow. Dry-run (`installPlugin` `:157` skips clone) has no staged content → gate no-ops. `skills auto-install` sameDir case (`auto-skill-install.ts:70,84-87`) copies nothing → no gate fires; current UI wires source==target (`src/ui/AutoSkills.tsx:31-36`), so blast radius is the lib copy path.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/plugin.ts` | Modified | Gate in `installPlugin` (`:138`), `force` option, refusal via report |
| `src/lib/auto-skill-install.ts` | Modified | Gate pre-copy (`:96-103`), `blocked` in `SkillInstallResult`, `force` option |
| `src/commands/plugin.ts` | Modified | `runPluginAdd` (`:33`) threads `force`; error detail carries report |
| `src/cli/dispatch/skills-cmd.tsx`, `src/ui/AutoSkills.tsx`, `src/ui/Plugin.tsx` | Modified | `--force` flag plumbing (`help.ts:199` schema), blocked display |
| `src/lib/skill-scanner.ts` | Unchanged | Export surface reused as-is |
| Tests | New/Modified | `plugin.test.ts` (fs-extra mocked `:5-17`), `plugin.test.ts` cmd (`../lib/plugin.js` mocked `:5-12`), `auto-skill-install.test.ts`; new gate cases: pass/block/unscannable/throw |

## Risks

| Risk | Sev | Mitigation |
|------|-----|------------|
| G-1 placement race — refusal leaves files on disk | High | Scan staged `tmpDir` before move; `finally` removes staging (`plugin.ts:216-220`); auto-install scans source pre-copy |
| R-1 reference API instability (v4→v5) | High | Imitate only, zero dependency |
| H-1 `_hardening.py` denylist unverified | Med | Omitted; re-verify only if hook slice lands |
| L-1 scanner debut latency, no baseline | Med | New TDD cases 4 verdict classes; vitest lines 85/branches 80 |
| L-2 auto-install false positives (node_modules-sourced) | Med | Strict gate per scope; `--force`=unscannable only; sameDir untouched |
| V-1 developer trust friction | Low | Document `--force` bound in help (mirror `help.ts:88-99`) |
| P-1 publish path un-gated | Low | Documented non-goal; follow-up |

## Rollback Plan

Revert the commit (semantic-release publishes prior release). Gate is in-memory: no config schema, no manifest bump, installed plugins untouched — reverting restores unscanned installs. New `force` option defaults `false`, so old library consumers compile unchanged.

## Dependencies

- Exploration `sdd/skillguard-runtime-gate/explore` (#14780); scanner exports already public.

## Success Criteria

- [ ] `plugin add` on a `block` plugin: error step + scan report, `PLUGINS_DIR` empty
- [ ] Unscannable (binary/missing SKILL.md) refused; `--force` installs it; `block` + `--force` still refuses
- [ ] `skills auto-install` copy branch: rejected skills not copied, listed as blocked
- [ ] Scanner-throw in gate → deny with error, never swallowed
- [ ] Scanner's first production importer is the gate; `pnpm validate` green at coverage floors

## Proposal question round

None required — user-locked decisions cover all five exploration Propose-phase decisions (placement, `--force` bound, auto-install strictness, hook slice deferral, report reuse).