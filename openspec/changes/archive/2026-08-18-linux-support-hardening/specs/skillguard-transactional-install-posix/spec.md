# Delta for skillguard-transactional-install-posix

## MODIFIED Requirements

### Requirement: A proven private parent chain gates every mutation

Before any pathname mutation the system MUST hold a no-follow (`O_DIRECTORY|O_NOFOLLOW`) directory handle for every controlling directory from root through each target parent, capture `dev`+`ino` identity from each handle, and revalidate that identity on the reopened path immediately before and after every mutation. Each controlling directory MUST be owned by the effective user or root and carry no group or other write bits. The ACL adapter MUST prove no named-user/group, `mask::`, `default:*`, or inherited/extended ACL entry. Any tool-absent, parse-error, unsupported-filesystem, or changed-output result MUST refuse with `unsupported-posix-acl`; any inconclusive identity/ownership/writability result MUST refuse with `unsafe-parent-chain`, naming the first offending path, before any target mutation. The system MUST NOT fall back to pathname-only (`lstat`-pair) checks as race protection.

When the refusal cause is that the ACL adapter itself is NOT RESOLVABLE on the host (Linux `getfacl` absent from `PATH`), the refusal detail MUST carry a distinct, machine-identifiable remediation code in addition to `unsupported-posix-acl`, and the rendered reason MUST name the `acl` package with at least the three distro-family examples (`apt install acl`, `apk add acl`, `dnf install acl`). A bare `acl <path>: getfacl absent` string with no package remediation is PROHIBITED. The remediation MUST NOT be emitted for adapter results that are resolvable but prove or suspect a real extended ACL — those remain plain `unsupported-posix-acl` refusals, because installing a package would not fix them.
(Previously: every ACL-adapter failure mode — including tool absence — refused with an opaque `unsupported-posix-acl` reason carrying no remediation and no package hint.)

#### Scenario: Group- or world-writable parent refuses

- GIVEN a controlling directory is group- or other-writable, or owned by another principal
- WHEN install or repair preflights the chain
- THEN it refuses with `unsafe-parent-chain` naming that directory and mutates no target

#### Scenario: Extended or inconclusive ACL refuses

- GIVEN a controlling directory has a named/mask/default ACL entry, or the ACL adapter is absent, times out, returns unsupported output, or its output changes during preflight
- WHEN the parent-chain gate evaluates the ACL adapter
- THEN it refuses with `unsupported-posix-acl` before any target mutation
- AND it never strips an ACL or degrades to mode-only checks

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

#### Scenario: A real extended ACL refuses without package remediation

- GIVEN `getfacl` IS resolvable and reports a named-user entry on a controlling directory
- WHEN the gate evaluates the adapter
- THEN it refuses with `unsupported-posix-acl` and mutates no target
- AND the refusal does NOT suggest installing the `acl` package

## ADDED Requirements

### Requirement: A real `ubuntu-latest` CI job is the verification gate for POSIX fail-closed behavior

A CI job on a real `ubuntu-latest` runner MUST exercise the POSIX secure-fs adapter and manager against a real `getfacl`/`setfacl` toolchain and a real commit/rename path, asserting each fail-closed guarantee in this spec. This job MUST be required before merge; mocked-adapter tests alone are insufficient proof of these guarantees, mirroring the `windows-latest` gate for the win32 adapter.

Every real-POSIX leg MUST root its fixtures at a PRIVATE base directory owned by the effective user at mode `0700` (for example `RUNNER_TEMP` or an `mkdtemp` under `$HOME`) and MUST NOT root them under a world-writable path such as `/tmp` (mode `1777`). The suite MUST assert the private-base precondition up front and MUST NOT contain skip branches that turn a refusal into a silently passing no-assert test; if a precondition does not hold, the suite FAILS.

The job MUST run two legs: a WITH-`acl` leg and a WITHOUT-`getfacl` leg. The WITHOUT leg MUST actively remove or shadow `getfacl` from the resolution path and MUST first assert that `getfacl` is genuinely unresolvable — a leg that runs while `getfacl` is still present proves nothing and MUST fail.

#### Scenario: With-acl leg proves clean install and idempotent re-run

- GIVEN an `ubuntu-latest` runner with `acl` installed and a private `0700` fixture base
- WHEN the leg runs install against a fresh project, then runs it again
- THEN the first run installs the managed asset and settings-entry through the real `getfacl` parent-chain gate
- AND the second run is a zero-write no-op with byte- and mtime-stable targets

#### Scenario: With-acl leg proves a real extended ACL refuses

- GIVEN a controlling directory in the private base carrying a real extended ACL applied via `setfacl`
- WHEN install runs
- THEN it refuses with `unsupported-posix-acl` and mutates no target
- AND the assertion runs unconditionally rather than being skipped for the platform

#### Scenario: Without-getfacl leg proves absence before asserting

- GIVEN the leg has removed or shadowed `getfacl` from the resolution path
- WHEN the leg starts
- THEN it asserts that `getfacl` is unresolvable and FAILS the job if `getfacl` still resolves
- AND only then does it exercise install

#### Scenario: Without-getfacl leg asserts the actionable refusal

- GIVEN `getfacl` is proven unresolvable in that leg
- WHEN install runs against the private `0700` base
- THEN it refuses fail-closed with the adapter-absent remediation naming the `acl` package
- AND no managed asset, settings-entry, backup, or temp file is created

#### Scenario: A world-writable fixture base fails rather than skips

- GIVEN the suite's fixture base is not a private `0700` directory owned by the effective user
- WHEN the suite runs its precondition assertion
- THEN the suite fails
- AND it does NOT return early from a refusal check, leaving assertions unexecuted

#### Scenario: A failing CI job blocks the change

- GIVEN either `ubuntu-latest` leg fails any fail-closed assertion
- WHEN the PR/MR is evaluated
- THEN the change is not mergeable until the failure is resolved
