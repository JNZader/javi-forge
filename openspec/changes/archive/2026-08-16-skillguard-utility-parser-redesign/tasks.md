# Tasks: SkillGuard Utility Parser Redesign

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 647-792 (design forecast, from `69823570`) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes (this child IS one chained review unit) |
| Suggested split | Single child PR → `feat/skillguard-pretooluse-hook-01-runtime`; no further split unless forecast breaches 800 |
| Delivery strategy | ask-always |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Est. lines | Boundaries |
|------|------|-----------:|------------|
| WU1 | RED: corrected + failing semantic/spawned corpus | 280-360 | Start: `69823570` test files unchanged; Finish: RED suite fails as specified; Rollback: restore the two test files |
| WU2 | GREEN: profile tables, state machines, protected-sink adapter in the MJS | 365-440 | Start: RED committed; Finish: all RED rows green, inherited corpora unchanged; Rollback: restore MJS only |
| WU3 | REFACTOR + manifest digest + verification | 2-8 | Start: runtime bytes stable; Finish: digest bound, old exports gone; Rollback: restore MJS + manifest |

Only WU2 may exceed 400 lines (single-file runtime); commits stay work-unit scoped, tests with code.

## Explicit Gates (every runtime-bearing apply)

- [x] G.1 Parent ledger byte-identity: `sha256sum openspec/changes/skillguard-pretooluse-hook/review-ledger.md` MUST equal `423eac0ba98646463a7a425c0f5f1bf31db3d3b245c4f71772837ef01ccb71d1` before and after apply.
- [x] G.2 No native JSON fabrication: never create `reviews/ledger.json` or any synthetic native review state; native status cannot override the Markdown ledger.
- [x] G.3 Parent Slice 1 PR and Slice 2 remain blocked; `JD-S1-FR3-001/002` stay open until fresh post-apply Judgment Day.
- [x] G.4 Attempt-authority acquire/settle (rc.8) wraps any runtime-bearing apply; rollback = restore the four product files to `69823570`, never rewrite parent history.
- [x] G.5 Base is exact `69823570ccae4b3a78e717b6510c3c402bb8975a`; PR target `feat/skillguard-pretooluse-hook-01-runtime`; diff ≤800 lines or stop for split decision.

## Phase 1: RED — failing semantic corpus before runtime changes

- [x] 1.1 In `src/__tests__/claude-hook-assets.test.ts`, replace incorrect helper expectations (`parseEnvSplit`, `hasChmodRecursive`, `hasBase64Decode`) with semantic-result table expectations; keep inherited safe/deny corpora byte-identical. Verify: `pnpm test -- claude-hook-assets` fails as specified.
- [x] 1.2 Add failing L1/L3 exact-MJS tables for env: profile states, bundles `-iS`/`-vS`, `--split-str` abbreviation, `\_`/`\c`/escaped-dollar, active `${VARNAME}`, delimiter, split pipe literal, unsupported escape, split-work-limit, commandless terminal (S01,S02,S08,S13-S22 + JD-DES-005/008 rows).
- [x] 1.3 Add failing L1/L3 chmod tables: GNU/POSIX/Apple profiles, permutation, `--rec`→`--recursive` abbreviations, bundles `-vR`/`-Rv`, `--reference` role preservation, mixed-mode-reference rejection with partialRoles, mode777, delimiter, ambiguous `--r` (S01-S03,S23-S30).
- [x] 1.4 Add failing L1/L3 base64 tables: GNU/Apple bundles (`-id`, `-i -d`, `-Di`), `--d`→`--decode` abbreviations, permutation, option-argument non-flags, `--` operand rule, union precedence (S01,S02,S04-S06,S31-S37,S39).
- [x] 1.5 Add failing L1 identity/union tables: path-qualified basenames, dynamic identity rejection, danger-dominant reduction, registry source-binding assertions for all seven profiles (S04-S07,S41-S44,S48,S50).
- [x] 1.6 In `src/__integration__/claude-pretooluse-exec.integration.test.ts`, flip the incorrect GNU `base64 -id` allow expectation to deny (visible fail) and remove host-oracle probes; add spawned failures for every JD-S1-FR3-001/002 bypass probe, protected-ambiguity diagnostics (non-leakage), and JD-R1-001-corrected orderings: mode-first `chmod 777 --reference=<ref> /` denied via mode777 danger dominance (inherited rule ID); reference-first `chmod --reference=<ref> 777 /` denied via critical-chmod sink; reference-only accepted (S08-S12,S45-S47,S49,S54-S56). Verify: `pnpm test -- claude-pretooluse-exec` fails as specified.

## Phase 2: GREEN — smallest runtime satisfying the corpus

- [ ] 2.1 In `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs`, add frozen `UTILITY_PROFILE_REGISTRY` (7 entries, Coreutils 9.4 + Apple 2017-01-07/2022-04-18 bindings) and evidence shapes. Verify: `pnpm test -- claude-hook-assets` registry rows pass.
- [ ] 2.2 Implement `normalizeLiteralUtilityIdentity`, `matchLongOption` (unique-prefix), consumed-argument recorder, `reduceProfileUnion` precedence. Verify: `pnpm test -- claude-hook-assets`.
- [ ] 2.3 Implement env option pass + `splitEnvString` character machine + split-work bound (`splitOps<=32`, `splitBytes<=8N`) + commandless terminal + wrapper reduction over split candidates.
- [ ] 2.4 Implement GNU default/POSIX + Apple chmod machines with mixed-mode-reference rejection and partialRoles.
- [ ] 2.5 Implement GNU default/POSIX + Apple base64 machines with real-pipeline sink check.
- [ ] 2.6 Wire `adaptProtectedSink` into `evaluateBash`; diagnostics use only fixed reason/utility/profile/sink enums. Verify: `pnpm test` green; `pnpm typecheck && pnpm lint`.

## Phase 3: REFACTOR + manifest

- [ ] 3.1 Remove boolean exports `parseEnvSplit`, `hasChmodRecursive`, `hasBase64Decode`; expose `normalizeEnvInvocation`, `normalizeChmodInvocation`, `normalizeBase64Invocation`, `reduceProfileUnion`; consolidate shared primitives; freeze tables; NO generic parser.
- [ ] 3.2 After runtime bytes stabilize, update `assets/claude-hooks/manifest.json` SHA-256; keep `historical: []`. Verify: `pnpm validate && pnpm package:check`.
- [ ] 3.3 Full suite + coverage: `pnpm test && pnpm test:coverage` (thresholds 85 lines / 80 branches); rerun integration and Windows-lane files host-independently.

## Phase 4: Verification evidence

- [ ] 4.1 Run JD-S1-FR3-001 acceptance evidence: bundled `env -iS`/`-vS` + active `${VARNAME}` spawned probes exit 2 (finding stays open for post-apply Judgment Day).
- [ ] 4.2 Run JD-S1-FR3-002 acceptance evidence: GNU chmod permutation, `base64 -id`, `base64 -i -d` spawned probes exit 2 (finding stays open).
- [ ] 4.3 L7 workflow checks: base `69823570`, target branch, diff ≤800, gates G.1-G.5 re-verified, prior-safe silent / prior-deny intact.

## Traceability

| Tasks | Requirements | Scenarios |
|-------|--------------|-----------|
| 1.1-1.6, 2.1-2.6 | R1-R8 | S01-S47 |
| 1.5, 2.1, 3.2 | R9, R11 | S48-S50, S56-S58 |
| 1.1, 1.6, 3.3, 4.1-4.2 | R10 | S51-S55 |
| G.1-G.5, 4.3 | R12 | S59-S62 |

JD-S1-FR3-001 → tasks 1.6, 2.3, 4.1 (acceptance evidence only). JD-S1-FR3-002 → tasks 1.3, 1.4, 1.6, 2.4-2.5, 4.2. JD-R1-001-corrected expectations → task 1.6.
