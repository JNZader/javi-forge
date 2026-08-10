# Tasks: hooks-ricos — richer hook bodies, fail-closed, no degrade

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | Slice A ~205 logic + ~290 test corpus (moved `.sh`); Slice B ~55 |
| 400-line budget risk | Medium (per slice) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Slice A commit-msg) → PR 2 (Slice B pre-push) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Slice A commit-msg: rich body + conv-commit regex + moved test asset + manifest v2 | PR 1 | base=main. Raw count inflated by moved `.sh` corpus (~290, data) → flag `size:exception` on the corpus commit |
| 2 | Slice B pre-push: native gate + manifest v2 | PR 2 | base=main, sequential after PR 1. Independent (no shared code) |

Sequential PRs to main, matching this session's pattern. Slices share no code. NO `ci.ts` install-logic change expected in EITHER slice (verified by both judges); if apply finds one is needed, STOP — that is a design escalation.

---

## Slice A — commit-msg (PR 1)

### Phase A1: RED (failing tests first)

- [x] A1.1 In `assets/hooks/commit-msg.test.sh` (after the MOVE in A2.1) add `expect_block` cases for non-conforming subjects (`wip`, `random text`) and `expect_pass` cases for each conforming type + each exemption (`Merge `, `fixup! `, `squash! `, `amend! `, `reword! `, `Revert `). Run `bash assets/hooks/commit-msg.test.sh` → RED.
- [x] A1.2 Add vitest wrapper `src/__tests__/commit-msg-hook.test.ts` that `execFileSync("bash", [path.join(HOOK_ASSETS_DIR, "commit-msg.test.sh")])` and asserts exit 0. Confirm it FAILS before the body swap.

### Phase A2: GREEN — asset + body

- [x] A2.1 MOVE `ci-local/hooks/commit-msg.test.sh` → `assets/hooks/commit-msg.test.sh` (single source of truth; `.sh` hardcodes `HOOK="$SCRIPT_DIR/commit-msg"` so it tests the real sibling body).
- [x] A2.2 Replace `assets/hooks/commit-msg` body with the rich variant: best-effort NFKC via `perl -CSAD` + `Unicode::Normalize::NFKC` (degrade-to-raw when perl absent), ~30 attribution pattern families, RAW+normalized double-match loop. Must start `#!/bin/bash\n`, end one trailing `\n`. Enforcement is PURE SHELL — no `ci.ts` change.
- [x] A2.3 Append (before `exit 0`, `set -e`-safe) the conv-commit block: derive SUBJECT = first line non-blank AND not `^#`. EXEMPT (skip): `^Merge `, `^(fixup|squash)! `, `^(amend|reword)! `, `^Revert `. Else REQUIRE `^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9._-]+\))?!?: .+`. Run attribution guard FIRST, then subject check; distinct non-zero exits with named messages (`COMMIT BLOCKED: subject must be Conventional Commit`).
- [x] A2.4 Run `bash assets/hooks/commit-msg.test.sh` and the vitest wrapper → GREEN.

### Phase A3: manifest + guard tests

- [x] A3.1 `assets/hooks/manifest.json`: set `commit-msg.version` 1→2; `commit-msg.sha256` → v2hash (`sha256` of new raw asset bytes, computed at apply); APPEND `{sha256: v2hash, firstCommit: <hex>}` to `commit-msg.historical[]` keeping v1 `1c23a60c…` at index 0. Do NOT re-append v1.
- [x] A3.2 `src/__tests__/hook-assets.test.ts`: append v2hash to `RELEASED_SNAPSHOT["commit-msg"].historical` → `[v1hash, v2hash]`, set its `sha256` → v2hash (append-only guard).
- [x] A3.3 `hook-assets.test.ts:141-149`: refactor blanket `version===1` + `sha256===historical[0]` → per-hook EXPECTED_VERSION map (commit-msg→2, pre-push→1, pre-commit→1) + assert `sha256===historical.at(-1).sha256`.

### Phase A4: coupled-test fixes

- [x] A4.1 `ci.test.ts:382`: `toContain("anthropic.com")` → `toContain("anthropic")` (grouped `\.(com|sh|ai)`). Lines 378-381 stay.
- [x] A4.2 `ci-init.integration.test.ts:81`: `toContain("co-authored-by:.*claude")` → two assertions `toContain("co-authored-by")` + `toContain("claude")` (PROVIDER_PAT is a shell var). `:82-83` stay.
- [x] A4.3 `package.json:19`: `test:hooks` path `ci-local/hooks/commit-msg.test.sh` → `assets/hooks/commit-msg.test.sh` (lockstep with A2.1 MOVE).
- [x] A4.4 Exclude the corpus from the tarball: add `*.test.sh` to `.npmignore` AND to `FORBIDDEN_PATTERNS` in `scripts/verify-package-contents.mjs`.

### Phase A5: verification (GATE FIRST)

- [x] A5.1 **MANDATORY APPLY-TIME GATE** — re-grep the FULL test tree (`src/**/*.test.ts`, `src/__integration__/**`, `src/e2e/**`) for: hook-body substrings, version literals, `sha256` literals, `docker info`, `npx`, `co-authored-by`, `anthropic`, and the pre-push arg vector. Reconcile ANY hit not already in this checklist before proceeding. Hard gate.
- [x] A5.2 `pnpm validate` exit 0.
- [x] A5.3 `npx vitest run --coverage` exit 0 (floors 85 lines / 80 branches).

---

## Slice B — pre-push (PR 2)

### Phase B1: RED

- [ ] B1.1 Update `ci-hooks-exec.integration.test.ts:180-204` expectations to the NEW native contract FIRST (see B3.3) so the suite is RED against the current docker-probe body.

### Phase B2: GREEN — body

- [ ] B2.1 Replace `assets/hooks/pre-push` body with unconditional `javi-forge ci --quick --no-docker --no-security --no-ci-ghagga`; PRESERVE the `command -v javi-forge &>/dev/null … || npx javi-forge …` fallback adapted to the native invocation. STRIP the `if docker info` branch and the degrade `else` — NO degrade branch. Add `$SECONDS` elapsed logging + clear abort message; keep `git push --no-verify` in header comment.

### Phase B3: manifest + coupled-test fixes

- [ ] B3.1 `assets/hooks/manifest.json`: `pre-push.version` 1→2; `sha256` → v2hash; APPEND `{sha256: v2hash, firstCommit: <hex>}` to `pre-push.historical[]` keeping v1 `7de58640…` at index 0. Update `RELEASED_SNAPSHOT["pre-push"]` → `{sha256: v2hash, historical: [v1hash, v2hash]}` and set pre-push→2 in the EXPECTED_VERSION map from A3.3.
- [ ] B3.2 `ci.test.ts:367`: `toContain("docker info")` → `toContain("--no-docker")`; `:368` `toContain("javi-forge ci")` stays. Rename the test (native-quick, no docker branch).
- [ ] B3.3 `ci-hooks-exec.integration.test.ts`: `:180-186` rewrite argsLog `["info","ci"]` → single-element `[FROZEN_PRE_COMMIT_FLAGS]` = `["ci --quick --no-docker --no-security --no-ci-ghagga"]` (stub logs `$*` as ONE line; NOT a token array), rename case; `:188-195` update abort text + same single-element argsLog; `:197-204` DELETE the "Docker unavailable → refuse" case (fail-closed re-homed to gate layer).
- [ ] B3.4 `ci-init.integration.test.ts:72`: `toContain("docker info")` → `toContain("--no-docker")`. `:73` `javi-forge ci` stays; `:74` `npx javi-forge ci` PRESERVED-BY-DECISION (no edit). `:68` rename stale title (cosmetic).
- [ ] B3.5 `src/e2e/ci-hooks.e2e.test.ts`: fix module docstring `:5-6` (`pre-push: javi-forge ci (full, Docker)` → native `--quick --no-docker --no-security --no-ci-ghagga`); RETIRE the `describe("hook contract — pre-push (full, docker)")` block `:202-254` (now redundant with pre-commit's identical native arg vector) — reconcile only if retire is rejected.

### Phase B4: verification (GATE FIRST)

- [ ] B4.1 **MANDATORY APPLY-TIME GATE** — re-grep the FULL test tree (`src/**/*.test.ts`, `src/__integration__/**`, `src/e2e/**`) for hook-body substrings, version/`sha256` literals, `docker info`, `npx`, `co-authored-by`, `anthropic`, and the pre-push arg vector `--quick --no-docker --no-security --no-ci-ghagga`. Reconcile ANY hit not in this checklist. Hard gate.
- [ ] B4.2 `pnpm validate` exit 0.
- [ ] B4.3 `npx vitest run --coverage` exit 0 (floors 85 lines / 80 branches).
