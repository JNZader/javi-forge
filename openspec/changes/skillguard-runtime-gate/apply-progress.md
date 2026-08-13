# Apply Progress — skillguard-runtime-gate

Branch `feat/skillguard-runtime-gate` (base `main` @ `24661957`). Strict TDD mode. Single PR with `size:exception`, work-unit commits.

## Phase 2 — Shared gate helper (DONE)

| Task | Status | Evidence |
|------|--------|----------|
| 2.1 `evaluateInstallGate` pure module | DONE | RED: 9 tests failed (module missing); GREEN: 9 pass; TRIANGULATE: +1 force-lift test; final 10/10. Commit `d861351b` |
| 2.2 shared-gate suite | DONE | 10 tests (real fs fixtures, no safe-read mock): gate rule `allowed = !hasBlock && (rejected.length === 0 \|\| force)`; block always refuses; force lifts only unscannable |

## Phase 3 — Install gates (DONE)

| Task | Status | Evidence |
|------|--------|----------|
| 3.1 plugin.ts add gate | DONE | RED: 8 gate tests + scanner double (importOriginal); GREEN: 59/59; gate before existing-remove/`fs.move`; force on options; dryRun skips. Commit `1fedc2ab` |
| 3.2 agent-skills.ts import gate | DONE | RED: 7 gate tests (2 JD-006 validation + 5 gate), 1 existing `skills: []`→success test updated to refusal contract; GREEN: 47/47; `skillPathContained` helper (lexical+realpath); gate before `fs.remove`/`fs.copy`; refused imports preserve install. Commit `9a089281` |
| 3.3 auto-skill-install.ts gate | DONE | RED: 5 gate tests + 1 blocked-summary test (14 total); GREEN: 14/14; classify→scan→copy split; `blocked: SkillScanResult[]` + `force` on options; dryRun still scans; sameDir short-circuits before scan. Commit `c7d560fd` |

## Phase 4 — CLI force wiring (DONE)

| Task | Status | Evidence |
|------|--------|----------|
| 4.1 commands/plugin.ts | DONE | `runPluginAdd` trailing `options: { force?: boolean } = {}` → `installPlugin({ dryRun, force })`; `runPluginImport` 4th arg `force = false` → `importAgentSkillsPackage({ dryRun, force })`; existing 3-arg callers compile unchanged |
| 4.2 renderers | DONE | simple-renderers.tsx `<Plugin force={cli.flags.force}>`; skills-cmd.tsx `<AutoSkills force={cli.flags.force}>`; reuses global `--force` schema (help.ts:199, untouched) |
| 4.3 UI props | DONE | Plugin.tsx `force` prop → `runPluginAdd(..., { force })` / `runPluginImport(..., force)` + effect dep; AutoSkills.tsx `force` prop → `autoInstallSkills({ force })` + blocked section rendered via `formatScanReport` per blocked skill (✗ name — refused + report) |
| 4.4 help.ts | DONE | New "SkillGuard install gate" section: block always refused; unscannable refused unless `--force`; symlinks/undeclared/empty-skills refused even with `--force`; example `plugin add org/repo --force` (backticks escaped inside template literal) |
| 4.5 Refusal contract | DONE | plugin error: `"skillguard: install refused — N rejected (B blocked, U unscannable)"` + `formatBatchReport` (S3); auto: `blocked: SkillScanResult[]` + UI section (S5/S6); manifest-integrity refusals name offending paths via `.symlinks`/`.undeclared`; exit code UNCHANGED (V-2 follow-up untouched) |

## Phase 5 — Tests (DONE)

| Task | Status | Evidence |
|------|--------|----------|
| 5.1 plugin.test.ts | DONE (S3) | scanner double via importOriginal; 8 gate cases: block refused / force+block refused / scanner throw denied (with force) / clean byte-identical / undeclared incl. node_modules refused / ANY symlink refused, target never read / PLUGIN.md allowed / dryRun no scan; JD-010 clean-install asserts success (root `.git` present) |
| 5.2 auto-skill-install.test.ts | DONE (S5) | scanner mock (default pass via importOriginal, real gate); gate cases: block → installed:[] + copy not called + blocked lists it; unscannable refuses/force permits; scan-throw rejects; dryRun still scans; sameDir no scan |
| 5.3 agent-skills.test.ts | DONE (S4) | 7 gate tests + 2 JD-006 validation refusals; block before fs.remove/fs.copy; skills:[]/missing refused; undeclared/node_modules refused; symlinked refused (force never lifts); force+unscannable proceeds; scanner throw denies; dryRun no scan; clean byte-identical. **Correction (fix round F1, JD-012)**: the "containment (../../, absolute)" claim in this row was FALSE before F1 — no import-entrypoint containment test existed then (only scanner-level containment in S1); those tests were ADDED in F1 |
| 5.4 skill-scanner.test.ts | DONE (S1) | 13 coverage-walk tests: declared/undeclared split incl. node_modules/.git visited; PLUGIN.md/README excluded; symlinked file/dir flagged never dereferenced; dangling + recursive symlink terminate; missing declared → unscannable; containment of declared paths |
| 5.5 commands/plugin.test.ts | DONE (S6) | +2 tests: force threaded to `installPlugin({ dryRun, force })` and `importAgentSkillsPackage({ dryRun, force })`; 3-arg callers compile unchanged |
| 5.6 gate integration + coverage | DONE | skill-install-gate.test.ts uses real SAFE/WARN/MALICIOUS/binary-blob fixtures → real verdicts → evaluateInstallGate per class; recursive-symlink fixture covered at walk level (S1); `pnpm test --coverage`: Lines 90.81% / Branches 82.02% — above the 85/80 floors |

## Phase 6 — Docs / rollout (DONE)

| Task | Status | Evidence |
|------|--------|----------|
| 6.1 design.md Migration wording | DONE | Wording already names the strictness: "packages MUST NOT ship symlinks (any symlink → refused, force never lifts)"; imports require non-empty `skills`; undeclared/`node_modules`/`.git` SKILL.md refused with paths named. design.md left untouched (read-only); code + comments mirror the policy verbatim — no weakening |

## Phase 1 — Scanner foundation (DONE)

| Task | Status | Evidence |
|------|--------|----------|
| 1.1 `SkillCoverageScan` + `scanSkillsWithCoverage` | DONE | RED: 11 new tests failed (`scanSkillsWithCoverage is not a function`); GREEN: 66 pass; TRIANGULATE: +2 containment tests (escapes/absolute → rejects); final 68/68. Commit `3248a167` |
| 1.2 `scanSkillsDirectory` unchanged | DONE | Diff is purely additive (440 insertions, 0 deletions); historical behavior intact |
| 1.3 coverage-walk fixtures | DONE | 13 new tests: declared/undeclared split incl. `node_modules`/`.git` visited (JD-007); PLUGIN.md/README excluded (JD-002); symlinked file flagged with target never read; dangling symlink no crash; symlinked dir subtree not enumerated; recursive symlink terminates; undeclared content never scanned (JD-005); missing declared → unscannable; empty tree; declared-path containment (JD-003) |

## Notes

- **ALL 20 TASKS COMPLETE** — commits: `3248a167` (S1), `d861351b` (S2), `1fedc2ab` (S3), `9a089281` (S4), `c7d560fd` (S5), `7efb1e3d` (S6). Safety net: 96 files / 1763 pass + 2 pre-existing skips; coverage Lines 90.81% / Branches 82.02% (floors 85/80); `pnpm typecheck`, `typecheck:test`, `lint` clean (1 pre-existing warning in `ci-hooks.test.ts`, unrelated).
- ELIFECYCLE noise in ci.test.ts (eslint not found in temp scaffold) is PRE-EXISTING on main (verified via worktree) — not a regression; file passes 148/148.
- S3/S4/S5 gate pattern: refuse BEFORE any destructive step (remove/move/copy) so prior install survives refusal; scanner/eval throw → deny `"skillguard scan failed — …"` (D7); dryRun early-returns before scan (plugin/import) — auto-install dryRun still scans (D4).
- `resolveContained`: lexical (`..`, absolute) + realpath containment for declared entries; throws → caller denies (mirrors D7 scanner-throw rule).
- Declared results scanned in declared order (deterministic reports); symlinked declared file skipped from scanning (already in `symlinks`, caller refuses first).
- JD-010 respected: no test asserts absence of `.git`.
- JD-008 respected: help.ts + code comments name the strictness tradeoff ("force never lifts"); design.md untouched.

## Next

- Phase 6 verification per sdd-verify: run spec scenarios against implementation, then the structured Result Contract report; single PR with `size:exception` (work-unit commits already in place).

## Fix Round F1 — implementation-judgment findings (JD-011/012/013/014/103)

User-authorized surgical fix round on the implementation (post-apply judgment, both judges). No spec/design change; all fixes keep D1–D11 semantics (force lifts ONLY unscannable; manifest-integrity refusals remain block-level, force never lifts; scanner throw denies; exit code unchanged).

| Finding | Fix | Evidence |
|---------|-----|----------|
| JD-011 (WARNING, real) — case-mismatch force-proof lockout | `scanSkillsWithCoverage` seeds `declaredFiles` with BOTH basenames (`SKILL.md` + `skill.md`) and resolves the declared file case-tolerantly (`declaredSkillFileOnDisk`), so a declared skill whose on-disk file is lowercase `skill.md` is recognized as declared and scanned — never pushed to `undeclared` (which is block-level and force-proof) nor reported `unscannable`. Files NOT inside a declared dir still miss the set → lowercase-as-undeclared refusal preserved | `src/lib/skill-scanner.ts`; test `treats a declared lowercase skill.md as declared and scans it — not undeclared (JD-011)` (skill-scanner.test.ts) |
| JD-012 (WARNING, real) — containment + sameDir test gaps, false apply-progress claim | (a) import-entrypoint containment fixtures in agent-skills.test.ts: declared `path: "../../outside"` and absolute → `success:false`, error mentions escape, `scanSkillsWithCoverage` + `fs.copy` never called (binds JD-003 at the import entrypoint); realpath containment branch exercised with non-identity realpath mock (escape → refused "(realpath)"). (b) sameDir "scanner never called" assertion added to auto-skill-install.test.ts. (c) apply-progress §5.3 false claim corrected (containment tests ADDED in F1) | `src/lib/agent-skills.test.ts`, `src/lib/auto-skill-install.test.ts`, `openspec/changes/skillguard-runtime-gate/apply-progress.md` |
| JD-013 (WARNING, theoretical) — walk swallows I/O errors | `SkillCoverageScan.errors: string[]` records failing paths on realpath/readdir/lstat failure instead of silent `return`/`continue`; both gate call sites (plugin.ts, agent-skills.ts) refuse on `errors.length > 0` FIRST (walk incomplete cannot certify footprint; manifest-integrity, force never lifts). EACCES simulated with a spy on fs (chmod-000 unreliable on privileged runners/ACLs — comment in test) | `src/lib/skill-scanner.ts`, `src/lib/plugin.ts`, `src/lib/agent-skills.ts`; walk tests + call-site refusal tests in skill-scanner.test.ts / plugin.test.ts / agent-skills.test.ts |
| JD-014 (SUGGESTION) — report undercount | `formatBatchReport` now receives the FULL declared set (`coverage.declared` / hoisted `declaredResults`) so header "Scanned: N" and rows reflect every scanned skill; the lead line still names the rejected count (D6) | `src/lib/plugin.ts`, `src/lib/agent-skills.ts` |
| JD-103 (SUGGESTION) — vacuous existing-install-preserved test | Dedicated import-refusal test makes `pathExists(PLUGINS_DIR/imported-skill)` TRUE and asserts BOTH `fs.remove` and `fs.copy` never called — genuinely binds "existing install preserved on refused import" | `src/lib/agent-skills.test.ts` |

**F1 results**: `pnpm test` (real exit code) — **96 files / 1772 pass / 2 pre-existing skips** (baseline 1763 + 9 new tests); `pnpm typecheck`, `pnpm typecheck:test`, `pnpm lint` clean (exit 0; 1 pre-existing unrelated warning in `ci-hooks.test.ts`). Ledger statuses JD-011/012/013/014/103 → `fixed`.

## Fix Round F2 — pre-PR full 4R review findings (R1-001/R3-001/R4-001, R1-002, R3-003)

User-authorized surgical fix round after the pre-PR full 4R review (ledger §"Pre-PR full 4R review"). No spec/design change; all fixes keep D1–D11 semantics (force lifts ONLY unscannable; manifest-integrity refusals remain block-level, force never lifts; scanner throw denies; exit code unchanged). Info-only findings (R2-001/002/003 duplication, R3-002 residual, R4-002 exit-code bound) untouched — never block, not part of this round.

| Finding | Fix | Evidence |
|---------|-----|----------|
| R1-001 / R3-001 / R4-001 (WARNING, real, empirically verified) — case-variant lockout: declared-membership exact-case while the walk collects case-insensitively → any non-`SKILL.md`/`skill.md` fold of a DECLARED skill lands `undeclared` (block-level, force never lifts) while its declared scan reports `unscannable` | Declared-membership is now decided by the declared DIRECTORY (`declaredDirAbs` = resolved declared dirs; walk checks `declaredDirAbs.has(path.dirname(resolved))`), so ANY case fold of a declared skill file is declared and scanned — never `undeclared`; `declaredSkillFileOnDisk` resolves any fold via a case-insensitive `readdir` fallback after the canonical/lowercase probes. CASE3 preserved: a skill-shaped file outside a declared dir still misses the set → `undeclared` (smuggling refusal intact). Symlink skip on the resolved path and fail-closed `unscannable` on a truly missing declared file unchanged | `src/lib/skill-scanner.ts`; tests in skill-scanner.test.ts: `it.each(["Skill.md","SKILL.MD","skill.MD"])` → `declared` (verdict pass), `undeclared: []`, no errors/symlinks; `still refuses a non-canonical-case skill.md OUTSIDE a declared dir as undeclared (CASE3 preserved)` |
| R1-002 (WARNING, pre-existing on main, PR-adjacent) — `plugin import` computes `destDir = path.join(PLUGINS_DIR, agentManifest.name)` with NO name validation then `fs.remove`+`fs.copy` → hostile `skills.json` name (`"../../.bashrc"`, absolute, separator-bearing) performs arbitrary-path delete/copy outside PLUGINS_DIR | `importAgentSkillsPackage` validates `agentManifest.name` right after the required-fields check, BEFORE any `destDir` use / `fs.remove` / `fs.copy`: rejects absolute, `/`/`\` separators, `..`, empty/`.`/`..`-shaped (incl. whitespace-only) → `skillguard: install refused — invalid manifest name "…" (manifest-integrity, force never lifts)`, `success:false`; same-trust comment: name is attacker-influenced when installing from a registry package | `src/lib/agent-skills.ts`; test in agent-skills.test.ts: `it.each([../../escape, /abs/path, a/b, a\b, .., ., whitespace])` with `pathExists` true for skills.json AND the would-be destDir → refused, `fs.remove`+`fs.copy` never called (existing install genuinely preserved) |
| R3-003 (WARNING, pre-existing config) — no forbidOnly: CI and local runs pass with a committed `test.only`/`describe.only` | `vitest.config.ts` test config gains `allowOnly: false`. NOTE (verified empirically against vitest 4.1.6): the jest-style `forbidOnly` key does NOT exist in vitest 4 — it is silently ignored and `.only` still passes with it; the effective key is `allowOnly: false` (default is `!process.env.CI`, so local runs would let `.only` through). Config-level is the authoritative fix — ci.yml untouched (`test:coverage` uses the same config); a suite without `.only` runs identically | `vitest.config.ts`; probe: `it.only` fixture failed (exit 1) with `allowOnly: false` locally and in CI-env; passed (exit 0) with the inert `forbidOnly` key and with the default local config |

**F2 results (real exit codes)**: `pnpm test` — **96 files / 1783 pass / 2 pre-existing skips** (F1 baseline 1772 + 11 new tests: 4 coverage-walk case-fold + 7 name-validation); `pnpm typecheck` 0; `pnpm typecheck:test` 0; `pnpm lint` 0 (1 pre-existing unrelated warning `ci-hooks.test.ts:1171`); `pnpm build` 0; pre-commit CI on all 4 commits. Commits: `d073716d` (case-variant fix), `cb8b49db` (vitest forbidOnly/allowOnly), `7d275839` (manifest name validation), plus docs commit (ledger statuses + this section). Ledger statuses R1-001/R3-001/R4-001, R1-002, R3-003 → `fixed`; no new ledger rows (no new problem surfaced).

## Fix Round F3 — R1-F2-N1 (dir-name case fold lockout) + R1-F2-N2 (typeof guard)

User-authorized surgical fix round (F3, the third override of the same case-lockout class) on the F2 info registrations. No spec/design change; D1–D11 semantics unchanged (force lifts ONLY unscannable; manifest-integrity refusals remain block-level, force never lifts; scanner throw denies; exit code unchanged).

| Finding | Fix | Evidence |
|---------|-----|----------|
| R1-F2-N1 (WARNING, real, verified live) — DIR-NAME case fold lockout: declared-dir membership retained manifest case while the walk sees real on-disk dirnames → `skills/Alpha` declared vs disk `skills/alpha` → file `undeclared` (block-level, force never lifts) + declared scan `unscannable`; third instance of the case-lockout class (JD-011 file → R1-001 file-fold → dir-name fold) | `scanSkillsWithCoverage` makes declared-dir membership case-insensitive on the DIRECTORY name: walk-side check compares lowercased paths (`declaredDirAbsLower`; `path.dirname(resolved).toLowerCase()`); scan-side resolves each declared dir to the REAL on-disk dir the walk visited (exact-case real dir → case-fold match → manifest-path fallback keeps a truly-missing declared dir fail-closed `unscannable`), and only the real path is handed to `declaredSkillFileOnDisk`/`scanSkillFile` (no invented casing for file access). Preserved: CASE3 (outside ANY declared dir — any casing — still `undeclared`), symlink skip on the resolved path, fail-closed `unscannable`, cross-platform determinism (case-insensitive FS: lowercasing is a no-op) | `src/lib/skill-scanner.ts`; test in skill-scanner.test.ts `treats a declared dir whose on-disk NAME differs in case as declared and scans its real path — not undeclared (R1-F2-N1)`: declares `skills/Alpha`+`skills/beta`, disk `skills/alpha`+`skills/beta` → both declared scans `pass` reading the real on-disk paths, `undeclared: []`, `symlinks: []`, `errors: []`; RED pre-fix repro verified live (undeclared caught `.../skills/alpha/SKILL.md`); CASE3 `evil/Skill.md` test kept + passing |
| R1-F2-N2 (WARNING, cosmetic) — non-string manifest `name` (`{"name":123}`) crashed with a TypeError on `.trim()` instead of a clean refusal (surfaced as UI "Fatal error"; install still refused, zero fs mutation) | `importAgentSkillsPackage` guards `typeof pluginName !== "string"` BEFORE the `.trim()` check → refuses with the same `invalid manifest name (manifest-integrity, force never lifts)` message, `success:false`, no fs mutation | `src/lib/agent-skills.ts`; test in agent-skills.test.ts `refuses a non-string manifest name (a number) cleanly — no TypeError, no remove/copy (R1-F2-N2)` with `pathExists` true for the would-be destDir (non-vacuous: a regression would fire `fs.remove` and fail) |

**F3 results (real exit codes)**: `pnpm test` — **96 files / 1785 pass / 2 pre-existing skips** (F2 baseline 1783 + 2 new tests); `pnpm typecheck` 0; `pnpm typecheck:test` 0; `pnpm lint` 0 (1 pre-existing unrelated warning `ci-hooks.test.ts:1171`); `pnpm build` 0; pre-commit CI (lint+build) on both code commits. Commits: (dir-name case fold fix), (typeof name guard), plus docs commit (ledger statuses R1-F2-N1/R1-F2-N2 → `fixed` + this section). No new ledger rows. Carried residual REPORTED (not logged): case-variant twin dirs on a case-sensitive FS (declared `skills/alpha` + undeclared sibling `skills/Alpha`) now pass membership — same documented family as R3-002/JD-F1-N1 (inert: no runtime consumer reads the twin; declared scan prefers the exact-case real dir).