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