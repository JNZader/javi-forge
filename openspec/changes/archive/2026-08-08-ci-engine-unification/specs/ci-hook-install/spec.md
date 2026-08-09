# Delta for ci-hook-install

New capability (`openspec/specs/` is empty). Hook BEHAVIOR is unchanged by this change; only the
marker and the write policy are new.

## ADDED Requirements

### Requirement: Versioned marker and content hash

Each installed hook MUST carry a stable marker line `# javi-forge-hook: {name} v{N}` plus a content
hash line, both as shell comments so the hook stays executable and behaviorally identical.

#### Scenario: Freshly installed hook is self-identifying

- GIVEN a git repo with no hooks
- WHEN `ci init` runs
- THEN each written hook contains its marker line and a hash line
- AND the hook executes with the same observable behavior as the pre-change template

### Requirement: Classify before write

`installCIHooks` MUST classify each target path BEFORE writing, and MUST NOT write without a
decision. The reported vocabulary is exactly the `states[]` strings: `absent`, `managed-current`,
`managed-outdated`, `managed-edited`, `legacy-v0`, `foreign`, `symlink`, `not-a-file`.

- `absent` MUST be written and reported as installed.
- `managed-current` (marker names THIS hook, marker version equals the manifest version, and the
  body hash equals the manifest hash) MUST NOT be written at all — a re-install is a NO-OP that
  leaves bytes and mtime untouched. Its mode MAY still be repaired to 0755 in place, since `chmod`
  writes no bytes and preserves mtime.
- `managed-outdated` (marker names this hook and the body hash matches a released body, but the
  marker version is stale or the body is an earlier release) MUST be upgraded to the current
  template and reported as upgraded.
- `symlink` and `not-a-file` MUST be refused with the target left intact, EVEN with force.
- Per-hook failures MUST stay isolated: one refusal MUST NOT block the sibling hooks.

Every hook the command writes MUST end up mode 0755, on EVERY write path — fresh install, upgrade
and forced overwrite alike. A mode applied only at file creation is insufficient, because
overwriting a non-executable file leaves it non-executable and git skips it silently.

#### Scenario: Absent hook is written

- GIVEN `.git/hooks/pre-commit` does not exist
- WHEN `ci init` runs
- THEN the hook is written with mode 0755 and reported as installed

#### Scenario: Current managed hook is a no-op

- GIVEN a hook whose marker names it, whose marker version is current and whose body hash matches
- WHEN `ci init` runs, with or without force
- THEN no bytes are written, its mtime is unchanged, and it is reported neither installed nor upgraded

#### Scenario: Outdated managed hook is upgraded

- GIVEN an existing hook whose marker names it and whose body matches a released template, under a
  stale marker version
- WHEN `ci init` runs, with or without force
- THEN the hook is overwritten with the current template, reported as upgraded, and no backup is taken

#### Scenario: Overwritten hook regains the exec bit

- GIVEN an existing non-executable (0644) hook that `ci init` is allowed to replace
- WHEN `ci init` runs
- THEN the resulting hook is mode 0755

#### Scenario: Non-regular path is refused

- GIVEN `.git/hooks/pre-commit` is a symlink, or a directory
- WHEN `ci init` runs, with or without force
- THEN it is classified `symlink` or `not-a-file`, refused with a named reason, and the pointed-at
  file or directory is left intact

### Requirement: Legacy unmarked fleet content is upgradable

An existing hook with NO marker whose bytes are identical to a known released shipped template
(including the CURRENT one — the marker, not the content, is what makes a hook managed) MUST be
classified as `legacy-v0` and upgraded. This MUST NOT require user intervention (R2: ~8 consumer
repos run unmarked hooks and would otherwise be refused).

#### Scenario: Old fleet repo re-inits cleanly

- GIVEN a repo whose `pre-commit` is byte-identical to a released javi-forge template and has no marker
- WHEN `ci init` runs
- THEN it is classified `legacy-v0`, upgraded, and no refusal is reported

#### Scenario: One byte of drift is not legacy

- GIVEN a hook that differs from every released template by at least one byte and has no marker
- WHEN `ci init` runs
- THEN it is classified `foreign`, not `legacy-v0`

### Requirement: Marker present but content drifted is edited, not legacy

A hook carrying a marker that names THIS hook, whose body hash matches neither the current nor any
released template, MUST be classified `managed-edited`. A marker naming a DIFFERENT hook MUST be
classified `foreign`: someone else's marker never grants permission to overwrite this slot.

#### Scenario: Marker for another hook does not grant consent

- GIVEN `.git/hooks/pre-commit` carries a valid `pre-push` marker
- WHEN `ci init` runs without force
- THEN it is classified `foreign` and refused

### Requirement: No-clobber policy for foreign and edited hooks

`installCIHooks` MUST refuse to overwrite a `foreign` or `managed-edited` hook unless an
explicit force is given. The refusal MUST name the hook and state the classification reason, MUST
leave the file byte-unchanged, and MUST NOT abort installation of the other hooks. This closes B4.

The refusal MUST describe what force would ACTUALLY do. It MUST NOT promise a backup that will not
happen: when the `.bak` path is occupied by a symlink or a non-regular file, the message MUST say
that force will REFUSE the hook until that path is removed. The probe MUST be `lstat`, never an
existence check that follows symlinks.

#### Scenario: Foreign hook is preserved

- GIVEN a hand-written `pre-commit` with no javi-forge marker
- WHEN `ci init` runs without force
- THEN the file is unchanged on disk
- AND the reported reason identifies it as not managed by javi-forge

#### Scenario: Edited managed hook is preserved

- GIVEN a hook carrying a valid marker but whose content hash no longer matches
- WHEN `ci init` runs without force
- THEN the file is unchanged and reported as locally modified

#### Scenario: Refusal does not promise an impossible backup

- GIVEN a foreign `pre-commit` and a symlink parked at `pre-commit.bak`
- WHEN `ci init` runs without force
- THEN the message names the obstructing path and states that force will refuse until it is removed
- AND it does NOT claim the file would be saved as a backup

#### Scenario: Refusal does not block sibling hooks

- GIVEN `pre-commit` is foreign and `commit-msg` is absent
- WHEN `ci init` runs without force
- THEN `commit-msg` is installed and `pre-commit` is refused

### Requirement: Forced overwrite backs up first

When force is given for a `foreign` or `managed-edited` hook, the previous content MUST be
written to a `.bak` sibling file BEFORE the new hook is written. If the backup cannot be written,
the hook MUST NOT be overwritten.

A backup target is a write target and MUST get the same protection as the hook path: every
candidate MUST be `lstat`ed and a symlink or non-regular file MUST be refused even with force, and
creation MUST be exclusive (`COPYFILE_EXCL`) so a backup can never clobber an earlier one. Force
MUST NOT trigger a backup for a state that would be written anyway (`absent`, `legacy-v0`,
`managed-outdated`), and MUST NOT write at all for `managed-current`.

#### Scenario: Backup precedes overwrite

- GIVEN a foreign `pre-commit` and an explicit force
- WHEN `ci init` runs
- THEN a `.bak` file holds the original bytes
- AND `pre-commit` holds the current template

#### Scenario: Force does not back up what it would write anyway

- GIVEN a `legacy-v0` or `managed-outdated` hook and an explicit force
- WHEN `ci init` runs
- THEN the hook is upgraded and no `.bak` file is created

### Requirement: A broken install surfaces as a named error

Failure to read the shipped hook manifest, or a manifest missing or malformed for a given hook,
MUST be reported as a named entry in `errors[]` naming the manifest path, the reason and the remedy
(reinstall or repack javi-forge). It MUST NOT escape as an unhandled rejection or a `TypeError`, and
a per-hook manifest defect MUST NOT block the sibling hooks.

#### Scenario: Unreadable manifest is reported, not thrown

- GIVEN the shipped `assets/hooks/manifest.json` cannot be read
- WHEN `ci init` runs
- THEN no hook is installed and one error names the manifest path, the reason and the remedy

#### Scenario: Manifest missing one hook entry

- GIVEN a manifest with no entry for `commit-msg`
- WHEN `ci init` runs
- THEN `pre-commit` and `pre-push` install, and `commit-msg` reports a named manifest error

### Requirement: Hook templates shipped as package assets

The three hook templates MUST live as asset files read at install time rather than as inline source
literals, and MUST be included in the published npm package (`files` entry plus the packaging
check). Template CONTENT MUST be extracted verbatim; the richer `ci-local/hooks/*` variants MUST NOT
be adopted in this change.

#### Scenario: Assets survive packaging

- GIVEN a packed tarball of the CLI
- WHEN the packaging check runs
- THEN every hook asset is present in the tarball

#### Scenario: Extracted template is byte-equivalent

- GIVEN the extracted asset templates
- WHEN compared against the previous inline literals
- THEN the executable content is identical apart from the added marker and hash comment lines

### Requirement: Hooks are verified by execution

Tests MUST verify generated hooks by EXECUTING them, not by grepping substrings, including the
frozen flag invocation `--quick --no-docker --no-security --no-ci-ghagga`.

#### Scenario: Generated pre-commit runs

- GIVEN an installed `pre-commit` hook
- WHEN it is executed in a fixture repo
- THEN it invokes the CLI with the frozen flag set and propagates its exit code
