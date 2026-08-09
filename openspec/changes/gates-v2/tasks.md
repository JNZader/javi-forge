# Tasks: gates-v2 — declarable named quality gates

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1050-1250 total across 4 slices (prod + tests) |
| 400-line budget risk | Slice 1 Medium · Slice 2 Low · Slice 3 High · Slice 4 High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (schema+B1+B2) → PR2 (git-diff) → PR3 (execution) → PR4 (scope/JSON) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema `{1,2}` + gate validation + B1 naming + B2 shell | PR 1 | base main; no execution; atomic B1 test update |
| 2 | `git-diff.ts` fully tested, UNWIRED | PR 2 | base PR1; autonomous, revert-clean |
| 3 | Gate execution + `warning` status + prologue guard | PR 3 | base PR2; execution-only; scope:changed NOT wired |
| 4 | scope:changed + baseline + env + headless JSON | PR 4 | base PR3; split 4a/4b if >400 |

Each slice = one PR boundary, sequential, ≤400 production lines. Slice 4 has a 4a/4b escape hatch.

## Phase 1 — Slice 1: Schema + B1 + B2 (Medium risk, no execution)

- [x] 1.1 Commit the untracked `openspec/changes/gates-v2/` scaffolding (proposal, design, specs, review-ledger, exploration) as the slice-1 base commit.
- [x] 1.2 RED: in `src/lib/ci-config.ts` tests, add cases — version accept-set `{1,2}`; v1 parses byte-identical; v1+`gates` → `"gates require version: 2"` (named, BEFORE generic unknown-key); v2 gates-only accepted; v2 with NEITHER runners nor gates fails closed; unknown key still fails closed. [ci-gates: version:2 schema negotiation]
- [x] 1.3 GREEN `src/lib/ci-config.ts`: change `CI_CONFIG_VERSION` check (~:314) to accept-set `{1,2}`. Read `doc.version` FIRST; compute allowed-key set as a function of the accepted version; move it BEFORE the unknown-key loop (~:308-312); special-case `gates`-under-v1 to `"gates require version: 2"` before the generic path (JDA-006). Add `gates` to `TOP_LEVEL_FIELDS` only under v2.
- [x] 1.4 GREEN `src/lib/ci-config.ts`: relax the non-empty-runners requirement (~:321-326) — v1 STILL requires non-empty `runners`; v2 makes `runners` OPTIONAL when `gates` present; v2 with neither fails closed (GATES-NEW-03).
- [x] 1.5 RED+GREEN `src/lib/ci-config.ts`: add `GATE_MODE`/`GATE_SCOPE` const objects + types, `CIGateConfig` interface (id, run, mode=blocking, scope=all, baseline?, env?; NO image field), and `validateGates()` — id via `RUNNER_NAME_RE` (tag-safe) + unique, `run` via `normalizeCommands`, mode ∈ {blocking,informative}, scope ∈ {all,changed}; each error names the offending field; duplicate id named error. [ci-gates: Gate schema and field validation]
- [x] 1.6 RED+GREEN `src/commands/ci-validate.ts`: call `validateGates()` and surface every gate schema error (version gating, duplicate id, invalid mode/scope, tag-unsafe id, unknown key) WITHOUT executing any gate command. [ci-gates: ci validate extended to gates]
- [x] 1.7 GREEN `src/commands/ci.ts` (~:624-625): re-key naming — implicit (`source==="auto" || source==="stack-override"`) → BARE ids/labels; explicit (`source==="config"`) → SUFFIXED. Do NOT touch the single-runner-CONFIG path. [ci-execution: Step-id naming keyed on resolution source]
- [x] 1.8 UPDATE frozen characterization test `src/commands/ci.test.ts:1298-1312` (sanctioned spec-reversal): expected `--stack node` ids change `docker-image:node/lint:node/compile:node/test:node` → bare `docker-image/lint/compile/test`. Land ATOMICALLY with 1.7. Leave the R3 guard `ci.test.ts:1387-1391` UNTOUCHED (single-runner config stays suffixed).
- [x] 1.9 RED+GREEN `src/commands/ci.ts` (~:516-541): `ci --shell` — when the primary resolved runner carries `image` or `buildContext`, resolve the shell image like the runner loop (explicit image passthrough or `ensureImage({buildContext,imageTag})`); else fall back to `ensureImage({stack,javaVersion})`. New test pins it. [ci-execution: Shell mode honors runner image/build context (B2)]
- [x] 1.10 Run `pnpm validate` (coverage floors 85/80). All green before PR1.

## Phase 2 — Slice 2: git-diff.ts (Low risk, UNWIRED)

- [x] 2.1 RED: new `src/lib/git-diff.test.ts` — pure table-driven `resolveBaseRef` env-precedence (fake env, NO git): GitLab MR `$CI_MERGE_REQUEST_DIFF_BASE_SHA` → GitLab push `$CI_COMMIT_BEFORE_SHA` (all-zeros `0000…` sentinel → skip) → GitHub `$GITHUB_BASE_REF` merge-base else `$GITHUB_SHA` → local merge-base `origin/main`,`origin/master`,`main`,`master` → null.
- [x] 2.2 GREEN: create `src/lib/git-diff.ts` with `resolveBaseRef(env,cwd):Promise<string|null>` per the precedence chain above.
- [x] 2.3 RED+GREEN: `changedFiles(base,cwd):Promise<string[]>` = union of `git diff --name-only --diff-filter=ACMR <base>...HEAD` ∪ `git diff --name-only` (unstaged) ∪ `git diff --name-only --cached` (staged); invoked as `execFileAsync("git",[...],{cwd})` argv array, never a shell string. Test via mocked `execFileAsync` (ci.test.ts docker-mock pattern).
- [x] 2.4 RED+GREEN: `changedFiles` MUST throw (not swallow) when the base sha is absent from local history (shallow clone / bad object). Test mocks `execFileAsync` reject and asserts the throw propagates (caller wires the loud-degrade in slice 4).
- [x] 2.5 Integration test: temp `git init -b main` (or explicit base sha) + 2 commits so it exercises the DIFF path, not the loud-degrade path — deterministic, independent of `init.defaultBranch` (JDB-009).
- [x] 2.6 Run `pnpm validate`. git-diff.ts ships UNWIRED (revert-clean). PR2.

## Phase 3 — Slice 3: Gate execution + status vocab + prologue guard (High risk, execution-only)

- [x] 3.1 GREEN `src/commands/ci.ts:47`: add `"warning"` to `CIStepStatus`. This forces both Records in `src/ui/CI.tsx:13-27` — add `warning: "⚠"` to `STATUS_ICON` and `warning: theme.warning` to `STATUS_COLOR` (compile-time guard; no exhaustive switch exists).
- [x] 3.2 RED+GREEN `src/commands/ci.ts`: add `runGateNative(cmd,cwd,env):Promise<number>` modeled on `runSemgrep`/`runGhagga` — spawns `bash -c <cmd>` at repo root with the merged env map, RETURNS the child exit code (resolve the code, do NOT throw on non-zero). Test asserts it resolves the code, never throws. [ci-gates: Gate execution phase — native executor returns exit code]
- [x] 3.3 RED+GREEN `src/commands/ci.ts`: add non-throwing `runGate` collector — code 0 → `report(…,"done")`; non-zero/spawn-error under `blocking` → push id to `blockingFailures[]` + `report(…,"error")` (no re-throw yet); under `informative` → `report(…,"warning")` and continue. AFTER the gate loop, if `blockingFailures.length>0` throw ONE aggregate error `"blocking gate(s) failed: <ids>"` → exit 1. [ci-gates: blocking fails build / informative → warning never fails build]
- [x] 3.4 RED+GREEN `src/commands/ci.ts`: multi-command gate = run `run[]` in order, fail-fast at first non-zero, later commands skipped, that first code is the reported `exitCode` (JDB-007).
- [x] 3.5 RED+GREEN `src/commands/ci.ts` prologue (~:502-510): when `resolved.runners.length===0`, SKIP building `stackInfo`, the docker-check, and image resolution; jump straight to the gate phase. The primary/stackInfo block + runner loop run ONLY when ≥1 runner exists. Detect/shell with zero runners → named error. Test: gates-only v2 config → no `runners[0]` deref, gate phase runs (JDA-002). [ci-gates: gates-only repo valid under v2]
- [x] 3.6 GREEN `src/commands/ci.ts`: wire the gate phase AFTER the runner loop (alongside security/ghagga template ~:639-691) gated on `mode==="full" || mode==="quick"`; SKIP in `detect`/`shell`. Gate cwd = repo root (`projectDir`). Env via spawn env map `{...process.env, CI:"true"}` (gate `env` last-wins injection deferred to slice 4 per design slice split); NEVER splice env into the run string. Wire `mode`/`scope:all` only (scope:changed deferred to slice 4). [ci-gates: gate phase runs under full AND quick, skipped detect/shell]
- [x] 3.7 Tests: gates run under quick AND full, skipped in detect/shell (JDB-006); blocking failure exits non-zero; informative failure → `warning`, exit 0, later gates still run; `CI=true` engine-injection asserted (gate `env` last-wins is slice 4).
- [x] 3.8 Run `pnpm validate`. Keep this slice execution-only (status-vocab ripple + prologue guard are the budget risks). PR3.

## Phase 4 — Slice 4: scope:changed + baseline + env + headless JSON (High risk; 4a/4b escape hatch)

- [ ] 4.1 GREEN `src/commands/ci.ts`: wire `git-diff.ts` into the gate phase for `scope:changed` — resolve base ref; base RESOLVES + non-empty set → run gate with `$JAVI_FORGE_CHANGED_FILES` = newline-joined repo-root-relative paths in the env map; base resolves + EMPTY set → `report(…,"skipped","no changed files")`.
- [ ] 4.2 GREEN `src/commands/ci.ts`: loud-degrade BOTH failure modes — base `null` → skip every scope:changed gate `report(…,"skipped","no base ref resolved — skipping scope:changed")`; `changedFiles` THROWS (shallow clone/missing ref) → CATCH and skip identically with `"changed-file diff failed (shallow clone / missing ref) — skipping scope:changed"`. NEVER widen to `all`, NEVER crash the phase. [ci-gates: scope:changed loud-degrade contract]
- [ ] 4.3 Tests: changed scope runs on non-empty diff; empty set skips; no base ref skips loudly + never widens; shallow-clone throw caught, skips loudly, never widens, never crashes (JDA-005).
- [ ] 4.4 GREEN `src/commands/ci.ts`: `baseline` injection — pass the optional gate `baseline` path to the gate command environment/args per gate contract.
- [ ] 4.5 RED+GREEN `src/cli/dispatch/ci.tsx`: NEW headless gate-run branch — when `--json` is set on the `ci` RUN path (~:117-131, currently `--json` only wired to `ci validate` at :36-62), BYPASS the Ink render, drive `runCI` collecting gate outcomes into `{ok, gates:[{id,mode,scope,status,blocking,changedFiles?,exitCode?}]}`, print the object, and set the process exit code EXPLICITLY (CI.tsx's catch is unreachable without a render). `ok` is `false` iff a BLOCKING gate errored; `exitCode` = its first-failure code. This is a NEW non-Ink path, NOT flag reuse (JDA-004/JDB-005). [ci-gates: Gate-run JSON output]
- [ ] 4.6 Tests: JSON shape + `ok:false` on blocking failure (blocking entry `status:"error"`,`blocking:true`; informative entry `status:"warning"`); `ok:true` + exit 0 when only informative fails.
- [ ] 4.7 BUDGET GATE: if slice 4 diff >400 prod lines, SPLIT — 4a = scope:changed wiring (4.1-4.3) + headless JSON (4.5-4.6); 4b = baseline (4.4) + env polish. Re-check before opening the PR.
- [ ] 4.8 Run `pnpm validate`. Final PR (4 or 4a→4b).

## Notes (folded design decisions)

- Monorepo caveat: `$JAVI_FORGE_CHANGED_FILES` paths are repo-root-relative (git native form); a gate running from a subdir must relativize itself — engine does NOT rewrite per-gate. Documented, not solved.
- `src/lib/docker.ts` is NOT touched — `DockerRunOptions.env`/`-e` plumbing dropped (gates native in v1; Docker gates = deferred follow-up needing gate-image resolution).
- Env safety: values pass as discrete spawn env entries, never concatenated into `bash -c` — no shell injection.
- Migration: additive opt-in; the fleet consumer (consorcio-canalero) ships `version: 1`, byte-identical parse, unaffected. Per-slice revert clean.
