# Design: gates-v2 — declarable named quality gates

## Technical Approach

Additive `version: 2` schema unlocks a `gates:` block. Gates run as a repo-level phase in `runCI` AFTER the runner loop, alongside security/ghagga (ci.ts:639-691 template), executed **host-NATIVE** through a new `runGateNative` helper modeled on `runSemgrep`/`runGhagga` (spawn the `run` command with a process env map, NOT through `runStep`'s Docker branch — see the "Gate execution backend" decision), wrapped in a NON-throwing collector so `mode: informative` failures degrade to a `warning` status (exit 0) while `mode: blocking` failures produce exit 1. A **gates-only v2 repo (zero runners)** is valid: the `runCI` prologue MUST guard the `resolved.runners[0]` dereference (ci.ts:502-510) and the runner-loop image/docker-check work, going straight to the gate phase when `resolved.runners` is empty. `scope: changed` consumes a changed-file set from a new injectable `src/lib/git-diff.ts` that resolves a base ref forge-agnostically and degrades LOUDLY (skip + named warning, never widen) on BOTH a null base AND a `changedFiles` execution failure (shallow-clone / missing-ref). `env` reaches the child via the process env MAP only — never string-spliced into the shell `run`. 4-PR sequential chain, each ≤400 production lines.

## Architecture Decisions

### Decision: Gate execution backend — NATIVE-ONLY in v1 (Docker deferred)

**Evidence**: The template these gates copy — the top-level security/ghagga phase (ci.ts:639-691) — runs host-NATIVE via `runSemgrep`/`runGhagga`, which `spawn` a process directly; it does NOT go through `runStep`. `runStep`'s Docker branch (ci.ts:937-964) REQUIRES a resolved runner + image (`RunStepOptions.runner`, `options.image`, throws "no Docker image resolved" without them). Gates are repo-level: they have no runner and no image, so they structurally cannot use the Docker branch. `runStep` also returns `void` and throws on non-zero (ci.ts:918,930-934), so it cannot surface a child exit code.
**Choice**: Gates execute NATIVE — a new `runGateNative(gate, ctx)` helper spawns `bash -c <run>` at the repo root with `env = {...process.env, CI:"true", JAVI_FORGE_CHANGED_FILES?, ...gate.env}`, exactly like `runSemgrep`/`runGhagga`, and **RETURNS the child exit code** (resolve with the code instead of throwing) so the collector and the JSON `exitCode` field are populatable (fixes JDB-004). Multi-command gates follow the runner fail-fast precedent: run `run[]` in order, first non-zero wins, later commands skipped, and that first-failure code is the reported `exitCode`.
**Consequences propagated**: (a) the slice-4 `DockerRunOptions.env` / `-e` plumbing is DROPPED as unnecessary in v1 — `env:` works via the native spawn env map only; docker.ts is untouched. (b) "gates run in Docker" is an explicit FOLLOW-UP (its own future change), deferred because it needs gate-image resolution (a gate has no runner to inherit an image from). (c) the gate schema needs NO `image` field.
**Alternatives**: (a) route gates through `runStep`'s Docker branch — REJECTED, structurally impossible (no runner/image) and returns void (no exit code); (b) plumb `DockerRunOptions.env` for a Docker gate path in v1 — REJECTED, gates have no image to run in, so the plumbing would be dead code.
**Safety**: `env:` values go into the spawn env MAP, never concatenated into the `bash -c` string, so no shell injection.

### Decision: Non-throwing gate runner + deferred blocking failure

**Choice**: A `runGate(gate, ctx)` wrapper calls `runGateNative` (native spawn, returns exit code) inside try/catch and inspects the returned code. On code 0 → `report(...,"done")`. On non-zero (or spawn error): if `mode === blocking`, record the gate id into a `blockingFailures[]` accumulator and `report(...,"error")` — but do NOT re-throw yet; if `mode === informative`, `report(...,"warning")` and continue. After the gate loop completes, if `blockingFailures.length > 0`, throw ONE aggregate error (`"blocking gate(s) failed: <ids>"`). This raise point is AFTER all gates run, so one blocking failure never hides a later gate's result — every gate always reports its own status. Informative failure never contributes to the accumulator → process exit stays 0. Blocking failure → the existing top-level throw path yields exit 1.
**Alternatives**: throw-on-first-blocking (today's fail-hard model) — REJECTED, it hides later gates, defeating the "run all gates, see everything" payoff.

### Decision: gate-only prologue guard (zero-runner v2 repo)

**Evidence**: `runCI` unconditionally dereferences `resolved.runners[0]` at ci.ts:502 and reads `.stack/.buildTool/.javaVersion` (:503-510); a gates-only v2 config resolves ZERO runners → TypeError BEFORE the gate phase ever runs (JDA-002/JDB-002). ci-config.ts:321-326 also hard-requires a non-empty `runners` list.
**Choice**: Two coordinated changes. (schema, slice 1) Relax ci-config's non-empty-runners requirement UNDER v2 ONLY — v1 still REQUIRES a non-empty `runners`; v2 allows `runners` optional WHEN `gates` is present. (prologue, slice 3) Guard the `runCI` prologue: when `resolved.runners.length === 0`, SKIP building `stackInfo`, the docker-check, and image resolution, and jump straight to the gate phase; the `primary`/`stackInfo` block and the runner loop only run when at least one runner exists. Detect/shell modes with zero runners report a named error (nothing to detect/shell into).

### Decision: `CIStepStatus += "warning"` ripple

`CIStepStatus` at ci.ts:47 gains `"warning"`. TypeScript then FORCES a new key in both `Record<CIStep["status"],...>` at CI.tsx:13-27 or the build fails — that is the compile-time guard. Exact edits:
- `STATUS_ICON` (CI.tsx:13-19): add `warning: "⚠"`.
- `STATUS_COLOR` (CI.tsx:21-27): add `warning: theme.warning` (already used for `running`; `theme.warning` exists).
- No exhaustive `switch` on status exists in the engine (statuses flow through the `report()` string arg and the two Records only) — verified via grep; the two Records are the whole ripple.
- JSON shape (gate-run, slice 4): `status: "done"|"error"|"warning"|"skipped"`.

### Decision: version negotiation — accept-set `{1,2}`, not a flip

`CI_CONFIG_VERSION` check (ci-config.ts:314) becomes an accept-set `{1,2}`. `gates` valid ONLY when `version===2`; a v1 config with `gates` → named error "gates require version: 2". `runners` becomes OPTIONAL under v2 WHEN `gates` is present (gates-only repo); v1 still requires a non-empty `runners`. v1 parses byte-identically. Fail-closed on unknown keys preserved (add `gates` to `TOP_LEVEL_FIELDS` only under v2 acceptance).

**Named-error ordering (JDA-006)**: the current unknown-key loop (ci-config.ts:308-312) runs BEFORE the version check (:314), so a `version: 1` config carrying `gates` would emit the generic `unknown field "gates"` instead of the spec-mandated `"gates require version: 2"`. Fix: read `doc.version` FIRST, compute the allowed-key set as a function of the accepted version, and special-case `gates`-under-v1 to the named `"gates require version: 2"` error BEFORE the generic unknown-field path. Only keys that are unknown under BOTH versions reach the generic error.

### Decision: gate mode-gating — gates run on every real CI run (JDB-006)

**Evidence**: the security/ghagga phases are gated on `mode === "full"` (ci.ts:640,670); under `--quick` (`mode === "quick"`) they are SKIPPED. Copying that predicate verbatim would make a BLOCKING gate silently skip under `ci --quick` — a near-false-green, and `--quick` is exactly the pre-push-hook path where a blocking gate matters most.
**Choice**: the gate phase runs on every REAL CI run — both `mode === "full"` and `mode === "quick"` (predicate: `mode === "full" || mode === "quick"`). Gates are SKIPPED only in `detect` and `shell` modes (no run happens). Rationale: a blocking gate that `--quick` skips defeats the pre-push hook use; gates are cheap config the user opted into, so they run whenever CI actually runs. This is pinned by a test in the execution slice and by a spec scenario in ci-gates.

### Decision: gate env precedence — engine keys, then gate `env` (last-wins) (JDB-008)

The native spawn env map is built `{...process.env, CI:"true", JAVI_FORGE_CHANGED_FILES:<...>, ...gate.env}`. Gate `env:` spreads LAST, so a gate CAN override `CI` or `JAVI_FORGE_CHANGED_FILES`. Decision: document last-wins as the contract (a gate author who overrides the changed-files var owns the consequence); the engine does NOT hard-protect the injected keys in v1. Pinned by the "env reaches the child" test asserting the merge order.

### Decision: B1 — bare-by-implicit-name

Naming decided at ci.ts:624-625, today keyed `resolved.source === "auto" ? BARE : SUFFIXED`. New rule: **implicit** name (`source === "auto" || source === "stack-override"`) → BARE; **explicit** (`source === "config"`) → SUFFIXED. This does NOT touch the single-runner-CONFIG path (still `config` → SUFFIXED, the R3 guard at ci.test.ts:1388-1390 stays green). The characterization test `ci.test.ts:1298-1312` ("emits --stack node step ids exactly as they are today (B1 frozen)") froze the status quo and MUST be UPDATED in slice 1 as a sanctioned spec-reversal: expected ids change from `docker-image:node/lint:node/compile:node/test:node` to bare `docker-image/lint/compile/test`.

### Decision: B2 — `ci --shell` honors runner.image/buildContext

Shell mode (ci.ts:516-541) builds from `stackInfo` and ignores per-runner image config. Fix: when the primary resolved runner carries `image` or `buildContext`, resolve the shell image the same way the runner loop does (explicit image passthrough, or `ensureImage({buildContext,imageTag})`), else fall back to `ensureImage({stack, javaVersion})`. Pin with a test.

## Data Flow

    ci.yaml(v2) ─► loadCIConfig ─► gates[] ─┐   (zero runners ─► skip prologue, straight to gates)
                                            ▼
    git-diff.ts: resolveBaseRef(env,cwd) ─► changedFiles(base,cwd)
        │ base=null OR changedFiles throws ─► SKIP scope:changed gate (named warning) │
        ▼                                                              ▼
    runGate ─► env MAP ─► runGateNative (bash -c, host spawn, returns exitCode) ─► child
        │ blocking fail ─► blockingFailures[]   informative fail ─► warning
        ▼ (after loop)
    blockingFailures? ─► throw (exit 1)   else exit 0

## Interfaces / Contracts

```typescript
// src/lib/ci-config.ts
const GATE_MODE = { BLOCKING: "blocking", INFORMATIVE: "informative" } as const;
type GateMode = (typeof GATE_MODE)[keyof typeof GATE_MODE];
const GATE_SCOPE = { ALL: "all", CHANGED: "changed" } as const;
type GateScope = (typeof GATE_SCOPE)[keyof typeof GATE_SCOPE];

interface CIGateConfig {
  id: string;                       // reuse RUNNER_NAME_RE, unique, tag-safe
  run: string[];                    // reuse normalizeCommands (string|string[])
  mode: GateMode;                   // default BLOCKING
  scope: GateScope;                 // default ALL
  baseline?: string;                // optional JSON path (slice 4)
  env?: Record<string, string>;     // optional, injected via env MAP (slice 4)
}

// src/lib/git-diff.ts (NEW — injectable seam)
function resolveBaseRef(
  env: Record<string, string | undefined>,
  cwd: string,
): Promise<string | null>;
// throws on a base sha absent from local history (shallow clone) — caller loud-degrades
function changedFiles(base: string, cwd: string): Promise<string[]>;

// src/commands/ci.ts (NEW native gate exec — models runSemgrep/runGhagga)
// spawns `bash -c <cmd>` at repo root with the merged env map; RETURNS the child
// exit code (does NOT throw on non-zero) so the collector + JSON exitCode populate.
function runGateNative(
  cmd: string,
  cwd: string,
  env: Record<string, string>,
): Promise<number>;
```

No `image` field on `CIGateConfig`: gates run native in v1, so there is no image to resolve.

Base-ref precedence (resolveBaseRef): (1) `$CI_MERGE_REQUEST_DIFF_BASE_SHA` (GitLab MR); (2) `$CI_COMMIT_BEFORE_SHA` (GitLab push) — guard all-zeros `0000…` sentinel → skip; (3) GitHub Actions `$GITHUB_BASE_REF`→merge-base, else `$GITHUB_SHA`; (4) local: `git merge-base <ref> HEAD` trying `origin/main`, `origin/master`, `main`, `master` in order; (5) none resolve → return `null`.

changedFiles argv (union of three sets, `--diff-filter=ACMR` drops deletions):
`git diff --name-only --diff-filter=ACMR <base>...HEAD` ∪ `git diff --name-only` (unstaged) ∪ `git diff --name-only --cached` (staged). Invoked as `execFileAsync("git",[...],{cwd})` — argv array, never a shell string (git.ts:26 precedent).

Loud-degrade (TWO failure modes, both skip-with-warning, NEVER widen, NEVER crash the phase):
- base `null` → caller SKIPS every `scope: changed` gate, `report(...,"skipped","no base ref resolved — skipping scope:changed")`.
- base RESOLVES but `changedFiles(base,cwd)` THROWS — a base sha that is not in local history (CI shallow clone makes `git diff <base>...HEAD` fail with "bad object"/"missing-ref"). `changedFiles` MUST be caught and treated identically: SKIP every `scope: changed` gate with a NAMED warning (`report(...,"skipped","changed-file diff failed (shallow clone / missing ref) — skipping scope:changed")`); NEVER widen to `all`, NEVER let the throw abort the gate phase.

Empty changed set → gate `skipped` ("no changed files"). Non-empty → `$JAVI_FORGE_CHANGED_FILES` = newline-joined, repo-root-relative paths, injected via the gate env map.

## Gate cwd + changed-files relativity (risk #4)

Gates are REPO-level. Gate cwd = repo root (`projectDir`), NOT a runner directory — gates have no `runner.directory`. `$JAVI_FORGE_CHANGED_FILES` paths are repo-root-relative (git's native output form), newline-joined. **Monorepo caveat (honest)**: a gate whose `run` command executes from a subdirectory must itself relativize the repo-root paths (e.g. `sed 's|^packages/api/||'`); the engine does NOT rewrite paths per-gate. This is documented, not solved — gates-v2 ships repo-root-relative as the single honest contract.

## Env injection safety (risk #3) — resolved by native-only scoping

`env:` values NEVER touch the `run` shell string. Gates run NATIVE (see "Gate execution backend"): values are merged into the spawn env map (`env: {...process.env, CI:"true", JAVI_FORGE_CHANGED_FILES:<...>, ...gate.env}`, modeled on ci.ts:928). Values pass as discrete env entries, so metacharacters in a value cannot break out into `bash -c`. The Docker `-e` risk is SCOPED OUT: v1 has no Docker gate path, so no `DockerRunOptions.env` plumbing exists to secure (Docker gates are a deferred follow-up that will re-open this risk on its own terms).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/ci-config.ts` | Modify | accept-set {1,2}; `CIGateConfig`, `GATE_MODE`/`GATE_SCOPE`; `validateGates()`; `gates` in TOP_LEVEL_FIELDS under v2; **runners OPTIONAL under v2 when gates present (v1 still requires runners)**; **error-ordering: version/allowed-key set computed AFTER `doc.version`, gates-under-v1 named error before generic unknown-field** (slice 1) |
| `src/lib/git-diff.ts` | Create | base-ref chain + changedFiles; `changedFiles` throws on missing-ref → caller degrades (slice 2) |
| `src/commands/ci.ts` | Modify | **prologue guard: zero-runner v2 skips stackInfo/docker-check/image, jumps to gate phase** (slice 3); `CIStepStatus += warning`; **`runGateNative` (host spawn, returns exit code)** + `runGate` collector; gate phase gated on `mode==="full"||mode==="quick"`; B1 naming; B2 shell image |
| `src/commands/ci-validate.ts` | Modify | validate gates; report gate errors |
| `src/cli/dispatch/ci.tsx` | Modify | **NEW headless gate-run branch: `--json` on the `ci` RUN path bypasses Ink, collects gate outcomes, emits `{ok,gates}`, sets its OWN exit code** (slice 4) |
| `src/ui/CI.tsx` | Modify | `warning` icon + color (2 Records) |
| `src/commands/ci.test.ts` | Modify | UPDATE B1-frozen test (1298-1312) → bare ids |

`src/lib/docker.ts` is NO LONGER touched — the `DockerRunOptions.env` / `-e` plumbing is dropped (gates run native in v1; Docker gates are a deferred follow-up).

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | base-ref precedence | pure table-driven, fake env, NO git |
| Unit | changedFiles argv | mocked `execFileAsync` (docker mock pattern in ci.test.ts) |
| Unit | changedFiles missing-ref → throws → gate skipped w/ named warning | mock `execFileAsync` reject; assert loud-degrade, no widen, no crash |
| Integration | real diff | temp `git init` + 2 commits **on a DETERMINISTIC `main` branch (`git init -b main` or explicit base sha)** so it exercises the diff path, NOT the loud-degrade path (independent of `init.defaultBranch`) |
| Unit | runGate blocking/informative/exit | `runGateNative` returns non-zero → assert accumulator + warning status + populated `exitCode` |
| Unit | native exec returns child exit code | assert `runGateNative` resolves the code, does not throw |
| Unit | multi-command gate fail-fast | first non-zero wins, later cmds skipped, first code reported |
| Unit | gate env last-wins merge order | assert `{...process.env,CI,CHANGED_FILES,...gate.env}` precedence |
| Unit | gate mode-gating | gates RUN under full AND quick; SKIP under detect/shell |
| Unit | gates-only v2 prologue guard | zero-runner v2 config → no `runners[0]` deref, gate phase runs |
| Unit | schema v1 byte-identical + v1-with-gates NAMED error (before generic) + v2 runners-optional | ci-config parse tests |
| Unit | B1 bare ids / R3 guard intact | UPDATE 1298-1312; keep 1388-1390 |
| Unit | B2 shell honors image/buildContext | new test |

## Slice Boundaries (≤400 prod lines each)

1. **Schema + B1 + B2** (LOW): accept-set {1,2}, gates validation, **runners-optional under v2 (v1 unchanged)**, **named-error ordering (version-first, gates-under-v1 named before generic unknown-key)**, extend `ci validate`, B1 naming + test update, B2 shell fix. No execution.
2. **git-diff.ts** (LOW): fully tested, UNWIRED. Autonomous. Includes the missing-ref/shallow-clone throw behavior (caller wires the degrade in slice 4).
3. **Gate execution + status vocab + prologue guard** (HIGH 400-risk): `CIStepStatus += warning` + 2 UI Records, **`runGateNative` (host spawn, returns exit code)**, `runGate` non-throwing collector + deferred blocking raise, `mode`/`scope:all` through runCI gated on `full||quick`, **the zero-runner prologue guard** (skip stackInfo/docker-check/image when `resolved.runners` is empty). `scope:changed` NOT wired. Status-vocab ripple + the prologue guard are the budget risks — keep this slice execution-only.
4. **scope:changed + baseline + env + headless JSON** (HIGH 400-risk): wire git-diff (base-null AND missing-ref loud-degrade), env map injection (last-wins), baseline, and the **NEW headless `--json` gate-run branch** (see below). NO `DockerRunOptions.env` work — dropped. **Budget flag**: the headless JSON branch is heavier than a flag reuse (it is a new non-Ink run path), so if >400, SPLIT baseline+env into slice 4b, leaving 4a = scope:changed wiring + headless JSON.

**Headless JSON is a NEW run path, not flag reuse (JDA-004/JDB-005)**: `--json` is currently consumed ONLY by `ci validate` (dispatch/ci.tsx:36-62); the main `ci` RUN path (:117-131) always renders Ink and never reads `json`. The gate JSON output is therefore a NEW headless branch on the run path: when `--json` is set, bypass the Ink render, drive `runCI` collecting gate outcomes into `{ok, gates:[{id,mode,scope,status,blocking,changedFiles?,exitCode?}]}`, print the object, and set the process exit code EXPLICITLY (CI.tsx's catch is unreachable without a render, so the headless branch owns its exit code). `ok` is `false` iff a BLOCKING gate errored; the JSON `exitCode` is the first-failure code of that gate.

## Non-goals

Flip default 1→2; forward-compat shim; separate `gates.yaml`; changing auto-detect fleet; reverting the archived single-runner-CONFIG-suffixed R3 rule; per-gate monorepo path rewriting; **running gates in Docker (deferred follow-up — needs gate-image resolution); `DockerRunOptions.env` `-e` plumbing (dropped — gates are native in v1)**.

## Migration / Rollout

Additive opt-in. The one fleet consumer (consorcio-canalero) ships `version: 1`, byte-identical parse, unaffected. Contract: upgrade binary, then adopt `version: 2`. Per-slice revert clean (slice 2 ships unwired). Rollback = patch-release binary.

## Open Questions

Resolved by judgment-day design pass (2026-08-09):
- **Gate execution backend** — RESOLVED native-only in v1 (Docker deferred). Docker-env plumbing DROPPED.
- **Live-spec contradiction** — the promoted `ci-execution` spec (spec.md:81-82) says "No `ci.yaml` schema key MAY be added; schema version 1 stays locked and still rejects unknown keys." gates-v2 adds `version: 2` + `gates`, which CONTRADICTS that requirement. RESOLVED by a MODIFIED requirement delta in `specs/ci-execution/spec.md` re-scoping the lock to v1 only (v2 additive). This was a BLOCKING contradiction, now closed by the delta.
- B1 spec-reversal sanctioned by proposal.
