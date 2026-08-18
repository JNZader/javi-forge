# Verify Report — posix-ancestor-predicate (JD-P-001)

**Status: PASS** · CRITICAL: 0 · WARNING: 0 · (2 LOW test-completeness notes folded)
**Verified:** 2026-08-18 · main `150f2bcf` · shipped in `javi-forge@1.35.1`

## Executive summary

The POSIX ancestor ACL gate is narrowed from blunt any-extended-entry refusal to a
path-endangering-only predicate, with the strict any-extended-ACL guarantee atomically
re-homed into POSIX `proveManagedContainer` so `.claude`/`.claude/hooks` stay byte-identical.
Mandatory 3vr (security loosening on a fail-closed installer): all THREE independent voices
CLEAN. The loosening is structurally bounded by the unchanged mode check (empirically proven).
Released 1.35.1. The validation-via-revert passed: the real-getfacl suite now bases under
`$HOME` on GH runners and is green — the `/home` over-refusal is closed.

## Requirement coverage (1 MODIFIED + 1 ADDED / 14 scenarios — PASS)

- **Ancestor path-endangering predicate** — `proveNoEndangeringAcl` (two-pass getfacl parser):
  REFUSE a foreign named-user (uid ∉ {dir-owner, root, euid}) or ANY named-group with EFFECTIVE
  `w` (raw ∩ mask, computed by us); ALLOW base entries, mask-alone, effective-non-w named,
  x-only, trusted-uid, `default:*`. All fail-closed edges (getfacl absent/timeout/nonzero,
  unrecognized/malformed line, named-w with mask absent, owner-stat failure) still refuse.
- **Managed-container strictness UNCHANGED** — `proveManagedContainer` now runs
  proveOwnershipAndMode AND the strict any-extended-entry check; the loosening is ancestor-only.
  Pinned by unit 1.11 (benign entry ALLOWED on ancestor, REFUSED on `.claude`) + real-bytes
  integration.
- **Consistency across preflight + re-prove** — all 8 gate/re-prove sites mapped (voice 2):
  ancestors lenient at `gate()`, `recheck-acl`, rollback `gateStillValid`; managed strict-proved
  at ensure + `recheck-container` + rollback; leaf `source-acl` strict.
- **macOS deferred** — darwin lenient = strict no-op (ancestors stay strict, documented).
- **Validation-via-revert (ADDED req)** — `JF_INT_BASE=/jf-int` dropped; suite bases under
  `$HOME`/`RUNNER_TEMP`; green → `/home`-class allowed.

## Empirical /home ACL (captured via the CI `gh-home-getfacl` diagnostic artifact)

GitHub ubuntu-latest `/home`:
```
user::rwx  group::r-x  other::r-x
default:user::rwx  default:user:1001:rwx  default:group::r-x  default:mask::rwx  default:other::r-x
```
The entry that tripped the old blunt predicate was **`default:user:1001:rwx`** — a DEFAULT ACL
(inheritance-only, affects only newly-created children, not `/home` itself). The narrowed
predicate correctly ALLOWS it; the design's default-ACL tolerance is empirically confirmed.
Backstop intact: any default entry inheriting onto the created `.claude` becomes a real
(non-default) entry caught by the strict managed-container check.

## 3vr result (mandatory — all CLEAN)

- **Voice 1 (security)**: CLEAN. EMPIRICALLY PROVED via a setfacl/stat truth table (7 cases incl.
  `-n` no-recalc-mask + write-only mask) that NO ACL combination grants a foreign principal
  effective write with `mode & 0o022 == 0` — the ACL mask maps onto the st_mode group class, so
  `proveOwnershipAndMode` catches every effective-write entry independently. The loosening cannot
  introduce a fail-open the unchanged mode check doesn't already block (defense in depth).
- **Voice 2 (wiring/completeness)**: CLEAN. 8 sites consistent; atomic coupling proven by test
  (fails if either half reverts); no `process.platform` in the engine; Windows/darwin unchanged;
  `/jf-int` fully reverted.
- **Voice 3 (tests/reliability)**: CLEAN. 54 unit + 7 real-getfacl integration pass; tests drive
  the REAL parser on faithful bytes; every refuse→security branch covered; no false-ALLOW passes
  green. 2 LOW notes (named-group ALLOW branch + comment-skip) FOLDED → security parser
  `classifyEndangering`+`aclEntries` at 100% branch.

## Gates

- Final merge: `test` + `runtime` (windows) + `runtime (with-acl)` + `runtime (without-acl)` all
  green; release → 1.35.1. Local: 54 unit + 7 real-getfacl (this Linux box); global coverage
  91.99 lines / 82.66 branches (≥85/80).
- Known non-issue: `src/e2e/aggressive.e2e.test.ts` local TTY/dist flake (unrelated).

## Size

Single atomic PR (loosen + re-home cannot split), `size:exception` (~278 impl + tests).

## Residuals / follow-ups

- **Golden-pin (optional)**: the representative golden can be swapped for the exact captured
  `/home` bytes above (a small test-only follow-up); the validation-via-revert already locks the
  regression, so this is documentation determinism, not a gap.
- **macOS ancestor narrowing** — deferred (darwin stays strict); its own follow-up.
- `proveOwnershipAndMode` / leaf `source-acl` / `LINUX_BASE_ENTRY` untouched.

## Verdict

PASS. In trunk (`150f2bcf`), released `1.35.1`, 3vr all-CLEAN with an empirical safety proof, the
`/home` over-refusal closed and validated by revert. Ready for archive.
