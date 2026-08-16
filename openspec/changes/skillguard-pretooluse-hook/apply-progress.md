# Apply Progress — skillguard-pretooluse-hook (Slice 1)
## Completed Tasks
- [x] 1.1-1.6: standalone bounded protocol, manifest identity, cross-platform file path policy, and Work Unit 1A commit.
- [x] 1.7-1.13: distinct Bash/PowerShell corpora, exact spawned-process enforcement, denial-only fault flags, Windows runtime job, static dependency scan, and Work Unit 1B commit.
## Commits
- `213afff9` protocol/path policy; `194ca3d2` shell policy; `f41ea914` / `e236432a` Fix Round 1; `2c20241b` / `f60cc812` Fix Round 2; `73c7fc35` exceptional Fix Round 3.
## Files Changed
| File | Action |
|---|---|
| `.github/workflows/claude-hook-windows.yml` | Created runtime-only Windows validation job |
| `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs` | Created dependency-free packaged evaluator and v1 policy |
| `assets/claude-hooks/manifest.json` | Created runtime manifest with recomputed SHA-256 identity |
| `src/constants.ts` | Added `CLAUDE_HOOK_ASSETS_DIR` |
| `src/__tests__/claude-hook-assets.test.ts`, `src/__integration__/claude-pretooluse-exec.integration.test.ts` | Pure policy corpus and exact-MJS process probes |
## TDD Evidence
| Tasks | Layer | RED | GREEN / REFACTOR |
|---|---|---|---|
| 1.1-1.2 | Unit | Missing constant/asset failed before production existed | 27 protocol/path tests passed; triangulated into final unit corpus |
| 1.7 | Unit | Shell corpus produced 33 expected failures | 67/67 unit tests passed after distinct Bash/PowerShell rules |
| 1.9 | Integration | Exact spawned asset produced 7 expected process-contract failures | 11/11 integration tests passed, including open-writer oversize and fault flags |
| JD Fix Rounds 1-3 | Unit + integration | 18 initial, 11 Round-2, and 11 exact Round-3 spawned failures reproduced | 147/147 focused tests pass with semantic option-family coverage and benign near misses |
## Verification
| Gate | Result |
|---|---|
| Focused runtime suites | PASS — 147/147 |
| `pnpm test` | PASS — 99 files, 1957 passed, 2 skipped |
| `pnpm typecheck`; `pnpm typecheck:test` | PASS |
| `pnpm lint` | PASS with one pre-existing unused-suppression warning in `src/commands/ci-hooks.test.ts:1171` |
| `pnpm build` | PASS — enforced by the pre-commit hook |
| `pnpm package:check` | PASS — 379 packaged files |
| Static dependency/hash scan | PASS — syntax valid, only `node:*` imports, no network/package resolution, exact SHA-256 `7e5919e2...d130b92d` |
## Review Budget
- Actual complete Slice 1 diff against `feat/skillguard-pretooluse-hook`: **793 changed lines** (**780 additions + 13 deletions**); `split_required=false`.
- Delivery remains the selected feature-branch chain; this child targets `feat/skillguard-pretooluse-hook` exactly.
## Discovered Patterns
- The standalone runtime must force `process.exit(2)` after synchronous stderr because destroying stdin alone does not guarantee prompt termination with an open parent writer.
- Compact table-driven spawned corpora and semantic option predicates cover CLI families without broad exact-string lists.
## Deviations from Design
None — Slice 1 implements runtime policy only. Installer/settings/doctor/CLI/init/package-verifier wiring remains deferred.
## Remaining Tasks
- [ ] Slice 2 ownership/doctor core; Slice 3 transactional install/platform adapters; Slice 4 public wiring/package/docs. No Slice 2+ work is part of this fix.

## Blocked After Exceptional Fix Round 3
- Slice 1 is **not PR-ready**. Final scoped Judgment Day reproduced two open CRITICAL families: GNU `env -S` split-string escapes/abbreviations and GNU/macOS chmod/base64 option semantics.
- Current child budget remains **793/800** and all normal gates are green, but live bypass evidence takes precedence.
- Do not start Slice 2 and do not publish the Slice 1 child until a fresh-context parser redesign closes `JD-S1-FR3-001` and `JD-S1-FR3-002` and re-review returns CLEAN.
