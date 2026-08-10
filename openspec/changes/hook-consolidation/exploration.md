# Exploration: hook-consolidation (main @ d47c55c)

> Mirror of engram `sdd/hook-consolidation/explore` (observation #13679). The explore agent had no write tool; content copied verbatim to disk for the hybrid store.

Decision fixed upstream: Model A — `.git/hooks/` + hardened `installCIHooks` + sha256 manifest is the SINGLE delivery mechanism. This exploration maps the 5 mechanisms, designs composition, init/tdd/security reconciliation, migration, and slices.

## Current state (all verified file:line)

### 1. KEEPER — installCIHooks (src/commands/ci.ts:2148-2239)
- HOOK_NAMES = pre-commit/pre-push/commit-msg (ci.ts:1804). Invoked ONLY from `ci init` (src/cli/dispatch/ci.tsx:96-98). `init` never calls it.
- Hardening: classifyHookPath lstat-first (:1888), classifyHookContent 8 states (:1838-1874: absent/symlink/not-a-file/managed-current/managed-outdated/managed-edited/legacy-v0/foreign), writeHookFile FD+O_NOFOLLOW+fchmod (:2109-2121), backupHook COPYFILE_EXCL ladder + FD chmod (:1998-2037), symlink/not-a-file refused even with --force (:2209-2211), foreign/managed-edited refused w/o --force + backup (:2212-2218).
- Static model: body = assets/hooks/<name> (readHookBody :2144), marker spliced by renderHook (:1915-1927), hash = body-below-marker; manifest assets/hooks/manifest.json (pre-commit v1, pre-push v2, commit-msg v2, historical[] per hook).

### 2. stepGitHooks (src/commands/init/steps/git.ts:60-107)
- Copies CI_LOCAL_DIR = FORGE_ROOT/ci-local (src/constants.ts:24 — doc comment git.ts:52 wrongly says templates/) into <project>/ci-local, chmod 755, then `git config core.hooksPath ci-local/hooks` UNCONDITIONALLY (git.ts:81-85). No existing-hooksPath check anywhere in src (grep: only occurrence). Runs as init step 2 (src/commands/init.ts:42).
- Makes mechanism 1 inert (git obeys hooksPath), hijacks husky/lefthook silently, no versioning.
- STALE bodies confirmed: ci-local/hooks/commit-msg lacks `claude-session:`/`claude.ai` patterns (assets/hooks/commit-msg:92-93 has them) AND lacks the conventional-commit subject guard (assets :159-186). ci-local/hooks/pre-push is the Docker-branching variant (full `javi-forge ci` when docker up, :14-16) vs assets v2 native-quick-always. ci-local/hooks/pre-commit lacks npx fallback.

### 3. installTddHooks (src/commands/tdd.ts:107-148)
- generateTddHook (:56) interpolates stack-detected testCmd → plain fs.writeFile to .git/hooks/pre-commit (:139-141). No classify, no backup, no symlink guard. Clobbers the managed hook.

### 4. installTddPipelineHook (src/commands/tdd-pipeline.ts:112-178)
- Backup via fs.copy overwrite:true (:156-158 — clobbers previous .bak, follows symlinks) then fs.writeFile pre-push (:169). No O_NOFOLLOW.

### 5. stepSecurityHooks (src/commands/init/steps/security.ts:22-92)
- Copies templates/security-hooks/* (6 layers) into ci-local/hooks/security/ (:32-46) — a SUBDIR git never executes; no hook body references it. Reports "6 git layers + runtime hooks" (:69) — the feature is 100% INERT. stepHookProfile writes ci-local/hooks/profile.json (:105-150).
- The 6 layers: L1 secret scan (pre-commit-secrets), L2 dependency audit (pre-push-deps), L3 permission boundaries (pre-commit-permissions), L4 code-signing verification (pre-push-signing), L5 branch protection (pre-push-branch-protection), L6 signing reminder (commit-msg-signing).
- K-005 confirmed: pre-commit-secrets:42 builds $STAGED_FILES from `git diff --cached --name-only`, :52 `echo "$STAGED_FILES" | xargs git diff --cached -- | grep -nP ... || true` — whitespace filenames split into bogus pathspecs, git error swallowed by `|| true` → silent scanner bypass. Fix: `--name-only -z | xargs -0` or drop the file list (`git diff --cached`).

### DOC-004 confirmed
assets/hooks/pre-push:5,20 claim "(validate + coverage)" but run `ci --quick`; quick SKIPS test phase (ci.ts:1016 `skip: mode !== "full"`) and security cmds (:1022) — quick = setup+lint+compile+gates (:817 gates do run). No tests, no coverage. Composed body messaging must be honest.

## Composition design (the crux)

Constraint: manifest = static sha256 of shipped asset bodies; TDD bodies are GENERATED (testCmd interpolated at install) → generated bodies break isReleasedBody/upgrade classification.

- **Option A — thin static shim + CLI dispatcher (RECOMMENDED)**: hook bodies stay static assets (v+1) that exec `javi-forge hooks run <name>` (npx fallback); ALL composition in TypeScript: read feature flags from project config, run CI --quick gate + optional TDD tests (runtime detectCIStack — same code tdd.ts already uses) + enabled security sections. Pros: manifest model untouched, one hardened writer, logic unit-testable, toggling features = config edit not reinstall, upgrade = normal managed-outdated path. Cons: hooks require javi-forge/npx at runtime (already true today), node startup per hook.
- **Option B — generated composed body + computed manifest**: per-feature-set rendering; historical[] cannot enumerate combos; classification would need recorded feature-set + re-render → breaks upgrade detection. Effort High. Rejected.
- **Option C — static dispatcher + managed parts dir (.git/hooks/javi-forge.d/<hook>/*)**: each part a static asset with own manifest entry. Preserves hashes but multiplies the hardened-write/classify surface and creates foreign-part semantics. Effort High. Rejected.

commit-msg: keep as fully-static self-contained bash (assets v2 already complete, zero runtime deps) in slice 1; optional later port of the attribution guard to TS (NFKC via String.normalize) — propose-phase decision.

## Init reconciliation
- stepGitHooks → stop copying hook bodies + stop setting core.hooksPath; instead call installCIHooks(projectDir).
- New guard: read `git config --local core.hooksPath` BEFORE install. If set to our legacy `ci-local/hooks` → migrate (unset + inform). If set to ANYTHING else (husky/.husky, lefthook…) → refuse loudly, install nothing, never hijack.
- stepSecurityHooks: stop copying inert subdir; becomes "enable security sections in hooks config" (+ keep .claude/settings.json copy, which is real). stepHookProfile: fold profile into the same config.

## TDD reconciliation
- tdd init / tdd-pipeline stop writing hook files; they flip config flags (tdd.preCommitTests=true, tdd.prePushPipeline=mode) and ensure managed hooks installed via installCIHooks. Delete both unhardened writers. Old generated TDD hooks in .git/hooks classify FOREIGN → existing refusal + --force+backup path handles migration.

## Migration classify map
- Legacy-init consumer: hooksPath=ci-local/hooks, .git/hooks mostly ABSENT → unset legacy hooksPath value + install (fresh). ci-local bodies never lived in .git/hooks so manifest can't/needn't classify them; leave copies + deprecation note.
- TDD consumer: FOREIGN → refuse, --force backs up.
- Foreign hooksPath: refuse (never unset someone else's).

## Slice plan (chained PRs, each ≤~400 lines target; S1 likely over → chain)
- S1: `hooks run <name>` dispatcher + hooks config schema + new shim bodies pre-commit/pre-push (v+1, honest messaging = DOC-004 fix) + manifest bump + ci-hooks tests.
- S2: init reconciliation (stepGitHooks → installCIHooks + hooksPath guard/migration; retire hook-body copy) + init tests.
- S3: TDD fold (config flags, delete tdd.ts/tdd-pipeline.ts writers) + tests.
- S4: security fold (port L1 w/ K-005 fix, L2, L3 as CLI sections; decide L4/L5/L6) + delete/repurpose templates/security-hooks git bodies.
- S5: docs, e2e (src/e2e/ci-hooks.e2e.test.ts, __integration__/ci-hooks-exec + ci-init), retire repo ci-local/ hook copies.

Test surface: src/commands/ci-hooks.test.ts, src/__tests__/{commit-msg-hook,hook-assets}.test.ts, src/__integration__/{ci-hooks-exec,ci-init}.integration.test.ts, src/e2e/ci-hooks.e2e.test.ts, src/commands/init/steps/{git,security}.test.ts, src/commands/{tdd,tdd-pipeline}.test.ts, src/cli/dispatch/{ci-init,tdd}.test.ts.

## Propose-phase decisions for the user
1. Confirm Option A (static shim + CLI dispatcher).
2. commit-msg: stay static bash (recommended) vs port to TS shim.
3. Security layers fate: fold L1(+K-005 fix)/L2/L3; L4/L5/L6 fold, drop, or park?
4. Config location: `ci.yaml hooks:` section (recommended — existing config surface) vs new ci-local/hooks.json vs extend profile.json.
5. Consumer ci-local/ tracked bodies: passive deprecation vs active cleanup on init/migration.
6. Whether `init` gains a hooksPath `--force`-style migration flag or migrates the known-legacy value silently.

## Risks
- init behavior change is breaking for consumers relying on tracked ci-local hooks / hooksPath.
- Touching user git config (mitigate: only unset the exact legacy value `ci-local/hooks`).
- Runtime dependency on javi-forge availability in hooks (already the case today; npx fallback slow offline).
- profile.json downstream consumers unverified — audit before folding.
- S1 shim bodies invalidate current hashes → managed-outdated auto-upgrade path must be regression-tested (upgrade, not refusal).
