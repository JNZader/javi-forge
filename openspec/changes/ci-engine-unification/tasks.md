# Tasks: CI Engine Unification

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1250 total (S1 ~380, S2 ~270, S3 ~600) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (characterization) → PR 2 (executor collapse) → PR 3 (hooks) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Slice boundaries ARE PR boundaries. Slice 3 alone is likely >400 lines; if the
user picks `stacked-to-main`, split it as 3a (assets + manifest + bootstrap,
no behavior change) and 3b (classification + backup + `--force` + packaging).

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Characterization safety net (ADDED tests only, zero prod change) | PR 1 | base = main; independently revertible; ends with coverage baseline |
| 2 | Executor collapse (net-negative diff) | PR 2 | base = PR 1 (chain) or main (stacked); gated on PR 1 green |
| 3 | Hook assets + marker + classification + `--force` | PR 3 | base = PR 2 (chain) or main (stacked); split 3a/3b if >400 lines |

## Phase 1: Slice 1 — Characterization Safety Net (PR 1)

Spec: `ci-execution` → "Characterization tests before the collapse", "Preserved
step order", "Step-id naming"; `ci-hook-install` → "Hooks are verified by
execution". ADDED tests only — no pre-existing assertion may be edited.

- [ ] 1.1 Commit the untracked SDD scaffolding: `git add openspec/ .atl/` and commit `chore(sdd): scaffold ci-engine-unification change`. Nothing else in that commit.
- [ ] 1.2 In `src/commands/ci.test.ts`, ADD a `describe("characterization: auto + docker")` block using `vi.mock("../lib/docker.js")` with `isDockerAvailable → true`, `ensureImage` returning `getImageName(runner.stack)` (production-faithful per docker.ts:186), `runInContainer` a spy. Fixture: node repo, no `.javi-forge/ci.yaml`, full mode.
- [ ] 1.3 ADD test "global step order on auto+Docker": collect `onStep` ids and assert the sequence `detect, docker-check, docker-image, context-refresh, lint, compile, test`. (`ci-execution` → Preserved step order)
- [ ] 1.4 ADD test "image build precedes context refresh": assert `ids.indexOf("docker-image") < ids.indexOf("context-refresh")` (R5 / scenario "Image build precedes context refresh").
- [ ] 1.5 ADD test "image is threaded into every container run": assert every `runInContainer` call received `getImageName(runner.stack)`. This assertion MUST hold identically after slice 2 — do not use a sentinel value. (scenario "Image name is threaded, not re-derived")
- [ ] 1.6 ADD test "`--user root` only on compile": assert `runInContainer` spy args have `user === "root"` for the compile command and `undefined` for lint and test.
- [ ] 1.7 ADD test "`--stack node` step ids as-is": run `runCI` with `--stack node` on a node repo and assert suffixed ids exactly as emitted today (freeze B1; do NOT fix it). (scenario "Stack override emits suffixed ids")
- [ ] 1.8 ADD test "auto emits no setup/security/tool steps": assert no emitted id matches `setup*`, `security:*` or `tools*`. (requirement "Auto path inherits configured phases as no-ops")
- [ ] 1.9 Create `src/__integration__/ci-auto-docker.integration.test.ts`: auto resolution against REAL Docker, gated exactly like `ci-mixed.integration.test.ts` (skip unless Docker is available AND the javi-forge node image already exists locally). Opportunistic by design — record the residual R1 gap in the PR body.
- [ ] 1.10 Create `src/__integration__/ci-hooks-exec.integration.test.ts`: temp git repo + `installCIHooks`, then EXECUTE hooks with `sh <hook>`. Table-drive `commit-msg` blocked/allowed messages asserting exit 1/0. (`ci-hook-install` → "Hooks are verified by execution")
- [ ] 1.11 In the same file, execute `pre-commit` and `pre-push` with a stub `javi-forge` (and stub `docker`) placed first on `PATH`; assert the stub received the frozen flag string `--quick --no-docker --no-security --no-ci-ghagga` and that a non-zero stub exit aborts the hook. (scenario "Generated pre-commit runs")
- [ ] 1.12 Run `pnpm test` and `pnpm validate`; confirm every pre-existing assertion in `src/commands/ci.test.ts` is untouched (`git diff` shows additions only in that file).
- [ ] 1.13 Run `pnpm test:coverage`; record lines/branches from `coverage/clover.xml` in the PR body as the SLICE-1 BASELINE (design records main at 3001/3256 = 92.2% lines, 83.2% branches). Slice 2 must land `>= baseline − 0.5pp` and `>= 85/80`.

## Phase 2: Slice 2 — Executor Collapse (PR 2)

Spec: `ci-execution` → "Single execution path", "Step-id and label naming",
"Coverage floors preserved". Net-negative diff. RED→GREEN per TDD.

- [ ] 2.1 RED: in `src/commands/ci.test.ts` ADD a naming table test over `NAMING_MODE`: bare rows for auto (`lint`, `Lint: {cmd}`, `Lint passed`, test → `Tests passed`) and suffixed rows for a SINGLE-runner config named `api` (`lint:api`, `Lint [api]: {cmd}`, `Lint [api] passed`, test → `Test [api] passed`, NEVER `Tests [api] passed`). (D2 / R3 guard)
- [ ] 2.2 In `src/commands/ci.ts`, add `const NAMING_MODE = { BARE: "bare", SUFFIXED: "suffixed" } as const` + `type NamingMode`, and phase descriptors carrying `label` and `doneLabel`. Apply `doneLabel` in BARE mode ONLY; suffixed keeps today's `${phase.label} [${runner.name}] passed` composition (ci.ts:880-886).
- [ ] 2.3 In `runCI`, select the mode once: `resolved.source === "auto" ? BARE : SUFFIXED`, and carry it on `RunnerExecContext.naming`. Never key naming on `runners.length`.
- [ ] 2.4 Rename `runConfiguredRunner` → `runRunner` and merge `RunnerStepContext` / `ConfiguredRunnerContext` into the single `RunnerExecContext` interface from the design.
- [ ] 2.5 In the prologue (ci.ts:536-573, INSIDE the existing `if (!noDocker)` guard), capture the `ensureImage` return into `autoImage` and pass it as `ctx.preresolvedImage`. Set it iff `resolved.source === "auto" && !noDocker`. Do not move the build.
- [ ] 2.6 In `runRunner`, nest the image skip INSIDE the existing `!noDocker` guard: `if (!noDocker) { if (ctx.preresolvedImage) { image = ctx.preresolvedImage } else { …resolve/ensure… } }`. `--no-docker` must still emit zero image steps. (D1)
- [ ] 2.7 Convert `runStep` to the `RunStepOptions` options object; delete the `imageOverride ?? runner.image ?? getImageName(runner.stack)` fallback chain and add an internal invariant throw when `!noDocker` and `image` is missing. (D3)
- [ ] 2.8 RED→GREEN: ADD a test asserting `runStep` throws when `!noDocker` and no image is supplied (covers the new branch).
- [ ] 2.9 Delete `runLegacySteps` and every reference to it; route auto through `runRunner`.
- [ ] 2.10 Remove the now-unused `getImageName` import from the `../lib/docker.js` import block at `src/commands/ci.ts:13` (biome `noUnusedImports` fails the build otherwise). (JD-011)
- [ ] 2.11 ADD a configured-runner ordering test: with `securityCmds` set and full mode, assert `security:<runner>` is emitted LAST inside the runner — after `test:<runner>` and before the top-level Semgrep step — and that it is skipped under `--no-security` and non-full modes. (folds JDA-R2-003)
- [ ] 2.12 Run `pnpm test`; verify all slice-1 characterization tests pass with ZERO assertion edits (scenario "Collapse lands on a green safety net").
- [ ] 2.13 Run `pnpm test:coverage`; assert lines/branches `>= slice-1 baseline − 0.5pp` and `>= 85/80`. Never lower thresholds in `openspec/config.yaml`.

## Phase 3: Slice 3 — Hook Assets, Marker, Classification (PR 3)

Spec: all of `ci-hook-install`. Split 3a (3.1-3.6) / 3b (3.7-3.20) if the diff
exceeds the 400-line budget.

### 3a — Assets, manifest, bootstrap

- [ ] 3.1 Create `scripts/build-hook-history.mjs` (dev-only, NOT packed): `git rev-list --all -- src/commands/ci.ts` → `git show <rev>:src/commands/ci.ts` → regex-slice each `const *_HOOK = \`…\`;` → RENDER the literal (un-escape) → dedupe → sha256. ABORT if an unescaped `${` appears; skip revisions where the constant is absent.
- [ ] 3.2 Run `scripts/build-hook-history.mjs`. If it produces ZERO historical variants for any hook, BLOCK the slice and report — do not ship. The variant count is an output, not an assumption.
- [ ] 3.3 Create `assets/hooks/pre-commit`, `assets/hooks/pre-push`, `assets/hooks/commit-msg` as the verbatim RENDERED templates (no marker lines, exactly one trailing `\n`). Content must be byte-identical to the current inline literals; do NOT adopt `ci-local/hooks/*`.
- [ ] 3.4 Create `assets/hooks/manifest.json`: per hook `{ version: 1, sha256, historical: [{ sha256, firstCommit }] }` from 3.2.
- [ ] 3.5 In `src/constants.ts`, export `HOOK_ASSETS_DIR = path.join(FORGE_ROOT, "assets", "hooks")` following the `TEMPLATES_DIR` / `CI_LOCAL_DIR` pattern.
- [ ] 3.6 ADD manifest guard tests (resolving assets through `HOOK_ASSETS_DIR`, never a hard-coded path, so Stryker mutants on the constant are killed — JD-015): (a) `sha256(asset body) === manifest[hook].sha256` (asset-drift); (b) `manifest[hook].sha256 === historical[v0].sha256` per hook (v1 byte-equivalence to the inline literal — scenario "Extracted template is byte-equivalent"); (c) PURE-FILE forward-maintenance guard (JDA-R2-001): assert `historical[]` STRICTLY GROWS whenever `manifest[hook].sha256` changes — implemented against files only, with NO `git show` and NO skip-when-history-unavailable branch, because `actions/checkout` `fetch-depth: 1` would make a git-based guard skip exactly in CI.

### 3b — Classification, backup, force, packaging

- [ ] 3.7 In `src/commands/ci.ts`, add `HOOK_STATE` (`absent`, `managed-current`, `managed-outdated`, `managed-edited`, `legacy-v0`, `foreign`, `symlink`, `not-a-file`) + `type HookState`, and the `InstallHooksOptions` / `InstallHooksResult` (`installed`, `upgraded`, `backups`, `errors`, `states`) interfaces from the design.
- [ ] 3.8 Implement `classifyHook(path, hookName, manifest)` per D6 step 0: `lstat` first — symlink → `SYMLINK`; exists but not a regular file → `NOT_A_FILE`; `ENOENT` → `ABSENT`; only a regular file continues.
- [ ] 3.9 Implement D6 steps 1-4: read as Buffer, decode utf8, split on `\n` WITHOUT stripping trailing `\r`; marker match requires line 0 `#!`, line 1 `^# javi-forge-hook: (?<name>[a-z-]+) v(?<version>\d+)$`, line 2 `^# javi-forge-hash: sha256:(?<hex>[0-9a-f]{64})$`; body = `[line0, ...lines.slice(3)].join("\n")`; `name !== hookName` → `foreign` (JD-014). Recompute the hash against the SHIPPED manifest; never trust the claimed `hex`.
- [ ] 3.10 Implement D6 step 4 verdicts: `managed-current` iff version and body hash match the manifest; `managed-outdated` iff the body hash is in `historical[]` OR the hash matches with a stale version; otherwise `managed-edited`. Unmarked files (step 5): whole-file hash vs `historical[]` → `legacy-v0`, else `foreign`.
- [ ] 3.11 Implement the marker injection at install time: write `body` unmodified with the two marker lines spliced after the shebang, so a re-install round-trip is byte-exact and re-classifies as `managed-current`.
- [ ] 3.12 Implement the write policy in `installCIHooks`: `absent` → write, report in `installed`; `managed-outdated` / `legacy-v0` → write, report in `upgraded`; `managed-current` → NO-OP with ZERO writes; `managed-edited` / `foreign` → refuse unless `force`; `symlink` / `not-a-file` → refuse ALWAYS, `--force` does not apply. Per-hook failures stay isolated (scenario "Refusal does not block sibling hooks").
- [ ] 3.13 Write the refusal messages naming the ABSOLUTE path and the remedy, using the exact `foreign` wording from D5 and a named reason for `not-a-file` (`… exists but is not a regular file`). Refusals go into `errors[]`.
- [ ] 3.14 Implement `backupHook(hookPath)` per D4 + JDA-R2-002: (a) `lstat` each candidate target (`.bak`, `.bak.{epochMs}`, `.bak.{epochMs}-{n}` for `n = 1..N`) and REFUSE the hook — even with `--force` — if it is a symlink or any non-regular file; (b) create EXCLUSIVELY via `fs.open(target, "wx")` (or `fs.copyFile` with `fs.constants.COPYFILE_EXCL`) — never a bare `copyFile` and never `existsSync` + `writeFile`; (c) copy the ORIGINAL BYTES as a Buffer, never a utf8 round-trip; (d) `fs.chmod(bak, originalStat.mode)`.
- [ ] 3.15 Enforce backup-fails-⇒-no-overwrite: on any backup throw (`ENOSPC`, `EACCES`, `EEXIST` after the retry budget), record a per-hook error, leave the hook BYTE-UNCHANGED, and continue with sibling hooks. The backup must complete before the install write; no path may race or precede it. (`ci-hook-install`:86, JD-004)
- [ ] 3.16 Plumb `--force`: add `force: { type: "boolean", default: false }` to `FLAGS_SCHEMA` in `src/cli/help.ts:103`, document it under `ci init` in the help text, and pass `installCIHooks(process.cwd(), { force: cli.flags.force })` at `src/cli/dispatch/ci.tsx:22`.
- [ ] 3.17 In `src/cli/dispatch/ci.tsx:23-30` (console-only, no Ink), print `backups` (`⚠ Backed up existing pre-commit → .git/hooks/pre-commit.bak`) and print `upgraded` DISTINCTLY from fresh installs (`↑ Upgraded pre-commit (was managed:v0)` vs `✓ Installed pre-commit`). Keep the existing `process.exit(errors.length > 0 ? 1 : 0)`.
- [ ] 3.18 ADD the classification/write matrix tests in `src/commands/ci.test.ts` — one row each for all 8 states × {no-force, force}, plus the backup-target-is-a-symlink row and the backup-throws row. Every REFUSE row asserts BOTH the recorded error AND that on-disk bytes are identical to before.
- [ ] 3.19 ADD hash-input semantics tests (D6): install → re-classify = `managed-current` with zero writes (bytes + mtime unchanged); body unchanged with a bumped marker version → `managed-outdated`, NOT `managed-edited`; one body byte changed → `managed-edited`; marker naming a DIFFERENT hook → `foreign`; CRLF-converted managed hook → `foreign`.
- [ ] 3.20 Delete the three inline `*_HOOK` template constants from `src/commands/ci.ts` and read templates from `HOOK_ASSETS_DIR` instead. Leave the pre-existing substring greps at `ci.test.ts:262-298` UNTOUCHED — they must still pass against the installed file.
- [ ] 3.21 Packaging: add `assets/` to the `files` array in `package.json`; in `scripts/verify-package-contents.mjs` add ALL FOUR paths (`assets/hooks/pre-commit`, `assets/hooks/pre-push`, `assets/hooks/commit-msg`, `assets/hooks/manifest.json`) to `REQUIRED_FILES` and `assets/` to `REQUIRED_PREFIXES`. Listing one asset is NOT sufficient — the prefix check passes on any single match (JD-008).
- [ ] 3.22 Run `pnpm package:check`, `pnpm test:hooks`, `pnpm test:coverage` and `pnpm validate`; confirm the `ci-hooks-exec` integration tests from slice 1 still pass against marker-carrying hooks and that coverage stays `>= 85/80`.
