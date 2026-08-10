# Review Ledger — gates-v2

## Design — judgment-day

Two blind judges reviewed the DESIGN (+ one spec-delta correction). Judge A: REJECT (3 CRITICAL).
Judge B: APPROVE-WITH-FIXES (1 CRITICAL). Convergent + verified findings below were fixed in
`design.md`, `specs/ci-execution/spec.md`, and `specs/ci-gates/spec.md`.

| id | lens | location | severity | status | evidence |
|----|------|----------|----------|--------|----------|
| JDA-002 / JDB-002 | judgment-day | design.md (prologue) · ci.ts:502-510 · ci-config.ts:321-326 | BLOCKER | fixed | CONVERGENT. Gates-only v2 repo (zero runners) crashes: `runCI` dereferences `resolved.runners[0].stack/...` unconditionally → TypeError before the gate phase; ci-config hard-requires non-empty runners. Fix: prologue guard skips stackInfo/docker-check/image when `resolved.runners` is empty (slice 3); runners OPTIONAL under v2 when gates present, v1 unchanged (slice 1). |
| JDA-001 / JDB-003 | judgment-day | design.md (execution) · ci.ts:639-691, 918-964 | BLOCKER | fixed | CONVERGENT. DECISION: gates run NATIVE-ONLY in v1. `runStep`'s Docker branch requires a runner + image gates do not have; the security/ghagga template runs host-native. New `runGateNative` spawns `bash -c` with the env map and RETURNS the exit code. Docker gates = deferred follow-up. |
| JDA-003 | judgment-day | openspec/specs/ci-execution/spec.md:81-82 | BLOCKER | fixed | Live spec says "No `ci.yaml` schema key MAY be added; version 1 stays locked" — gates-v2 adds version 2 + `gates`, a direct contradiction. Fix: MODIFIED requirement delta in `specs/ci-execution/spec.md` re-scoping the lock to v1 only (v2 additive). Archived change folder NOT touched. design.md Open Questions updated (no longer "none blocking"). |
| JDB-004 | judgment-day | design.md (execution) · ci.ts:918 | CRITICAL | fixed | Folded into JDA-001 fix: `runStep` returns void → cannot surface exit code. `runGateNative` returns the child exit code so JSON `exitCode` populates. |
| JDA-004 / JDB-005 | judgment-day | design.md (slice 4) · dispatch/ci.tsx:36-62,117-131 | CRITICAL | fixed | `--json` is consumed only by `ci validate`; the main `ci` run path always renders Ink and never reads json. Reframed slice-4 JSON as a NEW headless run/exit-code branch (bypass Ink, collect gate outcomes, emit `{ok,gates}`, set own exit code). 4a/4b split re-weighted. |
| JDB-006 | judgment-day | design.md (mode-gating) · ci.ts:640,670 | WARNING | fixed | Security/ghagga gated on `mode==="full"`; a blocking gate silently skipped under `--quick` is a near-false-green. DECISION: gate phase runs on `full` AND `quick`, skipped only in `detect`/`shell`. Spec scenario + test pinned. Canonical severity WARNING/status info; recorded here as fixed because the design encodes the decision. |
| JDA-005 | judgment-day | design.md (git-diff.ts) | WARNING | fixed | Loud-degrade only covered null base; a base that RESOLVES but is absent from local history (shallow clone) makes `git diff <base>...HEAD` throw. Extended contract: `changedFiles` failure ALSO skips the scope:changed gate with a named warning, never widens, never crashes. Spec scenario + test added. |
| JDA-006 | judgment-day | design.md (version negotiation) · ci-config.ts:308-314 | WARNING | fixed | Unknown-key loop runs BEFORE the version check → a v1+gates config emits generic "unknown field gates" instead of "gates require version: 2". Fix: compute allowed-key set AFTER `doc.version`, special-case gates-under-v1 to the named error. |
| JDB-007 | judgment-day | design.md (execution) | SUGGESTION | fixed | Multi-command gate semantics unspecified. Encoded: gates follow runner fail-fast (first non-zero wins, later cmds skipped); JSON exitCode = first-failure code. |
| JDB-008 | judgment-day | design.md (env precedence) | SUGGESTION | fixed | Gate `env:` spreads LAST → can override engine-injected `CI`/`JAVI_FORGE_CHANGED_FILES`. DECISION: document last-wins precedence; engine does not hard-protect the keys in v1. |
| JDB-009 | judgment-day | design.md (testing) | SUGGESTION | fixed | git-init IT must create a deterministic `main` (`git init -b main` or explicit base sha) so it exercises the diff path, not the loud-degrade path (otherwise depends on `init.defaultBranch`). |

### Verified-safe claims (NOT re-litigated)

| id | claim | verdict |
|----|-------|---------|
| — | Informative gate degrade does not produce a false-green | SAFE — informative failures never enter `blockingFailures[]`; exit stays 0 by design, blocking failures always raise. NO false-green. |
| — | `env:` values cannot shell-inject | SAFE — values pass through the spawn env MAP as discrete entries (argv-safe), never concatenated into `bash -c`. |
| — | Loud-degrade base-null path | SAFE — base `null` skips every scope:changed gate with a named warning, never widens to `all` (the shallow-clone throw path JDA-005 is the ADDED sibling case). |
| — | `CIStepStatus += "warning"` ripple | SAFE — TypeScript forces both `Record<CIStep["status"],...>` in CI.tsx to gain the key (compile-time guard); no exhaustive switch exists → the two Records are the whole ripple. |
| JDB-001 | B1 naming edit atomicity (implicit=bare vs explicit=suffixed; R3 guard intact) | SAFE — B1 flips only stack-override to bare; single-runner-CONFIG stays suffixed (R3 guard ci.test.ts:1388-1390 untouched); frozen characterization test updated as a sanctioned spec-reversal. |

Convergences: JDA-002≡JDB-002 (gates-only crash), JDA-001≡JDB-003 (execution backend),
JDA-004≡JDB-005 (headless JSON). Native-only decision propagated across schema, execution, risk
table, and slices.

## Design — round 2 (scoped re-judge, judge A) — APPROVED

All 3 REJECT CRITICALs (JDA-001 execution backend, JDA-002 gates-only crash, JDA-003 self-contradictory spec) and both WARNINGs (JDA-005 shallow-clone, JDA-006 named-error ordering) verified resolved and consistently propagated. Native-only decision confirmed consistent across schema/execution/risk/slices/specs. Archive folder untouched (git status --porcelain clean). Convergence budget (2 rounds) honored; no still-open BLOCKER/CRITICAL.

3 new info items (all swept post-verdict by the orchestrator, one-line spec edits):
| id | severity | location | status | evidence |
|---|---|---|---|---|
| GATES-NEW-01 | judgment-day | ci-gates/spec.md:7 | fixed | Purpose line still said "reusing runStep" — contradicted the native-only requirement. Rewritten to "host-native (modeled on security/ghagga — NOT runStep)". |
| GATES-NEW-02 | judgment-day | ci-execution/spec.md MODIFIED req | fixed | The MODIFIED requirement (whole-req replacement) dropped the live spec's orthogonal "Detect mode emits only the detect step" scenario → silent contract loss on promotion. Re-included. |
| GATES-NEW-03 | judgment-day | design.md:37 vs ci-gates:15 | fixed | Divergence on runners-optional-under-v2. Reconciled: under v2 runners optional when gates present; a v2 config with NEITHER runners nor gates fails closed. Applied to both specs. |

## Apply slice 1 — judgment-day (schema + B1 + B2) — APPROVED

Two blind judges, both APPROVE, zero BLOCKER/CRITICAL, no fix round. Judge B verified EMPIRICALLY (1422 tests green, tsc clean, direct parseCIConfig probe vs 16 hostile configs). Load-bearing named-error ordering (JDA-006) confirmed by probe: v1+gates → "gates require version: 2", never the generic unknown-field. v1 byte-identity, B1 atomic test-edit + R3 guard intact, B2 three-branch shell resolution, zero slice-2/3/4 leakage — all verified against code.

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JDA-A-001 / JDB-S1-001 (convergent) | judgment-day | ci-config.ts:493-521 / ci.ts:521-542 | WARNING | info | Theoretical fail-closed edges: empty `gates: []` beside real runners hard-fails (defensible, named); shell mode picks primary runner's image in a multi-runner v2 config. Both in-scope-correct for slice 1, recorded as forward-looking. |
| JDA-A-002 | judgment-day | coverage | WARNING | info | Judge A (read-only sandbox) could not re-run coverage; judge B confirmed empirically on a real branch (crash-recovery detached-HEAD caveat addressed). |

## Apply slice 2 — judgment-day (git-diff engine) — APPROVED

Two blind judges, both APPROVE, zero BLOCKER/CRITICAL, no fix round. Judge B verified EMPIRICALLY (tsx probes in scratch repos): 40-zero sentinel is exact-match (a sha starting with 0 is KEPT), shallow-clone base THROWS (git exit 128 propagates, never []-swallow, never widen), ACMR excludes deletions, union-dedupe correct. UNWIRED confirmed (no importers). 1436 tests green.

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JDA-001 / JDB-S2-001 (convergent) | judgment-day | git-diff.ts:87-88 | WARNING | info | **SLICE-4 REQUIREMENT**: GitHub-push fallback uses `GITHUB_SHA` as diff base, but on actions/checkout HEAD===GITHUB_SHA → empty diff → scope:changed gates skip on GitHub pushes (visible skip, NOT a false-green, per B). The correct push base is `github.event.before` (not a default env var). Faithfully implements design.md:108 — a design-level semantic weakness, inert while unwired. Slice-4 wiring author MUST reconsider the GitHub-push base (e.g. accept an explicit base override, or document that scope:changed on GitHub push needs github.event.before wired via CI config) before consuming changedFiles. |
| JDB-S2-002 | judgment-day | git-diff.ts:84-86 | SUGGESTION | info | GITHUB_BASE_REF set but origin/<ref> unfetched (shallow) → falls through to local candidates correctly. Intentional/safe. |

## Apply slice 3 — judgment-day (runGates execution) — APPROVE-WITH-FIXES → fixed

Two blind judges. Judge A: APPROVE-WITH-FIXES. Judge B: APPROVE-WITH-FIXES with ONE CRITICAL
(a real false-green). Convergence: both judges independently flagged `runGateNative`'s exit-code
mapping and the unpinned ordering guarantee. The JDB-001 CRITICAL (signal-death false-green) was
fixed in production + RED-then-GREEN test; JDA-001 ordering pinned by a test (production already
correct). STRICT TDD followed: the signal-death test went RED against `code ?? 0` (returned 0),
GREEN after the fix.

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JDB-001 | judgment-day | ci.ts:runGateNative close handler | CRITICAL | fixed | **SIGNAL-DEATH FALSE-GREEN.** `close` did `resolve(code ?? 0)` → a NULL code (process killed by a signal: OOM kill, SIGSEGV/SIGABRT, external SIGTERM) mapped to exit 0 = SUCCESS. A signal-killed BLOCKING gate would report `done` and the build would PASS — the exact false-green this slice exists to eliminate. The three sibling spawners (runStep native, runSemgrep, runGhagga) all treat signal death as failure. FIX: `close` handler now receives `(code, signal)`; when `code === null` it resolves to a NON-ZERO code (`128 + os.constants.signals[signal]` when resolvable, else 1), so the collector records a blocking failure and runGates throws. Spawn `error` already rejects → caught by runGates as a failure (consistent, not 0). TEST: BLOCKING gate `kill -TERM $$` → runGateNative returns 143, collector records error, runGates throws (`ci.test.ts` runGateNative + runCI signal-death tests). RED confirmed against `code ?? 0` (returned 0/undefined). |
| JDA-001 | judgment-day | design.md:19 · ci.ts:runGates loop | WARNING | fixed | **ORDERING GUARANTEE UNPINNED (TEST-ONLY).** The core decision (a blocking failure DEFERS the aggregate throw until AFTER later gates report) had no test that would catch a regression to throw-on-first-blocking. FIX (test only, no production change): added `[first-blocker(fail), second-runs]` test asserting (a) the SECOND gate still reported `done` after the first blocking failure AND (b) runGates threw naming the blocker. Goes RED against a throw-on-first-blocking implementation. Canonical severity WARNING/status info; recorded fixed because the guarantee is now pinned. |
| JDA-003 | judgment-day | ci.ts:describeRunners JSDoc | SUGGESTION | fixed | **STALE JSDOC.** The JSDoc claimed the invariant "`runners` is never empty" — now false for gates-only v2 configs which reach `describeRunners` with zero runners (the `config` branch reads `runners.length` and maps the possibly-empty list, never derefs `runners[0]`, so harmless). Comment corrected to note gates-only v2 reaches it with zero runners and the config branch handles it. |

### Slice-4 requirements / carry-forward (NOT fixed here)

| id | severity | location | status | evidence |
|---|---|---|---|---|
| JDA-002 | judgment-day | ci.ts:runGates | WARNING | info | **SLICE-4 REQUIREMENT.** `runGates` never reads `gate.scope` — a `scope: changed` gate runs as `scope: all` in slice 3 (FAIL-SAFE: over-runs, never a false-green). Slice-4 wiring MUST branch on `gate.scope` (feeding `JAVI_FORGE_CHANGED_FILES` from the slice-2 git-diff engine) before this is user-visible. |
| JDB-002 | judgment-day | ci.ts:runGateNative | WARNING | info | Gates have NO execution timeout (consistent with runSemgrep/runGhagga, which are also untimed). Candidate follow-up, not a defect; note for a future hardening slice. |
| JDA-001 (S2) / JDB-S2-001 | judgment-day | git-diff.ts:87-88 | WARNING | info | **SLICE-4 REQUIREMENT (carried from slice 2).** GitHub-push fallback uses `GITHUB_SHA` as diff base → on actions/checkout HEAD===GITHUB_SHA → empty diff → scope:changed gates skip on GitHub pushes (visible skip, NOT a false-green). Slice-4 author MUST reconsider the push base (`github.event.before` / explicit override) before consuming changedFiles. |

### Verified-safe claims (slice 3 — NOT re-litigated)

| id | claim | verdict |
|----|-------|---------|
| — | Clean-exit false-green (non-zero blocking gate reports done) | SAFE — code 0 → done; any non-zero (now including signal death) → blockingFailures[]; informative never enters the accumulator; aggregate throw after the loop yields exit 1. NO false-green. |
| — | Prologue guard (gates-only zero-runner path) | SAFE — the prologue skips stackInfo/docker-check/image when `resolved.runners` is empty; the gate phase still runs; `describeRunners` config branch never derefs runners[0]. |
| — | Mode-gating (blocking gate skipped under --quick) | SAFE — gate phase runs on `full` AND `quick`; skipped only in `detect`/`shell`. Pinned by `runs gates under full mode` + `skips the gate phase in detect mode` tests. |
| — | `CIStepStatus += "warning"` ripple = 2 Records | SAFE — tsc clean; TypeScript forces both `Record<CIStep["status"],...>` to gain the key; no exhaustive switch → the two Records are the whole ripple. |

## Apply slice 4 — judgment-day (final wiring) — APPROVE → polished

Two blind judges. Both APPROVE with ZERO BLOCKER/CRITICAL — the diff is correct
(no silent-widen, no JSON exit-code false-green, three carried-forward slice-4 requirements
closed, GitHub-push base handled, env-map safety intact). The findings below are quality
polish applied BEFORE closing the SDD, not defect fixes. Convergence: both judges independently
flagged the `ok` footgun (JDA-A-002 ≡ JDB-101). STRICT TDD on the two behavior changes:
reason-in-JSON and top-level-exitCode both went RED first, GREEN after the production edit.

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JDA-A-001 | judgment-day | ci.ts:GateOutcome · runGates skip branches | WARNING | fixed | **DEGRADE SILENT FOR JSON CONSUMERS.** A `scope: changed` gate that degrades (base ref null, or `changedFiles` throws under a shallow clone) surfaced as `status:"skipped"` with the REASON discarded — the named warning went only through `onStep` (a no-op in `collectGateOutcomes`) and `GateOutcome` had no reason field. Contradicts the biogas M1 "degrade LOUDLY" doctrine for JSON consumers. FIX: added optional `reason?: string` to `GateOutcome` (and the JSON `gates[]` entry), populated for the three skip variants — base-null, changedFiles-throw, and empty-set ("no changed files"). Spec JSON shape updated to include `reason?`. TDD: RED test (scope:changed + throwing changedFiles in --json → `gate.reason` undefined) then GREEN after populating the emit. Companion empty-set test added. Canonical severity WARNING/status info; recorded fixed because the JSON degrade is now loud. |
| JDA-A-002 / JDB-101 | judgment-day | ci.tsx:--json branch · ci.ts:collectGateOutcomes | WARNING | fixed | **CONVERGENT — the `ok` footgun.** In `ci --json` full mode a blocking RUNNER (not gate) failure makes runCI throw → JSON was `{ok:true, gates:[]}` while the process exited 1. NOT an exit-code false-green (exit code is correct), but a consumer keying on `ok` alone misreads a runner failure as success. The spec strictly defines `ok` over blocking GATES only ("if and only if a BLOCKING gate errored"), so per the fix contract we ADDED a top-level `exitCode` to the JSON object rather than reinterpret `ok`. A runner failure now prints `{ok:true, exitCode:1, gates:[]}` — the run failure is visible without the process exit code. Spec JSON shape + scenario updated. TDD: RED dispatch test (mock `{ok:true, exitCode:1}` → printed JSON had no `exitCode`) then GREEN after threading `exitCode` into the printed object; existing "only informative" exact-shape test updated for the additive field. |
| JDB-103 | judgment-day | ci.ts:CHANGED_FILES_ENV | SUGGESTION | fixed | **NEWLINE IN CHANGED-FILE PATH.** `$JAVI_FORGE_CHANGED_FILES` is newline-joined; a path with a literal newline (git `core.quotePath` off) corrupts line-based parsing. Low likelihood. FIX: documented KNOWN LIMITATION caveat at the `CHANGED_FILES_ENV` constant and in the spec, accepting the caveat rather than switching to NUL-joining (which would force every gate consumer to change its parser). Doc-only, no behavior change. |

### Carry-forward (NOT fixed — test-hardening follow-up)

| id | severity | location | status | evidence |
|---|---|---|---|---|
| JDB-102 | judgment-day | ci.tsx:--json → collectGateOutcomes → process.exit seam | WARNING | info | **SEAM VERIFIED IN TWO HALVES, NOT END-TO-END.** The dispatch `--json` path (mocks `collectGateOutcomes`) and `collectGateOutcomes` itself (real runGates) are each tested, but no single test drives dispatch → real collector → real `process.exit` end-to-end. Non-blocking test-hardening follow-up; the two halves fully cover the contract. |

### Verified-safe claims (slice 4 — NOT re-litigated)

| id | claim | verdict |
|----|-------|---------|
| — | No silent-widen on scope:changed degrade | SAFE — base-null and changedFiles-throw both resolve to a `skip` ChangedScope; the gate is skipped, NEVER re-run as scope:all. Pinned by loud-degrade tests. |
| — | No JSON exit-code false-green | SAFE — `collectGateOutcomes.exitCode` is 1 on a blocking-gate error OR any runCI throw; dispatch sets `process.exit(result.exitCode)`. A failed run never exits 0. |
| — | Three carried-forward slice-4 requirements closed | SAFE — JDA-002 (scope branch wired), JDA-001-S2/JDB-S2-001 (GitHub-push base) and the changedFiles consumption are all implemented and tested in slice 4. |
| — | GitHub-push base | SAFE — resolveBaseRef handled; scope:changed skips loudly on an unresolvable/absent base rather than widening. |
| — | env-map safety | SAFE — gate env passed as a discrete child-process map (`filterDefinedEnv` + last-wins gate.env), NEVER string-interpolated into `bash -c`; metacharacters in a value cannot break out of the shell. |
