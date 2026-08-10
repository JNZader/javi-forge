# Design: hooks-ricos — richer hook bodies, fail-closed, no degrade

## Technical Approach

Two independent, sequential-PR slices swap the SHIPPED hook bodies in
`assets/hooks/*` for the richer `ci-local/hooks/*` variants (minus the degrade
branch) and version-bump `manifest.json`. The install machinery is
**body-agnostic**: `HOOK_NAMES` is a fixed 3-tuple (`ci.ts:1700`), `installCIHooks`
iterates it, `renderHook` (`ci.ts:1811-1823`) splices the marker after the shebang,
`classifyHookContent` (`ci.ts:1734-1770`) hashes the body-below-marker against the
manifest. Swapping a body + bumping the manifest touches **zero install logic** —
Open-Question #2 is RESOLVED below with evidence. The only code changes are the
asset files, `manifest.json`, and the tests coupled to hook bytes.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale (evidence) |
|---|----------|-----------------------|----------------------|
| D1 | No `ci.ts` logic change; body+manifest only | Add a shared conv-commit validator reused by `javi-forge ci` | `classifyHookContent`/`renderHook`/`installCIHooks` never read body content — they hash and splice. `manifest.sha256` = `sha256(raw asset bytes)` (`hook-assets.test.ts:138`). New bytes → recompute + bump. Conv-commit enforcement is pure shell regex (D3), needs no code path. |
| D2 | commit-msg conv-commit check lives entirely in the shell body | `ci.ts` validator | Keeps Slice A a body+manifest+tests change; a shared validator would expand scope for reuse we do not need now (Open-Q #2). |
| D3 | NFKC is BEST-EFFORT via `perl -CSAD` + `Unicode::Normalize::NFKC`, degrade-to-raw-only | `iconv`, GNU-only tricks; an UNCONDITIONAL NFKC MUST | The variant already uses perl (`ci-local/hooks/commit-msg:41-67`); `Unicode::Normalize` is a perl-core module; if perl/module absent it `printf`s the raw msg and the loop still matches literal patterns against `RAW_MSG` (`:47-48,133-135`). NFKC is therefore an ADVISORY layer, not a guarantee — the always-on guarantee is raw-literal matching. Honest-user threat model (`ci-local/hooks/commit-msg:19-27`, `proposal.md:54-55`): the guardian catches accidental attribution by an honest committer, NOT an adversary crafting compatibility-char evasion. The spec MUST NOT assert NFKC as an unconditional MUST (JDA-004; see spec reconciliation). Portable enough; not iconv. |
| D4 | pre-push runs `ci --quick --no-docker --no-security --no-ci-ghagga`, NO docker branch | Full containerized run; keep degrade | Fail-closed lives at the GATE layer: any blocking image gate under `--no-docker` is refused → `blockingFailures` → build fail (`ci.ts:1464-1486`). Never touches Docker → never hits PREPUSH-EACCES. Flags all exist and already compose in the shipped `assets/hooks/pre-commit:7`. |
| D5 | Include `--no-ci-ghagga` in pre-push | Omit it | Open-Q #4: the variant passes it on its degrade branch (`ci-local/hooks/pre-push:26`) and the shipped pre-commit uses the same 4-flag set. GHAGGA review is not a pre-push gate; matches pre-commit ergonomics. |
| D6 | No WIP exemption; rely on `git push/commit --no-verify` | Allow a bare `WIP`/`wip:` prefix | A WIP allowlist weakens the gate and WIP subjects should not reach shared history; `--no-verify` is the documented escape (Open-Q #1). |
| D7 | Ship test suite at `assets/hooks/commit-msg.test.sh`, wire via a vitest wrapper | test-only dir; package.json step | The `.sh` hardcodes `HOOK="$SCRIPT_DIR/commit-msg"` (`commit-msg.test.sh:17-18`) → as a sibling of the shipped asset it tests the REAL body. Install is a fixed-name loop, not a glob, so the sibling `.sh` is inert to install (Open-Q #3). MOVE (not copy) — one source of truth; see D8/D9 for the two mechanical consequences of the move. |
| D8 | MOVE the `.sh` → update the `test:hooks` script path in the SAME slice | Copy (two sources of truth); leave the script pointing at the old path | `package.json:19` runs `"test:hooks": "bash ci-local/hooks/commit-msg.test.sh"`. Moving the file to `assets/hooks/commit-msg.test.sh` ORPHANS that script; the slice MUST update it to `bash assets/hooks/commit-msg.test.sh` in lockstep (JDA-005). MOVE keeps a single corpus; COPY would drift. |
| D9 | Do NOT ship the `.test.sh` corpus to consumers — exclude it from the tarball | Accept the ship (status-quo already ships a `.sh` under `ci-local/`) | `.npmignore` excludes `*.test.ts/js/tsx` but NOT `*.test.sh`, and `files` ships all of `assets/` → the corpus would land in the consumer tarball. A test corpus is not consumer runtime, so ADD `*.test.sh` to `.npmignore` AND to the `package:check` FORBIDDEN_PATTERNS (`scripts/verify-package-contents.mjs`) so the guard fails if it ever ships (JDA-006). Chosen: exclude, not accept. |

## Slice A — commit-msg (HOW)

- **Body**: replace `assets/hooks/commit-msg` (currently 30 lines) with the
  `ci-local/hooks/commit-msg` body (NFKC normalize `:41-67`, ~30 pattern families
  `:83-129`, RAW+normalized double-match `:133-135`). Ends with one trailing `\n`,
  starts `#!/bin/bash\n` (satisfies `hook-assets.test.ts:125-131`).
- **New conv-commit block** (append before `exit 0`, `set -e`-safe): derive the
  SUBJECT = first line that is non-blank AND not `^#` (git has not run cleanup yet
  at commit-msg time, so `#`-comments are still present). Then:
  - EXEMPT (skip, exit 0 path): `^Merge `, `^(fixup|squash)! `, `^(amend|reword)! `
    (git ≥2.32 autosquash prefixes emitted by `git commit --fixup=amend:`/`=reword:`),
    `^Revert ` (git's generated `Revert "..."`). JDB-003: the autosquash set is
    `fixup|squash|amend|reword`, not just `fixup|squash` — omitting `amend!`/`reword!`
    wrongly blocks modern autosquash flows.
  - Else REQUIRE
    `^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9._-]+\))?!?: .+`
    via `if ! [[ "$SUBJECT" =~ <re> ]]; then echo ...; exit 1; fi` (bash `[[ =~ ]]`,
    ERE). `revert` is a valid type so manual `revert: x` passes without exemption.
  - **Ordering**: run BOTH checks; report first-fail. Put the attribution loop
    first (it is the standing hard rule), then the subject-format check — a message
    that carries attribution is rejected regardless of subject shape. Distinct
    non-zero exits with named messages (`COMMIT BLOCKED: AI Attribution Detected`
    already exists `:137`; add `COMMIT BLOCKED: subject must be Conventional Commit`).
- **Portability**: body is `#!/bin/bash` (uses arrays + `[[ =~ ]]`); git invokes
  hooks via the shebang, so bash is guaranteed. Not POSIX `sh`.
- **Test asset**: move `ci-local/hooks/commit-msg.test.sh` →
  `assets/hooks/commit-msg.test.sh`; ADD `expect_block` cases for non-conforming
  subjects and `expect_pass` for each exemption + conforming subjects. Add a vitest
  wrapper `src/__tests__/commit-msg-hook.test.ts` that
  `execFileSync("bash", [path.join(HOOK_ASSETS_DIR,"commit-msg.test.sh")])` and
  asserts exit 0 — this is how a `.sh` joins the vitest run.
- **ci.test.ts fix**: line 382 `toContain("anthropic.com")` FAILS — the rich body's
  literal is `@(anthropic|openai|cursor|codeium)\.(com|sh|ai)` (`commit-msg:127`),
  no contiguous `anthropic.com`. Change to `toContain("anthropic")` (present).
  Lines 378-381 (`co-authored-by`, `claude`, `gpt`, `chatgpt`) stay valid.
- **ci-init.integration.test.ts fix (Slice A)**: line 81
  `toContain("co-authored-by:.*claude")` FAILS — the rich body's trailer pattern is
  `"co-authored-by:.*\b${PROVIDER_PAT}\b"` (`ci-local/hooks/commit-msg:86`) where
  `PROVIDER_PAT='(claude|gpt|...)'` is a shell VARIABLE, so the installed body has no
  contiguous literal `co-authored-by:.*claude`. Apply the SAME split-assertion fix used
  for `anthropic.com`→`anthropic` at ci.test.ts:382: assert `toContain("co-authored-by")`
  and `toContain("claude")` as two separate assertions. Lines 82-83
  (`AI Attribution Detected`, `COMMIT_MSG_FILE`) stay valid.

## Slice B — pre-push (HOW)

- **Body**: replace `assets/hooks/pre-push` with, unconditionally,
  `javi-forge ci --quick --no-docker --no-security --no-ci-ghagga`; adopt the
  variant's `$SECONDS` elapsed logging + clear abort message
  (`ci-local/hooks/pre-push:12,18-22,35-39`); STRIP the `if docker info` branch and
  the degrade `else`. Keep `git push --no-verify` in the header comment.
- **PRESERVE the npx fallback (ORCHESTRATOR DECISION)**: the SHIPPED
  `assets/hooks/pre-push:11-14` guards the invocation with
  `command -v javi-forge &>/dev/null && javi-forge ci || npx javi-forge ci`. The new
  body MUST KEEP this `command -v javi-forge || npx javi-forge` fallback, adapted to the
  new native invocation, e.g.:
  `if command -v javi-forge &>/dev/null; then javi-forge ci --quick --no-docker --no-security --no-ci-ghagga; else npx javi-forge ci --quick --no-docker --no-security --no-ci-ghagga; fi`.
  RATIONALE: the asset ships fleet-wide via `package.json` `files:["assets/"]`; dropping
  the fallback regresses every consumer without a global install. This is a firm
  decision, not an open question.
- **Fail-closed**: preserved at the gate layer (`ci.ts:1464-1486`), not a docker
  probe. Behavior change vs shipped: never runs containerized → never hits
  PREPUSH-EACCES; a fleet repo declaring a blocking image gate now fail-closes on
  every native pre-push (documented policy consequence; `javi-forge` declares none).
- **ci.test.ts fix**: line 367 `toContain("docker info")` FAILS (branch removed).
  Change to `toContain("--no-docker")`; line 368 `toContain("javi-forge ci")` stays.
  Rename the test to reflect native-quick, no docker branch.
- **ci-init.integration.test.ts fix (Slice B)**: line 72 `toContain("docker info")`
  FAILS (the docker-probe branch is removed) → change to `toContain("--no-docker")`.
  Line 73 `toContain("javi-forge ci")` STAYS (present in the native invocation). Line 74
  `toContain("npx javi-forge ci")` is PRESERVED-BY-DECISION, not broken: because the npx
  fallback is kept, the body still contains the contiguous substring `npx javi-forge ci`
  (inside `npx javi-forge ci --quick --no-docker --no-security --no-ci-ghagga`), so :74
  keeps passing unchanged. Verified against the exact substring the assertion checks.
- **ci-hooks-exec.integration.test.ts fix (Slice B, EXECUTION cases `:180-204`)**: the
  three pre-push EXECUTION cases assert the OLD docker-probe contract and MUST be
  rewritten because the native body runs no docker probe:
  - `:180-186` "runs the full CI simulation when Docker answers" — the argsLog assertion
    `readArgsLog()` == `["info","ci"]` (`:185`) breaks (no `info` probe, no bare `ci`).
    REWRITE: the expected argsLog becomes the new native invocation. MECHANICS
    (verified against `writeStub`/`readArgsLog`): the stub logs `printf '%s\n' "$*"` —
    one line per invocation = the WHOLE arg string — and `readArgsLog` splits on `\n`
    only, so the single native pre-push call captures exactly ONE element, NOT a
    per-token array. The expectation is therefore
    `readArgsLog()` == `[FROZEN_PRE_COMMIT_FLAGS]`, i.e.
    `["ci --quick --no-docker --no-security --no-ci-ghagga"]` (a single string,
    identical to the frozen pre-commit vector the pre-commit cases at `:165,:175`
    already assert). Reuse the existing `FROZEN_PRE_COMMIT_FLAGS` constant (`:26-27`);
    do NOT write it as a 5-element token array. No leading `info`. Rename the case to
    reflect "runs the native quick gate" (no Docker precondition).
  - `:188-195` "aborts when the CLI exits non-zero" — stdout `"CI FAILED"` (`:192`) and
    argsLog `["info","ci"]` (`:194`) update to the native invocation argsLog, which is
    the SAME single-element form `[FROZEN_PRE_COMMIT_FLAGS]` == 
    `["ci --quick --no-docker --no-security --no-ci-ghagga"]` (no `info`, one line);
    the abort-message assertion must match the new body's abort text (the variant's
    `Push aborted` / `FAILED` message, `ci-local/hooks/pre-push:19,29`) — align the
    expected substring with whatever the rewritten body prints on non-zero exit.
  - `:197-204` "refuses to run CI when Docker is unavailable" (`STUB_EXIT_DOCKER=1` →
    exit 1 + `"Docker is not running"` + argsLog `["info"]`) — this case is NO LONGER
    MEANINGFUL at the pre-push level: a native pre-push never probes Docker, so there is
    no "Docker down → refuse" behavior to assert here. RE-EXPRESS: DELETE this
    pre-push-level case; the fail-closed guarantee now lives at the GATE layer
    (`ci.ts:1464-1486` — a blocking image gate under `--no-docker` is REFUSED), which is
    exercised by the spec's "Image-gated repo cannot false-green" scenario and covered by
    the ci-gates gate-layer tests, NOT by a hook-execution stub. Do not re-home a Docker
    probe into the hook body just to keep this assertion alive.

## Manifest edit recipe (per slice — `hook` ∈ {commit-msg, pre-push})

1. `v2hash = sha256(new raw asset bytes)` (compute at apply — not knowable now).
2. `manifest[hook].version`: 1 → 2.
3. `manifest[hook].sha256`: v1hash → v2hash.
4. `manifest[hook].historical`: APPEND `{sha256: v2hash, firstCommit: <commit-hex>}`
   keeping the existing v1 entry at index 0. **Do NOT re-add v1hash** — it is
   already index 0 and the dedupe guard (`hook-assets.test.ts:159`) rejects dupes.

**Why this passes the guards** (`historyMaintenanceViolations`, `hook-assets.test.ts:91-122`):
prefix `[v1hash]` intact; outgoing hash = v1hash already present; historical grows
1→2. **Correction to the proposal's phrasing**: v1hash is ALREADY in `historical[]`;
what you actually append is the NEW v2hash — you never re-append the outgoing hash.

**Classify outcome matrix** (`ci.ts:1752-1769`): marked v1 install → body hash = v1hash
∈ historical → `managed-outdated` → silent upgrade on next `ci init` (no `--force`,
no `.bak`); locally edited body (hash ∉ manifest) → `managed-edited` → refused;
legacy unmarked (~8 installs) → `legacy-v0` → upgraded.

## Test breakages both slices MUST fix

This is the list of hook-coupled tests identified by sweep as of judgment-day round 2
(both unit AND the executed-hook integration files AND the e2e hook-contract suite).
This is NOT asserted as absolutely complete — an equivalent absolute claim was made
twice in earlier rounds and falsified twice (JD-BLOCKER-1, then JDA2-001). Completeness
is anchored to a reproducible grep plus an apply-time re-check, not to an assertion.

**APPLY-TIME GATE (mandatory, per slice).** Before finalizing each slice, the apply
agent MUST re-grep the FULL test tree — `src/**/*.test.ts`, `src/__integration__/**`,
`src/e2e/**` — for: hook-body substrings, version literals, `sha256` literals,
`docker info`, `npx`, `co-authored-by`, `anthropic`, and the pre-push arg vector
(`--quick --no-docker --no-security --no-ci-ghagga`). Reconcile ANY hit not already in
this list before the slice is considered done.

### Shared / manifest guard (both slices, each in its own PR)

- `hook-assets.test.ts:141-149` — the blanket `expect(entry.version).toBe(1)` and
  `entry.sha256 === entry.historical[0].sha256` BREAK for a v2 hook. Refactor to a
  per-hook EXPECTED_VERSION map (Slice A: commit-msg→2; Slice B: pre-push→2;
  pre-commit stays 1) and assert `entry.sha256 === entry.historical.at(-1).sha256`.
- `RELEASED_SNAPSHOT[hook]` (`hook-assets.test.ts:46-68`): update in the SAME PR to
  `{ sha256: v2hash, historical: [v1hash, v2hash] }` — ratchets the baseline while
  keeping append-only (prefix `[v1hash]` intact).
- `ci-hooks.test.ts` — its `classifyHookContent` cases use SYNTHETIC fixtures
  (`version: 2`, CURRENT/OUTGOING, `:56-64`), NOT the real manifest; verify only,
  no edit expected.

### Slice A — commit-msg (files this slice touches)

- `ci.test.ts:382` — `toContain("anthropic.com")` → `toContain("anthropic")` (rich body
  has no contiguous `anthropic.com`; the literal is `\.(com|sh|ai)` grouped).
- `ci-init.integration.test.ts:81` — `toContain("co-authored-by:.*claude")` FAILS
  (`PROVIDER_PAT` is a shell variable in the trailer pattern at
  `ci-local/hooks/commit-msg:86`). Split into `toContain("co-authored-by")` +
  `toContain("claude")` (mirrors the :382 fix). `:82-83` stay valid.
- `package.json:19` — `test:hooks` script path `ci-local/hooks/commit-msg.test.sh` →
  `assets/hooks/commit-msg.test.sh` (D8, after the MOVE).
- `.npmignore` + `scripts/verify-package-contents.mjs` FORBIDDEN_PATTERNS — add
  `*.test.sh` so the moved corpus does NOT ship to consumers (D9).
- Promote/MOVE `ci-local/hooks/commit-msg.test.sh` → `assets/hooks/commit-msg.test.sh`
  (D7) + add the vitest `execFileSync` wrapper (`src/__tests__/commit-msg-hook.test.ts`).
- `hook-assets.test.ts` shared entries above (commit-msg→v2).

### Slice B — pre-push (files this slice touches)

- `ci.test.ts:367` — `toContain("docker info")` → `toContain("--no-docker")` (branch
  removed); `:368` `toContain("javi-forge ci")` stays. Rename the test.
- `ci-init.integration.test.ts:72` — `toContain("docker info")` →
  `toContain("--no-docker")` (probe branch removed). `:73` `toContain("javi-forge ci")`
  stays. `:74` `toContain("npx javi-forge ci")` PRESERVED-BY-DECISION (npx fallback kept)
  → NOT broken, no edit.
- `ci-init.integration.test.ts:68` — the test title `"pre-push checks Docker before
  running"` goes STALE once `:72` asserts `--no-docker` (native pre-push runs no Docker
  probe). Cosmetic only — assertions still pass — but RENAME it for parity with the
  `ci.test.ts:367` rename this slice already prescribes (e.g. `"pre-push runs the native
  quick gate (no Docker)"`).
- `src/e2e/ci-hooks.e2e.test.ts` — hook-CONTRACT e2e suite (skipIf-gated on Docker;
  invokes `runCLI` directly, NOT the hook body) that this slice MUST touch. It does NOT
  turn the build red: it is coverage-rot + a FALSE docstring, not a red. Two edits:
  (1) **Fix the module docstring** (`:5-6`): it claims `pre-push: javi-forge ci (full,
  Docker)`, which is exactly the contract Slice B removes. Correct it to the native
  `pre-push: javi-forge ci --quick --no-docker --no-security --no-ci-ghagga`. The
  docstring MUST be corrected regardless of what (2) chooses.
  (2) **Reconcile OR retire the `describe("hook contract — pre-push (full, docker)")`
  block** (`:202-254`), which invokes `runCLI(["ci"])` — the bare full-docker command —
  as "the exact bare hook command". Since Slice B makes the native pre-push arg vector
  `--quick --no-docker --no-security --no-ci-ghagga` IDENTICAL to pre-commit's, this
  block is now redundant with the pre-commit contract block. RECOMMEND: retire it as
  redundant; alternatively reconcile its `runCLI(["ci"])` calls and comments to the
  native `--quick --no-docker --no-security --no-ci-ghagga` contract. Apply agent picks
  retire-or-reconcile; the docstring fix in (1) is non-optional either way.
- `ci-hooks-exec.integration.test.ts:180-204` — the three pre-push EXECUTION cases:
  `:180-186` rewrite argsLog `["info","ci"]` → single-element `[FROZEN_PRE_COMMIT_FLAGS]`
  == `["ci --quick --no-docker --no-security --no-ci-ghagga"]` (one line, no `info` — the
  stub logs `$*` as one line and `readArgsLog` splits on `\n`, so NOT a per-token array);
  `:188-195` update `"CI FAILED"` + argsLog to the new body's abort text + that SAME
  single-element native form; `:197-204` DELETE the "Docker unavailable → refuse" case
  (no docker probe at pre-push; fail-closed re-homed to the gate layer). Full
  per-assertion detail in Slice B — pre-push.
- `hook-assets.test.ts` shared entries above (pre-push→v2).

## Slicing & review workload

| Slice | Reviewable logic | Test data | 400-line risk |
|-------|------------------|-----------|---------------|
| A commit-msg | ~150 body + ~25 conv-regex + ~15 wrapper + manifest/test fixes (~15) ≈ 205 | promoted `.sh` ≈ 290 (append-mostly, low-risk) | **Medium** (raw count inflated by test corpus; logic well under 400) |
| B pre-push | ~40 body + manifest/test fixes (~15) ≈ 55 | — | **Low** |

Sequence A then B, separate PRs (independent — share no code). Slice A's raw line
count is dominated by the promoted test suite; recommend one PR with a
`size:exception` note flagging the corpus as low-risk data, or split the suite
promotion into its own commit for review clarity.

## Migration / Rollout

Asset-level, published via semantic-release. Silent auto-upgrade for marked
installs; legacy repos via `legacy-v0`. Rollback = revert asset bytes + manifest +
`RELEASED_SNAPSHOT`; append-only `historical[]` means even an already-upgraded repo
re-classifies cleanly against a reverted manifest.

## Open Questions (resolved) — flagged for judgment-day

- **#2 no-ci.ts-change**: RESOLVED — install is body-agnostic (D1); conv-commit is
  pure shell (D2/D3). Zero `ci.ts` logic delta both slices.
- **NFKC portability**: RESOLVED — perl-core NFKC, degrade-to-raw (D3).
- **Test-asset wiring**: RESOLVED — sibling `assets/hooks/commit-msg.test.sh` +
  vitest `execFileSync` wrapper (D7).
- **Design-unspecified constants for judgment-day**: (a) `v2hash` + `firstCommit`
  hex are apply-time values; (b) RESOLVED (D9) — the `.test.sh` corpus is EXCLUDED from
  the consumer tarball via `*.test.sh` in `.npmignore` + `package:check`
  FORBIDDEN_PATTERNS; (c) exact rename/wording of the two edited `ci.test.ts` test names.

## Judgment-day fix round (both judges converged REJECT → fixed)

- **JD-BLOCKER-1**: test-breakage inventory completed — added the two executed-hook
  integration files (`ci-hooks-exec.integration.test.ts:180-204` Slice B,
  `ci-init.integration.test.ts:72,74,81` split A/B) with exact per-assertion rewrites
  (see Slice A/B and the complete inventory above).
- **JD-BLOCKER-2**: npx fallback — ORCHESTRATOR DECISION to PRESERVE
  `command -v javi-forge || npx javi-forge`, adapted to the native invocation; documented
  in Slice B. Consequence: `ci-init.integration.test.ts:74` stays green by decision.
- **JDA-004 (WARNING)**: NFKC downgraded from unconditional MUST to BEST-EFFORT in D3 +
  spec reconciliation.
- **JDA-005 / JDA-006 (WARNING)**: D8 (`test:hooks` path update on MOVE) + D9 (exclude
  `*.test.sh` from tarball).
- **JDB-003 (WARNING)**: autosquash exemptions `^(amend|reword)! ` added to the exemption
  set in design + spec.

### Round 2 (scoped re-judge — completeness sweep + mechanical)

- **JDA2-001 (BLOCKER)**: added `src/e2e/ci-hooks.e2e.test.ts` to the Slice B inventory —
  a hook-CONTRACT e2e suite the inventory missed. NOT a red (skipIf-gated on Docker,
  invokes `runCLI` directly not the hook body) → coverage-rot + a false docstring. Slice B
  now directs: fix the module docstring (`:5-6`, drops the `pre-push: javi-forge ci (full,
  Docker)` claim) and retire-or-reconcile the `pre-push (full, docker)` describe block
  (`:202-254`), whose native arg vector is now identical to pre-commit's.
- **JDA2-002 (WARNING)**: corrected the argsLog example in the ci-hooks-exec rewrite from
  a 5-element token array to the single-element `[FROZEN_PRE_COMMIT_FLAGS]` form — the stub
  logs `printf '%s\n' "$*"` (one line = whole arg string) and `readArgsLog` splits on `\n`,
  so a native pre-push captures ONE element identical to the frozen pre-commit vector.
- **JDA2-003 (WARNING)**: noted the stale `ci-init.integration.test.ts:68` test title
  (`"pre-push checks Docker before running"`) for rename-for-parity; cosmetic, assertions
  pass.
- **META**: replaced the twice-falsified absolute "inventory is complete" claim with a
  grep-anchored, round-stamped list plus a mandatory apply-time re-grep gate.
