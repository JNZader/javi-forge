# Delta for skillguard-pretooluse-hook

## ADDED Requirements

### Requirement: Runtime literals come from an injected per-agent config

The packaged `.mjs` runtime MUST resolve its agent-specific inputs — the `isManaged`
protected-path set, the project-dir source (env var name plus envelope `cwd` fallback),
and the managed marker token — from an injected per-agent adapter config rather than
hardcoded Claude literals. The Claude adapter MUST supply the exact current values so the
Claude guard's OBSERVABLE behavior (denials, managed-config protection, doctor output) is
byte-identical. The pure policy engine (`evaluate*`, sensitive-path corpus) MUST stay
agent-independent. Asset-SHA rotation caused by this extraction MUST be absorbed by the
manifest `historical[]` so installed Claude copies classify as `released-outdated`.

#### Scenario: Claude denials are unchanged after extraction

- GIVEN a Claude `PreToolUse` event the guard denied before the extraction
- WHEN the post-extraction `.mjs` (Claude adapter config) evaluates the same event
- THEN it produces the same deny decision, exit code, and bounded reason class
- AND a previously-allowed event still exits `0` silently

#### Scenario: Rotated Claude asset classifies released-outdated

- GIVEN an installed Claude asset whose bytes match a prior released SHA now superseded by the extraction
- WHEN the classifier recomputes its hash against the manifest
- THEN it reports `released-outdated`, not `edited-managed`

### Requirement: The runtime recognizes Codex apply_patch file-write events

When driven by a Codex adapter config, the `.mjs` MUST match `tool_name:"apply_patch"`
and parse the affected path(s) from the `tool_input.command` patch text
(`*** Add File: <p>`, `*** Update File: <p>`, `*** Delete File: <p>`), which carries no
`file_path` field, then apply the managed-config file-write protection to those paths. A
patch touching a managed path MUST be denied; a patch on non-managed paths MUST be
allowed; an unparseable patch MUST fail closed. This matcher MUST NOT alter Claude
`Edit`/`Write`/`Read` behavior.

#### Scenario: apply_patch on a managed path is denied under Codex

- GIVEN the runtime driven by the Codex adapter config
- WHEN an `apply_patch` event's patch text writes, edits, or deletes a managed path
- THEN the runtime denies it with a bounded managed-path reason and no file content

#### Scenario: Claude file-tool behavior is untouched by the apply_patch matcher

- GIVEN the runtime driven by the Claude adapter config
- WHEN a Claude `Edit`/`Write`/`Read` event is evaluated
- THEN behavior is identical to before the apply_patch matcher was added
