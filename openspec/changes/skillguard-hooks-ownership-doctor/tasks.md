# Tasks: SkillGuard Ownership Classifier and Read-Only Doctor (Slice 2)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~730 (design File Changes table; tests + fixtures included) |
| 400-line budget risk | Medium (WU1 ~380 approaches the 400 commit ceiling) |
| Chained PRs recommended | No (single PR ~730 < 800; four work-unit commits inside it) |
| Suggested split | One PR off current `main`; commits WU3 → WU1 → WU2 → WU4 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (Slice-1 runtime already on `main`) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Est. lines | Boundaries |
|------|------|-----------:|------------|
| WU3 | Shared frozen ownership fixtures | ~70 | Start: `main` clean; Finish: `pnpm typecheck:test` compiles fixtures; Rollback: delete fixtures file |
| WU1 | Pure `claude-hook-settings.ts` + its table-driven test | ~380 | Start: WU3 present; Finish: every non-manifest-bound settings row green; Rollback: restore the two files. STOP-FOR-SPLIT if commit > 400 — split planners into their own commit, never move tests forward |
| WU2 | Read-only `claude-hook-manager.ts` subset + real-tmpdir test | ~275 | Start: WU1 green; Finish: doctor + asset states green; Rollback: restore the two files |
| WU4 | Manifest `settingsEntries.current` populate + assertion/guard reconciliation | ~5 | Start: WU1 canonical hash stable; Finish: assets test + append-only guard green; Rollback: restore `current: null` + original `:43` assertion |

## Explicit Gates (read-only recognition slice)

- [ ] G.1 Base is exact current `main` (Slice-1 managed MJS + manifest present); PR ≤ 800 lines and each work-unit commit ≤ 400 — stop for a split decision if breached.
- [ ] G.2 NO filesystem mutation anywhere in Slice 2: no write, backup, temp, rename, or directory creation. Manager fs surface is `safeReadFile` (`src/lib/safe-read.ts`) plus one isolated no-follow `lstat` helper only. Install/repair are Slice-3 seams (commented `throw new Error("unimplemented: Slice 3 transaction")`).
- [ ] G.3 NO CLI dispatch, init rewiring (`src/commands/init/steps/security.ts`), help text, or effective-execution matrix (`RUNNABLE`/`BLOCKED`/`INCONCLUSIVE`, `disableAllHooks`, `settings.local`, MDM, safe mode) — all Slice 4.
- [ ] G.4 Canonical serialization is a read/write round-trip contract Slice 3's writer must honor: 2-space indent + trailing newline, fixed key order (`type, command, args, timeout, statusMessage`; group `matcher, hooks`), exact matcher `Bash|PowerShell|Read|Write|Edit`, literal `${CLAUDE_PROJECT_DIR}` arg, `timeout: 30`, asset-SHA token normalized to `<ASSET_SHA256>` (Decision ②) before hashing.
- [ ] G.5 Legacy recognition is deep-structural (never substring/normalized): whole-file SHA `b4638222…` OR exactly one deep-equal match of each of the four v0 cohort objects; partial/duplicate/one-byte-edited → `foreign`.
- [ ] G.6 `pnpm validate` + `pnpm test:coverage` (85 lines / 80 branches) + `pnpm package:check` green before done; coverage thresholds never lowered; `src/lib/*` free of Ink/React.

## Phase 1: RED — failing fixtures and spec corpus before implementation

- [ ] 1.1 **(WU3)** Create `src/lib/__fixtures__/claude-hook-ownership.ts`: frozen (`as const`) exact managed handler group, `MANAGED_STATUS_PREFIX`/`ASSET_SHA_PLACEHOLDER`/`LEGACY_FILE_SHA256` mirrors, the four v0 legacy cohort objects (L1 Bash PreToolUse dangerous, L2 Bash PreToolUse sensitive-read, L3 `Write|Edit` PreToolUse, L4 Bash PostToolUse), plus one-byte-edited and duplicate variants. Verify: `pnpm typecheck:test`.
- [ ] 1.2 **(WU1)** Create `src/lib/claude-hook-settings.test.ts` (table-driven, failing): every settings state (malformed shapes; managed-current; released-outdated; edited-managed for unknown-hash / duplicate marker / marker-in-invalid-container; foreign; absent); full cohort exact-legacy; partial (1/2/3-member), duplicate-member, one-byte-edited → foreign; whole-file SHA legacy; forged `statusMessage` hash → edited-managed; Decision-② asset-SHA-rotation invariance; key-order + placeholder stability; removal/merge plan sibling preservation. Covers R2.S3–S7, R3.S2, R4.S1–S5, R5.S1–S3, R8.S2. Verify: `pnpm vitest run src/lib/claude-hook-settings.test.ts` fails as specified.
- [ ] 1.3 **(WU2)** Create `src/lib/claude-hook-manager.test.ts` (real-tmpdir, failing): asset states absent / symlink / non-regular / managed-current / released-outdated / edited-managed / foreign / binary / too-large; settings wrapper (absent on not-found, malformed on parse throw, symlink/non-regular via lstat); doctor report shape; `healthy` truth table; `assetSettingsConsistent` under asset rotation; injected Node `<22`/`>=22` branch; forged asset-body hash → edited-managed; assert no bytes/mtimes changed and no backups. Covers R1.S1–S7, R2.S1–S2, R3.S1, R6.S1–S5, R7.S3, R8.S1. Verify: `pnpm vitest run src/lib/claude-hook-manager.test.ts` fails as specified.

## Phase 2: GREEN — smallest implementation satisfying the corpus

- [ ] 2.1 **(WU1)** Create `src/lib/claude-hook-settings.ts` (pure, zero I/O): constants + `ClaudeHookComponentState`/`CanonicalSettingsEntry` types, shape validation, `canonicalizeSettingsEntry` (Decision ② + fixed key order + 2-space/newline), recomputed canonical hash, `parseVersionFromStatus`, `classifySettingsEntry`, `classifyLegacy` + `matchesLegacyCohort` via order-sensitive `deepStructuralEqual`. Makes 1.2 pass except manifest-bound `managed-current`/`released-outdated` rows (bound in 3.1). Verify: `pnpm vitest run src/lib/claude-hook-settings.test.ts`.
- [ ] 2.2 **(WU1)** Implement `planManagedClaudeHookRemoval` / `planManagedClaudeHookMerge` (planning only: target handler index, preserved siblings, refusal on foreign/partial; no I/O, no execution). Verify: `pnpm vitest run src/lib/claude-hook-settings.test.ts`.
- [ ] 2.3 **(WU2)** Create `src/lib/claude-hook-manager.ts` (read-only subset): one private no-follow `lstat` helper; `classifyAssetState` (lstat → `safeReadFile` → always-recompute full-file SHA vs manifest current/historical); settings read+parse wrapper delegating to `classifySettingsEntry`; `detectNode` (`process.versions.node` major ≥ 22, no spawn); `doctorClaudePreToolUse` assembling the report struct with `matcherExact`/`commandShapeExact`/`assetSettingsConsistent`/`coverage`/`hostResidual`/`remediation[]` and the exact `healthy` conjunction; install/repair exported as commented unimplemented Slice-3 seams. Verify: `pnpm vitest run src/lib/claude-hook-manager.test.ts`.

## Phase 3: REFACTOR + manifest/assertion reconciliation

- [ ] 3.1 **(WU4)** After canonicalization stabilizes, compute the placeholder-normalized canonical hash of the current managed group and populate `assets/claude-hooks/manifest.json` `settingsEntries.current = { version: 1, canonicalSha256 }`; keep `historical: []`. Confirms 1.2 `managed-current`/`released-outdated` rows now green. Verify: `pnpm vitest run src/lib/claude-hook-settings.test.ts`.
- [ ] 3.2 **(WU4)** In `src/__tests__/claude-hook-assets.test.ts`, update the `:43` `toMatchObject` from `settingsEntries: { current: null }` to the populated `{ version: 1, canonicalSha256 }` shape, and add the append-only `RELEASED_SETTINGS_SNAPSHOT` guard mirroring `src/__tests__/hook-assets.test.ts` (`historyMaintenanceViolations` analogue: `settingsEntries.historical` MUST start-with the released list). Verify: `pnpm vitest run src/__tests__/claude-hook-assets.test.ts`.
- [ ] 3.3 **(REFACTOR)** Consolidate shared primitives, freeze fixture tables/constants, and assert the pure/impure boundary: `claude-hook-settings.ts` imports no `node:fs`; the manager touches fs only via `safe-read` + the single `lstat` helper; no Ink/React in `src/lib/*`. Verify: `pnpm typecheck && pnpm typecheck:test && pnpm lint`.

## Phase 4: Verification and gate closure

- [ ] 4.1 Run `pnpm validate` (typecheck + typecheck:test + lint + test) — green. (G.6)
- [ ] 4.2 Run `pnpm test:coverage` — lines ≥ 85, branches ≥ 80, thresholds unchanged. (G.6)
- [ ] 4.3 Run `pnpm package:check` — green. (G.6)
- [ ] 4.4 Confirm read-only + size gates: no test creates/renames/backs up any file; `git diff --stat` keeps the PR ≤ 800 and each WU commit ≤ 400 (split WU1 planners if breached). (G.1, G.2)

## Requirement-to-Task Traceability

| Requirement | Scenario → task mapping | Coverage |
|---|---|---|
| R1 Asset 9-state classification | S1→1.3,2.3; S2→1.3,2.3; S3→1.3,2.3; S4→1.3,2.3,3.1; S5→1.3,2.3,3.1; S6→1.3,2.3; S7→1.3,2.3 | Complete |
| R2 Settings 9-state classification | S1→1.3,2.3; S2→1.3,2.3; S3→1.2,2.1; S4→1.2,2.1,3.1; S5→1.2,2.1,3.1; S6→1.2,2.1; S7→1.2,2.1 | Complete |
| R3 Claimed hashes never trusted | S1→1.3,2.3; S2→1.2,2.1 | Complete |
| R4 Exact v0 legacy only | S1→1.2,2.1; S2→1.1,1.2,2.1; S3→1.2,2.1; S4→1.2,2.1; S5→1.1,1.2,2.1 | Complete |
| R5 Canonical serialization deterministic/asset-SHA independent | S1→1.2,2.1; S2→1.2,2.1; S3→1.2,2.1 | Complete |
| R6 Read-only doctor without mutation | S1→1.3,2.3; S2→1.3,2.3; S3→1.3,2.3; S4→1.3,2.3,4.4; S5→1.3,2.3 | Complete |
| R7 Manifest append-only settings identity | S1→3.1,3.2; S2→3.2; S3→1.3,2.3,3.1 | Complete |
| R8 Recognition/planning no mutation | S1→1.3,2.3,4.4; S2→1.2,2.2 | Complete |

### Traceability Gap Report

- Requirements mapped: **8/8**.
- Scenarios mapped: **34/34**.
- Unmapped requirements/scenarios: **none**.
