# Design: CI Engine Unification

## Technical Approach

One executor (`runRunner`, the renamed `runConfiguredRunner`) drives every resolution source. Naming becomes data keyed on `resolved.source`; the auto image name is resolved in the prologue (order preserved) and threaded explicitly; `runStep` loses its `getImageName` re-derivation. Hook templates move to `assets/hooks/*` with a shipped `manifest.json` carrying the current hash plus the historical hashes that identify the unmarked fleet as `legacy-v0`. `installCIHooks` classifies before writing and refuses foreign/edited hooks without `--force`; `--force` writes a `.bak` first.

## Architecture Decisions

### D1 — Preserve image-build ORDER (R5)

**Choice**: keep the auto `ensureImage` in the prologue (ci.ts:554-572, BEFORE `.context/` refresh), capture its return into `autoImage`, pass it as `ctx.preresolvedImage`. When `preresolvedImage` is set, `runRunner` SKIPS its image-resolution block (so no extra `docker-image:{name}` step is emitted).
**Precondition (exact)**: `preresolvedImage` is set iff `resolved.source === "auto" && !noDocker`. The prologue `ensureImage` sits INSIDE the `if (!noDocker)` guard (ci.ts:536-573), so under `--no-docker` there is no image and `preresolvedImage` stays `undefined`.
**Guard shape in the executor**: the image-skip is NESTED inside the existing `!noDocker` guard — `if (!noDocker) { if (ctx.preresolvedImage) { image = ctx.preresolvedImage } else { …resolve/ensure… } }`. It NEVER replaces the `!noDocker` guard, so `--no-docker` keeps emitting zero image steps exactly as today.
**Alternatives**: move the build into the loop (flips step order, observable); recompute in both places (two sites again).
**Rationale**: implementable with one optional context field — no `runners.length` heuristic, no source sniffing inside the executor. `source==="auto"` guarantees exactly one runner with no `image`/`buildContext`, so "the prologue resolved it whenever Docker is on" is a total precondition.
**Spec alignment**: the spec hardened image-build-before-`.context/`-refresh into a MUST. This design CONFIRMS that ordering — no re-negotiation requested. The order is pinned by the slice-1 index-comparison test, not by code placement alone.

### D2 — Naming as a const-object strategy, keyed on `resolved.source`

**Choice**: `const NAMING_MODE = { BARE: "bare", SUFFIXED: "suffixed" } as const`, selected once in `runCI` as `resolved.source === "auto" ? BARE : SUFFIXED` and carried on the exec context. Phase descriptors carry `label` (running) and `doneLabel` (past tense) because legacy says `Tests passed` while the phase label is `Test`.
**`doneLabel` is scoped to BARE mode ONLY.** Suffixed mode keeps today's exact composition `${phase.label} [${runner.name}] passed` (ci.ts:880-886) — i.e. `Test [api] passed`, NEVER `Tests [api] passed`. Applying `doneLabel` in suffixed mode would silently rename configured-runner labels, which is the regression this change exists to avoid.
**Alternatives**: `runners.length === 1` (R3 — silently renames single-runner CONFIGS); a boolean `legacy` flag (opaque at call sites).
**Rationale**: naming is presentation data, not control flow; the const-object pattern keeps one source of truth and makes both modes trivially table-testable.

| Mode | step id | running | done / failed |
|---|---|---|---|
| bare | `lint` | `Lint: {cmd}` | `Lint passed` / `Lint failed` — `doneLabel` applies here only (test → `Tests passed`) |
| suffixed | `lint:{name}` | `Lint [{name}]: {cmd}` | `Lint [{name}] passed` / `… failed`; test → `Test [{name}] passed` (`label`, NOT `doneLabel`) |

### D3 — `runStep` takes an explicit image, no fallback

**Choice**: options-object signature; `image` required whenever `!noDocker`, enforced by an internal invariant throw. Delete `imageOverride ?? runner.image ?? getImageName(runner.stack)`.
**Rationale**: kills accident #7 and removes two implicit branches. Behavior is byte-identical because `ensureImage()` without `buildContext` returns exactly `getImageName(stack)` (docker.ts:186).

### D4 — Hook escape hatch: refuse + `--force`, force backs up first

**Choice**: CLI surface is `javi-forge ci init --force` (boolean, default `false`). `foreign` / `managed-edited` are REFUSED (message names the absolute path and the remedy). `--force` writes `<hook>.bak` (or `<hook>.bak.{epochMs}` if `.bak` exists) then installs. A symlink is refused even WITH `--force` (existing security property, unchanged).

**The backup path is a write target and gets the SAME protection as the hook path.** Before writing any backup:

1. `lstat` the candidate backup target (`<hook>.bak`, then `<hook>.bak.{epochMs}`). If it is a symlink or any non-regular file (directory, fifo, device), the hook is REFUSED — even WITH `--force`. Otherwise a hostile `.git/hooks/pre-commit.bak → ~/.ssh/authorized_keys` turns `--force` into the arbitrary-write primitive the hook-path `lstat` was added to close.
2. Create the backup with the EXCLUSIVE flag (`fs.open(target, "wx")` / `O_EXCL`) in a bounded retry loop: `.bak`, then `.bak.{epochMs}`, then `.bak.{epochMs}-{n}` for `n = 1..N`. `O_EXCL` makes "does it already exist?" and "create it" one atomic step, so a backup can never clobber a prior backup — this also removes the same-millisecond `.bak.{epochMs}` collision that plain `existsSync` + `writeFile` leaves open, and it defeats a symlink planted between the `lstat` and the write (TOCTOU).
3. The backup copies the ORIGINAL BYTES — `fs.copyFile`, or read+write as a `Buffer`. NEVER the utf8-decoded string: a non-UTF8 hook would be corrupted by the round-trip, and "the `.bak` holds the original bytes" is the spec's guarantee (ci-hook-install:86-95). The original file MODE is preserved (`fs.chmod(bak, originalStat.mode)`), so a restored backup is still executable.

**Backup failure ABORTS that hook.** If the backup write throws for any reason (`ENOSPC`, `EACCES`, `EEXIST` after the retry budget is exhausted), the hook MUST NOT be overwritten: the error is recorded per hook, the existing file is left byte-untouched, and sibling hooks continue. This is the spec MUST at ci-hook-install:86 — "if the backup cannot be written, the hook MUST NOT be overwritten". Concretely: the backup completes, and only then does the install write happen; there is no code path where the write precedes or races the backup.
**Alternatives**: `--overwrite` (vaguer, does not read as "I accept the risk"); `--yes` (reads as non-interactive consent, not clobber consent); silent `.bak`-and-overwrite (still destroys intent); refuse-only (no recovery path for the operator).
**Rationale**: `--force` is the conventional destructive-consent flag and `FLAGS_SCHEMA` has no `force` key today, so there is no collision with another command.

**Plumbing** (no Ink — `ci init` is console-only, `dispatch/ci.tsx:20-31`):

| Site | Change |
|---|---|
| `src/cli/help.ts:103` `FLAGS_SCHEMA` | `force: { type: "boolean", default: false }` (global flag table, shared by all commands) |
| `src/cli/dispatch/ci.tsx:22` | `installCIHooks(process.cwd(), { force: cli.flags.force })` |
| `src/cli/dispatch/ci.tsx:23-30` | Print `backups` (`⚠ Backed up existing pre-commit → .git/hooks/pre-commit.bak`) and print `upgraded` DISTINCTLY from fresh installs (`↑ Upgraded pre-commit (was legacy-v0)` vs `✓ Installed pre-commit`); refusals arrive in `errors[]`, so the existing `process.exit(errors.length > 0 ? 1 : 0)` keeps refusal = exit 1 with no new branch |
| `src/cli/help.ts` help text | Document `--force` under `ci init` |

Refusal is an ERROR, not a silent skip: partial installs stay per-hook isolated (today's semantics), so two clean hooks install while a foreign third fails the command.

### D5 — `legacy-v0` inventory built from git history, shipped as hashes

**Choice**: one-shot dev script `scripts/build-hook-history.mjs`: `git rev-list --all -- src/commands/ci.ts` → `git show <rev>:src/commands/ci.ts` → regex-slice each `const *_HOOK = \`…\`;` → render the literal (it has ZERO `${}` interpolations; the script ABORTS if an unescaped `${` appears) → dedupe → sha256 → `assets/hooks/manifest.json` `historical[]` with the first commit sha per variant. Revisions where the constant is absent are skipped; the number of distinct variants is an OUTPUT of the script, not an assumption.
**Alternatives**: ship no history (bricks `ci init` for ~8 repos — R2); fuzzy/normalized matching (accepts hand-edits as managed).
**Rationale**: exact-bytes matching is the only classification that cannot mistake a user edit for a release. The literal must be RENDERED, not sliced raw: the TS source escapes (`\\\\b`, `\${`) that disappear once the templates become plain files.
**Unmatched unmarked hook** → `foreign` → refuse, message: `.git/hooks/pre-commit exists and is not a javi-forge hook (no marker, and its contents match no released javi-forge template). Refusing to overwrite. Inspect it, then re-run 'javi-forge ci init --force' (the current file is saved as .git/hooks/pre-commit.bak), or delete it.`

### D6 — Hash INPUT = body below the marker block, never the whole file

**Choice**: the hash covers the hook body ONLY — the file with the marker block removed. Exactly:

0. `lstat` the path. Symlink → `SYMLINK`. Path exists but is NOT a regular file (a directory, fifo, socket, device) → `NOT_A_FILE`: refuse with a named reason (`.git/hooks/pre-commit exists but is not a regular file`), never `--force`-able. This state is NOT hypothetical — the pre-existing test at ci.test.ts:323-334 creates a DIRECTORY at `.git/hooks/pre-commit`; today it happens to surface as an `EISDIR` from `writeFile`, but once classification reads the file first, the `EISDIR` would come from `readFile` inside classification, so the state has to be modeled explicitly instead of falling out of an unhandled throw. `ENOENT` → `ABSENT`. Only a regular file continues to step 1.
1. Read the installed file as a `Buffer`, decode `utf8`.
2. Split into lines on `\n` (a trailing `\r` on any line is NOT stripped — CRLF content is a different hook and must classify as edited, not be silently normalized).
3. If line 0 starts with `#!`, and lines 1 and 2 match `^# javi-forge-hook: (?<name>[a-z-]+) v(?<version>\d+)$` and `^# javi-forge-hash: sha256:(?<hex>[0-9a-f]{64})$`, then `version`/`hex` are the claimed marker and the BODY is `[line0, ...lines.slice(3)].join("\n")` — the shebang stays IN the body, the two marker lines are removed. **The marker name is BOUND to the slot**: if `name !== hookName` (e.g. a `pre-commit` marker sitting in the `pre-push` slot) the file is NOT ours to manage — it classifies `foreign` and is refused. Treating a mismatched name as managed would let a copied/misplaced file be silently overwritten on the strength of someone else's marker.
4. `computed = sha256(Buffer.from(body, "utf8")).hex`. `managed-current` iff `version === manifest.version && computed === manifest.sha256`; `managed-outdated` iff `computed` matches a `historical[]` entry OR (`computed === manifest.sha256` with a stale `version`, the degenerate version-bump-without-body-change case); `managed-edited` otherwise (marker present, no hash match). The `hex` claimed by the file is NOT trusted for classification — it is informational only, because an editor could update body and marker together; classification always recomputes against the SHIPPED manifest.
5. Unmarked files (including files whose marker lines fail the regex for ANY reason — wrong name, wrong shape, or a trailing `\r` from CRLF conversion): `computed` over the whole file (no marker block to strip) against `historical[]` → `legacy-v0`, else `foreign`. Note the consequence for CRLF: because step 2 keeps `\r`, the `$`-anchored marker regex does not match, so a CRLF-converted managed hook takes this UNMARKED path and classifies `foreign`, not `managed-edited`. Both refuse; only the message differs. That is the intended outcome — the file genuinely no longer matches anything we released — and the test row asserts `foreign`.

**Trailing newline**: asset files end with exactly one `\n`; the hash includes it. Install writes `body` unmodified with the marker block spliced in, so a round-trip is byte-exact and re-running `ci init` yields `managed-current` with zero writes.

**Alternatives considered**: whole-file hash — REJECTED, self-defeating: the marker block contains both the version and the hash itself, so a whole-file digest is unstable by construction (it would have to hash its own output) and every version bump would classify prior installs as `managed-edited`, tripping the refusal on the entire fleet at the first upgrade. Hash-of-normalized-content (trim/CRLF-fold) — REJECTED: normalization makes a real user edit (line endings, trailing whitespace) invisible, which is exactly the drift this classification exists to catch.
**Rationale**: the marker is metadata about the body; hashing the body means a version bump ALONE (body byte-identical) does not invalidate installed hooks — they classify `managed-outdated` via the degenerate case in step 4, not `managed-edited`. That orthogonality holds ONLY while the body is unchanged; the moment a release changes the hook body, previously installed hooks stop matching `manifest.sha256` and are recognised solely because the OUTGOING body hash was appended to `historical[]` (see the forward-maintenance rule below). Body-hashing also keeps `assets/hooks/*` directly executable and testable on disk (the shipped file has no marker, so `sh assets/hooks/commit-msg` works in tests unchanged).

**Forward-maintenance rule for `historical[]` (BINDING, not advisory)**

`historical[]` is not a one-shot migration artifact — it is the fleet-recognition index, and it goes stale the instant someone edits a hook without touching it. Therefore:

- ANY future PR that changes the bytes of `assets/hooks/{pre-commit,pre-push,commit-msg}` MUST, in the SAME PR: (a) append the OUTGOING body hash — the sha256 of the asset body as it existed on the previous released commit — to that hook's `manifest.historical[]`, and (b) update `manifest[hook].sha256` (and `version`) to the incoming body.
- The outgoing hash is sourced from `assets/hooks/*` at the previous release (`git show <prev>:assets/hooks/<hook>`), NOT from the deleted inline TS constants. After slice 3 those constants no longer exist, so `scripts/build-hook-history.mjs` is a one-shot bootstrap and MUST NOT be presented as the ongoing mechanism.
- This is GUARDED, not documented-and-hoped — and the guard is PURE-FILE, never git-dependent (JDA-R2-001): `src/__tests__/hook-assets.test.ts` carries a `RELEASED_SNAPSHOT` of the full released hash LIST per hook and asserts (1) APPEND-ONLY — the manifest's `historical[]` still STARTS WITH the complete released list, so erasing/rewriting/reordering a released hash requires an explicit visible deletion in the test file (JDA6-001/JDB6-001: a count can be bumped honestly while a hash is silently rewritten; a list cannot); (2) GROWTH — when the manifest hash moves off the snapshot, the outgoing hash must be present and the list strictly longer. No `git show`, no skip-when-history-unavailable branch — `fetch-depth: 1` cannot disable it. A body change that forgets the append fails CI instead of silently bricking `ci init` for every installed repo — exactly the R2 failure this whole design exists to prevent.

**v1 specifically**: at extraction the asset bodies are byte-identical to the current inline literals, so the v1 manifest MUST satisfy `manifest[hook].sha256 === historical[<v0 entry>].sha256` for the v0 entry of that hook. A test asserts this equality per hook. It doubles as the spec's "extracted template is byte-equivalent to the previous inline literal" scenario: if extraction mangled an escape, the two hashes diverge and the test fails.

### D7 — Asset resolution via the existing `FORGE_ROOT` pattern

**Choice**: `export const HOOK_ASSETS_DIR = path.join(FORGE_ROOT, "assets", "hooks")` in `src/constants.ts` (`FORGE_ROOT` = `dirname(fileURLToPath(import.meta.url))/..`, already correct in both `dist/` and `tsx` dev). `package.json` `files` += `assets/`; `verify-package-contents.mjs` gains ALL FOUR paths — `assets/hooks/pre-commit`, `assets/hooks/pre-push`, `assets/hooks/commit-msg`, `assets/hooks/manifest.json` — to `REQUIRED_FILES`, plus `assets/` to `REQUIRED_PREFIXES`. Listing only one hook is NOT sufficient: `REQUIRED_PREFIXES` passes as soon as ANY single path under `assets/` is packed, so a tarball shipping `pre-commit` and silently dropping `commit-msg` would pass both checks while `ci init` fails at runtime for two of the three hooks. The spec requires every template to be in the published package, so every template is asserted by name.
**Rationale**: identical to `TEMPLATES_DIR` / `CI_LOCAL_DIR`; no new resolution mechanism.

## Data Flow

    runCI ─ resolveCIRunners ─→ ResolvedRunners{source, runners}
      │                              │
      ├─ docker-check                └─→ NAMING_MODE (source==="auto" ? bare : suffixed)
      ├─ docker-image (auto only) ──→ autoImage ─────────┐   ORDER PRESERVED
      ├─ context-refresh                                 │
      └─ for runner of runners → runRunner(runner, ctx{naming, preresolvedImage: autoImage, …})
                                        │
                                        ├─ image block (SKIPPED when preresolvedImage)
                                        ├─ required tools (no-op for auto)
                                        └─ phases → runStep({command, image, user, …})

    ci init --force? ─→ readHookAssets(HOOK_ASSETS_DIR) ─→ classify(existing, manifest)
                                    ├─ absent | outdated | legacy-v0 ─→ write
                                    ├─ managed-current ──────────────→ NO-OP (zero writes, idempotent)
                                    ├─ edited | foreign ─────────────→ force? backup→write : refuse
                                    │                                   backup: lstat target (symlink or
                                    │                                   non-regular → refuse even with
                                    │                                   --force) → O_EXCL create, retry
                                    │                                   .bak → .bak.{ms} → .bak.{ms}-{n}
                                    │                                   → copy ORIGINAL BYTES + mode
                                    │                                   → backup throws? ABORT this hook,
                                    │                                     file untouched, siblings continue
                                    └─ symlink | not-a-file ─────────→ refuse always

## File Changes

| File | Action | Description |
|---|---|---|
| `src/commands/ci.ts` | Modify | Delete `runLegacySteps` + the `RunnerStepContext`/`ConfiguredRunnerContext` split; `runRunner` + naming strategy; `runStep` options object; classify-before-write in `installCIHooks` |
| `src/commands/ci.ts:13` | Modify | Drop the now-unused `getImageName` import from the `../lib/docker.js` block (D3 deletes its last call site; biome `noUnusedImports` fails the build otherwise). Delete the three inline `*_HOOK` template constants in the same pass. |
| `assets/hooks/{pre-commit,pre-push,commit-msg}` | Create | Verbatim rendered templates (un-escaped) |
| `assets/hooks/manifest.json` | Create | Per hook: `version`, `sha256`, `historical[]` |
| `scripts/build-hook-history.mjs` | Create | One-shot generator for `historical[]` (dev-only, not packed) |
| `src/constants.ts` | Modify | `HOOK_ASSETS_DIR` |
| `src/cli/help.ts` | Modify | `force: { type: "boolean", default: false }` |
| `src/cli/dispatch/ci.tsx` | Modify | Pass `{ force }`; print `backups`; exit 1 on refusal (no Ink) |
| `package.json`, `scripts/verify-package-contents.mjs` | Modify | Ship + assert `assets/` |
| `src/commands/ci.test.ts` | Modify | ADDED tests ONLY — characterization + classification. ZERO edits to pre-existing assertions (see Testing Strategy) |
| `src/__integration__/ci-auto-docker.integration.test.ts`, `ci-hooks-exec.integration.test.ts` | Create | Docker-gated auto e2e; hook EXECUTION tests |
| `src/commands/tdd.ts`, `tdd-pipeline.ts`, `detectCIStack`, `CIStackInfo` | Unchanged | `resolveCIRunners:404` still calls `detectCIStack`; `stackInfo` survives for shell mode (B3 stays backlog) |

## Interfaces / Contracts

```ts
const NAMING_MODE = { BARE: "bare", SUFFIXED: "suffixed" } as const;
type NamingMode = (typeof NAMING_MODE)[keyof typeof NAMING_MODE];

interface RunnerExecContext {
  projectDir: string; mode: CIMode; noDocker: boolean; noSecurity: boolean;
  timeout: number; onStep: CIStepCallback;
  naming: NamingMode;
  /** Set only for source==="auto": image built in the prologue. */
  preresolvedImage?: string;
}

interface RunStepOptions {
  command: string; projectDir: string; noDocker: boolean; timeout: number;
  runner: ResolvedRunner; user?: string;
  /** REQUIRED when !noDocker — never re-derived. */
  image?: string;
}

const HOOK_STATE = {
  ABSENT: "absent", MANAGED_CURRENT: "managed-current",
  MANAGED_OUTDATED: "managed-outdated", MANAGED_EDITED: "managed-edited",
  LEGACY_V0: "legacy-v0", FOREIGN: "foreign", SYMLINK: "symlink",
  /** Path exists but is not a regular file (directory, fifo, device) — refuse, never forceable. */
  NOT_A_FILE: "not-a-file",
} as const;
type HookState = (typeof HOOK_STATE)[keyof typeof HOOK_STATE];

interface InstallHooksOptions { force?: boolean }
interface InstallHooksResult {
  installed: string[];
  /** Hooks that were `managed-outdated` or `legacy-v0` and got REPLACED by the current template. */
  upgraded: string[];
  backups: string[];
  errors: string[];
  /** Per-hook classification, so every spec scenario is observable from the result alone. */
  states: { name: string; state: HookState }[];
}
```

Marker block — injected at install time, lines 1-2, directly after the shebang. It is NOT stored in the asset file and NOT part of the hashed input (see D6):

```
#!/bin/bash
# javi-forge-hook: pre-commit v1
# javi-forge-hash: sha256:<sha256 of the body = file minus these two lines>
```

`assets/hooks/manifest.json` shape:

```jsonc
{
  "pre-commit": {
    "version": 1,
    "sha256": "<hash of assets/hooks/pre-commit, verbatim, trailing \n included>",
    "historical": [{ "sha256": "<hex>", "firstCommit": "<sha>" }]
  }
  // …pre-push, commit-msg
}
```

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit (slice 1) | Global step ORDER on auto+Docker | `vi.mock("../lib/docker.js")`: `isDockerAvailable→true`, `ensureImage`/`runInContainer` spies. Assert emitted-id sequence `detect, docker-check, docker-image, context-refresh, lint, compile, test` and `indexOf("docker-image") < indexOf("context-refresh")` (pins R5 with no real Docker) |
| Unit (slice 1) | Image threaded into every container run | The `ensureImage` mock returns `getImageName(runner.stack)` — PRODUCTION-FAITHFUL, because `ensureImage` without `buildContext` returns exactly that (docker.ts:186). Assert every `runInContainer` call receives that image. The assertion is INVARIANT across the slice-2 collapse: before the collapse `runStep` re-derives it, after the collapse it is threaded from the prologue, and both produce the same string — so this test is written once and NEVER edited |
| Unit (slice 1) | `--user root` only on compile | Assert `runInContainer` spy args: `user==="root"` for the compile command, `undefined` for lint/test |
| Unit (slice 1) | `--stack node` step ids through `runCI` | Freeze B1 (`lint:node`) as-is |
| Unit (slice 2) | Naming table | Both modes over the same runner; bare for auto, suffixed for a SINGLE-runner config (R3 guard). Explicit `doneLabel`-scoping rows: bare test phase → `Tests passed`; SUFFIXED test phase → `Test [api] passed` (NEVER `Tests [api] passed`) — the row that catches `doneLabel` leaking into suffixed mode |
| Unit (slice 2) | Image invariant | `!noDocker` + missing image throws (covers the new branch) |
| Unit (slice 3) | Classification matrix | All 8 `HookState`s × {write, refuse, backup} — see the row-by-row table below; `sha256(asset) === manifest.sha256` (asset-drift guard); `manifest[hook].sha256 === historical[v0].sha256` (v1 byte-equivalence to the inline literal); `historical[]` contains the previous released asset body hash (forward-maintenance guard, D6) |
| Unit (slice 3) | Hash-input semantics (D6) | Install → re-classify = `managed-current` with ZERO writes (mtime + bytes unchanged, round-trip byte-exact); body unchanged but marker version bumped → `managed-outdated`, NOT `managed-edited`; one byte changed in the body → `managed-edited`; marker naming a DIFFERENT hook → `foreign` |
| Integration | Hooks EXECUTED | Temp repo + `sh <hook>`: commit-msg table of blocked/allowed messages (exit 1/0); pre-commit/pre-push run with a stub `javi-forge` (and stub `docker`) first on `PATH`, asserting the exact frozen flag string and that a non-zero CLI aborts the hook |
| Integration | auto + real Docker | New file, gated exactly like `ci-mixed.integration.test.ts` (skip unless Docker AND the javi-forge node image already exists locally) |
| E2E | Unchanged | `ci-hooks.e2e.test.ts` keeps pinning exit-code propagation |

### Slice-3 classification / write matrix (one test row each)

| Situation | Classification | No `--force` | With `--force` |
|---|---|---|---|
| No file at path | `absent` | write | write |
| Marked, version + body-hash match manifest | `managed-current` | NO-OP, zero writes | NO-OP, zero writes |
| Marked, body hash in `historical[]` (or stale version, identical body) | `managed-outdated` | write, reported in `upgraded[]` | same |
| Unmarked, whole-file hash in `historical[]` | `legacy-v0` | write, reported in `upgraded[]` | same |
| Marked, body hash matches nothing | `managed-edited` | REFUSE, file unchanged | backup → write |
| Unmarked, hash matches nothing / marker names a different hook / CRLF-converted marker | `foreign` | REFUSE, file unchanged | backup → write |
| Hook path is a symlink | `symlink` | REFUSE, hook unchanged, TARGET intact | REFUSE — `--force` does not apply |
| Hook path is a directory / non-regular file | `not-a-file` | REFUSE with a named reason | REFUSE — `--force` does not apply |
| **Backup path (`.bak` / `.bak.{ms}`) is a symlink or non-regular file** | (target guard) | n/a (no backup attempted) | **REFUSE — hook unchanged, backup target intact, no write anywhere** |
| **Backup write throws (ENOSPC / EACCES / EEXIST after retries)** | (target guard) | n/a | **per-hook error, hook file BYTE-UNCHANGED, siblings still install** |
| CRLF-converted managed hook | `foreign` (marker regex fails on trailing `\r` → unmarked path) | REFUSE | backup → write |

Every REFUSE row asserts both halves: the error is recorded AND the on-disk bytes are identical to before.

### Zero pre-existing test edits

**Every test change in this design is ADDITIVE. No pre-existing assertion is edited, weakened or deleted** — which is what spec `ci-execution:110` requires ("the only test edits allowed are ADDED tests") and what the "collapse lands on a green safety net" scenario checks.

Two spots that LOOK like they force an edit, and why they do not:

- **The slice-1 image assertion.** It asserts against `getImageName(runner.stack)` returned by the `ensureImage` mock, not against a sentinel. Because production `ensureImage` without `buildContext` returns exactly `getImageName(stack)` (docker.ts:186), the expected value is identical before and after the slice-2 collapse. Nothing to flip.
- **The hook substring greps at `ci.test.ts:262-298`.** They assert `content).toContain("javi-forge ci --quick")`, `"docker info"`, `"co-authored-by"`, etc. Those substrings live in the hook BODY, and the marker block is injected as two lines after the shebang WITHOUT touching the body — so every grep keeps passing verbatim against the installed file. The stronger checks (installed file === asset bytes with the marker block spliced in; marker lines match the regex; recorded hash === `manifest.sha256`) are ADDED as NEW test cases ALONGSIDE the existing greps, which stay exactly as they are.

Mutation testing: Stryker mutates `src/constants.ts`, so the new `HOOK_ASSETS_DIR` string is a mutant target. The asset-reading tests must KILL those mutants — any test that stubs or hard-codes the assets directory instead of reading through `HOOK_ASSETS_DIR` leaves a survivor, so the classification tests resolve assets via the exported constant.

## Coverage Guard (R4)

**The gate is a SAME-RUN DELTA, never an absolute percentage.** At slice-N verify
time, run `npx vitest run --coverage` TWICE on the SAME machine within the SAME
session — once with the working tree at the merge-base (the previous slice's
head) and once at the slice head — using the identical command and the identical
environment. The gate is `head >= base` on BOTH lines and branches, tolerance 0. Both metrics are compared as PERCENTAGES (covered/total), never raw covered counts — a deletion refactor legitimately shrinks absolute counts while the ratio holds or rises. Observed inter-run jitter on this suite is ±1 branch on an identical tree (measured slices 1-2); a delta within ±1 branch counts as equal, so "tolerance 0" applies to the percentage beyond that measured noise band.

Why the form, not just the number: absolute figures were written into this design
three times and were wrong three times. They fail in two independent ways.

1. **Stale by one commit.** Any number written down is measured against a tree
   that the next commit invalidates; the document then asserts a floor nobody
   re-measured.
2. **Environment-dependent.** The Docker-gated suites
   (`src/__integration__/ci-*.integration.test.ts`) execute on a developer box
   with Docker and a prebuilt image, and `skipIf` themselves out in CI. The same
   commit therefore reports different coverage on different machines, so no
   absolute number is portable enough to gate on.

A same-run delta is immune to both: base and head are measured under the same
conditions, so the environment cancels out and neither side can be stale.

INFORMATIVE measurements (context only — NOT the gate). Environment: developer
box, Docker available with the `javi-forge-node` image present, so the
Docker-gated integration suites RAN. `pnpm test:coverage` / `npx vitest run
--coverage`, project totals from `coverage/clover.xml`:

| Tree | Lines | Branches |
| --- | --- | --- |
| `main` @ `2a0abaa` | 3265 / 3725 = 87.65% | 1880 / 2411 = 77.97% |
| slice 1 @ `12d9b4d` | 3291 / 3725 = 88.34% | 1902 / 2411 = 78.88% |
| slice 1 @ `1f5c69b` (current head) | 3300 / 3725 = 88.59% | 1904 / 2411 = 78.97% |

The drift between the last two rows is exactly the point: same branch, two
commits apart, and the "floor" moved. Read these rows as history, not as a gate.

Two facts they expose, both pre-existing and neither caused by this change:

- `pnpm test:coverage` FAILS on `main` — the configured 80% branch threshold in `vitest.config.ts` is unmet (77.97%). The gap is pre-existing debt, tracked in `docs/BACKLOG.md` (COV-1), out of scope here. That failure is orthogonal to the delta gate: the delta can pass while the configured threshold still fails.
- `pnpm validate` does NOT run coverage, so those thresholds gate nothing in CI or in the hooks today (COV-2).

Slice 1 moves both numbers UP relative to `main` by landing the previously-0% prologue `ensureImage` try/catch (ci.ts:562-571) and the auto Docker leaf.

**Slice-2 coverage guard**: run the same-run delta with base = the slice-1 merge
head and head = the slice-2 branch head; require lines and branches both `>=`
base. The `vitest.config.ts` thresholds are left EXACTLY as they are — not
raised, not lowered. Structurally the collapse is branch-negative: −1 executor fork (`source==="auto"`), −2 image fallbacks (`?? runner.image ?? getImageName`), +1 naming selection, +1 image invariant, both directly tested.

## Non-Goals (explicit)

No new `ci.yaml` keys (schema v1 locked). No hook CONTENT change — the fleet's `commit-msg` patterns, the pre-push hard-fail on missing Docker, and the npx fallbacks all ship verbatim; adopting `ci-local/hooks/*` is a separate change. No gates-v2 surface: no `gate`/`mode` fields, no status-vocabulary change, no `--json` wiring, no unification of skip semantics. B1/B2/B3 stay backlog.

## Migration / Rollout

No data migration. Three independently revertible PRs (slice 1 additive). Existing repos: first `ci init` after upgrade reclassifies unmarked-but-known hooks as `legacy-v0` and upgrades them in place; genuinely foreign hooks now refuse with an actionable message instead of being clobbered.

## Open Questions

- [ ] The Docker-gated auto integration test is opportunistic (skips unless the javi-forge node image is already built locally); the always-on net is the mocked-Docker unit test. Accepted, recorded as a residual R1 gap.
- [ ] `historical[]` variant count is unknown until `scripts/build-hook-history.mjs` runs (no shell available in the design phase) — this is a slice-3 apply-time output, and a run producing ZERO historical variants must BLOCK the slice, not ship.
