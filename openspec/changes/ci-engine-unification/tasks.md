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

- [x] 1.1 Commit the untracked SDD scaffolding: `git add openspec/ .atl/` and commit `chore(sdd): scaffold ci-engine-unification change`. Nothing else in that commit.
- [x] 1.2 In `src/commands/ci.test.ts`, ADD a `describe("characterization: auto + docker")` block using `vi.mock("../lib/docker.js")` with `isDockerAvailable → true`, `ensureImage` returning `getImageName(runner.stack)` (production-faithful per docker.ts:186), `runInContainer` a spy. Fixture: node repo, no `.javi-forge/ci.yaml`, full mode.
- [x] 1.3 ADD test "global step order on auto+Docker": collect `onStep` ids and assert the sequence `detect, docker-check, docker-image, context-refresh, lint, compile, test`. (`ci-execution` → Preserved step order)
- [x] 1.4 ADD test "image build precedes context refresh": assert `ids.indexOf("docker-image") < ids.indexOf("context-refresh")` (R5 / scenario "Image build precedes context refresh").
- [x] 1.5 ADD test "image is threaded into every container run": assert every `runInContainer` call received `getImageName(runner.stack)`. This assertion MUST hold identically after slice 2 — do not use a sentinel value. (scenario "Image name is threaded, not re-derived")
- [x] 1.6 ADD test "`--user root` only on compile": assert `runInContainer` spy args have `user === "root"` for the compile command and `undefined` for lint and test.
- [x] 1.7 ADD test "`--stack node` step ids as-is": run `runCI` with `--stack node` on a node repo and assert suffixed ids exactly as emitted today (freeze B1; do NOT fix it). (scenario "Stack override emits suffixed ids")
- [x] 1.8 ADD test "auto emits no setup/security/tool steps": assert no emitted id matches `setup*`, `security:*` or `tools*`. (requirement "Auto path inherits configured phases as no-ops")
- [x] 1.9 Create `src/__integration__/ci-auto-docker.integration.test.ts`: auto resolution against REAL Docker, gated exactly like `ci-mixed.integration.test.ts` (skip unless Docker is available AND the javi-forge node image already exists locally). Opportunistic by design — record the residual R1 gap in the PR body.
- [x] 1.10 Create `src/__integration__/ci-hooks-exec.integration.test.ts`: temp git repo + `installCIHooks`, then EXECUTE hooks DIRECTLY via their shebang (`spawn(hookPath)`), NOT `sh <hook>`. Table-drive `commit-msg` blocked/allowed messages asserting exit 1/0. (`ci-hook-install` → "Hooks are verified by execution") — DEVIATION from the planned `sh <hook>`: the hooks declare `#!/bin/bash` (ci.ts:1030/:1047/:1069) and use bash arrays, which `sh` (dash on Debian/Ubuntu) cannot parse; invoking through `sh` would test a shell git never uses and fail on syntax. Executing the file directly is what git does.
- [x] 1.11 In the same file, execute `pre-commit` and `pre-push` with a stub `javi-forge` (and stub `docker`) placed first on `PATH`; assert the stub received the frozen flag string `--quick --no-docker --no-security --no-ci-ghagga` and that a non-zero stub exit aborts the hook. (scenario "Generated pre-commit runs")
- [x] 1.12 Run `pnpm test` and `pnpm validate`; confirm every pre-existing assertion in `src/commands/ci.test.ts` is untouched (`git diff` shows additions only in that file).
- [x] 1.13 Run `npx vitest run --coverage` on the merge-base (`main`) and on this branch head, same machine and same session, and record BOTH readings in the PR body as informative context. The gate is the SAME-RUN DELTA (`head >= base` on lines and branches), not any absolute percentage — see the section below and design.md "Coverage Guard (R4)".

### COVERAGE READINGS — informative, NOT a gate

The gate is a SAME-RUN DELTA measured at verify time (design.md "Coverage Guard
(R4)", spec `ci-execution` → "Coverage must not regress"). The numbers below are
history: they identify a tree and an environment, and they are stale the moment
the next commit lands. Do NOT copy them into a later slice as a floor.

Environment for every row: developer box, Docker available with the
`javi-forge-node` image present, so the Docker-gated integration suites RAN. On a
machine without Docker (and in CI) those suites `skipIf` out and the same commit
reports different numbers — which is precisely why the gate is a delta.

`coverage/clover.xml` project totals:

| Tree | Lines | Branches |
|---|---|---|
| `main` (2a0abaa) | 3265/3725 = 87.65% | 1880/2411 = 77.97% |
| slice 1 @ 12d9b4d | 3291/3725 = 88.34% | 1902/2411 = 78.88% |
| slice 1 @ 1f5c69b (current head) | 3300/3725 = 88.59% | 1904/2411 = 78.97% |

The design phase's claimed baseline (3001/3256 = 92.2% lines, 83.2% branches) did
NOT reproduce and is retired; the real denominator is 3725 statements / 2411
conditionals.

**Pre-existing failure, NOT introduced here**: `pnpm test:coverage` already fails
its 80% branch threshold on `main` (77.97%). `pnpm test` and `pnpm validate` are
green on both trees — `validate` does not run coverage. That unmet threshold is
tracked as COV-1 in `docs/BACKLOG.md` and is orthogonal to the delta gate: later
slices are gated on not regressing, not on reaching the configured floor, so no
slice is blocked on closing COV-1.

## Phase 2: Slice 2 — Executor Collapse (PR 2)

Spec: `ci-execution` → "Single execution path", "Step-id and label naming
keyed on resolution source", "Coverage must not regress". Net-negative diff.
RED→GREEN per TDD.

- [x] 2.1 RED: in `src/commands/ci.test.ts` ADD a naming table test over `NAMING_MODE`: bare rows for auto (`lint`, `Lint: {cmd}`, `Lint passed`, test → `Tests passed`) and suffixed rows for a SINGLE-runner config named `api` (`lint:api`, `Lint [api]: {cmd}`, `Lint [api] passed`, test → `Test [api] passed`, NEVER `Tests [api] passed`). (D2 / R3 guard)
- [x] 2.2 In `src/commands/ci.ts`, add `const NAMING_MODE = { BARE: "bare", SUFFIXED: "suffixed" } as const` + `type NamingMode`, and phase descriptors carrying `label` and `doneLabel`. Apply `doneLabel` in BARE mode ONLY; suffixed keeps today's `${phase.label} [${runner.name}] passed` composition (ci.ts:880-886).
- [x] 2.3 In `runCI`, select the mode once: `resolved.source === "auto" ? BARE : SUFFIXED`, and carry it on `RunnerExecContext.naming`. Never key naming on `runners.length`.
- [x] 2.4 Rename `runConfiguredRunner` → `runRunner` and merge `RunnerStepContext` / `ConfiguredRunnerContext` into the single `RunnerExecContext` interface from the design.
- [x] 2.5 In the prologue (ci.ts:536-573, INSIDE the existing `if (!noDocker)` guard), capture the `ensureImage` return into `autoImage` and pass it as `ctx.preresolvedImage`. Set it iff `resolved.source === "auto" && !noDocker`. Do not move the build.
- [x] 2.6 In `runRunner`, nest the image skip INSIDE the existing `!noDocker` guard: `if (!noDocker) { if (ctx.preresolvedImage) { image = ctx.preresolvedImage } else { …resolve/ensure… } }`. `--no-docker` must still emit zero image steps. (D1)
- [x] 2.7 Convert `runStep` to the `RunStepOptions` options object; delete the `imageOverride ?? runner.image ?? getImageName(runner.stack)` fallback chain and add an internal invariant throw when `!noDocker` and `image` is missing. (D3)
- [x] 2.8 RED→GREEN: ADD a test asserting `runStep` throws when `!noDocker` and no image is supplied (covers the new branch).
- [x] 2.9 Delete `runLegacySteps` and every reference to it; route auto through `runRunner`.
- [x] 2.10 Remove the now-unused `getImageName` import from the `../lib/docker.js` import block at `src/commands/ci.ts:13` (biome `noUnusedImports` fails the build otherwise). (JD-011)
- [x] 2.11 ADD a configured-runner ordering test: with `securityCmds` set and full mode, assert `security:<runner>` is emitted LAST inside the runner — after `test:<runner>` and before the top-level Semgrep step — and that it is skipped under `--no-security` and non-full modes. (folds JDA-R2-003)
  - NOTE (JDB2-008): the file-wide `ensureImage` mock in `ci.test.ts` is production-faithful ONLY for the no-`buildContext` case (it returns `getImageName(stack)` and ignores `imageTag`). BEFORE adding any build-context or explicit-`imageTag` runner row, extend the mock to `options.imageTag ?? getImageName(options.stack)` — otherwise the test asserts against a value production would never return.
- [x] 2.12 Run `pnpm test`; verify all slice-1 characterization tests pass with ZERO assertion edits (scenario "Collapse lands on a green safety net").
- [x] 2.13 SAME-RUN DELTA coverage gate (do NOT compare against any number written in this file): run `npx vitest run --coverage` twice on the same machine in the same session — once with the tree at the slice-1 head (the merge-base of this slice) and once at the slice-2 head, identical command and environment — and require `head >= base` on BOTH lines and branches, tolerance 0. Record both absolute readings in the PR body as informative context, labeled with their commit and whether Docker was available. The configured thresholds in `vitest.config.ts` stay untouched (the 80% branch floor is already unmet on `main` — pre-existing, tracked as COV-1 in `docs/BACKLOG.md`); a failing configured threshold does not fail this gate, and a passing one does not satisfy it. `pnpm test:coverage` (the same command behind a named script, `package.json:17`) may be run as an EXPLICITLY NON-GATING informative invocation — its red exit is COV-1, not a slice failure.

### SLICE-2 COVERAGE READINGS — informative, NOT a gate

Same machine, same session, same command (`npx vitest run --coverage`),
developer box with Docker available and the `javi-forge-ci-node` image present,
so the Docker-gated integration suites RAN in both runs. `coverage/clover.xml`
project totals:

| Tree | Lines | Branches |
|---|---|---|
| base — slice-1 merge head `c9b5e66` | 3300/3725 = 88.59% | 1905/2411 = 79.01% |
| head — slice 2 @ `204cfd2` | 3290/3707 = 88.75% | 1910/2412 = 79.18% |

Delta: lines +0.16pp, branches +0.17pp — `head >= base` on both, gate PASSED.
Both runs exit non-zero on the configured 80% branch threshold (COV-1,
pre-existing on `main`), which is orthogonal to this gate.

Measurement gotcha for the next slice: run the base from a NAMED BRANCH, not a
detached HEAD. `src/lib/__tests__/crash-recovery.test.ts:101` asserts the current
branch name against the real repo, so a detached-HEAD base run fails that test
and vitest then writes no `clover.xml` at all.

## Phase 3: Slice 3 — Hook Assets, Marker, Classification (PR 3)

Spec: all of `ci-hook-install`. Split 3a (3.1-3.6) / 3b (3.7-3.20) if the diff
exceeds the 400-line budget.

### 3a — Assets, manifest, bootstrap

- [x] 3.1 Create `scripts/build-hook-history.mjs` (dev-only, NOT packed): `git rev-list --all -- src/commands/ci.ts` → `git show <rev>:src/commands/ci.ts` → regex-slice each `const *_HOOK = \`…\`;` → RENDER the literal (un-escape) → dedupe → sha256. ABORT if an unescaped `${` appears; skip revisions where the constant is absent.
- [x] 3.2 Run `scripts/build-hook-history.mjs`. If it produces ZERO historical variants for any hook, BLOCK the slice and report — do not ship. The variant count is an output, not an assumption.
- [x] 3.3 Create `assets/hooks/pre-commit`, `assets/hooks/pre-push`, `assets/hooks/commit-msg` as the verbatim RENDERED templates (no marker lines, exactly one trailing `\n`). Content must be byte-identical to the current inline literals; do NOT adopt `ci-local/hooks/*`.
- [x] 3.4 Create `assets/hooks/manifest.json`: per hook `{ version: 1, sha256, historical: [{ sha256, firstCommit }] }` from 3.2.
- [x] 3.5 In `src/constants.ts`, export `HOOK_ASSETS_DIR = path.join(FORGE_ROOT, "assets", "hooks")` following the `TEMPLATES_DIR` / `CI_LOCAL_DIR` pattern.
- [x] 3.6 ADD manifest guard tests (resolving assets through `HOOK_ASSETS_DIR`, never a hard-coded path, so Stryker mutants on the constant are killed — JD-015): (a) `sha256(asset body) === manifest[hook].sha256` (asset-drift); (b) `manifest[hook].sha256 === historical[v0].sha256` per hook (v1 byte-equivalence to the inline literal — scenario "Extracted template is byte-equivalent"); (c) PURE-FILE forward-maintenance guard (JDA-R2-001): assert `historical[]` STRICTLY GROWS whenever `manifest[hook].sha256` changes — implemented against files only, with NO `git show` and NO skip-when-history-unavailable branch, because `actions/checkout` `fetch-depth: 1` would make a git-based guard skip exactly in CI.

#### 3a OUTPUT — `build-hook-history.mjs` variant census (gate 3.2)

Run on `feat/ci-unification-s3a-hook-assets`, full (non-shallow) clone, 259
commits reachable, 12 revisions touch `src/commands/ci.ts`, all 12 readable,
zero unknown `*_HOOK` constants:

| Hook | Distinct historical variants | First commit | v0 sha256 |
|---|---|---|---|
| `pre-commit` | 1 | `5587b3b` | `811f34ce…0580e914` |
| `pre-push` | 1 | `5587b3b` | `7de58640…cd14d7a5` |
| `commit-msg` | 1 | `5587b3b` | `1c23a60c…de11a1d6` |

The three constants were introduced in `5587b3b` and their bytes never changed
since, so each hook has exactly ONE historical variant and it is byte-identical
to HEAD — which is why `manifest[hook].sha256 === historical[0].sha256` holds by
construction at v1. The gate is satisfied (no hook has zero variants), so 3b can
proceed: every hook installed by any released `ci init` classifies as
`legacy-v0`, never `foreign`.

#### SLICE-3a COVERAGE READINGS — informative, NOT a gate

Same machine, same session, same command (`npx vitest run --coverage`),
developer box with Docker available, base measured from the NAMED branch `main`
(never a detached HEAD — `crash-recovery.test.ts` asserts the real branch name).
`coverage/clover.xml` project totals:

| Tree | Lines | Branches |
|---|---|---|
| base — `main` @ `c4ea116` (slice-2 merge) | 3290/3707 = 88.751% | 1910/2412 = 79.187% |
| head — slice 3a @ `c6ddeaa` | 3291/3708 = 88.754% | 1910/2412 = 79.187% |

Delta: lines +0.003pp, branches equal (identical counts) — `head >= base` on
both AS PERCENTAGES, gate PASSED. Both runs exit non-zero on the configured 80%
branch threshold (COV-1, pre-existing on `main`), which is orthogonal to this
gate. `pnpm validate` exits 0 on the head (77 files, 1310 passed, 4 skipped).

**3a scope note**: `installCIHooks` still reads the inline `*_HOOK` constants.
Switching it to `HOOK_ASSETS_DIR` and deleting the constants is task 3.20, which
this file assigns to 3b; 3a is additive only (assets + manifest + constant +
guard tests) and changes zero runtime behavior.

### 3b — Classification, backup, force, packaging

- [x] 3.7 In `src/commands/ci.ts`, add `HOOK_STATE` (`absent`, `managed-current`, `managed-outdated`, `managed-edited`, `legacy-v0`, `foreign`, `symlink`, `not-a-file`) + `type HookState`, and the `InstallHooksOptions` / `InstallHooksResult` (`installed`, `upgraded`, `backups`, `errors`, `states`) interfaces from the design.
- [x] 3.8 Implement `classifyHook(path, hookName, manifest)` per D6 step 0: `lstat` first — symlink → `SYMLINK`; exists but not a regular file → `NOT_A_FILE`; `ENOENT` → `ABSENT`; only a regular file continues.
- [x] 3.9 Implement D6 steps 1-4: read as Buffer, decode utf8, split on `\n` WITHOUT stripping trailing `\r`; marker match requires line 0 `#!`, line 1 `^# javi-forge-hook: (?<name>[a-z-]+) v(?<version>\d+)$`, line 2 `^# javi-forge-hash: sha256:(?<hex>[0-9a-f]{64})$`; body = `[line0, ...lines.slice(3)].join("\n")`; `name !== hookName` → `foreign` (JD-014). Recompute the hash against the SHIPPED manifest; never trust the claimed `hex`.
- [x] 3.10 Implement D6 step 4 verdicts: `managed-current` iff version and body hash match the manifest; `managed-outdated` iff the body hash is in `historical[]` OR the hash matches with a stale version; otherwise `managed-edited`. Unmarked files (step 5): whole-file hash vs `historical[]` → `legacy-v0`, else `foreign`.
- [x] 3.11 Implement the marker injection at install time: write `body` unmodified with the two marker lines spliced after the shebang, so a re-install round-trip is byte-exact and re-classifies as `managed-current`.
- [x] 3.12 Implement the write policy in `installCIHooks`: `absent` → write, report in `installed`; `managed-outdated` / `legacy-v0` → write, report in `upgraded`; `managed-current` → NO-OP with ZERO writes; `managed-edited` / `foreign` → refuse unless `force`; `symlink` / `not-a-file` → refuse ALWAYS, `--force` does not apply. Per-hook failures stay isolated (scenario "Refusal does not block sibling hooks").
- [x] 3.13 Write the refusal messages naming the ABSOLUTE path and the remedy, using the exact `foreign` wording from D5 and a named reason for `not-a-file` (`… exists but is not a regular file`). Refusals go into `errors[]`.
- [x] 3.14 Implement `backupHook(hookPath)` per D4 + JDA-R2-002: (a) `lstat` each candidate target (`.bak`, `.bak.{epochMs}`, `.bak.{epochMs}-{n}` for `n = 1..N`) and REFUSE the hook — even with `--force` — if it is a symlink or any non-regular file; (b) create EXCLUSIVELY via `fs.open(target, "wx")` (or `fs.copyFile` with `fs.constants.COPYFILE_EXCL`) — never a bare `copyFile` and never `existsSync` + `writeFile`; (c) copy the ORIGINAL BYTES as a Buffer, never a utf8 round-trip; (d) `fs.chmod(bak, originalStat.mode)`.
- [x] 3.15 Enforce backup-fails-⇒-no-overwrite: on any backup throw (`ENOSPC`, `EACCES`, `EEXIST` after the retry budget), record a per-hook error, leave the hook BYTE-UNCHANGED, and continue with sibling hooks. The backup must complete before the install write; no path may race or precede it. (`ci-hook-install`:86, JD-004)
- [x] 3.16 Plumb `--force`: add `force: { type: "boolean", default: false }` to `FLAGS_SCHEMA` in `src/cli/help.ts:103`, document it under `ci init` in the help text, and pass `installCIHooks(process.cwd(), { force: cli.flags.force })` at `src/cli/dispatch/ci.tsx:22`.
- [x] 3.17 In `src/cli/dispatch/ci.tsx:23-30` (console-only, no Ink), print `backups` (`⚠ Backed up existing pre-commit → .git/hooks/pre-commit.bak`) and print `upgraded` DISTINCTLY from fresh installs (`↑ Upgraded pre-commit (was legacy-v0)` vs `✓ Installed pre-commit`). Keep the existing `process.exit(errors.length > 0 ? 1 : 0)`.
- [x] 3.18 ADD the classification/write matrix tests in `src/commands/ci.test.ts` — one row each for all 8 states × {no-force, force}, plus the backup-target-is-a-symlink row and the backup-throws row. Every REFUSE row asserts BOTH the recorded error AND that on-disk bytes are identical to before.
- [x] 3.19 ADD hash-input semantics tests (D6): install → re-classify = `managed-current` with zero writes (bytes + mtime unchanged); body unchanged with a bumped marker version → `managed-outdated`, NOT `managed-edited`; one body byte changed → `managed-edited`; marker naming a DIFFERENT hook → `foreign`; CRLF-converted managed hook → `foreign`.
- [x] 3.20 Delete the three inline `*_HOOK` template constants from `src/commands/ci.ts` and read templates from `HOOK_ASSETS_DIR` instead. Leave the pre-existing substring greps at `ci.test.ts:262-298` UNTOUCHED — they must still pass against the installed file.
- [x] 3.21 Packaging: add `assets/` to the `files` array in `package.json`; in `scripts/verify-package-contents.mjs` add ALL FOUR paths (`assets/hooks/pre-commit`, `assets/hooks/pre-push`, `assets/hooks/commit-msg`, `assets/hooks/manifest.json`) to `REQUIRED_FILES` and `assets/` to `REQUIRED_PREFIXES`. Listing one asset is NOT sufficient — the prefix check passes on any single match (JD-008).
- [x] 3.22 Run `pnpm package:check`, `pnpm test:hooks` and `pnpm validate`; confirm the `ci-hooks-exec` integration tests from slice 1 still pass against marker-carrying hooks. For coverage, apply the SAME-RUN DELTA gate (as in 2.13): `npx vitest run --coverage` at the slice-2 head and at the slice-3 head, same machine and session, requiring `head >= base` on lines and branches AS PERCENTAGES (raw covered counts shrink legitimately on deletions; ±1-branch inter-run jitter counts as equal — measured in slices 1-2). `pnpm test:coverage` (the same command behind a named script, `package.json:17`) may be run as an EXPLICITLY NON-GATING informative invocation — a failing configured threshold does not fail this gate, and a passing one does not satisfy it. Measure the base from a NAMED BRANCH, never a detached HEAD (see the slice-2 readings section for why).

#### SLICE-3b COVERAGE READINGS — the gate, as a same-run delta

Same machine, same session, same command (`npx vitest run --coverage`),
developer box with Docker available, base measured from the NAMED branch `main`
(never a detached HEAD). Percentages from the `All files` summary row:

| Tree | Lines | Branches |
|---|---|---|
| base — `main` @ `0eb9ce6` (slice-3a merge) | 88.75% | 79.18% |
| head — slice 3b @ `a861779` | 89.14% | 79.66% |

Delta: lines +0.39pp, branches +0.48pp — `head >= base` on both AS PERCENTAGES,
gate PASSED. Head clover project totals: 3374/3785 statements, 1971/2474
conditionals. Both runs exit non-zero on the configured 80% branch threshold
(COV-1, pre-existing on `main`), which is orthogonal to this gate and
explicitly non-gating.

Other 3.22 gates: `pnpm validate` exit 0 (79 files, 1358 passed, 4 skipped),
`pnpm package:check` passed (362 files; all four asset paths packed and asserted
by name), `pnpm test:hooks` 92/92, and the slice-1 `ci-hooks-exec` integration
tests pass against marker-carrying hooks (they EXECUTE the hooks and assert the
frozen flag string, so the two injected comment lines are invisible to them).

#### 3b DEVIATION — one pre-existing assertion replaced, by spec mandate

`src/__integration__/ci-init.integration.test.ts` carried an "overwrites
existing hooks" case asserting that a pre-existing foreign hook is clobbered and
reported as installed with zero errors. That is exactly the behavior the
`ci-hook-install` requirement "No-clobber policy for foreign and edited hooks"
DELETES ("Foreign hook is preserved": file unchanged on disk, reason reported).
It was replaced by the inverted contract asserted end to end, not weakened or
removed. The "ADDED tests only" rule (`ci-execution`:110) governs the executor
collapse; it cannot bind a test that encodes behavior a spec in this same change
reverses. Every other pre-existing hook assertion — including the substring
greps at `ci.test.ts:262-298` and the idempotence case — passes untouched.
