# Design: hook-consolidation (main @ 29eaebb3)

> Mirror of engram `sdd/hook-consolidation/design`. Inputs: proposal (#13680), exploration (#13679). All file:line refs verified against the working tree.

## Technical Approach

Locked Option 1: static shim bodies (pre-commit v2, pre-push v3) exec a new `javi-forge hooks run <name>` dispatcher; ALL composition lives in TypeScript, driven by a `hooks:` section in `.javi-forge/ci.yaml`. `installCIHooks` (src/commands/ci.ts:2148) remains the ONLY writer of `.git/hooks`; a `core.hooksPath` guard becomes its pre-check so `ci init` and `init` share it. commit-msg stays static self-contained bash (assets v2, untouched).

## Architecture Decisions

### D1 — Dispatcher location and wiring
**Choice**: logic in `src/commands/hooks.ts` (new, pure, no Ink) + console-only handler `src/cli/dispatch/hooks.ts`; wired as `case "hooks"` in the `src/index.tsx` switch (index.tsx:50-95 pattern), `HOOKS_HELP_TEXT` in `src/cli/help.ts`. Lazy-import the command module inside the handler, exactly like the `ci init` branch (src/cli/dispatch/ci.tsx:95-120) — hooks are cold-start critical.
**Alternatives**: Ink UI (rejected — hooks run in a terminal git owns; plain console output like `ci init`); folding under `ci hooks` (rejected — hooks compose TDD + security, not just CI).
**Rationale**: mirrors the only existing console-only subcommand precedent; keeps hot-path startup minimal.

`hooks run` accepts only `pre-commit` | `pre-push`. Any other name (including `commit-msg`) → usage + exit 1. No shipped shim ever passes another name.

### D2 — `hooks:` config schema (in `src/lib/ci-config.ts`)
**Choice**: extend the existing parser, mirroring `gates` exactly: add `"hooks"` to the v2-only key handling (ci-config.ts:137 `TOP_LEVEL_FIELDS`, :579-590 version-gated branch → `hooks require version: 2` under v1), new `validateHooks()` in the `validateGate` style (:358) — unknown-field errors, per-field messages, fail-closed (any error discards the whole config → `CIConfigError`).

```yaml
version: 2
hooks:
  pre-commit:
    ci: true            # quick native CI gate (default true when hooks: present)
    tdd: false          # run stack test command
    secrets: false      # L1
    permissions: false  # L3
  pre-push:
    ci: true
    tdd: false          # false | "strict" | "warn"
    deps: false         # L2
```

Parsed type: `CIHooksConfig { preCommit: {ci,tdd,secrets,permissions}, prePush: {ci,tdd,deps} }`. All values boolean except `pre-push.tdd: false|"strict"|"warn"`.
**Schema relaxation required**: v2 currently requires `runners` or `gates` (ci-config.ts:592-604); a hooks-only config must be valid → condition becomes "runners, gates or hooks". Flagged for judgment-day (touches existing validation semantics).
**Alternatives**: per-section objects `{enabled, mode}` (rejected — YAGNI; only tdd needs a mode); separate hooks.json / extend profile.json (rejected at proposal; profile.json has zero readers — see D7).

### D3 — Section abstraction, ordering, fail-closed
**Choice**:

```ts
interface HookSection {
  id: string;                 // "secrets" | "permissions" | "tdd" | "deps" | "ci"
  blocking: boolean;          // false ONLY for tdd:"warn"
  run(ctx: { projectDir: string }): Promise<{ ok: boolean; detail?: string }>;
}
```

`runHook(name, projectDir)`: resolve config via `findCIConfig` + `loadCIConfig` (ci-config.ts:653-674). No config file or no `hooks:` section → default composition `[ci]` (byte-for-byte today's behavior). Config exists but fails validation → print errors, **exit 1** (fail-closed: a broken config never silently skips gates — same philosophy as loadCIConfig).
Fixed execution order, cheap→expensive: pre-commit `secrets → permissions → tdd → ci`; pre-push `deps → tdd → ci`. **Fail-fast**: first blocking failure stops the run and exits 1; an advisory (`tdd:"warn"`) failure prints and continues. Exit code = 0 iff every blocking section passed.
**Alternatives**: run-all-then-aggregate (rejected — the CI section costs ~1-3 min; a secrets hit already blocks the commit, running CI after it wastes the user's time); config-declared order (rejected — deterministic order is a feature).

### D4 — CI section executes in-process, not via subprocess
**Choice**: the `ci` section calls `runCI({projectDir, mode:"quick", noDocker:true, noSecurity:true, noGhagga:true}, consoleStepCallback)` in-process (runCI: src/commands/ci.ts:517; quick skips tests ci.ts:1016 and security :1022, gates DO run :817). runCI throws on blocking failure → section returns ok:false.
**Alternatives**: shell out to `javi-forge ci --quick ...` (rejected — second node startup per hook, and PATH/version-skew between the shim-resolved binary and the subprocess). `collectGateOutcomes` (:1727) is NOT used here and is NOT the gate-runner: it drives the full `runCI` and returns exitCode 1 on any throw — it only STRUCTURALLY reports gate outcomes, it does not run a gates-only pipeline. Calling `runCI` directly is preferred because it gives throw-based fail-fast (a blocking failure throws → the section returns ok:false) and avoids the PATH/version skew above — NOT because `collectGateOutcomes` is a lighter gates-only path.
**Rationale**: same code path today's hook bodies reach through the CLI, minus one process.

### D5 — Static shims + manifest recipe
New `assets/hooks/pre-commit` (v2) and `assets/hooks/pre-push` (v3), both this shape (honest messaging = DOC-004 fix — NO "validate + coverage" claim; quick runs setup+lint+compile+gates, **no tests, no coverage**):

```bash
#!/bin/bash
# <NAME>: javi-forge hook dispatcher
# Runs the sections enabled under hooks: in .javi-forge/ci.yaml.
# Default: quick native CI gate (setup + lint + compile + gates — no tests, no coverage).
# Requires javi-forge on PATH (npx fallback; offline npx fails -> hook fails closed).
# To skip: git commit --no-verify   (pre-push: git push --no-verify)
set -e
if command -v javi-forge >/dev/null 2>&1; then
  javi-forge hooks run <name>
else
  npx javi-forge hooks run <name>
fi || {
  echo ""
  echo "<NAME> FAILED - fix the issues above."
  exit 1
}
```

npx-fallback open question resolved fail-closed: when javi-forge is absent and npx cannot fetch, the `||` branch exits 1 — a gate hook never fails open.

**Manifest bump (assets/hooks/manifest.json)** — per the append-only contract in `src/__tests__/hook-assets.test.ts:34-70`:
- pre-commit: `version 1→2`, `sha256 = H(new body)`, `historical += {sha256:new, firstCommit:<PR head sha>}` (prior `811f34ce…` stays entry [0]).
- pre-push: `version 2→3`, same append (prior `7de5…`, `3dad…` untouched).
- commit-msg: untouched.
- Same PR: `EXPECTED_VERSION` (hook-assets.test.ts:77) → `{pre-commit:2, pre-push:3, commit-msg:2}`; `RELEASED_SNAPSHOT` (:46) → sha256 updated + new hash APPENDED to its historical list (guard verifies prefix-intact + growth + outgoing-hash-present — all hold because prior hashes remain).
- Classification proof: a prior-managed install carries the marker and a body whose hash is in `historical[]` → `classifyHookContent` (ci.ts:1863-1865) returns MANAGED_OUTDATED → auto-upgrade (ci.ts:2225-2229), never FOREIGN. Unmarked byte-identical old bodies → LEGACY_V0 → also upgraded.

### D6 — hooksPath guard inside installCIHooks (ATOMIC)
**Choice**: pre-check at the top of `installCIHooks` (after the `.git` existence check, ci.ts:2155) — shared automatically by `ci init` (ci.tsx:95) and the reconciled init step; not duplicated in callers.

**Atomicity requirement (JDA-001)**: unsetting the local `core.hooksPath=ci-local/hooks` is a persistent side effect that ACTIVATES whatever sits in `.git/hooks/*` (which git was ignoring while hooksPath redirected it). A repo that ran BOTH `init` (set hooksPath=ci-local/hooks) AND `tdd init` (wrote an unhardened `.git/hooks/pre-commit` directly, tdd.ts:139-141) has a DORMANT foreign TDD hook there. If the guard unsets hooksPath first and only then discovers the TDD pre-commit is FOREIGN-without-`--force` (ci.ts:1871-1873, refused at ci.ts:2212-2214), the repo lands HALF-MIGRATED: hooksPath unset + stale unhardened TDD hook now LIVE + partial managed shims. The guard MUST therefore CLASSIFY BEFORE IT MUTATES — never leave the repo in a state worse than it started.

**Global-shadow atomicity (JDA-008)**: the naive "unset local, THEN re-read effective, THEN refuse if a global still shadows" mutates local config on the refuse path BEFORE the global is even detected, leaving `local-unset + global-present` — a half-migrated state that contradicts this doctrine ("leave core.hooksPath set / prior consistent state on refuse"). The fix: a shadowing global/system `core.hooksPath` is visible WITHOUT unsetting local, via **scoped reads** — `git config --global --get core.hooksPath` and `git config --system --get core.hooksPath` return each scope's own value regardless of the local value. So the shadow is detected with zero mutation, and the guard is reordered DETECT-BEFORE-MUTATE: no write happens until every check passes.

Algorithm (STRICT order — no mutation until every check passes):
1. **Classify** the three managed slots (`.git/hooks/{pre-commit,pre-push,commit-msg}`) with `classifyHookContent` exactly as the install loop would — pure read, no side effect.
2. **Detect a shadowing higher-scope hooksPath (scoped reads, ZERO mutation)**: if `git config --global --get core.hooksPath` OR `git config --system --get core.hooksPath` is non-empty (ANY value — that global/system value WOULD shadow `.git/hooks` the moment a local `ci-local/hooks` value is unset), RETURN `errors: ["a global/system core.hooksPath='<value>' would redirect git away from .git/hooks — the installed hooks would NOT run. Resolve it first (git config --global --unset core.hooksPath) and re-run."]`, mutate NOTHING (do NOT unset local, install NOTHING). This runs BEFORE any local mutation, so the global shadow can never leave the repo half-migrated. (includeIf/conditional-scope note below.)
3. **Check the local legacy value**: read `git config --local --get core.hooksPath`. If it is a value OTHER than the exact `ci-local/hooks` (a foreign LOCAL manager, e.g. `.husky`, `lefthook`, custom), RETURN `errors: ["core.hooksPath is set to '<value>' — another hook manager owns this repo's hooks. javi-forge refuses to install or change it. Unset it yourself if you want javi-forge hooks."]`, mutate NOTHING. `--force` does NOT override (force = consent to lose a file, not to hijack config — same doctrine as symlink refusal ci.ts:2207-2211). If the local value is empty (unset) this is the normal fresh-install case; continue.
4. **Check installability**: if ANY classified slot (from step 1) is FOREIGN and `--force` is NOT set, RETURN `errors: ["core.hooksPath=ci-local/hooks would be removed, but .git/hooks/<slot> holds a foreign hook (a prior 'tdd init' or hand-written hook). Migrating now would activate it. Resolve it (delete/back it up) or re-run with --force."]`, mutate NOTHING — leave `core.hooksPath` SET (prior consistent state), install NOTHING.
5. **Only now mutate** (all checks passed, or `--force` set): if the local value was exactly `ci-local/hooks`, perform `git config --local --unset core.hooksPath` and push an informational note ("legacy javi-forge hooksPath removed; hooks now live in .git/hooks") on the new `notes: string[]` field of `InstallHooksResult`; then install the managed shims (backing up any FOREIGN slot under `--force`, per matrix e). The install NEVER runs before the global/system shadow check (step 2) or the slot check (step 4).

**Net invariant**: EVERY refuse path (steps 2, 3, 4) leaves the repo in its EXACT prior state — zero mutation; the ONLY writes (local unset + shim install) happen on the fully-validated success/force path (step 5). Only the exact value we ever wrote (git.ts:83) is ever removed, and only `--local` scope is touched.

**includeIf / conditional-scope residual (documented edge)**: a scoped `--global`/`--system` read covers the common case — a plain global `core.hooksPath`. A value injected only through a `[includeIf "gitdir:…"]` conditional include is NOT returned by `--global --get` and would still surface only in the effective read; this is a documented residual edge, not covered by the scoped-read guard. The step-2 scoped reads catch every non-conditional global/system shadow with zero mutation, which is the case observed in practice.

**Rationale**: the mutation is ordered detect-first (classify + both higher-scope shadow checks + local-value check ALL precede any write) so a failed/refused install never advances the repo into an inconsistent, less-safe, or half-migrated state.

### D7 — Init reconciliation + security/profile fold
- `stepGitHooks` (src/commands/init/steps/git.ts:60-107): delete the ci-local copy + chmod + `git config core.hooksPath` block; body becomes `installCIHooks(projectDir)` (lazy import), reporting installed/upgraded/notes/errors through the existing `report()`; keep step id `git-hooks`. dry-run: report "would install managed hooks", call nothing.
- Sequence (src/commands/init.ts): unchanged positions — stepGitInit → stepGitHooks (:42, now hardened install) → … → stepCITemplate (writes ci.yaml) → stepSecurityHooks (:54). Constraint: the hooks-config merge in stepSecurityHooks needs ci.yaml to exist → stepCITemplate already precedes it; assert this ordering in the S2 test.
- `stepSecurityHooks` (security.ts:22-92): drop the inert `ci-local/hooks/security/` copy (:31-46); KEEP the `.claude/settings.json` copy (:48-60 — real feature); when `securityHooks` selected, merge `hooks: {pre-commit:{secrets:true,permissions:true}, pre-push:{deps:true}}` into `.javi-forge/ci.yaml` (create a minimal `version: 2` + `hooks:` config if absent — depends on D2 relaxation).
- `stepHookProfile` (security.ts:105-150): **delete**. Audit result: `profile.json` is written here and read NOWHERE at runtime (only its own tests + `HookProfileSelector` UI feed the writer) → safe to drop. `HookProfileSelector` is repurposed to pick a hooks preset using the EXISTING `HookProfile` type values (`"minimal" | "standard" | "strict"`, types/index.ts:15 — there is NO "relaxed" member; do not invent one): `strict` = all sections on, `standard` = secrets+deps, `minimal` = ci only. Each resolves to the merged `hooks:` values — or the selector is removed if the prompt is judged dead weight (flagged for judgment-day).

### D8 — TDD fold
- Delete `generateTddHook` + `installTddHooks` (src/commands/tdd.ts:56-148) and `generateTddPipelineHook` + `installTddPipelineHook` (src/commands/tdd-pipeline.ts:23-178). KEEP `getTddTestCommand` (tdd.ts:23-46) — the dispatcher's TDD section imports it.
- TDD section runtime: `detectCIStack(projectDir)` → `getTddTestCommand(stack, buildTool, projectDir)` at HOOK RUN time (never interpolated into a file). Null testCmd → skip with notice, ok:true (parity with today's warning-only generated hook). Execute via the same exec helper the CI runner uses for shell command strings.
- `src/cli/dispatch/tdd.ts` handlers: `tdd init` → set `hooks.pre-commit.tdd: true` + ensure hooks via `installCIHooks(cwd, {force})`; `tdd pipeline --mode m` → set `hooks.pre-push.tdd: m`. Old generated TDD hooks have no marker and match no released hash → FOREIGN (ci.ts:1871-1873) → refusal message names `--force`; `--force` → backup (COPYFILE_EXCL ladder) + overwrite. That IS the migration — zero new code.

### D9 — Security sections in TS (K-005 fix) + doctor advisories
- **L1 secrets** (pre-commit section, port of templates/security-hooks/pre-commit-secrets): staged list via `git diff --cached --name-only --diff-filter=ACM -z`, split on `"\0"`; diff content via `execFileAsync("git", ["diff","--cached","--", ...files])` with the file array as argv — **no shell, no xargs, K-005 (whitespace filename split at :52) structurally dead**. Chunk argv in batches of 512 files to respect ARG_MAX. Patterns ported to JS RegExp (`(?i)` → `/i` flag); scan diff added-lines, report file:line, blocking.
- **L2 deps** (pre-push section, port of pre-push-deps): same manifest→tool ladder (pnpm/yarn/npm audit high, pip-audit, cargo-audit, govulncheck) via execFileAsync; tool missing → advisory skip message, ok:true (parity).
- **L3 permissions** (pre-commit section, port of pre-commit-permissions): NUL-safe staged list; `fs.stat` mode checks in TS (world-writable, unexpected executable with the same shebang/extension/hooks-dir allowances), blocking.
- **L4→doctor** advisory `commit-signing`: `git config --get commit.gpgsign` + `user.signingkey` → ok when both configured, warn with the enable snippet otherwise (the L4 hook only ever verified when already configured; as an advisory nothing is lost at push time that `--no-verify` didn't already bypass).
- **L6 merges into L4** — it is the same gpgsign check (commit-msg-signing:20-27); one doctor check, not two.
- **L5→doctor** advisory `branch-protection`: when `gh` is on PATH and `origin` is GitHub → `gh api repos/{owner}/{repo}/branches/{default}/protection` (404 → warn "no server-side protection"); GitLab/no-gh → skip with note "verify protection in the forge UI". Local push-blocking behavior is intentionally dropped (server-side protection is the real control; the hook version was trivially bypassed and CI-exempted anyway).
- Doctor placement: new checks in a "Security" section of `runDoctor` (src/commands/doctor.ts:53), rendered by the existing `ui/Doctor.tsx` with zero renderer changes (DoctorCheck shape reused).
- `templates/security-hooks/` git-hook bodies deleted in S4; `claude-settings-security.json` stays.

## Data Flow

    git commit → .git/hooks/pre-commit (static shim v2, managed sha256)
      → javi-forge hooks run pre-commit
        → findCIConfig/loadCIConfig → hooks: section (default: [ci])
        → sections in order: secrets → permissions → tdd → ci(runCI quick in-process)
        → first blocking failure ⇒ exit 1 (fail-closed) | all pass ⇒ exit 0

## Migration Matrix (each row = a regression test)

| # | Prior state | Detection | Outcome |
|---|-------------|-----------|---------|
| a | Fresh repo, no hooks | ABSENT | install v2/v3 shims |
| b | Prior-managed (marker + released hash) | MANAGED_OUTDATED (ci.ts:1863) | silent auto-upgrade, no --force |
| c | Legacy init: local hooksPath=`ci-local/hooks`, `.git/hooks` slots absent/managed, no higher-scope shadow | guard steps 1-4 all pass | unset local config + note + fresh install |
| d | Foreign LOCAL hooksPath (husky/lefthook/custom, value ≠ `ci-local/hooks`) | guard step 3 | LOUD refusal, zero mutation, --force irrelevant |
| e | Old generated TDD hook in .git/hooks | FOREIGN (ci.ts:1871) | refuse; `--force` → COPYFILE_EXCL backup + overwrite |
| f | Legacy `ci-local/hooks` hooksPath + DORMANT foreign `.git/hooks/{pre-commit}` (repo ran both `init` and `tdd init`) | guard step 4 classifies FOREIGN before any unset | ATOMIC REFUSE: hooksPath left SET, zero mutation, clear message; `--force` → unset + backup dormant hook + install. Regression test `guard_refuses_before_unset_when_dormant_foreign_slot` asserts hooksPath is UNCHANGED after refusal |
| g | Legacy `ci-local/hooks` LOCAL hooksPath + a global/system `core.hooksPath` still set | guard step 2 scoped reads (`--global --get` / `--system --get`) detect the shadow BEFORE any mutation | ATOMIC REFUSE: local hooksPath left UNCHANGED (never unset), zero mutation, clear message naming the global value; `--force` irrelevant. Regression test `guard_refuses_global_shadow_leaves_local_hookspath_unchanged` asserts the local `core.hooksPath` value is UNCHANGED after refusal |

## File Changes (net)

| File | Action |
|------|--------|
| `src/commands/hooks.ts`, `src/commands/hooks/sections/*.ts`, `src/cli/dispatch/hooks.ts` | Create |
| `src/lib/ci-config.ts` | Modify — `hooks:` schema + v2 relaxation |
| `assets/hooks/{pre-commit,pre-push}`, `assets/hooks/manifest.json`, `src/__tests__/hook-assets.test.ts` | Modify — shims v2/v3, append-only bump |
| `src/commands/ci.ts` | Modify — hooksPath guard + `notes[]` |
| `src/commands/init/steps/git.ts`, `.../security.ts`, `src/index.tsx`, `src/cli/help.ts`, `src/cli/dispatch/tdd.ts`, `src/commands/doctor.ts` | Modify |
| `src/commands/tdd.ts` (writers), `src/commands/tdd-pipeline.ts`, `stepHookProfile`, `templates/security-hooks/<git bodies>` | Delete |
| `ci-local/` | Deprecate passively (docs only) |

## Slices, Tests, Blast Radius

| Slice | Content | Test files | Risk |
|-------|---------|-----------|------|
| S1a | `hooks:` schema + dispatcher (`ci` section only) + CLI wiring | `src/lib/ci-config.test.ts`, new `src/commands/hooks.test.ts`, `src/cli/dispatch/hooks.test.ts`, `src/cli/help.test.ts` | **>400-line risk was real → S1 pre-split into S1a/S1b** |
| S1b | Shim bodies v2/v3 + manifest bump + managed-outdated upgrade regression (matrix b) | `src/__tests__/hook-assets.test.ts`, `src/commands/ci-hooks.test.ts`, `src/__integration__/ci-hooks-exec.integration.test.ts` | fleet-brick if append-only botched — guard covers |
| S2 | hooksPath guard in installCIHooks (ATOMIC detect-before-mutate: classify + scoped `--global`/`--system` shadow read + local-value check, all before any write) + stepGitHooks rewrite (matrix a/c/d/f/g) | `src/commands/ci-hooks.test.ts`, `src/commands/init/steps/git.test.ts`, `src/cli/dispatch/ci-init.test.ts`, `src/__integration__/ci-init.integration.test.ts`, `src/commands/init.test.ts` (:201-213 "hook-profile step runs after security-hooks" + :263-276 exact step-id sequence — rewrite: stepGitHooks now installs hardened hooks; assertions on ordering vs security-hooks stay, but any "hook-profile" step reference is deferred to S4 where the step is deleted), `src/__integration__/init.integration.test.ts` (:63-67 drives hookProfile/securityHooks through init — update to the reconciled stepGitHooks→installCIHooks path) | touches user git config — exact-match only |
| S3 | TDD fold: sections tdd, delete writers, dispatch/tdd.ts flags (matrix e) | `src/commands/{tdd,tdd-pipeline}.test.ts`, `src/cli/dispatch/tdd.test.ts`, `src/commands/hooks.test.ts` | behavior move, not rewrite |
| S4 | Security fold: L1(+K-005)/L2/L3 sections, doctor L4/L5 advisories, stepSecurityHooks changes, **delete stepHookProfile**, delete templates | `src/commands/hooks/sections/*.test.ts`, `src/commands/init/steps/security.test.ts`, `src/commands/doctor.test.ts`, `src/ui/HookProfileSelector.test.tsx`, `src/commands/init.test.ts` (:201-213 + :263-276 — rewrite: REMOVE the "hook-profile" step assertions and drop "hook-profile" from the exact step-id sequence, since stepHookProfile is deleted here), `src/__integration__/init.integration.test.ts` (:63-67, :494, :550 — remove hookProfile drive-through; keep securityHooks path which now merges `hooks:` into ci.yaml) | L1 regex port fidelity — golden-case tests incl. whitespace filenames; init step-sequence tests MUST be updated in-slice or S4 red-applies |
| S5 | Docs, e2e, ci-local passive deprecation note | `src/e2e/ci-hooks.e2e.test.ts`, `src/e2e/commands.e2e.test.ts` | low |

Each slice green on `pnpm validate` + coverage floors; chained PRs per proposal.

## Testing Strategy

| Layer | What |
|-------|------|
| Unit | validateHooks errors; section order + fail-fast + warn-advisory; classify matrix rows b/e; guard scoped reads (local vs `--global`/`--system` shadow); global-shadow refuse leaves local hooksPath UNCHANGED (matrix g) |
| Integration | real tmp git repo: matrix a-e end-to-end; `hooks run` against a repo with ci.yaml; L1 with a whitespace-named staged file containing a planted AKIA key (K-005 regression) |
| E2E | shim → dispatcher → exit-code round trip via the built CLI |

## Migration / Rollout

Per-slice revert; `historical[]` append-only means reverting S1b restores prior-version classification; reinstalling a prior release re-writes prior hooks via managed-outdated. Consumer repos migrate on next `javi-forge ci init` or `init` (matrix rows).

## Open Questions / judgment-day flags

- [ ] D2 v2 relaxation ("runners, gates or hooks") — validation-semantics change beyond gates parity.
- [ ] `HookProfileSelector` fate: preset-mapper vs removal (S4 decision).
- [ ] `firstCommit` value for the new manifest entries is the PR head sha at merge time (mechanical, but design-unspecified constant).
- [ ] L1 argv chunk size 512 — unvalidated constant; verify against ARG_MAX in the integration test.
- [ ] L5 GitLab advisory is skip-with-note only (no glab probe) — acceptable? Cheap to add later.
