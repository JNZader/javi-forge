# Tasks: Narrow the POSIX Ancestor ACL Predicate (JD-P-001)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~120-170 impl + ~150-200 test (goldens excluded) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single atomic PR (size:exception) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

Atomic constraint: the ancestor loosen (§2 predicate + §3 wiring) and the strict re-home into `proveManagedContainer` MUST land in ONE PR — splitting regresses the managed-container guarantee between commits. Do NOT slice. 3vr MANDATORY (security loosening on fail-closed installer).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Lenient predicate + split wiring + all tests + CI diagnostic | PR 1 | `pnpm test src/lib/secure-fs-posix.test.ts` | `JAVI_FORGE_LINUX_INT=1 pnpm test secure-fs-posix.integration` (real getfacl/setfacl, linux) | revert both `secure-fs-posix.ts` + `secure-fs-transaction.ts` to strict + re-add `JF_INT_BASE` |

## Phase 1: RED — failing unit tests (secure-fs-posix.test.ts)

- [x] 1.1 RED: masked-RO named-user (`user:5000:rwx`+`mask::r--`) → ALLOWED
- [x] 1.2 RED: foreign named-user effective-w (`user:5000:rwx`+`mask::rwx`) → REFUSED
- [x] 1.3 RED: named-group effective-w → REFUSED (all named groups potentially foreign)
- [x] 1.4 RED: x-only foreign (`user:5000:--x`) → ALLOWED
- [x] 1.5 RED: owner/root/euid named-user with w (id ∈ trusted) → ALLOWED
- [x] 1.6 RED: `default:user:5000:rwx` → ALLOWED (inheritance-only)
- [x] 1.7 RED: `mask::` alone → ALLOWED; base `user::`/`group::`/`other::` → ALLOWED
- [x] 1.8 RED: named entry raw-w with NO mask entry → REFUSED (fail closed)
- [x] 1.9 RED: unparseable/unrecognized line → REFUSED; malformed `mask::` → REFUSED
- [x] 1.10 RED: getfacl absent/timeout/nonzero → REFUSED (unchanged edges)
- [x] 1.11 RED: managed-container STILL strict — benign entry (`user:5000:r--` or `mask::r--`) ALLOWED on ancestor but `proveManagedContainer` REFUSES on `.claude`/`.claude/hooks`

## Phase 2: GREEN — predicate (secure-fs-posix.ts) [atomic with Phase 3]

- [x] 2.1 Implement `proveNoEndangeringAcl` two-pass parser: PASS 1 parse `mask::` (refuse malformed); PASS 2 classify base/mask/default ALLOW, named via `checkNamed`
- [x] 2.2 `checkNamed`: no-w→allow; raw-w+no-mask→refuse; `effective = raw ∩ mask`; trusted-uid carve-out `{ownerUid via lstat, 0, euid}`; foreign named-user or any named-group effective-w→refuse. Reuse `ACL_DETAIL.extendedAclEntry`
- [x] 2.3 Keep spawn UNCHANGED: `--absolute-names --numeric --omit-header`, `LC_ALL=C`, 2s bound; all spawn-fail edges refuse
- [x] 2.4 Expose on `createPosixSecureFs` delegating to `acl`; darwin adapter `proveNoEndangeringAcl = proveClean` (no-op to strict, documented deferral)
- [x] 2.5 POSIX `proveManagedContainer` gains strict `acl.proveClean` AND-ed with `proveOwnershipAndMode`. `LINUX_BASE_ENTRY`, `proveClean`, leaf `source-acl`, `applyExactMode` UNCHANGED

## Phase 3: GREEN — split wiring (secure-fs-transaction.ts) [atomic with Phase 2]

- [x] 3.1 Add `proveNoEndangeringAcl` to `PlatformSecureFs` interface
- [x] 3.2 `gate()` :292 → `proveNoEndangeringAcl` (lenient); `gateStillValid()` :364 ancestor arm → `proveNoEndangeringAcl`
- [x] 3.3 Managed-container arms (:367-371, `ensureManagedContainer` :320/:351) call UNCHANGED — strict now inside `proveManagedContainer`. Selection by `managedContainers` set, NO `process.platform`
- [x] 3.4 Verify `.claude` net guarantee: lenient-gated THEN strict-managed = any-extended-entry refuses, byte-identical to today (Phase 1.11 green)

## Phase 4: Integration + CI (secure-fs-posix.integration.test.ts, claude-hook-linux.yml)

- [x] 4.1 Real-getfacl test (linux-only, `JAVI_FORGE_LINUX_INT`-gated, private 0700 base): `setfacl -m u:$FOREIGN:r` masked-RO ALLOWED; `setfacl -m u:$FOREIGN:rwx` REFUSED; root-owned /home-class benign ALLOWED
- [x] 4.2 Validation-via-revert: drop `JF_INT_BASE=/jf-int` from workflow + revert suite base resolution to `$HOME`/`RUNNER_TEMP` (privateRoot). Suite green under `$HOME` = /home allowed = JD-P-001 closed. NOTE: if CI /home carries an unexpected endangering entry, that is a design-revisit trigger, not a test edit
- [x] 4.3 CI diagnostic step (with-acl leg, non-gating `|| true`): dump `getfacl --absolute-names --numeric --omit-header -- /home` → job log + `$RUNNER_TEMP/getfacl-home.txt`, upload artifact `gh-home-getfacl`
- [x] 4.4 Land REPRESENTATIVE golden fixture now (root-owned uid0 mode0755 + benign mask/read-only-named/default)

## Phase 5: Gates + follow-up

- [x] 5.1 `pnpm validate` + `pnpm test:coverage` (85/80) green
- [x] 5.2 FOLLOW-UP note: after first green CI run, pin exact `gh-home-getfacl` bytes into the fixture constant in a separate commit (representative → captured). The revert (§4.2) is the real empirical proof, not the golden
