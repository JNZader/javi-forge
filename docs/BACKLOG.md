# Backlog

Orthogonal findings parked for between-SDD work. Each item carries evidence
(`file:line`) and a suggested fix. Items are NOT fixed in-flight — see the
Fix-Between-SDDs pattern: an in-flight fix pollutes the diff under review.

## 2026-08-08 — from SDD `ci-engine-unification` exploration

Source: `openspec/changes/ci-engine-unification/exploration.md`

### B1 — Inconsistent step-id naming between `--stack` and zero-config auto

`--stack <s>` emits suffixed step ids (`lint:node`) while the zero-config auto
path emits bare ids (`lint`) for the same repository and the same commands.

- Evidence: `src/commands/ci.ts:892` — `const stepId = \`${phase.id}:${runner.name}\`;`
  (the multi-runner path), versus the legacy single-runner view at
  `src/commands/ci.ts:491-502` used by the auto path.
- Status: undocumented, untested, likely unintended.
- Suggested fix: decide the desired behavior (bare ids for a single runner, or
  always suffixed), then pin it with a test so the two paths cannot drift again.

### B2 — `ci --shell` ignores configured runners

Shell mode builds its image from the detected `stackInfo`, never from
`runner.image` / `runner.buildContext`. A repository that pins
`image: python:3.12-slim` still gets the default node image.

- Evidence: `src/commands/ci.ts:508-533` — `ensureImage({ stack: stackInfo.stackType, javaVersion: stackInfo.javaVersion })`.
- Status: zero test coverage.
- Suggested fix: resolve the shell image from the selected runner's
  `image`/`buildContext` when present, falling back to detection only when the
  runner pins nothing; add a test for a repo with a pinned image.

### B3 — Dead defensive defaults in the legacy single-runner view

`runners[0]` can never be `undefined`: config requires a non-empty runner list,
and auto-detection yields exactly one runner. The `??` fallbacks are unreachable.

- Evidence: `src/commands/ci.ts:494-502` — `const primary = resolved.runners[0];`
  followed by `primary?.stack ?? "node"`, `primary?.buildTool ?? "npm"`, etc.
- Suggested fix: remove after the `ci-engine-unification` collapse lands — they
  may disappear naturally with the legacy view. Verify at that point rather than
  deleting now.

### ENV-1 — Containerized CI runs leave `node_modules/.vite-temp` root-owned

Containerized CI runs leave `node_modules/.vite-temp` owned by uid 1001 (the
container runner), which breaks local `vitest` with `EACCES` for uid 1000.

- Evidence: commit `d21fe49` (moving `cacheDir` to `/tmp`) was an incomplete
  fix — vite still writes the config-bundle timestamp file under
  `node_modules/.vite-temp`, outside `cacheDir`.
- Suggested fix: a real fix, not another cache redirect — either `chown` the
  workspace back to the host uid in the container teardown, or configure vitest
  so the config-bundle temp dir lands outside `node_modules`.

### HOOKS-1 — Adopt the richer `ci-local/hooks/*` variants fleet-wide (deferred change, not a bug)

The `ci-local/hooks/*` variants are strictly better than the hook constants the
fleet actually received: `pre-push` degrades gracefully when Docker is down, and
`commit-msg` does NFKC normalization plus pattern families and ships its own
test suite (`ci-local/hooks/commit-msg.test.sh`).

- Evidence: `ci-local/hooks/pre-push`, `ci-local/hooks/commit-msg`,
  `ci-local/hooks/commit-msg.test.sh`.
- Status: this is a behavior change, not a defect. It is gated behind the hook
  markers that `ci-engine-unification` slice 3 ships.
- Suggested fix: plan as its own change after `ci-engine-unification` lands.

### JF-DOCS-1 — `javi-forge ci` has no command-specific `--help` and no `ci validate`

Config errors surface only by running the full pipeline; there is no cheap way to
validate a CI config or discover `ci` flags.

- Evidence: `src/index.tsx:29-32` — meow is built once with the global
  `HELP_TEXT`, so there is no per-command help; `src/dispatch/ci.tsx` handles
  only the `init` subcommand.
- Suggested fix: add a `ci`-scoped help section and a `ci validate` subcommand
  that resolves and type-checks the config without executing any step.

## 2026-08-08 — from SDD `ci-engine-unification` slice 1 (measured coverage baseline)

Source: `openspec/changes/ci-engine-unification/design.md` (Coverage Guard) and
`openspec/changes/ci-engine-unification/review-ledger.md` (JDB2-003).

### COV-1 — Branch coverage is ~79%, below the configured 80% floor

`pnpm test:coverage` FAILS on `main` and on the slice-1 branch: the configured
80% branch threshold is unmet. This is pre-existing debt, not introduced by
`ci-engine-unification` (slice 1 moves branches UP).

- Evidence: `vitest.config.ts` coverage thresholds; measured `coverage/clover.xml`
  on a developer box WITH Docker and the `javi-forge-node` image present (the
  Docker-gated integration suites ran; without Docker, and in CI, they `skipIf`
  out and these figures shift) — `main` @ 2a0abaa 1880/2411 conditionals =
  77.97%, slice 1 @ 12d9b4d 1902/2411 = 78.88%, slice 1 @ 1f5c69b 1904/2411 =
  78.97%. Treat every figure as an environment- and commit-specific reading, not
  a floor: the SDD's own gate is a same-run delta, not an absolute number.
- Suggested fix: close the ~1.1pp gap as its own effort — target the least-covered
  branch clusters rather than blanket-adding tests. Do NOT lower the threshold.

### COV-2 — `pnpm validate` does not run coverage, so the thresholds gate nothing

The vitest coverage thresholds are only evaluated by `pnpm test:coverage`, which
neither `pnpm validate`, the git hooks, nor CI invoke. A coverage regression is
therefore invisible until someone runs the command by hand.

- Evidence: `package.json` scripts — `validate` chains lint/typecheck/test, not
  `test:coverage`.
- Suggested fix: decide whether to wire `test:coverage` into `validate`/CI ONCE
  COV-1 lands. Wiring it before COV-1 would close every PR with a red gate.
