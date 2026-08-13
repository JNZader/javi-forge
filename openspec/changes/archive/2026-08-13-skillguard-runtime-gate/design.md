# Design: skillguard-runtime-gate

## Technical Approach

Fail-closed install gate that makes the latent scanner (skill-scanner.ts) its first production consumer. Scan staged content BEFORE placement via the scanner API (`scanSkillFile`, `scanSkillsDirectory`, `scanSkillsWithCoverage` — new, JD-006/JD-007, `isRejectedVerdict`, `formatScanReport`/`formatBatchReport`); deny on `block`/`unscannable`; `--force` (additive `force?: boolean`) bypasses ONLY `unscannable`; scanner throws deny unconditionally. Verdict evaluation lives in one pure helper shared by all three entrypoints; scanning + try/catch stay at the call sites. Gated entrypoints: `plugin add` (`runPluginAdd` → `installPlugin`), `plugin import` (`runPluginImport` → `importAgentSkillsPackage`, agent-skills.ts:105-158 — promoted to gated, JD-001: previously `fs.copy`'d the source dir with no scan), and `skills auto-install` (`autoInstallSkills`). Both package gates (plugin add, plugin import) additionally enforce declared-set == installed-set (JD-006 + JD-007): a SKILL.md-only tree walk (never `PLUGIN.md`/README content — JD-002) visits EXACTLY the footprint `fs.move`/`fs.copy` will install — no subtree exemptions, so `node_modules`/`.git` are walked too (JD-007) — flags ANY symlink (file or dir) in the tree as a block-level refusal (JD-007: fs-extra `move`/`copy` preserve symlinks, so a walk-skipped symlink would install LIVE), finds every skill-shaped file that would land under `PLUGINS_DIR`, and requires each to be declared in the package manifest; an undeclared `SKILL.md` — wherever it sits, including `node_modules/<pkg>/SKILL.md` — refuses with block-level force, so a hostile package cannot smuggle a hidden or symlinked skill outside its declared entries. Maps to spec requirements R1-R4 (`openspec/changes/skillguard-runtime-gate/specs/skill-install-gate/spec.md`).

## Architecture Decisions

### D1: Scan shape
| Option | Tradeoff | Decision |
|---|---|---|
| Whole-tree `scanSkillsDirectory(tmpDir)` for plugin add | One recursive call, skips `node_modules`/`.git` (skill-scanner.ts:510-544) | **Rejected (JD-002)** — the walk treats `PLUGIN.md` as a skill (skill-scanner.ts:531-534); plugin READMEs routinely match critical patterns (`~/.ssh`, curl examples, "bypass" wording) → false-positive `block`, and `--force` bypasses ONLY `unscannable`, never `block` → permanent hard lockout with no escape (staging removed before the user can edit) |
| Declared-skills scan + coverage enforcement for plugin add: `scanSkillFile` per `validation.manifest.skills` — `<tmpDir>/skills/<name>/SKILL.md` (types/index.ts:99; `skills/<name>` convention agent-skills.ts:26-30) — plus a SKILL.md-only tree walk (`scanSkillsWithCoverage`, D9/D11-hardened) asserting every skill-shaped file in the staged clone is declared | Bounded (cost is readdir/lstat over the tree beyond the declared entries; NO subtree exemptions — `node_modules`/`.git` are walked, JD-007: the walk's visit set must equal the `fs.move` install footprint), never scans `PLUGIN.md`/README content (JD-002); undeclared `SKILL.md` anywhere in the tree (incl. `node_modules`) → refuse by entitlement (block-level, force never lifts) — closes JD-006 smuggling; ANY symlink (file or dir) → refuse on filesystem-integrity grounds (JD-007: fs-extra preserves symlinks, a skipped symlink installs live; a legit package ships no symlinks); legit plugins declaring every skill they ship install byte-identically | **Chosen (JD-006 + JD-007)** — declared-set == installed-set enforced before `fs.move` (:192); batch report for the declared results still fits (`formatBatchReport` takes the results array) |
| Restrict install scope to declared entries (copy/move only declared skill dirs + plugin.json/`.installed.json`/skills.json) | Nothing undeclared ever lands — closes executable/hook/asset smuggling outright | **Rejected (JD-006)** — changes install semantics: legit plugins ship README/LICENSE/assets/hooks today (`fs.copy`/`fs.move` install the whole tree); dropping them breaks the "clean skill installs byte-identically" spec scenario → would require a spec change |
| Non-empty `skills` + full-tree SKILL.md scan only (undeclared SKILL.md scanned but still installable when clean) | Sees hidden skills; no manifest-completeness burden on plugin authors | **Rejected (JD-006)** — a hidden skill whose content passes verbatim scanning still installs; refuse-by-entitlement (declare-and-enforce) is strictly stronger and refuses even clean-scanning payloads |
| Per-file `scanSkillFile` loop for plugin (whole tree re-walk) | N calls, re-implements walk | Rejected |
| `scanSkillFile(sourceSkillMd)` per copyable candidate for auto-install | Discrete files, exact scope | **Chosen** — unchanged (JD-002: scans explicit candidate SKILL.md files, never `PLUGIN.md`) |

**JD-002 risk note (false-block no-escape)**: scanning the tree treats `PLUGIN.md`/READMEs as skills; a doc-only `block` is a permanent lockout because `--force` never lifts `block` and staging is removed before the user can edit the source. Mitigation retained through JD-006: the coverage walk is SKILL.md-only by basename filter — it collects `SKILL.md`/`skill.md` and never `PLUGIN.md` or READMEs (the `PLUGIN.md` branch at skill-scanner.ts:531-534 is not part of the driver) — the README can still never block, and no escape-hatch change to `--force` semantics is needed. The only new refusal classes (undeclared SKILL.md anywhere in the tree — incl. `node_modules`/`.git`, JD-007; ANY symlink in the tree — JD-007, a filesystem-integrity refusal independent of basename, so a symlinked PLUGIN.md refuses on integrity grounds without ever being content-scanned; empty/missing `skills` on import; declared path escaping the source dir) are manifest-integrity refusals, not scanner verdicts, and are block-level by design. The walk's SKILL.md-only basename filter governs COLLECTION for scanning (JD-002); the symlink check is basename-independent (JD-007).

### D2: Shared evaluation — new `src/lib/skill-install-gate.ts`
**Choice**: `evaluateInstallGate(results, { force }): { allowed: boolean; rejected: SkillScanResult[] }` — pure, imports only `isRejectedVerdict` (skill-scanner.ts:57-58), no fs.
**Rationale**: force semantics must be identical in all three entrypoints (plugin add, plugin import, skills auto-install); three inline copies would diverge. Scanning stays in call sites (a pure helper cannot own the try/catch). Rule: `allowed = !hasBlock && (rejected.length === 0 || force)` — block always refuses; force lifts only unscannable; empty/pass/warn → allowed. JD-006 refusals (undeclared `SKILL.md` in the tree, empty/missing `skills` on import, declared path escaping the source dir) are NOT verdicts — they are manifest-integrity checks enforced at the call site before `evaluateInstallGate` runs, so `force` can never lift them (mirrors the scanner-throw rule: force lifts only real `unscannable` verdicts). `evaluateInstallGate` therefore receives only the declared results.

### D3: Gate placement — plugin.add
**Choice**: inside `installPlugin` (plugin.ts:138), after `destDir` computation (:184-185), before the existing-install remove (:189-191) and `fs.move` (:192); guarded `if (!dryRun)` so dry-run (no staged clone, :157) no-ops.
**Detail**: refusal returns `{ success: false, error: report }` inside the try; the `finally` (:216-220) removes staging — nothing lands, and a prior install is not destroyed before the gate passes.
**Alternatives**: after move (rejected — G-1 race); before validation (rejected — structural errors surface first).

### D4: Gate placement — skills auto-install
**Choice**: restructure `autoInstallSkills` (auto-skill-install.ts:43) into three passes: classify (notFound/sameDir/skipped/copyable, predicates unchanged from :78-94), scan-gate copyable sources via `scanSkillFile`, then the existing copy (:96-103).
**Behavioral differences collapsed** (config rule): (1) copyable set computed up-front, not inline; (2) any block ⇒ `{ installed: [], skipped, notFound, detection, blocked }` — copy NOTHING; (3) scan throw ⇒ function rejects (thrown) — nothing copied, matches existing UI error path (AutoSkills.tsx:41-44); (4) dryRun still scans (read-only) but copies nothing (unchanged :97-103, installed names still reported); (5) sameDir short-circuits before scanning (:84-87), so the wired UI (AutoSkills.tsx:31-36, source==target) stays silent.

### D5: Force wiring
**Choice**: additive `force?: boolean` on `InstallPluginOptions` (plugin.ts:140) and `AutoInstallOptions` (auto-skill-install.ts:20-29), default false. The CLI reuses the existing global `force` flag (help.ts:199): `handlePlugin` (simple-renderers.tsx:84) and `handleSkillsCmd` (skills-cmd.tsx:64) pass `cli.flags.force`; `Plugin.tsx:86` and `AutoSkills.tsx:31-36` thread it. `runPluginAdd` gains a trailing `options: { force?: boolean } = {}` (commands/plugin.ts:33) — existing 3-arg callers compile unchanged. Help text documents the bound (mirror help.ts:88-91).

### D6: Refusal output & exit code
| Output | Contract |
|---|---|
| plugin refusal | `error = "skillguard: install refused — N rejected (B blocked, U unscannable)"` + `formatBatchReport(scanResults)` (names each skill, verdicts visible; skill-scanner.ts:599) |
| auto-install refusal | `blocked: SkillScanResult[]` on result; text = `formatScanReport` (skill-scanner.ts:550) per rejected skill joined — full verdict + threats |
| UX | plugin: red ✗ error step, detail = report (plugin.ts:54); auto: new blocked section listing each skill |
| exit code | **Unchanged (TUI exits 0 today; Plugin.tsx has no exit signaling)** — additive bound; exit(1) on refusal flagged as V-2 follow-up |

### D7: Error contract
**Choice**: each call site wraps its `scan*` call in try/catch; throw ⇒ deny with `"skillguard scan failed — …"` (plugin) or rejected promise (auto). `--force` cannot weaken it — a throw is not a verdict, so no force branch consults it. Scanner never throws for read issues by design (safe-read.ts:160-274; skill-scanner.ts:448-459), so a throw is a genuine bug — deny loudly, nothing swallowed.

### D8: Gate placement — plugin import
**Choice**: promote `plugin import` to a gated entrypoint with the same fail-closed semantics: inside `importAgentSkillsPackage` (agent-skills.ts:105), after skills.json read + required-field validation (:112-132) and BEFORE the existing-install `fs.remove`/`fs.copy` (:143-148), run the gate on the source dir (as staged): (1) extend the validation (:123-132) to require `agentManifest.skills` present and non-empty (today only name/version/description are checked), each entry having a `name` and a `path` that resolves INSIDE `sourceDir` (normalized + realpath containment — a `path: "../../x"` refuses; no read outside the staged clone, JD-003); (2) coverage scan (`scanSkillsWithCoverage`, D9-hardened SKILL.md-only walk) over `sourceDir` with declared set = `agentManifest.skills[].path` → `<sourceDir>/<entry.path>/SKILL.md` (types/index.ts:168-172): any SKILL.md found outside the declared set → refuse as block-equivalent (force never lifts) with the offending paths named; (3) `evaluateInstallGate({ force })` on the declared results — refuse on `block`/`unscannable` per `isRejectedVerdict()`; `--force` bypasses ONLY `unscannable`, never `block`; scanner errors deny unconditionally. Refusal returns `{ success: false, error: report }` BEFORE the remove — an existing install is preserved. dryRun early-return (:136-138), like D3, does not scan.
**Why**: `plugin import` (`runPluginImport`, commands/plugin.ts:288, listed in VALID_PLUGIN_ACTIONS simple-renderers.tsx:62-72) copies sourceDir into PLUGINS_DIR with NO scan (`fs.copy` agent-skills.ts:148, `.installed.json` :164) — an alternate install call path that bypasses the entire gate; a block-scanning skill refused by `plugin add` installs unconditionally via `plugin import` (JD-001). With JD-001 fixed, the gate scanned only declared paths while `fs.copy` still installed the ENTIRE tree — an attacker could declare a clean skill and hide a malicious (undeclared) SKILL.md or other payload elsewhere in the tree, installed un-scanned (JD-006); this amendment enforces declared-set == copied-set BEFORE the copy, and the same enforcement closes the JD-006 variant in the plugin-add path (D1).
**Alternatives**: gate after `fs.copy` (rejected — G-1 race; refusal would need a rollback of a partially written destDir); restrict the copy to declared entries only (rejected in D1 — drops legit non-skill files, breaks the byte-identical-install spec scenario); full-tree scan without refuse-by-entitlement (rejected in D1 — clean-scanning hidden skills still install).

### D9: Symlink-safe walk for the gate scan
**Choice**: the gate's directory walk is hardened in two layers. (1) Identification: `fs.lstat` instead of `fs.stat` (skill-scanner.ts:522-524) so symlinks are never dereferenced. (2) POLICY (JD-007, revised from round 2): a symlink is NO LONGER skipped — ANY symlink encountered in the tree (a SKILL.md-shaped file, a directory that would contain skills, or any other entry) is recorded as a filesystem-integrity violation and the gate refuses (block-level, force never lifts). The walk never follows a symlink and never reads through one (no read outside the staged clone — JD-003); a visited-set of resolved directories (`realpath`) is retained as a defensive invariant that terminates any cycle even if the policy or a future caller ever recurses into a link — guaranteeing the `finally` cleanup runs. Applies to the coverage walk `scanSkillsWithCoverage` (D1/D8/D11, JD-006 + JD-007), which is SKILL.md-only by basename for collection (PLUGIN.md/README content never scanned, JD-002) and has NO subtree exemptions (`node_modules`/`.git` are visited, JD-007); entry paths are additionally realpath-contained within the source dir (D8), so no declared read can escape the staged clone.
**Why**: the gate walk follows symlinks today (`fs.stat` skill-scanner.ts:522-524) with no cycle detection — a dir symlink to an ancestor → unbounded async recursion → gate hangs, `finally` cleanup never runs; a symlinked SKILL.md reads outside the staged clone. Git preserves symlinks, so a staged clone is an attacker-controlled tree (JD-003). On the install side, fs-extra `fs.move` (plugin.ts:192) and `fs.copy` (agent-skills.ts:148, `dereference=false` default) preserve symlinks — a walk-skipped symlink therefore installs as a LIVE symlink whose post-install reads dereference to attacker-chosen content (JD-007 consequence b). Skip is not an option: refuse is the only policy under which D1 ("every skill-shaped file is declared") and D8 ("any SKILL.md outside the declared set → refuse") hold for the installed tree.
**Test binding**: symlinked-SKILL.md fixture → gate refuses naming the path, target never read; symlinked-dir fixture → refuses, subtree never enumerated; recursive-symlink fixture → first symlink refuses, gate terminates, `finally` cleanup runs.

### D10: Impact — skill-scanner.ts is no longer "Unchanged"
**Choice**: revise the File Changes claim — `skill-scanner.ts` stays **Modified** (D9/D11 walk hardening: `lstat`, visited-set, symlink flagging, no subtree exemptions) and gains one new export `scanSkillsWithCoverage` (JD-006 + JD-007: SKILL.md-only coverage walk returning declared / undeclared / symlinks). Existing export surface (`scanSkillFile`/`scanSkillsDirectory`/`isRejectedVerdict`/`formatScanReport`/`formatBatchReport`) is reused as-is; the hardening is internal to the new walk — `scanSkillsDirectory` (latent, not on the gate path) keeps its historical behavior unchanged.

### D11: Coverage-walk footprint integrity (JD-007)
| Option | Tradeoff | Decision |
|---|---|---|
| Walk the whole staged tree with NO exemptions (visit `node_modules`/`.git` too) + ANY symlink (file or dir) → block-level manifest-integrity refusal (force never lifts) | Walk's visit set == install footprint by construction: every entry `fs.move`/`fs.copy` will place is enumerated; a SKILL.md under `node_modules/<pkg>/` is undeclared by definition (the declared set is convention-bound: `skills/<name>` for plugin add, `entry.path` inside sourceDir for import) → refused; a symlink cannot be enumerated without dereferencing (JD-003) and would install LIVE (fs-extra preserves links) → refused outright. Cost: the walk itself is readdir/lstat-only (no content reads beyond declared entries); for packages that vendor large trees (e.g. committed `node_modules`) walk time grows with tree size (JD-005 latency note — cost, not correctness) | **Chosen** — makes D1 ("every skill-shaped file is declared") and D8 ("any SKILL.md outside the declared set → refuse") literally true for the installed tree; clean packages (no symlinks, no hidden SKILL.md) install byte-identically, spec scenario 6 intact |
| Keep the round-2 exemption (`node_modules`/`.git` skipped) and lstat-skip for symlinks | Cost rationale inherited from skill-scanner.ts:520; but install is whole-tree: a committed `node_modules/<pkg>/SKILL.md` or `.git/<...>/SKILL.md` lands un-scanned and un-declared (JD-007 consequence a) and a symlinked SKILL.md installs as a live link to attacker-chosen content (consequence b) | **Rejected (JD-007)** — the exemption is exactly the smuggling vector; D1/D8's unconditional claims cannot be true while the walk has holes the install does not |
| Walk everything, but symlinks are skipped silently (visited-set/realpath still terminates cycles) | No content read through links (JD-003 satisfied at scan time) | **Rejected (JD-007)** — the install side still preserves the link (fs-extra `dereference=false`); the un-scanned live symlink is the attack. Skip is only acceptable if the install side strips links, which would change install semantics (rejected below) |
| Exclude `node_modules`/`.git` from the INSTALL footprint (`fs.remove` before `fs.move`; `filter` option on `fs.copy`) so walk-skip == install-skip | Matches walk to install without walking big trees | **Rejected** — changes what lands in `PLUGINS_DIR` for packages that ship those dirs → install is no longer byte-identical to pre-gate behavior (spec scenario 6); requires per-path filter logic in two install sites and leaves symlinks still live-installed |
| Refuse any package containing `node_modules`/`.git` at all | Single root-level check, maximal strictness | **Rejected** — every plugin-add clone carries a root `.git` (clone artifact, not committed content; `fs.move` moves it in today); refusing on it would block every install unless the clone-created `.git` is special-cased, which is fragile and reopens the question for committed nested entries |
| Follow symlinks and scan their targets in-clone (dereference during walk) | Sees behind links | **Rejected** — dereferencing reads outside the staged clone (JD-003); inside-clone targets still install as live links that can be retargeted post-install |
**Refusal class**: symlink-in-tree is a manifest-integrity refusal — a call-site check from `scanSkillsWithCoverage` output (`symlinks[]`), evaluated BEFORE `evaluateInstallGate`, block-level, `force` never lifts (same slot as the JD-006 undeclared-SKILL.md check). The SKILL.md-under-`node_modules`/`.git` case needs no new class: with the exemption removed it is the existing undeclared-SKILL.md refusal.

## Data Flow

```
plugin add:    git clone → tmpDir (:154) → validatePlugin (:165-175)
  → [GATE] coverage walk tmpDir (SKILL.md-only collection, lstat+visited-set, NO exemptions —
       node_modules/.git walked; declared = manifest.skills → skills/<name>/SKILL.md)
       ANY symlink (file/dir) → refused { success:false, error names path } (manifest-integrity, force never lifts)
       undeclared SKILL.md found (incl. under node_modules/.git) → refused { success:false, error names paths }
       (block-level, force never lifts) → finally removes tmpDir (:216-220)
       else scan declared → evaluateInstallGate({force})
       refused → { success:false, error: batchReport } → finally removes tmpDir
       allowed → remove existing install (:189-191) → fs.move (:192) → metadata (:194-209)
plugin import: read skills.json (:110-121) → validate required fields (:123-132)
       + skills non-empty, entry.path realpath-contained in sourceDir (JD-006)
  → [GATE] coverage walk sourceDir (SKILL.md-only collection; declared = agentManifest.skills[].path
       → sourceDir/<entry.path>/SKILL.md; NO exemptions — node_modules/.git walked)
       ANY symlink (file/dir) → refused BEFORE fs.remove — existing install preserved (manifest-integrity, force never lifts)
       undeclared SKILL.md found (incl. under node_modules/.git) → refused BEFORE fs.remove — existing install preserved (block-level, force never lifts)
       else scan declared → evaluateInstallGate({force})
       refused → { success:false, error: batchReport } BEFORE fs.remove — existing install preserved
       allowed → remove existing install (:143-145) → fs.copy (:148) → plugin.json (:152) → .installed.json (:164)
skills auto:   detectProjectStack (:54) → classify loop (:72-94)
  → [GATE] scanSkillFile(each copyable) → evaluateInstallGate({force})
       refused → result.blocked = rejected, installed: []  (nothing copied)
       allowed → copy loop (:96-103)
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/lib/skill-install-gate.ts` | Create | `evaluateInstallGate` + `InstallGateDecision` (pure; receives ONLY declared results — JD-006 manifest-integrity refusals are call-site checks, never verdicts) |
| `src/lib/plugin.ts` | Modify | gate block at :186: coverage walk + declared scan; undeclared `SKILL.md` (incl. under `node_modules`/`.git`) and ANY symlink → refuse (manifest-integrity, block-level, force never lifts — JD-006 + JD-007); `force` option (:140) |
| `src/lib/auto-skill-install.ts` | Modify | pass-1 classify + gate; `blocked` field (:9-18); `force` (:20-29) |
| `src/lib/agent-skills.ts` | Modify | `importAgentSkillsPackage` gate before `fs.remove`/`fs.copy` (:143-148): skills.json validation extended with non-empty `agentManifest.skills` + `entry.path` realpath containment (:123-132); coverage scan over skills.json declared paths (:110-121), undeclared-SKILL.md (incl. under `node_modules`/`.git`) + ANY-symlink refusal (JD-001 + JD-006 + JD-007); `force` option |
| `src/lib/skill-scanner.ts` | Modify | walk hardening for the gate scan — `lstat`, visited-set, symlink flagging, NO subtree exemptions (D9/D11); new export `scanSkillsWithCoverage` (JD-006 + JD-007: SKILL.md-only coverage walk → `{ declared, undeclared, symlinks }`); `scanSkillsDirectory` unchanged (latent, non-gate) |
| `src/commands/plugin.ts` | Modify | trailing options on `runPluginAdd` (:33), thread force (:41); `runPluginImport` (:288) accepts `force` and passes it to `importAgentSkillsPackage` |
| `src/ui/Plugin.tsx`, `src/ui/AutoSkills.tsx` | Modify | `force` prop; blocked section in AutoSkills |
| `src/cli/dispatch/simple-renderers.tsx`, `src/cli/dispatch/skills-cmd.tsx` | Modify | pass `cli.flags.force` (plugin add and plugin import actions) |
| `src/cli/help.ts` | Modify | `--force` bound note (schema unchanged: `force` exists, :199) |
| `src/lib/skill-install-gate.test.ts` | Create | real-fs gate tests, no mocks; JD-007 fixtures: tree with `node_modules/<pkg>/SKILL.md` → undeclared refusal; symlinked `SKILL.md` / symlinked dir → integrity refusal (target never read); clean tree → byte-identical install |
| `src/lib/plugin.test.ts`, `src/lib/auto-skill-install.test.ts`, `src/commands/plugin.test.ts` | Modify | scanner doubles + gate cases; plugin-add coverage cases (JD-006 + JD-007): hostile tree hiding SKILL.md outside declared paths or under `node_modules` → refused before move; symlink anywhere in the tree → refused before move |
| `src/lib/agent-skills.test.ts` | Modify | import-path gate cases (JD-001) + coverage cases (JD-006 + JD-007): hidden SKILL.md (incl. under `node_modules`) refused, symlinked SKILL.md/dir refused, empty `skills` refused at validation, existing install preserved |
| `src/lib/skill-scanner.test.ts` | Modify | walk-hardening fixtures (JD-003 + JD-007): symlink flagged (never dereferenced, target never read), recursive symlink terminates (visited-set invariant), coverage-walk fixtures: declared/undeclared split (incl. `node_modules`/`.git` visited), symlinks output, PLUGIN.md excluded from collection, `entry.path` containment |

## Interfaces / Contracts

```ts
// src/lib/skill-install-gate.ts (new)
import type { SkillScanResult } from "./skill-scanner.js";
export interface InstallGateDecision {
  allowed: boolean;
  rejected: SkillScanResult[]; // rejected results when !allowed, else []
}
export function evaluateInstallGate(
  results: SkillScanResult[],
  options?: { force?: boolean },
): InstallGateDecision;

// src/lib/skill-scanner.ts — new export (JD-006 + JD-007)
export interface SkillCoverageScan {
  declared: SkillScanResult[]; // scan results for declared-entry SKILL.md files
  undeclared: string[];        // SKILL.md paths found in the tree OUTSIDE the declared set (incl. node_modules/.git)
  symlinks: string[];          // ANY symlink (file or dir) found in the tree → caller refuses (JD-007)
}
export async function scanSkillsWithCoverage(
  dir: string,
  declaredPaths: string[],   // per entry: skill dir path relative to dir (e.g. "skills/foo", "agents/foo")
): Promise<SkillCoverageScan>; // SKILL.md-only collection walk: lstat + visited-set, NO subtree exemptions
                               // (node_modules/.git visited — visit set == install footprint, JD-007),
                               // symlinks flagged, never dereferenced (JD-007 / JD-003),
                               // PLUGIN.md/README never collected (JD-002); declared paths realpath-contained (JD-003)

// Refusal classes in the package gates (all return { success:false, error } BEFORE placement):
//  - block/unscannable declared skill → evaluateInstallGate (force lifts ONLY unscannable)
//  - undeclared SKILL.md in the tree  → block-level, force NEVER lifts (JD-006; now incl. node_modules/.git, JD-007)
//  - ANY symlink in the tree          → manifest-integrity, block-level, force NEVER lifts (JD-007)
//  - empty/missing skills (import)    → refused at validation (JD-006)
//  - declared path escaping sourceDir → refused (JD-006 / JD-003 containment)
//  - scanner throw                    → deny unconditionally (D7)

// src/lib/auto-skill-install.ts — additive
export interface SkillInstallResult {
  installed: string[];
  skipped: string[];
  notFound: string[];
  detection: StackDetectionResult;
  blocked?: SkillScanResult[]; // populated only on refusal
}

// src/lib/plugin.ts — additive
options: { dryRun?: boolean; force?: boolean }
// src/lib/auto-skill-install.ts — additive
interface AutoInstallOptions { projectDir; skillsSourceDir?; skillsTargetDir?; dryRun?; force?: boolean }
// src/lib/agent-skills.ts — additive (JD-001; JD-006 validation + coverage in D8)
options: { dryRun?: boolean; force?: boolean } // importAgentSkillsPackage
// src/commands/plugin.ts — plugin import (JD-001)
runPluginImport(sourceDir, dryRun, onStep, force?: boolean) // :288, forwards to importAgentSkillsPackage({ dryRun, force })
```

## Testing Strategy

| Spec scenario | File | Approach |
|---|---|---|
| 1-6 plugin gate | `plugin.test.ts` (existing fs mock :5-17 + new `vi.mock("./skill-scanner.js")` via importOriginal) | block → refused, `fs.move` not called, `fs.remove` called (staging); unscannable → refused; force+unscannable → moves; force+block → refused; scan rejects → denied (with force too); declared pass/warn + coverage clean → byte-identical install (JD-006: an undeclared SKILL.md in the tree refuses even when declared skills pass); dryRun → scan not called |
| 7-9 auto gate | `auto-skill-install.test.ts` (+ scanner mock, default pass) | block → `installed: []`, copy not called, `blocked` lists it; unscannable refuses / force permits; sameDir → no scan call |
| 10-11 reports | both above | error / blocked text contains `[BLOCK]`, `Verdict: BLOCK`, `REJECTED`, skill names |
| 12 real fixtures | NEW `skill-install-gate.test.ts`, no mocks | mkdtemp pattern (skill-scanner.test.ts:665); real SAFE/malicious/binary/oversized/missing fixtures (:25-60, :709-737) → real verdicts → `evaluateInstallGate` assertions per verdict class |
| 13 import gate (JD-001) | `agent-skills.test.ts` | real-fs tmpdir fixtures: sourceDir with declared skills per skills.json — block source → refused BEFORE `fs.remove`/`fs.copy` (existing install preserved, nothing in PLUGINS_DIR); unscannable refused / force permits; force+block still refused; scanner throw denies (with force too); dryRun → no scan; pass → byte-identical import |
| 14 gate scan scope (JD-002) | `plugin.test.ts` + `agent-skills.test.ts` | plugin with PLUGIN.md matching critical patterns (`~/.ssh`, curl, "bypass") but clean declared skills → ALLOWED (README never scanned); declared skill `block` → refused |
| 15 symlink policy + walk hardening (JD-003 + JD-007) | `skill-scanner.test.ts` + `skill-install-gate.test.ts` | symlinked `SKILL.md` pointing outside the staged tmpdir → REFUSED (named in report), target never read; symlinked dir containing skills → REFUSED, subtree never enumerated; recursive-symlink fixture (dir symlink to ancestor) → first symlink refuses, gate terminates, `finally` cleanup runs; visited-set/realpath invariant asserted at walk unit level; real mkdtemp fixture, no mocks |
| 16 scan/install footprint parity (JD-006 + JD-007) | `plugin.test.ts` + `agent-skills.test.ts` + `skill-scanner.test.ts` | (a) hostile package declares one clean skill and hides SKILL.md/`skill.md` outside the declared paths (`evil/SKILL.md`, `docs/skill.md`, executable literally named `SKILL.md`) → refused, nothing lands (plugin add: staging removed, `fs.move` not called; import: existing install preserved, `fs.remove`/`fs.copy` not called), `--force` does NOT lift; (b) import package with `skills: []` or `skills` missing → refused at validation before any scan; (c) import package with declared `path: "../../outside"` (or absolute) → refused (containment — scan never reads outside sourceDir); (d) legit package declaring all its skills, shipping NO symlinks and no hidden SKILL.md → byte-identical install unchanged (clean-install scenario preserved); (e) PLUGIN.md/README containing critical patterns (`~/.ssh`, curl, "bypass") with clean declared skills → ALLOWED (rebinds JD-002 under the coverage walk — README content never scanned; a SYMLINKED PLUGIN.md would still refuse, on integrity grounds, not content); (f) package with committed `node_modules/<pkg>/SKILL.md` (or `skill.md`) → REFUSED as undeclared — the walk has no exemptions, so the SKILL.md is found and is outside the declared set (JD-007 consequence a); (g) package with a symlinked `SKILL.md` or a symlinked dir → REFUSED (manifest-integrity, force never lifts) — binds JD-007 consequence b |
| 17 JD-007 regression: clean install preserved | `plugin.test.ts` + `agent-skills.test.ts` | existing plugins WITHOUT `node_modules`, `.git` content, or symlinks (the current installed base) install byte-identically — coverage walk passes, no integrity refusals fire, `fs.move`/`fs.copy` behavior unchanged |

Existing doubles updated: `auto-skill-install.test.ts` mocks fs-extra (:4-13) but `safeReadFile` uses real `node:fs/promises` (safe-read.ts:16) — after the change, fake paths would scan as `unscannable` and refuse the 6 existing tests; the scanner mock (default pass) restores them. `plugin.test.ts` existing installPlugin tests never reach the gate (early returns :323/:340, dryRun :328-332) — safe with mock default `[]`. `commands/plugin.test.ts` (:5-12) compiles unchanged (trailing options); add force-threading assertion.

## Migration / Rollout

No migration — in-memory gate, no config/schema/file-format change, `force` defaults false so old library consumers compile unchanged (spec scope notes). New validation contract for package authors (JD-006 + JD-007): any `SKILL.md`/`skill.md` shipped anywhere in the tree (including under `node_modules`/`.git`) must be declared in plugin.json `skills` (plugin add) or skills.json `skills` (plugin import); packages MUST NOT ship symlinks (any symlink → refused, force never lifts); imports require a non-empty `skills` array — existing compliant packages (no symlinks, every SKILL.md declared) install unchanged; packages carrying undeclared skill files or symlinks are refused with the offending paths named. Rollback: revert commit; semantic-release republishes prior release.

## Open Questions

None.

## Non-goals (reaffirmed)

PreToolUse hook slice (`src/commands/hooks.ts:41` — `SectionId` extension point), `publishSkill` (`src/lib/skill-publish.ts:50`), `_hardening.py` env-var denylist, `registryGate` quality scoring (`src/commands/skills/scoring.ts:361`), hand-copied skills (no entrypoint), the `init` agent-skills manifest write (`stepAgentSkills`, `src/commands/init/steps/agent-skills.ts:18` — writes an empty skills.json, no skill content copied: nothing to scan). `plugin import` (`importAgentSkillsPackage`, agent-skills.ts:105) IS in scope (D8). JD-006/JD-007 residual: payloads that are neither `SKILL.md`/`skill.md` nor reachable from a scanned skill's content (executables, hooks, assets the scanner's content model never reads) still land with the whole-tree `fs.copy`/`fs.move` and are NOT scanned — declared-set == installed-set (no subtree exemptions) plus non-empty `skills` on import plus the symlink refusal closes the skill-shaped smuggling hole, including the `node_modules`/`.git` (JD-007 consequence a) and live-symlink (consequence b) corners; full asset/hook scanning remains a future slice (P-1 follow-ups, consistent with the scanner's SKILL.md-content model). Non-SKILL.md assets staying out-of-scope is a documented P-1 residual, SEPARATE from skill-shaped files — any basename matching `SKILL.md`/`skill.md` is within the scanner's content model and MUST be closed (and now is, via D11). Zero-skill plugins with no SKILL.md anywhere still install via `plugin add` (byte-identical; nothing skill-shaped to scan — the coverage walk finds no undeclared file and no symlink).