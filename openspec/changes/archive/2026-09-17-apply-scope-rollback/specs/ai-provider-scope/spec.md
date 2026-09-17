# apply-scope rollback Specification

## Purpose

Define restore of an `apply-scope` backup onto one explicit Pi or OpenCode
config path, matching the safety contracts of `profile-apply --rollback`.

## Terms

| Term | Meaning |
| --- | --- |
| **backup** | Operator path passed as `--rollback`. Typically `*.bak-<UTC>` from apply. |
| **dest** | Explicit `--pi-settings` or `--opencode-config` file. |
| **safety snapshot** | `dest.pre-rollback-<UTC>` written with `wx` when dest exists. |
| **restore tmp** | `dest.rollback-tmp-<UTC>` written with `wx` then `rename`d onto dest. |

## Requirements

### Requirement: Rollback is single-target only

Rollback MUST require `--target pi` or `--target opencode`. It MUST refuse
`--target both` and MUST refuse an omitted target.

#### Scenario: both is refused

- GIVEN `--rollback` is set
- WHEN `--target both` is passed
- THEN the command fails without writing dest or applying a pass-list

#### Scenario: omitted target is refused

- GIVEN `--rollback` is set
- WHEN `--target` is omitted
- THEN the command fails without writing dest (it MUST NOT default to both)

### Requirement: Dest path is explicit

Pi rollback MUST require `--pi-settings`. OpenCode rollback MUST require
`--opencode-config`. There MUST NOT be a homedir default.

#### Scenario: missing dest flag fails closed

- GIVEN `--rollback` and `--target pi`
- WHEN `--pi-settings` is omitted
- THEN the command fails and dest is not written

### Requirement: Missing backup fails closed

The backup path MUST be readable. ENOENT MUST fail with a missing-backup error
and MUST NOT write dest.

#### Scenario: absent backup

- GIVEN a dest file exists
- WHEN rollback is invoked with a missing backup path
- THEN it fails and dest bytes are unchanged

### Requirement: Rollback never applies

When `--rollback` is set, `apply-scope` MUST restore and MUST NOT read or apply
a pass-list even if `--pass-list` or a positional pass-list is present.

#### Scenario: rollback wins over pass-list

- GIVEN `--rollback`, `--target pi`, `--pi-settings`, and a pass-list path
- WHEN the command runs
- THEN it restores the backup and does not call apply-scope merge

### Requirement: Dest is snapshotted before clobber

When dest exists, rollback MUST write `dest.pre-rollback-<UTC>` with `wx`
before replacing dest. If that safety file already exists, rollback MUST fail
with EEXIST and MUST NOT change dest. If dest is absent, rollback MAY skip the
safety snapshot and MUST NOT mkdir a new parent tree beyond what
`profile-apply` rollback does.

#### Scenario: existing dest is snapshotted

- GIVEN dest contains current bytes and backup contains restored bytes
- WHEN rollback succeeds
- THEN dest equals backup bytes and the safety file contains the previous dest bytes

#### Scenario: existing safety file refuses

- GIVEN dest and a pre-existing `dest.pre-rollback-<same timestamp>`
- WHEN rollback runs with that timestamp
- THEN it fails with EEXIST and dest is unchanged

### Requirement: Restore is exclusive tmp plus rename

Rollback MUST write restored bytes to `dest.rollback-tmp-<UTC>` with `wx` and
MUST `rename` that file onto dest. It MUST NOT `copyFile` onto dest.

#### Scenario: successful restore leaves no tmp

- GIVEN a readable backup and writable dest
- WHEN rollback succeeds
- THEN dest matches backup and the rollback-tmp path does not exist

### Requirement: Dry-run writes nothing

`--dry-run` MUST verify the backup exists and MUST NOT write dest, safety, or
tmp files.

#### Scenario: dry-run

- GIVEN dest and backup exist
- WHEN rollback runs with `--dry-run`
- THEN dest bytes are unchanged and no new sibling files are created

### Requirement: No secrets or coordinator writes

Rollback MUST byte-restore the backup file onto dest. It MUST NOT edit
coordinator, `defaultProvider`, `defaultModel`, or OpenCode `agent` as a
special case, and MUST NOT write provider auth/secrets.

#### Scenario: byte restore

- GIVEN a backup whose JSON includes unrelated keys
- WHEN rollback succeeds
- THEN dest bytes equal the backup bytes
