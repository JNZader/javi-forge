# Verify Report — apply-scope-rollback

**Date:** 2026-09-17
**Status:** PASS

## Commands

| Command | Result |
| --- | --- |
| `pnpm exec vitest run src/lib/ai-provider-scope.test.ts src/commands/ai-providers.test.ts src/cli/help.test.ts` | 3 files, 60 passed |
| `pnpm typecheck` | pass |
| `pnpm typecheck:test` | pass |

## CLI fixture (tmpdir, not homedir)

1. apply-scope Pi fixture: `enabledModels` became `openrouter-free/deepseek/free`; exclusive `*.bak-*` written.
2. `--dry-run --rollback` left dest bytes unchanged.
3. live `--rollback` restored `enabledModels: ["old/model"]` and wrote `*.pre-rollback-*`.
4. `--target both` on rollback failed: `apply-scope rollback refuses --target both` (exit 1).

Pi/OpenCode homedir hashes unchanged.

## Requirements

| Requirement | Result |
| --- | --- |
| Single-target only | PASS |
| Dest path explicit | PASS (tests + missing-flag command tests) |
| Missing backup fail-closed | PASS (library test) |
| Rollback never applies | PASS (command test + CLI) |
| Dest snapshotted before clobber | PASS |
| Restore tmp + rename | PASS |
| Dry-run writes nothing | PASS |
| No secrets/coordinator writes | PASS (byte restore; homedir untouched) |
