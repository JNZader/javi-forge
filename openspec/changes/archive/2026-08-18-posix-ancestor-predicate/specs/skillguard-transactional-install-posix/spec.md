# Delta for skillguard-transactional-install-posix

## MODIFIED Requirements

### Requirement: A proven private parent chain gates every mutation

Before any pathname mutation the system MUST hold a no-follow (`O_DIRECTORY|O_NOFOLLOW`) directory handle for every controlling directory from root through each target parent, capture `dev`+`ino` identity from each handle, and revalidate that identity on the reopened path immediately before and after every mutation. Each controlling directory MUST be owned by the effective user or root and carry no group or other write bits. The ACL adapter MUST prove the applicable ACL predicate, selected by the directory's role.

On an **ancestor** controlling directory (any controlling directory that is NOT an installer-managed container), the adapter MUST refuse ONLY when a foreign principal can endanger the on-path node: a named-user entry for a uid outside {the directory owner uid, 0/root, the process euid} whose **effective** permission (raw ∩ ACL mask) includes `w`; OR a named-group entry whose effective permission includes `w`. It MUST proceed for base `user::`/`group::`/`other::` entries (base group/other write remains gated by the mode check), a `mask::` entry alone, a named entry whose effective (post-mask) permission lacks `w`, a foreign named entry granting only `x` (traverse, not create/delete/rename), a named entry for a uid in {owner, root, euid}, and a `default:*` entry (which affects only future children, not the on-path node). It MUST still refuse fail-closed when getfacl is absent, times out, or exits nonzero; when any line is unparseable or unrecognized; when a named entry carries raw `w` while the mask is absent or unparseable (effective cannot be proven); or on a symlink ancestor (refused upstream by `O_NOFOLLOW`).

On an installer-**managed container** (`.claude`, `.claude/hooks`) the adapter MUST refuse ANY extended ACL entry — named-user, named-group, `mask::`, OR `default:*` — exactly as before; the net guarantee on managed containers is byte-identical.

The ancestor predicate MUST be applied identically at the preflight ancestor gate AND at the pre-commit/rollback re-prove, so an ACL that passes preflight is not refused at commit and vice-versa. Selection between the two predicates MUST be by the managed-container role (the existing managed-containers set), NOT by platform branching in the engine. On macOS the ancestor predicate MAY remain the current strict any-extended-entry behavior (deferred; documented, not a regression of the reported Linux bug).

Any tool-absent, parse-error, unsupported-filesystem, or changed-output result MUST refuse with `unsupported-posix-acl`; any inconclusive identity/ownership/writability result MUST refuse with `unsafe-parent-chain`, naming the first offending path, before any target mutation. The system MUST NOT fall back to pathname-only (`lstat`-pair) checks as race protection.

When the refusal cause is that the ACL adapter itself is NOT RESOLVABLE on the host (Linux `getfacl` absent from `PATH`), the refusal detail MUST carry a distinct, machine-identifiable remediation code in addition to `unsupported-posix-acl`, and the rendered reason MUST name the `acl` package with at least the three distro-family examples (`apt install acl`, `apk add acl`, `dnf install acl`). A bare `acl <path>: getfacl absent` string with no package remediation is PROHIBITED. The remediation MUST NOT be emitted for adapter results that are resolvable but prove or suspect a real extended ACL — those remain plain `unsupported-posix-acl` refusals, because installing a package would not fix them.
(Previously: the ACL adapter refused any named-user/group, `mask::`, or `default:*` entry uniformly on EVERY controlling directory — including benign ancestor ACLs — so installs under `$HOME`/`/home` over-refused; the strict any-extended-entry guarantee was not role-scoped.)

#### Scenario: Group- or world-writable parent refuses

- GIVEN a controlling directory is group- or other-writable, or owned by another principal
- WHEN install or repair preflights the chain
- THEN it refuses with `unsafe-parent-chain` naming that directory and mutates no target

#### Scenario: Foreign named-user with effective write on an ancestor refuses

- GIVEN an ancestor carries `user:<foreign-uid>:rwx` and the ACL mask leaves `w` effective, the uid being outside {owner, root, euid}
- WHEN install or repair evaluates the ancestor gate
- THEN it refuses before any target mutation
- AND no target byte or mtime changes

#### Scenario: Named-group with effective write on an ancestor refuses

- GIVEN an ancestor carries a named-group entry whose effective permission (raw ∩ mask) includes `w`
- WHEN the ancestor gate evaluates the adapter
- THEN it refuses, treating all named groups as potentially foreign, and mutates no target

#### Scenario: Masked read-only named entry on an ancestor proceeds

- GIVEN an ancestor carries `user:1000:rwx` under `mask::r--`, so the effective permission is `r--`
- WHEN the ancestor gate computes effective = raw ∩ mask
- THEN the entry is not path-endangering and the install proceeds past this ancestor
- AND this is the exact over-refusal being fixed

#### Scenario: Benign root-owned /home-class ancestor proceeds

- GIVEN a root-owned (uid 0) ancestor at mode `0755` carrying a benign extended entry (a `mask::`, a read-or-exec-only named entry, or a `default:*`) — the GitHub `/home` class
- WHEN the ancestor gate evaluates it
- THEN no foreign principal can endanger the on-path node and the install proceeds

#### Scenario: Non-endangering ancestor entries proceed

- GIVEN an ancestor whose only extended entries are `mask::` alone, a `default:*` entry, a foreign named entry granting only `x`, or a named entry for a uid in {owner, root, euid}
- WHEN the ancestor gate evaluates them
- THEN none is path-endangering and the install proceeds

#### Scenario: Ancestor fail-closed edges still refuse

- GIVEN an ancestor where getfacl is absent, times out, or exits nonzero; OR a line is unparseable/unrecognized; OR a named entry has raw `w` while the mask is absent or unparseable; OR the ancestor is a symlink
- WHEN the ancestor gate evaluates it
- THEN it refuses fail-closed and mutates no target

#### Scenario: Managed container still refuses any extended ACL

- GIVEN `.claude` or `.claude/hooks` carries a benign extended entry that WOULD be allowed on an ancestor (a `mask::`, a read-only named entry, or a `default:*`)
- WHEN the managed-container gate evaluates it
- THEN it still refuses with `unsupported-posix-acl` and mutates no target
- AND the loosening is proven ancestor-only

#### Scenario: Ancestor predicate is consistent across preflight and re-prove

- GIVEN an ancestor ACL that the path-endangering predicate accepts at the preflight ancestor gate
- WHEN the pre-commit/rollback `gateStillValid` re-prove evaluates that same ancestor
- THEN it applies the identical predicate and does not spuriously refuse at commit
- AND an ancestor ACL that the predicate refuses is refused identically at both points

#### Scenario: macOS ancestor predicate remains strict (deferred)

- GIVEN the host platform is macOS
- WHEN the ancestor gate evaluates a controlling directory carrying any extended ACL
- THEN it MAY refuse under the current strict any-extended-entry behavior
- AND this is a documented deferral, not a regression of the reported Linux bug

#### Scenario: Identity drift around a mutation aborts

- GIVEN a controlling directory's reopened `dev`+`ino` no longer matches the held handle before or after a pathname mutation
- WHEN the gate revalidates identity
- THEN the transaction aborts as a concurrent modification and does not proceed with pathname-only observations as proof

#### Scenario: Absent getfacl refuses with actionable package remediation

- GIVEN `getfacl` is not resolvable on `PATH` on a Linux host
- WHEN install or repair preflights the parent chain
- THEN it still refuses fail-closed and mutates no target
- AND the refusal carries the adapter-absent remediation code and names the `acl` package with `apt install acl`, `apk add acl`, and `dnf install acl` examples

#### Scenario: Absent-adapter refusal is never a bare opaque string

- GIVEN the adapter-absent refusal path is taken
- WHEN the refusal detail is produced
- THEN it is not solely the literal `getfacl absent` text
- AND a consumer can distinguish adapter-absent from other `unsupported-posix-acl` causes without string-matching the reason prose

## ADDED Requirements

### Requirement: The narrowed ancestor predicate is validated by reverting the CI base workaround

The linux-support integration suite MUST drop the `JF_INT_BASE=/jf-int` workaround and root its fixtures back under `$HOME`/`RUNNER_TEMP`, and MUST pass under the narrowed ancestor predicate. Design MUST pin the exact `getfacl /home` line as a golden fixture before deciding `default:*` disposition. A suite that still requires `JF_INT_BASE` to pass is proof the narrowing is incomplete.

#### Scenario: linux-support suite passes under $HOME without the workaround

- GIVEN the linux-support integration suite roots fixtures under `$HOME`/`RUNNER_TEMP` with `JF_INT_BASE` dropped
- WHEN the suite runs on a real `ubuntu-latest` runner whose `/home` carries its benign extended entry
- THEN the narrowed ancestor predicate allows the benign `/home`-class ancestor and the suite is green
- AND the pinned `getfacl /home` golden fixture matches the runner's observed ACL
