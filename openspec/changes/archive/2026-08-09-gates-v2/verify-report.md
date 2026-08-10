# Verification Report — gates-v2

**Change**: gates-v2 · **Artifact store**: hybrid (engram mirror: `sdd/gates-v2/verify-report`, #13390) · **Verified against**: merged `main @ bbfd22f` (PRs #8/#9/#10/#11 all merged; semantic-release cut 1.11.0/1.12.0/1.13.0).
**Verdict**: **PASS** — 0 CRITICAL, 0 WARNING open (the sandbox re-run gap was closed by the orchestrator, below), 2 SUGGESTION/INFO.

## Runtime evidence (orchestrator re-run on merged main @ bbfd22f, real exit codes)

| Command | Exit | Evidence |
|---|---|---|
| `pnpm validate` | 0 | typecheck + typecheck:test + biome + full vitest (1471 passed / 4 skipped) |
| `pnpm package:check` | 0 | 365 files, 105 js, 105 declarations, 70 templates, 54 modules, 8 workflows |

(The sdd-verify executor ran read-only and could not re-run the gate; the orchestrator re-ran both first-hand, closing the WARNING the verify flagged. Additionally corroborated by three green-CI-gated semantic-release cuts across the chain.)

## Completeness — PASS
33/33 tasks `[x]`; all four slices merged and present on `main`.

## Spec compliance — PASS (both deltas mapped to merged-main code)

**ci-gates (NEW capability):**
| Requirement | Evidence on main |
|---|---|
| version:2 negotiation, fail-closed preserved | ci-config.ts:499-544 — accept-set {1,2}; v1+gates → "gates require version: 2" computed AFTER version, BEFORE unknown-key; runners optional under v2 w/ gates; v2-neither → fail-closed; v1 byte-identical (gates attached only when length>0) |
| Gate schema/field validation | validateGates() ci-config.ts:427+ |
| Gate execution (host-native, returns exit code, multi-cmd fail-fast, full+quick, skip detect/shell) | runGateNative ci.ts:1122-1142, runGates ci.ts:1222-1351 |
| scope:changed loud-degrade | resolveChangedScope ci.ts:1239-1264 — base-null→skip+reason; changedFiles-throw→CATCH→skip+reason; empty→skip; never widen, never crash |
| gate env last-wins, spawn-map only | ci.ts:1283-1311 — never spliced into bash -c |
| Gate-run JSON {ok,exitCode,gates} | ci.tsx:147-167 + collectGateOutcomes ci.ts:1373-1395 |

**ci-execution (DELTA):** B1 naming implicit(auto|stack-override→bare) vs explicit(config→suffixed) (ci.ts:682-684, R3 guard intact); B2 shell honors image/buildContext (ci.ts:571-578); CIStepStatus += "warning" + both UI Records (ci.ts:61, CI.tsx:19,28); "v1 locked / v2 additive" re-scope.

## Two highest-stakes invariants — BOTH confirmed NO on merged main

**(a) Can a blocking / signal-killed blocking gate ever produce exit 0? NO.** runGateNative maps a null close code (signal death: OOM/SIGSEGV/SIGTERM) to 128+signum or 1 (ci.ts:1129-1139), never 0 → blockingFailures[] → aggregate throw → exit 1. collectGateOutcomes.exitCode = blockingErrored||threw ? 1 : 0; dispatch process.exit(result.exitCode) — the headless path owns its exit code (slice-3 signal-death CRITICAL + slice-4 JSON path both closed).

**(b) Can a scope:changed resolution failure silently run as scope:all or pass a blocking gate? NO.** base-null and changedFiles-throw both → {kind:"skip",reason}; gate SKIPPED with reason surfaced in the Ink stream AND the JSON reason field — never re-run as all, never enters blockingFailures, phase never crashes.

## Proposal success criteria — all satisfied
version:2 additive / v1 byte-identical; host-native blocking+informative; scope:changed loud-degrade; headless JSON owns its exit code; B1+B2 landed without touching the archived ci-engine-unification specs; warning ripple contained to 2 UI Records; CIStepStatus/exit-code semantics correct.

## Deferred/parked (honestly recorded)
- Docker-per-gate follow-up (JDA-001) → spec "OUT OF SCOPE for v2" + tasks Notes.
- Gate execution timeout (JDB-002) → ledger slice-3 carry-forward.
- End-to-end dispatch→collector→process.exit seam test (JDB-102) → ledger slice-4 carry-forward.
- Monorepo changed-files repo-root relativity → tasks.md Notes.
- Newline-in-changed-file-path (JDB-103) → spec KNOWN LIMITATION + ci.ts:1147-1153.

## Issues
- **SUGGESTION**: the gate-specific carry-forwards live in ledger/specs/code but not in docs/BACKLOG.md — promote for backlog visibility post-archive.
- **INFO**: the live promoted ci-execution requirement's blanket "no schema key" lock is re-scoped by the MODIFIED delta; promotion into the live spec happens at ARCHIVE (no in-change self-contradiction).

## Discrepancies against the ledger
None. Every load-bearing ledger claim spot-checked holds on the merged tree.
