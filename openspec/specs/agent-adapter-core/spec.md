# agent-adapter-core Specification

## Purpose

Define the agent-agnostic core of the SkillGuard PreToolUse guard: the pure policy
engine, secure-fs, and doctor skeleton parameterized by an injected per-agent adapter
config. Claude-specific literals (the `isManaged` protected-path set, the project-dir
source, the managed marker) become adapter-supplied inputs rather than baked-in
constants. The Claude adapter is the reference implementation and its OBSERVABLE
behavior MUST NOT change. This spec describes WHAT the adapter boundary guarantees, not
the concrete config-injection or trust-hash mechanics (owned by design).

## Requirements

### Requirement: Per-agent adapter config abstracts every agent-specific input

The guard core MUST obtain each agent-specific input from an injected adapter config,
not from a hardcoded literal. The adapter config MUST supply, at minimum: the managed
protected-path set used by `isManaged`, the project-dir source (an environment variable
name and/or the envelope `cwd` fallback), the managed marker token, and the config/asset
target paths. The core policy engine (`evaluate*`, sensitive-path corpus, secure-fs
transaction) MUST remain agent-independent and consume only the adapter config.

#### Scenario: Core reads injected config instead of a Claude literal

- GIVEN the guard core is invoked with an adapter config
- WHEN it resolves the managed protected-path set, project-dir source, or marker
- THEN it uses the adapter-supplied values
- AND no Claude-specific literal is required for a non-Claude adapter to function

#### Scenario: Two adapters share one audited policy engine

- GIVEN two adapter configs (Claude and a second agent) differing only in their inputs
- WHEN each drives the same core policy engine
- THEN both reach the same allow/deny decisions for equivalent normalized inputs
- AND the engine code is not forked per agent

### Requirement: Claude adapter behavior is byte-identical after extraction

After lifting the Claude literals into the Claude adapter config, the Claude guard's
OBSERVABLE behavior MUST be unchanged: the same denials on the same Claude events, the
same managed-config protection, and the same doctor output as before the extraction.

#### Scenario: A previously-denied Claude event still denies identically

- GIVEN a Claude `PreToolUse` event that the pre-extraction guard denied
- WHEN the post-extraction Claude adapter evaluates the same event
- THEN it produces the same deny decision, exit code, and bounded reason class
- AND a previously-allowed event still exits `0` silently

#### Scenario: Claude doctor output is unchanged

- GIVEN a project with any Claude asset/settings ownership state
- WHEN `hooks doctor claude` runs after the extraction
- THEN it reports the same component states, execution matrix, and remediation as before

### Requirement: Manifest historical set absorbs Claude asset-SHA rotation

If lifting the literals rotates the packaged Claude `.mjs` asset SHA, the manifest
`historical[]` MUST retain the prior released asset identity so already-installed Claude
copies classify as `released-outdated`, never as `edited-managed` or `foreign`.

#### Scenario: Installed prior Claude asset classifies released-outdated

- GIVEN an installed Claude asset whose bytes match a prior released SHA now superseded
- WHEN the classifier recomputes its hash against the manifest
- THEN it reports `released-outdated` (eligible for automatic upgrade)
- AND it is never misclassified as `edited-managed`
