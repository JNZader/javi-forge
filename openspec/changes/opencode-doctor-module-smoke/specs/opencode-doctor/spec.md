# OpenCode doctor module-smoke Specification

## Requirements

### Requirement: Managed-current import failure is blocked

WHEN plugin and policy are `managed-current` and in-process import of the
plugin file throws, doctor MUST set `execution.status` to `blocked` and MUST
include a blocker naming the load failure. `healthy` MUST still reflect file
currency only.

### Requirement: Managed-current import success stays inconclusive

WHEN plugin and policy are `managed-current` and import succeeds, doctor MUST
keep `execution.status` `inconclusive` and MUST NOT report `runnable`.

### Requirement: Non-current files are not imported

WHEN plugin or policy is not `managed-current`, doctor MUST NOT import the
plugin file and MUST keep `inconclusive` with empty blockers (unless a later
slice adds other blockers).

### Requirement: CLI prints blockers

WHEN execution is `blocked`, `doctor opencode` MUST print blockers and exit 1.
