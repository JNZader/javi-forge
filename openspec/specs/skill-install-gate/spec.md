# skill-install-gate Specification

Established by change `skillguard-runtime-gate` (archived `2026-08-13`), which promoted this — previously
non-existent — capability into the main spec tree as a full spec (the delta carried no `MODIFIED`
or `REMOVED` requirements against a prior version).

## Purpose

Fail-closed gate for skills entering the machine. The skillguard scanner is latent today (only importer: `skill-scanner.test.ts:19`); this gate is its first production call site. Both entrypoints — `plugin add` (`installPlugin`, `plugin.ts:138`) and `skills auto-install` (`autoInstallSkills`, `auto-skill-install.ts:43`) — MUST refuse any skill whose verdict is `block` or `unscannable` (`isRejectedVerdict()`, `skill-scanner.ts:57-58`) and MUST deny on scanner error. `--force` (additive `force?: boolean`) bypasses ONLY `unscannable`, never `block`.

## Requirements

### Requirement: plugin add gates placement on scan

The scan MUST run on the staged clone (`tmpDir`, `plugin.ts:154`) after validation (`plugin.ts:165-182`) and before the `fs.move` into `PLUGINS_DIR` (`plugin.ts:192`). Any rejected staged skill ⇒ `{ success: false, error }` naming each; nothing lands; `finally` cleanup (`plugin.ts:216-220`) removes staging. `unscannable` (`skill-scanner.ts:42-47`, `:448-459`) refuses exactly like `block`. `force: true` MAY bypass `unscannable`; `block` MUST still refuse. Scanner throw/eval error MUST deny even with `force`. Dry-run (`plugin.ts:157`) has no staged content — gate no-ops.

#### Scenario: block refuses the install

- GIVEN a staged plugin with a `block`-scanning skill
- WHEN the gate runs pre-placement
- THEN the install errors naming the skill; nothing lands in `PLUGINS_DIR`; staging removed

#### Scenario: unscannable refuses (fail-closed)

- GIVEN a staged plugin with an unreadable SKILL.md (binary, oversized, or missing)
- WHEN the gate runs without `--force`
- THEN the install is refused exactly as for `block`

#### Scenario: force bypasses unscannable only

- GIVEN the same `unscannable` plugin and `--force`
- WHEN the gate runs
- THEN the install proceeds to placement

#### Scenario: force never bypasses block

- GIVEN a `block` plugin and `--force`
- WHEN the gate runs
- THEN the install is still refused; nothing lands

#### Scenario: scanner error denies even with force

- GIVEN the scan throws or verdict evaluation errors
- WHEN the gate runs, with or without `--force`
- THEN the install is denied, the error surfaced, nothing swallowed or lands

#### Scenario: clean skill installs unchanged

- GIVEN a plugin whose skills all scan `pass` or `warn`
- WHEN the gate runs
- THEN the plugin installs byte-identically to pre-gate behavior

### Requirement: skills auto-install gates pre-copy

`autoInstallSkills` MUST scan each source `SKILL.md` before the copy (`auto-skill-install.ts:96-103`). A `block` source skill ⇒ refuse the batch, copy NOTHING, report each blocked skill (new `blocked` field on `SkillInstallResult`, `:9-18`). `unscannable` refuses unless `force`. The sameDir case (`:69-70`, `:84-87`, wired `AutoSkills.tsx:31-36`) stays unchanged — no scan, no error.

#### Scenario: block in the batch refuses everything

- GIVEN a batch where one recommended skill scans `block`
- WHEN the gate runs pre-copy
- THEN the batch is refused, each blocked skill reported, nothing copied

#### Scenario: unscannable refuses unless force

- GIVEN a batch with an `unscannable` source skill
- WHEN the gate runs without `force`
- THEN the batch is refused and nothing is copied
- AND with `force`, that skill is permitted

#### Scenario: sameDir source equals target unchanged

- GIVEN `skillsSourceDir === skillsTargetDir` (`AutoSkills.tsx:31-36`)
- WHEN `autoInstallSkills` runs
- THEN skills land in `skipped` as today, no scan, no error

### Requirement: refusal output reuses scanner reports

Refusal messages MUST use `formatScanReport` (`skill-scanner.ts:550`) / `formatBatchReport` (`:599`) output so rejected skills and verdicts are visible; exact strings are a UX contract, not fixed text.

#### Scenario: plugin refusal carries the scan report

- GIVEN a refused plugin install
- WHEN the error text is built
- THEN it names the rejected skill(s) and carries the report output

#### Scenario: auto-install refusal lists each blocked skill

- GIVEN a refused auto-install batch
- WHEN the result is reported
- THEN every blocked skill is listed with its verdict

### Requirement: gate tests use real fixtures, no safe-read mock

Each gate scenario MUST run against real tmpdir fixtures (real SKILL.md, binary, oversized, missing) driving `scanSkillFile`/`scanSkillsDirectory` as-is, WITHOUT mocking `src/lib/safe-read.js` (house pattern: `skill-scanner.test.ts:665`); mocking the shim hides fail-closed reads.

#### Scenario: unmocked real-fs fixtures drive verdicts

- GIVEN a tmpdir fixture holding a clean, a `block`, and an `unscannable` skill
- WHEN gate tests run with safe-read un-mocked
- THEN refusals and passes match real scanner output per verdict class

## Scope Notes (non-goals)

- PreToolUse hook — future slice; extension point `SectionId` (`hooks.ts:41`).
- `publishSkill` publish-path gate (`skill-publish.ts:50`) — P-1 follow-up.
- `_hardening.py` env-var denylist — unverified (404 on main); hook-slice only.
- Hand-copied skills and `init` agent-skills (no entrypoint) remain unscanned.
- Additive options (`force?: boolean` on `InstallPluginOptions`/`AutoInstallOptions`): old consumers compile unchanged.
