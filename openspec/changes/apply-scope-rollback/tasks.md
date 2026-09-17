# Tasks: apply-scope-rollback

- [x] Library: `rollbackProviderScope` with missing-backup fail, dest `wx` snapshot, tmp `wx` + rename, dry-run no write
- [x] Library tests: restore, dry-run, missing backup, EEXIST safety file, no leftover tmp
- [x] Command: `applyScope` rollback branch before pass-list; refuse `both` and omitted target
- [x] Command tests: rollback without pass-list; refuse both; refuse missing dest flag; rollback wins over pass-list
- [x] Help + docs: apply-scope rollback example and dest flags
- [x] Focused vitest + typecheck + biome; no `pnpm build`; no homedir writes
