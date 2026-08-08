# Exploration: ci-engine-unification

Behavior-preserving refactor: collapse the two CI execution paths into one executor and de-hardcode the git hook templates. Prerequisite for a future `gates-v2`.

## Current State

`runCI` (src/commands/ci.ts:464) resolves runners ONCE via `resolveCIRunners` (:369), then branches at :609 on `resolved.source`:
- `auto` -> `runLegacySteps` (:701-752)
- `config` | `stack-override` -> `runConfiguredRunner` (:765-926) per runner

Both converge on `runStep` (:928). Shared prologue: docker check (:536-550), auto-only image build (:554-572), `.context/` refresh (:576-606). Shared epilogue: top-level Semgrep (:634-661) and GHAGGA (:664-685).

Critical: `resolveCIRunners` ALREADY synthesizes a complete `ResolvedRunner` for the auto path (:405-419) with `setupCmds: []`, `securityCmds: []`, `requiredTools: []`. `runLegacySteps` receives that runner (:611) and ignores everything except passing it to `runStep`. The synthesized-single-runner-config answer to Q2 is therefore YES and already half-built.

## Q1 — Behavioral difference table

| # | Aspect | runLegacySteps | runConfiguredRunner | Verdict |
|---|---|---|---|---|
| 1 | Source of commands | `stackInfo.lintCmd/compileCmd/testCmd` = `primary.*Cmds[0]` (:499-501) | full `runner.*Cmds` arrays | Accident. Auto lists are always <=1 (`toList`, :311), so equivalent today; the indirection is a landmine. |
| 2 | `setup` phase | absent | runs first (:865) | Equivalent (auto `setupCmds` always `[]`). |
| 3 | `security` phase (per-runner) | absent | full mode && !noSecurity (:880-885) | Equivalent (auto `securityCmds` always `[]`). |
| 4 | Required-tool fail-closed check | absent | :819-856, before ALL phases | Equivalent (auto `requiredTools` always `[]`). |
| 5 | `noSecurity` propagation | NOT in `RunnerStepContext` (:692-698), never passed | in `ConfiguredRunnerContext` (:754-756) | Accident, currently harmless. |
| 6 | Image resolution site | in `runCI` BEFORE `.context/` refresh (:554-572) | INSIDE the runner loop, AFTER refresh (:771-816) | Real, observable step-ORDER difference. |
| 7 | `ensureImage` return value | DISCARDED (:563); `runStep` re-derives via `getImageName(runner.stack)` (:957) | captured into `imageName`, passed explicitly (:899-907) | Accident / fragile implicit contract. Same string today only because `ensureImage` without `buildContext` returns `getImageName(stack)` (docker.ts:186). |
| 8 | `image` / `build-context` honored | no (auto runners never carry them) | yes (:776-808) | Deliberate. |
| 9 | Step ids | bare `lint` / `compile` / `test` | `${phase}:${runner.name}` (:890) | DELIBERATE and PINNED by ci.test.ts:767-787. Hard compat constraint. |
| 10 | Step labels | `Lint: <cmd>` / `Lint passed` / `Lint failed` | `Lint [name]: <cmd>` / `Lint [name] passed` / `... failed` | Deliberate, follows #9. |
| 11 | Multiple cmds per phase | impossible | supported; every cmd re-reports the SAME step id | Ink dedups by id (src/ui/CI.tsx:54-62) so N commands collapse into one row. Latent UI defect. |
| 12 | Working directory | `runner.directory` is always `"."` | any validated relative dir | Same code path (`runStep` :939 / :958-961). |
| 13 | Env injected | `CI=true` native (:945) / `-e CI=true` container (docker.ts:299) | identical | No difference; `runStep` is the single leaf. |
| 14 | Compile as `root` | yes (:732) | yes (:872) | Same. |
| 15 | Error handling | try/catch -> `report(error)` -> rethrow | identical shape | Same; fail-fast, no skips. |
| 16 | Skipped phases | never emit a `skipped` step | never emit a `skipped` step | Same, but INCONSISTENT with the top-level Semgrep/GHAGGA steps which DO emit `skipped` (:652-660, :676-684). gates-v2 must unify this. |

### Bugs / accidents found (not in scope to fix, but record them)

- **B1 — `--stack` emits suffixed ids.** `--stack node` on a node repo produces `lint:node`, zero-config produces `lint`. Same repo, same commands, different step ids. Undocumented, untested, almost certainly unintended.
- **B2 — `--shell` ignores configured runners.** ci.ts:508-533 builds the image from `stackInfo` (`primary.stack`) via `ensureImage({stack, javaVersion})`, never `runner.image` / `runner.buildContext`. A repo pinning `image: python:3.12-slim` gets the default javi-forge node image on `ci --shell`. Zero test coverage.
- **B3 — dead defensive defaults.** ci.ts:495-502 falls back to `node`/`npm`/`21` when `runners[0]` is undefined. Unreachable: config requires a non-empty `runners` list (ci-config.ts:321-326) and auto always yields exactly one.
- **B4 — `installCIHooks` clobbers user hooks.** :1147 `fs.writeFile` overwrites any existing non-symlink hook with no marker check, no backup, no warning. Only symlinks are refused (:1144).

## Q2 — Call graph

| Symbol | Exported | Callers |
|---|---|---|
| `runCI` (:464) | yes | src/ui/CI.tsx:65 (ONLY production caller); ci.test.ts, ci.integration.test.ts, ci-mixed.integration.test.ts |
| `resolveCIRunners` (:369) | yes | runCI:482; ci.test.ts:458-625 only |
| `detectCIStack` (:68) | yes | resolveCIRunners:404; **src/commands/tdd.ts:124**; **src/commands/tdd-pipeline.ts:135**; ci.test.ts |
| `buildCICommands` (:140) | no | detectCIStack:131; resolveConfiguredRunner:321; resolveExplicitStackRunner:345 |
| `runLegacySteps` (:701) | no | runCI:611 only |
| `runConfiguredRunner` (:765) | no | runCI:622 only |
| `runStep` (:928) | no | runLegacySteps:712/726/745; runConfiguredRunner:832 (tool check), :899 (phases) |
| `installCIHooks` (:1101) | yes | src/cli/dispatch/ci.tsx:22; ci.test.ts, ci-init.integration.test.ts |

**Constraint**: `detectCIStack` / `CIStackInfo` is a SECOND public contract consumed by `tdd.ts` and `tdd-pipeline.ts`. Unification may stop `runCI` from using `stackInfo`, but must not delete or reshape `detectCIStack`.

**Answer to "one executor?"**: yes. Deleting `runLegacySteps` and routing `auto` through `runConfiguredRunner` is behavior-preserving IF and ONLY IF the step-id/label naming becomes a function of `resolved.source` (`auto` -> bare, everything else -> suffixed) and the auto image-build is either moved into the loop (accepting a step-order change) or kept in the prologue with its resolved name threaded through. Keying naming on `runners.length === 1` instead of `source` would BREAK single-runner configs, which are suffixed today.

## Q3 — Hook templates

Three static template literals, ZERO interpolation, nothing varies per repo:
- `PRE_COMMIT_HOOK` ci.ts:1030-1045 — `javi-forge ci --quick --no-docker --no-security --no-ci-ghagga` with `npx` fallback.
- `PRE_PUSH_HOOK` ci.ts:1047-1067 — requires Docker, **hard-fails (exit 1) when Docker is down**; `javi-forge ci` with `npx` fallback.
- `COMMIT_MSG_HOOK` ci.ts:1069-1099 — flat array of ~20 literal grep patterns.

### Divergence vs `ci-local/hooks/*` (this repo's own richer variants)

| Hook | Embedded constant | `ci-local/hooks/*` |
|---|---|---|
| pre-commit | npx fallback, no timing | ci-local/hooks/pre-commit:12-25 adds elapsed-time reporting + 30s target warning; **no npx fallback** |
| pre-push | Docker missing = HARD FAIL (:1051-1055) | ci-local/hooks/pre-push:14-33 **degrades to quick checks** when Docker is down |
| commit-msg | ~20 literal patterns, no normalization | ci-local/hooks/commit-msg:41-129 — perl NFKC normalization, ZWSP/NBSP/bidi stripping, combining-mark folding, markdown/emoji stripping, ~20 pattern FAMILIES with a `PROVIDER_PAT` alternation, matched against raw AND normalized; colored output; has its own suite `ci-local/hooks/commit-msg.test.sh` |

The good hooks live in this repo; the fleet got the weak ones. **Adopting the ci-local commit-msg into the fleet is a BEHAVIOR CHANGE** (starts blocking messages the fleet currently allows) and must NOT ride inside a behavior-preserving refactor.

### What a versioned/marker-based hook needs

1. A stable first-line marker with a version, e.g. `# javi-forge-hook: pre-commit v1`, plus a content hash line so drift is detectable.
2. `installCIHooks` classifies each existing hook as `absent` | `managed:vN` | `foreign` (no marker) | `managed-but-edited` (marker + hash mismatch), and refuses to clobber `foreign` / `managed-but-edited` without an explicit `--force`. Fixes B4.
3. Old-fleet detection: hooks already deployed in ~8 repos have NO marker, so they classify as `foreign`. The refactor must therefore treat "no marker + content byte-identical to a known historical template" as `managed:v0` and allow upgrade; otherwise the safe default (refuse) would break every existing repo's `ci init`.
4. Template source: move the three literals to files (e.g. `assets/hooks/*`) read at install time, so `ci-local/hooks/*` and the shipped templates can eventually be one source. Requires a `package.json` `files` entry and a `package:check` update.

## Q4 — Test coverage of the target area

### Pinned today

Legacy/auto path:
- `detectCIStack` per stack, build-tool + java-version + command shapes — ci.test.ts:17-159
- detect mode emits only the detect step — ci.test.ts:176-190, ci.integration.test.ts:47-66 (`steps.length === 1`)
- `noDocker` skips `docker-check` — ci.integration.test.ts:23-45
- native lint/compile attempted in quick mode — ci.test.ts:365-390
- `noSecurity` / `noGhagga` suppress those steps — ci.test.ts:392-431
- non-zero native exit -> error step + rejection — ci.test.ts:433-451
- **bare legacy step ids, no `lint:` prefix** — ci.test.ts:767-787 (the compat anchor)

Configured path:
- runner order + per-directory cwd — ci.test.ts:642-686; ci-mixed.integration.test.ts:87-104
- fail-fast: later runner never executes — ci.test.ts:688-723; ci-mixed:106-117
- detect mode does not execute configured runners — ci.test.ts:725-747
- invalid config -> detect step `error` + throw — ci.test.ts:749-765
- required tools: missing fails closed naming runner/tool/env, passes when present, checked BEFORE setup — ci.test.ts:808-891
- setup runs before lint in the runner dir — ci.test.ts:893-926
- `build-context` ignored natively — ci.test.ts:928-949
- Docker: configured image used verbatim; tool error names the image — ci-mixed:143-227 (skipped without `bash:5`)

Hooks: install 3 hooks + mode 0755, mkdir hooks/, non-git refusal, symlink refusal with target intact, per-hook error isolation, substring greps of the templates — ci.test.ts:220-335, ci-init.integration.test.ts.

### UNCOVERED — explicit risk list for silent behavior change

1. **Legacy path with Docker, end-to-end.** No test exercises `auto` + Docker. The prologue `ensureImage` (:554-572) and the `getImageName` fallback in `runStep` (:957) are untested. Self-CI runs `--quick --no-docker --no-ci-ghagga`, so CI will not catch a regression either. **Highest risk in this refactor.**
2. **Global step ORDER.** Nothing asserts image-build vs `.context/`-refresh ordering; difference #6 could silently flip.
3. **`--user root` on compile in Docker.** No test asserts the root user is passed on either path.
4. **Shell mode** (`mode === "shell"`, :508-533) — zero tests, including the `--shell requires Docker` error.
5. **Semgrep / GHAGGA happy paths.** Only the "tool absent -> skipped" branches are tested; `runSemgrep` (:985) and `runGhagga` (:1011) bodies are untested.
6. **`.context/` refresh step contract** — `done` / `skipped` / non-fatal `error` statuses unasserted in the CI step stream.
7. **Multiple commands within one phase** sharing a single step id (UI collapse, #11) — untested.
8. **`--stack` override through `runCI`** — only `resolveCIRunners` is unit-tested; nothing pins the emitted step ids for B1.
9. **Hook overwrite of an existing user hook** (B4) — untested in either direction.
10. **Generated hooks are never EXECUTED.** ci.test.ts:262-298 only greps substrings. `commit-msg.test.sh` tests `ci-local/hooks/commit-msg`, NOT the embedded constant.
11. **Exit-code semantics** — `process.exitCode = 1` inside a 300ms `setTimeout` after `exit()` (src/ui/CI.tsx:77-80) and `process.exit(...)` in dispatch (src/cli/dispatch/ci.tsx:30) are untested.
12. `stackInfo` fallback defaults (B3) — unreachable, would show as uncovered branches.

## Q5 — gates-v2 seams (identified, not designed)

| Seam | Location | What gates-v2 lands there |
|---|---|---|
| Phase list | ci.ts:858-886 | Becomes the gate registry: `id`, `mode: blocking\|informative`, `scope: all\|changed`, baseline ref, env knobs. `skip: boolean` splits into "not applicable" vs "informative". |
| Skip semantics | ci.ts:889 vs :652-660 | Today per-runner skips emit NOTHING while top-level skips emit a `skipped` step. gates-v2 needs ONE rule. |
| Execution leaf | `runStep` ci.ts:928 | Per-gate timeout, env knobs, changed-file list injection, captured (non-inherited) stdio for JSON output. |
| Status vocabulary | `CIStepStatus` ci.ts:44, `CIStep` :46-51 | Needs `warning` / informative-failure plus a `gate` + `mode` field. Ink `STATUS_ICON`/`STATUS_COLOR` maps (src/ui/CI.tsx:13-27) are exhaustive `Record<>`s — adding a status is a typed, safe change. |
| Config whitelist | ci-config.ts:89 (`TOP_LEVEL_FIELDS`), :96-108 (`RUNNER_FIELDS`), :314 (version pin) | A `gates:` key is rejected as unknown by every deployed binary -> **fleet fail-closed cliff**. Either `version: 2` gated by capability, or a deliberately additive/ignored-key policy. This is the single biggest gates-v2 constraint and it is UNCHANGED by this refactor. |
| Single resolution point | `resolveCIRunners` ci.ts:369 | Where a frozen gate list would be materialized alongside runners. |
| JSON output | `--json` exists globally (src/cli/help.ts:125) but `handleCi` (src/cli/dispatch/ci.tsx) IGNORES it; only `dispatch/security.ts:62` consumes it | Precedent exists (suppress step output, print JSON at the end); the CI wiring is unbuilt. |

Unification leaves these seams CLEAN provided one executor owns the phase loop and `runStep` stays the only leaf.

## Q6 — Additional coupling / risk

- **Ink dedup by step id** (src/ui/CI.tsx:54-62) — any id scheme change alters rendering; already causes the phase-collapse in #11.
- **Exit code fragility** — `runCI` rejection -> `CI.tsx` catch -> `setTimeout(300ms)` -> `exit()` then `process.exitCode = 1`. If the process ends before the timer fires the non-zero code is lost. Adjacent, not a blocker.
- **`ci init` bypasses Ink** — `handleCi` calls `installCIHooks` and `process.exit` directly (dispatch/ci.tsx:20-31); the hook work has no TUI surface.
- **Second consumer of `detectCIStack`** — `tdd.ts` / `tdd-pipeline.ts`.
- **Self-CI blind spot** — `.github/workflows/ci.yml` runs `--quick --no-docker --no-ci-ghagga`; Docker execution, full mode, security and ghagga are unexercised.
- **Coverage/mutation gates** — 85 lines / 80 branches + stryker. Deleting `runLegacySteps` removes ~50 well-covered lines; new branching in `runConfiguredRunner` without new tests can drop branch coverage under 80. DECLARES vs ENFORCES: `openspec/config.yaml:18-19,61` DECLARES the policy (`coverage_thresholds`, "never lower the coverage thresholds to make a change pass") but executes nothing; the numbers that actually ENFORCE at runtime are `vitest.config.ts:19` (`thresholds: { lines: 85, branches: 80 }`), and even those only bite under `pnpm test:coverage` — `pnpm validate` does not run coverage. The gate this change is held to is the same-run delta (R4 below), not either file's absolute numbers.
- **Frozen CLI contract** — hooks in ~8 repos invoke `--quick --no-docker --no-security --no-ci-ghagga` and bare `javi-forge ci`. These flag names cannot change.
- **Schema v1 is locked** — `parseCIConfig` rejects `version != 1` and unknown top-level keys (ci-config.ts:308-319).

## Approaches

### Executor unification

1. **Collapse into one executor with source-aware naming (RECOMMENDED)** — delete `runLegacySteps`; route `auto` through `runConfiguredRunner`; introduce a naming strategy keyed on `resolved.source` (`auto` -> bare ids/labels, otherwise suffixed); thread the prologue-resolved image name explicitly instead of relying on the `getImageName` re-derivation.
   - Pros: one executor, one phase list, one seam set for gates-v2; kills #1/#5/#7 accidents; auto path inherits fail-closed tool checks for free (no-op today, correct tomorrow).
   - Cons: touches the highest-risk untested area (legacy Docker); needs characterization tests written FIRST.
   - Effort: **Medium**.
2. **Keep both paths, extract a shared `executePhases` helper** — minimal risk, but the divergence survives and gates-v2 inherits two call sites.
   - Effort: **Low**. Rejected: does not achieve the stated goal.
3. **Rewrite as a gate engine now** — merges gates-v2 into this change.
   - Effort: **High**. Rejected: violates the behavior-preserving scope and blows the 400-line review budget.

### Hooks

A. **Marker + version in place (RECOMMENDED for this change)** — keep the TS constants, prepend `# javi-forge-hook: {name} v1`, add classify-before-write (absent / managed / foreign / edited) with legacy-content recognition for the existing fleet, and execute the generated hooks in tests instead of grepping substrings.
   - Pros: fixes B4; makes old-fleet detection possible; zero change to hook BEHAVIOR.
   - Effort: **Medium**.
B. **Also adopt the richer `ci-local/hooks/*` content** — rejected for this change: it is a behavior change for ~8 repos (stricter commit-msg matching, pre-push degrade-instead-of-fail). Defer to a separate change once markers exist and version negotiation works.
C. Extract templates to shipped asset files — pairs naturally with A; adds `package.json` `files` + `package:check` work. Optional within this change.

## Recommendation

Executor **Approach 1** + Hooks **Approach A**, sequenced in three review-sized slices:

1. **Characterization tests first** (uncovered list items 1, 2, 3, 8, 10): pin legacy Docker execution (Docker-gated, `bash:5` style like ci-mixed), global step ORDER, the compile `--user root`, `--stack` step ids as they are TODAY, and execute the generated hooks. This is the safety net; without it the unification is unverifiable.
2. **Collapse the executor** — delete `runLegacySteps`, source-aware naming, explicit image threading. Diff should be net-negative.
3. **Hook markers + classification** — versioned marker, no-clobber policy, legacy-content recognition.

Record B1 / B2 / B3 as backlog items and fix them BETWEEN SDDs (fix-between-SDDs pattern); folding them in would make the diff non-behavior-preserving and pollute the review.

## Risks

- **R1 (high)** — the legacy Docker path has ZERO test coverage and is not exercised by self-CI (`--no-docker`). Unifying it blind is how a silent regression ships to a globally installed CLI. Mitigation: slice 1.
- **R2 (high)** — the fleet of ~8 repos runs OLD unmarked hooks and will never re-init. A no-clobber policy that does not recognize legacy content bricks `ci init` for all of them.
- **R3 (medium)** — step-id naming keyed on the wrong predicate (`runners.length === 1` instead of `source === "auto"`) silently renames ids for single-runner CONFIGS, breaking any downstream consumer of the step stream.
- **R4 (medium)** — deleting a well-covered function can drop line/branch coverage. Gate = same-run delta at each slice's verify (`head >= base`, design.md "Coverage Guard (R4)"); the configured thresholds live in `vitest.config.ts` (NOT `openspec/config.yaml`) and must not be lowered.
- **R5 (medium)** — moving the auto image build into the runner loop changes emitted step ORDER (image after `.context/` refresh instead of before). Observable; decide explicitly, do not let it happen by accident.
- **R6 (low)** — `ci.yaml` schema v1 unknown-key rejection means gates-v2 will fail closed on older binaries. Out of scope here, but the refactor must not add config keys.

## Ready for Proposal

**Yes** — scope is well-bounded and the compat anchors are identified. The proposal must state: (a) characterization tests land BEFORE the collapse, (b) B1/B2/B3 are explicitly OUT of scope and go to backlog, (c) hook CONTENT does not change in this change — only markers and the write policy.
