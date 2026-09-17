# Design: apply-scope-rollback

## Decision

Copy the `rollbackModelAssignmentProfileOverlay` sequence into
`src/lib/ai-provider-scope.ts` as `rollbackProviderScope`. Do not extract a
shared helper in this slice.

## Why

Profile-apply already shipped dest snapshot `wx`, tmp `wx`, and `rename`.
Apply-scope apply already uses the same timestamp and exclusive bak/tmp
pattern. The missing piece is restore. A shared helper would touch the
profile-apply module without changing behavior; out of scope.

## Control flow

```text
apply-scope --rollback PATH --target pi|opencode --pi-settings|--opencode-config PATH [--dry-run]
  → refuse both / omitted target / missing dest flag
  → rollbackProviderScope
      → fail if backup unreadable
      → dry-run: return, write nothing
      → if dest exists: wx dest.pre-rollback-<UTC>
      → wx dest.rollback-tmp-<UTC> with backup bytes
      → rename tmp onto dest
```

Command `applyScope` MUST branch on `rollbackPath` **before** requiring a
pass-list.

## Timestamp

Reuse apply-scope `timestamp(now)` (1s resolution). Collisions stay fail-closed
via `wx`. Do not delete `.bak-*` files after success.

## Non-goals in this design

- `--target both` rollback
- Relatedness check between bak path and dest
- Changing apply-scope apply merge of `enabledModels` / OpenCode providers
- Coordinator/default/agent mutation
