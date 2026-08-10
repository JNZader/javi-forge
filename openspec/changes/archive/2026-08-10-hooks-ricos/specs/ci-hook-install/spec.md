# Delta for ci-hook-install

## MODIFIED Requirements

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

## ADDED Requirements

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
