# Verify Report — linux-support-hardening

**Status: PASS** · CRITICAL: 0 (1 found + fixed pre-merge) · WARNING: 0
**Verified:** 2026-08-18 · main `92eb86c7` · shipped in `javi-forge@1.34.0`

## Executive summary

The Linux hardening arc (3 chained PRs #69/#70/#71, chain-collapsed → single release)
is spec-complete. Both P0s closed: the getfacl UX cliff (actionable remediation +
installCapability doctor section + init decouple) and the node fail-open (heuristic
node-on-PATH blocker + invalid-flag blocking semantics). The real-Linux CI gate ran
green on both legs — and paid for itself immediately by discovering two real runner
facts nobody knew.

## Requirement coverage (3 delta specs, 5 requirements / 47 scenarios — PASS)

- **skillguard-transactional-install-posix**: actionable acl-package remediation on the
  getfacl-absent refusal (never on a REAL extended-ACL refusal — that hint would
  mislead); the ADDED real-Linux CI gate (`claude-hook-linux.yml`, matrix
  [with-acl, without-acl], the without-leg DISPLACES the binary and asserts
  unresolvability). Suite: private 0700 base with asserted ancestor chain; real
  transactional install + byte/mtime-stable idempotent re-run through the REAL
  getfacl; real setfacl → refusal; getfacl-absent → refusal + remediation.
  Falsification-probed (wrong leg = 3 genuine failures).
- **skillguard-pretooluse-hook** (execution matrix): `installCapability` as its OWN
  doctor section (never gates execution/exit — getfacl is install-time-only; the
  remediation joins report.remediation only alongside a `guard:*` blocker);
  `report.nodeOnPath` distinct from `process.versions.node`, probed ONCE per run
  (falsification-proven 2→1), unresolvable/<22 → BLOCKER labelled heuristic,
  timeout/unparseable → unknownSources, success grants NOTHING; invalid non-boolean
  flags (7 shapes incl. string "false") → BLOCKING per documented invalid⇒true
  semantics — the prior strict `=== true` silently cleared them (false runnable).
- **skillguard-cli-dispatch**: init decouple — a guard refusal (or throw) is reported
  with remediation but the hook-profile merge proceeds; a merge-throw preserves the
  captured refusal (never silently lost).

## Reviews

- Slice A: reliability CLEAN (7 ACL_DETAIL literals proven byte-identical; remediation
  matching traced both directions) + 3 info folds (incl. strace-verified 10→0 real
  getfacl spawns in units).
- Slice B: resilience — 1 BLOCKER (the suite escaped its workflow into plain
  `pnpm test`/ci-local's acl-less node:22-slim) FIXED via env-gated vitest collection
  (excluded even by explicit path without `JAVI_FORGE_LINUX_INT=1`); 3 warnings folded.
- Slice C: risk CLEAN on the fail-closed contract (FlagVerdict exhaustive by
  construction; append-only verdict arrays; warnings cannot mask errors) + 2 info
  folds (probe-once, hermetic harness).

## Empirical discoveries (the suite's first CI runs)

1. **GitHub ubuntu-latest ships `/home` with an extended ACL** → the shipped ancestor
   gate refuses install under $HOME on GH-hosted runners. Recorded as backlog
   **JD-P-001** (POSIX analog of the Windows arc's real-C:\ finding; candidate:
   narrow the ancestor predicate to path-endangering rights — its own SDD change;
   fail-closed direction, not urgent).
2. **`/opt` on ubuntu-latest is mode 777** → fails the mode gate. The CI fixture base
   lives at `/jf-int` (directly under `/` — the shortest clean ancestor chain).

## Gates

- Final merge to main: ALL checks green — `test`, `runtime` (windows), `runtime
  (with-acl)`, `runtime (without-acl)`, Cloudflare. Release ran → 1.34.0.
- Local: suite 5/5 on both legs (this dev box is Linux — first-ever real-local
  validation); coverage 91.65+ lines / 82.25+ branches across the slices (≥85/80);
  units spawn zero real getfacl/node binaries (stubbed seams, strace-verified).

## Size

3 PRs, each `size:exception` on test volume (production per slice ~258/~377/~272;
totals ~737/~410/~844). The overrun is spec-mandated matrices + WHY-comments.

## Residuals

- JD-P-001 (above). JD-B-003 (applyExactMode on rollback-restore) remains open,
  non-security, pre-existing. The node probe is a labelled heuristic (our PATH
  proxies the host's — the residual line renders always).
- Approach E (podman/SELinux container-engine support) deferred to its own change.

## Verdict

PASS. Ready for archive.
