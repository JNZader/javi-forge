# Apply Progress — skillguard-pretooluse-hook (Slice 1)

## Completed Tasks

- [x] 1.1-1.6: standalone bounded protocol, manifest identity, cross-platform file path policy, and Work Unit 1A commit.
- [x] 1.7-1.13: distinct Bash/PowerShell corpora, exact spawned-process enforcement, denial-only fault flags, Windows runtime job, static dependency scan, and Work Unit 1B commit.

## Commits

- `213afff9 feat(skillguard): add standalone PreToolUse protocol and path policy`
- `194ca3d2 feat(skillguard): enforce shell policy in the shipped evaluator`

## Files Changed

| File | Action |
|---|---|
| `.github/workflows/claude-hook-windows.yml` | Created runtime-only Windows validation job |
| `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs` | Created dependency-free packaged evaluator and v1 policy |
| `assets/claude-hooks/manifest.json` | Created runtime manifest with recomputed SHA-256 identity |
| `src/constants.ts` | Added `CLAUDE_HOOK_ASSETS_DIR` |
| `src/__tests__/claude-hook-assets.test.ts` | Created pure asset/schema/path/shell corpus tests |
| `src/__integration__/claude-pretooluse-exec.integration.test.ts` | Created exact-MJS process tests |

## TDD Evidence

| Tasks | Layer | RED | GREEN / REFACTOR |
|---|---|---|---|
| 1.1-1.2 | Unit | Missing constant/asset failed before production existed | 27 protocol/path tests passed; triangulated into final unit corpus |
| 1.7 | Unit | Shell corpus produced 33 expected failures | 67/67 unit tests passed after distinct Bash/PowerShell rules |
| 1.9 | Integration | Exact spawned asset produced 7 expected process-contract failures | 11/11 integration tests passed, including open-writer oversize and fault flags |

## Verification

| Gate | Result |
|---|---|
| Focused runtime suites | PASS — 78/78 |
| `pnpm test` | PASS — 99 files, 1888 passed, 2 skipped |
| `pnpm typecheck` | PASS |
| `pnpm typecheck:test` | PASS |
| `pnpm lint` | PASS with one pre-existing unused-suppression warning in `src/commands/ci-hooks.test.ts:1171` |
| `pnpm build` | PASS |
| `pnpm package:check` | PASS — 379 packaged files |
| Static dependency/hash scan | PASS — syntax valid, only `node:*` imports, no network/package resolution, manifest hash exact |

## Review Budget

- Actual Slice 1 implementation diff against `feat/skillguard-pretooluse-hook`: **663 additions, 0 deletions** before this progress artifact/task marks.
- Delivery remains the selected feature-branch chain; this child targets `feat/skillguard-pretooluse-hook` exactly.

## Discovered Patterns

- The standalone runtime must force `process.exit(2)` after synchronous stderr because destroying stdin alone does not guarantee prompt termination with an open parent writer.
- Compact table-driven corpora keep the security policy reviewable while both pure imports and exact spawned-process tests assert behavior.

## Deviations from Design

None — Slice 1 implements runtime policy only. Installer/settings/doctor/CLI/init/package-verifier wiring remains deferred.

## Remaining Tasks

- [ ] Slice 2 tasks 2.1-2.12 — ownership, migration, and read-only doctor core.
- [ ] Slice 3 tasks 3.1-3.14 — transactional install/repair and platform safety adapters.
- [ ] Slice 4 tasks 4.1-4.14 — public wiring, init consent, packaging gate, docs, and manual acceptance.
