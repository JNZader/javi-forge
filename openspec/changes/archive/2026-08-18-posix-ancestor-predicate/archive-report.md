# Archive Report — posix-ancestor-predicate (JD-P-001)

**Archived:** 2026-08-18
**Status:** COMPLETE — implemented, verified (PASS), 3vr all-CLEAN, merged, released `javi-forge@1.35.1`.
**Amends:** `skillguard-transactional-install-posix`.

## Summary

Narrows the POSIX **ancestor** ACL predicate in the shipped transactional installer from
"refuse ANY extended ACL entry" to "refuse only PATH-ENDANGERING entries", closing JD-P-001:
a benign inherited ACL on an ancestor (GitHub ubuntu-latest ships `/home` with a
`default:user:1001:rwx` entry; corporate hosts inherit similar) blocked install under `$HOME`
and forced the CI `JF_INT_BASE=/jf-int` workaround.

- **`proveNoEndangeringAcl`** (two-pass getfacl parser): REFUSE a foreign named-user (uid ∉
  {dir-owner, root, euid}) or any named-group with EFFECTIVE `w` (raw ∩ mask computed by us —
  getfacl's `#effective` suffix is only conditional); ALLOW base entries, mask-alone,
  effective-non-w named, x-only, trusted-uid, and `default:*` (inheritance-only). Every
  fail-closed edge still refuses. Owner-uid via an injectable `lstat` seam.
- **Strict/lenient split** (mirrors the ratified Windows Predicate A): `gate()` + both ancestor
  re-prove arms use the lenient predicate; POSIX `proveManagedContainer` gains the strict
  any-extended-entry check (re-homed from the uniform gate), so `.claude`/`.claude/hooks` refuse
  ANY extended entry byte-identically. The core selects strict-vs-lenient by the existing
  `managedContainers` set — no `process.platform` in the engine. Leaf `source-acl` +
  `applyExactMode` re-prove stay strict; Windows unchanged (already Predicate A); macOS lenient
  = strict no-op (deferred).
- **Validation-via-revert**: dropped `JF_INT_BASE=/jf-int`; the real-getfacl integration suite
  bases back under `$HOME`/`RUNNER_TEMP` and passes on GH runners → the `/home` over-refusal is
  empirically closed. A non-gating CI step captures `getfacl /home` (artifact `gh-home-getfacl`).

## The empirical safety property (why a security loosening is safe here)

3vr voice 1 proved via a setfacl/stat truth table that the POSIX ACL mask maps onto the st_mode
group class, so there is NO ACL combination granting a foreign principal effective write while
`mode & 0o022 == 0`. `proveOwnershipAndMode` (unchanged) therefore catches every effective-write
extended entry independently of the ACL parser — the loosening is structurally bounded by the
unchanged mode check (defense in depth; the ACL predicate is not the sole guard). The real
`/home` entry (`default:user:1001:rwx`) is inheritance-only, confirming the design's default-ACL
tolerance.

## Delivery

Single atomic PR #74 (loosen + strict-re-home cannot split without regressing the managed-container
guarantee), merged `150f2bcf`, released `1.35.1`, `size:exception`. Mandatory 3vr — three
independent adversarial voices (security / wiring / tests) all CLEAN; 2 LOW test-completeness
notes folded (security parser at 100% branch).

## Locked decisions

Approach A (full effective-permission computation; B rejected — false-refuses masked read-only
named entries); owner-uid via lstat; tolerate `default:*` on ancestors (inheritance-only,
backstopped by the strict managed check — empirically confirmed by real `/home`); strict re-homed
into `proveManagedContainer`; role selection by `managedContainers`; macOS deferred.

## Spec sync

Delta merged into `openspec/specs/skillguard-transactional-install-posix/spec.md`.

## Residuals / follow-ups

- **Golden-pin (optional)**: swap the representative golden for the captured exact `/home` bytes
  (`default:user:1001:rwx` + siblings) — a test-only follow-up; the validation-via-revert already
  locks the regression.
- **macOS ancestor narrowing** — deferred (darwin stays strict, over-refusal not the reported
  Linux bug); own follow-up.

## Remaining arcs

- **Agent-agnostic arc** (OpenCode/Codex) — the next big one.
- container-engine-linux (podman/SELinux, needs Fedora); macOS ancestor narrowing.

## Engram traceability

- proposal 15681 / spec 15682 / design 15683 / tasks 15684 / exploration 15634 / apply-progress 15701
- topic prefix `sdd/posix-ancestor-predicate/*`
