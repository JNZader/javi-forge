# Apply Progress: SkillGuard Utility Parser Redesign

## Work Unit 1 — RED (failing semantic corpus) — COMPLETE

Mode: Strict TDD (RED only; no runtime bytes changed). Base: `69823570ccae4b3a78e717b6510c3c402bb8975a`. Branch: `feat/skillguard-utility-parser-redesign` → target `feat/skillguard-pretooluse-hook-01-runtime`.

### Gate evidence

| Gate | Status | Evidence |
|---|---|---|
| G.1 | PASS | `sha256sum openspec/changes/skillguard-pretooluse-hook/review-ledger.md` = `423eac0ba98646463a7a425c0f5f1bf31db3d3b245c4f71772837ef01ccb71d1`, verified before AND after WU1 edits (executed: `sha256sum`, cwd repo root). The ledger carries pre-existing uncommitted parent modifications; its bytes match the gate hash exactly. |
| G.2 | PASS | No `reviews/ledger.json` or any synthetic native review JSON exists or was created (executed: `fd ledger.json openspec/` → no results). |
| G.3 | PASS | `JD-S1-FR3-001` and `JD-S1-FR3-002` remain `CRITICAL | open` in the parent ledger (read: review-ledger.md:135-136,160-161); parent Slice 1 PR/Slice 2 untouched. |
| G.4 | PASS | Attempt authority acquired by orchestrator (`state: proceed`); executor did not call acquire/settle. WU1 changed zero runtime bytes, so no rollback path was needed. |
| G.5 | PASS | HEAD = exact `69823570ccae4b3a78e717b6510c3c402bb8975a` (executed: `git rev-parse HEAD`). WU1 diff = 298 changed lines (273 additions + 25 deletions, `git diff --stat 69823570 -- <two test files>`), within WU1 forecast 280-360 and under the 400 hard cap / 800 unit cap. |

### TDD Cycle Evidence (RED-only work unit; GREEN/REFACTOR are WU2/WU3 by design)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1 | `src/__tests__/claude-hook-assets.test.ts` | L1 exact-MJS | ✅ 203 passed, 1 skipped (baseline run before edits) | ✅ semantic exports typed + referenced, absent from MJS | ➖ WU2 | ➖ WU2 | ➖ WU3 |
| 1.2 | same | L1/L3 env | ✅ same baseline | ✅ 17 env rows fail | ➖ WU2 | ➖ WU2 | ➖ WU3 |
| 1.3 | same | L1/L3 chmod | ✅ same baseline | ✅ 18 chmod rows fail | ➖ WU2 | ➖ WU2 | ➖ WU3 |
| 1.4 | same | L1/L3 base64 | ✅ same baseline | ✅ 18 base64 rows fail | ➖ WU2 | ➖ WU2 | ➖ WU3 |
| 1.5 | same | L1 identity/union + L5 registry | ✅ same baseline | ✅ 18 rows fail | ➖ WU2 | ➖ WU2 | ➖ WU3 |
| 1.6 | `src/__integration__/claude-pretooluse-exec.integration.test.ts` | L4 spawned | ✅ same baseline | ✅ 17 spawned rows fail | ➖ WU2 | ➖ WU2 | ➖ WU3 |

### RED verification (executed: `pnpm exec vitest run src/__tests__/claude-hook-assets.test.ts src/__integration__/claude-pretooluse-exec.integration.test.ts --reporter=dot`, exit 1, cwd repo root)

- Summary: `Test Files 2 failed (2) · Tests 101 failed | 197 passed (298)`.
- All 101 failures are NEW WU1 expectations; all 197 passes include every inherited pre-existing test (baseline 203 passed + 1 skipped; the delta is exactly the removed helper/host-oracle block: 41 helper tests + 2 live host probes + 1 host-skipped probe, all intentionally deleted per task 1.6).
- Failure classes, all sanctioned: (a) missing semantic exports — `runtime.normalizeEnvInvocation/normalizeChmodInvocation/normalizeBase64Invocation/reduceProfileUnion/UTILITY_PROFILE_REGISTRY` are `undefined` in the MJS (probed via dynamic import, not static named imports, so inherited tests in the same file keep passing); (b) flipped/new deny oracles — bypass probes currently exit 0 (`env -iS`, `env -vS`, `${READER}` expansion, `chmod 755 / --recursive`, `chmod --reference=<ref> / --recursive`, `/bin/chmod -R 755 /`, `base64 -id`, `base64 -i -d`, `/usr/bin/base64 -id`, path-qualified env); (c) wrong inherited rule ID — reference-first `chmod --reference=<ref> 777 /` currently denies via `shell.destructive-root` instead of `utility-ambiguity`/`critical-chmod`, and `env -S 'printf\q'` denies via `shell.obfuscated-interpreter` instead of wrapper-extraction ambiguity.
- Current-behavior ground truth was probed empirically (`/tmp/opencode/probe-current-runtime.mjs` against the exact MJS) before writing expectations, so every "passes now" anchor row (mode-first ordering, reference-only, S15/S18/S19/S20/S27-S30/S33/S35-S38, commandless env, within-bound nested split) is verified, not assumed.

### Files changed (product diff, 298 lines)

| File | Action | What was done |
|------|--------|---------------|
| `src/__tests__/claude-hook-assets.test.ts` | Modified (+243/-0) | Appended `SemanticRuntime` contract + five new describes: registry governance (7 source bindings, frozen invariants, complete option tables), env L1/L3 (bundles, abbreviations, escapes, `${VARNAME}`, split-work-limit, commandless), chmod L1/L3 (permutation, abbreviations, mixed-mode-reference partialRoles, mode777, Apple table), base64 L1/L3 (bundles both profiles, abbreviations, permutation, delimiter), identity/union (path-qualified, dynamic identity, danger-dominant `reduceProfileUnion`), and the L2 policy corpus. Inherited corpora byte-identical. |
| `src/__integration__/claude-pretooluse-exec.integration.test.ts` | Modified (+30/-25) | Removed `PARSERS` helper import + the entire `utility-specific semantic parsers` describe (old helper expectations + 3 live host-oracle probes). Added JD-S1-FR3-001/002 spawned deny probes, flipped GNU `base64 -id`/`-i -d` expectations to deny, protected-ambiguity diagnostics table (fixed categories + non-leakage), JD-R1-001 orderings (mode-first inherited rule ID, reference-first critical-chmod sink, reference-only silent accept), S39 downstream-shell table, benign sink rows. Kept the pwsh live syntax probe: it oracles PowerShell syntax, not GNU/Apple utility semantics, so it is outside the task-1.6 host-oracle removal scope. |

### API contract pinned by the RED corpus (for WU2)

- `UTILITY_PROFILE_REGISTRY`: frozen 7-entry array in fixed order; `source` = {publisher, artifact, version, section, sourceReference}; `longOptions` = `{name}[]`; `shortOptions` keyed by letter.
- `normalizeEnvInvocation(tokens)` / `normalizeChmodInvocation(tokens)` / `normalizeBase64Invocation(tokens)`: full argv including the utility token; return per-profile `ProfileResult[]` in registry order (env 1, chmod 3, base64 3). Chmod accepted results are assessed (`accepted-dangerous` when a critical target has recursive/mode777); env/base64 accepted results carry facts only (danger via candidates/sink in `evaluateBash`).
- `reduceProfileUnion(results)` → `{classification: safe|dangerous|unsupported, utility, results, acceptedFacts}` with danger dominance, safe-over-rejection, all-rejected→unsupported.
- Fixed evidence codes pinned: `env-active-expansion`, `env-unsupported-escape`, `split-work-limit` (phase `split`); `non-literal-identity`, `unsupported-utility` (phase `identity`); reason codes `mixed-mode-reference` (with `partialRoles`), `ambiguous-long-option`.
- Canonical option names: short table letter for shorts (`u`, `w`, `i`), full name without dashes for longs (`split-string`, `reference`).
- Ambiguity `Decision` = `{allowed:false, ruleId:"utility-ambiguity"}`; stderr carries fixed `utility-ambiguity` + utility + profile/sink categories only (≤241 bytes), never command/split/assignment/operand text.

### Issues / discoveries

- The GNU `base64 -id` bypass had NO explicit allow expectation anywhere; the "flip" was implemented as new deny rows that fail visibly against the current runtime (exit 0), satisfying task 1.6's visible-fail requirement.
- The nested split-work corpus row uses 33 sequential outer `-S` tokens (each split re-splices a single `-S` word): deterministic, quote-nesting-free, trips `splitOps > 32`.
- The reference-first ordering `chmod --reference=<ref> 777 /` is ALREADY denied today (inherited `0?777` token scan) — only the rule ID is wrong (`shell.destructive-root` vs `utility-ambiguity`/`critical-chmod`). The RED rows pin both the exit code and the corrected diagnostic category.

### Remaining

- WU2 (GREEN): tasks 2.1-2.6 — runtime implementation in the MJS.
- WU3 (REFACTOR): tasks 3.1-3.3 — remove boolean exports, manifest digest, full suite.

---

## Work Unit 2-A — GREEN part 1 (tasks 2.1 + 2.2) — COMPLETE

Branch: `feat/skillguard-utility-parser-redesign`. HEAD: `f0a0c4d8` (WU1 RED committed). Changes are UNCOMMITTED (orchestrator commits). WU1 section above is preserved verbatim; this section is appended.

### Gate evidence

| Gate | Status | Evidence |
|---|---|---|
| G.1 | PASS | `sha256sum openspec/changes/skillguard-pretooluse-hook/review-ledger.md` unchanged before/after WU2-A edits — WU2-A touched only the MJS and this file (`git status --short` before edits: ledger already `M`, pre-existing; not re-touched). |
| G.2 | PASS | No `reviews/` file created. |
| G.3 | PASS | Parent findings `JD-S1-FR3-001/002` untouched (ledger byte-identical). |
| G.4 | PASS | No attempt acquire/settle called; executor-only work. |
| G.5 | PASS | HEAD `f0a0c4d8` = WU1 RED commit; MJS diff from WU1 committed state = +251 lines (registry + primitives), well under WU2 365-440 forecast so far. |

### Implemented (tasks 2.1 + 2.2)

- `UTILITY_PROFILE_REGISTRY` — deep-frozen 7-entry array in fixed order (`gnu-env-v1`, `gnu-chmod-default-v1`, `gnu-chmod-posix-v1`, `apple-chmod-v1`, `gnu-base64-default-v1`, `gnu-base64-posix-v1`, `apple-base64-v1`). Source bindings: GNU Coreutils 9.4 (`doc/coreutils.texi`; env/chmod/base64 invocation sections) + Apple `chmod(1)` 2017-01-07 (SYNOPSIS) + Apple `bintrans(1)` 2022-04-18 (base64). Each profile carries `longOptions` (`{name, type: "flag"|"arg"}`; chmod GNU shared table, base64 GNU shared table) and `shortOptions` (`{type}` keyed by letter). Exact committed tables per design.md.
- Evidence-shape constants: `OVERALL_CLASS` (safe/dangerous/ambiguous), `PROFILE_STATUS`, `UTILITY`, `SINK`.
- `normalizeLiteralUtilityIdentity(token)` — lexical-only `/` split; rejects `$`, backtick, glob/brace/bracket markers, separators, NUL, empty as non-literal; case-sensitive basename match → `env`/`chmod`/`base64` or `unsupported`; returns `{rawToken, basename, utility, literal, pathQualified}`.
- `matchLongOption(token, longOptions)` — exact/unique-prefix matching; accepts only 1 committed match and rejects attached `=value` on a `flag`; returns `{option, name, value | null}` or `null` (zero/multiple/disallowed → machine records `ambiguous-long-option` rejection).
- `consumedArgument(option, tokenIndex, source, role, value)` — shared OptionArgument recorder for the 2.3-2.5 machines.
- `reduceProfileUnion(results)` — danger-dominant union: any `accepted-dangerous` → `dangerous`; else any `accepted-safe` → `safe`; else `unsupported` (all-rejected/all-unsupported, never relabeled safe). Returns `{classification, utility, results, acceptedFacts}`.
- Exported normalizers `normalizeEnvInvocation` / `normalizeChmodInvocation` / `normalizeBase64Invocation` — WU2-A level: identity-gated. Foreign/dynamic identity → single unsupported result (`non-literal-identity` / `unsupported-utility`, phase `identity`). Recognized utility → per-profile results in registry order (env 1, chmod 3, base64 3), each `unsupported` with **WU2-A-only placeholder** `{code:"unresolved-profile", phase:"option"}` — NOT a pinned code; replaced by machine evidence in 2.3-2.5. This placeholder never appears in exit/stderr paths (evaluateBash untouched).

### File changed

| File | Action | What was done |
|------|--------|---------------|
| `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs` | Modified (+251 lines) | Inserted semantic block after `hasBase64Decode`: evidence constants, deepFreeze, registry, identity, matchLongOption, recorder, reduceProfileUnion, identity-gated normalizers. Old boolean helpers (`parseEnvSplit`/`hasChmodRecursive`/`hasBase64Decode`) and `evaluateBash`/`commandWords` byte-identical — they are WU3 (3.1) removals and WU2-B consumers. |
| `openspec/changes/skillguard-utility-parser-redesign/apply-progress.md` | Modified | This WU2-A section appended (WU1 section preserved verbatim). |

### TDD evidence (executed: `pnpm exec vitest run src/__tests__/claude-hook-assets.test.ts --reporter=verbose`, cwd repo root)

Result: `68 failed | 131 passed (199)` in the unit file (WU1 RED had 101 failed / 197 passed across both files; the 298 total is unchanged). Integration file unchanged: `17 failed | 82 passed (99)` — identical to WU1.

**GREEN in WU2-A (rows that were RED in WU1 now PASS):**
- Registry governance (S48/S50): fixed-order + 7 source bindings + 5 complete option tables — ALL PASS.
- Identity rejection (S44): `$ENV_BIN` → `non-literal-identity`; `busybox` → `unsupported-utility` — PASS.
- Profile union (S04/S05/S06-S07): danger dominance, safe-over-rejection, all-rejected→unsupported — PASS.

**Remaining RED, all sanctioned (reporting exactly which and why):**
| # | Red rows | Owner | Why |
|---|---|---|---|
| 17 | env machine rows: S13/S14 ×2, S15 ×3, S16, S17, S18, S19, S20, S21, JD-DES-005, S01, S02, JD-DES-008 ×3 | WU2-B task 2.3 | env option pass + splitEnvString + split-work bound + commandless terminal not implemented |
| 18 | chmod machine rows: S23, S25 ×8, S26 ×2, S24, S03, S27, S29, S28, S30, S01 | WU2-B task 2.4 | GNU/POSIX/Apple chmod role machines + mixed-mode-reference + mode777 |
| 18 | base64 machine rows: S31, S32, S33, S01(-w), S34 ×11, S35, S36, S37 | WU2-B task 2.5 | GNU/POSIX/Apple base64 machines + real-pipeline sink |
| 1 | S41-S43 path-qualified identity (identity detection itself works — verify `normalizeLiteralUtilityIdentity` probe; the assertions demand machine-produced `facts` like `eventualExecutable`/`recursive`/`decode`) | WU2-B 2.3-2.5 | facts come from the machines |
| 13 | L2 policy rows: deny S13, S14, S41, S23, S24, S42, S31, S32, S43; ambiguity S16, S21, S09, S12 | WU2-B task 2.6 (+2.3-2.5) | `adaptProtectedSink` wiring into `evaluateBash` not implemented |
| 1 | manifest binding test (`binds the exact standalone runtime to its manifest`) | WU3 task 3.2 | DELIBERATE: WU2-A changed runtime bytes; `assets/claude-hooks/manifest.json` is untouched per hard requirements; digest updates only after runtime bytes stabilize (design.md "deliberate red signal") |

No regression: every WU1-passing test still passes (including inherited deny/allow corpora and the L2 rows that already passed pre-WU2: S29, S30, JD-R1-001 mode-first, and all L2 allow rows). The `pnpm test -- claude-hook-assets` form runs the whole suite via pnpm's positional passthrough (99 files); the canonical focused invocation is the explicit file path used above and in WU1.

### Discovered patterns (for WU2-B)

- **Union classification literal is `"unsupported"`, not `OVERALL_CLASS.AMBIGUOUS`** — the union reducer must not use the Decision-level class enum for its default; ambiguity is decided later by the protected-sink adapter (caught as the only WU2-A bug: `OVERALL_CLASS.UNSUPPORTED` is `undefined`; fixed with a string literal).
- Relative-path basename check: `component.at(-1)` on the `/`-split non-empty components; empty token or all-empty components → non-literal/unsupported-utility, never a crash.
- Shared GNU tables: `gnu-chmod-default-v1` and `gnu-chmod-posix-v1` share ONE frozen `longOptions`/`shortOptions` reference (per design "one shared table; only operand ordering differs"); same for the two base64 profiles. WU2-B machines must NOT mutate them (frozen anyway).
- `matchLongOption` returns `null` for both zero-match and multi-match — machine records `reasonCode: "ambiguous-long-option"` for the rejected-by-profile result; attached `=value` on a `flag` is rejected at match time.
- Registry lookup helper `profilesFor(utility)` preserves fixed registry order; normalizers return results in registry order (env 1, chmod 3, base64 3) — WU2-B machines should replace each result in that array position, keeping order.

### Deviations from design

- None in the implemented surface. The `unresolved-profile` placeholder evidence code is a WU2-A-only stub, explicitly not a pinned code, and is removed/machine-replaced by 2.3-2.5.

### Remaining

- WU2-B: tasks 2.3, 2.4, 2.5, 2.6 (machines + adapter) — greens all L1/L2/L4 rows above.
- WU3: tasks 3.1-3.3 (remove boolean exports, manifest digest, full suite/coverage).
