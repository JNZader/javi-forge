# Spec: ci-hook-install

Source of truth for `javi-forge ci init` git-hook installation.

Established by change `ci-engine-unification` (archived `2026-08-08`), which merged its
`ADDED Requirements` delta into this — previously empty — main spec tree. Hook BEHAVIOR was unchanged
by that change; the marker and the write policy are what it introduced.

## Requirements

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
check). Template CONTENT MAY adopt the richer `ci-local/hooks/*` behavior for the `commit-msg` and
`pre-push` bodies, provided every added behavior is specified as a requirement in this domain.
(Previously: content had to be byte-equivalent to the prior inline literals and "the richer
`ci-local/hooks/*` variants MUST NOT be adopted" — that prohibition was scoped to
`ci-engine-unification` and is SUPERSEDED here.)

#### Scenario: Assets survive packaging

- GIVEN a packed tarball of the CLI
- WHEN the packaging check runs
- THEN every hook asset is present in the tarball

#### Scenario: Adopted body is a managed asset

- GIVEN a `commit-msg` or `pre-push` body carrying the richer variant behavior
- WHEN its bytes are hashed at install time
- THEN the hash equals the manifest `sha256` for that hook and the body installs behaviorally per its requirements

### Requirement: Hooks are verified by execution

Tests MUST verify generated hooks by EXECUTING them, not by grepping substrings, including the
frozen flag invocation `--quick --no-docker --no-security --no-ci-ghagga`.

#### Scenario: Generated pre-commit runs

- GIVEN an installed `pre-commit` hook
- WHEN it is executed in a fixture repo
- THEN it invokes the CLI with the frozen flag set and propagates its exit code

### Requirement: commit-msg rejects AI-attribution

The `commit-msg` hook MUST reject a commit message that carries an AI-attribution marker — including
`Claude-Session:` and `Co-Authored-By:` trailers and the broader family of provider/verb/`X-assisted`
patterns. The always-on guarantee is raw-literal matching: the hook MUST match the attribution
patterns against the RAW message and MUST reject on a match. As a BEST-EFFORT hardening layer, WHEN
`perl` and `Unicode::Normalize` are available the hook SHOULD also evaluate an NFKC-normalized form so
common compatibility-character/homoglyph noise is folded before matching; WHEN perl is absent it MUST
degrade to raw-literal matching only (no failure, no bypass). This is deliberate: the threat model is
an HONEST committer accidentally leaving attribution, NOT an adversary crafting compatibility-character
evasion (that adversarial case is a documented non-goal). A rejected message MUST exit non-zero and
name the matched reason; a clean message MUST exit 0.

#### Scenario: Attribution trailer is blocked

- GIVEN a commit message containing `Co-Authored-By:` or `Claude-Session:`
- WHEN the hook runs
- THEN it exits non-zero and names AI attribution as the reason

#### Scenario: Compatibility-form noise is folded when perl is available

- GIVEN an attribution phrase written with common full-width or combining characters AND perl with
  `Unicode::Normalize` is available
- WHEN the hook runs
- THEN best-effort NFKC normalization folds the noise, the match surfaces, and the commit is rejected

#### Scenario: Raw matching still guards when perl is absent

- GIVEN a commit message carrying a raw-literal attribution marker AND perl is NOT available
- WHEN the hook runs
- THEN the hook degrades to raw-literal matching, still detects the marker, and rejects the commit

#### Scenario: Clean message passes

- GIVEN a commit message with no attribution marker
- WHEN the hook runs
- THEN it exits 0

### Requirement: commit-msg enforces conventional-commit subjects

The `commit-msg` hook MUST require the first subject line to match
`^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9._-]+\))?!?: .+`. Subjects
matching `^Merge `, `^(fixup|squash)! `, `^(amend|reword)! ` (git ≥2.32 autosquash prefixes), or
`^Revert ` MUST be EXEMPT and MUST NOT be validated against the regex. A non-matching, non-exempt
subject MUST exit non-zero with a reason naming the expected format. The subject regex evaluates the
RAW subject line (it is unaffected by the best-effort NFKC layer of the attribution guard). The
attribution guard and the subject guard are independent: BOTH MUST pass.

#### Scenario: Valid subject passes

- GIVEN a subject `feat(hooks): add native gate` or `fix: correct exit code`
- WHEN the hook runs
- THEN it exits 0

#### Scenario: Bare non-conforming subject fails

- GIVEN a subject `wip`
- WHEN the hook runs
- THEN it exits non-zero and names the expected conventional-commit format

#### Scenario: Exempt subjects pass

- GIVEN a subject starting with `Merge `, `fixup! `, `squash! `, `amend! `, `reword! `, or `Revert `
- WHEN the hook runs
- THEN the subject regex is not applied and the commit is allowed

#### Scenario: Both guards apply

- GIVEN a valid `feat: ...` subject whose body carries an AI-attribution trailer
- WHEN the hook runs
- THEN the commit is still rejected by the attribution guard

### Requirement: commit-msg body is a packaged, tested asset

The `commit-msg` regression suite MUST ship as a packaged asset and MUST run in the project's test
flow, exercising both the attribution guard and the conventional-commit subject guard.

#### Scenario: Suite runs in the test flow

- GIVEN the project test run
- WHEN the hook regression step executes
- THEN the `commit-msg` suite runs and covers attribution rejection, subject acceptance, and exemptions

### Requirement: pre-push runs a native substantive gate, fail-closed

The `pre-push` hook MUST run `javi-forge ci --quick --no-docker --no-security --no-ci-ghagga`
(native validate + coverage) rather than the full containerized run, so it sidesteps the
containerized pre-push environment failure. Because the run passes `--no-docker`, any BLOCKING gate
that declares an `image` MUST still be REFUSED (per the ci-gates fail-closed matrix), so the hook
cannot false-green an image-gated repo. The hook MUST NOT contain a Docker-down degrade branch: no
code path may weaken the gate set when Docker is absent. The hook MUST report elapsed time and clear
pass/refuse messaging, and MUST keep `git push --no-verify` as the documented escape hatch.

#### Scenario: Native gate runs and reports

- GIVEN a repo with no blocking image gates
- WHEN the hook runs
- THEN it invokes the native gate set, reports elapsed time, and passes or refuses on the gate outcome

#### Scenario: Image-gated repo cannot false-green

- GIVEN a repo declaring a BLOCKING image gate
- WHEN the hook runs under `--no-docker`
- THEN the image gate is REFUSED and the push is blocked — never run native/unpinned, never skipped

#### Scenario: No degrade branch exists

- GIVEN Docker is not running
- WHEN the hook runs
- THEN it runs the same native gate set — it does NOT branch to a weaker check

### Requirement: New hook bodies auto-upgrade silently via retained history

Each hook body change MUST bump the hook's `manifest.version` and MUST RETAIN the outgoing `sha256`
in that hook's `historical[]`, so an existing marked install classifies `managed-outdated` and
auto-upgrades on the next `ci init` with no `--force` and no backup. Dropping the outgoing hash MUST
NOT occur: it would classify `managed-edited` and be refused. The same outgoing hash MUST be appended
to `RELEASED_SNAPSHOT` (the append-only fleet-brick guard) in the SAME change.

#### Scenario: Marked v1 install auto-upgrades

- GIVEN an existing marked install whose body hash is retained in `historical[]` under a stale version
- WHEN `ci init` runs
- THEN it is classified `managed-outdated` and upgraded silently, with no `--force` and no backup

#### Scenario: Dropping the prior hash bricks the fleet

- GIVEN a manifest change that omits the outgoing hash from `historical[]`
- WHEN an existing marked install runs `ci init`
- THEN it classifies `managed-edited` and is refused — the anti-pattern this requirement forbids

#### Scenario: Snapshot guard blocks a silent history rewrite

- GIVEN a hook body change that does not append the outgoing hash to `RELEASED_SNAPSHOT`
- WHEN the hook-asset guard test runs
- THEN it fails, forcing the append-only history update in the same change
