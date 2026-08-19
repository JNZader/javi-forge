# Delta for skillguard-cli-dispatch

## ADDED Requirements

### Requirement: `hooks install|doctor|repair` accept a per-agent target including `codex`

The `hooks` dispatcher MUST generalize agent selection beyond the Claude-only
`!== "claude"` guard to accept a per-agent target. It MUST route
`hooks install codex`, `hooks doctor codex`, and `hooks repair codex [--force]` to the
Codex adapter handlers, preserving the existing exit-code and rendering contract
(`install`/`repair` exit `0` on success and non-zero on refusal; `doctor` is
informational and exits per its execution status). Existing `claude` behavior MUST be
unchanged, and an unknown agent MUST print usage and exit `1`.

#### Scenario: Codex subcommands route to the Codex adapter

- GIVEN `hooks install codex`, `hooks doctor codex`, or `hooks repair codex`
- WHEN dispatch routes the command
- THEN the matching Codex adapter handler runs and the help+exit-1 fallback is never reached

#### Scenario: Claude subcommands are unchanged

- GIVEN `hooks install claude`, `hooks doctor claude`, or `hooks repair claude`
- WHEN dispatch routes the command
- THEN it behaves exactly as before this change

#### Scenario: Unknown agent falls back to usage

- GIVEN `hooks install <unknown-agent>`
- WHEN dispatch routes the command
- THEN it prints usage/help and exits `1`

### Requirement: Help text documents the Codex agent target

`HOOKS_HELP_TEXT` MUST document the `codex` target for `install`, `doctor`, and
`repair [--force]` alongside the existing `claude` target and `run` usage.

#### Scenario: Help lists the Codex target

- GIVEN `javi-forge hooks --help`
- WHEN the help text renders
- THEN it lists `install|doctor|repair` for both `claude` and `codex`
