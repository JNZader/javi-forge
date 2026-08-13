# Tasks: skillguard-runtime-gate

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~950–1,150 (12 files: 2 new, 10 modified; tests dominate) |
| 400-line budget risk | High |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | 5 stacked PRs (work units below) |
| Delivery strategy | ask-always |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | `scanSkillsWithCoverage` + walk fixtures | PR 1 | base main; scanner export, tests included |
| 2 | `evaluateInstallGate` + real-fs gate tests | PR 2 | base main; depends on U1 walk only via types |
| 3 | plugin add gate (plugin.ts) + doubles | PR 3 | base main; depends on U2 |
| 4 | plugin import gate (agent-skills.ts) + tests | PR 4 | base main; independent of U3, depends on U1+U2 |
| 5 | auto-install gate + force wiring + UX + help | PR 5 | base main; depends on U2 |

## Phase 1: Scanner foundation (skill-scanner.ts)

- [x] 1.1 Add `SkillCoverageScan { declared: SkillScanResult[]; undeclared: string[]; symlinks: string[] }` + `scanSkillsWithCoverage(dir, declaredPaths)` (new export near skill-scanner.ts:544). Walk ENTIRE tree, NO `node_modules`/`.git` exemption (JD-007 — visit set == `fs.move`/`fs.copy` footprint); collect ONLY basename `SKILL.md`/`skill.md`, never `PLUGIN.md`/README (JD-002); `fs.lstat` every entry, symlinks never dereferenced; realpath visited-set terminates cycles (JD-003, defense-in-depth); NO content reads during walk (JD-005; only declared entries are `scanSkillFile`'d, :433). `declared` = `<dir>/<entry>/SKILL.md` per declaredPaths; `undeclared` = SKILL.md outside declared set; `symlinks` = any lstat-isSymbolicLink entry (file or dir).
- [x] 1.2 `scanSkillsDirectory` (:506-544) keeps historical behavior unchanged (latent, non-gate — D10); hardening lives only in the new walk.
- [x] 1.3 skill-scanner.test.ts: coverage-walk fixtures — declared/undeclared split incl. `node_modules/<pkg>/SKILL.md` and `.git` visited; `PLUGIN.md` excluded from collection; symlinked file/dir flagged (target never read, subtree not enumerated); recursive-symlink fixture terminates (visited-set invariant); existing tests (:803 skips node_modules, :819 PLUGIN.md) untouched.

## Phase 2: Pure gate (new skill-install-gate.ts)

- [x] 2.1 Create `src/lib/skill-install-gate.ts`: `InstallGateDecision { allowed; rejected: SkillScanResult[] }` + `evaluateInstallGate(results, options?: { force?: boolean })`. Rule: `allowed = !hasBlock && (rejected.length === 0 || force)` — block always refuses; force lifts ONLY `unscannable`; imports only `isRejectedVerdict` (:57-58); no fs.
- [x] 2.2 Create `src/lib/skill-install-gate.test.ts` (real fs, mkdtemp pattern skill-scanner.test.ts:665, NO safe-read mock — JD house pattern): pass→allowed, warn→allowed, block→refused even with force, unscannable→refused w/o force / allowed w/ force, empty→allowed; reuse SAFE_SKILL/MALICIOUS_CREDENTIAL_SKILL fixtures (:25-54).

## Phase 3: Entrypoint gates

- [x] 3.1 plugin.ts (D1, JD-006/JD-007): add `force?: boolean` to installPlugin options (:140); after destDir (:185), `if (!dryRun)` gate: declared-skills scan per `validation.manifest.skills` → `<tmpDir>/skills/<name>/SKILL.md` (types/index.ts:99; `skills/<name>` convention agent-skills.ts:29) + `scanSkillsWithCoverage(tmpDir, declaredPaths)`; `symlinks.length > 0` → refuse (manifest-integrity, block-level, force NEVER lifts, paths named); `undeclared.length > 0` (incl. `node_modules`/`.git`) → refuse block-level; else declared results → `evaluateInstallGate({ force })`; refusal returns `{ success:false, error: "skillguard: install refused — N rejected (B blocked, U unscannable)" + formatBatchReport }` BEFORE existing-install remove (:189-191) and `fs.move` (:192); `finally` (:216-220) removes staging; prior install preserved; scanner throw → deny `"skillguard scan failed — …"` (D7); dryRun no-ops.
- [x] 3.2 agent-skills.ts (D8, JD-001/JD-003/JD-006/JD-007): extend validation (:123-132) — `agentManifest.skills` present AND non-empty; each entry `name` + `path` realpath-contained in `sourceDir` (normalized + realpath; `"../../x"`/absolute refuses; no read outside staged clone); add `force?: boolean` on options (:107); BEFORE `fs.remove`/`fs.copy` (:143-148): `scanSkillsWithCoverage(sourceDir, skills[].path)` — ANY symlink or undeclared SKILL.md (incl. `node_modules`/`.git`) → refuse (force never lifts, paths named), else declared scan + `evaluateInstallGate({ force })`; refusal preserves existing install; dryRun early-return (:136-138) no scan.
- [x] 3.3 auto-skill-install.ts (D4, JD-009): restructure `autoInstallSkills` (:43) into classify (:72-94, predicates unchanged: notFound :78-81 / sameDir :84-87 / skip-if-present :90-94 / copyable) → scan-gate copyable sources via `scanSkillFile` → copy (:96-103). Any block ⇒ `installed: []` + new `blocked: SkillScanResult[]` field on `SkillInstallResult` (:9-18); unscannable refuses unless new `force?: boolean` on `AutoInstallOptions` (:20-29); scan throw ⇒ reject (nothing copied; matches UI error path AutoSkills.tsx:41-44); dryRun still scans (read-only) but copies nothing; sameDir short-circuits BEFORE scanning (:84-87). CAUTION JD-009: gate scans only folder-root SKILL.md (:75) while copy is whole-folder `fs.copy(sourcePath, targetPath)` (:99) — nested SKILL.md lands unscanned; keep design's stated scope, do NOT over-claim.

## Phase 4: Force wiring + refusal UX (D5, D6)

- [x] 4.1 commands/plugin.ts: `runPluginAdd(source, dryRun, onStep, options: { force?: boolean } = {})` trailing (:33 → `installPlugin({ dryRun, force })` :41); `runPluginImport(sourceDir, dryRun, onStep, force?: boolean)` (:288 → `importAgentSkillsPackage({ dryRun, force })` :301); existing 3-arg callers compile unchanged.
- [x] 4.2 simple-renderers.tsx: pass `force={cli.flags.force}` to `<Plugin>` (:81-86); skills-cmd.tsx: pass `force={cli.flags.force}` to `<AutoSkills>` (:61-65); reuse global `--force` schema (help.ts:199).
- [x] 4.3 Plugin.tsx: `force` prop (:20-34), thread to `runPluginAdd` (:86) and `runPluginImport` (:147), add to effect deps (:172). AutoSkills.tsx: `force` prop (:10-14), pass into `autoInstallSkills` (:31-36), render new blocked section (each blocked skill via `formatScanReport`, :550) where Skills summary sits (:135-188).
- [x] 4.4 help.ts: document `--force` bound (bypasses `unscannable` ONLY, never `block`) mirroring existing flag docs; schema untouched (:199).
- [x] 4.5 Refusal contract (D6): plugin error = lead line + `formatBatchReport` (:599); auto refusal text = `formatScanReport` (:550) per rejected skill joined; manifest-integrity refusals name offending paths via `SkillCoverageScan.symlinks`/`undeclared` in the error; exit code UNCHANGED (V-2 follow-up documented, not changed).

## Phase 5: Tests (design testing rows 1-17)

- [x] 5.1 plugin.test.ts: add `vi.mock("./skill-scanner.js")` (importOriginal); existing fs-extra mock (:5-17) retained; gate cases — block → refused, `fs.move` not called, `fs.remove` called (staging); unscannable → refused / force proceeds; force+block → refused; scanner rejects → denied (with force too); declared pass/warn + coverage clean → byte-identical install; undeclared SKILL.md incl. `node_modules/<pkg>/` → refused (Testing 16(f)); ANY symlink → refused, target never read (16(g)); PLUGIN.md with critical patterns → ALLOWED (Testing 14/16(e), JD-002); dryRun → no scan call. JD-010: clean-install case (Testing 17) MUST assert success — plugin-add installs DO carry the clone's root `.git`; never assert absence of `.git`.
- [x] 5.2 auto-skill-install.test.ts: add scanner mock (default pass) — safeReadFile uses real `node:fs/promises`, fake paths would now scan `unscannable` and break the 6 existing tests; gate cases (Testing 7-9) — block → `installed: []`, `fs.copy` not called, `blocked` lists it; unscannable refuses / force permits; sameDir → no scan call (:50-63 preserved).
- [x] 5.3 agent-skills.test.ts (Testing 13, 16(b)(c)(d)(f)(g), 17): block-scanning source dir → refused BEFORE `fs.remove`/`fs.copy`, existing install preserved, nothing in PLUGINS_DIR; `skills: []` or missing → refused at validation; `entry.path: "../../outside"` or absolute → refused (containment, scan never reads outside sourceDir); undeclared SKILL.md incl. `node_modules` → refused; symlinked SKILL.md/dir → refused (force never lifts); force+unscannable proceeds, force+block refused; scanner throw denies (with force too); dryRun → no scan; clean → byte-identical import.
- [x] 5.4 skill-scanner.test.ts (Testing 15, 16): symlinked SKILL.md → flagged, never dereferenced, target never read; symlinked dir → flagged, subtree never enumerated; recursive-symlink fixture → terminates (visited-set/realpath invariant asserted at walk unit level); PLUGIN.md excluded; `node_modules`/`.git` visited; declared/undeclared split incl. containment of declared paths.
- [x] 5.5 commands/plugin.test.ts: assert force threaded — mocked `installPlugin` receives `{ dryRun, force }` and `importAgentSkillsPackage` receives `{ dryRun, force }`; existing 3-arg tests (:72, :374) compile unchanged.
- [x] 5.6 skill-install-gate.test.ts integration (Testing 12, 15): real SAFE/binary/oversized/missing fixtures → real verdicts → `evaluateInstallGate` assertions per class; recursive-symlink fixture refuses and `finally` cleanup runs; `pnpm validate` green at coverage floors (lines 85 / branches 80).

## Phase 6: Docs / rollout (JD-008)

- [x] 6.1 design.md Migration wording is the contract: new package-author requirements (every `SKILL.md`/`skill.md` anywhere in the tree declared; no symlinks; non-empty `skills` on import) — JD-008: name the strictness tradeoff explicitly ("legit symlinked packages are force-proof refused; deliberate"), do NOT weaken the policy in code or comments.