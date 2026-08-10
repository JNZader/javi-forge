# Tasks: hook-consolidation

> Design LOCKED after 2-round judgment-day (engram `sdd/hook-consolidation/design` #13686). Model note: **apply + judgment-day for S1a–S5 run in OPUS** (security surface). Every slice = strict TDD (RED before GREEN), ends green on `pnpm validate` + coverage floors (85 lines / 80 branches). Slices are strictly sequential (chained); within a slice, RED tasks may run in parallel, GREEN tasks sequential.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1900 total: S1a ~350 · S1b ~250 · S2 ~380 · S3 ~300 · S4 ~450 (largest) · S5 ~180 |
| 400-line budget risk | High (whole change); per-slice Medium — S1a/S1b pre-split resolves S1; S4 is the watch item |
| Chained PRs recommended | Yes |
| Suggested split | PR1 S1a → PR2 S1b → PR3 S2 → PR4 S3 → PR5 S4 → PR6 S5 |
| Delivery strategy | auto-chain (user-locked: chained PRs to main) |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| S1a | Dispatcher + `hooks:` config | PR 1 | base main; ci section only |
| S1b | Shims v2/v3 + manifest bump | PR 2 | base main; fleet-brick guard tests |
| S2 | Init reconciliation + atomic hooksPath guard | PR 3 | base main; user git config — exact-match only |
| S3 | TDD fold | PR 4 | base main; behavior move |
| S4 | Security fold + K-005 + doctor | PR 5 | base main; largest slice |
| S5 | Docs + e2e + deprecation | PR 6 | base main |

## S1a — Dispatcher + config [hook-dispatch: Composition driven by hooks config; Fail-closed gate sections]

- [ ] 1.1 RED `src/lib/ci-config.test.ts`: validateHooks per-field errors; garbage `hooks:` → fail-closed `CIConfigError`; `hooks` under v1 rejected ("require version: 2"); v2 hooks-only config valid ("runners, gates or hooks" relaxation, ci-config.ts:592-604)
- [ ] 1.2 RED new `src/commands/hooks.test.ts`: fixed order pre-commit `secrets→permissions→tdd→ci`, pre-push `deps→tdd→ci`; fail-fast on first blocking failure; only `tdd:"warn"` advisory (prints, continues); no config → default `[ci]`; broken config → exit 1; `hooks run` rejects any name except `pre-commit`/`pre-push` (usage + exit 1)
- [ ] 1.3 RED new `src/cli/dispatch/hooks.test.ts` + `src/cli/help.test.ts`: dispatch wiring, `HOOKS_HELP_TEXT`
- [ ] 1.4 GREEN `src/lib/ci-config.ts`: `hooks` in TOP_LEVEL_FIELDS (:137) + version-gated branch (:579-590) + `validateHooks()` (validateGate style :358) + `CIHooksConfig` type + v2 relaxation
- [ ] 1.5 GREEN `src/commands/hooks.ts`: `runHook` + `HookSection{id,blocking,run}`; ci section calls `runCI({projectDir, mode:"quick", noDocker:true, noSecurity:true, noGhagga:true})` **IN-PROCESS** (ci.ts:517) — throw = fail signal, NO subprocess
- [ ] 1.6 GREEN `src/cli/dispatch/hooks.tsx` console-only handler (lazy import, ci.tsx:95-120 pattern) + `case "hooks"` in `src/index.tsx` + `HOOKS_HELP_TEXT` in `src/cli/help.ts`

## S1b — Shims + manifest [hook-dispatch: Static shims exec the dispatcher; Honest pre-push messaging | ci-hook-install: Shim release preserves silent auto-upgrade; Hooks verified by execution]

- [ ] 2.1 RED `src/__tests__/hook-assets.test.ts`: `EXPECTED_VERSION` → `{pre-commit:2, pre-push:3, commit-msg:2}` (:77); `RELEASED_SNAPSHOT` (:46) sha256 updated + outgoing hash appended to historical (append-only guard :34-70 stays green)
- [ ] 2.2 RED `src/commands/ci-hooks.test.ts`: matrix **b** regression — prior-managed body (marker + historical hash) classifies MANAGED_OUTDATED (ci.ts:1863-1865) → silent auto-upgrade, no `--force`, NOT foreign
- [ ] 2.3 RED `src/__integration__/ci-hooks-exec.integration.test.ts`: EXECUTE installed shim → invokes `javi-forge hooks run <name>`, propagates exit code; assert behavior, not flag strings
- [ ] 2.4 GREEN `assets/hooks/pre-commit` (v2) + `assets/hooks/pre-push` (v3): static bodies exec `javi-forge hooks run <name>`, npx fallback **fail-closed** (`||` → exit 1), HONEST messaging — "setup + lint + compile + gates — no tests, no coverage", never "validate + coverage" (**DOC-004 fix**). `commit-msg` UNTOUCHED
- [ ] 2.5 GREEN `assets/hooks/manifest.json`: pre-commit 1→2, pre-push 2→3, `historical[]` append (`firstCommit` = PR head sha), prior entries intact

## S2 — Init reconciliation + ATOMIC hooksPath guard [ci-hook-install: core.hooksPath detection before install; init delegates to hardened installer]

- [ ] 3.1 RED `src/commands/ci-hooks.test.ts` unit: guard scoped reads (`--global --get` / `--system --get` vs local); matrix rows c/d; `guard_refuses_before_unset_when_dormant_foreign_slot` (row f — asserts hooksPath UNCHANGED after refusal); `guard_refuses_global_shadow_leaves_local_hookspath_unchanged` (row g — asserts local value still exactly `ci-local/hooks`)
- [ ] 3.2 RED `src/__integration__/ci-init.integration.test.ts`: matrix a/c/d/f/g end-to-end in real tmp git repo
- [ ] 3.3 RED update `src/commands/init/steps/git.test.ts` + `src/cli/dispatch/ci-init.test.ts` + `src/commands/init.test.ts` (:201-213 ordering vs security-hooks stays, :263-276 exact step-id sequence — stepGitHooks now hardened install; "hook-profile" refs stay until S4) + `src/__integration__/init.integration.test.ts` (:63-67 reconciled to stepGitHooks→installCIHooks path, :494, :550)
- [ ] 3.4 GREEN guard in `installCIHooks` (src/commands/ci.ts:2155, after `.git` check), STRICT order: 1) classify slots (pure read) → 2) scoped global/system shadow read → refuse zero-mutation → 3) local value ≠ exact `ci-local/hooks` → refuse zero-mutation (`--force` does NOT override) → 4) FOREIGN slot without `--force` → refuse, hooksPath left SET → 5) only-then-mutate: unset local + note on new `notes: string[]` in `InstallHooksResult` + install. Every refuse path = zero mutation
- [ ] 3.5 GREEN `src/commands/init/steps/git.ts:60-107`: delete ci-local copy + chmod + hooksPath flip; body = `installCIHooks(projectDir)` (lazy import), keep step id `git-hooks`, dry-run reports only

## S3 — TDD fold [ci-hook-install: Legacy generated TDD hooks migrate via the foreign path | hook-dispatch: Gate plus TDD section]

- [ ] 4.1 RED `src/commands/hooks.test.ts`: tdd section runs `detectCIStack` + `getTddTestCommand` at HOOK RUN time; null testCmd → skip notice, ok:true
- [ ] 4.2 RED `src/cli/dispatch/tdd.test.ts`: `tdd init` → set `hooks.pre-commit.tdd: true` + `installCIHooks(cwd,{force})`; `tdd pipeline --mode m` → `hooks.pre-push.tdd: m`
- [ ] 4.3 RED `src/commands/tdd.test.ts` + `src/commands/tdd-pipeline.test.ts`: prune writer tests; matrix **e** — old generated TDD hook classifies FOREIGN → refusal names `--force`; `--force` → COPYFILE_EXCL backup + overwrite
- [ ] 4.4 GREEN delete `generateTddHook`/`installTddHooks` (src/commands/tdd.ts:56-148) + `generateTddPipelineHook`/`installTddPipelineHook` (src/commands/tdd-pipeline.ts:23-178); KEEP `getTddTestCommand` (tdd.ts:23-46)
- [ ] 4.5 GREEN `src/cli/dispatch/tdd.ts` handlers rewired to config flags + tdd section added to dispatcher

## S4 — Security fold + K-005 [hook-dispatch: Security sections L1–L3 NUL-safe; L4–L6 are doctor advisories]

- [ ] 5.1 RED `src/commands/hooks/sections/*.test.ts`: L1 golden-case fidelity tests incl. whitespace-named staged file (`app secrets.env`) with planted AKIA key scanned as ONE path (**K-005 regression**); NUL-safe argv (no shell, no xargs); 512-file argv chunking; L2 tool-missing → advisory skip ok:true; L3 world-writable/unexpected-executable checks
- [ ] 5.2 RED `src/commands/doctor.test.ts`: `commit-signing` advisory (L4+L6 merged — one check) + `branch-protection` advisory (gh+GitHub → API probe, 404 → warn; GitLab/no-gh → skip-with-note)
- [ ] 5.3 RED `src/commands/init/steps/security.test.ts`: no `ci-local/hooks/security/` copy; `.claude/settings.json` copy KEPT; securityHooks → merge `hooks:{pre-commit:{secrets,permissions},pre-push:{deps}}` into ci.yaml (create minimal v2 if absent)
- [ ] 5.4 RED `src/commands/init.test.ts` (:201-213 + :263-276 — REMOVE "hook-profile" step assertions, drop from exact step-id sequence) + `src/__integration__/init.integration.test.ts` (:63-67, :494, :550 — remove hookProfile drive-through, keep securityHooks path) + `src/ui/HookProfileSelector.test.tsx` (preset-mapper minimal/standard/strict or removal — JD flag)
- [ ] 5.5 GREEN `src/commands/hooks/sections/` L1 secret-scan (`git diff --cached --name-only --diff-filter=ACM -z`, split `"\0"`, execFileAsync argv batches of 512) / L2 dep-audit ladder / L3 permissions (`fs.stat` mode checks)
- [ ] 5.6 GREEN doctor "Security" section in `runDoctor` (src/commands/doctor.ts:53), existing `DoctorCheck` shape, zero renderer changes
- [ ] 5.7 GREEN `stepSecurityHooks` (security.ts:22-92) drops subdir copy + merges `hooks:`; **delete `stepHookProfile`** (security.ts:105-150) + profile.json; delete `templates/security-hooks/` git-hook bodies (keep `claude-settings-security.json`)

## S5 — Docs + e2e + deprecation [hook-dispatch: Honest pre-push messaging]

- [ ] 6.1 Update `src/e2e/ci-hooks.e2e.test.ts` + `src/e2e/commands.e2e.test.ts`: shim → dispatcher → exit-code round trip via built CLI
- [ ] 6.2 Docs: `hooks:` config reference, `javi-forge hooks run`, doctor advisories, migration notes (matrix rows as user guidance)
- [ ] 6.3 Passive deprecation note on tracked `ci-local/` hook bodies (docs only, no deletion)

## Acceptance backbone

Migration matrix rows a–g each map to a named test: a/c/d (3.2), b (2.2), e (4.3), f/g (3.1). Incomplete test inventory = red apply — the per-slice test lists above are the full inventory, carried verbatim from design.md.
