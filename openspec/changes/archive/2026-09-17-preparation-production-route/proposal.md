# Proposal: preparation-production-route (slice 1)

## Intent

Expose one CLI execute that verifies operator evidence, **consumes** the
approval once, and runs **only** the pinned worker. No production destination
staging. Fail closed: no dest created. Bounded audit only.

## Locked decisions

- First slice: execute + consume only (no packaging/install, no production
  stage, no model/deploy/publish/release).
- Mid-fail: fail closed, no dest. Cleanup only identities this process created.
  Bounded audit `consumed` / failed. Never reopen a consumed grant.

## Scope

### In Scope

- `javi-forge preparation execute --config --outputs --approval [--json]`
- Reuse `src/lib/preparation-executor.ts` without weakening its identity,
  consume-once, timeout, and namespace checks
- Refuse if configured destination already exists or is the production path
  this slice does not own
- Worker stdout/stderr bounded; no generated-helper execution
- Tests for consume-once, refuse existing dest, mid-fail cleanup, no dest

### Out of Scope

- Production destination staging / overwrite
- Packaging, install, rollback of the worker onto hosts
- Private-key signing
- OpenCode/model/gateway calls
- Changing diagnostic verbs' no-execution invariant
- Coordinator/AI provider work

## Success Criteria

- [ ] Execute consumes at most once and cannot replay
- [ ] Existing dest → no consume, no worker
- [ ] Partial worker failure → no production dest, no grant reopen
- [ ] Diagnostic commands still do not execute or consume
