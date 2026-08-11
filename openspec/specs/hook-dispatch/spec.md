# hook-dispatch Specification

Established by change `hook-consolidation` (archived `2026-08-11`), which promoted this — previously
non-existent — capability into the main spec tree as a full spec (the delta carried no `MODIFIED`
or `REMOVED` requirements against a prior version).

## Purpose

`javi-forge hooks run <name>`: a CLI dispatcher that composes per-hook behavior in TypeScript from a `hooks:` section in `.javi-forge/ci.yaml`. New capability introduced by change `hook-consolidation` — replaces the generated TDD hook writers and the inert `ci-local/hooks/security/` copy.

## Requirements

### Requirement: Static shims exec the dispatcher

The installed `pre-commit` and `pre-push` bodies MUST be static assets whose behavior is to exec `javi-forge hooks run <name>`, with an `npx` fallback when the binary is not on PATH. `commit-msg` MUST remain a self-contained static bash body with no dispatcher dependency (unchanged from assets v2).

#### Scenario: Shim delegates to composition

- GIVEN a repo with managed shims installed and a `hooks:` config
- WHEN `git commit` triggers the `pre-commit` shim
- THEN the shim invokes `javi-forge hooks run pre-commit` and the dispatcher composes exactly the enabled sections, propagating the exit code

#### Scenario: commit-msg needs no dispatcher

- GIVEN `javi-forge` and `npx` are both unavailable
- WHEN the `commit-msg` hook runs
- THEN it still executes its guards fully (self-contained bash)

### Requirement: Composition driven by hooks config

The dispatcher MUST read the `hooks:` section of `.javi-forge/ci.yaml` and compose the enabled features per hook: the CI `--quick` gate on `pre-push`, an optional TDD test section, and the enabled security sections on `pre-commit`. A disabled feature MUST contribute nothing to the run.

#### Scenario: Gate-only pre-push

- GIVEN `hooks:` enables only the CI gate
- WHEN `hooks run pre-push` executes
- THEN only the `--quick` gate runs and its exit code is the hook's exit code

#### Scenario: Gate plus TDD section

- GIVEN the TDD test section is enabled
- WHEN the dispatcher runs the relevant hook
- THEN the stack-detected test command runs as an additional section

#### Scenario: Security sections enabled

- GIVEN L1–L3 are enabled in `hooks:`
- WHEN `hooks run pre-commit` executes
- THEN secret-scan, dependency-audit and permission-boundaries each run as sections

#### Scenario: All-disabled is a clean no-op

- GIVEN every feature in `hooks:` is disabled (or the section is absent)
- WHEN a shim invokes the dispatcher
- THEN it exits 0 without running any section

### Requirement: Fail-closed gate sections

A gate section that fails MUST make the hook exit non-zero, blocking the commit or push. An ADVISORY-only section (if any) MUST NOT block.

#### Scenario: Failing secret scan blocks the commit

- GIVEN L1 secret-scan is enabled and a staged file contains a secret
- WHEN `hooks run pre-commit` executes
- THEN the hook exits non-zero and names the failing section

### Requirement: Honest pre-push messaging

The pre-push composition's runtime output MUST accurately describe what runs: `--quick` = setup + lint + compile + gates — NO test phase, NO coverage. It MUST NOT claim "validate + coverage" (DOC-004: `assets/hooks/pre-push:5,20` today claims coverage while `ci --quick` skips the test phase, `src/commands/ci.ts:1016`).

#### Scenario: Output does not claim coverage

- GIVEN a pre-push run via the dispatcher
- WHEN its messaging is emitted
- THEN it names the phases that actually run and never claims tests or coverage ran

### Requirement: Security sections L1–L3 with NUL-safe file handling

When enabled, L1 secret-scan, L2 dependency-audit and L3 permission-boundaries MUST run as composed pre-commit sections. L1 MUST build its staged-file list NUL-safe (`git diff --cached --name-only -z | xargs -0` semantics) and MUST NOT whitespace-split filenames (closes K-005: `templates/security-hooks/pre-commit-secrets:42` splits on whitespace and swallows the git error with `|| true`).

#### Scenario: Whitespace filename is still scanned

- GIVEN a staged file named `app secrets.env` containing a secret
- WHEN L1 runs
- THEN the file is scanned as one path and the commit is blocked — no silent bypass

### Requirement: L4–L6 are doctor advisories, never hooks

Code-signing verification, branch protection and signing reminder MUST be surfaced by `javi-forge doctor` as ADVISORIES (reported when unconfigured). No hook section may claim to enforce them.

#### Scenario: Doctor reports, hooks stay silent

- GIVEN branch protection is not configured
- WHEN `javi-forge doctor` runs
- THEN it reports the advisory, and no installed hook claims to enforce branch protection
