# Review Ledger — Judgment Day (design) · skillguard-runtime-gate

- **Phase reviewed**: sdd-design (design.md) against proposal + spec + real code
- **Round**: 1
- **Judges**: jd-judge-a, jd-judge-b (blind, parallel, identical criteria)
- **Target**: `openspec/changes/skillguard-runtime-gate/design.md`
- **Store**: hybrid (openspec + engram topic `sdd/skillguard-runtime-gate/review-ledger`)

## Findings

| id | lens | location | severity | status | assessment | evidence |
|----|------|----------|----------|--------|------------|----------|
| JD-001 | judgment-day | `src/lib/agent-skills.ts:140-148` (via `src/commands/plugin.ts:288`) | CRITICAL | fixed | — | Fail-open install entrypoint absent from design: `importAgentSkillsPackage` copies sourceDir into PLUGINS_DIR with NO scan (fs.copy agent-skills.ts:148, .installed.json :164); reachable via `javi-forge plugin import` (commands/plugin.ts:288, VALID_PLUGIN_ACTIONS simple-renderers.tsx:62-72). Alternate call path defeats the whole gate — a block-scanning skill refused by `plugin add` installs unconditionally via `plugin import`. Both judges independently confirmed. FIXED in design.md (D8 gate placement, D2/D5 scope, Data Flow, File Changes, Interfaces, Testing 13/14). |
| JD-002 | judgment-day | `src/lib/skill-scanner.ts:531-534` × design.md:12 | WARNING | fixed | real | Plugin gate reuses `scanSkillsDirectory(tmpDir)` which treats `PLUGIN.md` as a skill. Conventional Claude-plugin READMEs document `~/.aws`/`~/.ssh`, curl examples, "bypass" wording → false-positive `block` on docs → permanent hard lockout (--force bypasses only `unscannable`, never `block`) with no escape hatch (staging removed before user can edit). Both judges independently flagged. FIXED in design.md (D1: declared-skills scan for plugin add + import gate; risk note; Testing 14). |
| JD-003 | judgment-day | `src/lib/skill-scanner.ts:511-540` × design.md:69 | WARNING | fixed | real | Walk uses `fs.stat` (follows symlinks) with no lstat/visited-set/cycle detection; the staged clone is now an attacker-controlled production surface. A directory symlink to an ancestor (git preserves symlinks) → unbounded async recursion → gate hangs, `finally` cleanup never runs; symlinked SKILL.md also reads outside the staged clone. Both judges independently flagged. FIXED in design.md (D9 symlink-safe walk + D10 revised skill-scanner.ts claim, File Changes, Testing 15). |
| JD-004 | judgment-day | `src/ui/AutoSkills.tsx:31-36`; `src/cli/dispatch/skills-cmd.tsx:63` | WARNING | info | real | Auto-install gate CLI-unreachable (sameDir wiring) — NOT a spec violation (lib-level scenarios 7-9 hold; documented in design.md:27). Judge B marked refuted/SUGGESTION. Merged as documented reachability gap, not a fix. |
| JD-005 | judgment-day | `design.md:12` × `src/lib/skill-scanner.ts:520` | SUGGESTION | info | theoretical | Full-tree walk on every `plugin add`; file count unbounded (only node_modules/.git skipped) → latency risk for vendored plugins; cost, not correctness (byte-identical behavior preserved). |
| JD-006 | judgment-day (re-judge Round 2) | `D1` + `D8` × `src/lib/agent-skills.ts:148`; `src/lib/plugin.ts:192` | CRITICAL | fixed | real | Scan-scope / install-scope mismatch in both gated install paths: gates scan only manifest-declared skills while `fs.copy(sourceDir, destDir)` (agent-skills.ts:148) / `fs.move(tmpDir, destDir)` (plugin.ts:192) install the ENTIRE tree — an attacker declares a clean skill and hides a malicious payload (undeclared SKILL.md, executable, hook, asset) elsewhere in the tree, installed un-scanned (reopens JD-001 class). FIXED in design.md via declare-and-enforce (declared-set == copied-set): new SKILL.md-only coverage walk `scanSkillsWithCoverage` (D1 chosen row, D8 gate steps, Data Flow, Interfaces, File Changes, Testing 16); import validation extended with non-empty `agentManifest.skills` + `entry.path` realpath containment (D8); PLUGIN.md/README still never scanned (JD-002 intact); new refusals are block-level — `force` never lifts them; rejected alternatives (option 1 restrict-install-scope, option 3 scan-only) documented in D1. |

## Adversarial verification

Judgment Day two-judge convergence satisfies adversarial verification — no review-refuter fan-out (per skill).

- JD-001: CONFIRMED (both judges, same defect, independent sweep) → enters fix → re-review loop.
- JD-002/003: WARNING (info) — reported once; both amended into design.md in round 1 fix pass (user discretion per verdict), status → fixed.
- JD-004: SUGGESTION/refuted — reported once as info.
- JD-005: SUGGESTION (info) — reported once.

## Verdict

JUDGMENT: APPROVED with 1 confirmed CRITICAL (JD-001) — fix required before sdd-tasks. Warnings JD-002/JD-003 are candidate design amendments at user discretion (not protocol fixes).

## Re-judge (Round 2)

- JD-006: CONFIRMED CRITICAL (scan-scope / install-scope mismatch in both gated install paths) → design amended (declare-and-enforce coverage walk, D1/D8/Data Flow/Interfaces/File Changes/Testing 16) → status: **fixed**. No new problem surfaced by the fix; no spec change required (scenarios 1-12 remain satisfiable — compliant packages still install byte-identically).

## Re-judge (Round 3 — final scoped re-review after fix Round 2)

| id | lens | location | severity | status | assessment | evidence |
|----|------|----------|----------|--------|------------|----------|
| JD-007 | judgment-day | design.md D1/D9/D11 `scanSkillsWithCoverage` × `src/lib/plugin.ts:192`; `src/lib/agent-skills.ts:148` | CRITICAL | fixed | real | Coverage walk skips `node_modules`/`.git` (inherited from skill-scanner.ts:520, cost rationale) but install is whole-tree (`fs.move` plugin.ts:192 / `fs.copy` agent-skills.ts:148; fs-extra preserves symlinks). (a) A committed `node_modules/<pkg>/SKILL.md` lands in PLUGINS_DIR un-scanned and un-declared — JD-006 class reopens; (b) symlinked `SKILL.md`/dirs are lstat-skipped (never collected undeclared, never scanned) yet install as live symlinks, dereferencing post-install to attacker-chosen content. The design's own unconditional claims (D1 "every skill-shaped file", D8 "any SKILL.md outside declared set → refuse") contradict the D9 exemption. Both judges independently confirmed. FIXED in design.md (Round 3, user-authorized override): new D11 — coverage walk has NO subtree exemptions (`node_modules`/`.git` visited; visit set == install footprint) and ANY symlink (file or dir) → manifest-integrity refusal, block-level, force never lifts; D1/D8 claims now literally true for the installed tree; D9 revised skip→refuse (lstat/visited-set/realpath containment retained as defense-in-depth, JD-003); `scanSkillsWithCoverage` gains `symlinks[]` output; Data Flow, Interfaces (refusal classes), File Changes, Testing rows 15-17, Migration and Non-goals residual all amended. No spec change required (scenarios 1-12 hold; clean installs remain byte-identical); `force?: boolean` semantics unchanged. Residual (non-SKILL.md assets) stays documented P-1; NOT the same as JD-007 (skill-shaped files are within the scanner content model). |
| JD-001 | — | — | CRITICAL | verified | — | D8 gate placement finally verified correct (both judges round 3): gate before fs.remove/fs.copy, validation extension concrete against real types, dryRun honored, force threading additive, existing install preserved. |
| JD-002 | — | — | WARNING | verified | real | PLUGIN.md/README never scanned by final design (declared scanSkillFile + SKILL.md-only coverage); false-block lockout eliminated; Testing 14/16(e) bind. |
| JD-003 | — | — | WARNING | verified | real | lstat + visited-set + realpath containment terminate cycles and prevent out-of-clone reads; symlink-skip meets JD-003's scan-time asks (its install-side cost = JD-007). |
| JD-006 | — | — | CRITICAL | NOT fully verified | real | Normal-tree undeclared SKILL.md now refused (block-level, force never lifts); but node_modules/.git + symlink exemptions keep the smuggling vector open → folded into JD-007. |

## Terminal state

**JUDGMENT: APPROVED** — Round 3 fix (user-authorized override of the 2-round convergence budget) applied to design.md: JD-007 closed via D11 (no walk exemptions + symlink refusal) with coherent amendments across D1, D8, D9, D10, Data Flow, Interfaces, File Changes, Testing rows 15-17, Migration and Non-goals. All confirmed CRITICAL findings (JD-001, JD-006, JD-007) are **fixed**; warnings JD-002/JD-003 verified in the final design. No new problem surfaced and no spec change required (scenarios 1-12 remain satisfiable; compliant packages still install byte-identically). Ready for sdd-tasks.

## Final verification (post-R3, both judges, parallel)

**VERDICT: CLEAN — all ledger findings (JD-001, JD-002, JD-003, JD-006, JD-007) verified fixed. Nothing new.** No CRITICAL/BLOCKER survived. D11 verified: visit set == install footprint (walk visits node_modules/.git; git cannot track into `.git` and fresh shallow clones carry 0 symlinks / 0 SKILL.md basenames — empirically checked by Judge B via `git clone --depth 1`); any symlink → manifest-integrity refusal before any content read (Data Flow orders walk before declared scan); PLUGIN.md never content-scanned (JD-002); lstat/visited-set/realpath retained as defense-in-depth (JD-003); clean installs byte-identical (Testing 17).

Info notes carried into sdd-tasks as implementation-time cautions (never block, no round):
- **JD-008** (SUGGESTION, info): D11 premise "a legit package ships no symlinks" is factually weak — symlinks are routine in real repos (npm `node_modules/.bin/*`, agent skill dirs). A legit symlinked package would be force-proof refused with no escape hatch. No current user impact (registry empty); the strictness is deliberate — wording should name the tradeoff in Migration.
- **JD-009** (SUGGESTION, info): `auto-skill-install` copies whole skill **folders** (`fs.copy(sourcePath, targetPath)`, auto-skill-install.ts:99) while D4's gate scans only folder-root SKILL.md — a nested `SKILL.md` inside the skill folder lands un-scanned. Weak attacker model (source is user's own local skills dir; destination ≠ PLUGINS_DIR); wording must not mislead implementation.
- **JD-010** (SUGGESTION, info): Testing 17 parenthetical "(current installed base) WITHOUT node_modules/.git content" is factually wrong — every plugin-add install carries the clone's root `.git` via `fs.move`. The requirement itself is correct; the parenthetical could mislead the implementer into skipping the `.git` walk.