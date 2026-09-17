# Exploration: apply-scope-rollback

Change: `apply-scope-rollback`
Store: openspec
Date: 2026-09-16

## Intent

Give `javi-forge ai providers apply-scope` a rollback path that matches the
safety contracts already shipped for `profile-apply --rollback`.

## Current behavior

- `profile-apply --rollback` is the only consumer of `--rollback`.
- Restore: explicit dest flags, missing-backup fail-closed, dest snapshot
  `wx` (`.pre-rollback-<UTC>`), tmp `wx` + `rename`, dry-run writes nothing.
- `apply-scope` already writes exclusive `*.bak-<UTC>` on apply, then
  `*.apply-tmp-<UTC>` + `rename`. There is no restore API.
- `apply-scope --rollback <path>` today still **applies** if a pass-list is
  present (the command ignores `rollbackPath`).
- Apply-scope allows `--target both`. Profile-apply refuses `both`.

## Gap

Backups exist; restore does not. Operators cannot undo an apply-scope write
through the supported CLI.

## Smallest surface

1. `src/lib/ai-provider-scope.ts` — rollback helper
2. `src/commands/ai-providers.ts` — honor `rollbackPath`, skip pass-list
3. `src/cli/help.ts` + `docs/commands.md`
4. Tests: `ai-provider-scope.test.ts`, `ai-providers.test.ts`, `help.test.ts`

Do not extract a shared helper unless copy-paste becomes the defect.
Do not change coordinator/default. No homedir dest defaults. Byte restore
of operator-owned JSON only (no secrets/auth writes).

## Open product decision

`--target both` rollback: one `--rollback PATH` cannot restore two dests.
Smallest mirror of profile-apply: refuse rollback with `--target both`
(and refuse omitted target, which currently defaults to `both`).

## Risks

- 1s timestamp collisions already fail closed via `wx` / EEXIST.
- No relatedness check between backup path and dest path (same as profile-apply).
- Missing dest: profile-apply rollback creates dest; apply-scope apply mkdirs
  parent. Rollback should not invent a broader mkdir than profile-apply.
