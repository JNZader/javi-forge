# skillguard-transactional-install-windows Specification

## Purpose

This specification defines Slice 3b: the win32 binding for SkillGuard's transactional install/repair. It closes the gap left by Slice 3a, where `selectSecureFs(win32)` returns `null` and `_run` refuses with `windows-secure-object-unavailable`. It defines the OBSERVABLE contract the win32 `PlatformSecureFs` adapter and its packaged helper must guarantee — not the ACL predicate, invocation protocol, or `.ps1` internals, which are design-phase decisions. Every requirement here MUST hold regardless of which design choice resolves those open questions.

## Terms

| Term | Meaning |
|---|---|
| **win32 adapter** | The `PlatformSecureFs` implementation selected by `selectSecureFs` when `process.platform === "win32"`. |
| **helper** | The packaged `assets/claude-hooks/javi-forge-windows-secure-object.ps1`, the only place a Windows shell/process runs for this feature. |
| **trusted-clean DACL** | The win32 analog of POSIX's "no extended ACL": a DACL containing only the design-selected trusted principal set with no unexpected explicit or inherited ACE. |
| **ownership proof** | Confirmation the current process identity is the owner of the target/directory, win32-equivalent of POSIX owner+mode proof. |
| **identity check** | A Windows analog of POSIX `dev`+`ino` used to detect a path swapped out from under a held handle. |
| **digest binding** | The sha256 of the helper's bytes recorded in `manifest.json` and verified before invocation, mirroring the `.mjs` asset binding. |

## Requirements

### Requirement: The win32 adapter implements every `PlatformSecureFs` method with POSIX-equivalent fail-closed guarantees

The win32 adapter MUST implement all 11 `PlatformSecureFs` methods (`openDirNoFollow`, `revalidateIdentity`, `proveOwnershipAndMode`, `proveNoExtendedAcl`, `createDirExclusive`, `captureFile`, `writeExclusive`, `applyExactMode`, `renameInDir`, `unlinkIfIdentity`, `rmdirIfIdentityEmpty`). Each MUST refuse rather than degrade when it cannot prove its guarantee, matching the strength of the POSIX adapter's contract.

#### Scenario: A reparse point or symlink target is refused

- GIVEN a controlling directory or target path is a reparse point, junction, or symlink
- WHEN `openDirNoFollow` or `captureFile` opens it
- THEN the call refuses and no handle backed by the reparse point is returned

#### Scenario: Non-owner or overly-permissive object is refused

- GIVEN the current process identity does not own the target, or the effective access grants write to a principal outside the trusted set
- WHEN `proveOwnershipAndMode` evaluates the object
- THEN it refuses before any mutation, naming the offending path

#### Scenario: A DACL outside the trusted-clean set is refused

- GIVEN a controlling directory or target carries an ACE not in the design's trusted-clean set (unexpected explicit or inherited grant)
- WHEN `proveNoExtendedAcl` evaluates the DACL
- THEN it refuses and never proceeds on a partial or inconclusive DACL read

#### Scenario: Exclusive creation never silently overwrites

- GIVEN a path already exists
- WHEN `createDirExclusive` or `writeExclusive` targets that path
- THEN creation fails without touching the existing object's bytes or attributes

#### Scenario: `captureFile` refuses a non-regular target

- GIVEN the target is a directory, reparse point, device, or other non-regular object
- WHEN `captureFile` is invoked
- THEN it refuses and captures no bytes

#### Scenario: `renameInDir` never leaves a torn or missing file

- GIVEN a same-directory replace is in progress
- WHEN the rename commits (success or the process is interrupted mid-commit)
- THEN the target directory contains either the complete prior file or the complete new file — never a truncated, empty, or missing file — and the containing directory's durability is flushed before the call returns success

#### Scenario: Identity drift aborts a pending mutation

- GIVEN a held directory or file identity no longer matches on revalidation
- WHEN `revalidateIdentity` is checked immediately before or after a mutation
- THEN the transaction aborts as a concurrent modification rather than proceeding on a stale handle

### Requirement: `selectSecureFs(win32)` returns a working adapter and `_run` mutates transactionally

`selectSecureFs` MUST return a non-null, fully-functional `PlatformSecureFs` on win32. `claude-hook-manager.ts`'s `_run` MUST route win32 through `runTransaction` like every other platform and MUST NOT return the fixed `windows-secure-object-unavailable` reason for any state that would otherwise proceed on POSIX.

#### Scenario: Windows install performs a real mutation

- GIVEN the host platform is win32 and both components classify `absent` under a safely gated parent chain
- WHEN install runs
- THEN the managed asset and settings-entry are created on disk, not refused
- AND the result reports the changed paths

#### Scenario: Windows refusal paths still mutate nothing

- GIVEN a component classifies as an unsafe state (foreign, symlink, non-regular, malformed) or the parent chain fails proof
- WHEN install or repair runs on win32
- THEN it refuses with an actionable reason and no target is mutated, symmetric with the POSIX refusal contract

### Requirement: The helper is digest-bound and tamper-evident

`manifest.json`'s `installerHelpers.windowsSecureObject` MUST hold `{name, sha256}` for the packaged `.ps1`, no longer `null`. The runtime MUST compute the on-disk helper's sha256 and compare it to the manifest value before invoking the helper for any mutation. `pnpm package:check` MUST fail if the helper is missing from the package or its digest does not match the manifest.

#### Scenario: A tampered or mismatched helper is never invoked

- GIVEN the on-disk helper's bytes do not hash to the manifest-recorded sha256
- WHEN the win32 adapter is about to invoke the helper
- THEN it refuses before invocation and performs no mutation

#### Scenario: Packaging fails closed on omission or mismatch

- GIVEN the packaged tarball omits the `.ps1` or its digest does not match `manifest.json`
- WHEN `pnpm package:check` runs
- THEN it exits non-zero and names the omission or mismatch

### Requirement: The asset-binding guard test asserts the real digest, not the `null` placeholder

`claude-hook-assets.test.ts` MUST assert that `installerHelpers.windowsSecureObject` equals the real `{name, sha256}` of the on-disk helper. It MUST NOT continue to pin `windowsSecureObject: null`.

#### Scenario: The guard fails if the binding regresses to null

- GIVEN a future change reverts `manifest.json`'s `windowsSecureObject` to `null` without updating the test
- WHEN the test suite runs
- THEN the assertion fails, because it checks the real computed digest rather than a hardcoded `null`

### Requirement: The agnostic core stays behavior-identical and host-independently testable

`runTransaction` and the state→action matrix MUST remain unchanged by this slice and MUST continue to pass their existing fake-adapter test suite unmodified. Win32-specific behavior MUST be exercised through the real win32 adapter, not by relaxing or duplicating the agnostic core's contract.

#### Scenario: The fake-adapter suite is unaffected by the win32 adapter's existence

- GIVEN the win32 adapter is now wired into `selectSecureFs`
- WHEN the existing `runTransaction` fake-adapter tests run on any host
- THEN they pass unchanged, proving the agnostic core did not absorb win32-specific logic

### Requirement: A real `windows-latest` CI job is the verification gate for win32 fail-closed behavior

A CI job on the real `windows-latest` runner MUST exercise the win32 secure-fs adapter and manager against real reparse points, real DACLs, and a real commit/rename path, asserting each fail-closed guarantee in this spec. This job MUST be required before merge; inspection or mocked-only tests are insufficient proof of these guarantees.

#### Scenario: The CI job proves fail-closed behavior on real Windows

- GIVEN a `windows-latest` runner
- WHEN the job creates a reparse point, a non-trusted DACL, and an in-flight rename scenario against the win32 adapter
- THEN each asserts the specified refusal or atomic-commit outcome, and the job fails if any behavior degrades silently

#### Scenario: A failing CI job blocks the change

- GIVEN the `windows-latest` job fails any fail-closed assertion
- WHEN the PR/MR is evaluated
- THEN the change is not mergeable until the failure is resolved

## Non-Goals

- CLI dispatch (`hooks install/doctor/repair claude`), `init` rewiring, and the effective-execution `RUNNABLE`/`BLOCKED`/`INCONCLUSIVE` matrix — Slice 4.
- OpenCode/Codex agent-agnostic adapters — separate later arc.
- The specific Windows ACL-clean predicate, the invocation protocol (per-call spawn vs. session process), and empirical FlushFileBuffers/reparse-point verification mechanics — design-phase decisions; this spec constrains only their observable outcomes.
- Any change to the POSIX adapter or `runTransaction`'s agnostic contract.
