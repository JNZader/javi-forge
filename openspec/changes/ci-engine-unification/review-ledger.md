# Review Ledger — ci-engine-unification (design phase, judgment-day)

Round 1: two blind judges (A: REJECT — 1 BLOCKER, 2 CRITICAL; B: APPROVE-WITH-FIXES — 3 CRITICAL). Convergent findings merged below; fix pass applied 2026-08-08. Round 2: scoped re-judge (judge A) — **APPROVED**, 16/16 verified resolved against code (clover.xml coverage figures, ci.ts:13/:957 orphan import, ci.ts:880-886 security-phase skip conditions, verify-package-contents.mjs:122-126 prefix-check reasoning, CRLF regex behavior and slice-1 assertion invariance re-derived independently).

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JD-001 (JDA-001/JDB-003) | judgment-day | design.md:178→209,238-247 | BLOCKER | fixed | Planned test edits violated spec MUST ci-execution:110 ("ADDED tests only"); slice-1 characterization assertion was flipped by slice 2. Fix: ensureImage mock returns getImageName(runner.stack) → assertion invariant; grep tests untouched, byte-equality ADDED. |
| JD-002 (JDA-002/JDB-001) | judgment-day | design.md:34,91→39-43,111-122,232 | CRITICAL | fixed | .bak write path unguarded vs symlink (same attack ci.ts:1127-1146 defends for the hook). Fix: lstat every backup target, refuse symlink/non-regular even with --force, O_EXCL create with bounded retry. |
| JD-003 (JDA-003/JDB-011) | judgment-day | design.md:51-68→81-91 | CRITICAL | fixed | historical[] had no forward maintenance; generator mined TS constants deleted by slice 3 → first v1→v2 bump bricks fleet ci init (the R2 cliff). Fix: binding append-on-change rule sourced from git show prev:assets/hooks/*, guarded by test; v1 assertion sha256===historical[v0]. |
| JD-004 (JDA-007/JDB-002) | judgment-day | design.md:34,172→45,43,233 | CRITICAL | fixed | Spec MUST ci-hook-install:86 (backup fails ⇒ no overwrite) had no design element or test row. Fix: abort semantics + matrix row; backup copies original bytes, preserves mode. |
| JD-005 (JDA-005/JDB-009) | judgment-day | design.md:11-13→12-15 | WARNING | fixed | D1 precondition false for auto + --no-docker (prologue ensureImage inside if(!noDocker), ci.ts:536-573). Fix: precondition auto && !noDocker; skip nested inside !noDocker guard. |
| JD-006 (JDB-005) | judgment-day | design.md:90/66→111-122 | WARNING | fixed | Data flow said write on managed-current, D6 said zero writes. Fix: no-write idempotence, diagram branch added. |
| JD-007 (JDB-006) | judgment-day | design.md:182→251 | WARNING | fixed | Coverage evidence fabricated (~9k/88%); measured clover.xml 3256/3001=92.2%. Fix: real numbers, delta −0.13pp, conclusion survives. |
| JD-008 (JDB-007) | judgment-day | design.md:73→95 | WARNING | fixed | Packaging assertion covered 1 of 3 assets; prefix check passes on any single match. Fix: all three assets + manifest in REQUIRED_FILES. |
| JD-009 (JDA-008/JDB-012) | judgment-day | design.md:139→172-180,55 | WARNING | fixed | InstallHooksResult could not express "reported as upgraded" spec scenarios. Fix: upgraded[] + states[]; dispatch prints upgrades distinctly. |
| JD-010 (JDA-006) | judgment-day | design.md:18-25→21,27-28,212 | WARNING | fixed | doneLabel on shared descriptor would regress suffixed labels ("Tests [api] passed"). Fix: scoped to bare mode; suffixed test row added. |
| JD-011 (JDB-014) | judgment-day | design.md File Changes→129 | SUGGESTION | fixed | Deleting ci.ts:957 orphans getImageName import (ci.ts:13); biome fails. Fix: import removal added to File Changes. |
| JD-012 (JDA-009) | judgment-day | design.md:58-64→71,166-167,231 | WARNING | fixed | No HOOK_STATE for non-regular file; EISDIR unmodeled (test ci.test.ts:323-334 creates directory). Fix: NOT_A_FILE state + lstat step 0 + matrix row. |
| JD-013 (JDB-004) | judgment-day | design.md:61-64/173→76,229,234 | WARNING | fixed | CRLF-marked hook fails $-anchored marker regex → classifies foreign, but test row asserted managed-edited. Fix: row aligned with algorithm. |
| JD-014 (JDB-013) | judgment-day | design.md:62→74 | SUGGESTION | fixed | Marker name never bound to slot (pre-commit marker in pre-push slot silently overwritten). Fix: name !== hookName → foreign. |
| JD-015 (JDB-015) | judgment-day | design.md:102→247 | SUGGESTION | fixed | Stryker mutates src/constants.ts; HOOK_ASSETS_DIR string mutants unaddressed. Fix: testing-strategy line, classification tests use exported constant. |
| JD-016 (JDA-004) | judgment-day | specs/ci-execution/spec.md:56-57→55-60 | WARNING | fixed | Preserved-order MUST omitted per-runner security phase (ci.ts:880-886). Fix: enumeration completed with skip conditions + MUST-NOT-reorder clause. |

## Round 2 — new findings on fix-touched lines (severity floor: info, non-blocking)

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JDA-R2-001 | judgment-day | design.md:89 | WARNING | info | Forward-maintenance guard "skipped when git history unavailable" — actions/checkout fetch-depth:1 makes it skip exactly in CI. Fold into slice 3 at apply: pure-file guard (historical[] strictly grows when sha256 changes) or pin fetch-depth:0 + fail-on-skip. |
| JDA-R2-002 | judgment-day | design.md:42-43 | SUGGESTION | info | Backup step 3 offers bare fs.copyFile which is neither exclusive nor no-follow; name the safe forms (COPYFILE_EXCL or open "wx" + Buffer write). |
| JDA-R2-003 | judgment-day | specs/ci-execution/spec.md:56-59 | SUGGESTION | info | New security-phase ordering MUST has no scenario and no Testing Strategy row; add configured-runner ordering assertion in slice 2. |

Verified-correct load-bearing claims (both judges, no finding): ensureImage byte-identity (docker.ts:186/221/255), no duplicate docker-image step, FORGE_ROOT ESM resolution, hash round-trip byte-exactness, coverage floors honored, Stryker does not mutate ci.ts, compat anchor ci.test.ts:767-787.
