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

## Phase 1 — Scanner foundation (DONE)

| Task | Status | Evidence |
|------|--------|----------|
| 1.1 `SkillCoverageScan` + `scanSkillsWithCoverage` | DONE | RED: 11 new tests failed (`scanSkillsWithCoverage is not a function`); GREEN: 66 pass; TRIANGULATE: +2 containment tests (escapes/absolute → rejects); final 68/68. Commit `3248a167` |
| 1.2 `scanSkillsDirectory` unchanged | DONE | Diff is purely additive (440 insertions, 0 deletions); historical behavior intact |
| 1.3 coverage-walk fixtures | DONE | 13 new tests: declared/undeclared split incl. `node_modules`/`.git` visited (JD-007); PLUGIN.md/README excluded (JD-002); symlinked file flagged with target never read; dangling symlink no crash; symlinked dir subtree not enumerated; recursive symlink terminates; undeclared content never scanned (JD-005); missing declared → unscannable; empty tree; declared-path containment (JD-003) |

## Notes

- Safety net after Phase 3.2: 96 files / 1755 pass + 2 pre-existing skips; `pnpm typecheck`, `typecheck:test`, `lint` clean (1 pre-existing warning in `ci-hooks.test.ts`, unrelated).
- S3/S4 gate pattern: refuse BEFORE any destructive step (remove/move/copy) so prior install survives refusal; scanner/eval throw → deny `"skillguard scan failed — …"` (D7); dryRun early-returns before scan (import/plugin) — auto-install dryRun still scans (D4).
- `resolveContained`: lexical (`..`, absolute) + realpath containment for declared entries; throws → caller denies (mirrors D7 scanner-throw rule).
- Declared results scanned in declared order (deterministic reports); symlinked declared file skipped from scanning (already in `symlinks`, caller refuses first).
- JD-010 respected: no test asserts absence of `.git`.