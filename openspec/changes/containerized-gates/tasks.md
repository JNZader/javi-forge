# Tasks: containerized-gates

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~430–520 (S1 ~60, S2 ~260, S3 ~160) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 schema → PR2 exec+docker → PR3 fail-closed |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending (user decides) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema: `image?` on gate | PR 1 | LOW; additive; standalone |
| 2 | docker.ts contract + ci.ts routing | PR 2 | HIGH ~260 lines; land docker.ts FIRST (2a) then ci.ts (2b); 400-risk → keep two commits, consider 2a/2b split if diff >400 |
| 3 | Fail-closed + timeout threading | PR 3 | MED; depends on PR 2 |

TDD: vitest RED→GREEN per task. Coverage floors 85/80 enforced same-run by `test:coverage`; a delta drop below the 80 line floor fails the PR.

## Phase 1: Slice 1 — Schema (LOW)

- [x] 1.1 Commit untracked `openspec/changes/containerized-gates/` scaffolding (proposal, specs, design, review-ledger) before any code.
- [x] 1.2 RED: in `ci-config.test.ts` add cases — valid `image`, empty/non-string rejected (named `.image` error), leading-`-` rejected (JDB-004) [spec ci-gates scenarios 1–3].
- [x] 1.3 GREEN: `ci-config.ts` — add `image?: string` to `CIGateConfig` (68-87); add `"image"` to `GATE_FIELDS` (316-324); in `validateGate` add non-empty + leading-`-` guard + return `image` (mirror runner 252-262). version:2 unchanged.
- [x] 1.4 Extend `ci validate` output to surface the `image` field; test v2-gate-without-image parses byte-identically [scenario 4].

## Phase 2: Slice 2a — docker.ts contract (HIGH, land FIRST)

- [x] 2.1 RED: `docker.test.ts` — new argv asserts: NO `timeout`/600/120 (DELIBERATE non-additive churn, sanctioned); `--name javi-forge-ci-<hex>`; `-e CI=true` first then `-e K=V` pairs from `env`; no-env caller argv unchanged [ci-execution env scenarios].
- [x] 2.2 RED: `docker.test.ts` result asserts add `timedOut` (required field): timeout→true, genuine 124→false [ci-execution timedOut scenarios].
- [x] 2.3 GREEN: `docker.ts` — `DockerRunOptions.env?` → `-e KEY=VALUE` argv (never shell-spliced); remove in-container `timeout` wrapper + `timeout=600` default (gate 7); add `--name <cid>` via `crypto.randomBytes(6)`.
- [x] 2.4 GREEN: `docker.ts` — host wall-clock `killTimer`: set `timedOut=true` BEFORE `docker stop -t <grace> <cid>`; `backstopTimer`→`proc.kill("SIGKILL")` on client after grace (JDA-001); clearTimers on close/error; add `timedOut` to `DockerRunResult`. (grace=10s; behaviorally verified with a REAL node:22-slim run: timeout 2s → timedOut=true, exitCode 137 after grace, no orphan container.)
- [x] 2.5 Verify `runStep` Docker caller (ci.ts:1026-1036) unaffected — reads `exitCode`, throws non-zero; new field inert [ci-execution runStep-unaffected scenario].

## Phase 3: Slice 2b — ci.ts routing (HIGH)

- [x] 3.1 RED (LOAD-BEARING, must-have): `ci.test.ts` — a host secret in `process.env` (e.g. `AWS_SECRET_ACCESS_KEY`) is NOT in the container `-e` argv (JDB-001) [ci-gates env-allowlist scenario].
- [x] 3.2 RED: `ci.test.ts` — `CI`/`JAVI_FORGE_CHANGED_FILES`/`JAVI_FORGE_BASELINE`/`gate.env` reach container as `-e` pairs; update `runInContainer` mock to return `timedOut`.
- [x] 3.3 GREEN: `ci.ts` — add `runGateCommand` adapter: `image===undefined`→`runGateNative(nativeEnv)`; else `runInContainer({env: containerEnv})`; return `{code: timedOut?124:exitCode, timedOut}`. Split env: `nativeEnv={...process.env,CI,...injected,...gate.env}`, `containerEnv={CI,...injected,...gate.env}` (NEVER process.env). NOTE: slice-2 `runGateCommand` takes no DockerGateContext yet (fail-closed is slice 3).
- [x] 3.4 GREEN: repoint loop call (ci.ts:1400-1413) to `runGateCommand`; collector body (exitCode/timedOut/timeoutReason/blockingFailures/emit) untouched.

## Phase 4: Slice 3 — Fail-closed + timeout (MED)

- [ ] 4.1 RED (LOAD-BEARING, must-have): `ci.test.ts` — timed-out BLOCKING container gate resolves non-zero, carries `reason` matching `timed out`, build FAILS (no false-green) [ci-gates timeout-hangs scenario].
- [ ] 4.2 RED: `ci.test.ts` — genuine `exit 124` under generous timeout → exitCode 124, NO reason (timedOut false); no-timeout container gate arms no timer (unbounded) [ci-gates scenarios].
- [ ] 4.3 RED: `ci.test.ts` — image-gate refused under `--no-docker` AND Docker-down: blocking→error+aggregate throw, informative→warning, never native; non-image gate runs native under `--no-docker` [ci-gates matrix scenarios].
- [ ] 4.4 GREEN: `ci.ts` — add `DockerGateContext {noDocker, isAvailable}` param to `runGates` (BEFORE `onOutcome?`, JDB-002); thread both call sites (:535, :760); lazy-memoized `dockerAvailable` reusing prologue result (:603-617).
- [ ] 4.5 GREEN: `ci.ts` — refuse branch before `gate.run` loop, only when `image && !noDocker` touches `isAvailable` (image-less sets never shell out to docker info).
- [ ] 4.6 BEHAVIORAL (apply-time, NOT inspection): run a real Docker image gate with `timeout:1` hanging; verify `docker stop` tears down the `--rm --name <cid>` container (no orphan) and gate resolves. Design flagged this as assumption-to-validate.

## Phase 5: Docs

- [ ] 5.1 Document image contract: must ship `bash`; timeout budget = total wall-clock incl. image pull (pre-pull / generous timeout guidance, JDA-002); no in-container `timeout` binary needed.
