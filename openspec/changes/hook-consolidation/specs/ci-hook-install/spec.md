# Delta for ci-hook-install

Change `hook-consolidation`. The classify-before-write vocabulary, no-clobber policy, forced-backup rules, legacy-v0 handling and the retained-history auto-upgrade requirement ("New hook bodies auto-upgrade silently via retained history") are PRESERVED unchanged — the new shim rollout depends on them.

## MODIFIED Requirements

### Requirement: pre-push runs a native substantive gate, fail-closed

The installed `pre-push` body MUST be a static shim that execs `javi-forge hooks run pre-push` (per the hook-dispatch capability). The dispatcher's CI gate section MUST run the equivalent IN-PROCESS `runCI` option set — `runCI({mode:"quick", noDocker:true, noSecurity:true, noGhagga:true})` (setup + lint + compile + gates; NO test phase, NO coverage) — NOT a shelled-out `javi-forge ci --quick ...` subprocess. In-process execution is mandated to avoid the second-node-startup PATH/version-skew between the shim-resolved binary and a subprocess; the observable behavior (gates run, tests/coverage do not) is the contract, not any particular CLI flag string. This still sidesteps the containerized pre-push environment failure. Because the run passes `--no-docker`, any BLOCKING gate that declares an `image` MUST still be REFUSED (per the ci-gates fail-closed matrix), so the hook cannot false-green an image-gated repo. No code path may weaken the gate set when Docker is absent. The composition MUST report elapsed time and clear pass/refuse messaging that accurately names what runs — never "validate + coverage" — and MUST keep `git push --no-verify` as the documented escape hatch.
(Previously: the hook body invoked `ci --quick` directly, and the requirement itself mislabeled the run as "native validate + coverage" — the DOC-004 misstatement. Also previously mandated an observable `--quick --no-docker --no-security --no-ci-ghagga` CLI invocation; reconciled to the in-process `runCI` option set so an apply agent is not misdirected into re-introducing a subprocess.)

#### Scenario: Native gate runs and reports

- GIVEN a repo with no blocking image gates
- WHEN the hook runs
- THEN the shim invokes the dispatcher, the native gate set runs, elapsed time is reported, and the outcome decides pass/refuse

#### Scenario: Image-gated repo cannot false-green

- GIVEN a repo declaring a BLOCKING image gate
- WHEN the hook runs under `--no-docker`
- THEN the image gate is REFUSED and the push is blocked — never run native/unpinned, never skipped

#### Scenario: No degrade branch exists

- GIVEN Docker is not running
- WHEN the hook runs
- THEN it runs the same native gate set — it does NOT branch to a weaker check

### Requirement: Hooks are verified by execution

Tests MUST verify generated hooks by EXECUTING them, not by grepping substrings. Executing an installed shim MUST be shown to invoke the dispatcher, and the dispatcher's gate section MUST be shown to compose the equivalent quick-gate BEHAVIOR — the gates run while the test phase and coverage do NOT — as produced by the in-process `runCI({mode:"quick", noDocker:true, noSecurity:true, noGhagga:true})` option set. Tests MUST assert this observable behavior, NOT the presence of any `--quick --no-docker ...` CLI flag string (no subprocess is spawned).
(Previously: the hook itself carried the frozen invocation; execution tests targeted the body directly and asserted an observable CLI flag string — reconciled to assert the composed in-process behavior instead.)

#### Scenario: Generated pre-commit runs

- GIVEN an installed `pre-commit` shim
- WHEN it is executed in a fixture repo
- THEN it invokes `javi-forge hooks run pre-commit` and propagates its exit code

## ADDED Requirements

### Requirement: core.hooksPath detection before install

`installCIHooks` MUST read `git config core.hooksPath` before installing.

The migration MUST be ATOMIC with a DETECT-BEFORE-MUTATE ordering: EVERY refuse path MUST leave the repo in its EXACT prior state (zero mutation), and the ONLY writes may happen on the fully-validated success/force path. The guard MUST perform its checks in this strict order before any mutation:

1. Classify the `.git/hooks/{pre-commit,pre-push,commit-msg}` slots (pure read).
2. Detect a shadowing higher-scope value via SCOPED reads — `git config --global --get core.hooksPath` and `git config --system --get core.hooksPath` return each scope's own value regardless of the local value. If either is non-empty, that value WOULD shadow `.git/hooks` once a local value is unset, so the guard MUST refuse loudly with ZERO mutation (it MUST NOT unset the local config and MUST install nothing). This detection MUST happen BEFORE any local mutation, so a global/system shadow can never leave the repo in a `local-unset + global-present` half-migrated state.
3. Read the LOCAL value (`git config --local --get core.hooksPath`). If it holds ANY value OTHER than the exact legacy `ci-local/hooks` (a foreign local husky/lefthook/custom manager), the guard MUST refuse loudly with zero mutation — never hijack another manager. If empty, this is the normal fresh-install case.
4. If any classified slot would be `foreign` and `--force` is NOT set, the guard MUST REFUSE THE WHOLE OPERATION, leave `core.hooksPath` UNCHANGED (prior consistent state), and install nothing.
5. Only when every check passes (or `--force` is set) may the guard unset the local `ci-local/hooks` value with an informative message and install into `.git/hooks`. The install MUST NOT run before the global/system shadow check (step 2) or the slot classification check (step 4).

A scoped `--global`/`--system` read covers the common non-conditional global/system shadow; a value injected only via an `[includeIf]` conditional include is a documented residual edge not covered by the scoped read.

#### Scenario: Legacy value migrates

- GIVEN `core.hooksPath` is exactly `ci-local/hooks` (as set today by `src/commands/init/steps/git.ts:83`)
- WHEN install runs
- THEN the config is unset, a migration message is emitted, and hooks install into `.git/hooks`

#### Scenario: Foreign value refuses

- GIVEN `core.hooksPath` is `.husky/_`
- WHEN install runs
- THEN it refuses loudly, installs nothing, and leaves the config untouched

#### Scenario: Unset value is a normal install

- GIVEN `core.hooksPath` is unset
- WHEN install runs
- THEN hooks install into `.git/hooks` with no hooksPath messaging

#### Scenario: Dormant foreign slot refuses atomically before unset

- GIVEN local `core.hooksPath` is exactly `ci-local/hooks` AND `.git/hooks/pre-commit` holds a dormant foreign hook (e.g. an old `tdd init` body) AND `--force` is not set
- WHEN install runs
- THEN it classifies the slot before mutating, refuses the whole operation, leaves `core.hooksPath` STILL set to `ci-local/hooks`, and installs nothing — the dormant hook is never activated into a half-migrated state

#### Scenario: Global hooksPath still shadowing is a loud refusal with zero mutation

- GIVEN local `core.hooksPath` is exactly `ci-local/hooks` AND a global (or system) `core.hooksPath` is also set
- WHEN install runs
- THEN it detects the global/system value via scoped reads (`git config --global --get` / `--system --get`) BEFORE any mutation, refuses loudly naming the global value, does NOT report a successful install, and leaves the LOCAL `core.hooksPath` value UNCHANGED (still exactly `ci-local/hooks` — never unset) — the repo is never left in a `local-unset + global-present` half-migrated state

### Requirement: Shim release preserves silent auto-upgrade

The new shim bodies MUST ship as a manifest version bump with the outgoing sha256 retained in `historical[]` (and appended to `RELEASED_SNAPSHOT`), so a consumer holding the previous managed bodies classifies `managed-outdated` and auto-upgrades — never `foreign`, never refused.

#### Scenario: v(N) managed install upgrades to shim

- GIVEN an install whose marked body matches the current release (e.g. pre-push v2, `assets/hooks/manifest.json`)
- WHEN `ci init` runs the shim release v(N+1)
- THEN it classifies `managed-outdated` and upgrades silently, with no `--force` and no backup

### Requirement: init delegates hook provisioning to the hardened installer

`init` MUST provision hooks by calling `installCIHooks` and MUST NOT set `core.hooksPath` nor copy `ci-local/` hook bodies into the project.

#### Scenario: Fresh init lands managed shims

- GIVEN a fresh repo with no hooks and unset `core.hooksPath`
- WHEN `init` runs
- THEN `.git/hooks` holds the managed shims and `core.hooksPath` remains unset

#### Scenario: init honors the foreign-hooksPath refusal

- GIVEN the user set a foreign `core.hooksPath`
- WHEN `init` runs
- THEN hook installation is refused per the detection requirement and init does not override the user's setting

### Requirement: Legacy generated TDD hooks migrate via the foreign path

With the unhardened TDD writers deleted, a pre-existing generated TDD hook (interpolated body, no valid marker match) MUST classify `foreign`; the existing refusal plus backup-then-`--force` path IS its documented migration. No silent clobber path may exist for these bodies.

#### Scenario: Old TDD hook is refused, then force-migrated

- GIVEN `.git/hooks/pre-commit` holds a generated TDD body
- WHEN `ci init` runs without force
- THEN it is classified `foreign` and refused; with force it is backed up to `.bak` and replaced by the managed shim
