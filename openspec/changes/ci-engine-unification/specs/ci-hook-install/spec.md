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

`installCIHooks` MUST classify each target path as `absent`, `managed:vN`, `foreign` or
`managed-but-edited` BEFORE writing, and MUST NOT write without a decision. `absent` MUST be
written. `managed:vN` (marker present AND hash matches its recorded content) MUST be upgraded.
Symlinks MUST still be refused with the target left intact. Per-hook failures MUST stay isolated.

#### Scenario: Absent hook is written

- GIVEN `.git/hooks/pre-commit` does not exist
- WHEN `ci init` runs
- THEN the hook is written with mode 0755 and reported as installed

#### Scenario: Managed hook is upgraded

- GIVEN an existing hook whose marker and hash both match a managed version
- WHEN `ci init` runs
- THEN the hook is overwritten with the current template and reported as upgraded

### Requirement: Legacy unmarked fleet content is upgradable

An existing hook with NO marker whose bytes are identical to a known historical shipped template
MUST be classified as `managed:v0` and upgraded. This MUST NOT require user intervention (R2: ~8
consumer repos run unmarked hooks and would otherwise be refused).

#### Scenario: Old fleet repo re-inits cleanly

- GIVEN a repo whose `pre-commit` is byte-identical to a historical javi-forge template and has no marker
- WHEN `ci init` runs
- THEN it is classified `managed:v0`, upgraded, and no refusal is reported

#### Scenario: One byte of drift is not legacy

- GIVEN a hook that differs from every historical template by at least one byte and has no marker
- WHEN `ci init` runs
- THEN it is classified `foreign`, not `managed:v0`

### Requirement: No-clobber policy for foreign and edited hooks

`installCIHooks` MUST refuse to overwrite a `foreign` or `managed-but-edited` hook unless an
explicit force is given. The refusal MUST name the hook and state the classification reason, MUST
leave the file byte-unchanged, and MUST NOT abort installation of the other hooks. This closes B4.

#### Scenario: Foreign hook is preserved

- GIVEN a hand-written `pre-commit` with no javi-forge marker
- WHEN `ci init` runs without force
- THEN the file is unchanged on disk
- AND the reported reason identifies it as not managed by javi-forge

#### Scenario: Edited managed hook is preserved

- GIVEN a hook carrying a valid marker but whose content hash no longer matches
- WHEN `ci init` runs without force
- THEN the file is unchanged and reported as locally modified

#### Scenario: Refusal does not block sibling hooks

- GIVEN `pre-commit` is foreign and `commit-msg` is absent
- WHEN `ci init` runs without force
- THEN `commit-msg` is installed and `pre-commit` is refused

### Requirement: Forced overwrite backs up first

When force is given for a `foreign` or `managed-but-edited` hook, the previous content MUST be
written to a `.bak` sibling file BEFORE the new hook is written. If the backup cannot be written,
the hook MUST NOT be overwritten.

#### Scenario: Backup precedes overwrite

- GIVEN a foreign `pre-commit` and an explicit force
- WHEN `ci init` runs
- THEN a `.bak` file holds the original bytes
- AND `pre-commit` holds the current template

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
