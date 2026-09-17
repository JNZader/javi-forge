# Exploration: preparation-production-route

The shipped preparation CLI is diagnostic only (`docs/preparation-runbook.md`
safety invariant). A disconnected executor fixture exists in tests and is **not**
wired to any CLI verb. Remaining work named in
`docs/preparation-capability.md` is a separately reviewed production route:
real operator config, production identity measurement, operator UX, packaging,
install/rollback, runtime evidence.

This change MUST NOT weaken: no private-key access, no generated-helper
execution, no model/gateway/deploy/publish/release from the diagnostic verbs,
no OpenCode call from `status-ok`.

Open product decisions (not observed in code):

1. First slice vs full packaging/install.
2. Consume-approval + pinned worker only, or also staging to a production dest.
3. Operator machine / cwd / destination ownership.
4. Failure rollback of a partial execute.
