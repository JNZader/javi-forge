# Verification Report — skillguard-runtime-gate

**Change**: skillguard-runtime-gate
**Branch**: `feat/skillguard-runtime-gate` (10 commits, base `main` @ `24661957`)
**Verifier**: sdd-verify phase agent · Strict TDD Mode (strict-tdd.md / strict-tdd-verify.md)
**Date**: 2026-08-13
**Artifact store**: hybrid (openspec file + engram topic `sdd/skillguard-runtime-gate/verify-report`)

---

## Executive Summary

**VERDICT: PASS** — implementation satisfies the spec (12/12 scenarios bound by passing tests), all 20 tasks are genuinely implemented, the suite is green, coverage is above the enforced floors, and fail-closed semantics are intact (live-verified: `block` refuses even with `--force`; `--force` lifts only `unscannable`; symlink/undeclared/undeclared-lowercase/escape/error refusals are block-level at the call sites, force-proof). The 5 F1 fix-round findings (JD-011/012/013/014/103) are verified fixed in the code and bound by new tests. All implementation-judgment findings from the review ledger are closed; residuals JD-004/JD-009/JD-F1-N1 persist only as documented info notes (no spec violation).

Findings: 0 CRITICAL, 3 WARNING (V-001 uncommitted ledger doc change; V-002 pre-existing per-file coverage dip in commands/plugin.ts not caused by this change; V-003 TDD evidence reported inline rather than a canonical TDD Cycle Evidence table), 3 SUGGESTION (V-004/JD-009 residual, V-005/JD-F1-N1 residual, V-006 UI components excluded from coverage config — all pre-existing/documented).

---

## Completeness (tasks)

| Metric | Value |
|--------|-------|
| Tasks total | 20 |
| Tasks complete | 20 |
| Tasks incomplete | 0 |

All 20 tasks (phases 1.1–6.1) verified: implementation code exists AND tests exist AND pass for every task (matrix in §"Tasks → Implementation → Tests"). The F1 fix round (JD-011..JD-103) is part of the implementation under verification and is verified fixed.

---

## Execution Evidence (real exit codes, no pipe masking)

### Tests — `pnpm test`
```
 Test Files  96 passed (96)
      Tests  1772 passed | 2 skipped (1774)
EXIT_CODE=0
```
⚠ 1772 pass / 2 pre-existing skips — matches apply-progress (baseline 1763 + 9 F1 tests). ELIFECYCLE noise in the output is the pre-existing temp-scaffold artifact in `ci.test.ts` (eslint missing in scaffold; documented on main) — not a regression.

### Quality gates
| Command | Exit | Result |
|---------|------|--------|
| `pnpm typecheck` | 0 | ✅ clean |
| `pnpm typecheck:test` | 0 | ✅ clean |
| `pnpm lint` | 0 | ✅ clean (1 pre-existing warning `ci-hooks.test.ts:1171` — unrelated, not touched by this change) |

### Coverage — `pnpm test:coverage`
```
All files   | % Stmts 90.45 | % Branch 82.16 | % Funcs 91.37 | % Lines 90.92
Lines 90.92%  (floor 85)  ✅ above
Branches 82.16% (floor 80) ✅ above
```
(apply-progress reported 90.81/82.02 — run variance, both above floors.)

### Targeted gate-file runs — `npx vitest run` (6 files)
```
 Test Files  6 passed (6)
      Tests  235 passed (235)
```
skill-install-gate, skill-scanner, plugin, agent-skills, auto-skill-install, commands/plugin test files — all green individually.

### Live spot-check (real tmpdir fixtures, tsx repro, 25/25 assertions pass, exit 0)
Driven `evaluateInstallGate` + `scanSkillsWithCoverage` + call-site refusal strings against freshly built malicious fixtures:
- gate rule: pass/warn/empty allowed; block refused even with force; unscannable refused w/o force, allowed with force; block+unscannable+force still refused; rejected list populated ✅
- `docs/evil/SKILL.md` → flagged `undeclared` (declared set respected, undeclared content never scanned — 1 declared result only) ✅
- `node_modules/evilpkg/SKILL.md` → flagged `undeclared` (JD-007 a) ✅
- `.git/objects/SKILL.md` → flagged `undeclared` (walk has no exemptions) ✅
- symlinked SKILL.md → flagged in `symlinks`, target (outside tree, would scan block) NEVER read ✅
- lowercase undeclared `skill.md` → flagged `undeclared` (CASE3 preserved) ✅
- declared lowercase `skill.md` → scanned as declared, NOT undeclared (JD-011 fixed) ✅
- declared path `../../outside` → rejected (containment, JD-003) ✅
- call-site strings: plugin.ts + agent-skills.ts refuse symlinks/undeclared with "force never lifts" ✅

---

## Spec Compliance Matrix (12 scenarios → implementation → tests)

Every scenario bound by a test that PASSED in this verification run.

| Req | Scenario | Implementation | Test (file:line) | Result |
|-----|----------|----------------|------------------|--------|
| R1 | S1 block refuses the install | `installPlugin` gate pre-placement (plugin.ts:190-256; refusal before remove/move, finally cleans staging) | `plugin.test.ts:412` "refuses when a declared skill blocks — nothing lands, staging removed" (move not called, remove called, `[BLOCK]` in error) | ✅ COMPLIANT |
| R1 | S2 unscannable refuses (fail-closed) | same gate; `isRejectedVerdict` includes `unscannable` | `plugin.test.ts:449` refused branch (success:false, "1 unscannable", move not called) | ✅ COMPLIANT |
| R1 | S3 force bypasses unscannable only | `evaluateInstallGate(results,{force})` — `allowed = !hasBlock && (rejected.length===0 \|\| force)` (skill-install-gate.ts:40) | `plugin.test.ts:449` forced branch (success:true, move called) | ✅ COMPLIANT |
| R1 | S4 force never bypasses block | `hasBlock` dominates the rule | `plugin.test.ts:470` "force does NOT lift a block verdict" (success:false, move not called) | ✅ COMPLIANT |
| R1 | S5 scanner error denies even with force | call-site try/catch → `"skillguard scan failed — …"` (plugin.ts:239-245; D7) | `plugin.test.ts:485` "denies when the scan throws — even with force (D7)"; also `agent-skills.test.ts:536`, `auto-skill-install.test.ts:258` | ✅ COMPLIANT |
| R1 | S6 clean skill installs unchanged | declared pass/warn + coverage clean → proceeds to remove+move | `plugin.test.ts:495` "installs byte-identically…" (success, move called); `plugin.test.ts:544` pass+warn both install | ✅ COMPLIANT |
| R2 | S7 block in the batch refuses everything | auto-install 3-pass restructure: classify → scan-gate copyable → copy (auto-skill-install.ts:78-150); any block ⇒ `installed: []` + `blocked` | `auto-skill-install.test.ts:197` "refuses to install ANYTHING when a copyable skill blocks — nothing copied (D4)" (copy not called, installed empty, blocked lists it) | ✅ COMPLIANT |
| R2 | S8 unscannable refuses unless force | same gate; force lifts only unscannable | `auto-skill-install.test.ts:217` (refused w/o force, nothing copied) + `:238` (allowed w/ force) | ✅ COMPLIANT |
| R2 | S9 sameDir source equals target unchanged | sameDir short-circuits BEFORE scanning (auto-skill-install.ts:82-88; wired AutoSkills.tsx:31-36) | `auto-skill-install.test.ts:73` "reports all skills as skipped when source and target are the same" + scanner-not-called assertion (JD-012) | ✅ COMPLIANT |
| R3 | S10 plugin refusal carries the scan report | refusal error = lead line + `formatBatchReport(declaredResults)` (plugin.ts:246-255; JD-014 full declared set) | `plugin.test.ts:412-426` asserts `[BLOCK]` + "1 rejected"/"1 blocked" (formatBatchReport output) | ✅ COMPLIANT |
| R3 | S11 auto-install refusal lists each blocked skill | `blocked: SkillScanResult[]` on result + `formatScanReport` per skill in UI blocked section (AutoSkills.tsx:186-210) | `auto-skill-install.test.ts:328` "lists blocked skills and their verdicts"; summary format test | ✅ COMPLIANT |
| R4 | S12 unmocked real-fs fixtures drive verdicts | `skill-install-gate.test.ts` (new) — mkdtemp, real SAFE/WARN/MALICIOUS/binary fixtures via `scanSkillFile` as-is, NO safe-read mock | `skill-install-gate.test.ts:52-168` (10 tests: verdicts first, then gate rule per class) | ✅ COMPLIANT |

**Compliance summary: 12/12 scenarios COMPLIANT** (0 failing, 0 untested, 0 partial).

Additional gate surface bound by tests (design D8, JD-001): `plugin import` promoted to gated — `agent-skills.test.ts:315/:335` (empty/missing `skills` refused at validation), `:393` (block refused BEFORE fs.remove/fs.copy, existing install preserved), `:412` (JD-103: pathExists(destDir)→true, remove+copy never called), `:444` (undeclared incl. node_modules refused, force never lifts), `:464` (ANY symlink refused), `:483` (JD-013 errors[] refusal), `:504` (force+unscannable proceeds / force+block refused), `:536` (throw denies even with force), `:578` (realpath-escape containment, non-identity mock), `:608` (dryRun no scan), `:619` (clean byte-identical import).

---

## Correctness (static — structural evidence)

| Requirement | Status | Notes |
|------------|--------|-------|
| R1 plugin add gates placement on scan | ✅ Implemented | Gate after destDir (:190), before existing-remove/fs.move; `if (!dryRun)` no-op; finally cleans staging; undeclared/symlink/errors = block-level call-site refusals (force never lifts) |
| R2 skills auto-install gates pre-copy | ✅ Implemented | classify→scan→copy; `blocked` field additive; dryRun scans but copies nothing; sameDir short-circuits |
| R3 refusal output reuses scanner reports | ✅ Implemented | plugin: lead line + formatBatchReport(full declared set); auto: blockeds + formatScanReport in UI |
| R4 gate tests use real fixtures, no safe-read mock | ✅ Implemented | skill-install-gate.test.ts + skill-scanner.test.ts real tmpdir fixtures; spies only for deterministic EACCES (documented rationale) |

## Coherence (design D1–D11)

| Decision | Followed? | Evidence |
|----------|-----------|----------|
| D1 scan shape: declared-scan + SKILL.md-only coverage walk | ✅ | `scanSkillsWithCoverage` (skill-scanner.ts), declared = manifest.skills → `skills/<name>` |
| D2 shared pure `evaluateInstallGate` | ✅ | skill-install-gate.ts (42 lines, imports only `isRejectedVerdict`, no fs) |
| D3 gate placement plugin.add | ✅ | plugin.ts:190-256 before remove(:260)/move(:263) |
| D4 auto-install 3-pass restructure | ✅ | auto-skill-install.ts classify/scan-gate/copy; blocked field; dryRun scans; sameDir short-circuit |
| D5 force wiring (additive, CLI threading, help) | ✅ | options `{force?}` on all three entrypoints; simple-renderers.tsx / skills-cmd.tsx pass `cli.flags.force`; Plugin.tsx / AutoSkills.tsx thread; help.ts documents bound; 3-arg callers unchanged |
| D6 refusal output | ✅ | lead line + `formatBatchReport` (full declared set — JD-014); auto text = `formatScanReport` joined; exit code unchanged |
| D7 error contract | ✅ | `"skillguard scan failed — {msg}"` on throw, with and without force |
| D8 plugin import gate | ✅ | non-empty skills validation + name/path validation + realpath containment (agent-skills.ts:133-180); gate before fs.remove/fs.copy; existing install preserved |
| D9 symlink-safe walk | ✅ | lstat + realpath visited-set + resolveContained/skillPathContained containment; recursive symlink terminates |
| D10 skill-scanner.ts Modified + one new export | ✅ | diff additive (440 insertions / 0 deletions); scanSkillsDirectory latent unchanged; `scanSkillsWithCoverage` new export |
| D11 no subtree exemptions + ANY symlink refusal | ✅ | walk visits node_modules/.git (JD-007 a); any symlink → `symlinks[]` → block-level call-site refusal (JD-007 b) |

No rejected alternative accidentally implemented. File changes match the design table (24 files, +2542/−23).

---

## TDD Compliance (Strict TDD Mode)

| Check | Result | Details |
|-------|--------|---------|
| TDD evidence reported | ⚠️ (inline) | apply-progress.md reports RED/GREEN/TRIANGULATE per phase in the Evidence column (e.g. "RED: 9 tests failed (module missing); GREEN: 9 pass; TRIANGULATE: +1 force-lift test") — NOT as a canonical 5-column "TDD Cycle Evidence" table. Evidence content is present and was cross-verified against the actual test files and this run → V-003 |
| All tasks have tests | ✅ | 20/20 tasks backed by test files that pass |
| RED confirmed (test files exist) | ✅ | all gate test files exist (skill-install-gate.test.ts new; 5 modified suites) |
| GREEN confirmed (tests pass) | ✅ | 1772 pass / 2 pre-existing skips / exit 0 |
| Triangulation adequate | ✅ | multiple cases per behavior (e.g. gate rule 10 unit cases; walk 13 coverage cases; force semantics asserted at unit + 3 entrypoints) |
| Safety net for modified files | ⚠️ | reported implicitly via suite counts (1763 baseline → 1772 after F1); suites re-run clean in every phase |

Every F1 claim (JD-011/012/013/014/103) was re-executed here: JD-011 live (lowercase declared), JD-012 tests present (`it.each` containment + sameDir assertion), JD-013 spy-based EACCES tests bound + call-site refusals, JD-014 full-declared-set report, JD-103 pathExists-true refusal test — all pass.

### Test Layer Distribution
| Layer | Tests | Files | Notes |
|-------|-------|-------|-------|
| Unit (lib + commands) | 235 in the 6 gate files; 1772 suite-wide | 96 | scanner mocked at entrypoint call sites via importOriginal (real exports kept); gate helper + walk + real-fixture integration unmocked |
| Integration (real fs) | skill-install-gate.test.ts (10), skill-scanner.test.ts walk fixtures | 2 | mkdtemp real fixtures, no safe-read mock (R4) |
| E2E | — | — | not changed; `src/e2e/**` excluded from coverage, UI not e2e-touched by this change |

### Changed File Coverage (per-file, from coverage-final.json)
| File | Line % | Branch % | Rating |
|------|--------|----------|--------|
| `src/lib/skill-install-gate.ts` | 100.00 | 100.00 | ✅ Excellent |
| `src/lib/skill-scanner.ts` | 92.57 | 86.21 | ✅ Excellent |
| `src/lib/plugin.ts` | 97.73 | 92.37 | ✅ Excellent |
| `src/lib/agent-skills.ts` | 97.10 | 92.47 | ✅ Excellent |
| `src/lib/auto-skill-install.ts` | 100.00 | 100.00 | ✅ Excellent |
| `src/commands/plugin.ts` | 84.44 | 78.57 | ⚠️ Low (pre-existing) — uncovered L76-89 are `runPluginRemove`/`runPluginList`, untouched by this change; every changed force-threading line (L37-45, L293/303 region) is covered → V-002 |
| `src/ui/*`, `src/cli/dispatch/*` | excluded | — | vitest coverage config excludes `src/ui/**` (pre-existing); renderers 0% (TUI components, e2e-excluded) → V-006 |

**Aggregate**: Lines 90.92% / Branches 82.16% — above thresholds. No changed file < 80% for code written by this change.

### Assertion Quality
**✅ All assertions verify real behavior** — no tautologies, no ghost loops, no type-only-only assertions, no smoke-only tests. Gate tests assert concrete outcomes (`success` flag, exact error substrings, `move`/`copy`/`remove` call state, verdict values). Mock hygiene: plugin.test.ts (fs-extra + child_process + auto-wire + scanner importOriginal — pre-existing fs double extended); auto-skill-install.test.ts (3 mocks, real gate preserved via `...actual`); skill-install-gate.test.ts = zero mocks. EACCES determinism uses spies with documented rationale (chmod-000 unreliable on privileged runners).

### Quality Metrics
**Linter**: ✅ 0 errors / 1 warning (pre-existing `ci-hooks.test.ts:1171`, unrelated) · **Type Checker**: ✅ clean (src + tests)

---

## Issues Found

**CRITICAL** (must fix before archive): None.

**WARNING** (should fix):
- **V-001** — location: `openspec/changes/skillguard-runtime-gate/review-ledger.md` (working tree). The F1 ledger section (Fix Round F1 + re-review + JD-F1-N1) is an UNCOMMITTED modification on the branch ("clean tree" claim is off by one docs file; commit `35d77446` carried F1 apply-progress/ledger statuses but the ledger's F1 narrative section itself is not in HEAD). Doc-only — no source impact; commit it before the PR so the audit trail ships with the change.
- **V-002** — location: `src/commands/plugin.ts` (coverage 84.44% lines / 78.57% branches). Below the 85/80 floors at file level. NOT a regression: uncovered lines (L76-89) are pre-existing `runPluginRemove`/`runPluginList`, untouched by this change; all changed force-threading lines are covered. Aggregate coverage above floors. Informational per strict-tdd (coverage never blocks).
- **V-003** — location: `openspec/changes/skillguard-runtime-gate/apply-progress.md`. TDD evidence is reported inline per phase, not as the canonical TDD Cycle Evidence table (RED/GREEN/TRIANGULATE/SAFETY NET/REFACTOR columns). Content is present and was cross-verified; format deviation only.

**SUGGESTION** (nice to have):
- **V-004** (registered JD-009, info) — auto-install gate scans only folder-root `SKILL.md` while the copy is whole-folder (`fs.copy`, auto-skill-install.ts:146): a nested `SKILL.md` inside a skill folder lands un-scanned. Documented scope; source is the user's own skills dir; sameDir UI wiring (JD-004) keeps CLI reachability minimal. Keep documented, do not over-claim.
- **V-005** (registered JD-F1-N1, info) — a declared dir shipping both `SKILL.md` (clean) and lowercase `skill.md` (malicious): the lowercase variant installs un-scanned. Deliberate trade of the JD-011 fix; inert (no runtime consumer loads lowercase from PLUGINS_DIR); `node_modules`/undeclared-dir smuggling still fully refused. P-1 residual class.
- **V-006** — coverage config excludes `src/ui/**` (pre-existing): the gate UX (force prop in Plugin.tsx/AutoSkills.tsx, blocked section) is covered only via lib-level tests, not component tests. Pre-existing characteristic, not caused by this change.

---

## Verdict

**PASS** — implementation is complete, correct, and behaviorally compliant with the spec. All 12 scenarios are bound by passing tests; 20/20 tasks genuinely implemented; suite green (1772 pass / 2 pre-existing skips, exit 0); typecheck/lint clean; coverage above floors (90.92/82.16); fail-closed semantics live-verified (block always refuses; force lifts only unscannable; symlink/undeclared/errors/containment refusals block-level, force-proof). Agreed verification gates all met: 12/12 scenarios tested, 20/20 tasks implemented, suite green, coverage above floors, fail-closed semantics intact.

**next_recommended: archive** — no CRITICAL findings; V-001 (commit the ledger doc) can be folded into the PR prep at archive time.