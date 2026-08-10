# Exploration: containerized-gates — OPTIONAL `gate.image` execution in `.javi-forge/ci.yaml`

Verified against `main` @ dd56382 on 2026-08-09. All line numbers CURRENT. This is the deferred follow-up EXPLICITLY named in the archived gates-v2 design (`openspec/changes/archive/2026-08-09-gates-v2/design.md:13-14`, `:170`): *"gates run in Docker is an explicit FOLLOW-UP, deferred because it needs gate-image resolution (a gate has no runner to inherit an image from)."* Scope: **step 1 only** (devcontainer is a separate future change).

## Reframe (engram `sdd/gate-reproducibility/framing`)
GATE-1 is reproducibility/DISCIPLINE, not "exotic toolchain". A host-native gate passes-by-default 3 ways that aren't exit-0: tool not installed → `--no-verify` bypass; wrong version → measures something else; Docker down → runs unpinned silently. Biogas M8 (pin everything) applied to gate execution. The fail-closed policy ("gate requires its image; Docker unavailable → REFUSE, never run unpinned") must be **born in this change**.

## 1. How gates execute today (host-native only)

- **`runGateNative`** — `src/commands/ci.ts:1148-1209`. `spawn("bash",["-c",cmd],{cwd,env,stdio:"inherit"})` (:1155). Returns `{code,timedOut}` (`GateRunResult`, :1111-1114). Timeout is **host-side**: `killTimer` at `timeoutSec*1000` → `SIGTERM` then `graceTimer` → `SIGKILL` after `GATE_TIMEOUT_GRACE_MS=2000` (:1163-1176). Invariant `timedOut ⇒ 124` (:1180-1189). Signal-death → `128+signum` (:1198-1202) — never false-green.
- **`runGates`** — `src/commands/ci.ts:1305-1461`. `baseEnv = {...filterDefinedEnv(process.env), CI:"true"}` (:1314-1317). Injects `$JAVI_FORGE_CHANGED_FILES` (:1385), `$JAVI_FORGE_BASELINE` (:1389); `gate.env` last-wins (:1391-1393). Multi-command fail-fast (:1400-1413). Aggregate blocking throw after the loop (:1458-1460). cwd = `projectDir` (:1404-1409).
- **TWO call sites** of `runGates`: **ci.ts:535** (gates-only zero-runner v2, before any docker-check via early return :536) and **ci.ts:760** (full/quick, after runners). Both must grow the fail-closed seam.

## 2. Existing Docker machinery to reuse

- **`runInContainer`** — `src/lib/docker.ts:267-346`: `docker run --rm [-it] --stop-timeout 30 --entrypoint "" [--user uid:gid] --mount type=bind,source=<projectDir>,target=/home/runner/work -e CI=true <image> timeout <N> bash -c <command>`. Returns `DockerRunResult = {exitCode,stdout,stderr}` (:31-35, :341-343) — **carries the exit code** (the "returns void" note referred to `runStep`'s Docker branch, NOT `runInContainer`).
- **ENV-1 already satisfied**: `--user ${uid}:${gid}` (:294-311) → gate artifacts host-owned, no uid-1001 war. Confirmed.
- **env injection NOT supported**: only `-e CI=true` hardcoded (:314-315); `DockerRunOptions` has NO `env` field. The gates-v2 slice-4 `DockerRunOptions.env` plumbing was DROPPED (v1 gates were native). **Must be added here.**
- Image resolution today: runners resolve via explicit `image` verbatim passthrough (digest pins intact — `ci.ts:858-866`), `buildContext` → `ensureImage({stack,buildContext,imageTag})` (:846-857), or default. `ensureImage` (docker.ts:163-256) requires a `stack` (:38) a gate lacks.
- `runStep` Docker branch (`ci.ts:1010-1037`) calls `runInContainer` and **throws on non-zero, discarding the code** (:1034-1035). Extending `DockerRunResult` must stay additive.

## 3. The `gate.image` resolution question

A repo-level gate has NO runner to inherit from. Options:
- **(a) plain image ref (digest-pinnable)** — reuse the runner verbatim passthrough. Smallest slice; a digest pin IS the reproducibility win. **Recommended lean.**
- **(b) build-context** — needs `ensureImage` which requires a `stack` a gate lacks; forces a synthetic stack/imageTag. More plumbing, marginal benefit.
- **(c) inherit a repo default** — no runner to inherit from; out of scope for step 1.

Schema extends cleanly: `CIGateConfig` (`ci-config.ts:68-87`) gains `image?`; add `"image"` to `GATE_FIELDS` (:316-324); `validateGate` (:326-455) mirrors the runner image/build-context validation (:252-284) including mutual-exclusion (:279-284). Stays `version: 2` additive.

## 4. env + changed-files + timeout contract INSIDE a container

- **env**: `runInContainer` must accept `env?` and emit repeated `-e KEY=VALUE` argv pairs (NOT shell-spliced). `$JAVI_FORGE_CHANGED_FILES` newline-joined survives as a single argv value.
- **changed-files paths**: mount lands at `/home/runner/work` = projectDir (the WORKDIR); root-relative paths resolve.
- **TIMEOUT — the load-bearing hazard (resolved differently than feared)**:
  - The feared "host SIGKILL kills the docker CLIENT not the container" **does NOT apply**: `runInContainer` has NO host-side kill timer — the only timeout is the **in-container `timeout <N>` wrapper** (:317), whose kill reaches the process INSIDE the container. Correct place.
  - **BUT `runInContainer` returns only `exitCode`, no `timedOut`.** In-container `timeout` returns 124 — indistinguishable from a command that itself exits 124 (the exact R3-004 ambiguity). The gate `{code,timedOut}` contract CANNOT be satisfied by `runInContainer` as-is. Fix: extend `DockerRunResult` with `timedOut`, set deterministically (in-container `timeout --signal` + distinct sentinel, or `-k` + inspect 124-vs-137), NOT by keying on raw 124.
  - **Silent 600s cap**: `timeout` default is `600`, ALWAYS applied (:274,:317). A containerized gate with NO declared `timeout` silently gains a 600s cap the native path never had (native no-timeout = unbounded). Must decide.
  - **Portability**: hardcoded `timeout`+`bash -c` break on alpine (busybox `timeout`, no bash) / distroless. gate.image images MUST ship bash+coreutils, or the wrapper degrades.

## 5. Fail-closed policy seams

- Docker availability: `isDockerAvailable()` = `docker info` (docker.ts:139-146), called ONLY at `ci.ts:606` inside `if (!noDocker)` (runner path). The **gates-only path (:535) never runs it**.
- `runGates` receives NEITHER `noDocker` NOR a docker-availability signal. The fail-closed seam is a NEW parameter threaded into BOTH call sites (:535, :760).
- Decision matrix (product call — see below):
  - gate WITHOUT image, `--no-docker` → native (fine, unchanged).
  - gate WITHOUT image, Docker up → native (unchanged).
  - gate WITH image, `--no-docker` → **REFUSE** (semantic conflict: `--no-docker` means "run native", an image-gate can't). Refuse loudly, never silently native.
  - gate WITH image, Docker down → **REFUSE**, never degrade to native.

## 6. ENV-1 composition — confirmed
`runInContainer` already runs `--user ${uid}:${gid}` (:294-311). Gates inherit host-owned artifacts. No new work; don't pass a `user` override.

## 7. Blast radius + slicing

- **Slice 1 — schema** (`ci-config.ts` + tests): `image` (+ maybe build-context) on `CIGateConfig`/`GATE_FIELDS`/`validateGate` with mutual exclusion. Additive, LOW, ~50-70L.
- **Slice 2 — execution routing** (`docker.ts` + `ci.ts` runGates + tests): extend `DockerRunOptions.env`, `DockerRunResult.timedOut` (additive); thread `-e` pairs; route an image-gate through `runInContainer`, adapt `{code,timedOut}`. **400-line risk HIGH** — touches the `runStep` caller contract. Keep additive.
- **Slice 3 — fail-closed + timeout-in-container** (`ci.ts` both `runGates` sites + tests): thread `noDocker`+`dockerOk`, enforce refuse-on-image-without-Docker, resolve the 124→`timedOut` disambiguation + the default-600 cap. ~60-100L.

## SURFACE FOR THE USER (propose-phase product calls)
- **(a)** `gate.image` = plain digest-pinnable ref vs build-context vs both. (lean: plain-ref first)
- **(b)** fail-closed shape: refuse ALWAYS without Docker, or ONLY when a gate declares an image.
- **(c)** a gate WITHOUT image under `--no-docker`: run native or refuse.
- **(d)** timeout-inside-container mechanism + the default-600 cap for a no-timeout containerized gate.
- **(e)** does this SDD ALSO let the whole `ci` run be forced into a pinned image, or strictly per-gate.

## Risks
1. **Timeout disambiguation (HIGH)** — extend `DockerRunResult.timedOut`, not key on 124.
2. **Silent 600s cap** — a no-timeout containerized gate gains a cap the native path lacks.
3. **Arbitrary-image portability** — hardcoded bash+timeout break on alpine/distroless.
4. **Two fail-closed seams** — `runGates` at :535 AND :760; gates-only path never calls `isDockerAvailable`.
5. **Slice 2 400-line risk** — extending both docker.ts contracts ripples into the `runStep` caller.
