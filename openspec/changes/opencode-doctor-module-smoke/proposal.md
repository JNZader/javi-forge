# Proposal: opencode-doctor-module-smoke

## Intent

`javi-forge doctor opencode` can report a **blocked** row when the *shipped*
managed plugin module graph fails to load in-process, without ever promoting
file currency to `runnable`.

## Scope

### In Scope

- OpenCode doctor only
- If plugin and policy are `managed-current`, attempt a bounded in-process
  import of the installed plugin file
- Import failure → `execution.status = blocked` with a named blocker
- Import success → still `inconclusive` (local import ≠ OpenCode loaded it)
- CLI prints blockers
- Tests + spec/docs delta

### Out of Scope

- `runnable` for OpenCode
- Grok/Cursor (different load model: command-form execPath)
- Codex matrix copy (`probeNodeOnPath` is the wrong host)
- Editing `opencode.json`
- Coordinator/default
- Preparation supervisor

## Approach

Fail-closed extra signal only. `healthy` stays file-currency. Precedence:
blockers → blocked; else unknownSources → inconclusive; **no empty-both → runnable**.

## Success Criteria

- [ ] managed-current + import fail → blocked, dest files unchanged
- [ ] managed-current + import ok → inconclusive / exit 2
- [ ] Grok/Cursor doctors unchanged
