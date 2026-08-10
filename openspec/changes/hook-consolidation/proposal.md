# Proposal: hook-consolidation

## Intent

Five parallel, mutually-blind hook-provisioning mechanisms coexist (verified by 5-family audit; see `exploration.md`): hardened `installCIHooks` (keeper), init's `core.hooksPath=ci-local/hooks` with stale bodies that silently hijacks husky, two unhardened TDD writers that clobber managed hooks, and a 100% inert `ci-local/hooks/security/` subdir sold as "6 git layers". Consolidate into ONE hardened, versioned, composable system.

## Scope

### In Scope
- `javi-forge hooks run <name>` CLI dispatcher; composition in TypeScript
- Static shim hook bodies (pre-commit/pre-push v+1) with honest `--quick` messaging (DOC-004 fix); manifest bump
- `hooks:` config section in `.javi-forge/ci.yaml`
- Init reconciliation: stepGitHooks → installCIHooks + core.hooksPath guard
- TDD fold: flags replace both unhardened writers (deleted)
- Security fold: L1 (with K-005 `-z | xargs -0` fix), L2, L3 as composed sections; L4–L6 as `javi-forge doctor` advisories; drop inert subdir
- Migration regression tests; docs; passive deprecation of tracked `ci-local/` bodies

### Out of Scope
- Porting commit-msg to TS (stays static self-contained bash, assets v2)
- Active cleanup of consumer `ci-local/` copies
- Rewriting hardened primitives (writeHookFile, classify, backup, manifest — reused as-is)
- New security layers beyond the existing six

## Scope Decision

- **Mode**: Selective
- **Justification**: The high-value slice is unifying delivery and killing the unhardened/inert paths; L4–L6 become doctor advisories instead of fake hooks and commit-msg/active-cleanup are deferred — capturing the security and consistency payoff without expanding the hardened-write surface.

## Proposal question round

User-locked decisions 1–7 (architecture, commit-msg, security fates, config location, passive deprecation, hooksPath policy, DOC-004) answered all six explore-phase open questions. No further round required.

## Capabilities

### New Capabilities
- `hook-dispatch`: `hooks run <name>` composition (CI quick gate + TDD section + security sections) driven by `hooks:` config; doctor advisories for L4–L6

### Modified Capabilities
- `ci-hook-install`: shim bodies + manifest version bump (managed-outdated MUST auto-upgrade); core.hooksPath detection — unset only exact legacy `ci-local/hooks` with message, LOUD REFUSAL for any other value; init calls installCIHooks

## Approach

Option 1 (locked): thin static shims exec the CLI dispatcher, preserving the static-sha256 manifest model with ONE hardened writer. Old generated TDD hooks classify FOREIGN → existing `--force`+backup path is their migration.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/commands/ci.ts`, `assets/hooks/*` | Modified | Shims, manifest v+1, hooksPath guard |
| `src/commands/hooks/` (new) | New | Dispatcher + config schema |
| `src/commands/init/steps/{git,security}.ts` | Modified | Stop hooksPath flip/subdir copy |
| `src/commands/{tdd,tdd-pipeline}.ts` | Modified | Writers deleted → config flags |
| `templates/security-hooks/` | Removed/Ported | L1–L3 in, L4–L6 → doctor |
| `ci-local/` | Deprecated | Passive; migration docs |

## Slice Plan (chained PRs, strict TDD, green `pnpm validate` + coverage floors)

S1 dispatcher+config+shims+manifest (>400 lines likely → chain) → S2 init reconciliation+hooksPath guard → S3 TDD fold → S4 security fold → S5 docs+e2e+deprecation.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Legacy consumer breakage | Med | Regression tests: managed-outdated upgrade + legacy hooksPath unset |
| Hijacking foreign hooksPath | Low | Exact-value match only; refuse otherwise |
| profile.json downstream consumers | Med | Audit before folding (spec-time) |

## Rollback Plan

Per-slice revert (chained PRs, each independently green). Manifest `historical[]` keeps prior bodies released — reverting S1 restores prior-version classification. Consumer repos: reinstalling prior release re-writes prior hooks via managed-outdated path.

## Dependencies

- Engram `sdd/hook-consolidation/explore` (#13679); hardened primitives in `src/commands/ci.ts`

## Success Criteria

- [ ] Single write path: only installCIHooks touches `.git/hooks`; tdd/tdd-pipeline/security writers gone
- [ ] Legacy `ci-local/hooks` hooksPath migrates cleanly; any other value refused loudly
- [ ] managed-outdated auto-upgrade regression-tested (upgrade, not FOREIGN refusal)
- [ ] L1 scan survives whitespace filenames (K-005); pre-push messaging honest (DOC-004)
- [ ] All slices green on `pnpm validate` + coverage floors

## Open spec-time questions

1. Exact `hooks:` schema shape (flags vs per-section objects) and profile.json fold-in after consumer audit.
2. Shim npx-fallback behavior when javi-forge is absent (fail-open vs fail-closed per hook).
