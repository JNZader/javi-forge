# Exploration: gates-v2 — declarable named quality gates in `.javi-forge/ci.yaml`

Verified against `main` on 2026-08-09 (post ci-validate JF-DOCS-1 + ENV-1 + B3 merges). All line numbers are CURRENT.

## Current State (seams re-verified)

- `CIStepStatus` = `"pending" | "running" | "done" | "error" | "skipped"` — **ci.ts:47** (moved from :46). NO `warning`/informative value. UI maps it 1:1 at `src/ui/CI.tsx:13-27` (STATUS_ICON + STATUS_COLOR Records keyed on `CIStep["status"]` — adding a status REQUIRES a new key in both Records or TS fails).
- `CIStep` interface — ci.ts:49-54.
- Phase list — **ci.ts:860-882** (was :854): `setup, lint, compile, test, security`, each `{id,label,cmds,skip}` with `test` carrying `doneLabel:"Tests"`. Loop at 884-915.
- `runStep` (single execution leaf) — **ci.ts:918-965** (was :913). Native branch (spawn bash -c, stdio inherit) or Docker branch (`runInContainer` at 953). Options-object `RunStepOptions` (735-744) with `image?` REQUIRED when `!noDocker` (invariant throw at 943).
- Failure model is fail-HARD: every phase `throw e` (904-912) aborts the whole run; runner loop (ci.ts:626-637) aborts all runners on first throw. There is NO per-step continue-on-failure concept anywhere. `mode: informative` is genuinely new machinery.
- Config whitelist — **ci-config.ts**: `CI_CONFIG_VERSION = 1` (:21), `TOP_LEVEL_FIELDS = new Set(["version","runners"])` (:89), `RUNNER_FIELDS` (:96-108). Fail-closed on unknown keys: top-level at :308-312, runner at :156-163. `doc.version !== 1` hard error at :314-319.
- `ci validate` surface — `src/commands/ci-validate.ts` `validateCIConfig()` (pure parse-and-report, no exec) + dispatch `src/cli/dispatch/ci.tsx:28-72`. `--json` already wired. gates-v2 MUST extend this to validate the gates schema.
- Flags schema — `src/cli/help.ts:149-176`: `json`, `config`, `stack`, `force`, `timeout` all present. `json: {type:"boolean",default:false}` (:176) — reuse for gate-run JSON, no new flag.

## Q2 — SCHEMA DECISION (hardest call #1): version:2, additive, fail-closed preserved

Scout's single-consumer finding HOLDS on main: only `runners`+`version:1` consumed; auto-detect fleet carries NO ci.yaml. `openspec/config.yaml:48` REQUIRES spelling out v1 back-compat.

- **A. version:2 + gates additive (RECOMMENDED)** — bump accept-set to `{1,2}` (NOT flip 1→2). v1 configs parse byte-identically; `gates` only valid when `version===2`; `runners` becomes OPTIONAL under v2 (gates-only repos). Fail-closed preserved. Cost: version-negotiation branch + "gates require version: 2" named error.
- **B. gates under version:1 (no bump)** — smallest diff, but sacrifices the schema's one hard signal and muddies what `version` means. Rejected (scout warned against trading fail-closed for additive).
- **C. separate `gates.yaml`** — clean separation but second discovery/loader + env/baseline split-brain. Over-engineered for a 1-file fleet. Rejected.

**Version negotiation reality**: a v2 config does NOT need to parse on v1 binaries. Fleet = ONE v1 ci.yaml (consorcio-canalero, no gates) + the global linuxbrew install. "Upgrade the binary, then adopt version:2" is the honest contract — semantic-release ships the binary, the one consumer opts in when ready. Old binary + v2 file → the clean "version must be 1" error (ci-config.ts:314), correct fail-closed. No forward-compat shim.

## Q3 — GATE MODEL (minimal schema)

```yaml
gates:
  - id: <string, unique, tag-safe>     # reuse RUNNER_NAME_RE
    run: <string | string[]>           # reuse normalizeCommands()
    mode: blocking | informative       # default blocking
    scope: all | changed               # default all
    baseline: <path?>                  # optional JSON, security-baseline pattern
    env: <record<string,string>?>      # optional, injected into the step
```
Const-objects per typescript SKILL: `GATE_MODE`, `GATE_SCOPE`. Gates are a **repo-level phase** running AFTER the runner loop, alongside security/ghagga (ci.ts:639-691 is the template) — NOT inside `runRunner`. Execution flows through `runStep` for native/Docker parity, wrapped in a **non-throwing outcome collector**: blocking failure → today's throw (exit 1); informative failure → `report(…,"warning",…)`, no throw, exit 0. Requires `CIStepStatus += "warning"` (ci.ts:47) + both UI Records (theme.warning already exists).

## Q4 — DIFF-VS-BASE ENGINE (hardest call #2)

NO git-diff in the engine today (git only in init/git.ts for `git init` + hook reads). Established invocation: `execFileAsync("git",[...],{cwd})` from `src/lib/exec.ts` (git.ts:26,81-91 — argv array, never shell string).

Base-ref chain (biogas, ported + forge-agnostic):
1. `$CI_MERGE_REQUEST_DIFF_BASE_SHA` (GitLab MR)
2. `$CI_COMMIT_BEFORE_SHA` (GitLab push; reject all-zeros new-branch sentinel)
3. `$GITHUB_BASE_REF`/`$GITHUB_SHA` (GitHub Actions — add it, the CLI is forge-agnostic)
4. Local: `git merge-base` against `origin/main`→`origin/master`→`main`→`master` (fleet is main-based, not biogas's `origin/develop`)
5. Nothing resolves → **skip scope:changed gates with a named warning; do NOT silently widen to `all`** (would run an expensive gate the author scoped down on purpose).

Changed files: `git diff --name-only --diff-filter=ACMR <base>...HEAD` (three-dot) ∪ unstaged ∪ `--cached`; `ACMR` drops deletions. Consumed via `$JAVI_FORGE_CHANGED_FILES` env (gate `run` is a shell string, not argv). Empty set → gate `skipped`.

**Testable without a real repo**: a thin injectable seam `src/lib/git-diff.ts` exposing `resolveBaseRef(env, cwd)` + `changedFiles(base, cwd)`, both taking an explicit env record. Base-ref precedence → pure table-driven unit test (zero git). File computation → mock `execFileAsync` (docker.ts mock in ci.test.ts is the template) + ONE real `git init`+2-commits integration test.

## Q5 — B1 + B2 (both OPEN on main)

- **B1** (BACKLOG.md:11-21): `--stack node` emits suffixed `lint:node` because BARE naming is `source==="auto"`-only (ci.ts:624-625); step id at **ci.ts:886**. gates-v2 does NOT touch runner naming, so B1 does NOT auto-resolve. A real behavior decision (silently renames) — decide bare-for-single-runner vs always-suffixed and pin with a test in slice 1.
- **B2** (BACKLOG.md:23-33): `ci --shell` builds from `stackInfo`, ignoring `runner.image`/`buildContext` — **ci.ts:516-541** (`ensureImage({stack:stackInfo.stackType…})` @524-527). Orthogonal to gates; does NOT auto-resolve. Fold into slice-1 "touch the exec area once" with its own test.

Neither resolves as a side effect — both are explicit slice-1 cleanup (Fix-Between-SDDs discipline).

## Q6 — Blast radius + slicing

Files: `src/lib/ci-config.ts` (schema), `src/lib/git-diff.ts` (NEW), `src/commands/ci.ts` (status vocab + gate phase + B1/B2), `ci-validate.ts`+`ci.tsx` (validate + JSON run), `src/ui/CI.tsx` (warning icon/color), `src/cli/help.ts`.

- **Slice 1** — schema (version:2 accept-set + `gates` validation + extend `ci validate`) + B1 decision + B2 fix. Additive, LOW risk.
- **Slice 2** — `git-diff.ts` fully tested, NOT yet wired. Autonomous, LOW risk.
- **Slice 3** — `CIStepStatus += warning`, non-throwing gate runner, `mode`/`scope:all` through runCI + UI. **400-line risk HIGH** (status-vocab ripples into 2 UI Records + JSON + switches).
- **Slice 4** — `scope:changed` (wire slice-2 engine) + `baseline` + `env` + `--json` run output. **HIGH** — split baseline/env out if it grows.

## Q7 — JSON output shape

Precedents: `ci validate --json` → `{ok,runners}`/`{ok:false,errors:[{path,message}]}` (ci.tsx:36-65); `security --json` suppresses step chatter, emits `JSON.stringify(result,null,2)` once, exit 1 on regressions (security.ts:62,69,84-85). Gate-run JSON (reuse existing `json` flag, help.ts:176):
```jsonc
{ "ok": <false iff any BLOCKING gate failed>,
  "gates": [ { "id","mode","scope",
    "status":"done|error|warning|skipped",
    "blocking":<bool>, "changedFiles":<int?>, "exitCode":<int?> } ] }
```
Exit 0 unless a blocking gate errored; informative failures → `status:"warning"`, `ok:true`, exit 0.

## Recommendation

version:2 additive (Option A) preserving fail-closed; gates as a repo-level phase reusing `runStep` with a non-throwing wrapper; a new injectable `src/lib/git-diff.ts` for the base-ref chain (env-precedence pure + mocked execFileAsync + one real-git integration test); `CIStepStatus += "warning"` for informative; 4-slice chain with B1/B2 folded into slice 1. Fleet reality (1 v1 consumer, no gates) makes "upgrade binary then opt into v2" the honest contract — no forward-compat shim needed.

## Risks

- Status-vocab change (`warning`) is cross-cutting: 2 UI Records + JSON + exhaustive switches. Slice-3 400-line risk.
- Diff engine must degrade LOUDLY (skip+warn, never widen scope:changed→all).
- `env` injection into a shell `run` string is an injection surface — prefer the child-process env map. Native uses spawn env; **Docker branch needs `-e` plumbing into `runInContainer` — VERIFY runInContainer env support before promising `env:` for Docker gates**.
- Gate cwd + changed-files-relative-to-repo-root vs `runner.directory` mismatch for monorepo gates.
- B1 is a real behavior decision (silently renames), not mechanical — needs a call.
