# Delta for ci-execution

> Targets the LIVE spec `openspec/specs/ci-execution/spec.md` (promoted from the
> `ci-engine-unification` archive). The archived change folder
> `openspec/changes/archive/2026-08-08-ci-engine-unification/` is IMMUTABLE and is NOT edited.
>
> NOTE (sanctioned spec-reversal): the `ci-engine-unification` characterization test that froze
> `--stack` ids as suffixed (exploration Q4 item 8) will be UPDATED in slice 1 as a deliberate
> spec-reversal edit tracked by this MODIFIED requirement — it is a sanctioned behavior change,
> not a weakening of the safety net.

## MODIFIED Requirements

### Requirement: Step-id and label naming keyed on resolution source

Naming MUST be a function of whether the runner NAME is IMPLICIT or EXPLICIT. The name is IMPLICIT
when `resolved.source === "auto"` (zero-config detection) OR `resolved.source === "stack-override"`
(`--stack`), because in both cases the user never named the runner. The name is EXPLICIT when
`resolved.source === "config"` (a runner named in `ci.yaml`). When the name is IMPLICIT, ids MUST be
bare (`lint`, `compile`, `test`) and labels MUST be unsuffixed (`Lint: <cmd>`, `Lint passed`,
`Lint failed`). When the name is EXPLICIT, ids MUST be `${phase}:${runner.name}` and labels MUST
carry `[name]`. Naming MUST NOT be keyed on `runners.length` or any runner-count predicate.
(Previously: naming was keyed on `resolved.source` such that ONLY `auto` produced bare ids and
`stack-override` produced suffixed ids; B1 flips `stack-override` to bare because its name is
implicit.)

#### Scenario: Auto emits bare ids

- GIVEN zero-config detection of a node repo
- WHEN `runCI` runs
- THEN step ids are `lint`, `compile`, `test` with no `:` suffix

#### Scenario: Single-runner config still emits suffixed ids (R3 guard)

- GIVEN a `ci.yaml` with EXACTLY ONE runner named `api`
- WHEN `runCI` runs
- THEN step ids are `lint:api`, `compile:api`, `test:api`

#### Scenario: Stack override emits bare ids (B1 fix)

- GIVEN `--stack node` on a node repo (`resolved.source === "stack-override"`)
- WHEN `runCI` runs
- THEN step ids are bare `lint`, `compile`, `test` with no `:` suffix, because the name is implicit

### Requirement: Preserved flag, mode and exit-code contract

The CLI contract MUST be unchanged: `--quick`, `--no-docker`, `--no-security`, `--no-ci-ghagga`,
bare `javi-forge ci`, `detect` mode and `shell` mode keep their current names and semantics. Exit
codes MUST be unchanged. Schema `version: 1` stays byte-locked and still rejects unknown keys.
Schema `version: 2` is ADDITIVE (see the `ci-gates` capability): under `version: 2`, the `gates`
key is permitted and `runners` is OPTIONAL when `gates` is present (a `version: 2` config with
neither `runners` nor `gates` fails closed). The "no schema key MAY be added"
rule applies to `version: 1` ONLY; it MUST NOT be read as forbidding the additive `version: 2`
schema. (Previously: "No `ci.yaml` schema key MAY be added; schema version 1 stays locked and still
rejects unknown keys." — that blanket lock is re-scoped here to v1, because v2 is additive.)

#### Scenario: Hook-invoked flag set still works

- GIVEN `javi-forge ci --quick --no-docker --no-security --no-ci-ghagga`
- WHEN it runs
- THEN docker-check, security and ghagga steps are suppressed exactly as before
- AND a failing command yields the same non-zero exit code

#### Scenario: version 1 stays locked

- GIVEN a `version: 1` config with any unknown top-level key
- WHEN it is parsed
- THEN parsing fails closed exactly as before (v1 rejects unknown keys)

#### Scenario: version 2 is additive

- GIVEN a `version: 2` config that declares `gates` and no `runners`
- WHEN it is parsed
- THEN it is accepted (v2 permits `gates` and makes `runners` optional)

#### Scenario: Detect mode emits only the detect step

- GIVEN `detect` mode for any source
- WHEN `runCI` runs
- THEN exactly one step is emitted and no runner phase executes

## ADDED Requirements

### Requirement: Shell mode honors runner image and build context (B2)

When `ci --shell` targets a runner that pins an `image` or `build-context`, shell mode MUST use
THAT image/build context, NOT the auto-detected stack default derived from the primary runner's
stack type.

#### Scenario: Shell uses the pinned runner image

- GIVEN a runner with a pinned `image` (or `build-context`) distinct from the auto-detected stack default
- WHEN `ci --shell` targets that runner
- THEN the shell container is built from the pinned `image`/`build-context`, not the stack default
```
