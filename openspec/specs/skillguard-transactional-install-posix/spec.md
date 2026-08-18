# skillguard-transactional-install-posix Specification

## Purpose

This specification amends `skillguard-pretooluse-hook` with Slice 3a ("Transactional install/repair", POSIX write path). It defines the observable behavior of the two mutation seams `installClaudePreToolUse` and `repairClaudePreToolUse` on Linux and macOS: an idempotent, ownership-safe transaction driven by the Slice-2 nine-state classifier and the design's state→action matrix. It delivers the held-handle parent-chain gate, same-directory exclusive backups, atomic temp/fsync/exact-mode/rename commit, and guarded reverse-order rollback as host-independent library behavior. Windows mutation is defined-but-deferred to Slice 3b. This slice is defense in depth for the installer's write side, not a CLI route, init rewiring, effective-execution matrix, or uninstall command: those remain in Slice 4.

## Terms

The following terms are normative:

| Term | Meaning |
|---|---|
| **asset** | The project-local runtime file `.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs`. |
| **settings-entry** | The owned `hooks.PreToolUse` matcher-group handler inside `.claude/settings.json`. |
| **component** | Either the asset or the settings-entry, classified independently via Slice 2. |
| **state** | One of the nine Slice-2 states: `absent | managed-current | released-outdated | exact-legacy | edited-managed | foreign | symlink | non-regular | malformed`. |
| **controlling directory** | Any existing directory from the filesystem root through a target's parent that governs a path component. |
| **parent-chain gate** | The held-no-follow-handle, identity, ownership, and ACL-absence proof over every controlling directory. |
| **exact-legacy cohort** | The complete one-of-each set of four v0 legacy objects recognized by Slice 2. |
| **ACL adapter** | The bounded, locale-`C` platform inspector proving no extended POSIX ACL: Linux `getfacl`, macOS `/bin/ls -lde`. |
| **transaction hash** | A SHA-256 the transaction computes over the bytes it wrote to a committed target. |
| **injectable seam** | The clock, 8-hex nonce source, `PlatformSecureFs`/ACL adapter, and fs-fault points supplied for host-independent tests. |
| **refuse** | Stop before any target mutation, name an actionable reason and first offending path, and leave every target byte- and mtime-unchanged. |

## Requirements

### Requirement: Install and repair follow the state→action matrix per component

Install and repair MUST classify the asset and settings-entry independently via Slice 2, plan both before mutating either, and apply exactly the matrix action for each state: `absent`→install, `released-outdated`→upgrade, `exact-legacy`→migrate, `managed-current`→zero-write no-op, `edited-managed`→refuse (only `repair --force` proceeds, after a byte-exact backup), and `foreign | symlink | non-regular | malformed`→refuse untouched. Neither mode MAY force `foreign`, `symlink`, `non-regular`, `malformed`, or partial-legacy content. `exact-legacy` migration MUST remove only the proven exact four-object cohort and install the managed objects, preserving every non-cohort sibling.

#### Scenario: Absent components are installed

- GIVEN both components classify `absent` under a safely gated parent chain
- WHEN install runs
- THEN the managed asset and settings-entry are created
- AND the result reports the changed paths

#### Scenario: Released-outdated upgrades and exact-legacy migrates

- GIVEN a component classifies `released-outdated` or the settings holds the complete exact-legacy cohort
- WHEN install or repair runs
- THEN the outdated managed object is upgraded, or only the exact four-object cohort is removed and replaced by the managed entry
- AND every unrelated setting and hook remains present and unchanged in value

#### Scenario: Managed-current is a zero-write no-op

- GIVEN both components classify `managed-current`
- WHEN install or repair runs again
- THEN it performs no filesystem write
- AND every target's bytes and mtime are preserved exactly

#### Scenario: Edited-managed refuses unless forced with a prior backup

- GIVEN a component classifies `edited-managed`
- WHEN repair runs without `--force`
- THEN it refuses and names backup plus `repair --force` as the eligible path
- AND `repair --force` proceeds only after a byte-exact eligible backup succeeds, then replaces the object

#### Scenario: Unsafe states refuse untouched

- GIVEN a component classifies `foreign`, `symlink`, `non-regular`, `malformed`, or a partial-legacy cohort
- WHEN install, repair, or `repair --force` runs
- THEN the operation refuses with an actionable reason and no target is mutated

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

### Requirement: Writes are atomic with same-directory exclusive backups

The system MUST create any missing `.claude` and `.claude/hooks` parent one segment at a time with exclusive creation at mode `0o700`, opening/verifying/holding each before use, never blind recursive mkdir. Required forced backups MUST use the name `<original-basename>.javi-forge.bak.<YYYYMMDDTHHMMSSmmmZ>.<8-lowercase-hex>`, be created `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` at mode `0o600` with a bounded eight-candidate nonce retry, contain the complete prior bytes at the exact source mode with proven ACL absence, and never grant access broader than the source. Each replacement MUST stage a same-directory `<basename>.javi-forge.tmp.<pid>.<8hex>` file created exclusively and no-follow at `0o600`, write it, `handle.sync()`, apply the exact source mode, verify mode and ACL absence, then commit by same-directory rename. Commit order MUST be asset first, settings second, and the parent directory MUST be fsynced after each rename.

#### Scenario: Fresh install creates parents safely then stages

- GIVEN `.claude` and `.claude/hooks` are absent beneath a safely gated project directory
- WHEN install preflight succeeds
- THEN each missing parent is created exclusively at `0o700` one segment at a time and identity-revalidated before staging
- AND staging uses same-directory temp files, not the target path directly

#### Scenario: Backup captures exact prior bytes restrictively

- GIVEN `repair --force` must replace an `edited-managed` target
- WHEN the backup is created
- THEN it follows the `<base>.javi-forge.bak.<ISO-ms>.<8hex>` name, is created `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` at `0o600`, and contains the complete prior bytes at the exact source mode
- AND if an exclusive backup cannot be created safely, repair refuses before any target is changed

#### Scenario: Commit is atomic and asset-first

- GIVEN both temp files are written, fsynced, mode-applied, and verified
- WHEN commit proceeds
- THEN the asset is renamed into place first and the settings-entry second, each parent fsynced after its rename
- AND a failure while writing or flushing a temp file leaves the corresponding target with its complete prior bytes and reports no success

### Requirement: Rollback is guarded and stops on lost proof

If a second commit fails while the already-written target still matches this transaction's hash and the parent-chain gate still holds, the system MUST restore prior bytes in reverse order (or unlink a previously-absent target) and remove only identity-matched empty transaction-created directories. If proof is lost — the parent-chain gate no longer holds, or the committed target no longer matches the transaction hash (a concurrent post-commit edit) — the system MUST STOP automatic cleanup and emit manual-recovery guidance. Any resulting partial state MUST be doctor-detectable.

#### Scenario: Guarded rollback restores the earlier target

- GIVEN the asset committed successfully but the settings commit fails, the asset still matches the transaction hash, and the gate still holds
- WHEN rollback runs
- THEN it restores the asset to its exact pre-operation bytes (or unlinks it if it was previously absent) in reverse order and reports failure
- AND it removes only transaction-created directories that remain identity-matched and empty

#### Scenario: Lost proof stops auto-cleanup

- GIVEN a rollback is required but the committed target no longer matches the transaction hash or the parent-chain gate no longer holds
- WHEN rollback evaluates its guard
- THEN it stops automatic cleanup, leaves the partial state in place, and emits manual-recovery guidance
- AND the partial state is reportable by doctor

### Requirement: Settings merges preserve unrelated content structurally

The system MUST apply the Slice-2 pure plan structurally, re-serializing `.claude/settings.json` with two-space indentation plus a trailing newline. It MUST preserve every unrelated key, hook event, matcher group, handler, scalar value, and insertion order. A `managed-current` no-op MUST perform no serialization or write.

#### Scenario: Unrelated settings survive a managed mutation

- GIVEN settings contain unrelated keys, hook events, and handlers alongside the managed target
- WHEN a managed install, upgrade, or migrate re-serializes the file
- THEN every unrelated value and its insertion order are preserved
- AND the file uses two-space indentation and a trailing newline

### Requirement: Windows mutation is refused until Slice 3b

On Windows the system MUST refuse install and repair with the fixed reason `windows-secure-object-unavailable` and MUST NOT attempt any filesystem mutation. The `PlatformSecureFs` interface is defined in this slice; its Windows implementation is deferred to Slice 3b.

#### Scenario: Windows install refuses without mutation

- GIVEN the host platform is Windows
- WHEN install or repair runs
- THEN it refuses with `windows-secure-object-unavailable` and mutates no target
- AND it does not stage temp files or create parents

### Requirement: The mutation result is reconciled and refusals never mutate

`ClaudeHookMutationResult` MUST include `report: ClaudeHookDoctorReport` reconciled from post-operation classification, plus populated `changed`, `backups`, and `errors`. Install and repair MUST return this shape. On any refuse or `managed-current` no-op path the system MUST perform zero filesystem mutation (no target write, backup, temp, or directory creation).

#### Scenario: Successful mutation returns a reconciled report

- GIVEN an install or repair completes a real mutation
- WHEN it returns
- THEN the result carries `ok: true`, the changed paths, any backups, and a `report` reflecting the resulting component states

#### Scenario: Refusal produces no filesystem effect

- GIVEN any refuse or zero-write no-op path
- WHEN the operation returns
- THEN `report` and `errors` describe the outcome
- AND no file, backup, temp, or directory was created, modified, renamed, or removed

### Requirement: The transaction is host-independently testable

The clock, 8-hex nonce source, the ACL/secure-create adapter (`PlatformSecureFs`), and every fs-fault point (temp-open, temp-write, fsync, rename, second-target commit) MUST be injectable so identity, ACL, tool, handle, and rename faults are exercised deterministically without root or a special host. Adapter-refusal unit tests MUST run on every host. Real-ACL fixture tests MAY skip only when the host lacks the capability to create or inspect that ACL; the core state→action matrix MUST NOT be skipped behind a platform gate.

#### Scenario: Injected faults exercise every failure path

- GIVEN the clock, nonce, adapter, and fs-fault seams are injected
- WHEN tests trigger identity drift, ACL-tool absence, backup-collision, temp-write, fsync, rename, and second-target faults
- THEN each produces the specified refusal or guarded rollback deterministically without root

#### Scenario: Adapter-refusal tests always run; core matrix never platform-skips

- GIVEN a host lacking the capability to create a real extended ACL
- WHEN the suite runs
- THEN mocked adapter-refusal tests still run and assert `unsupported-posix-acl`/`unsafe-parent-chain`
- AND the state→action matrix acceptance tests run rather than being skipped for the platform

## Non-Goals

- The Windows secure-object `.ps1` helper, its manifest binding, packaging, `package:check` gate, and `windows-latest` `manager` CI job with DACL/reparse/network refusal tests — Slice 3b.
- Any CLI dispatch, `init` rewiring, the effective-execution `RUNNABLE`/`BLOCKED`/`INCONCLUSIVE` matrix, and any uninstall command — Slice 4.
- Changes to the Slice-1 runtime policy corpus or the Slice-2 read-only classifier/doctor semantics.
