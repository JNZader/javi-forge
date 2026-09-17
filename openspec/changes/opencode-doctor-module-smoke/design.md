# Design: opencode-doctor-module-smoke

Only when plugin and policy are both `managed-current`, doctor dynamically
imports the installed plugin file (`pathToFileURL` + `import`). Inject
`options.importPlugin` in tests.

- Import throw → `blockers` + `execution.status = blocked`
- Import ok → still `inconclusive`; extra residual that in-process import ≠ OpenCode load
- Never `runnable`
- Do not import foreign/edited/absent bytes
- CLI prints `blockers` like Codex doctor
