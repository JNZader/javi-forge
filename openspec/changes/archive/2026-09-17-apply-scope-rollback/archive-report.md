# Archive Report — apply-scope-rollback

**Archived:** 2026-09-17
**Status:** COMPLETE — implemented, verified (PASS), on `origin/main` as `f25a0ca0` + `d90f2902`.

## Summary

`javi-forge ai providers apply-scope --rollback` restores one exclusive apply
backup onto one explicit Pi or OpenCode dest. Contracts match profile-apply:
no homedir default, dest `wx` snapshot, tmp `wx` + rename, `--rollback` never
applies a pass-list. `--target both` and omitted target are refused.

## Delivery

- `f25a0ca0 feat(ai): add apply-scope rollback restore`
- `d90f2902 docs(ai): specify apply-scope rollback`

## Verification

See `verify-report.md`. PASS: 60 focused tests, typechecks, tmpdir CLI apply/rollback
round-trip, refuse-both. Homedir configs not written.

## Spec sync

`specs/ai-provider-scope/spec.md` synced to `openspec/specs/ai-provider-scope/spec.md`.

## Remaining work (not this change)

- Coordinator/default remains `xai/grok-4.6`
- Doctor OpenCode/Grok/Cursor runtime evidence stays inconclusive by contract
