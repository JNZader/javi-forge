# Apply Progress — skillguard-runtime-gate

Branch `feat/skillguard-runtime-gate` (base `main` @ `24661957`). Strict TDD mode. Single PR with `size:exception`, work-unit commits.

## Phase 1 — Scanner foundation (DONE)

| Task | Status | Evidence |
|------|--------|----------|
| 1.1 `SkillCoverageScan` + `scanSkillsWithCoverage` | DONE | RED: 11 new tests failed (`scanSkillsWithCoverage is not a function`); GREEN: 66 pass; TRIANGULATE: +2 containment tests (escapes/absolute → rejects); final 68/68. Commit `3248a167` |
| 1.2 `scanSkillsDirectory` unchanged | DONE | Diff is purely additive (440 insertions, 0 deletions); historical behavior intact |
| 1.3 coverage-walk fixtures | DONE | 13 new tests: declared/undeclared split incl. `node_modules`/`.git` visited (JD-007); PLUGIN.md/README excluded (JD-002); symlinked file flagged with target never read; dangling symlink no crash; symlinked dir subtree not enumerated; recursive symlink terminates; undeclared content never scanned (JD-005); missing declared → unscannable; empty tree; declared-path containment (JD-003) |

## Notes

- `resolveContained`: lexical (`..`, absolute) + realpath containment for declared entries; throws → caller denies (mirrors D7 scanner-throw rule).
- Declared results scanned in declared order (deterministic reports); symlinked declared file skipped from scanning (already in `symlinks`, caller refuses first).
- Safety net after Phase 1: 5 files / 191 tests pass (178 baseline + 13 new). `pnpm typecheck`, `typecheck:test`, `lint` clean (1 pre-existing warning in `ci-hooks.test.ts`, unrelated).
- JD-010 respected: no test asserts absence of `.git`.