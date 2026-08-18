# Proposal: Narrow the POSIX Ancestor ACL Predicate to Path-Endangering Entries (JD-P-001)

## Intent

The transactional SkillGuard installer refuses to install under any ancestor
directory carrying an extended POSIX ACL. `secure-fs-posix.ts:126`
(`LINUX_BASE_ENTRY`) treats **every** non-base getfacl entry — named-user,
named-group, `mask::`, `default:*` — as fatal. Real hosts carry benign
extended entries (GitHub `ubuntu` `/home`, corporate machines with inherited
ACLs), so the install refuses under `$HOME` (JD-P-001). This forced the CI-only
`JF_INT_BASE=/jf-int` workaround.

**Narrow precisely: refuse exactly the ACL entries that let a foreign principal
swap, delete, or rename an on-path node — never less — while keeping the
managed-container guarantee byte-identical.** The current failure is
over-refusal (fail-closed); every edge stays refuse/unknown, so the direction is
safe: over-refusal → never fail-open.

## Scope

### In Scope
- Lenient Linux ancestor predicate `proveNoEndangeringAcl` (mask/effective computation + owner-uid sourcing).
- Re-add the STRICT any-extended-ACL check into POSIX `proveManagedContainer` (today only `proveOwnershipAndMode`).
- Role-aware gate: apply lenient at the preflight ancestor gate AND the `gateStillValid` ancestor re-prove arm; strict-vs-lenient selected by the existing `managedContainers` set — no `process.platform` in the engine.
- Tests: unit (mask-intersection, owner/root/euid carve-out, named-group effective-w, default tolerance, malformed→refuse, mask-absent→refuse) + real-`getfacl` integration.
- Revert the `JF_INT_BASE=/jf-int` CI workaround as validation.

### Out of Scope
- macOS ancestor narrowing — DEFERRED (Linux-only priority); the lenient method no-ops to existing strict behavior on macOS. Documented follow-up.
- Any change to `proveOwnershipAndMode`'s mode/owner checks.
- The leaf `source-acl` strict check — stays strict.
- Approach B (mask-ignoring heuristic) — REJECTED in exploration: false-refuses masked read-only named entries, reintroducing the over-refusal bug.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `skillguard-transactional-install-posix`: the ancestor ACL predicate loosens from any-extended-entry to path-endangering-only; the strict any-extended-ACL guarantee relocates into POSIX `proveManagedContainer` so the net guarantee on `.claude`/`.claude/hooks` is unchanged.

## Approach

Approach A — full effective-permission computation (DECIDED; do not reopen).

On an **ancestor** directory only, compute per getfacl entry:
- **REFUSE** a named-user with foreign uid (∉ {dir-owner, 0, euid}) AND effective `w`; a named-group with effective `w` (all named groups treated as potentially-foreign). Effective = raw ∩ mask, computed ourselves.
- **ALLOW** base `user::`/`group::`/`other::` (base write already owned by `proveOwnershipAndMode`'s `mode & 0o022`); `mask::` alone (a ceiling, parsed to compute effective); named entries whose effective lacks `w`; x-only foreign (traverse ≠ endanger); owner/root/euid named entries; `default:*` (inheritance-only, backstopped by the strict managed-container check on the created `.claude`).
- **FAIL-CLOSED** (refuse/unknown, unchanged): getfacl absent/timeout/nonzero, unparseable line, named-w with mask absent/unparseable, symlink ancestors (O_NOFOLLOW upstream).

This faithfully mirrors the ratified Windows Predicate A split: a lenient uniform gate plus extra strictness inside `proveManagedContainer`, with the core selecting by which method it calls — no platform branch in the engine.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/secure-fs-posix.ts` | Modified | Add `proveNoEndangeringAcl` (lenient parser, mask/effective, owner-uid source); keep strict `proveNoExtendedAcl`. |
| `src/lib/secure-fs-transaction.ts` | Modified | Role-aware ancestor gate + `gateStillValid` arm; POSIX `proveManagedContainer` gains strict ACL check. |
| Unit + integration tests | New | Mask/carve-out/named-group/default/malformed + real-`getfacl`. |
| CI linux-support suite | Modified | Move fixture base back under `$HOME`/`RUNNER_TEMP`, drop `JF_INT_BASE`. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Security loosening on a fail-closed installer | High impact | Judgment-Day / 3vr MANDATORY at review; direction is over-refusal→never fail-open. |
| `/home` default-ACL disposition wrong | Med | Pin the exact `getfacl /home` line as a golden fixture in design before deciding default-ACL tolerance. |
| Inconsistent lenient application (gate vs re-prove) | Med | Apply lenient at BOTH preflight gate and `gateStillValid`; select by `managedContainers` set. |
| Managed-container guarantee weakened | Low | Strict any-extended-ACL check re-added to `proveManagedContainer`; net guarantee on `.claude` byte-identical. |

## Rollback Plan

Single-capability change in two source files. Revert both files to restore the
blunt any-extended-entry refusal; re-apply the `JF_INT_BASE=/jf-int` CI
workaround. No data/schema migration, no runtime state — pure code revert.

## Dependencies

- `getfacl` (already a hard dependency of the current adapter).
- The exact `getfacl /home` golden fixture captured from the CI precondition artifact (pinned in design).

## Success Criteria

- [ ] Foreign write named-user / effective-w named-group on an ancestor → REFUSE.
- [ ] Masked read-only named entry, x-only, owner/root/euid, `mask::` alone, `default:*` on an ancestor → ALLOW.
- [ ] All fail-closed edges (getfacl absent/timeout/nonzero, unparseable, mask-absent-with-named-w, symlink) → refuse/unknown.
- [ ] `.claude`/`.claude/hooks` still refuse ANY extended ACL entry (guarantee unchanged) via `proveManagedContainer`.
- [ ] `/home`-class golden fixture → ALLOWED under the narrowed predicate.
- [ ] linux-support integration suite fixture base moved back under `$HOME`/`RUNNER_TEMP` and `JF_INT_BASE=/jf-int` dropped, suite green.
