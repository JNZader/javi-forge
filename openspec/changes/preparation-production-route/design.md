# Design: preparation-production-route slice 1

Wire `javi-forge preparation execute` to the existing
`src/lib/preparation-executor.ts` fixture/runtime **without** adding a
production staging route.

The executor already: verifies binding, consumes immediately before work, runs
the pinned worker with bounded stdio/timeouts, and uses a random temporary
fixture root for any staging entrypoint (`docs/preparation-capability.md`).

Slice 1 CLI:

- Require `--config`, `--outputs`, `--approval`
- Call executor with operator pins from config
- If destination exists → deny before consume (executor already has this test)
- Do not pass a production destination override (none exists; do not add one)
- Print bounded JSON/status; never print approval evidence or output payloads

Fail closed on worker crash: no dest, no grant reopen, audit only.
