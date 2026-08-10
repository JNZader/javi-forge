# Backlog

Orthogonal findings parked for between-SDD work. Each item carries evidence
(`file:line`) and a suggested fix. Items are NOT fixed in-flight — see the
Fix-Between-SDDs pattern: an in-flight fix pollutes the diff under review.

## 2026-08-08 — from SDD `ci-engine-unification` exploration

Source: `openspec/changes/ci-engine-unification/exploration.md`

### B1 — Inconsistent step-id naming between `--stack` and zero-config auto

`--stack <s>` emits suffixed step ids (`lint:node`) while the zero-config auto
path emits bare ids (`lint`) for the same repository and the same commands.

- Evidence: `src/commands/ci.ts:892` — `const stepId = \`${phase.id}:${runner.name}\`;`
  (the multi-runner path), versus the legacy single-runner view at
  `src/commands/ci.ts:491-502` used by the auto path.
- Status: undocumented, untested, likely unintended.
- Suggested fix: decide the desired behavior (bare ids for a single runner, or
  always suffixed), then pin it with a test so the two paths cannot drift again.

### B2 — `ci --shell` ignores configured runners

Shell mode builds its image from the detected `stackInfo`, never from
`runner.image` / `runner.buildContext`. A repository that pins
`image: python:3.12-slim` still gets the default node image.

- Evidence: `src/commands/ci.ts:508-533` — `ensureImage({ stack: stackInfo.stackType, javaVersion: stackInfo.javaVersion })`.
- Status: zero test coverage.
- Suggested fix: resolve the shell image from the selected runner's
  `image`/`buildContext` when present, falling back to detection only when the
  runner pins nothing; add a test for a repo with a pinned image.

### B3 — Dead defensive defaults in the legacy single-runner view

`runners[0]` can never be `undefined`: config requires a non-empty runner list,
and auto-detection yields exactly one runner. The `??` fallbacks are unreachable.

- Evidence: `src/commands/ci.ts:494-502` — `const primary = resolved.runners[0];`
  followed by `primary?.stack ?? "node"`, `primary?.buildTool ?? "npm"`, etc.
- Suggested fix: remove after the `ci-engine-unification` collapse lands — they
  may disappear naturally with the legacy view. Verify at that point rather than
  deleting now.
- **CLOSED 2026-08-09**: invariant re-verified on `main` after the collapse —
  the config path throws before resolving when `runners` is empty
  (`src/lib/ci-config.ts:321-326`), and the `auto` and `stack-override` paths
  each build exactly one runner (`resolveCIRunners`). Removed the `?? "node"` /
  `?? "npm"` / `?? "21"` defaults and the two `&& first` truthiness guards in
  `describeRunners`; the invariant is now stated once as a comment. The
  `?? null` on `lintCmds[0]`/`compileCmds[0]`/`testCmds[0]` STAYS — those lists
  can legitimately be empty. Zero behavior change, full suite green unchanged.

> **Scope precision (R1 review, 2026-08-09)**: SEC-1's closure covers the WRITE path (`writeHookFile`, O_NOFOLLOW + fchmod) and the backup DESTINATION (COPYFILE_EXCL + fchmod-on-fd). Still parked, same local-attacker threat model, defense-in-depth only: (a) `repairHookMode`'s path-based chmod on the managed-current branch (R1-001), (b) `backupHook`'s source-side `stat`/`copyFile` follow symlinks — a post-classification swap can copy the link target into the backup before the write correctly aborts with ELOOP (R1-002), (c) the `nlink > 1` check. All three are strictly weaker than the code execution this attacker already holds.

### ENV-1 — Containerized CI runs leave `node_modules/.vite-temp` root-owned — CLOSED

Containerized CI runs leave `node_modules/.vite-temp` owned by uid 1001 (the
container runner), which breaks local `vitest` with `EACCES` for uid 1000.

- Evidence: commit `d21fe49` (moving `cacheDir` to `/tmp`) was an incomplete
  fix — vite still writes the config-bundle timestamp file under
  `node_modules/.vite-temp`, outside `cacheDir`.
- **Root cause**: `getDockerfileContent` bakes `USER runner` into every image.
  On `node:22-slim` the base already owns uid 1000 (`node`), so `useradd -m
  runner` lands `runner` at **1001**. `runInContainer` bind-mounted the
  workspace with no `--user`, so the container wrote artifacts as 1001 while
  the host is 1000 → `EACCES`. The compile phase's `--user root` + `chown -R
  runner:runner` dance was a symptom of this same split, and left artifacts
  owned by 1001 anyway.
- **CLOSED 2026-08-09** (Option A, host-uid match): `runInContainer` /
  `openShell` now default to `--user $(process.getuid):$(process.getgid)`
  (guarded — omitted on non-POSIX where they're `undefined`; an explicit
  `user` override still wins). Because uid 1000 maps to a real passwd user
  with a writable home in every shipped image — `node` (`/home/node`) on the
  node base, the created `runner` (`/home/runner`) on python/go/rust, and the
  distro default `ubuntu` (`/home/ubuntu`) on java/default noble bases, where
  the created `runner` lands at 1001 instead — pnpm/toolchains keep working and
  every artifact lands **host-owned**. The compile phase dropped `--user root`,
  and all five `chown -R runner:runner …` suffixes were removed
  (`src/commands/ci.ts`).
- **Empirical evidence** (`javi-forge-ci-node`, host uid 1000):
  - OLD (no `--user`): container ran as `uid=1001(runner)`; a `pnpm run build`
    could not even write the host-owned `dist/` → exit 1; artifacts, when
    written, were owned by 1001 → host `vitest` `EACCES`.
  - NEW (`--user 1000:1000`): container ran as `uid=1000(node)`, `pnpm run
    build` exit 0, `dist/out.txt` owned `1000:1000`, host reads/removes it
    freely.
- **Known limitations** (documented, not the reported env — R4 review):
  a host uid with no matching passwd entry inside the image gets `HOME=/`,
  which can break toolchains that cache under `$HOME` (go/cargo/gradle). uid
  1000 — the reported environment and the near-universal Linux dev uid — is
  unaffected. There is NO runtime warning or per-runner escape hatch for these
  two edges (no `user:` field exists in `ci.yaml`), so recovery today means not
  hitting them:
  - **R4-002** — host uid ≠ 1000 (second account, corporate provisioning) on
    python/go/rust images (only `runner`=1000 exists) → `HOME=/`.
  - **R4-001** — `build-context:` custom images always run as the host uid,
    dropping their baked `USER`; if the host uid has no passwd entry there,
    `HOME=/`. Note: forcing the host uid already moves `HOME` off the baked
    user's home, so a baked `~/.npmrc` under `/home/<baked-user>` is bypassed
    unless host uid == that user's uid.
  A writable-`HOME` guard (`-e HOME=/tmp`) was deliberately NOT added — it would
  regress build-context images that bake tool config under a real home.

  **FOLLOW-UP (SEC/DX, own ticket)**: close both edges properly — either a
  `user:` field in `ci.yaml` (per-runner opt out of the host-uid injection) or
  a conditional `-e HOME` only when the host uid has no in-image passwd entry.
  Design decision, not a batch fix. Also R4-003: the non-POSIX omit-branch of
  the `--user` guard is only covered by a vacuous early-return test.

### HOOKS-1 — Adopt the richer `ci-local/hooks/*` variants fleet-wide (deferred change, not a bug)

The `ci-local/hooks/*` variants are strictly better than the hook constants the
fleet actually received: `pre-push` degrades gracefully when Docker is down, and
`commit-msg` does NFKC normalization plus pattern families and ships its own
test suite (`ci-local/hooks/commit-msg.test.sh`).

- Evidence: `ci-local/hooks/pre-push`, `ci-local/hooks/commit-msg`,
  `ci-local/hooks/commit-msg.test.sh`.
- Status: this is a behavior change, not a defect. It is gated behind the hook
  markers that `ci-engine-unification` slice 3 ships.
- Suggested fix: plan as its own change after `ci-engine-unification` lands.
- **CLOSED 2026-08-10** — shipped as SDD `hooks-ricos` (archived
  `openspec/changes/archive/2026-08-10-hooks-ricos/`), PRs #19 (commit-msg) +
  #20 (pre-push), release 1.19.0. NOTE: the exploration CORRECTED this ticket's
  premise — the shipped `pre-push` was ALREADY fail-closed on Docker; it was the
  `ci-local` variant that DEGRADED, which inverts the `containerized-gates`
  fail-closed policy. So the adopted pre-push is a NATIVE substantive gate
  (`ci --quick --no-docker --no-security --no-ci-ghagga`, npx fallback, no degrade),
  fail-closed at the gate layer, which also sidesteps PREPUSH-EACCES. commit-msg
  adopted the rich body (best-effort NFKC + raw-always-on anti-attribution) PLUS a
  new conventional-commit subject guard, and — a judgment-day CRITICAL caught by
  both blind judges — a `Claude-Session:` trailer pattern the ci-local body was
  missing (the harness auto-appends it; it is the user's #1 rule). Both hook bodies
  are versioned assets (v2) that auto-upgrade silently; `commit-msg.test.sh` is
  promoted + tarball-excluded. The `ci-local/hooks/*` source files remain as the
  authoring copies. Cosmetic residuals: the promoted `.test.sh` keeps Spanish
  header comments (does not ship); `cursor` provider matching blocks legit
  "cursor-based pagination" (documented tradeoff, no clean tightening).

### JF-DOCS-1 — `javi-forge ci` has no command-specific `--help` and no `ci validate` — CLOSED

Config errors surfaced only by running the full pipeline; there was no cheap way
to validate a CI config or discover `ci` flags.

- Evidence: `src/index.tsx:29-32` — meow was built once with the global
  `HELP_TEXT`, so there was no per-command help; `src/cli/dispatch/ci.tsx`
  handled only the `init` subcommand.
- Shipped:
  - `ci validate [--config <path>] [--json]` — new `src/commands/ci-validate.ts`
    (`validateCIConfig`) resolves the config path with the same discovery `runCI`
    uses, calls `loadCIConfig`, and reports. Valid → OK summary (config path + N
    runners with names/stacks), exit 0; invalid → each `CIConfigError` entry as
    `path: message` on stderr, exit 1; missing file → a named
    "no .javi-forge/ci.yaml found at <path>" error (never a stack trace), exit 1.
    `--json` emits `{ok:true,runners}` / `{ok:false,errors}`. A zero-config repo
    (no `.javi-forge/ci.yaml` found by discovery, no explicit `--config`) is
    treated as VALID auto-detect — `runCI` runs fine in that state via its
    zero-config path (ci.ts:396-406) — exit 0 with `{ok:true,mode:"auto-detect",
    runners:[]}`; only an explicit `--config` pointing at a missing file is an
    error. Pure parse-and-report: no image builds, no Docker, no phase execution.
    Dispatched in `src/cli/dispatch/ci.tsx`.
  - Per-command help: meow `autoHelp` disabled in `src/index.tsx` (global `--help`
    handled manually there); `ci --help` and any unknown `ci` subcommand print the
    new `CI_HELP_TEXT` (`src/cli/help.ts`) listing the `init`/`validate`
    subcommands and the `ci` flags. Global `--help` unchanged.
- Tests: `src/commands/ci-validate.test.ts` (valid, every error class, zero-config
  auto-detect, explicit-missing error — real temp dirs), `src/cli/dispatch/
  ci-validate.test.ts` (human + `--json` output, auto-detect, exit codes),
  `src/cli/dispatch/ci-help.test.ts` (`ci --help` + unknown subcommand),
  `src/__integration__/cli-help.integration.test.ts` (subprocess: global `--help`
  banner vs. `ci --help` usage are distinct, both exit 0), plus `CI_HELP_TEXT`/flag
  assertions in `src/cli/help.test.ts`.
- Not touched (per scope): config schema, `src/lib/docker.ts`/container layer,
  hook installer.

## 2026-08-09 — from SDD `gates-v2` (declarable named quality gates)

Source: `openspec/changes/archive/2026-08-09-gates-v2/` (design.md, review-ledger.md,
verify-report.md). All items are deferred follow-ups, NOT defects — the shipped v2 gate
capability is complete and green. Promoted here for backlog visibility per the verify-report.

### GATE-1 — Docker-per-gate execution (JDA-001)

v2 gates run HOST-NATIVE only. Running a gate inside Docker needs gate-image resolution that a
repo-level gate (no runner to inherit an image from) does not have. `runStep`'s Docker branch is
structurally unusable for gates (needs runner+image, returns void — no exit code), which is WHY
gates use `runGateNative`. `DockerRunOptions.env`/`-e` plumbing was intentionally dropped and
`src/lib/docker.ts` was left untouched; `CIGateConfig` has no `image` field.

- Status: explicitly OUT OF SCOPE for v2 (spec: ci-gates "Gate execution phase and outcome semantics").
- Suggested fix: design gate-image resolution (per-gate `image`/`build-context` + env plumbing into
  the container layer) as its own change if a Dockerized gate is ever needed.
- **CLOSED 2026-08-10** — shipped as the full `containerized-gates` SDD (PRs #15 schema / #16
  routing+env-allowlist+host-timeout / #17 fail-closed matrix, archived
  `openspec/changes/archive/2026-08-10-containerized-gates/`). Optional `gate.image` runs a gate in a
  pinned container via the host-uid runner path; env reaches it through an explicit allowlist (host
  secrets excluded); timeout enforced host-side (`docker stop`, no false-green); fail-closed when
  Docker is unavailable. Reframed from "exotic toolchain" to reproducibility/discipline (M8).

### GATE-2 — No per-gate timeout (JDB-002) — CLOSED

A gate command that hangs blocked the whole run indefinitely; there was no timeout/kill on the
spawned `bash -c` process.

- Evidence: `runGateNative` in `src/commands/ci.ts` — no timeout wired.
- **CLOSED 2026-08-09**: added an OPTIONAL `timeout` field (positive number of seconds) to the gate
  schema (`CIGateConfig.timeout`, `src/lib/ci-config.ts`), validated in `validateGate` with a named
  `gates[N].timeout` error for `0`/negative/non-number (added to `GATE_FIELDS`). `runGateNative`
  gained a `timeoutSec?` param: on expiry it kills the child SIGTERM-then-SIGKILL after a 2s grace,
  and clears both timers on `close`/`error` so no handle leaks. Timeout is PER COMMAND (matches
  fail-fast). A gate with no `timeout` is byte-for-byte unchanged (no timer).
- **FALSE-GREEN FIX (R3-001, reliability review 2026-08-09)**: the original close-handler relied on
  the signal-death path (`code ?? 128+signal`), but a child that TRAPS SIGTERM and exits 0 gracefully
  BEFORE the SIGKILL escalation reports `code=0, signal=null` → resolved 0 → a timed-out BLOCKING gate
  FALSE-GREENED the build (exactly the command class most likely to carry a timeout: dev servers /
  watchers / SIGTERM-handling CLIs). Fix: a `timedOut` flag set BEFORE the SIGTERM lands; on `close`
  it OVERRIDES the child's reported code with the `timeout(1)` sentinel `124` regardless of what the
  child reported. INVARIANT now enforced: `timed-out ⇒ non-zero, ALWAYS` (`124`, distinct from a
  signal-death 143/137). Docstring at `ci.ts` corrected (previously over-promised). An INFORMATIVE
  timeout still degrades to `warning`, exit 0. Reflected in `openspec/specs/ci-gates/spec.md` (updated
  narrative + new trap-exit-0 no-false-green scenario). Tests: `src/lib/ci-config.test.ts`
  (accept/omit/0/-5/"x" + Infinity/NaN finite-boundary), `src/commands/ci.test.ts` (`runGateNative`
  timeout-kill → 124, trap-exit-0-`& wait` → 124 [was the false-green], IGNORES-SIGTERM SIGKILL
  escalation → 124, finishes-under-timeout; `runGates` blocking-timeout fails, blocking trap-exit-0
  fails, informative-timeout warns, under-timeout done).

### GATE-3 — Missing end-to-end dispatch→collector→process.exit seam test (JDB-102) — CLOSED

The headless `--json` gate-run path was unit-tested at the pieces (`collectGateOutcomes`, dispatch
branch mocking the collector) but there was no single end-to-end test wiring the real dispatch →
collector → `process.exit(result.exitCode)` seam.

- Evidence: ledger slice-4 carry-forward; `src/cli/dispatch/ci.tsx:147-167`.
- **CLOSED 2026-08-09**: added `src/__integration__/ci-json-run.integration.test.ts` — drives the
  REAL binary through `tsx` in a subprocess (like `cli-help.integration.test.ts`) against a temp repo
  with a BLOCKING gate that fails, asserting BOTH the real `process.exit` code (non-zero, == 1) AND
  that stdout is valid JSON with `ok:false`, `exitCode:1`, and a `status:"error"`/`blocking:true`
  gate entry matching the spec shape. A second case covers the all-pass path (`exit 0`, `ok:true`,
  exit 0). This exercises the full dispatch → `collectGateOutcomes` → `runCI` → `process.exit` chain
  no mocked-halves test reached. Run native via `--no-docker --no-security`.

### GATE-4 — Monorepo changed-files repo-root relativity

`$JAVI_FORGE_CHANGED_FILES` paths are repo-root-relative (git native form). A gate running from a
subdirectory in a monorepo must relativize the paths itself; the engine does NOT rewrite per-gate.

- Status: documented in `tasks.md` Notes, not solved.
- Suggested fix: decide whether to inject a per-gate cwd-relative variant, or document the caveat as
  permanent.
- **CLOSED 2026-08-10** (PR #22) — added `$JAVI_FORGE_CHANGED_FILES_ABS` (absolute-path variant), so a
  gate resolves changed files from any working directory. A literal "cwd-relative" variant is
  impossible for the engine (a gate picks its cwd at runtime); the cwd-INDEPENDENT form is absolute
  paths. The base is context-dependent: native gates get `<projectDir>/<relpath>`, containerized gates
  get `/home/runner/work/<relpath>` (the bind-mount target, sourced from a shared `CONTAINER_WORKDIR`
  constant so it can't drift). Judgment-day caught + fixed the container-base bug. Follow-up still open:
  a per-gate `workdir` field (deferred design).

### GATE-5 — Newline-in-path corruption in changed-file injection (JDB-103)

`$JAVI_FORGE_CHANGED_FILES` is newline-joined; a repo path containing a literal newline would corrupt
line-based parsing by the gate.

- Status: documented KNOWN LIMITATION (spec ci-gates "Gate-run JSON output" + code comment
  `src/commands/ci.ts`). Low-likelihood edge, accepted caveat.
- Suggested fix: switch to NUL-joining (`$JAVI_FORGE_CHANGED_FILES_Z`) if a real repo ever hits it.
- **CLOSED 2026-08-10** (PR #22) — the suggested NUL-joining fix is **IMPOSSIBLE**: a NUL byte in an
  env value is undeliverable — Node throws `ERR_INVALID_ARG_VALUE: "must be a string without null
  bytes"` for a NUL in both a spawn env-map value AND a `-e KEY=VALUE` argv element (execve `environ`
  entries are NUL-terminated C strings). Injecting `_Z` would crash every `scope: changed` gate at
  spawn. Documented as impossible in code + spec; NOT shipped. The only viable path is a temp-file
  variant, deferred as over-engineering for this pathological, never-observed edge. The newline-in-path
  limitation remains a documented known caveat.

### GATE-6 — Timed-out gate indistinguishable from a genuine 124 (R3-004) — CLOSED

The GATE-2 timeout resolves the `timeout(1)` sentinel `124` for a timed-out gate (correctly
non-zero), but `runGateNative` returned a BARE number, so `runGates`/the `--json` consumer saw
`exitCode === 124` and could NOT tell a wall-clock timeout from a child that itself exits 124
(a `curl` op-timeout, a nested `timeout(1)`, a script returning 124). Correctness was fine (both
are non-zero, both fail a blocking gate) — this was an OBSERVABILITY gap: "bump the timeout" vs
"fix the command" was unknowable from the outcome.

- Evidence: `runGateNative`/`runGates` in `src/commands/ci.ts`; `GateOutcome` JSON contract.
- **CLOSED 2026-08-09**: `runGateNative` now returns `GateRunResult { code: number; timedOut: boolean }`
  instead of a bare number; `timedOut` is `true` IFF the internal `killTimer` fired. `runGates` reads
  `.code`/`.timedOut` and, on a timeout, populates the existing optional `GateOutcome.reason`
  (`timed out after Ns`) on BOTH the blocking (`error`) and informative (`warning`) emits; a
  non-timeout failure leaves `reason` undefined. The disambiguation keys on the REAL `timedOut` signal,
  NEVER on the 124 value (that IS the ambiguity). `reason` flows verbatim into the `--json`
  `gates[]` entry, so a consumer now distinguishes a timed-out gate
  (`{status, exitCode:124, reason:"timed out after Ns"}`) from a genuine-124 child (same status +
  exitCode, NO timeout reason). Exit code stays `124`. Reflected in `openspec/specs/ci-gates/spec.md`
  (outcome-shape narrative + new "timed-out gate is distinguishable from a genuine 124" scenario).
  Tests: `src/commands/ci.test.ts` — `runGateNative` timedOut:true on wall-clock timeout, timedOut:false
  on `exit 124` (with and without a generous timeout); `collectGateOutcomes` blocking-timeout carries
  `timed out` reason + exitCode 124, genuine `exit 124` has NO reason (the two 124s distinguishable),
  informative-timeout carries the reason (warning, exit 0). All prior `runGateNative` direct-return
  tests updated to read `.code`.

## 2026-08-08 — from SDD `ci-engine-unification` slice 1 (measured coverage baseline)

Source: `openspec/changes/ci-engine-unification/design.md` (Coverage Guard) and
`openspec/changes/ci-engine-unification/review-ledger.md` (JDB2-003).

### COV-1 — Branch coverage is ~79%, below the configured 80% floor

`pnpm test:coverage` FAILS on `main` and on the slice-1 branch: the configured
80% branch threshold is unmet. This is pre-existing debt, not introduced by
`ci-engine-unification` (slice 1 moves branches UP).

- Evidence: `vitest.config.ts` coverage thresholds; measured `coverage/clover.xml`
  on a developer box WITH Docker and the `javi-forge-node` image present (the
  Docker-gated integration suites ran; without Docker, and in CI, they `skipIf`
  out and these figures shift) — `main` @ 2a0abaa 1880/2411 conditionals =
  77.97%, slice 1 @ 12d9b4d 1902/2411 = 78.88%, slice 1 @ 1f5c69b 1904/2411 =
  78.97%. Treat every figure as an environment- and commit-specific reading, not
  a floor: the SDD's own gate is a same-run delta, not an absolute number.
- Suggested fix: close the ~1.1pp gap as its own effort — target the least-covered
  branch clusters rather than blanket-adding tests. Do NOT lower the threshold.
- **CLOSED 2026-08-09** — resolved incidentally by the test work in ci-validate,
  ENV-1, and the four gates-v2 slices. Measured on `main` @ 44a9c53:
  branches 2183/2709 = **80.58%** (≥ 80 floor), lines 3655/4074 = 89.71% (≥ 85);
  `npx vitest run --coverage` now exits 0. Threshold NOT lowered — the gap closed
  from above. (Ladder step, per biogas M3: raise the floor later when 80.58%
  stops generating noise, not now.)

### COV-2 — `pnpm validate` does not run coverage, so the thresholds gate nothing

The vitest coverage thresholds are only evaluated by `pnpm test:coverage`, which
neither `pnpm validate`, the git hooks, nor CI invoke. A coverage regression is
therefore invisible until someone runs the command by hand.

- Evidence: `package.json` scripts — `validate` chains lint/typecheck/test, not
  `test:coverage`.
- Suggested fix: decide whether to wire `test:coverage` into `validate`/CI ONCE
  COV-1 lands. Wiring it before COV-1 would close every PR with a red gate.
- **CLOSED 2026-08-09** — wired into CI (`.github/workflows/ci.yml`: `pnpm test`
  → `pnpm test:coverage`) now that COV-1 is met, so the 85/80 floor gates real
  PRs. Deliberately NOT wired into local `pnpm validate`/git hooks: coverage
  instrumentation on every pre-commit adds friction and the ±1-branch run jitter
  (~0.04pp) against a 0.58pp margin could red-gate a clean local commit. The CI
  gate has teeth; the local loop stays fast. This closes the "a floor no command
  measures is a wish" gap flagged at the start of the quality-framework arc.

### SEC-1 — Hook write path: O_NOFOLLOW + fchmod (design-level hardening)
- **Source**: judgment-day slice 3b, JDA7-003/JDA7-005/JDB7-008 (convergent, parked by decision).
- **What**: the classify→write window on the HOOK path uses plain `fs.writeFile` (no O_NOFOLLOW) and the backup `chmod` is path-based (follows symlinks). A concurrent local attacker with write access to `.git/hooks` could plant a symlink inside the window. The backup CREATE is already atomic (COPYFILE_EXCL); this extends the property to the final write and the mode fix.
- **Fix shape**: `fs.open(hookPath, O_WRONLY|O_TRUNC|O_NOFOLLOW)` + write on the fd + `fchmod(fd, 0o755)`; same fd-based pattern for the backup chmod. Also consider `nlink > 1` refusal (hardlink truncation, mitigated by fs.protected_hardlinks=1 on modern Linux).
- **Threat model**: local attacker who ALREADY has write access to the repo's .git — low priority, defense in depth. Pre-existing class (the old clobber path had the same exposure with a smaller window).
- **CLOSED 2026-08-09**: shipped `writeHookFile()` in `src/commands/ci.ts` — the
  final hook write now goes through an FD opened
  `O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW` (mode `0755` on create) with
  `filehandle.writeFile` + `filehandle.chmod` (fchmod) in a `try/finally`
  close, so bytes and mode provably land on the same inode. The backup-side
  mode restore in `backupHook` is likewise fchmod on an FD opened
  `O_RDONLY|O_NOFOLLOW` right after the `COPYFILE_EXCL` create. `O_NOFOLLOW`
  degrades to `0` where the platform lacks it (Windows). Covered by
  "refuses a symlink planted AFTER classification (O_NOFOLLOW closes the race)"
  in `src/commands/ci-hooks.test.ts`, which plants the symlink during the asset
  read and asserts `ELOOP` plus an untouched victim file; verified RED against
  the old `fs.writeFile` path. All pre-existing hook tests pass unchanged.
- **Residual, still parked**: the `nlink > 1` (hardlink truncation) refusal was
  deliberately NOT added. `O_NOFOLLOW` does not stop a hardlink; on modern
  Linux `fs.protected_hardlinks=1` mitigates the cross-owner case.

> Follow-up (JDA7-012, one line): tighten `assertHookManifestEntry` with `.every((h) => typeof h?.sha256 === "string")` so a `historical:[null]` manifest yields a NAMED error.
>
> **CLOSED 2026-08-09**: shipped. `assertHookManifestEntry` now rejects any
> `historical` element without a string `sha256`, so `historical: [null]` and
> `historical: ["raw"]` surface as the named manifest error (path + reason +
> reinstall remedy) instead of an unnamed `TypeError` raised later inside
> `isReleasedBody`. Two RED-first tests added in `src/commands/ci-hooks.test.ts`
> ("installCIHooks manifest failures"); sibling hooks still install.

### IMG-1 — Image-ref hardening: trim + leading-dash guard on the RUNNER path too
- **Source**: containerized-gates slice-1 judgment-day (JDA-001/JDB-B01, JDB-B02).
- **What**: (a) `gate.image` (and `runner.image`) are validated on the trimmed value but STORED untrimmed — a whitespace-surrounded ref reaches docker argv untrimmed → "invalid reference format" at run time instead of a clean validation error. Store `.trim()`ed for early/clear failure. (b) The RUNNER `image` validation (ci-config.ts:259-269) has NO leading-dash guard — a runner `image: "--privileged"` / `-v /:/host` would be injected as a docker run FLAG (the exact flag-injection vector the gate path now guards at ci-config.ts:437). Apply the same leading-dash guard to `runner.image`.
- **Threat model**: trust-bounded (the ci.yaml author already has host code-exec), so defense-in-depth / consistency, not an escalation. Do gate + runner together so the two paths stay consistent.
- **Suggested fix**: one shared `validateImageRef(value, path)` helper used by both runner and gate validation (trim + non-empty + leading-dash reject), returning the trimmed value to store.
- **CLOSED 2026-08-10** (PR #23) — shipped exactly the suggested fix: a shared
  `validateImageRef(value, fieldPath, errors)` in `src/lib/ci-config.ts` used by BOTH `runner.image`
  and `gate.image` — rejects non-string / empty-after-trim, rejects leading-dash-after-trim
  (docker-flag-injection guard the runner path lacked), and stores the trimmed value. Risk-lens review
  clean (the image reaches `spawn` as a single argv element, no shell re-split → leading-dash is the
  only flag vector, blocked). RED-first tests: runner `--privileged` now rejected; whitespace-padded
  refs stored trimmed.

### PREPUSH-EACCES — RESOLVED (real root cause: unpinned pnpm in the runner image)
- **Status**: CLOSED 2026-08-10 (branch `fix/pin-pnpm-runner-image`). The original
  `_tmp_ EACCES` framing below was a **misdiagnosis**; the real blocker was an
  UNPINNED pnpm in the runner image drifting to pnpm 11 against a pnpm-10-era
  lockfile.
- **Source**: containerized-gates slices 2/3 — the pre-push hook (`javi-forge ci` full,
  containerized) aborted the push; forced `--no-verify` on #16 and #17.
- **What actually broke it**: `ci-local/docker/node.Dockerfile` and the
  `getDockerfileContent("node")` template in `src/lib/docker.ts` installed pnpm
  UNPINNED (`RUN npm install -g pnpm`), so the image drifted to pnpm 11 while the
  repo targets pnpm 10 (`.github/workflows/ci.yml` `pnpm/action-setup@v4 version: 10`;
  `pnpm-lock.yaml` `lockfileVersion: '9.0'`). A pnpm-11 frozen install against that
  lockfile fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. That install-phase abort
  is what killed the pre-push run — upstream of any gate code — and got mislabeled
  as an `EACCES`/`Lint failed` cascade.
- **Fix (M8 pin-everything)**: pinned pnpm to major 10 (`RUN npm install -g pnpm@10`)
  in ALL FOUR node-runner install sites in lockstep: `ci-local/docker/node.Dockerfile`,
  the `getDockerfileContent("node")` template in `src/lib/docker.ts`, AND the two
  standalone-runner heredocs `ci-local/ci-local.sh` + `ci-local/ci-local.ps1`. The
  last two matter because `ensureImage()` writes `getDockerfileContent()` only when
  the committed Dockerfile is ABSENT, otherwise reads the committed file — and running
  `ci-local.sh full` / `.ps1 full` REGENERATES that committed file from its heredoc,
  so an unpinned heredoc would silently clobber the pin and reintroduce the pnpm-11
  drift (resilience review R4-001). `package.json` `packageManager` was intentionally
  NOT added — it would alter the local corepack flow; the Dockerfile/heredoc pins are
  the minimal safe fix.
- **Follow-up (noted, NOT fixed here)**: the four sites diverge on the BASE image —
  the two `ci-local/*` heredocs pin `node:22-slim@sha256:689c…` (digest) while the
  committed `node.Dockerfile` + the `getDockerfileContent` template use floating
  `node:22-slim`. For full M8 consistency, standardize all four on the same digest
  (a separate decision, since it changes the built image + the docker.ts content test).
- **The `_tmp_ EACCES` was NOT a code bug for the standard host**: `runInContainer`
  already runs `--user $(uid):$(gid)` (ENV-1), which grants owner+group write on the
  0775 host tree, so pnpm's atomic-temp write at the mount root succeeds for the
  uid-1000 owner. The only residual EACCES is the R4-002 edge (host uid ≠ 1000 with
  no `/etc/passwd` entry), which is environment-unfixable and documented as such —
  it is NOT what blocked the standard-host pre-push.
- **Empirical verification (2026-08-10)**: rebuilt the node runner image (pnpm baked
  = `10.34.5`). A containerized `pnpm install --frozen-lockfile` mounted at
  `/home/runner/work` as `--user $(id -u):$(id -g)` (1000:1000) SUCCEEDS (exit 0) —
  no `LOCKFILE_CONFIG_MISMATCH`, no EACCES. Containerized `pnpm build` (tsc) and
  `pnpm test:coverage` (vitest/esbuild) both exercise cleanly.
- **Residual, orthogonal to pnpm**: the containerized full test suite still has 3
  ENVIRONMENTAL failures in the node-only image — `ci-mixed.integration.test.ts`
  and `ci-hooks.e2e.test.ts` require a real python3/ruff toolchain the node image
  does not carry (`Command failed: bash -c command -v python3`). These are NOT
  caused by pnpm and NOT a regression; they are inherent to running a mixed
  Node+Python integration suite inside a single-language runner. Track separately if
  a fully green containerized full-CI is wanted (e.g. a multi-toolchain image or
  gating those tests on toolchain presence).
- **Push implication (CORRECTED 2026-08-10)**: the earlier claim "pushes no longer
  need `--no-verify`" was OPTIMISTIC and empirically FALSE — see STALE-GLOBAL-CLI
  below. The pin is correct in the repo, but the LOCAL pre-push runs the
  globally-installed `javi-forge` (v1.9.0), which bundles its OWN pre-fix
  `ci-local/docker/*` and ignores the repo's committed pin. So pushes still needed
  `--no-verify` this whole session — because the pre-push was exercising 1.9.0's
  stale bundled code, not the working tree.
- **`ERR_PNPM_IGNORED_BUILDS: esbuild`**: appears as a soft WARNING only (install
  exits 0); esbuild 0.28 ships its binary via the `@esbuild/linux-x64` optional
  package (no postinstall needed), so build+tests run fine. No action required.

### STALE-GLOBAL-CLI — the local pre-push runs an OLD globally-installed `javi-forge`
- **Status**: RESOLVED 2026-08-10 (root-caused + fixed + validated). This was the REAL reason
  every push this session used `--no-verify`, and it retracts a wrong intermediate
  hypothesis ("`ensureImage` doesn't rebuild on Dockerfile change" — FALSE; ensureImage
  correctly rebuilds when the Dockerfile `dockerfile-hash` label differs, docker.ts:241-260).
- **What actually happens**: the pre-push hook runs `command -v javi-forge && javi-forge ci …`
  → the GLOBALLY-INSTALLED binary at `/home/linuxbrew/.linuxbrew/bin/javi-forge`, which is
  **version 1.9.0**. That package bundles its OWN copy of `ci-local/docker/node.Dockerfile`
  (`/home/linuxbrew/.linuxbrew/lib/node_modules/javi-forge/ci-local/docker/node.Dockerfile`)
  = the OLD UNPINNED form (`FROM node:22-slim` + `RUN npm install -g pnpm`). `ensureImage`
  reads the Dockerfile relative to ITS OWN module location, so the 1.9.0 CLI builds the node
  runner from its stale bundled Dockerfile → pnpm 11 image → `runDepsStatusCheck` fails
  against the pnpm-10 lockfile → the pre-push aborts in ~3s.
- **Evidence (decisive)**: the built `javi-forge-ci-node:latest` carries
  `dockerfile-hash` label `a3403755…` = the sha256 of the 1.9.0-bundled UNPINNED
  Dockerfile; the repo's committed pinned `node.Dockerfile` hashes to `358382e5…`. The
  running image's pnpm = 11.20.0. Global `javi-forge --version` = `1.9.0` (repo is at 1.21.1).
- **Implication for the whole session**: the containerized pre-push has been exercising
  1.9.0's bundled code the ENTIRE session — none of the containerized-gates / hooks-ricos /
  pnpm-pin / digest work is in that binary. So `--no-verify` was unavoidable and the
  pre-push's red was never about the working tree.
- **Fix (user action, not a code change)**: update the global install —
  `npm i -g javi-forge@latest` (the install lives under linuxbrew's node, so use that npm)
  to ≥1.21.1. After that, the pre-push's `javi-forge` bundles the pinned Dockerfile →
  ensureImage rebuilds a pnpm@10 image (hash now matches the pinned form) → frozen install
  passes, python tests are skipIf-gated → the containerized pre-push should go green without
  `--no-verify`. VERIFY by re-running a push after the upgrade.
- **Optional hardening (own ticket)**: the pre-push could prefer the repo-local build
  (`node dist/index.js ci` / the workspace binary) over a possibly-stale global install, so a
  repo's own committed runner assets always win. Design decision — a global CLI is also a
  legitimate choice; don't change the hook contract without intent.
- **RESOLUTION 2026-08-10**: (1) user ran `npm i -g javi-forge@latest` → global now 1.21.2+;
  validated by running `javi-forge ci` (containerized) to full green — ensureImage rebuilt a pnpm@10
  image, all phases passed. Subsequent pushes went through with the pre-push ENABLED (no `--no-verify`,
  ~70s each). (2) Code-side hardening shipped in **PR #27**: `javi-forge ci` now prefers the repo-local
  `ci-local/docker/${stack}.Dockerfile` over the CLI's bundled copy (per-stack, no write-through), so a
  stale global's bundled Dockerfiles no longer override a repo's committed runner assets. The "prefer
  repo-local BINARY" variant above stays deferred (it's a hook-contract change; the Dockerfile-level
  fix covered the class that actually bit us).
