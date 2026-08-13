# Archive Report — skillguard-runtime-gate

**Change**: `skillguard-runtime-gate` · **Repo**: `/home/javier/programacion/platform/javi-forge`
**Verdict**: **ARCHIVED** · **Cycle status**: CLOSED
**Archive destination**: `openspec/changes/archive/2026-08-13-skillguard-runtime-gate/`
**Artifact store**: hybrid (filesystem + Engram, project `javi-forge`) · **Final tree**: `main` @ `3eb82dae` (release `v1.28.0`)
**Verification**: PASS (archive-ready) — 0 CRITICAL, 3 WARNING (advisory/doc-only), 3 SUGGESTION (documented info).

## 1. Delivery

Single PR, squash-merged to `main` and released:

| Item | Value |
|---|---|
| PR | **#45** — `feat(lib): skillguard runtime gates — fail-closed install for plugin add/import + skills auto-install` |
| Merge | squash commit `e457b1be` onto `main` (base `24661957`) |
| Release | **v1.28.0** (`3eb82dae`, semantic-release) |
| Branch | `feat/skillguard-runtime-gate` deleted after merge |
| CI | remote pipeline green on the merged tree |

**Tasks**: 20/20 boxes `[x]` in `tasks.md` (phases 1.1–6.1, commits 3248a167–97abbfcc). Task Completion Gate PASSED — zero unchecked implementation tasks. Main apply followed by user-authorized fix rounds **F1–F4** (JD-011/012/013/014/103; R1-F2-N1/N2; R3-F3-N1), all verified fixed.

## 2. Verification evidence

| Check | Result |
|---|---|
| `pnpm test` (verify run, branch) | 96 files / **1772 pass / 2 pre-existing skips** — exit 0 |
| `pnpm test` (post-merge, `main` @ `3eb82dae`, archive re-run) | 96 files / **1786 pass / 2 skipped** (suite grew via PR #46 on main) |
| `pnpm typecheck` / `typecheck:test` / `lint` | exit 0 (1 pre-existing warning `ci-hooks.test.ts:1171`, unrelated) |
| Coverage | **Lines 90.92% / Branches 82.16%** — floors 85/80, both above; every changed file ≥ 84% |
| Targeted gate files (6) | 235/235 pass |
| Live malicious-fixture spot-check | 25/25 assertions (block refuses even with `--force`; force lifts only `unscannable`; symlink/undeclared/lowercase/containment/error refusals block-level and force-proof) |
| Spec compliance | **12/12 scenarios COMPLIANT**, each bound by a passing test |
| Design coherence | D1–D11 all followed; no rejected alternative implemented |

ELIFECYCLE noise in test output is the pre-existing `ci.test.ts` temp-scaffold artifact (eslint missing in scaffold; documented on main) — not a regression.

## 3. Review trail

| Gate | Outcome |
|---|---|
| judgment-day — design | 3 rounds → **APPROVED** (JD-001..JD-010) |
| judgment-day — implementation | **APPROVED** after fix rounds F1–F4 (JD-011..JD-103, JD-F1-N1, R1-F2-N1/N2, R3-F3-N1 — all fixed or documented info) |
| 4R pre-PR review | **CLEAN** (R1/R3/R4) |
| sdd-verify | **PASS** — 12/12 scenarios, 20/20 tasks, coverage above floors, fail-closed semantics live-verified |
| CI remote | success on merged tree |

Review ledger: `review-ledger.md` in this folder (JD-001..010, JD-011..103, JD-F1-N1, R1/R3/R4 4R, R1-F2-N1/N2, R3-F3-N1).

## 4. Specs promoted into the source of truth

The change carried one delta spec, merged into `openspec/specs/` before the folder move.

| Domain | Action | Details |
|---|---|---|
| `skill-install-gate` | **Created** `openspec/specs/skill-install-gate/spec.md` | NEW capability — full spec promoted whole under a provenance header: 5 requirements (plugin add gates placement on scan · skills auto-install gates pre-copy · refusal output reuses scanner reports · gate tests use real fixtures, no safe-read mock · + scope notes/non-goals) and 12 scenarios. No prior main spec existed; nothing preserved/removed. |

## 5. Known residual (documented, non-blocking)

- **Case-variant twin dirs (JD-F1-N1 / V-005, info)** — a declared dir shipping both `SKILL.md` (clean) and lowercase `skill.md` (malicious) installs the lowercase variant un-scanned. Deliberate trade of the JD-011 fix; **inert** (no runtime consumer loads lowercase from `PLUGINS_DIR`); `node_modules`/undeclared-dir smuggling still fully refused. P-1 residual class.
- **V-004 / JD-009 (info)** — auto-install gate scans only folder-root `SKILL.md` while the copy is whole-folder; a nested `SKILL.md` lands un-scanned. Documented scope (source is the user's own skills dir).
- **V-002** — pre-existing per-file coverage dip in `src/commands/plugin.ts` (84.44/78.57, uncovered lines are untouched `runPluginRemove`/`runPluginList`); aggregate above floors. Not caused by this change.
- **V-006** — `src/ui/**` excluded from coverage config (pre-existing); gate UX covered via lib-level tests.

## 6. Traceability

**Engram observations** (project `javi-forge`):

| ID | Artifact |
|---|---|
| 14780 | `sdd/skillguard-runtime-gate/explore` |
| 14781 | `sdd/skillguard-runtime-gate/proposal` |
| 14782 | `sdd/skillguard-runtime-gate/spec` (delta spec mirror) |
| 14784 | `sdd/skillguard-runtime-gate/design` (D1–D11) |
| 14795 | `sdd/skillguard-runtime-gate/tasks` |
| 14808 | apply progress (S1–S6 + fix round F1) |
| 14786 | JD F4 CLEAN — lockout family cerrada |
| 14823 | `sdd/skillguard-runtime-gate/verify-report` |
| 14824 | sdd-verify execution record (PASS, next=archive) |
| — | `sdd/skillguard-runtime-gate/archive-report` (this report) |

**Filesystem (archived audit trail — never modify)**:
`openspec/changes/archive/2026-08-13-skillguard-runtime-gate/` — `exploration.md`, `proposal.md`,
`specs/skill-install-gate/spec.md`, `design.md`, `tasks.md` (20/20), `apply-progress.md`,
`verify-report.md`, `review-ledger.md`, `archive-report.md`.

## 7. SDD cycle complete

`skillguard-runtime-gate` has been planned, implemented (PR #45, released v1.28.0), adversarially reviewed (judgment-day design + implementation APPROVED; 4R CLEAN), verified (PASS, 12/12 scenarios), its delta spec promoted into the source of truth (`openspec/specs/skill-install-gate/spec.md`), and archived. The change is CLOSED. The only carried-forward items are the documented info-level residuals in §5.
