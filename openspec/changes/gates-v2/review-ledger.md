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
