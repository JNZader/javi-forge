# Design: SkillGuard Transactional Install/Repair (POSIX write path — Slice 3a)

## Technical Approach

Slice 2 shipped exact-state recognition (`classifyAssetState`, `classifySettingsFile`,
`doctorClaudePreToolUse`) and the pure planners (`planManagedClaudeHookMerge`,
`planManagedClaudeHookRemoval`, `canonicalizeSettingsEntry`) but left both mutation seams
throwing `unimplemented: Slice 3 transaction` (`src/lib/claude-hook-manager.ts:403-414`).
Slice 3a makes those two seams real on Linux and macOS.

The write side is split into four responsibilities:

- The **Slice-2 settings module `src/lib/claude-hook-settings.ts` grows in place** with the
  pure, tested *plan helpers the write path needs but Slice 2 never supplied*. The reused
  Slice-2 planners (`planManagedClaudeHookMerge`, `planManagedClaudeHookRemoval`) deliberately
  refuse `exact-legacy` and `edited-managed` and expose no cohort array positions, and
  `readSettings` returns terminal states (`absent`, whole-file `exact-legacy`) with **no parsed
  value**. Slice 3a closes that gap with three new pure helpers: a **cohort-excision plan** for
  embedded `exact-legacy` (locate the four cohort objects via the reused `LEGACY_COHORT` +
  `deepStructuralEqual` primitives, return the precise object indices to remove and the
  insertion point for the managed group, preserve every non-cohort sibling), a **force-replace
  plan** for `edited-managed` (keyed on matcher exactness per the parent contract §324: when the
  group matcher is the exact `MANAGED_MATCHER`, replace the marker-proven handler in place at its
  array index regardless of siblings; refuse under force ONLY when the matcher is edited AND the
  group carries ≥1 unrelated sibling; exposes a matcher-exact flag plus a sibling count so the
  manager can enforce that distinction), and **container synthesis** for the terminal states that
  still mutate (fresh install and whole-file `exact-legacy` build a fresh
  `{hooks:{PreToolUse:[managedGroup]}}`).
  These helpers do **not** duplicate or alter `classifyLegacy`/`classifySettingsEntry`
  semantics (a spec Non-Goal) — they consume the same exported primitives.
- A **new dedicated module `src/lib/secure-fs-transaction.ts`** owns all irreversible I/O:
  the parent-chain gate, one-segment directory creation, same-directory exclusive backups,
  same-directory temp + fsync + exact-mode + rename commit, and guarded reverse-order
  rollback. It defines and consumes a **`PlatformSecureFs`** adapter interface so every
  ownership/identity/ACL/exclusive-create decision is delegated to an injected, host-specific
  implementation. The module never spawns a process and never branches on `process.platform`.
- The **POSIX adapter file `src/lib/secure-fs-posix.ts`** implements
  `PlatformSecureFs` twice — Linux (`getfacl`) and macOS (`/bin/ls -lde`) — behind one
  factory. It is the only place a shell tool runs and the only place `os`/`fs` ownership
  bits are interpreted.
- The **manager (`src/lib/claude-hook-manager.ts`) stays a thin orchestrator with an injection
  seam**: an internal deps-taking entry (`_run`) accepts `{ secureFs, clock, nonce, ... }`; the
  public `installClaudePreToolUse(projectDir)` and `repairClaudePreToolUse(projectDir,{force})`
  call it with the real deps (`selectSecureFs(process.platform)`, a real clock, a real 8-hex
  nonce). `_run` classifies both components with the Slice-2 read layer, computes the plan with
  the Slice-2 planners **plus the new plan helpers**, synthesizes the desired bytes, runs the
  transaction, and assembles the `ClaudeHookMutationResult`. Tests call `_run` directly with a
  **fake `PlatformSecureFs`**, exercising the full state→action matrix host-independently.
  Slice-2 code **grows in place**; no classifier or planner logic is relocated or duplicated.

The transaction core is platform-agnostic and host-independent-testable: `clock`, an
8-lowercase-hex `nonce` source, and the entire `PlatformSecureFs` adapter are injectable, so
identity/ACL/tool/handle/rename faults are exercised deterministically without root or a
special host. This maps to the archived parent design's Decision 5 (private parent chain +
staged two-target transaction), Decision 6 (JSON value/byte preservation), and Decision 7
(removal primitive but no uninstall dispatch). No CLI dispatch, init wiring,
effective-execution matrix, uninstall command, or Windows secure-object helper is introduced
here (Slices 3b and 4).

## Scope Recap (Locked)

- **Approach 2**: dedicated transaction module + `PlatformSecureFs` interface; manager is the
  orchestrator. Slice-2 code grows in place.
- **3a = POSIX adapters only.** The `PlatformSecureFs` interface is defined here; the Windows
  implementation is deferred to Slice 3b. On Windows, install/repair returns a fixed refusal
  `windows-secure-object-unavailable` with **zero mutation**.
- **Reconcile `ClaudeHookMutationResult`**: add `report: ClaudeHookDoctorReport`.
- **Non-goals (3b)**: Windows `.ps1` helper, `installerHelpers.windowsSecureObject` manifest
  binding, `package:check` gate for it, Windows `manager` CI job + DACL/reparse/network tests.
- **Non-goals (4)**: CLI dispatch, `init` rewiring, effective-execution RUNNABLE/BLOCKED/
  INCONCLUSIVE matrix, uninstall command.

## Architecture Decisions

### Decision 1: A `PlatformSecureFs` adapter is the whole platform boundary

**Choice**: The transaction core talks only to a `PlatformSecureFs` interface. Every operation
that depends on the host — opening a directory without following symlinks and capturing its
`dev`+`ino` identity, revalidating a reopened path against a held identity, proving
ownership + absence of group/other write bits, proving absence of any extended/named/mask/
default/inherited ACL, exclusively creating a directory or file with a restrictive mode,
writing + syncing a handle, applying + verifying the exact prior mode, renaming within a
directory, and fsyncing a directory — is a method on that interface. The concrete adapter is
selected once by the manager (`process.platform === "linux" | "darwin"` → POSIX factory;
`"win32"` → refusing stub) and injected into the transaction.

**Alternatives considered**: branch on `process.platform` inline in the transaction core;
keep the write logic in the manager as `ci.ts` does for Git hooks; expose only free functions
and let the transaction call `node:fs` directly.

**Rationale**: the parent design already declares the security boundary is the *parent-chain
gate*, not portable `openat`/`renameat` (Node has neither). Concentrating that gate behind
one interface means (a) the irreversible-I/O algorithm is reviewed once, platform-free; (b) the
POSIX adapter is the single audited place `getfacl`/`/bin/ls -lde` runs; (c) tests inject a
fully synchronous fake adapter to drive every fault branch without root or a special
filesystem; and (d) Slice 3b adds Windows by implementing the same interface — no core
change. The `ci.ts` `writeHookFile`/`backupHook` pattern (fd-based `O_NOFOLLOW`, `COPYFILE_EXCL`,
`fchmod` on the FD) is the **stylistic** model for fd-not-path safety, but it is an in-place
truncate with no temp+rename, no fsync, no parent gate, and no ACL proof — it is mirrored for
idiom, never reused as a function.

### Decision 2: POSIX ACL absence is proven by a fail-closed external tool, never assumed

**Choice**: Node has no portable POSIX ACL API. The POSIX adapter proves ACL absence by
running a bounded, `LC_ALL=C` external tool and refusing on anything it cannot parse as a
clean, minimal ACL:

- **Linux**: `getfacl --absolute-names --numeric --omit-header -- <path>`. Refuse
  (`unsupported-posix-acl`) if the executable is absent, the exit code is non-zero, the call
  times out, the output cannot be parsed, or any line is a named `user:<id>:`, named
  `group:<id>:`, `mask::`, or `default:` entry. Only the three base entries
  (`user::`, `group::`, `other::`) are acceptable.
- **macOS**: `/bin/ls -lde -- <path>`. Refuse if the tool is absent/non-zero/timed-out, the
  output cannot be parsed, or any numbered ACE line (`N: ...allow/deny...`) or inherited entry
  is present. Only the mode string with no trailing `+` and no listed ACEs is acceptable.

Both run with `LC_ALL=C`/`LANG=C`, a bounded timeout, `argv` (never a shell string), and are
re-read immediately before commit; a changed result between preflight and commit refuses.

**Alternatives considered**: degrade to mode-bits-only when the tool is missing; strip the ACL
with `setfacl -b`/`chmod -N`; trust `stat` mode bits alone; skip ACL proof on "trusted"
directories.

**Rationale**: a source or parent bearing an extended ACL can grant an outside principal
write/rename/delete that mode bits do not reveal; silently degrading to mode-only would let a
backup/replacement be *broader* than the source and would defeat the private-chain guarantee.
Stripping an ACL mutates the user's security posture without consent. Fail-closed
(`unsupported-posix-acl`) on any inconclusive state — with actionable remediation to move to a
private `0700`-ancestor tree — is the honest boundary. This is an accepted residual: shared/CI
trees with named ACLs refuse rather than get a weaker write.

### Decision 3: Held no-follow chain + `dev`+`ino` revalidation is the gate; drift is detected, the double-swap attacker is excluded by ownership

**Choice**: Before any mutation the transaction opens a no-follow directory handle for every
existing directory from the filesystem root through each target's parent, captures each
handle's `dev`+`ino`, and requires each controlling directory to be owned by the effective uid
or root with no group/other write bits and proven ACL absence. Immediately before **and** after
every pathname mutation (segment creation, backup create, temp create, rename), it reopens each
path and revalidates the held identity. Any mismatch aborts (before commit) or **stops for
manual recovery** (after a target byte has been written).

**Alternatives considered**: two `lstat` calls around each op as "proof"; dirfd-relative
`renameat` (unavailable in Node); trust the first open for the whole transaction.

**Rationale**: holding a `FileHandle` and comparing `dev`+`ino` reliably detects accidental or
concurrent change, but does **not** by itself stop an attacker who swaps the parent out and
back between two observations. The design therefore does not claim portable race-free
dirfd-relative replacement. Its real boundary is the ownership + no-group/other-write + ACL
gate, which excludes every principal outside the trusted set (effective uid + root) from
renaming/creating/deleting a traversed entry. Malicious same-user or root processes, kernel/
filesystem faults, and hard crashes are documented residuals — no `node:fs` design can make
parent creation plus two file renames one filesystem transaction.

### Decision 4: One-segment exclusive `0o700` directory creation; never blind recursive mkdir

**Choice**: A fresh install creates missing `.claude` then `.claude/hooks` one segment at a
time. Each segment is created through the parent's validated handle with an exclusive create at
mode `0o700`, then reopened no-follow, ownership/mode/ACL-verified, and added to the held chain
before the next segment. These directory creations are recorded as the transaction's first
mutations. `fs.mkdir({ recursive: true })` is never used.

**Alternatives considered**: `mkdir -p`/recursive mkdir then chmod; create at default umask
then tighten.

**Rationale**: recursive mkdir cannot prove each intermediate was created (not pre-existing and
hijacked) and briefly leaves a directory at the umask before tightening — a window where an
outside principal could enter. Segment-at-a-time exclusive `0o700` creation with immediate
re-verification is the only way to keep the private-chain invariant true for directories the
transaction itself introduces, and it is exactly what rollback must be able to reverse
(identity-matched empty removal only).

### Decision 5: Persistent backups are forced-only; routine ops roll back from captured prior bytes + a transient rollback-temp

**Choice**: A **persistent** backup
`<basename>.javi-forge.bak.<YYYYMMDDTHHMMSSmmmZ>.<8-lowercase-hex>` is created **only** for a
forced operation — i.e. `repair --force` over an `edited-managed` component. It is created in
the source's own directory with `O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW` at mode `0o600`, with a
bounded 8-candidate nonce retry; no byte is written until the restrictive exclusive create
succeeds. Only these forced backups populate `ClaudeHookMutationResult.backups[]`.

Routine mutations — `released-outdated`→upgrade and `exact-legacy`→migrate — do **not** leave a
persistent artifact. They restore, if a later step fails, from the **in-memory prior bytes
captured through the gate** (`CapturedFile.bytes` + `.mode`), written back through a **transient
same-directory rollback-temp** `<basename>.javi-forge.tmp.<pid>.<8-lowercase-hex>` +
exact-mode + fsync + rename (the parent contract's rollback step). The rollback-temp is
transient: it exists only for the restore rename and is never reported in `backups[]`.

Regardless of persistence tier, before any backup, replacement, or rollback the adapter proves
the source has no extended ACL and the parent has no default/inheritable ACL; every created
file (persistent backup, staging temp, rollback-temp) is exclusively created no-follow at
`0o600`, has the exact prior mode applied and re-verified (mode + ACL absence), and so is
always equal to or narrower than the source. Staging temps use the same
`<basename>.javi-forge.tmp.<pid>.<8-lowercase-hex>` name family. The clock and nonce are
injected.

**Alternatives considered**: persist a `.bak` for *every* mutation (the earlier draft — rejected
by JD-004); `<base>.bak` single name (as `ci.ts`); `COPYFILE_EXCL` copy; write then `chmod`; a
system temp dir + cross-directory rename; hold no prior bytes and rely on the on-disk backup for
rollback.

**Rationale**: JD-004 confirmed that a persistent `.bak` on every routine upgrade/migrate
litters the project directory and mildly enlarges the security surface (extra `0o600` copies of
managed content) for no user benefit — the pre-operation bytes are already captured in memory
through the gate, so a transient rollback-temp is sufficient to restore atomically. Persistence
is reserved for the one case a user genuinely wants a recoverable artifact: `--force` over a
component they *edited*. Same-millisecond collisions and clobbering an earlier backup remain
impossible with exclusive create + nonce retry (the `ci.ts` `backupHook` idiom, hardened with a
millisecond+nonce name and ACL proof). Same-directory staging is required because a
cross-filesystem rename is not atomic and a system-temp path escapes the proven private chain.
Writing bytes only after a `0o600` exclusive create means no artifact is ever world-readable.
`ci.ts` copies original bytes (never a utf8 round-trip) for arbitrary hooks; here the asset and
settings are UTF-8 text we already parse, so the transaction restores the exact prior bytes
captured through the gate.

### Decision 6: Commit asset first, settings second; guarded reverse-order rollback stops on lost proof

**Choice**: The transaction stages all temps and backups, then commits with same-directory
rename: **asset first, settings second**, parent-fsync after each. If a later step fails while
the committed target still matches the transaction's written hash and the full gate is still
valid, it rolls back in reverse order — restoring prior bytes/mode (or unlinking a
previously-absent target) via another restrictively-created, verified, fsynced same-directory
temp+rename — and removes only transaction-created directories that are still identity-matched
and empty. If proof is lost (held identity changed) or the target's current hash no longer
matches what the transaction wrote (a concurrent post-write edit), automatic rollback **stops**
and returns manual-recovery guidance rather than clobbering the change.

**Alternatives considered**: settings first; best-effort per-target; rely on backups only;
force-restore over a changed target.

**Rationale**: asset-first avoids a normally-observable settings entry pointing at a missing
asset. Cross-file atomicity is unavailable, so a two-target commit can leave one component
committed on a hard failure; guarded rollback minimizes that window and component-level doctor
reports the residual partial state. Stopping on lost proof is the safety-over-completeness
choice: never overwrite a concurrent user edit to "finish" a rollback.

### Decision 7: Settings re-serialization preserves unrelated keys/order; the no-op path writes zero bytes

**Choice**: The Slice-2 pure planners return an action + indices against the *parsed* value;
the writer re-parses the on-disk bytes, applies the plan by cloning only the relevant
object/arrays, and serializes the complete container with `JSON.stringify(value, null, 2) + "\n"`
(the repository convention), preserving every unrelated key, handler, and insertion order. A
`managed-current` component (settings `noop` action + asset `managed-current`) performs **no
serialization and no write** — bytes and mtime are preserved exactly. The asset is installed by
copying the packaged bytes from `CLAUDE_HOOK_ASSETS_DIR/<ASSET_NAME>` verbatim; `managed-current`
asset writes nothing.

**Alternatives considered**: byte-range JSON editing; wholesale settings replacement; stringify
even on no-op.

**Rationale**: strict project settings have no comments to preserve and the spec requires
unrelated-value preservation plus complete-byte idempotence on the current path — not arbitrary
whitespace retention after a real mutation. Canonicalization (Slice 2) drops unknown handler
keys and normalizes the asset-SHA token, so the *identity* is structural; the *writer* must emit
the full container, never the canonical form. A source-range editor would materially enlarge a
security-sensitive slice for no required benefit.

### Decision 8: The settings write path is three new pure plan helpers in the Slice-2 module

**Choice**: The Slice-2 planners cover only `absent`→install, `managed-current`→noop, and
`released-outdated`→replace against a *parsed value*. Every remaining mutating settings state
was left to Slice 3a. Rather than teach the manager to compute array positions inline (which
would fork the cohort/marker logic the classifier owns), `claude-hook-settings.ts` **grows in
place** with three pure, individually tested helpers that reuse the module's own exported
primitives and never re-implement `classifyLegacy`/`classifySettingsEntry` (a spec Non-Goal):

1. **`planLegacyCohortExcision(parsed)`** — for embedded `exact-legacy`. It relocates
   the exact four cohort objects by running `deepStructuralEqual` against the reused
   `LEGACY_COHORT.{L1,L2,L3}` in `hooks.PreToolUse` and `LEGACY_COHORT.L4` in `hooks.PostToolUse`
   (the *same* primitives `classifyLegacy` uses — imported, not copied). It returns the precise
   object indices to remove per event and the insertion point (append) for the freshly built
   managed `PreToolUse` group, and asserts (via the classifier) that the cohort is the complete
   proven four-object set; a partial/duplicate/edited cohort is never reached here because the
   classifier already routed it to `foreign`. Every non-cohort sibling in either event array is
   preserved by index.

2. **`planForceReplace(parsed, currentAssetSha, identities)`** — for `edited-managed` under
   `--force`. It resolves the single marker-proven handler's `groupIndex`/`handlerIndex` and —
   honoring the parent contract (archived design §324) — **keys eligibility on MATCHER
   EXACTNESS**, not on sibling count. It compares the enclosing group's matcher to the exact
   `MANAGED_MATCHER` and **exposes both a `matcherExact` flag and a `siblingHandlers` count** so
   the manager can enforce the §324 rule precisely:
   - **Matcher is exact** → eligible **regardless of siblings**. Force replaces *only* the
     marker-proven handler in place at its array index; the matcher is preserved and every
     sibling handler is preserved byte-for-value. This is the common repair-`--force` case and it
     is NOT refused when siblings exist.
   - **Matcher is edited (not the exact `MANAGED_MATCHER`) AND `siblingHandlers > 0`** → the
     helper returns `refused` even under `--force`, because replacing or rewriting the whole group
     would change those unrelated handlers' execution scope (§324: "even `--force` refuses").
   - **Matcher is edited AND `siblingHandlers === 0`** (the group holds exactly the one
     marker-proven handler) → eligible; force replaces the handler in place.
   When eligible it returns the in-place handler replacement position (matcher preserved, group +
   siblings preserved). This corrects the earlier over-refusal (JD-A-001): the previous draft
   made `siblingHandlers === 0` an unconditional gate, which contradicted §324 by refusing the
   exact-matcher-with-siblings case that force is explicitly required to replace in place. It also
   closes WARNING JD-005 (the matcher-exactness + sibling distinction is now exposed and
   enforceable).

3. **`buildManagedContainer(currentAssetSha)`** — container synthesis for the two terminal states
   that still mutate but have **no parsed value**: fresh install (settings `absent`) and whole-file
   `exact-legacy` (the entire file *is* the cohort). It takes only the current asset SHA
   (`manifest.asset.sha256`) — NOT the whole `Manifest` — so `claude-hook-settings.ts` never
   depends on the manager's manifest reader at runtime (JD-A-002: avoids a settings→manager
   runtime import cycle; if a `Manifest` reference is unavoidable elsewhere it is a **type-only**
   import). It returns a complete fresh container `{ hooks: { PreToolUse: [ managedGroup ] } }`
   built from the current settings-entry SHA. Whole-file legacy is therefore *replaced by a
   managed-only container* (there is nothing else to preserve — the file was 100% legacy). This
   wholesale replacement is safe because the shipped legacy scaffold
   (`templates/security-hooks/claude-settings-security.json`, SHA
   `b4638222ecddc2daac6ec3339596d853a626906bbd1233d789d80a319325c68d`) has **no non-cohort
   top-level keys** — a whole-file `exact-legacy` match proves the file is 100% the four-object
   cohort, so nothing outside the cohort is discarded (JD-A-004). The manager MUST call this
   instead of ever feeding `undefined` (the terminal-state read result) to a merge planner.

**Alternatives considered**: compute cohort indices in the manager; extend the existing
`planManagedClaudeHookMerge` to accept legacy/edited/force (overloading a planner whose contract
is "refuse everything else"); a single mega-planner returning a discriminated union for all
states; have the manager synthesize the container inline.

**Rationale**: the array-position and cohort-membership logic belongs next to the primitives that
define it (`LEGACY_COHORT`, `deepStructuralEqual`, the marker finder) so there is exactly one
source of structural truth and the manager stays an orchestrator. Keeping them as *separate*
pure functions (not an overload of the Slice-2 planner) preserves the Slice-2 planners'
verified "refuse edited/legacy/force" contract untouched and lets each new helper be unit-tested
in isolation against crafted parsed values, no filesystem required. This is the load-bearing fix
for CRITICAL-1: the migrate / force-replace / fresh-install / whole-file-legacy write paths now
have concrete, tested plan producers instead of a gap.

## Data Model

### New settings write-plan helpers (grown in `claude-hook-settings.ts`)

```ts
/** Cohort-excision plan for embedded exact-legacy. */
export interface LegacyCohortExcisionPlan {
  refused: boolean;
  reason?: string;
  /** Indices to remove from hooks.PreToolUse (L1..L3 matches), ascending. */
  removePreIndices: number[];
  /** Indices to remove from hooks.PostToolUse (L4 match), ascending. */
  removePostIndices: number[];
  /** Append position for the freshly built managed PreToolUse group. */
  insertPreAt: number;
}
export function planLegacyCohortExcision(
  parsed: unknown,
): LegacyCohortExcisionPlan;   // reuses LEGACY_COHORT + deepStructuralEqual; never re-derives classify
                               // (no identities param — JD-A-003; cohort identity is the fixed LEGACY_COHORT)

/**
 * Force-replace plan for edited-managed. Eligibility keys on MATCHER EXACTNESS (§324), not
 * unconditionally on sibling count. Exposes matcherExact + siblingHandlers so the manager can
 * enforce the exact §324 rule.
 */
export interface ForceReplacePlan {
  refused: boolean;
  reason?: string;                 // set only when matcher edited AND siblingHandlers > 0
  state: ClaudeHookComponentState; // edited-managed when eligible
  groupIndex?: number;
  handlerIndex?: number;
  matcherExact?: boolean;          // true => group matcher === MANAGED_MATCHER
  siblingHandlers?: number;        // count of unrelated handlers in the group
  // Eligibility: matcherExact === true  -> eligible regardless of siblingHandlers (replace in place)
  //              matcherExact === false && siblingHandlers === 0 -> eligible (replace in place)
  //              matcherExact === false && siblingHandlers  >  0 -> refused even under --force
}
export function planForceReplace(
  parsed: unknown,
  currentAssetSha: string,
): ForceReplacePlan;

/**
 * Container synthesis for terminal states with no parsed value (fresh install, whole-file legacy).
 * Takes only the current asset SHA, not the whole Manifest, to avoid a settings->manager runtime
 * import cycle (JD-A-002).
 */
export function buildManagedContainer(currentAssetSha: string): {
  hooks: { PreToolUse: [ManagedMatcherGroup] };
};
```

`planLegacyCohortExcision` and `planForceReplace` are the write-plan producers the Slice-2
`planManagedClaudeHookMerge` explicitly refuses; `buildManagedContainer` is what the manager
feeds the writer when `readSettings` returned a terminal state (`absent` / whole-file
`exact-legacy`) and there is no parsed value to merge into.

### `PlatformSecureFs` interface (defined in `secure-fs-transaction.ts`)

```ts
/** Identity of an opened directory/file, captured from its handle. */
export interface SecureIdentity {
  dev: number;
  ino: number;
}

/** A held, no-follow directory handle plus its captured identity and path. */
export interface SecureDirHandle {
  readonly path: string;
  readonly identity: SecureIdentity;
  close(): Promise<void>;
}

/** Captured prior state of a target file, taken through the validated gate. */
export interface CapturedFile {
  bytes: Buffer;
  mode: number;        // exact source mode, e.g. 0o600 / 0o644
  identity: SecureIdentity;
  sha256: string;
}

export type SecureRefusal =
  | "unsafe-parent-chain"          // owner/mode/identity/handle proof failed
  | "unsupported-posix-acl"        // ACL tool absent/parse/timeout/extended/changed
  | "windows-secure-object-unavailable"; // 3a Windows stub only

export interface SecureResult<T> {
  ok: boolean;
  value?: T;
  refusal?: SecureRefusal;
  detail?: string;    // first offending path/capability, never secret content
}

export interface PlatformSecureFs {
  /** Open an existing directory no-follow (O_DIRECTORY|O_NOFOLLOW) and capture dev+ino. */
  openDirNoFollow(dirPath: string): Promise<SecureResult<SecureDirHandle>>;

  /** Reopen a path and confirm its identity equals a previously held one. */
  revalidateIdentity(target: string, held: SecureIdentity): Promise<SecureResult<void>>;

  /** Prove owner == effective uid or root AND no group/other write bits. */
  proveOwnershipAndMode(dirPath: string): Promise<SecureResult<void>>;

  /** Prove no extended/named/mask/default/inherited ACL on the path. */
  proveNoExtendedAcl(target: string): Promise<SecureResult<void>>;

  /** Create ONE child directory exclusively at mode, reopen+verify, return its handle. */
  createDirExclusive(
    parent: SecureDirHandle, name: string, mode: number,
  ): Promise<SecureResult<SecureDirHandle>>;

  /**
   * Capture a regular file's bytes+mode+identity+sha through the validated gate.
   * MUST open the target with `O_NOFOLLOW|O_RDONLY` (never a plain path read): a
   * symlink swapped in at the target name must fail the open, not be dereferenced.
   * This is a security boundary (JD-B-003) — the capture is the source of both the
   * persistent backup and the in-memory rollback bytes, so it must never follow a link.
   */
  captureFile(target: string): Promise<SecureResult<CapturedFile>>;

  /**
   * Create <name> in dir with O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW at mode; write bytes;
   * `handle.sync()` (fsync) the file before close. The write and the fsync are one
   * method so an fsync fault is an injectable fault point of `writeExclusive` itself
   * (JD-B-004): a fake can succeed the write and fail the sync to drive that branch.
   */
  writeExclusive(
    dir: SecureDirHandle, name: string, bytes: Buffer, mode: number,
  ): Promise<SecureResult<void>>;

  /** Apply an exact mode to an existing staged file and re-verify mode + ACL absence. */
  applyExactMode(target: string, mode: number): Promise<SecureResult<void>>;

  /** Same-directory rename from -> to, then fsync the directory. */
  renameInDir(dir: SecureDirHandle, from: string, to: string): Promise<SecureResult<void>>;

  /** Unlink an identity-matched file (rollback of a newly created target). */
  unlinkIfIdentity(dir: SecureDirHandle, name: string, held: SecureIdentity): Promise<SecureResult<void>>;

  /** Remove an identity-matched EMPTY directory (rollback of a created segment). */
  rmdirIfIdentityEmpty(handle: SecureDirHandle): Promise<SecureResult<void>>;
}
```

### Injected seams

```ts
export interface TransactionDeps {
  secureFs: PlatformSecureFs;             // POSIX now, Windows stub, fake in tests
  clock: () => Date;                      // backup/temp timestamp
  nonce: () => string;                    // 8 lowercase hex
}
```

Tests supply a synchronous in-memory `PlatformSecureFs` fake whose per-method fault points
(identity mismatch on the Nth revalidate, ACL refusal, exclusive-create `EEXIST`, rename
failure, post-write hash drift) are toggled per case — no root, no real filesystem, no host
ACL tool.

### POSIX adapter factory (in `secure-fs-posix.ts`)

```ts
export interface PosixAclAdapter {
  /** Run the bounded, LC_ALL=C ACL tool and decide clean|extended|inconclusive. */
  proveClean(target: string): Promise<SecureResult<void>>;
}

export function createLinuxAclAdapter(spawn?: SpawnFn): PosixAclAdapter;   // getfacl
export function createMacosAclAdapter(spawn?: SpawnFn): PosixAclAdapter;   // /bin/ls -lde
export function createPosixSecureFs(acl: PosixAclAdapter): PlatformSecureFs;
export function selectSecureFs(platform?: NodeJS.Platform): PlatformSecureFs | null;
// linux -> createPosixSecureFs(createLinuxAclAdapter())
// darwin -> createPosixSecureFs(createMacosAclAdapter())
// win32/other -> null  (manager returns windows-secure-object-unavailable, no mutation)
```

### Manager injection seam (in `claude-hook-manager.ts`)

The public entry points keep the exact signatures the parent contract fixes; a single internal
deps-taking entry is what tests drive. This is the CRITICAL-2 fix (JD-002): before this there was
no seam below the public functions, so the state→action matrix could not be exercised without a
real secure filesystem.

```ts
export interface ClaudeHookRunDeps {
  secureFs: PlatformSecureFs;          // real POSIX / Windows-stub in prod; FAKE in tests
  clock: () => Date;
  nonce: () => string;                 // 8 lowercase hex
  manifest?: Manifest;                 // injectable to avoid disk reads in tests
  platform?: NodeJS.Platform;          // defaults to process.platform
}

/** Internal, deps-taking. Tests call this with a fake PlatformSecureFs. */
export async function _run(
  projectDir: string,
  mode: "install" | "repair",
  options: { force?: boolean },
  deps: ClaudeHookRunDeps,
): Promise<ClaudeHookMutationResult>;

// Public signatures UNCHANGED from the parent contract — they build real deps and call _run:
export function installClaudePreToolUse(
  projectDir: string,
): Promise<ClaudeHookMutationResult>;             // _run(projectDir,"install",{}, realDeps)
export function repairClaudePreToolUse(
  projectDir: string, options?: { force?: boolean },
): Promise<ClaudeHookMutationResult>;             // _run(projectDir,"repair",options ?? {}, realDeps)

// realDeps = { secureFs: selectSecureFs(process.platform), clock: () => new Date(),
//              nonce: () => randomBytes(4).toString("hex"), platform: process.platform }
```

### Reconciled result type (in `claude-hook-manager.ts`)

```ts
export interface ClaudeHookMutationResult {
  ok: boolean;
  changed: string[];   // absolute paths actually written/renamed
  backups: string[];   // absolute PERSISTENT backup paths — FORCED ops only (Decision 5)
  report: ClaudeHookDoctorReport;  // ADDED: post-mutation doctor snapshot
  errors: string[];    // refusal/failure messages naming path + reason + remedy
}
```

`backups[]` is populated **only** by a forced `edited-managed` replacement. Routine
`released-outdated`→upgrade and `exact-legacy`→migrate leave `backups[]` empty; their rollback
safety comes from in-memory captured bytes + a transient rollback-temp (Decision 5).

## Algorithms (implementable pseudocode)

### A. Manager orchestration — `_run(projectDir, mode, options, deps)`

The public `installClaudePreToolUse`/`repairClaudePreToolUse` build the real deps and delegate to
`_run`; tests call `_run` with a fake `secureFs` (Decision: manager injection seam, JD-002).

```text
_run(projectDir, mode /* install | repair */, options, deps):
  { secureFs, clock, nonce } = deps
  secureFs = deps.secureFs ?? selectSecureFs(deps.platform ?? process.platform)
  manifest = deps.manifest ?? readManifest()
  assetSrcPath   = CLAUDE_HOOK_ASSETS_DIR / ASSET_NAME
  assetDestPath  = projectDir / .claude / hooks / ASSET_NAME
  settingsPath   = projectDir / .claude / settings.json

  # 1. classify both components with the Slice-2 read layer
  assetCls    = classifyAssetState(assetDestPath, manifest)
  settingsRaw = readSettings(settingsPath)          # parsed value OR terminal state (no value)
  settingsCls = ("state" in settingsRaw)            # 9-state
                ? settingsRaw.classification
                : classifySettingsEntry(settingsRaw.value, manifest.asset.sha256,
                                        manifest.settingsEntries)

  # 2. platform gate: Windows has no adapter in 3a
  if secureFs == null:
    return refuse("windows-secure-object-unavailable", report=doctor(projectDir))  # zero mutation

  # 3. resolve per-component action from the state->action matrix (see B), choosing the
  #    correct settings write-plan producer per state (Decision 8):
  #      absent (terminal)             -> buildManagedContainer(sha)              # container synth
  #      managed-current               -> noop
  #      released-outdated             -> planManagedClaudeHookMerge(...).replace  # in-place
  #      exact-legacy (whole-file)     -> buildManagedContainer(sha)              # 100% legacy file
  #      exact-legacy (embedded cohort)-> planLegacyCohortExcision(parsed)        # excise 4 + append
  #      edited-managed + repair --force -> planForceReplace(parsed, sha)         # eligibility keys
  #                                       on MATCHER EXACTNESS (§324): matcherExact -> replace in
  #                                       place regardless of siblings; matcher edited + siblings>0
  #                                       -> refuse even under --force
  #      foreign|symlink|non-regular|malformed|partial-legacy -> refuse
  actions = resolveActions(assetCls, settingsCls, settingsRaw, mode, options.force, manifest)
  if actions.refused:
    return refuse(actions.reason, report=doctor(projectDir))   # NO mutation
    # force-replace refuses here ONLY when matcher edited AND planForceReplace.siblingHandlers > 0
    # (§324); an exact matcher with siblings is replaced in place, not refused (JD-A-001)

  # 4. zero-write idempotent no-op: both components already current
  if actions.asset == "noop" and actions.settings == "noop":
    return { ok:true, changed:[], backups:[], errors:[], report:doctor(projectDir) }

  # 5. build the desired bytes (writer, Decisions 7 + 8)
  desiredAsset    = (actions.asset != "noop") ? readPackagedAssetBytes(assetSrcPath) : null
  desiredSettings = (actions.settings == "noop") ? null : serializeSettings(
      # apply the resolved plan; terminal states use the synthesized container, embedded
      # states clone the parsed value and apply excision/replace by the plan's indices:
      (actions.settings.kind == "container") ? actions.settings.container
                                             : applyPlan(settingsRaw.value, actions.settings))
      # JSON.stringify(container, null, 2) + "\n", unrelated keys/handlers/order preserved

  # 6. run the transaction (see C). `force` flags only the components that need a PERSISTENT backup.
  tx = runTransaction({
        secureFs, clock, nonce, projectDir,
        asset:    { path:assetDestPath,   capture:assetCls,    desired:desiredAsset,
                    forceBackup: actions.assetForced },     # true only for forced edited-managed
        settings: { path:settingsPath,    capture:settingsCls, desired:desiredSettings,
                    forceBackup: actions.settingsForced },
       })

  return {
    ok: tx.ok,
    changed: tx.committed,
    backups: tx.backups,         # populated only by forced ops (Decision 5)
    errors:  tx.errors,          # includes STOP-for-manual-recovery guidance if any
    report:  doctor(projectDir), # fresh post-mutation snapshot
  }
```

`repair` differs from `install` only in messaging and force eligibility: `--force` on
`edited-managed` is accepted when `planForceReplace` reports the group matcher is exact
(`matcherExact === true`, replace the marker-proven handler in place regardless of siblings) OR
the matcher is edited but the group holds only that one handler (`siblingHandlers === 0`) — and,
in either eligible case, an eligible byte-exact persistent backup is created. It is refused even
under `--force` only when the matcher is edited AND `siblingHandlers > 0` (§324). Neither mode can
force `foreign`, `symlink`, `non-regular`, `malformed`, or a partial-legacy cohort. `install`
never forces.

### B. State → action matrix (per component; mirrors the parent design)

```text
absent                    -> install   (settings: buildManagedContainer; asset: create file)
managed-current           -> noop      (zero write; bytes+mtime preserved)
released-outdated         -> upgrade   (settings: planManagedClaudeHookMerge replace in place;
                                        asset: replace bytes) — rollback via captured bytes + rollback-temp
exact-legacy (whole-file) -> migrate   (settings: buildManagedContainer — file is 100% legacy)
exact-legacy (embedded)   -> migrate   (settings: planLegacyCohortExcision — remove the 4 cohort
                                        objects by index, append managed group, preserve siblings)
edited-managed            -> refuse    (repair --force only; planForceReplace eligibility keys on
                                        MATCHER EXACTNESS (§324): matcherExact -> replace the
                                        marker-proven handler in place regardless of siblings;
                                        matcher edited + siblingHandlers==0 -> replace in place;
                                        matcher edited + siblingHandlers>0 -> refuse even under
                                        --force; eligible cases only after eligible byte-exact
                                        PERSISTENT backup)
foreign                   -> refuse
symlink                   -> refuse
non-regular               -> refuse
malformed                 -> refuse
partial-legacy            -> refuse    (reported foreign/partial-legacy by Slice 2)
```

Whole-file `exact-legacy` is the terminal `readSettings` state (`{state:"exact-legacy",
detail:"whole-file"}`, no parsed value) → `buildManagedContainer`. Embedded `exact-legacy` is a
parsed value whose `hooks` carry the complete four-object cohort → `planLegacyCohortExcision`.
Fresh install (`{state:"absent"}`, no parsed value) → `buildManagedContainer`. In every terminal
case the manager MUST synthesize a container and MUST NOT pass `undefined` to a merge planner.

`install` and `repair` plan BOTH components before mutating EITHER. A refusal on either
component refuses the whole operation with zero mutation.

### C. Transaction — `runTransaction`

```text
runTransaction(ctx):
  created = []        # SecureDirHandle for each segment this tx created
  backups = []        # { path, forDir, name, prior: CapturedFile }
  staged  = []        # { forDir, tempName, target: {path,name}, desired, mode }
  committed = []       # target paths successfully renamed, in commit order
  heldDirs = []        # SecureDirHandle for every existing ancestor

  try:
    # --- PREFLIGHT: parent-chain gate (Decision 3) -------------------------
    for dir in ancestorChain(root .. .claude .. .claude/hooks-parent, settings-parent):
      if dir exists:
        h = secureFs.openDirNoFollow(dir);            refuseIfNotOk(h)
        ok(secureFs.proveOwnershipAndMode(dir))
        ok(secureFs.proveNoExtendedAcl(dir))
        heldDirs.push(h)
      else mark as to-create

    # --- SEGMENT CREATION (Decision 4): .claude then .claude/hooks --------
    for seg in missingSegments (parent-to-child, one at a time):
      h = secureFs.createDirExclusive(parentHandle(seg), basename(seg), 0o700)
      refuseIfNotOk(h); created.push(h); heldDirs.push(h)

    # --- CAPTURE + (FORCED) BACKUP + STAGE (Decisions 5, 6) --------------
    for comp in [asset, settings] where comp.desired != null:
      dir = heldDir(parent(comp.path))
      revalidate(dir.identity)                          # before mutation
      prior = null
      if comp.capture.state in {released-outdated, exact-legacy}
         or (comp.forceBackup and comp.capture.state == edited-managed):
        # ALWAYS capture prior bytes in memory through the gate — this is the rollback source.
        # captureFile opens O_NOFOLLOW|O_RDONLY (JD-B-003).
        prior = secureFs.captureFile(comp.path);        refuseIfNotOk(prior)
        ok(secureFs.proveNoExtendedAcl(comp.path))      # source ACL absence
        # PERSISTENT backup ONLY for a forced edited-managed op (Decision 5 / JD-004):
        if comp.forceBackup:
          bname = backupName(basename(comp.path), ctx.clock, ctx.nonce)  # 8-candidate retry
          ok(secureFs.writeExclusive(dir, bname, prior.bytes, 0o600))    # write + fsync
          ok(secureFs.applyExactMode(dir/bname, prior.mode))
          ok(secureFs.revalidateIdentity(dir.path, dir.identity))        # after create (JD-B-005)
          backups.push(dir/bname)
      # stage the new bytes into a same-dir temp
      tname = tempName(basename(comp.path), pid, ctx.nonce)
      ok(secureFs.writeExclusive(dir, tname, comp.desired, 0o600))       # write + fsync
      if prior: ok(secureFs.applyExactMode(dir/tname, prior.mode))       # exact prior mode
      else:     ok(secureFs.applyExactMode(dir/tname, 0o600))            # new file stays 0o600
      ok(secureFs.revalidateIdentity(dir.path, dir.identity))            # after create (JD-B-005)
      staged.push({dir, tname, target:comp, prior})                     # prior = in-memory rollback bytes

    # --- COMMIT: asset first, settings second (Decision 6) ---------------
    # JD-007: immediately before the FIRST rename, re-run the FULL parent gate on every held
    # ancestor — ownership+mode AND ACL absence — not just identity. Preflight proof can be
    # stale by commit time; a fresh re-prove is the last gate before irreversible renames.
    for h in heldDirs:
      ok(secureFs.revalidateIdentity(h.path, h.identity))
      ok(secureFs.proveOwnershipAndMode(h.path))
      ok(secureFs.proveNoExtendedAcl(h.path))
    for s in orderAssetThenSettings(staged):
      ok(secureFs.revalidateIdentity(s.dir.path, s.dir.identity))       # before rename
      wroteHash = sha256(s.target.desired)
      ok(secureFs.renameInDir(s.dir, s.tname, basename(s.target.path))) # + parent fsync
      ok(secureFs.revalidateIdentity(s.dir.path, s.dir.identity))       # after rename
      committed.push({path:s.target.path, dir:s.dir, wroteHash,
                      wasAbsent: s.target.capture.state == absent, prior: s.prior})

    return { ok:true, committed:paths(committed), backups, errors:[] }

  catch refusal|fault at step:
    # --- GUARDED REVERSE-ORDER ROLLBACK (Decision 6) --------------------
    errors = [describe(step, refusal)]
    for c in reverse(committed):
      if not gateStillValid(heldDirs):        errors.push(STOP manual-recovery @c); break
      cur = secureFs.captureFile(c.path)
      if not cur.ok or cur.sha256 != c.wroteHash:   # concurrent post-write change
        errors.push(STOP manual-recovery @c); break
      if c.wasAbsent:
        secureFs.unlinkIfIdentity(c.dir, basename(c.path), cur.identity)
      else:
        # Restore from the IN-MEMORY captured prior bytes (c.prior) — NOT from a persistent
        # backup (routine ops have none, Decision 5). Write a transient same-directory
        # rollback-temp, apply exact prior mode, fsync, then rename over the target.
        rname = tempName(basename(c.path), pid, ctx.nonce)
        ok(secureFs.writeExclusive(c.dir, rname, c.prior.bytes, 0o600))
        ok(secureFs.applyExactMode(c.dir/rname, c.prior.mode))
        ok(secureFs.renameInDir(c.dir, rname, basename(c.path)))   # + parent fsync
    # remove only tx-created, identity-matched, still-empty segments (child-to-parent)
    for h in reverse(created):
      secureFs.rmdirIfIdentityEmpty(h)              # skips non-empty / drifted; no error escalation
    return { ok:false, committed:paths(committed), backups, errors }
  finally:
    closeAll(heldDirs, created)
```

Refusals in preflight/segment/capture/stage occur **before any commit** → zero target
mutation. Failures during commit trigger guarded rollback; lost proof or a concurrent
post-write hash change **stops** cleanup and returns manual-recovery text (never clobbers the
concurrent change). A hard crash may leave a temp, a backup, an identity-verified empty
segment, or one committed component — doctor reports the partial state; rollback never removes
an unrecognized or non-empty directory.

### D. Linux ACL adapter — `createLinuxAclAdapter().proveClean(target)`

```text
proveClean(target):
  res = spawn("getfacl", ["--absolute-names","--numeric","--omit-header","--", target],
              { env: { ...env, LC_ALL:"C", LANG:"C" }, timeout: ACL_TIMEOUT_MS })
  if res.spawnError (ENOENT): return refuse("unsupported-posix-acl", "getfacl absent")
  if res.timedOut:            return refuse("unsupported-posix-acl", "getfacl timeout")
  if res.code != 0:           return refuse("unsupported-posix-acl", "getfacl exit " + code)
  for line in nonEmpty(res.stdout):
    if line matches /^(user|group|other)::/: continue        # base entries OK
    return refuse("unsupported-posix-acl", "extended ACL entry")  # named/mask/default/other
  return ok()
```

### E. macOS ACL adapter — `createMacosAclAdapter().proveClean(target)`

```text
proveClean(target):
  res = spawn("/bin/ls", ["-lde","--", target],
              { env: { ...env, LC_ALL:"C", LANG:"C" }, timeout: ACL_TIMEOUT_MS })
  if res.spawnError:  return refuse("unsupported-posix-acl", "/bin/ls absent")
  if res.timedOut:    return refuse("unsupported-posix-acl", "ls timeout")
  if res.code != 0:   return refuse("unsupported-posix-acl", "ls exit " + code)
  lines = res.stdout.split("\n")
  modeLine = lines[0]
  if modeLine[10] == "+":  return refuse("unsupported-posix-acl", "ACL present (+ flag)")
  if any line matches /^\s*\d+:\s/:  return refuse("unsupported-posix-acl", "ACE listed")
  return ok()
```

Both adapters re-run `proveClean` immediately before commit; a changed result refuses.

## Idempotent Zero-Write No-Op Path

When `classifyAssetState` returns `managed-current` and the settings merge plan returns action
`noop` (settings `managed-current`), the manager returns `{ ok:true, changed:[], backups:[] }`
plus a fresh `report` **without entering the transaction** — no directory is opened for
mutation, no temp is created, no serialization runs. The on-disk asset bytes and mtime and the
settings bytes and mtime are untouched. Re-running install or repair on a healthy project is a
pure read. A mixed state (e.g. asset current, settings outdated) enters the transaction only
for the non-current component; the current component is skipped in staging (its `desired` is
`null`).

## Security and Complexity Boundaries

**Protected against (within the transaction):** clobbering unrelated Claude settings keys or
sibling hooks; torn individual writes (temp+fsync+rename); a two-target partial failure
(guarded reverse-order rollback + component-level doctor); a backup/replacement broader than
its source (exclusive `0o600` create + exact-mode + ACL-absence proof); creation of a directory
at a broad umask (segment-at-a-time exclusive `0o700`); accidental/concurrent parent change
(held identity + revalidation).

**Accepted residuals (documented, not fixed here):**
- No portable `openat`/`renameat` in Node → the before/after `dev`+`ino` revalidation detects
  drift but is not race-proof against a swap-out/swap-back; the ownership+ACL gate excludes the
  attacker instead. Malicious same-user or root processes and kernel/filesystem faults are out
  of scope.
- Cross-file (asset + settings) atomicity is impossible; a hard crash can leave one committed
  component, a temp, a backup, or an identity-verified empty segment → **doctor-detectable**
  partial state, never silently healthy.
- ACL-inconclusive trees (shared/CI, named/mask/default/inherited ACL, missing/erroring
  `getfacl`//`bin/ls`) refuse with `unsupported-posix-acl` and remediation to use a private
  `0700`-ancestor tree, rather than degrading to a weaker mode-only write.
- Windows in 3a refuses with `windows-secure-object-unavailable` and mutates nothing; the real
  secure-object path is 3b.

**Complexity boundary:** the transaction core never spawns a process, never branches on
platform, and never interprets ACL text — those live only in the POSIX adapter. The manager
never opens a handle or renames — it only classifies, plans, serializes, and delegates.

## File Changes

| File | Action | Lines | Description |
|---|---|---:|---|
| `src/lib/claude-hook-settings.ts` | Modify | ~+75 | **NEW (CRITICAL-1):** `planLegacyCohortExcision(parsed)` (reuse `LEGACY_COHORT` + `deepStructuralEqual`, return cohort indices + insertion point; no `identities` param — JD-A-003), `planForceReplace` (expose `matcherExact` + `siblingHandlers`; eligible when matcher exact regardless of siblings OR matcher edited with 0 siblings; refuse only when matcher edited AND siblings>0 — §324/JD-A-001), `buildManagedContainer(currentAssetSha)` (terminal fresh/whole-file synthesis; takes the SHA not the `Manifest` to avoid a settings→manager runtime cycle — JD-A-002) + their result interfaces. Reuses exported primitives; does not touch `classifyLegacy`/`classifySettingsEntry`. |
| `src/lib/claude-hook-settings.test.ts` | Modify | ~+70 | **NEW:** pure unit tests for the three helpers against crafted parsed values — cohort located/excised with siblings preserved, force-replace replaces in place preserving siblings when matcher exact / eligible when matcher edited with 0 siblings / refused when matcher edited with siblings>0, container synthesis shape, no-filesystem. |
| `src/lib/secure-fs-transaction.ts` | Create | ~250 | `PlatformSecureFs` interface + `TransactionDeps`; platform-agnostic `runTransaction` (preflight gate, segment creation, capture + forced-only backup + stage, pre-first-rename full-gate re-prove, asset-then-settings commit, guarded reverse-order rollback from in-memory prior via rollback-temp); backup/temp name builders. |
| `src/lib/secure-fs-posix.ts` | Create | ~140 | Linux (`getfacl`) + macOS (`/bin/ls -lde`) ACL adapters; `createPosixSecureFs`; `selectSecureFs` (win32/other → null). Only place a shell tool or ownership bit is interpreted. |
| `src/lib/secure-fs-transaction.test.ts` | Create | ~150 | Fake-adapter fault matrix: identity drift (incl. after `writeExclusive`), ACL refusal, exclusive-create `EEXIST`, fsync fault (via `writeExclusive`), rename failure, second-target failure, successful reverse rollback from captured bytes, empty-segment cleanup, STOP-on-lost-proof / post-write hash drift, forced-only backup presence, deterministic clock/nonce names. |
| `src/lib/secure-fs-posix.test.ts` | Create | ~70 | Mocked-spawn refusals (tool absent / non-zero / timeout / extended ACL / changed output) that never skip; real-ACL fixture tests (`setfacl`/`chmod +a`) that skip only when the host lacks the capability. |
| `src/lib/claude-hook-manager.ts` | Modify | ~+90 | `_run` deps-taking entry (CRITICAL-2) + public wrappers building real deps; `resolveActions` (per-state plan producer selection incl. container synthesis + force matcher-exactness gate (§324)); `serializeSettings`/`applyPlan`/`readPackagedAssetBytes`; `report` added to `ClaudeHookMutationResult`; Windows refusal. Slice-2 code grows in place. |
| `src/lib/claude-hook-manager.test.ts` | Modify | ~+70 | Full state→action matrix through `_run` with a **fake `PlatformSecureFs`** (CRITICAL-3, host-independent, always run): absent→install, outdated→upgrade, whole-file & embedded legacy→migrate, edited→refuse / force-replace in place preserving siblings when matcher exact / force-replace when matcher edited with 0 siblings / force-refuse only when matcher edited with siblings>0, foreign/symlink/non-regular/malformed/partial-legacy→refuse untouched, `managed-current`→byte+mtime zero-write no-op, Windows refusal. Plus a small **real-adapter** suite over a private `0700` symlink-free `mkdtemp` tree, skipped only when the host lacks the capability. |

**Recomputed forecast total: ~915 changed lines** — up from ~760 because CRITICAL-1 adds the
`claude-hook-settings.ts` (+test) plan-helper extension (~+145) and CRITICAL-2/3 slightly grow
the manager and its tests. This **breaches the 800-line single-PR budget**, so 3a ships as a
single PR to `main` under a `size:exception` (see Work-Unit Split below), the same disposition
Slice 2 used. No `manifest.json` change (`installerHelpers.windowsSecureObject` stays `null`
until 3b), no `package.json` change, no production dependency added.

## Work-Unit Split

3a ships as a **single PR to `main`** (~915 changed lines) carrying a **`size:exception`** label —
the same disposition Slice 2 used (user decision: one PR, not two chained PRs). The PR is composed
of the internal work-unit commits below, each **independently <400 changed lines**, each landing
its tests with the behavior they cover, ordered so the pure foundations (settings plan helpers +
POSIX adapters) precede the transaction engine and the manager wiring lands last.

| WU (commit) | Scope | Lines | Boundary |
|---|---|---:|---|
| WU-1 | Settings write-plan helpers in `claude-hook-settings.ts` + `claude-hook-settings.test.ts` (`planLegacyCohortExcision`, `planForceReplace`, `buildManagedContainer`) | ~145 | Pure functions reusing `LEGACY_COHORT`/`deepStructuralEqual`; cohort located/excised with siblings preserved; force keyed on matcher exactness (§324) — replace in place preserving siblings when matcher exact, refuse only when matcher edited with siblings>0; container synthesis shape. No I/O, no filesystem. |
| WU-2 | `secure-fs-posix.ts` adapters + `secure-fs-posix.test.ts` | ~210 | `PlatformSecureFs` POSIX adapters prove/refuse ACL + ownership; adapter refusal tests never skip; real-ACL fixtures skip only on incapable hosts. No transaction core yet. |
| WU-3 | `PlatformSecureFs` interface + `runTransaction` engine (`secure-fs-transaction.ts`) + `secure-fs-transaction.test.ts` | ~400 | Preflight gate, segment creation, capture + forced-only backup + stage with post-create revalidation, pre-first-rename full-gate re-prove, asset-then-settings commit, guarded rollback from in-memory prior via rollback-temp with STOP-on-lost-proof — all exercised by the fake-adapter fault matrix, host-independent, no root. |
| WU-4 | Manager `_run` seam + public wrappers in `claude-hook-manager.ts` (+ `report` reconcile) + `claude-hook-manager.test.ts` | ~160 | `_run` deps seam drives the full state→action matrix with a fake adapter (always run); zero-write no-op; force matcher-exactness gate (§324); Windows refusal; real-adapter `mkdtemp 0700` idempotency; `ClaudeHookMutationResult.report` returned. |

**Ordering / dependencies:** WU-1 and WU-2 (pure settings helpers + POSIX adapters) land first;
WU-3 (transaction engine) builds on the `PlatformSecureFs` boundary; WU-4 (manager wiring) depends
on WU-1's plan helpers and WU-3's engine, so it is the **last** commit. If, at implementation-review
time, WU-3 approaches 400 before the fault suite is complete, split the fault-test file with its
owning behavior into an additional commit (never defer safety tests to a later unprotected commit)
and flag it as a size decision — do not compress transactional safety.

**`size:exception` justification (same pattern as the Slice-2 change):** the diff exceeds the 800
budget because (a) it is a strict-TDD security matrix — each mutation state and each transactional
fault branch lands with its test, and that matrix does not fit under 800; (b) the change is
read-only-then-write by construction — the classifier/plan helpers and the `PlatformSecureFs` gate
are pure/injectable and reviewable before any irreversible I/O; and (c) the internal commits are
navigable per work unit (pure helpers → POSIX adapters → transaction engine → manager wiring), each
under 400 lines with its own behavior and tests, so the reviewer reads it as four coherent steps
rather than one monolith.

## Testing Strategy (design-level)

- **Pure plan helpers (CRITICAL-1)**: `planLegacyCohortExcision`, `planForceReplace`, and
  `buildManagedContainer` are unit-tested against crafted parsed values — no filesystem. Cohort
  located and excised with every non-cohort sibling preserved by index; force-replace keyed on
  matcher exactness (§324) — replaces the marker-proven handler in place preserving siblings when
  the matcher is exact, eligible when the matcher is edited with 0 siblings, refused only when the
  matcher is edited with `siblingHandlers>0` (the JD-005/JD-A-001 nuance); container synthesis
  produces `{hooks:{PreToolUse:[managedGroup]}}`.
- **Host-independent transaction core by construction**: the engine is tested only through the
  fake `PlatformSecureFs`; every fault branch (identity drift incl. after `writeExclusive`, ACL
  refusal, `EEXIST`, fsync fault via `writeExclusive`, rename fault, second-target failure, lost
  proof, post-write hash drift) is a synchronous toggle. Injected `clock`/`nonce` make backup/temp
  names deterministic; no sleeps for uniqueness.
- **Manager matrix through the `_run` deps seam with a FAKE adapter (CRITICAL-2 + CRITICAL-3)**:
  the entire state→action matrix runs by calling `_run(projectDir, mode, opts, { secureFs: fake,
  clock, nonce, manifest })` — no real gate, no `getfacl`, no privileged host, always run. This
  is the host-independent core matrix and it is NEVER platform-skipped. It asserts: absent→install,
  outdated→upgrade, whole-file & embedded legacy→migrate, edited→refuse, force-replace in place
  preserving siblings when matcher exact, force-replace when matcher edited with 0 siblings,
  force-refuse only when matcher edited with siblings>0,
  foreign/symlink/non-regular/malformed/partial-legacy→
  refuse untouched, `managed-current`→byte+mtime zero-write no-op, forced-only `backups[]`
  population, and Windows refusal (fake selects a null adapter) returning a report with no
  mutation.
- **Real-adapter tests build a private tree, skip only on incapable hosts (CRITICAL-3)**: the
  earlier "real `/tmp`" plan was unachievable — `/tmp` is `1777` other-writable (the gate refuses)
  and macOS `/tmp` is a symlink. Instead these tests `mkdtemp` a base and `chmod 0700` the created
  ancestor chain to a private, symlink-free tree, then run install/repair through the *real* POSIX
  adapter. They skip ONLY when the host cannot build/inspect that tree (e.g. missing `getfacl`),
  never the core matrix.
- **Adapter refusal tests never skip**: mocked-spawn cases assert `unsupported-posix-acl` on
  tool-absent/non-zero/timeout/extended-ACL/changed-output. Real-ACL fixture tests
  (`setfacl`/`chmod +a`) skip only when the host lacks the capability.
- Existing Git `hooks run` tests remain green.

## Judgment Day Round 1 — resolutions

Two blind judges converged on CHANGES_REQUIRED. Each confirmed finding maps to a concrete fix
above.

| Finding | Severity | Confirmed by | Resolution |
|---|---|---|---|
| **JD-001** | CRITICAL (load-bearing) | both judges | The write path for `migrate`/`force-replace`/`fresh-install`/`whole-file-legacy` did not exist. **Fixed by Decision 8 + the new plan helpers** `planLegacyCohortExcision`, `planForceReplace`, `buildManagedContainer` in `claude-hook-settings.ts`, plus Algorithm A/B routing each terminal/embedded state to the correct producer; the manager never feeds `undefined` to a merge planner. |
| **JD-002** | CRITICAL | Judge A | No manager-level injection seam. **Fixed by the `_run(projectDir,mode,options,deps)` entry** (Manager injection seam data model + Algorithm A); public `install`/`repair` signatures unchanged, build real deps; tests drive `_run` with a fake `PlatformSecureFs`. |
| **JD-003** | CRITICAL | Judge A | The "real temp filesystem" matrix is unachievable (`/tmp` is `1777`; macOS `/tmp` is a symlink). **Fixed by running the core state→action matrix through the `_run` fake-adapter seam (always run)**; real-adapter tests build a private `0700` symlink-free `mkdtemp` tree and skip only on incapable hosts. See Testing Strategy. |
| **JD-004** | CRITICAL | Judge A | Backups were persisted on every mutation. **Fixed by Decision 5 + Algorithm C**: persistent `<base>.javi-forge.bak.*` is forced-only (`edited-managed` + `--force`); routine upgrade/migrate roll back from in-memory captured bytes via a transient rollback-temp; `backups[]` populated for forced ops only. |
| **JD-005** | WARNING | Judge A | Force-replace sibling nuance (archived design §324) was unenforceable. **Fixed by `planForceReplace` exposing `matcherExact` + `siblingHandlers`**; force replaces the marker-proven handler in place (preserving siblings) when the matcher is exact, is eligible when the matcher is edited with 0 siblings, and refuses only when the matcher is edited with `siblingHandlers>0` (Decision 8, Algorithm A/B). **See the Round-2 note below** — the initial revision keyed eligibility on `siblingHandlers===0` unconditionally, which over-refused; JD-A-001 corrected it to key on matcher exactness per §324. |
| **JD-006** | (converged) | Judge A | Converged with / subsumed by JD-001: a downstream consequence of the missing write path. The Decision 8 plan producers + Algorithm A routing close it; no independent change beyond the JD-001 resolution. |
| **JD-007** | WARNING | Judge A | Commit did not re-prove the parent gate immediately before the first rename. **Fixed in Algorithm C**: before the first rename, `runTransaction` re-runs `revalidateIdentity` + `proveOwnershipAndMode` + `proveNoExtendedAcl` on every held ancestor. |
| **JD-B-001** | (converged) | Judge B | Converged with / subsumed by JD-001/JD-002: without a write path or deps seam the behavior could not be specified; resolved by those fixes plus the reconciled `_run`/plan-helper data model. |
| **JD-B-002** | (converged) | Judge B | Converged with / subsumed by JD-004's backup-scope correction (same underlying concern about backup semantics); resolved by Decision 5 + the `backups[]` semantics note. |
| **JD-B-003** | WARNING | Judge B | `captureFile` did not state its open flags. **Fixed in the `PlatformSecureFs` data model**: `captureFile` MUST open `O_NOFOLLOW|O_RDONLY` (security boundary — capture is the rollback/backup source). |
| **JD-B-004** | WARNING | Judge B | No independent fsync-fault point. **Fixed by folding write+fsync into `writeExclusive`** (data model note): an fsync fault is an injectable fault of `writeExclusive` itself — the fake can succeed the write and fail the sync. |
| **JD-B-005** | WARNING | Judge B | Identity was revalidated only around rename. **Fixed in Algorithm C**: `revalidateIdentity` runs after each `writeExclusive` (persistent backup, staging temp, rollback-temp), not only around rename. |

JD-006, JD-B-001, and JD-B-002 are recorded as converged: the judges' full finding text was not
carried into this design pass, but each is a downstream consequence of the four CRITICALs and is
closed by their resolutions. If a scoped re-review surfaces distinct content for any of them, it
is handled in a Round 2 pass.

## Judgment Day Round 2 — resolutions

Round-2 blind review confirmed all four Round-1 CRITICALs closed and surfaced one new CRITICAL
plus three non-blocking notes. All are resolved in this revision.

| Finding | Severity | Resolution |
|---|---|---|
| **JD-A-001** | CRITICAL (force-replace over-refusal) | The Round-1 revision made `--force` eligibility require `siblingHandlers === 0` **unconditionally**, refusing force whenever the group had any sibling. That contradicts parent contract §324: force must refuse ONLY when the group's matcher is **edited** (not the exact `MANAGED_MATCHER`) AND the group has unrelated siblings; when the matcher is **exact**, force MUST replace the marker-proven managed handler **in place at its array index**, preserving every sibling byte-for-value. **Fixed** — `planForceReplace` now keys eligibility on **matcher exactness**: it exposes `matcherExact` + `siblingHandlers`; eligible = replace in place when `matcherExact` (regardless of siblings) OR when the matcher is edited with `siblingHandlers === 0`; refuse-under-force only when the matcher is edited AND `siblingHandlers > 0`. Corrected across Technical Approach, Decision 8 item 2, the Data Model `ForceReplacePlan`, Algorithm A routing, Algorithm B matrix, the `repair` differs paragraph, the File Changes rows, and the Testing Strategy — all cite §324. |
| **JD-A-002** | note (import-cycle avoidance) | `buildManagedContainer` now takes `currentAssetSha` (`manifest.asset.sha256`) rather than the whole `Manifest`, so `claude-hook-settings.ts` never imports the manager's manifest reader at runtime (avoids a settings→manager runtime cycle). Any residual `Manifest` reference elsewhere is a **type-only** import. |
| **JD-A-003** | note (dead parameter) | Dropped the unused `identities` parameter from `planLegacyCohortExcision` — cohort identity is the fixed `LEGACY_COHORT` primitive; the helper needs only `parsed`. Signature is now `planLegacyCohortExcision(parsed)`. |
| **JD-A-004** | note (wholesale-replace safety) | Added an explicit note (Decision 8 item 3) that whole-file `exact-legacy` → `buildManagedContainer` wholesale replacement is valid because the shipped legacy scaffold (SHA `b4638222ecddc2daac6ec3339596d853a626906bbd1233d789d80a319325c68d`) has **no non-cohort top-level keys** — a whole-file match proves the file is 100% the four-object cohort, so nothing outside the cohort is discarded. |

## Open Questions

None blocking. The Windows-deferred refusal token is fixed as `windows-secure-object-unavailable`
(a distinct, greppable reason rather than overloading `unsafe-parent-chain`), settled without
widening 3a scope. All other load-bearing decisions are locked from exploration and the
proposal: Approach 2, the 3a/3b POSIX-vs-Windows sub-split, the `report`-field reconciliation,
and no uninstall dispatch (parent Decision 7).

## Agent-Agnostic Reuse Note (2026-08-16)

`secure-fs-transaction.ts` and `secure-fs-posix.ts` are named without the `claude-`
prefix on purpose: they are **agent-agnostic infrastructure** (safe transactional
file writes + POSIX ACL/ownership proof) with zero Claude coupling. The Claude-specific
layer is `claude-hook-manager.ts` (settings-shape classifier, merge, doctor) + the
packaged `.mjs` asset + the `.claude/settings.json` integration.

Future work (a SEPARATE arc, after Slices 3-4 land): guards for **OpenCode** and
**Codex**. Each reuses (a) the agent-agnostic shell-command policy already in the runtime
evaluator and (b) this `secure-fs-transaction` module, and adds only its own
per-agent integration adapter: the input-envelope contract and the config/settings
merge for that CLI (structurally different from Claude's PreToolUse settings schema).
No shared settings-merge is possible across agents; the shareable parts are policy + safe I/O.
