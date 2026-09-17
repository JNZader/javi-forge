# Proposal: apply-scope-rollback

## Intent

Operators can undo a live `apply-scope` write with the same safety contracts as
`profile-apply --rollback`, without homedir defaults and without changing
coordinator/global defaults.

## Scope

### In Scope

- `javi-forge ai providers apply-scope --rollback <backup> --target pi|opencode`
  plus the matching dest flag (`--pi-settings` or `--opencode-config`)
- Library restore: missing-backup fail-closed, dest `wx` snapshot
  (`.pre-rollback-<UTC>`), tmp `wx` + `rename`, dry-run writes nothing
- Honor `rollbackPath` in `applyScope` so `--rollback` never applies
- Help + `docs/commands.md`
- Tests for the contracts above

### Out of Scope

- `--target both` rollback (refused; two restores = two commands)
- Shared helper extraction with `profile-apply`
- Coordinator / `defaultProvider` / `defaultModel` / OpenCode `agent` edits
- Homedir dest defaults
- Changing apply-scope apply behavior except not ignoring `--rollback`
- Secrets/auth/provider mutation beyond byte-restore of the operator file

## Scope Decision

- **Mode**: Selective
- **Justification**: Apply-scope already writes exclusive `*.bak-<UTC>` files.
  The gap is restore. Profile-apply already defines the restore contracts.
  Refusing `both` keeps one `--rollback PATH` honest.

## Capabilities

### Modified Capabilities

- `ai-provider-scope`: restore an apply-scope backup onto one explicit dest
- `ai providers apply-scope`: rollback branch that skips pass-list

## Approach

Copy the profile-apply rollback sequence into `ai-provider-scope.ts`. Do not
share a helper in this slice. CLI refuses `both` and omitted target on
rollback (omitted target today defaults to `both` for apply).

## Affected Areas

| Area | Impact | Description |
| --- | --- | --- |
| `src/lib/ai-provider-scope.ts` | Modified | Rollback helper |
| `src/commands/ai-providers.ts` | Modified | Rollback branch, usage |
| `src/cli/help.ts` | Modified | Flag text + example |
| `docs/commands.md` | Modified | Apply-scope rollback |
| co-located tests | Modified | Library + command + help |

## Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| `apply-scope --rollback` still applies | High today | Rollback branch before pass-list apply |
| `--target both` ambiguity | High | Refuse on rollback |
| Same-second `wx` EEXIST | Low | Keep exclusive create; do not delete backups |
| Restoring a bak onto the wrong dest | Same as profile-apply | Explicit dest flags; no relatedness heuristic |

## Rollback Plan

Revert the change-set. Existing `*.bak-<UTC>` files remain operator-owned.

## Success Criteria

- [ ] `apply-scope --rollback` restores bytes and never applies
- [ ] Rollback refuses `both`, omitted target, missing dest flag, missing backup
- [ ] Dest snapshot `wx` before clobber; restore is tmp `wx` + `rename`
- [ ] Dry-run writes nothing
- [ ] No homedir dest default; coordinator untouched
