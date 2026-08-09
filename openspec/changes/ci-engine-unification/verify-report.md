# Verification Report — ci-engine-unification

**Change**: ci-engine-unification · **Tree verified**: `main` @ `d58cdbb` (clean working tree, all 4 PRs merged)
**Artifact store**: hybrid (engram mirror: `sdd/ci-engine-unification/verify-report`, id 12890) · **Mode**: full spec verification (proposal + 2 delta specs + design + tasks + review-ledger + apply-progress)
**Verdict**: **PASS WITH WARNINGS** — 0 CRITICAL, 3 WARNING (all resolved during archive housekeeping), 2 SUGGESTION. Archive-ready.

## 1. Completeness

| Dimension | Result |
|---|---|
| Tasks marked complete | 48/48 `[x]`, 0 unchecked |
| Tasks match code state | YES — spot-checked 2.9 (runLegacySteps deleted), 3.20/3.21 (assets read + packed), 1.10 (hooks executed) |
| Merge state | 4 merge commits: `c9b5e66` (s1), `c4ea116` (s2), `0eb9ce6` (s3a), `d58cdbb` (s3b); releases `v1.7.1` `da58083`, `v1.8.0` `279e5f8` |

## 2. Runtime evidence (measured on `main` @ `d58cdbb`, real exit codes)

| Command | Exit | Evidence |
|---|---|---|
| `npx vitest run` | 0 | 79 files, 1370 passed, 4 skipped |
| `npx tsc --noEmit` | 0 | typecheck |
| `npx tsc -p tsconfig.test.json --noEmit` | 0 | typecheck:test |
| `npx biome check src/` | 0 | 183 files, no fixes |
| `npx vitest run src/__integration__/ci-auto-docker.integration.test.ts` | 0 | 2/2 PASSED — the Docker-gated R1 net actually EXECUTED, not skipped |
| `pnpm package:check` (orchestrator, closing WARN-2) | 0 | 361 files, all four `assets/hooks/*` present by name |

The 4 skipped tests are the pre-existing `BASH_IMAGE_OK`-gated rows (`ci-mixed.integration`, `ci-hooks.e2e`) — unrelated to this change.

## 3. Spec compliance matrix

### ci-execution
| Requirement | Status | Evidence on main |
|---|---|---|
| Single execution path | COMPLIANT | `rg runLegacySteps src/` → zero hits; `runStep` (ci.ts:913) called ONLY from `runRunner` (:829 tool-check, :889 phases). `runSemgrep`/`runGhagga` keep their pre-existing top-level spawns (never in scope — see SUG-2) |
| Naming keyed on resolution source | COMPLIANT | ci.test.ts:1558 single-runner-config-stays-suffixed (R3 guard) + :1297 `--stack` ids frozen (B1) — PASSED |
| Preserved step order | COMPLIANT | ci.test.ts:1152 global order, :1166 image BEFORE `.context/`, :1176 exactly-once image step, :1597 per-runner security LAST, :1631 skip conditions, :1000 tool-check precedes setup |
| Preserved flag/mode/exit contract | COMPLIANT | ci.test.ts:1192 (`--no-docker`), :484/:244 detect, :524 `--no-security`; `src/lib/ci-config.ts` NOT in the change diff — `TOP_LEVEL_FIELDS = {version, runners}` untouched |
| Auto inherits configured phases as no-ops | COMPLIANT | ci.test.ts:1313 + :1331 (full mode, security ENABLED — the non-vacuous JDA2-002 variant) |
| Characterization before collapse | COMPLIANT | s1 `c9b5e66` tests-only; s2 edits by ADDITION (+319/−5, deletions = pre-authorized mock setup JDB2-008) |
| Coverage must not regress | COMPLIANT (by record) | Same-run deltas recorded per slice, all PASSED as percentages: s1 87.65→88.34 / 77.97→78.88 · s2 88.59→88.75 / 79.01→79.18 · s3a 88.751→88.754 / 79.187= · s3b 88.75→89.14 / 79.18→79.66. `vitest.config.ts` thresholds `{85, 80}` never lowered |

### ci-hook-install
| Requirement | Status | Evidence on main |
|---|---|---|
| Versioned marker + content hash | COMPLIANT | ci-hooks.test.ts:201 — marker after shebang, body hashed below it |
| Classify before write (full `states[]` vocabulary) | COMPLIANT | rows: managed-current no-op (:218), mode repair without writing (:250), managed-outdated upgrade (:282), managed-edited refusal (:298), symlink refusal (:418), exec bit on every write path (:271, :603) |
| Legacy unmarked fleet upgradable (R2) | COMPLIANT | :234 unmarked bytes == current asset ⇒ `legacy-v0` upgraded; :153 real asset + ONE space ⇒ `foreign` (byte-exact matcher vs the released artifact) |
| Drifted marker = edited; foreign marker ≠ consent | COMPLIANT | :391 pre-push marker in pre-commit slot ⇒ foreign; :404 CRLF ⇒ foreign |
| No-clobber + honest refusal | COMPLIANT | :315 path/reason/remedy, :330 timestamped target, :344 hostile `.bak` ⇒ "force will REFUSE", :363 directory case (lstat, not pathExists) |
| Forced overwrite backs up first | COMPLIANT | :465/:487 backup precedes overwrite, :499 never clobbers a prior backup, :517/:534 hostile `.bak` refused even forced, :546 backup-throws ⇒ hook byte-unchanged, :589 `COPYFILE_EXCL` asserted, :619/:639/:657 no backup for states written anyway |
| Broken install ⇒ named error | COMPLIANT | :697 unreadable manifest, :715 missing entry, :730 malformed entry — named `errors[]`, siblings unaffected |
| Templates shipped as package assets | COMPLIANT | `assets/` in `files`; all four in `REQUIRED_FILES` by name; manifest sha256 == asset bytes == historical v0 (`firstCommit 5587b3b`) |
| Hooks verified by execution | COMPLIANT | `ci-hooks-exec.integration.test.ts` executes via shebang; frozen flag set verbatim in `assets/hooks/pre-commit:7,9` |

## 4. Proposal success criteria — all 8 PASS

Observable behavior identical · pre-existing tests unchanged (2 sanctioned deviations, both ledger-documented) · slice-2 production diff net −17 (`+147/−164`) · coverage delta gates recorded passed 4/4 · `runLegacySteps` gone / `runStep` only leaf · `ci init` upgrades legacy, refuses foreign/edited · hooks executed not grepped · hook CONTENT unchanged · schema v1 untouched · `detectCIStack` contract intact (tdd.ts:122, tdd-pipeline.ts:135, security.ts:470 still consume it; both typechecks green).

## 5. Deferred / parked honesty

`docs/BACKLOG.md`: B1, B2, B3, ENV-1, HOOKS-1, JF-DOCS-1, COV-1, COV-2, SEC-1 (+ JDA7-012 follow-up). Ledger census: **48 fixed · 32 info · 2 superseded · 0 open**.

## 6. gates-v2 readiness (the SDD's stated purpose)

| Seam | Present on main |
|---|---|
| Single executor phase list | `ci.ts:854`, iterated at :879 |
| `runStep` single leaf | `ci.ts:913`, two call sites, both in `runRunner` |
| `CIStepStatus` | exported `ci.ts:46` |
| Config whitelist locked | `ci-config.ts` untouched, version pin = 1 |
| `--json` precedent | `help.ts:133` global flag, deliberately NOT wired into `ci` (gates-v2 surface excluded by design) |

## 7. Issues

CRITICAL: none.
- **WARN-1** (resolved at archive): proposal Success Criteria checkboxes were unticked → ticked, all 8 substantively met.
- **WARN-2** (resolved): `package:check` re-run first-hand by the orchestrator on `main` @ `d58cdbb` → exit 0, 361 files.
- **WARN-3** (resolved): this file — the openspec half of the hybrid verify-report, written by the orchestrator from engram id 12890 (the verify agent has no Write tool).
- **SUG-1**: apply-progress records "362 files" — stale by one (the parked `python.Dockerfile`, JDA7-011). Not a defect.
- **SUG-2**: `runSemgrep`/`runGhagga` keep their own spawns (top-level steps, pre-existing, out of scope). Name explicitly when gates-v2 unifies skip semantics.

## Discrepancies against the ledger

None. Every load-bearing ledger claim spot-checked holds on the merged tree.
