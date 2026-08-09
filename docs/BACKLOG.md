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
- **CLOSED 2026-08-09**: invariant re-verified on `main` after the collapse —
  the config path throws before resolving when `runners` is empty
  (`src/lib/ci-config.ts:321-326`), and the `auto` and `stack-override` paths
  each build exactly one runner (`resolveCIRunners`). Removed the `?? "node"` /
  `?? "npm"` / `?? "21"` defaults and the two `&& first` truthiness guards in
  `describeRunners`; the invariant is now stated once as a comment. The
  `?? null` on `lintCmds[0]`/`compileCmds[0]`/`testCmds[0]` STAYS — those lists
  can legitimately be empty. Zero behavior change, full suite green unchanged.

> **Scope precision (R1 review, 2026-08-09)**: SEC-1's closure covers the WRITE path (`writeHookFile`, O_NOFOLLOW + fchmod) and the backup DESTINATION (COPYFILE_EXCL + fchmod-on-fd). Still parked, same local-attacker threat model, defense-in-depth only: (a) `repairHookMode`'s path-based chmod on the managed-current branch (R1-001), (b) `backupHook`'s source-side `stat`/`copyFile` follow symlinks — a post-classification swap can copy the link target into the backup before the write correctly aborts with ELOOP (R1-002), (c) the `nlink > 1` check. All three are strictly weaker than the code execution this attacker already holds.

### ENV-1 — Containerized CI runs leave `node_modules/.vite-temp` root-owned — CLOSED

Containerized CI runs leave `node_modules/.vite-temp` owned by uid 1001 (the
container runner), which breaks local `vitest` with `EACCES` for uid 1000.

- Evidence: commit `d21fe49` (moving `cacheDir` to `/tmp`) was an incomplete
  fix — vite still writes the config-bundle timestamp file under
  `node_modules/.vite-temp`, outside `cacheDir`.
- **Root cause**: `getDockerfileContent` bakes `USER runner` into every image.
  On `node:22-slim` the base already owns uid 1000 (`node`), so `useradd -m
  runner` lands `runner` at **1001**. `runInContainer` bind-mounted the
  workspace with no `--user`, so the container wrote artifacts as 1001 while
  the host is 1000 → `EACCES`. The compile phase's `--user root` + `chown -R
  runner:runner` dance was a symptom of this same split, and left artifacts
  owned by 1001 anyway.
- **CLOSED 2026-08-09** (Option A, host-uid match): `runInContainer` /
  `openShell` now default to `--user $(process.getuid):$(process.getgid)`
  (guarded — omitted on non-POSIX where they're `undefined`; an explicit
  `user` override still wins). Because uid 1000 maps to a real passwd user
  with a writable home in every shipped image — `node` (`/home/node`) on the
  node base, the created `runner` (`/home/runner`) on python/go/rust, and the
  distro default `ubuntu` (`/home/ubuntu`) on java/default noble bases, where
  the created `runner` lands at 1001 instead — pnpm/toolchains keep working and
  every artifact lands **host-owned**. The compile phase dropped `--user root`,
  and all five `chown -R runner:runner …` suffixes were removed
  (`src/commands/ci.ts`).
- **Empirical evidence** (`javi-forge-ci-node`, host uid 1000):
  - OLD (no `--user`): container ran as `uid=1001(runner)`; a `pnpm run build`
    could not even write the host-owned `dist/` → exit 1; artifacts, when
    written, were owned by 1001 → host `vitest` `EACCES`.
  - NEW (`--user 1000:1000`): container ran as `uid=1000(node)`, `pnpm run
    build` exit 0, `dist/out.txt` owned `1000:1000`, host reads/removes it
    freely.
- **Known limitations** (documented, not the reported env — R4 review):
  a host uid with no matching passwd entry inside the image gets `HOME=/`,
  which can break toolchains that cache under `$HOME` (go/cargo/gradle). uid
  1000 — the reported environment and the near-universal Linux dev uid — is
  unaffected. There is NO runtime warning or per-runner escape hatch for these
  two edges (no `user:` field exists in `ci.yaml`), so recovery today means not
  hitting them:
  - **R4-002** — host uid ≠ 1000 (second account, corporate provisioning) on
    python/go/rust images (only `runner`=1000 exists) → `HOME=/`.
  - **R4-001** — `build-context:` custom images always run as the host uid,
    dropping their baked `USER`; if the host uid has no passwd entry there,
    `HOME=/`. Note: forcing the host uid already moves `HOME` off the baked
    user's home, so a baked `~/.npmrc` under `/home/<baked-user>` is bypassed
    unless host uid == that user's uid.
  A writable-`HOME` guard (`-e HOME=/tmp`) was deliberately NOT added — it would
  regress build-context images that bake tool config under a real home.

  **FOLLOW-UP (SEC/DX, own ticket)**: close both edges properly — either a
  `user:` field in `ci.yaml` (per-runner opt out of the host-uid injection) or
  a conditional `-e HOME` only when the host uid has no in-image passwd entry.
  Design decision, not a batch fix. Also R4-003: the non-POSIX omit-branch of
  the `--user` guard is only covered by a vacuous early-return test.

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

### JF-DOCS-1 — `javi-forge ci` has no command-specific `--help` and no `ci validate` — CLOSED

Config errors surfaced only by running the full pipeline; there was no cheap way
to validate a CI config or discover `ci` flags.

- Evidence: `src/index.tsx:29-32` — meow was built once with the global
  `HELP_TEXT`, so there was no per-command help; `src/cli/dispatch/ci.tsx`
  handled only the `init` subcommand.
- Shipped:
  - `ci validate [--config <path>] [--json]` — new `src/commands/ci-validate.ts`
    (`validateCIConfig`) resolves the config path with the same discovery `runCI`
    uses, calls `loadCIConfig`, and reports. Valid → OK summary (config path + N
    runners with names/stacks), exit 0; invalid → each `CIConfigError` entry as
    `path: message` on stderr, exit 1; missing file → a named
    "no .javi-forge/ci.yaml found at <path>" error (never a stack trace), exit 1.
    `--json` emits `{ok:true,runners}` / `{ok:false,errors}`. A zero-config repo
    (no `.javi-forge/ci.yaml` found by discovery, no explicit `--config`) is
    treated as VALID auto-detect — `runCI` runs fine in that state via its
    zero-config path (ci.ts:396-406) — exit 0 with `{ok:true,mode:"auto-detect",
    runners:[]}`; only an explicit `--config` pointing at a missing file is an
    error. Pure parse-and-report: no image builds, no Docker, no phase execution.
    Dispatched in `src/cli/dispatch/ci.tsx`.
  - Per-command help: meow `autoHelp` disabled in `src/index.tsx` (global `--help`
    handled manually there); `ci --help` and any unknown `ci` subcommand print the
    new `CI_HELP_TEXT` (`src/cli/help.ts`) listing the `init`/`validate`
    subcommands and the `ci` flags. Global `--help` unchanged.
- Tests: `src/commands/ci-validate.test.ts` (valid, every error class, zero-config
  auto-detect, explicit-missing error — real temp dirs), `src/cli/dispatch/
  ci-validate.test.ts` (human + `--json` output, auto-detect, exit codes),
  `src/cli/dispatch/ci-help.test.ts` (`ci --help` + unknown subcommand),
  `src/__integration__/cli-help.integration.test.ts` (subprocess: global `--help`
  banner vs. `ci --help` usage are distinct, both exit 0), plus `CI_HELP_TEXT`/flag
  assertions in `src/cli/help.test.ts`.
- Not touched (per scope): config schema, `src/lib/docker.ts`/container layer,
  hook installer.

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

### SEC-1 — Hook write path: O_NOFOLLOW + fchmod (design-level hardening)
- **Source**: judgment-day slice 3b, JDA7-003/JDA7-005/JDB7-008 (convergent, parked by decision).
- **What**: the classify→write window on the HOOK path uses plain `fs.writeFile` (no O_NOFOLLOW) and the backup `chmod` is path-based (follows symlinks). A concurrent local attacker with write access to `.git/hooks` could plant a symlink inside the window. The backup CREATE is already atomic (COPYFILE_EXCL); this extends the property to the final write and the mode fix.
- **Fix shape**: `fs.open(hookPath, O_WRONLY|O_TRUNC|O_NOFOLLOW)` + write on the fd + `fchmod(fd, 0o755)`; same fd-based pattern for the backup chmod. Also consider `nlink > 1` refusal (hardlink truncation, mitigated by fs.protected_hardlinks=1 on modern Linux).
- **Threat model**: local attacker who ALREADY has write access to the repo's .git — low priority, defense in depth. Pre-existing class (the old clobber path had the same exposure with a smaller window).
- **CLOSED 2026-08-09**: shipped `writeHookFile()` in `src/commands/ci.ts` — the
  final hook write now goes through an FD opened
  `O_WRONLY|O_CREAT|O_TRUNC|O_NOFOLLOW` (mode `0755` on create) with
  `filehandle.writeFile` + `filehandle.chmod` (fchmod) in a `try/finally`
  close, so bytes and mode provably land on the same inode. The backup-side
  mode restore in `backupHook` is likewise fchmod on an FD opened
  `O_RDONLY|O_NOFOLLOW` right after the `COPYFILE_EXCL` create. `O_NOFOLLOW`
  degrades to `0` where the platform lacks it (Windows). Covered by
  "refuses a symlink planted AFTER classification (O_NOFOLLOW closes the race)"
  in `src/commands/ci-hooks.test.ts`, which plants the symlink during the asset
  read and asserts `ELOOP` plus an untouched victim file; verified RED against
  the old `fs.writeFile` path. All pre-existing hook tests pass unchanged.
- **Residual, still parked**: the `nlink > 1` (hardlink truncation) refusal was
  deliberately NOT added. `O_NOFOLLOW` does not stop a hardlink; on modern
  Linux `fs.protected_hardlinks=1` mitigates the cross-owner case.

> Follow-up (JDA7-012, one line): tighten `assertHookManifestEntry` with `.every((h) => typeof h?.sha256 === "string")` so a `historical:[null]` manifest yields a NAMED error.
>
> **CLOSED 2026-08-09**: shipped. `assertHookManifestEntry` now rejects any
> `historical` element without a string `sha256`, so `historical: [null]` and
> `historical: ["raw"]` surface as the named manifest error (path + reason +
> reinstall remedy) instead of an unnamed `TypeError` raised later inside
> `isReleasedBody`. Two RED-first tests added in `src/commands/ci-hooks.test.ts`
> ("installCIHooks manifest failures"); sibling hooks still install.
