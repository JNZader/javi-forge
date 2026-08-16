# Proposal: SkillGuard Ownership Classifier and Read-Only Doctor

## Decision

Amend `skillguard-pretooluse-hook` with **Slice 2 ("Ownership and doctor", read-only)**: deliver the managed-ownership classifier and the component-level doctor as tested **library functions plus a report contract and fixtures**, so Slice 3's transactional install/repair can trust exact state recognition without inventing it. No filesystem mutation, no CLI dispatch, no init wiring in this slice.

## Relationships and Delivery

- `amends: skillguard-pretooluse-hook`; `depends-on:` the Slice-1 runtime now on `main` (managed MJS asset + manifest); never supersedes or resets parent review/attempt history.
- Chained PR, base off current `main`. Forecast **~650–750 changed lines** (tests + fixtures included); each work unit `<400` lines, PR `<800`. An undefendable forecast requires a split decision, not compressed scope.
- Slice 3 (transaction) and Slice 4 (dispatch/init/effective-execution) remain blocked on this slice's recognition primitives.

## Why

Slice 1 ships a runtime with no way to answer "is this installed, current, drifted, or someone else's?" `manifest.settingsEntries.current` is still `null`, so the settings-entry has no canonical identity. Without an exact, fixture-backed classifier for **both** components (asset + settings-entry), Slice 3 would guess ownership at mutation time — the exact failure mode (clobbering user hooks, mis-migrating legacy) the arc exists to prevent.

## What Changes — In Scope

- **9-state ownership classifier**, independent per component (asset + settings-entry): `absent | managed-current | released-outdated | exact-legacy | edited-managed | foreign | symlink | non-regular | malformed`.
- **Exact v0 legacy recognizer**: full-file SHA `b4638222…` OR the complete 4-object PreToolUse/PostToolUse cohort via **deep structural equality — never substring**. Partial/duplicate/edited cohorts are `foreign`.
- **Two-module split (Approach 1):** pure `src/lib/claude-hook-settings.ts` (protocol-shape validation, canonical settings-entry identity, exact legacy recognition, removal/merge **planning only** — no I/O); read-only subset of `src/lib/claude-hook-manager.ts` (asset validation, 9-state classification, doctor report as a library function). Slice 3 **grows** the manager with the transaction; it does not relocate this code.
- **Component-level doctor report struct**: `settings.state`, `asset.state|version|sha`, `node.available|version` (Node `>=22` check), `matcherExact`, `commandShapeExact`, coverage of `Bash|PowerShell|Read|Write|Edit`, `hostResidual`, `remediation[]`; `healthy` = both components `managed-current` + exact shape + Node ok.
- **Decision ②:** the canonical settings-entry hash **normalizes the live asset SHA token out** — replace `:sha256:<ASSET_SHA256>` in the handler `statusMessage` with a fixed placeholder before hashing — decoupling settings-entry identity from asset rotation.
- Populate `manifest.settingsEntries.current = { version, canonicalSha256 }` (currently `null`) + an **append-only released-snapshot guard** for the settings-entry historical list (mirror `src/__tests__/hook-assets.test.ts`).
- Deterministic canonical serialization: fixed key order, exact matcher, `${CLAUDE_PROJECT_DIR}` placeholder, `timeout: 30`, repo JSON convention. Reuse `src/lib/safe-read.ts` for bounded reads.
- Table-driven fixtures: every state × 2 components + legacy cohort variants (full / partial / duplicate / one-byte-edited) + mixed-handler groups + malformed/symlink/non-regular.

## Non-Goals

- **Decision ①:** the runnable `javi-forge hooks doctor claude` CLI route AND the effective-execution inventory (safe-mode / MDM / `disableAllHooks` / `settings.local` / user precedence; RUNNABLE/BLOCKED/INCONCLUSIVE matrix + exit codes) → **deferred to Slice 4**.
- Any filesystem mutation / install / repair / backup → **Slice 3**.
- `src/commands/init/steps/security.ts` rewiring, `src/cli/dispatch/hooks.tsx`, help text → **Slice 4**.
- Per-skill attribution; governing unknown / MCP / Web tools.

## Scope Decision

- **Mode**: Selective.
- **Justification**: The incoming scope is already the minimal high-value slice — recognition primitives are the load-bearing dependency for Slice 3, and pulling mutation, CLI dispatch, or the effective-execution matrix forward would breach the review budget and mix read-only planning with irreversible I/O. Deliver only the classifier + doctor library + fixtures now; defer the rest as explicitly bounded later slices.

## Installed-Consumer Impact

Read-only library + manifest change. Global linuxbrew/npm consumers and the ~8 Git-hook repositories are **not** auto-rewritten and see no behavior change. Populating `manifest.settingsEntries.current` **breaks** the `src/__tests__/claude-hook-assets.test.ts:43` `toMatchObject({ settingsEntries: { current: null } })` assertion, which MUST be updated in this slice.

## Risks and Rollback

| Risk | Level | Mitigation |
|---|---|---|
| Legacy recognizer false-positives via resemblance | High | Full-file SHA + deep structural equality only; partial/duplicate/edited → `foreign`; fixtures for every cohort variant. |
| Settings-entry identity coupled to asset rotation | Med | Decision ② normalizes the asset-SHA token out before hashing. |
| Classifier drift between this slice and Slice 3's mutator | Med | Pure planner in `claude-hook-settings.ts`; Slice 3 grows the manager, does not relocate. |
| `settingsEntries.current` populate silently regresses the released snapshot | Med | Append-only released-snapshot guard test mirroring `hook-assets.test.ts`. |

**Rollback**: revert only this child — restore `manifest.settingsEntries.current` to `null`, remove `src/lib/claude-hook-settings.ts` + `src/lib/claude-hook-manager.ts` (read-only subset) and their tests/fixtures, and restore the original `claude-hook-assets.test.ts` assertion. No parent history or Slice-1 runtime is touched.

## Success Criteria

- [ ] Classifier returns the correct one of 9 states for every fixture, per component, deterministically.
- [ ] Exact v0 legacy is recognized by SHA and 4-object cohort deep-equality; partial/duplicate/edited cohorts classify as `foreign`.
- [ ] Doctor library function returns the full report struct with `healthy` iff both components `managed-current` + exact shape + Node `>=22`.
- [ ] `manifest.settingsEntries.current` is populated; the `claude-hook-assets.test.ts` assertion is updated; the append-only released-snapshot guard passes.
- [ ] Canonical settings-entry hash is invariant under asset-SHA rotation (Decision ②).
- [ ] No filesystem mutation, CLI route, or init wiring is introduced.

## Open Questions

None — locked decisions (Approach 1, Decision ①, Decision ②) resolved during exploration.
