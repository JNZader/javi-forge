# Archive Report — linux-support-hardening

**Archived:** 2026-08-18
**Status:** COMPLETE — implemented, verified (PASS), merged to `main`, released in `javi-forge@1.34.0`.
**Amends:** `skillguard-transactional-install-posix`, `skillguard-pretooluse-hook`, `skillguard-cli-dispatch`.

## Summary

Makes the Claude PreToolUse guard honestly installable and honestly diagnosable on
stock Linux, closing the two P0s from the exhaustive Linux-support analysis:

- **P0-1 (getfacl UX cliff)**: on distros without the `acl` package (Debian minimal,
  Alpine, slim images) the install refusal now carries actionable remediation
  (`install the acl package: apt install acl · apk add acl · dnf install acl`); the
  doctor gained an `installCapability` section (its own field — getfacl is an
  install-time dependency, so its absence NEVER gates the execution verdict or exit
  code; the remediation joins `report.remediation` only alongside a `guard:*`
  blocker); `init` no longer loses the hook-profile merge when the guard refuses.
- **P0-2 (node fail-open)**: the hook is `command:"node"` exec-form but the host agent
  on Linux is a native binary — node was never guaranteed and a missing node made the
  guard silently never fire while doctor said runnable. Now: `probeNodeOnPath`
  (probed once per run) → unresolvable/<22 = execution BLOCKER labelled a heuristic;
  timeout/unparseable = unknown; success grants nothing; install warns (non-blocking)
  when node is absent. Invalid non-boolean `disableAllHooks`/`allowManagedHooksOnly`
  values now BLOCK per the documented invalid⇒true semantics (the prior strict
  `=== true` silently treated them as clear — a false runnable).
- **P1-4 (zero real-Linux assertions)**: a real-Linux integration gate
  (`claude-hook-linux.yml`, matrix with-acl/without-acl — the without-leg displaces
  the getfacl binary) now exercises the REAL shipped adapter: real getfacl gate
  install + idempotent no-op, real setfacl refusal, getfacl-absent refusal +
  remediation. Collected only under `JAVI_FORGE_LINUX_INT=1` so plain `pnpm test`
  (incl. ci-local's acl-less node:22-slim) stays green. The dead /tmp-rooted test
  (which had asserted nothing, permanently) was deleted — coverage went UP.

## Empirical discoveries

The suite's first CI runs discovered two real runner facts: GitHub ubuntu-latest
ships `/home` with an extended ACL (→ the shipped gate refuses install under $HOME
on GH runners — backlog **JD-P-001**, the POSIX analog of the Windows real-C:\
finding; candidate fix: narrow the ancestor predicate to path-endangering rights,
its own SDD change) and `/opt` is mode 777 (→ the CI fixture base lives at `/jf-int`
directly under `/`).

## Delivery

3 chained PRs #69 (capability+remediation+init) / #70 (real-Linux gate) / #71
(node probe + invalid flags), each reviewed (reliability / resilience / risk) with
1 BLOCKER (suite escaping into plain `pnpm test`) + 1 CRITICAL-class fixed pre-merge
and info folds applied. Chain-collapsed → single release `1.34.0` (main `92eb86c7`).
Rejected in design: a getfacl-less ACL fallback (a hand-rolled xattr parser would
weaken an airtight proof). Deferred: podman/SELinux container-engine support
(`container-engine-linux`, needs a real Fedora box).

## Spec sync

Three deltas merged into `openspec/specs/`: `skillguard-transactional-install-posix`
(remediation + the ADDED real-Linux CI-gate requirement),
`skillguard-pretooluse-hook` (installCapability + nodeOnPath + invalid-flag
semantics on the doctor requirement), `skillguard-cli-dispatch` (init decouple).

## Residuals / follow-ups

- **JD-P-001** (ancestor-ACL over-refusal narrowing) — own SDD change, fail-closed
  direction, not urgent. JD-B-003 still open (non-security). The node probe is a
  labelled heuristic (residual line always rendered).
- **Approach E**: podman + SELinux relabel for the container runners — separate change.

## Remaining arcs

- **Agent-agnostic arc** — OpenCode / Codex input-envelope + config adapters (next).
- JD-P-001 predicate narrowing; container-engine-linux.
