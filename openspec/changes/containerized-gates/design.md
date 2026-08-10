# Design: containerized-gates

Architectural HOW for optional per-gate containerized execution (`gate.image`) in
`javi-forge` CI. Scope, user-locked decisions and slices come from the proposal
(engram `sdd/containerized-gates/proposal`, id 13470) and exploration (id 13465).
All file:line references verified vs `main @ dd56382`.

## User-locked decisions (NOT re-litigated here)

- `gate.image` = plain digest-pinnable image ref only (verbatim passthrough). No build-context for gates.
- Strictly per-gate. No whole-run pinning / devcontainer.
- Fail-closed is TARGETED: image-gate + no Docker → REFUSE; gate without image → native always.
- No-timeout containerized gate = UNBOUNDED (no in-container 600s cap).

## Architecture at a glance

```
runGates(gates, projectDir, onStep, dockerGate, onOutcome?)     ← ci.ts (docker BEFORE optional onOutcome — gate 4)
   └─ per gate, per cmd:
        runGateCommand(gate, cmd, projectDir, nativeEnv, containerEnv, dockerGate)  ← NEW thin adapter, ci.ts
            ├─ gate.image === undefined → runGateNative(..., nativeEnv, ...)         (UNCHANGED, full host env)
            └─ gate.image !== undefined → resolveDockerForGates(...)                 (fail-closed seam)
                                          → runInContainer({image, env: containerEnv, timeout, ...})  ← docker.ts
                                            (containerEnv = ALLOWLIST only — NO process.env; gate 2)
            returns GateRunResult { code, timedOut }   ← identical shape for both paths
```

The gate outcome-collection code in `runGates` (ci.ts:1396-1455 — `exitCode`,
`timedOut`, `timeoutReason`, `blockingFailures`, `emit`) is **unchanged**: both
execution paths hand it the same `{code, timedOut}` contract that
`runGateNative` already produces (GateRunResult, ci.ts:1148-1209). This is the
single most important structural decision — it keeps slice-2 additive and stops
the container path from forking the JSON/reason semantics.

---

## Design gate 1 — the timedOut-in-container mechanism (THE crux)

### Decision: HOST-SIDE `docker stop` kill, driven by a host wall-clock timer. Remove the in-container `timeout` wrapper entirely.

`runInContainer` today runs `… <image> timeout <N> bash -c <cmd>` (docker.ts:317-321)
and returns only `exitCode` (docker.ts:341-342). GNU `timeout` exits **124** on
fire — and a command that itself exits 124 is byte-identical at the exit-code
layer. This is exactly the R3-004 ambiguity that `runGateNative` already solved
NOT by keying on 124 but with a host-side `timedOut` boolean set by the kill
timer BEFORE the signal lands (ci.ts:1163-1176, invariant at :1180-1189).

**No exit-code-layer scheme inside the container can disambiguate**, because
`timeout(1)` returns 124 for both "I fired" and "the child exited 124", and the
host reads only the aggregate exit code (stdout/stderr are `stdio:inherit` under
`stream:true`, docker.ts:326 — a stderr sentinel is unreadable on the streaming
path). The only authority that KNOWS it was a timeout is the host wall-clock.

So we mirror `runGateNative` exactly, one level up (at the `docker run` process
instead of the `bash` process):

```
docker run --rm --name <cid> [--stop-timeout 30] --entrypoint "" \
  [--user uid:gid] --mount … [-e CI=true] [-e K=V …] <image> \
  bash -c <cmd>          ← NO in-container `timeout` anymore
```

- Generate a unique container name once per call:
  `const cid = "javi-forge-ci-" + crypto.randomBytes(6).toString("hex")` and pass `--name <cid>`.
- If `timeout` is defined, arm a host timer (same structure as ci.ts:1163-1176):

```ts
if (timeout !== undefined) {
  killTimer = setTimeout(() => {
    timedOut = true;                                  // set BEFORE the kill — authoritative
    // Kill the CONTAINER, never the docker CLIENT first (see hazard below).
    // `docker stop -t <graceSec>` = SIGTERM, then SIGKILL after grace.
    spawn("docker", ["stop", "-t", String(GRACE_SEC), cid], { stdio: "ignore" });
    // LAST-RESORT backstop: if `docker stop` itself hangs (wedged daemon, failed
    // stop) the docker-run client would never `close` and the gate would hang
    // FOREVER. After the grace window elapses without a `close`, SIGKILL the
    // docker-run CLIENT so the promise ALWAYS resolves (mirrors runGateNative's
    // graceTimer→SIGKILL, ci.ts:1172-1175). `--rm` + `--name <cid>` bound any
    // orphaned container; fail-slow becomes fail-bounded.
    backstopTimer = setTimeout(() => {
      proc.kill("SIGKILL");                            // client, not container
    }, (GRACE_SEC + 1) * 1000);
  }, timeout * 1000);
}
```

- On `close`, resolve `{ exitCode: code ?? 1, stdout, stderr, timedOut }`.
  `timedOut` is the host flag, never inferred from the exit code. Clear ALL
  timers — `killTimer` AND `backstopTimer` — on `close`/`error` (mirror
  ci.ts:1159-1162) so no handle leaks.

### Hazard handled: "docker stop hangs → gate never resolves"

Delegating the kill to `docker stop` (rather than `proc.kill` on the client) is
correct for orphan-avoidance, but on its own it is strictly LESS reliable than
`runGateNative`, which SIGKILLs its own child directly and cannot be starved by a
third process. If the Docker daemon is wedged or `docker stop` fails, the
docker-run client never receives its `close` and the gate hangs indefinitely. The
`backstopTimer` above closes that gap: after the `docker stop -t <grace>` window
elapses without a `close`, we escalate to `proc.kill("SIGKILL")` on the docker-run
CLIENT. Because the container is `--rm` and `--name <cid>`, any container the
daemon later reaps (or that we tried to stop) is bounded — we trade a possible
transient orphan for a GUARANTEE that the gate promise resolves. Fail-slow →
fail-bounded, matching the native path's liveness.

### The invariant that MUST hold

A timed-out containerized BLOCKING gate is **non-zero AND `timedOut===true` AND
carries the reason**, distinguishable from a genuine 124:

- Host timer fired → `timedOut===true`. The gate adapter (gate 3) normalizes the
  code to `GATE_TIMEOUT_EXIT_CODE` (124, ci.ts:1220) so the collector's existing
  `timeoutReason` branch (ci.ts:1429-1431) fires and the JSON carries
  `reason: "timed out after Ns"`.
- A command that genuinely exits 124 → host timer NEVER fired → `timedOut===false`
  → `reason` stays undefined. **Deterministic disambiguation**, identical
  guarantee to the native path.

### Hazard handled: "docker client kill leaves container running"

The exploration flags that host-side killing reintroduces the hazard the
in-container `timeout` avoided. We DEFEAT it by killing the container by name
(`docker stop -t <grace> <cid>`), **not** by `proc.kill()` on the spawned docker
client. `--rm` + daemon-side stop tears the container down cleanly and the client
exits on its own. In the NORMAL path we do not SIGKILL the client. The
`backstopTimer` (above) SIGKILLs the client ONLY as a last resort if `docker stop`
itself never completes (wedged daemon) — that guarantees the promise resolves at
the cost of a possible lingering container in that already-degraded case, which
`--rm` + the unique `--name <cid>` keep bounded and identifiable. So orphans are
not "never" — they are a bounded worst-case of the wedged-daemon path only.
Verified mechanism: `docker stop` sends SIGTERM to the container's PID 1, then
SIGKILL after `-t` seconds — the exact SIGTERM→SIGKILL escalation `runGateNative`
does at ci.ts:1172-1175.

### Rejected alternatives (with evidence)

- **(b) `timeout -s KILL` → 137**: collides with a genuine SIGKILL (137). Rejected.
- **(c) in-container `timeout …; ec=$?; emit sentinel`**: sentinel goes to
  stdout/stderr which are `inherit` on the streaming path (docker.ts:326) —
  unreadable. Rejected.
- **(d) `timeout -k <grace> <N>` + treat "124 OR 137" as timedOut**: fragile —
  124 collides with a real 124, 137 collides with a real SIGKILL. The exit-code
  layer fundamentally cannot know. Rejected.
- **(a) `timeout --preserve-status --signal=TERM …`**: still ambiguous at the
  exit-code layer; the host still only sees a number. Rejected.

### Why unify (not a gate-only branch)

`runInContainer` is called by exactly TWO paths: `runStep` (runner, ci.ts:1026)
and the new gate path. `runStep` ALWAYS passes a concrete `timeout` number
(RunnerExecContext.timeout ← `runCI` default 600, ci.ts:503,784) so removing the
in-container wrapper and using the host timer is **outcome-equivalent** for
runners: still bounded, still non-zero on timeout, `runStep` still throws on
non-zero (ci.ts:1034). A gate-only branch inside `runInContainer` would fork the
kill logic and duplicate the timer — rejected in favor of one proven mechanism.

### Known behavior: the timeout budget includes image pull + container startup

The host wall-clock timer is armed at `spawn("docker", ["run", …])`, so the
`gate.timeout` budget covers TOTAL wall-clock: image pull + container create +
startup + the command. This differs from the native path, where the timer covers
command time ONLY (the binary is already on disk). A cold, digest-pinned pull of a
large image can therefore consume — or entirely exhaust — the budget before the
gate command even starts, surfacing as a spurious `timed out` on a command that
never ran. The "outcome-equivalent to native" claim (see "Why unify" below) holds
for the KILL semantics and the `timedOut` disambiguation, but NOT for the timing
baseline: a container gate's clock starts earlier than a native gate's.

**Mitigation (document, do not over-engineer in v1):** advise authors to pre-pull
image-gate images (warm the daemon cache before the run) and/or to set generous
`gate.timeout` values that budget for a cold pull. We deliberately do NOT split
the timer into a pull phase and a run phase in v1 — that adds parsing of docker
progress/state for marginal benefit; a documented, generous-timeout guidance is
the right cost/complexity trade for the first cut.

### Test-contract note (expected churn, not a regression)

docker.test.ts:370-371 and :438 assert the argv contains `timeout`/`600`/`120`.
Removing the in-container wrapper changes the argv: those assertions become
"argv does NOT contain `timeout`" + new host-timer/`docker stop -t <cid>`
assertions. This is a deliberate contract change, flagged for slice 2.

---

## Design gate 2 — env plumbing

Extend `DockerRunOptions` (docker.ts:12-29) additively:

```ts
export interface DockerRunOptions {
  projectDir: string;
  image: string;
  command: string;
  timeout?: number;          // was `timeout?: number` w/ `= 600` default — default REMOVED (gate 7)
  stream?: boolean;
  user?: string;
  /** Extra env vars, one `-e KEY=VALUE` argv element each. Never shell-spliced. */
  env?: Record<string, string>;
}
```

Construction inside `runInContainer` (replaces the hardcoded `-e CI=true` block
at docker.ts:314-315):

```ts
const envArgs: string[] = ["-e", "CI=true"];
for (const [k, v] of Object.entries(env ?? {})) {
  envArgs.push("-e", `${k}=${v}`);   // ONE argv pair per entry
}
```

- `CI=true` is emitted first; a caller-supplied `CI` in `env` appends later and
  Docker's last-`-e`-wins makes it override — matching the gate baseEnv which
  already carries `CI:"true"` (ci.ts:1314-1317).
- Because these are **argv elements** passed to `spawn("docker", …)` (no shell),
  a value containing spaces, `=`, or newlines survives verbatim: `${k}=${v}` is a
  single arg; Docker splits only on the FIRST `=`, so `FOO=a=b\nc` sets `FOO` to
  `a=b\nc` intact. This is the same argv-safety `runGateNative` relies on by
  handing the env map straight to `spawn` (ci.ts:1155, :1145-1146 comment).
- `runStep` passes no `env` → `env` is `undefined` → only `-e CI=true` as today.
  Additive.

### CRITICAL: native and container env constructions MUST be SPLIT (no `process.env` into the container argv)

The native and container paths do NOT share one env map. The native path (`runGateNative`)
hands a `{...process.env, ...injected, ...gate.env}` map straight to `spawn`'s env option —
that is fine: it is a spawn env MAP (never argv), and the child would inherit the host env
anyway. The CONTAINER path is different on two counts:

1. **Argv exposure (host `ps aux`).** Every `env` entry becomes a `-e KEY=VALUE` argv element
   on the `docker run` command line. Forwarding `process.env` there would splatter every host
   secret (`SSH_AUTH_SOCK`, `AWS_*`, registry tokens, `GITHUB_TOKEN`, …) into the host process
   table, readable by any local process. The native path keeps env OUT of argv; the container
   path MUST NOT be the outlier.
2. **Isolation defeat.** Injecting the whole host env into a repo-author-pinned, possibly
   third-party image defeats the isolation that is the entire POINT of containerizing a gate.

The existing runner container path forwards ONLY `-e CI=true` (docker.ts:314-315). The gate
container path MUST match that posture: forward an **EXPLICIT ALLOWLIST**, never `process.env`.

So the env passed to `runInContainer` for a container gate is built SEPARATELY from the native
gate's env, and contains ONLY:

- `CI: "true"` (always),
- `JAVI_FORGE_CHANGED_FILES` — ONLY when `scope: changed` and the value is present (ci.ts:1385),
- `JAVI_FORGE_BASELINE` — ONLY when a baseline is set (ci.ts:1389),
- every declared `gate.env` entry (last-wins, ci.ts:1391-1394).

Concretely, split the construction at the gate-execution seam (gate 3):

```ts
// injected = only the JAVI_FORGE_* pairs that actually apply this phase
const injected: Record<string, string> = {};
if (changedFiles !== undefined) injected.JAVI_FORGE_CHANGED_FILES = changedFiles;
if (baseline !== undefined) injected.JAVI_FORGE_BASELINE = baseline;

// NATIVE: full host env is fine (spawn env MAP, not argv; child inherits host env anyway).
const nativeEnv = { ...process.env, CI: "true", ...injected, ...(gate.env ?? {}) };

// CONTAINER: EXPLICIT ALLOWLIST ONLY — never process.env.
const containerEnv = { CI: "true", ...injected, ...(gate.env ?? {}) };
```

`runGateNative` receives `nativeEnv`; `runInContainer` receives `containerEnv`. The ambient
host `process.env` NEVER crosses into the container argv. A host secret sitting in
`process.env` is therefore NOT visible to the gate container nor to `ps aux`.

---

## Design gate 3 — routing in runGates + the adapter

Add a thin adapter that both keeps the branch out of the `runGates` loop body
(containing the 400-line slice-2 risk) and normalizes the container result to the
EXACT `GateRunResult` shape the collector already consumes:

```ts
async function runGateCommand(
  gate: CIGateConfig,
  cmd: string,
  projectDir: string,
  nativeEnv: Record<string, string>,     // {...process.env, CI, ...injected, ...gate.env}
  containerEnv: Record<string, string>,  // {CI, ...injected, ...gate.env}  — NO process.env
  docker: DockerGateContext,
): Promise<GateRunResult> {
  if (gate.image === undefined) {
    return runGateNative(cmd, projectDir, nativeEnv, gate.timeout);   // UNCHANGED path (full env)
  }
  // image gate → runInContainer; gate CWD = mount root (native gates run at repo root).
  // containerEnv is the EXPLICIT ALLOWLIST (gate 2) — process.env is NEVER forwarded here.
  const result = await runInContainer({
    projectDir,
    image: gate.image,
    command: `cd /home/runner/work && ${cmd}`,
    timeout: gate.timeout,      // undefined ⇒ unbounded (gate 7)
    env: containerEnv,
    stream: true,
  });
  // Enforce the native invariant in ONE place: timedOut ⇒ code 124.
  // docker.ts stays gate-agnostic (returns the raw docker exit code + timedOut);
  // the gate-semantic normalization lives here, next to runGateNative's own 124.
  return {
    code: result.timedOut ? GATE_TIMEOUT_EXIT_CODE : result.exitCode,
    timedOut: result.timedOut,
  };
}
```

The loop at ci.ts:1400-1413 changes only its call target:
`runGateNative(cmd, projectDir, gateEnv, gate.timeout)` → `runGateCommand(gate,
cmd, projectDir, nativeEnv, containerEnv, docker)`, where `nativeEnv`/`containerEnv`
are the split maps from gate 2. Everything downstream — `exitCode`,
`timedOut`, fail-fast `break`, `spawnError`, `timeoutReason` (ci.ts:1429),
`blockingFailures`, `emit(...)` — is untouched. The JSON reason and outcome are
byte-identical whether the gate ran native or containerized.

**Why normalize in ci.ts, not docker.ts**: `GATE_TIMEOUT_EXIT_CODE` is a gate
concept (ci.ts:1220). `docker.ts` must not import gate semantics; it returns the
observed docker exit code (137 after SIGKILL, etc.) plus the authoritative
`timedOut` flag. `runStep` reads that raw `exitCode` and throws on non-zero
(ci.ts:1034) — it neither needs nor sees the 124 normalization.

---

## Design gate 4 — fail-closed threading (two seams)

`runGates` gains a context param; both call sites pass it:

```ts
interface DockerGateContext {
  noDocker: boolean;
  /** Run-scoped memoized `isDockerAvailable`; called at most ONCE, lazily. */
  isAvailable: () => Promise<boolean>;
}

async function runGates(
  gates: readonly CIGateConfig[],
  projectDir: string,
  onStep: CIStepCallback,
  docker: DockerGateContext,   // NEW — MUST precede the optional param
  onOutcome?: (o: GateOutcome) => void,
): Promise<void> { … }
```

**Parameter order matters (TS).** `docker` is REQUIRED, `onOutcome` is OPTIONAL. A required
parameter cannot follow an optional one ("A required parameter cannot follow an optional
parameter" — TS1016), so `docker` MUST come BEFORE `onOutcome?`. Both call sites pass
`onOutcome` positionally, so they update to the new order (see below). (If a future param
churn makes positional ordering awkward, bundle `docker`+`onOutcome` into a single options
object — not needed in v1.)

### Run-scoped memoization (avoids a double `docker info`)

In `runCI`, create the cache once and REUSE the prologue check result:

```ts
let dockerAvailableCache: boolean | undefined;
const dockerAvailable = async () =>
  (dockerAvailableCache ??= await isDockerAvailable());
```

At the existing prologue check (ci.ts:603-617, the full/quick path) assign the
result back: `dockerAvailableCache = dockerOk;` so `runGates` at ci.ts:760 never
re-runs `docker info`. The **gates-only** path (ci.ts:535) — which never calls
`isDockerAvailable` today — gets the check lazily, and ONLY if an image-gate
actually exists (see below), so an image-less gates-only repo behaves exactly as
today.

### Both call sites

- ci.ts:535 (gates-only, zero runners):
  `await runGates(resolved.gates, projectDir, onStep, { noDocker, isAvailable: dockerAvailable }, onGateOutcome);`
- ci.ts:760 (full/quick):
  `await runGates(resolved.gates, projectDir, onStep, { noDocker, isAvailable: dockerAvailable }, onGateOutcome);`

### The refuse behavior (inside runGates, when `gate.image !== undefined`)

Resolve availability lazily and memoize per phase (mirror the `changedScope`
lazy pattern at ci.ts:1319-1347 so image-less gate sets never touch Docker):

```ts
if (gate.image !== undefined) {
  if (docker.noDocker || !(await docker.isAvailable())) {
    const why = docker.noDocker ? "--no-docker set" : "Docker not available";
    const reason = `gate "${gate.id}" requires image "${gate.image}" but ${why} — refusing (never runs native/unpinned)`;
    if (blocking) {
      blockingFailures.push(gate.id);
      report(onStep, stepId, `${label} failed`, "error", reason);
      emit("error", { reason });
    } else {
      report(onStep, stepId, `${label} failed (informative)`, "warning", reason);
      emit("warning", { reason });
    }
    continue;   // NEVER falls through to native execution
  }
}
```

- An image-gate that cannot run its image is a **FAILURE, not a skip**: blocking →
  `error` + goes into `blockingFailures` so the aggregate throw at ci.ts:1458-1460
  still fires (exit 1). Informative → `warning` (the informative-never-blocks
  contract is preserved), but STILL refuses — it never silently runs native/unpinned.
- A gate **without** `image` runs `runGateNative` regardless of `noDocker`
  (user-locked: no-image → native always). `--no-docker` never blocks native gates.

The refuse check sits BEFORE the `gate.run` loop, so no command executes when we refuse.

---

## Design gate 5 — additivity to the runStep caller

`DockerRunResult` gains one field:

```ts
export interface DockerRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;   // NEW
}
```

The `runStep` Docker caller (ci.ts:1026-1036) reads only `result.exitCode` and
throws on non-zero. A new field is inert to it. The host-timer rewrite is also
inert to `runStep`'s observable behavior: `runStep` always passes a concrete
`timeout`, so a runner command that overruns is still killed and still surfaces a
non-zero exit → still throws `Command failed with exit code N`. No `runStep`
change required.

Test note: the `runInContainer` mock at ci.test.ts:56 returns
`{exitCode,stdout,stderr}`; making `timedOut` required means the mock (and the
docker.test.ts result assertions) add `timedOut`. If we want zero test churn on
existing mocks we could type it `timedOut?: boolean`, but a REQUIRED boolean is
chosen for invariant strength (a result can never omit the timeout signal) — the
mock update is one line and belongs in slice 2.

---

## Design gate 6 — schema

Three edits in `ci-config.ts`, mirroring the runner `image` validation
(ci-config.ts:252-262):

1. `CIGateConfig` (ci-config.ts:68-87) gains `image?: string`.
2. `GATE_FIELDS` (ci-config.ts:316-324) gains `"image"`.
3. `validateGate` (ci-config.ts:326-455) adds, next to `baseline`/`env`:

```ts
let image: string | undefined;
if (raw.image !== undefined) {
  if (typeof raw.image !== "string" || !raw.image.trim()) {
    errors.push({ path: `${base}.image`, message: "image must be a non-empty string" });
  } else if (raw.image.trim().startsWith("-")) {
    // Harden against docker-flag injection: an image ref like "--privileged" or
    // "-v /:/host" would be parsed by `docker run` as a FLAG, not an image, if it
    // reaches argv. Reject leading-dash refs at validation (named error).
    errors.push({ path: `${base}.image`, message: "image must not start with '-' (would be parsed as a docker flag)" });
  } else {
    image = raw.image;
  }
}
```

and returns `image` in the object literal (ci-config.ts:446-454).

- **Why the leading-`-` guard.** `validateGate`'s non-empty check alone would admit
  `image: "--privileged"` or `image: "-v /:/host"`, which `docker run` parses as a
  run FLAG rather than an image argument. The blast radius is bounded by existing
  trust (a `ci.yaml` author already has host exec via native `gate.run`), but the
  guard is cheap and removes a footgun. We prefer this simple validation over an
  argv `--` end-of-options marker: the guard fails LOUD at config-parse time with a
  clear message, rather than relying on docker's `--` support at spawn time.

- **No mutual-exclusion** needed: gates have no `build-context` field (out of
  scope), so there is nothing to be mutually exclusive with. The runner
  image/build-context guard (ci-config.ts:279-284) does NOT apply.
- version:2 additive; version:1 parses byte-identically (image absent → native).

---

## Design gate 7 — the unbounded decision

Remove the `timeout = 600` default in `runInContainer`'s destructuring
(docker.ts:274). `timeout` becomes truly optional:

- `timeout` defined → arm the host timer (gate 1).
- `timeout` undefined → **no timer armed → unbounded**, exactly like a native gate
  with no `timeout` (runGateNative arms no timer when `timeoutSec === undefined`,
  ci.ts:1163).

A no-timeout containerized gate passes `gate.timeout === undefined` through the
adapter (gate 3) → `runInContainer` arms no timer → runs unbounded. This closes
the exploration's divergence hazard (the old `= 600` silently capped no-timeout
containerized gates at 600s, a cap the native path never had).

Safe because the ONLY other caller, `runStep`, always passes a concrete number
(verified: RunnerExecContext.timeout ← runCI `timeout = 600`, ci.ts:503,784) — it
never relied on the destructuring default. `openShell` has no timeout at all
(separate function). Grep of every `runInContainer` call confirms two callers.

---

## Design gate 8 — portability

The container command is `bash -c <cmd>`. Removing the in-container `timeout`
wrapper (gate 1) **shrinks** the image contract: it no longer needs GNU
`coreutils` `timeout` — only `bash`. distroless (no shell) and busybox-`sh`-only
images still can't run gates, but the surface is smaller than before.

**Decision: DOCUMENT, do not pre-flight probe.** A bash-less image makes
`docker run … bash -c …` fail with a non-zero exit, which the fail-closed
collector already turns into a LOUD blocking `error` (never a false-green). A
pre-flight `bash --version` probe would cost an extra `docker run` per gate for
no safety gain over the natural, already-loud failure. The `gate.image`
requirement ("must ship `bash`") is documented in the schema/docs; detection is
the natural failure path, consistent with the existing fail-closed posture.

---

## Slices (delivery: ask-on-risk)

### Slice 1 — schema (LOW, additive ~30 lines)
`ci-config.ts`: `image?` on `CIGateConfig`, `GATE_FIELDS`, `validateGate` + tests.
Independent, no runtime coupling.

### Slice 2 — execution routing + docker contract (HIGH — the 400-line risk)
`docker.ts`: `DockerRunOptions.env`, `DockerRunResult.timedOut`, host-timer +
`docker stop` rewrite, remove `= 600` default. `ci.ts`: `runGateCommand` adapter,
route image-gates, keep the collector untouched. Tests: docker.test.ts argv
contract churn (timeout removed, `--name`/host-timer added), new `timedOut`
tests, ci.test.ts routing.
**400-line containment**: (a) the `GateRunResult` shape is the seam — the
collector body never changes; (b) the adapter isolates the branch out of the loop;
(c) land the docker.ts contract change (env + timedOut + host-kill) with its own
tests FIRST, then the ci.ts routing — two reviewable steps, not one blob.
This slice touches the `runStep` contract only through additive fields (gate 5).

### Slice 3 — fail-closed + timeout disambiguation (MED)
`ci.ts`: `DockerGateContext` param on `runGates`, thread into BOTH call sites
(:535, :760), run-scoped memoized `dockerAvailable` reusing the prologue result,
the refuse branch (blocking→error+throw, informative→warning, never native),
unbounded-when-no-timeout assertion. Tests: refuse under `--no-docker`, refuse
under Docker-down, timed-out container gate carries `reason` and is distinct from
a genuine 124, no-timeout gate runs unbounded.

---

## Non-goals (explicit)

- `gate.build-context` — gates have no stack for `ensureImage` (docker.ts:38);
  deferred. No mutual-exclusion machinery added.
- Whole-run pinning / forcing the entire `ci` run into one image — devcontainer
  direction, a separate future change.
- devcontainer support.
- Repo-default image inheritance — no runner for a gate to inherit from.
- Pre-flight image capability probing (bash/coreutils detection) — natural
  fail-closed failure covers it (gate 8).

## Rollback

Purely additive under version:2. version:1 configs parse byte-identically; gates
without `image` behave exactly as today (native, unbounded when no timeout).
Revert = drop the schema field + the `runGateCommand` container branch + the
docker.ts additive fields. No persisted state, no consumer migration. The one
non-additive edge is the docker.ts argv-contract test churn (in-container
`timeout` removed) — reverting restores the old argv and its assertions.
