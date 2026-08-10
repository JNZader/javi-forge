# Review ledger: containerized-gates

## Design — judgment-day

Two blind judges (A, B) reviewed the DESIGN. A: APPROVE-WITH-FIXES. B:
APPROVE-WITH-FIXES with ONE CRITICAL. Confirmed fixes applied to `design.md`
(+ `specs/ci-gates/spec.md` where noted).

| id | lens | location | severity | status | evidence |
|----|------|----------|----------|--------|----------|
| JDB-001 | judgment-day | design.md gate 2 / gate 3; specs/ci-gates/spec.md | CRITICAL | fixed | Container gate forwarded full `gateEnv` (= `{...process.env, …}`) as `-e KEY=VALUE` argv: (a) leaks every host secret to the host process table (`ps aux`); (b) injects host env into a repo-pinned, possibly third-party image, defeating isolation. Runner path forwards only `-e CI=true` (docker.ts:314-315); gate path must not be the outlier. FIX: split env construction — native gets `{...process.env, ...injected, ...gate.env}`; container gets an EXPLICIT ALLOWLIST `{CI, ...injected-when-present, ...gate.env}` only, never `process.env`. Spec scenario added. |
| JDA-001 / JDB-003 | judgment-day | design.md gate 1 | WARNING (convergent) | fixed | `docker stop` fire-and-forget can hang forever if the daemon is wedged / stop fails → docker-run client never closes → gate hangs. `runGateNative` is strictly more reliable (SIGKILLs its own child). FIX: added a LAST-RESORT `backstopTimer` that, after the `docker stop -t <grace>` window elapses without `close`, escalates to `proc.kill("SIGKILL")` on the docker-run CLIENT. `--rm` + `--name` bound any orphan; fail-slow → fail-bounded. |
| JDA-002 | judgment-day | design.md gate 1; specs/ci-gates/spec.md | WARNING | fixed | Host timer starts at `spawn("docker run")`, so image pull + startup count against `gate.timeout` — a cold digest-pinned pull can trip a spurious timeout; "outcome-equivalent to native" overstated on timing. FIX: added a known-behavior paragraph (budget is total wall-clock incl. pull, unlike native) + mitigation (pre-pull / generous timeouts; no pull-vs-run split in v1) + spec note. |
| JDB-002 | judgment-day | design.md gate 4 (+ arch glance, call sites) | WARNING | fixed | `runGates` placed required `docker: DockerGateContext` AFTER optional `onOutcome?` → TS1016 "required parameter cannot follow optional." FIX: reordered so `docker` precedes `onOutcome?`; updated both call sites and the architecture-at-a-glance signature. |
| JDB-004 | judgment-day | design.md gate 6; specs/ci-gates/spec.md | SUGGESTION | fixed | `validateGate` accepted any non-empty `image`; a leading-`-` value (`--privileged`, `-v /:/host`) could be parsed by docker as a run FLAG. Bounded by existing ci.yaml-author trust but cheap to harden. FIX: reject `image` starting with `-` at validation with a named error (preferred over `--` end-of-options marker). Spec error-scenario added. |

### Verified-safe claims both judges confirmed (no change needed)

| id | lens | severity | status | evidence |
|----|------|----------|--------|----------|
| JD-SAFE-01 | judgment-day | INFO | verified | Timeout false-green defeated: host wall-clock `timedOut` boolean is authoritative, never inferred from exit code; a genuine 124 stays distinguishable from a timeout. |
| JD-SAFE-02 | judgment-day | INFO | verified | `docker stop` targets a concrete `--name <cid>` container (unique `crypto.randomBytes` name), not a guess; kills container not client to avoid orphaning. |
| JD-SAFE-03 | judgment-day | INFO | verified | Removing the `= 600` destructuring default in `runInContainer` is inert to `runStep`, which always passes a concrete `timeout` (RunnerExecContext.timeout ← runCI 600). |
| JD-SAFE-04 | judgment-day | INFO | verified | Env delivered as `-e KEY=VALUE` argv elements to `spawn` (no shell) — values with spaces/`=`/newlines survive verbatim; safe from shell-splicing. |
| JD-SAFE-05 | judgment-day | INFO | verified | Fail-closed threading correct: image-gate + no Docker → REFUSE (blocking → error + blockingFailures + aggregate throw; informative → warning), never native/unpinned; applied at BOTH runGates call sites. |

## Design — round 2 (scoped re-judge, judge B) — APPROVED after doc-alignment

JDB-001 (CRITICAL env leak) VERIFIED FIXED end-to-end (allowlist container env, native keeps full env, spec scenario proves AWS secret not passed). Convergent/minor (JDA-001/JDB-003 backstop, JDA-002 pull-budget, JDB-002 signature, JDB-004 leading-dash) all verified fixed. Two doc-alignment items closed by orchestrator post-budget (no logic change — aligning specs/prose to the already-approved gate-1/gate-8 host-side-timeout decision):

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JDB-005 | judgment-day | specs/ci-execution/spec.md:35,:62-67 | CRITICAL | fixed | ci-execution spec still described the REMOVED in-container timeout model + mandated a `timeout` binary the design deleted (would misdirect tasks into rebuilding the argv-timeout/R3-004 contract). Fixed: :35 scenario → host-side docker-stop termination; portability req → only `bash` required, no in-container `timeout` binary. |
| JDB-006 | judgment-day | design.md:125 | SUGGESTION | fixed | Prose "we never SIGKILL the client" contradicted the new backstopTimer (which does, as last resort). Reconciled: normal path doesn't; backstop SIGKILLs the client only on wedged-daemon, bounded orphan via --rm+--name. |

Verified-safe (both judges): timeout false-green defeated (host timer sets timedOut before kill, clearTimers race-safe), docker stop has --name target, removing 600 default inert to runStep (only concrete-timeout caller), env argv-safe from shell-splicing, fail-closed threading correct at both seams, backstop guarantees promise resolution.
