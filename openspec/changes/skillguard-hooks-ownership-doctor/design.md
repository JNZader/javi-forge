# Design: SkillGuard Ownership Classifier and Read-Only Doctor (Slice 2)

## Technical Approach

Slice 1 shipped a standalone, dependency-free Node MJS evaluator plus a manifest whose
`settingsEntries.current` is still `null`. This slice adds the **recognition layer** that
must exist before any mutation: an exact, fixture-backed classifier for **both** managed
components (the copied MJS asset and the Claude `PreToolUse` settings entry), plus a
component-level **read-only doctor** exposed as a library function and report contract. No
filesystem is mutated, no CLI route is added, and init is untouched. This slice is the
load-bearing dependency for Slice 3 (the transactional install/repair), which must trust
exact state recognition rather than invent ownership at mutation time — the precise failure
mode (clobbering user hooks, mis-migrating legacy) the arc exists to prevent.

The layer splits into two modules with a strict purity boundary:

- **`src/lib/claude-hook-settings.ts` — pure, zero I/O.** Protocol-shape validation of a
  parsed settings object, canonical settings-entry serialization and identity, exact v0
  legacy recognition, and removal/merge **planning only**. Every function takes already-parsed
  JS values and returns values; it never opens a file. Slice 3's transaction consumes these
  plans; it does not re-derive ownership rules.
- **`src/lib/claude-hook-manager.ts` — read-only subset, `fs` only through `safe-read`.**
  Asset validation (bounded read + hash), the 9-state classification for each component
  (delegating settings-entry identity to `claude-hook-settings.ts`), and the component-level
  doctor report as a pure-ish orchestrator. Slice 3 **grows** this file with the transaction
  (install/repair/backup/temp/fsync/ACL/rename/rollback); it does **not** relocate Slice-2
  code. The transaction entry points are declared here now only as clearly-commented
  unimplemented seams.

The manifest gains the concrete settings-entry identity: `settingsEntries.current =
{ version, canonicalSha256 }`, guarded by an append-only released-snapshot test mirroring the
Git-hook convention in `src/__tests__/hook-assets.test.ts`. Populating it breaks the current
`claude-hook-assets.test.ts:43` `settingsEntries: { current: null }` assertion, which is
updated in this slice.

This maps to the Slice-2 boundary committed in the archived parent design
(`openspec/changes/archive/2026-08-16-skillguard-pretooluse-hook/design.md`): the 9 component
states, the independent-component principle, the exact legacy cohort, and the File Changes
rows for `claude-hook-settings.ts` / `claude-hook-manager.ts`. It delivers only the read-only
subset of those rows; every mutation clause in the parent is a Slice-3 seam here.

## Locked Inputs (not re-litigated)

- **Approach 1 — two modules.** Pure `claude-hook-settings.ts` (validation, canonical
  identity, legacy recognition, planning) + read-only subset of `claude-hook-manager.ts`
  (asset validation, classification, doctor).
- **Decision ① — library scope.** The doctor is a library function + report struct +
  fixtures. The runnable `javi-forge hooks doctor claude` CLI route, init rewiring
  (`src/commands/init/steps/security.ts`), help text, and the effective-execution inventory
  (safe-mode / MDM / `disableAllHooks` / `settings.local` / user precedence; RUNNABLE /
  BLOCKED / INCONCLUSIVE matrix + exit codes 0/1/2) are **Slice 4** — out of scope.
- **Decision ② — asset-SHA decoupling.** The canonical settings-entry hash normalizes the
  live asset SHA token (`:sha256:<ASSET_SHA256>`) out of `statusMessage` to a fixed
  placeholder before hashing, so settings-entry identity is invariant under asset rotation.

## Architecture Decisions

### Decision 1: Two modules with an enforced pure/impure boundary

**Choice**: `claude-hook-settings.ts` performs **zero** filesystem access — it receives a
parsed settings object and the current asset SHA, and returns validation results, the
canonical serialization, the canonical hash, the classified settings-entry state, and
removal/merge plans. All bytes-on-disk access lives in `claude-hook-manager.ts` and goes
**only** through `safeReadFile` from `src/lib/safe-read.ts`. `lstat`/`stat` for
symlink/non-regular detection is the single additional `node:fs/promises` surface the manager
touches, and it is confined to one private helper.

**Alternatives considered**: one module owning both recognition and I/O; a class holding a
filesystem handle; reading files inside the settings module for convenience.

**Rationale**: the classifier drift risk between this slice and Slice 3's mutator is the
central architectural hazard (parent risk table, "classifier drift" → Med). A pure planner is
trivially testable with in-memory fixtures — every one of the 9 states × 2 components, plus
legacy cohort variants — with no temp directories, and Slice 3 can wrap the identical pure
functions in its transaction without copying rules. Confining fs to `safe-read` reuses the
audited bounded-read path (binary rejection, byte budget, non-throwing discriminated union)
instead of re-introducing an unguarded `fs.readFile`.

### Decision 2: Always recompute identity; never trust a claimed marker

**Choice**: Classification recomputes bytes/canonical identity every time. The asset marker
line and the settings `statusMessage` prefix establish only *claimed* ownership. The current
SHA is always recomputed from the read bytes; the canonical settings hash is always recomputed
from the canonical serialization. A `statusMessage` that *claims* a version/hash is never
believed — the claimed hash is parsed only to enrich diagnostics, never to decide state.

**Alternatives considered**: trust the version/hash embedded in `statusMessage`; cache a prior
classification; infer ownership from filename/matcher/path resemblance.

**Rationale**: mirrors parent Decision 2 ("Classification always recomputes bytes/canonical
group identity; it never trusts a claimed hash"). Marker presence proves intent; recomputed
known hashes prove identity; similar foreign content stays foreign.

### Decision 3: Decouple settings-entry identity from asset rotation (Decision ②)

**Choice**: Before hashing the canonical settings entry, replace the asset-SHA token inside
`statusMessage` with a fixed placeholder. The managed marker is
`javi-forge-global-pretooluse:v1:sha256:<ASSET_SHA256>`; canonicalization rewrites the trailing
64-hex to the literal `<ASSET_SHA256>` sentinel, then hashes. The manifest stores the
resulting placeholder-normalized `canonicalSha256`.

**Alternatives considered**: embed the live asset SHA in the settings hash (couples the two
identities); drop the SHA token from `statusMessage` entirely (loses the runtime's
tamper-evidence marker); a separate settings-only marker with no SHA.

**Rationale**: the components are classified independently (parent "Independent component
states"). If the settings hash embedded the live asset SHA, every asset byte change — a policy
tweak in a future slice — would flip a byte-identical settings entry to `edited-managed` and
force a spurious settings rewrite. Normalizing the token out keeps the on-disk `statusMessage`
tamper-evident (it still names the exact asset SHA for humans and for the asset↔settings
cross-check) while making the settings-entry *identity* stable across asset versions. The
cross-component consistency check (does the settings `statusMessage` SHA equal the current
asset SHA?) becomes a separate doctor signal, not part of the identity hash.

### Decision 4: Legacy recognition is byte/structure exact — resemblance is foreign

**Choice**: v0 legacy is recognized by exactly two proofs, in order: (1) the complete file's
SHA-256 equals `b4638222ecddc2daac6ec3339596d853a626906bbd1233d789d80a319325c68d`
(`templates/security-hooks/claude-settings-security.json`), or (2) inside a larger valid
settings object, the complete four-object cohort is present by **deep structural equality** —
exactly one deep-equal match for each of the two Bash `PreToolUse` objects, the `Write|Edit`
`PreToolUse` object, and the Bash `PostToolUse` object. Any set with one/two/three cohort
members, a duplicate of a member, or a one-byte-edited member is a **partial legacy cohort**
and classifies as `foreign` (partial-legacy). No substring, normalized-shell-text, or
matcher/path resemblance ever proves legacy ownership.

**Alternatives considered**: substring match on the legacy `hook` bodies; per-object legacy
ownership; fuzzy/normalized comparison tolerant of whitespace.

**Rationale**: mirrors parent "Exact legacy recognition". The recognizer's false-positive risk
is rated **High** (parent risk table) — a resemblance match would migrate (delete) user content
it does not own. Deep structural equality against a committed cohort, with partial cohorts
demoted to `foreign`, is the only rule that cannot be tricked by a similar-looking foreign
hook. The cohort object shapes are frozen fixtures derived from the retained legacy template.

### Decision 5: Component-level doctor now; effective-execution matrix later

**Choice**: `doctorClaudePreToolUse(projectDir)` returns a report describing **file
ownership** state only: both component states, asset version/SHA, Node availability/version
(`>=22`), `matcherExact`, `commandShapeExact`, the five-tool coverage constant, the host
residual string, a `hostResidual`/consistency note, `remediation[]`, and a `healthy` boolean.
`healthy` is `true` iff both components are `managed-current`, the matcher and command shape
are exact, and Node `>=22`. The report deliberately **omits** the `execution` verdict
(RUNNABLE/BLOCKED/INCONCLUSIVE), the effective-execution inventory
(disableAllHooks/settings.local/user/MDM/safe-mode), and exit codes — those are Slice 4.

**Alternatives considered**: ship the full parent `ClaudeHookDoctorReport` (with `execution`)
now; block Slice 2 until the inventory is designed; fold the CLI dispatch into this slice.

**Rationale**: reconciles the task phrasing ("provides hooks doctor claude health-check") with
this change's own non-goals and the parent's Slice-4 boundary. The component-level report is
exactly the read-only recognition surface Slice 3 needs to verify its own writes; the
effective-execution matrix depends on host-policy probing that is Slice 4's scope and would
breach this slice's review budget. The report struct is forward-compatible: Slice 4 adds the
`execution` field without changing Slice-2 fields.

### Decision 6: Populate `settingsEntries.current` under an append-only guard

**Choice**: Set `manifest.settingsEntries.current = { version: 1, canonicalSha256: <hash> }`
where the hash is the Decision-② placeholder-normalized canonical serialization of the exact
managed handler group. Add a released-snapshot guard test — a committed
`RELEASED_SETTINGS_SNAPSHOT` prefix plus the append-only assertion — mirroring
`src/__tests__/hook-assets.test.ts`: `settingsEntries.historical[]` must always *start with*
the released list, so a released settings identity can never be silently rewritten or removed
without an explicit, reviewer-visible edit. Update the
`claude-hook-assets.test.ts:43` `toMatchObject` assertion from `current: null` to the
populated shape.

**Alternatives considered**: leave `current` null and derive identity at runtime; store the
hash without a historical guard; overwrite `historical` when the settings shape changes.

**Rationale**: the settings entry has no canonical identity while `current` is `null`
(parent "Why"). The append-only guard is the direct analogue of the Git-hook R2 fleet-brick
guard: a count can be bumped honestly while a hash is silently rewritten; a list cannot. The
`claude-hook-assets.test.ts` assertion change is a required, documented consequence flagged in
the proposal's Installed-Consumer Impact.

### Decision 7: `planManagedClaudeHookRemoval` lives in the pure settings module now

**Choice**: The pure removal/merge planners (`planManagedClaudeHookRemoval`,
`planManagedClaudeHookMerge`) are implemented in `claude-hook-settings.ts` in this slice,
returning a structural plan (which handler index to remove/replace, which siblings to
preserve, whether the operation refuses). They perform **no** I/O and no mutation. The
transaction that *executes* a plan — backups, temps, fsync, ACL gate, rename, rollback —
remains a Slice-3 seam in `claude-hook-manager.ts`.

**Alternatives considered**: defer all planning to Slice 3; put planners in the manager.

**Rationale**: mirrors parent Decision 7 ("exposes a pure `planManagedClaudeHookRemoval` …
so a product rollback release can remove proven identities"). Committing the ownership rules
in a pure planner now bounds Slice 3 — the mutator cannot invent weaker ownership rules
because the plan it must execute is already fixture-tested.

## Data Model

### Component states (independent per component)

```ts
export type ClaudeHookComponentState =
  | "absent"          // nothing at the path / no managed handler present
  | "managed-current" // recomputed identity == manifest.current
  | "released-outdated" // recomputed identity ∈ manifest.historical
  | "exact-legacy"    // exact v0 legacy (file SHA or full 4-object cohort)
  | "edited-managed"  // claimed marker present, identity unknown (or ambiguous/multi-marker)
  | "foreign"         // no marker, not legacy (incl. partial-legacy cohort)
  | "symlink"         // lstat reports a symbolic link at the asset path
  | "non-regular"     // exists but not a regular file (dir/fifo/socket/device)
  | "malformed";      // settings JSON unparseable or wrong shape
```

### Settings-entry identity

```ts
export interface CanonicalSettingsEntry {
  version: number;            // parsed from statusMessage marker
  canonicalSha256: string;    // Decision ②: asset-SHA token normalized out, then hashed
}

export const MANAGED_STATUS_PREFIX = "javi-forge-global-pretooluse:v1:sha256:";
export const ASSET_SHA_PLACEHOLDER = "<ASSET_SHA256>";
```

### Doctor report (Slice-2 read-only surface)

```ts
export interface ClaudeHookDoctorReport {
  healthy: boolean;
  settings: { state: ClaudeHookComponentState; version?: number; canonicalSha256?: string; detail: string };
  asset:    { state: ClaudeHookComponentState; version?: number; sha256?: string; detail: string };
  node:     { available: boolean; version?: string; satisfiesMinimum: boolean }; // minimum: 22
  matcherExact: boolean;        // matcher === "Bash|PowerShell|Read|Write|Edit"
  commandShapeExact: boolean;   // node + single ${CLAUDE_PROJECT_DIR}/... arg + timeout 30
  assetSettingsConsistent: boolean; // statusMessage SHA token === current asset sha256
  coverage: readonly ["Bash", "PowerShell", "Read", "Write", "Edit"];
  hostResidual: "spawn/start/timeout failures continue through Claude permission flow";
  remediation: readonly string[];
  // Slice 4 will add: execution: { status: "runnable"|"blocked"|"inconclusive"; ... }
}
```

`healthy` predicate (exactly this conjunction):

```
healthy =
     settings.state === "managed-current"
  && asset.state    === "managed-current"
  && matcherExact
  && commandShapeExact
  && node.satisfiesMinimum
```

Note: `assetSettingsConsistent` is reported and drives `remediation[]` but is **not** part of
`healthy` — a rotated asset with a still-canonical settings entry (Decision ②) is not
unhealthy, it is a doctor advisory that the copied asset is outdated relative to the package.

### Manifest shape (populated this slice)

```json
"settingsEntries": {
  "current": { "version": 1, "canonicalSha256": "<placeholder-normalized canonical group sha256>" },
  "historical": []
}
```

## Algorithms

### A. Asset classification — `classifyAssetState(assetPath)` (manager, read-only)

Deterministic; always recompute the hash; never trust a claimed marker.

```
lstatResult = lstat(assetPath)                         // no-follow
if lstatResult is ENOENT:            return { state: "absent" }
if lstatResult errors (other):       return { state: "non-regular", detail: errno }  // fail-visible, refuse-in-Slice-3
if lstatResult.isSymbolicLink():     return { state: "symlink" }
if not lstatResult.isFile():         return { state: "non-regular" }

read = safeReadFile(assetPath, { maxBytes: 1 MiB, maxLineLength: Infinity })
if not read.ok:
    if read.reason == "not-found":   return { state: "absent" }      // TOCTOU race after lstat
    if read.reason == "binary":      return { state: "foreign", detail: "binary" }
    if read.reason == "too-large":   return { state: "foreign", detail: "exceeds asset budget" }
    else:                            return { state: "non-regular", detail: read.reason }

bytes = utf8 bytes actually read
if not bytes.startsWith(MANAGED_MARKER + "\n"):        // exact marker line
    return { state: "foreign" }                        // no legacy-unmarked identity recorded for the asset

sha = sha256(bytes)                                    // ALWAYS recompute
if sha == manifest.asset.sha256:            return { state: "managed-current", version, sha256: sha }
if sha ∈ manifest.asset.historical:         return { state: "released-outdated", version, sha256: sha }
return { state: "edited-managed", sha256: sha }        // marker present, hash unknown
```

Notes: `lstat` is the only non-`safe-read` fs call, isolated in one helper. `safeReadFile`
already returns `not-a-file` for non-regular paths and rejects binaries by NUL sniff, so the
manager never buffers a huge or binary asset. The one-byte truncation flag from `safe-read`
never fires here because the asset is far under 1 MiB; if `truncated` is ever set the bytes
cannot match a known hash and the state is `edited-managed`/`foreign` — never a false
`managed-current`.

### B. Settings-entry classification — `classifySettingsEntry(parsed, currentAssetSha)` (settings, pure)

Input is the already-parsed settings value (the manager reads+parses; the settings module is
pure). Shape validation first, then marker-driven identity, then legacy fallback.

```
if parsed is null / not a plain object:                 return { state: "malformed" }
if "hooks" present and (not plain object):               return { state: "malformed" }
if hooks.PreToolUse present and (not array):             return { state: "malformed" }

groups   = hooks?.PreToolUse ?? []
markers  = every handler across every group whose command-hook object has a string
           statusMessage that startsWith MANAGED_STATUS_PREFIX
if markers.length > 1:                                   return { state: "edited-managed", detail: "multiple markers" }
if markers.length == 0:
    // no managed marker → legacy or foreign (Algorithm C)
    return classifyLegacy(parsed)                        // exact-legacy | foreign(partial-legacy) | absent

marker   = markers[0]
group    = the PreToolUse group containing marker
if group is not a valid matcher-group (matcher not a string, hooks not an array):
    return { state: "edited-managed", detail: "marker in invalid container" }

entry    = canonicalizeSettingsEntry(group, marker)      // Decision ②: SHA token → placeholder
hash     = sha256(entry.serialization)                   // ALWAYS recompute
version  = parseVersionFromStatus(marker.statusMessage)  // "…:v1:…" → 1

if hash == manifest.settingsEntries.current.canonicalSha256:   state = "managed-current"
elif hash ∈ manifest.settingsEntries.historical:               state = "released-outdated"
else:                                                          state = "edited-managed"

return { state, version, canonicalSha256: hash, group, markerIndex }
```

The manager wraps this: it `safeReadFile`s `.claude/settings.json` (returning `absent` on
`not-found`), `JSON.parse`s inside a `try` (`malformed` on throw), then calls the pure
classifier and additionally computes `matcherExact`, `commandShapeExact`, and
`assetSettingsConsistent` by comparing the marker's asset-SHA token to `currentAssetSha`.

### C. Legacy recognition — `classifyLegacy(parsed)` and `matchesLegacyCohort(...)` (settings, pure)

```
// Whole-file exact match is decided by the MANAGER (it holds the raw bytes):
//   if sha256(rawFileBytes) == LEGACY_FILE_SHA256 ("b4638222…") → { state: "exact-legacy", detail: "whole-file" }
// The pure settings module decides the in-object cohort:

cohort = the four committed legacy objects (frozen fixtures):
  L1 = Bash PreToolUse #1  (dangerous-command block)
  L2 = Bash PreToolUse #2  (sensitive-read block)
  L3 = Write|Edit PreToolUse (protected-file block)
  L4 = Bash PostToolUse    (secret-scan warn)

pre  = parsed.hooks?.PreToolUse  ?? []
post = parsed.hooks?.PostToolUse ?? []
present = for each of {L1,L2,L3,L4}: count deep-structural-equality matches in its section

if all four have exactly one match:            return { state: "exact-legacy", detail: "cohort" }
if any Lk has ≥1 match (but not the exact one-of-each set):
                                               return { state: "foreign", detail: "partial-legacy" }
return { state: "absent" }                     // no managed marker, no legacy trace
```

`deepStructuralEqual(a, b)` is order-sensitive for arrays, key-set-exact for objects, strict
for scalars — no substring, no normalization, no tolerance. A duplicate of any Lk (count > 1)
or a one-byte-edited member (count 0 for that Lk but another Lk present) both land in
`foreign` (partial-legacy). `absent` (no marker, no legacy trace) is distinct from `foreign`
so the doctor can say "install" rather than "collision".

### D. Canonical settings-entry serialization — `canonicalizeSettingsEntry(...)` (settings, pure)

The canonical form is derived from the marker-proven handler group, not from arbitrary
on-disk bytes, so semantically-identical entries with different key order hash identically.

Rules (deterministic, host-independent — no `process.platform` branch):

1. **Fixed key order** for the handler object:
   `type, command, args, timeout, statusMessage`. For the group object: `matcher, hooks`.
2. **Exact matcher**: `"Bash|PowerShell|Read|Write|Edit"` — the canonical form asserts this
   literal; a different matcher yields `matcherExact = false` upstream and the entry hashes to
   a non-current value.
3. **Command shape**: `type: "command"`, `command: "node"`, `args:
   ["${CLAUDE_PROJECT_DIR}/.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs"]`,
   `timeout: 30`. The `${CLAUDE_PROJECT_DIR}` placeholder is kept literal — never resolved to
   an absolute path — so identity is location-independent, mirroring how the runtime already
   folds `${CLAUDE_PROJECT_DIR}` lexically.
4. **Decision ②**: in `statusMessage`, replace the trailing 64-hex asset SHA with
   `ASSET_SHA_PLACEHOLDER` before serialization, so `…:sha256:<ASSET_SHA256>` is the hashed
   text regardless of the live asset SHA.
5. **JSON convention**: serialize with the repository convention — 2-space indent, trailing
   newline — then UTF-8 hash. This matches the byte convention the Git-hook manifest and the
   Slice-3 writer use, so the recomputed hash is stable across read/write round-trips.

Only the single marker-proven handler participates. Sibling handlers in the same group are
preserved by the *planner* (Decision 7) but are **not** part of the canonical entry identity —
identity is handler-granular per the parent "Ownership is handler-granular" rule.

### E. Doctor assembly — `doctorClaudePreToolUse(projectDir)` (manager, read-only orchestrator)

```
assetState    = classifyAssetState(join(projectDir, ".claude/hooks", ASSET_NAME))
settingsRead  = safeReadFile(join(projectDir, ".claude/settings.json"))
settingsState = manager wraps classifySettingsEntry(parse(settingsRead), currentAssetSha)
node          = detectNode()            // node.available + version + satisfiesMinimum(>=22)
matcherExact / commandShapeExact / assetSettingsConsistent computed from the marker group
remediation   = deterministic, sorted strings derived ONLY from the states above
                (e.g. asset absent → "run install (Slice 3)"; edited-managed → "repair --force";
                 foreign/partial-legacy → "manual review"; node <22 → "install Node 22")
healthy       = predicate above
return report
```

`detectNode()` reads `process.versions.node` for the running process and compares the major to
`22`; it performs no spawn and no host-policy probe (that inventory is Slice 4). The doctor is
read-only: it opens files only through `safe-read`, never writes, never creates directories.

## Pure / Impure Boundary

| Module | fs access | Responsibility |
|---|---|---|
| `claude-hook-settings.ts` | **none** | shape validation, canonical serialization + hash, legacy cohort recognition, removal/merge planning |
| `claude-hook-manager.ts` (Slice-2 subset) | `safeReadFile` for asset+settings; one private `lstat` helper for symlink/non-regular | asset hash classification, settings read+parse+delegate, Node check, doctor report assembly |
| `claude-hook-manager.ts` (Slice-3 seams) | **declared, unimplemented** | install/repair/backup/temp/fsync/ACL/rename/rollback — commented `throw new Error("Slice 3")` stubs |

The manager never `JSON.parse`s inside the settings module and the settings module never
reads a file — this is the enforced invariant that makes both trivially testable and prevents
Slice-3 drift.

## Slice-3 and Slice-4 Seams

**Slice-3 seams (declared here, unimplemented):** in `claude-hook-manager.ts`, export
signatures only, each body a commented `throw new Error("unimplemented: Slice 3
transaction")`:

```ts
export function installClaudePreToolUse(projectDir: string): Promise<ClaudeHookMutationResult>;
export function repairClaudePreToolUse(projectDir: string, o?: { force?: boolean }): Promise<ClaudeHookMutationResult>;
```

`planManagedClaudeHookRemoval` / `planManagedClaudeHookMerge` are **implemented** (pure) in
`claude-hook-settings.ts` this slice; only their *execution* is a Slice-3 seam. Slice 3 grows
the manager in place — it does not move Slice-2 code.

**Slice-4 seams (not touched here):** `src/cli/dispatch/hooks.tsx` (dispatch route),
`src/commands/init/steps/security.ts` (init rewiring), `src/cli/help.ts` (help text), and the
`execution` field + RUNNABLE/BLOCKED/INCONCLUSIVE matrix + exit codes on the report. The
report struct reserves the `execution` slot but omits it in Slice 2.

## File Changes

Forecast against current `main`. Estimates include tests and fixtures.

| File | Action | Lines | Description |
|---|---|---:|---|
| `src/lib/claude-hook-settings.ts` | Create | ~175 | Pure: shape validation, `canonicalizeSettingsEntry` (Decision ②), canonical hash, `classifySettingsEntry`, `classifyLegacy` + `matchesLegacyCohort` (deep-equal), `planManagedClaudeHookRemoval`/`planManagedClaudeHookMerge` (planning only). Frozen legacy cohort fixtures + `MANAGED_STATUS_PREFIX`/`ASSET_SHA_PLACEHOLDER`/`LEGACY_FILE_SHA256` constants. |
| `src/lib/claude-hook-settings.test.ts` | Create | ~205 | Table-driven: every settings state; full cohort; partial (1/2/3-member); duplicate member; one-byte-edited member; mixed-handler group; multiple markers; marker-in-invalid-container; malformed shapes; Decision-② asset-SHA-rotation invariance; canonical key-order/placeholder stability; removal/merge plan preservation of siblings. |
| `src/lib/claude-hook-manager.ts` | Create (read-only subset) | ~130 | `classifyAssetState` (lstat + `safeReadFile` + always-recompute hash), settings read+parse wrapper, `detectNode`, `doctorClaudePreToolUse`, report struct + `healthy` predicate. Slice-3 install/repair exported as commented unimplemented seams. |
| `src/lib/claude-hook-manager.test.ts` | Create | ~145 | Real-tmpdir fixtures per asset state (absent/current/outdated/edited/foreign/binary/too-large/symlink/non-regular); doctor report shape; `healthy` truth table; `assetSettingsConsistent` under asset rotation; Node-version branch injected. No mutation asserted. |
| `src/lib/__fixtures__/claude-hook-ownership.ts` | Create | ~70 | Shared frozen fixtures: exact managed handler group, current/historical canonical hashes, legacy 4-object cohort, one-byte-edited + duplicate variants. |
| `assets/claude-hooks/manifest.json` | Modify | ~1 | Populate `settingsEntries.current = { version: 1, canonicalSha256 }`. |
| `src/__tests__/claude-hook-assets.test.ts` | Modify | ~4 | Update `:43` `toMatchObject` from `current: null` to the populated shape; add append-only settings-entry released-snapshot guard mirroring `hook-assets.test.ts`. |

**Forecast total: ~730 changed lines** (within the proposal's 650–750 envelope; tests and
fixtures included, not treated as "free").

## Work-Unit Split (each < 400 lines; single PR < 800)

One chained PR off `main` (~730 lines < 800). Four work units, each < 400 and each keeping
behavior with its own tests in the same PR:

| WU | Files | Lines | Boundary |
|---|---|---:|---|
| A | `claude-hook-settings.ts` + `__fixtures__/claude-hook-ownership.ts` | ~245 | Pure recognition + canonical identity + legacy + planners; no I/O. |
| B | `claude-hook-settings.test.ts` | ~205 | Every settings state × cohort variant; Decision-② invariance. |
| C | `claude-hook-manager.ts` + `manifest.json` + `claude-hook-assets.test.ts` edits | ~135 | Read-only asset classification + doctor; manifest populate + append-only guard. |
| D | `claude-hook-manager.test.ts` | ~145 | Real-tmpdir asset states + doctor report + `healthy` truth table. |

Behavior and its tests never split into a later unprotected PR. If WU-A crosses 400 before
review, split the planners into their own unit — never move tests forward.

## Security and Complexity Boundaries

- **Read-only.** No filesystem mutation, no directory creation, no CLI route, no init wiring.
  The only fs surface is `safeReadFile` (bounded, non-throwing, binary-rejecting) plus one
  isolated `lstat` for symlink/non-regular detection. All transaction/ACL/rename/backup logic
  is a Slice-3 seam.
- **Always-recompute identity.** No claimed marker hash is ever trusted; state is decided by
  recomputed SHA (asset) and recomputed canonical hash (settings). Similar foreign content
  stays foreign.
- **Exact legacy only.** Whole-file SHA `b4638222…` or complete 4-object cohort by deep
  structural equality. Partial/duplicate/edited cohorts are `foreign` (partial-legacy) and are
  never migrated — the High-severity false-positive risk is closed by fixtures for every
  cohort variant.
- **Host-independent identity.** No `process.platform` branching for classification or
  canonicalization; `${CLAUDE_PROJECT_DIR}` stays a literal placeholder, mirroring the
  runtime's lexical path folding. Windows/macOS ACL and secure-object concerns belong to the
  Slice-3 mutator, not this recognition layer.
- **Bounded reads.** Asset and settings reads inherit `safe-read`'s 1 MiB budget and binary
  rejection; an oversized/binary/too-large read classifies as `foreign`/`non-regular`, never a
  false `managed-current`.
- **Append-only released snapshot.** The settings-entry historical list can only grow at its
  tail; a reviewer must see any deletion. This is the fleet-brick guard for settings identity,
  analogous to the Git-hook manifest guard.

## Testing Strategy (design intent; TDD in tasks phase)

Offline, deterministic, table-driven, no sleeps. Pure settings tests run in-memory with frozen
fixtures. Manager tests use `mkdtemp` real directories for asset lstat/read states
(symlink/non-regular created with `fs.symlinkSync`/`mkfifoSync`-equivalent or a directory),
inject the Node version for the `>=22` branch, and assert the doctor report never writes. The
Decision-② invariance test hashes the same canonical entry against two different asset SHAs
and asserts one `canonicalSha256`. The append-only guard test asserts
`manifest.settingsEntries.historical` starts with `RELEASED_SETTINGS_SNAPSHOT`.

## Open Questions

None. Approach 1, Decision ①, and Decision ② are locked; the 9 states, canonical serialization
rules, legacy recognizer, report struct, `healthy` predicate, manifest shape, and slice seams
are fixed by this design.

## Post-Apply Reconciliation (2026-08-16)

- **Spec R2 overrides design Algorithm C (settings fallthrough).** Implementation
  follows the authoritative spec: a content-bearing unmarked `PreToolUse` handler
  that is not the exact v0 legacy cohort classifies as `foreign`; only zero managed
  PreToolUse handler content classifies as `absent`. `design.md` Algorithm C's
  `absent` fallthrough is superseded by this note.
- **Slice-3 defense-in-depth notes (from the read-only review, both `info`):**
  1. `canonicalizeSettingsEntry` rebuilds the handler from the fixed 5-key allow-list
     and drops unknown handler keys — identity is STRUCTURAL, not byte-exact. Slice 3
     must not treat `managed-current` as a byte guarantee. Inert here: command/args are
     pinned to `node` + the managed asset arg, so no foreign command can execute.
  2. A `statusMessage` embedding the literal `<ASSET_SHA256>` placeholder collides to
     `managed-current` (Decision ②), but only with the exact managed matcher/command/
     args/timeout, so the handler still invokes the legitimate asset; effect is limited
     to `assetSettingsConsistent=false` (advisory, not part of `healthy`).
