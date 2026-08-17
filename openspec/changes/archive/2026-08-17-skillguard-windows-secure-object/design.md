# Design: SkillGuard Windows Secure-Object Binding (Slice 3b)

## Technical Approach

Slice 3a shipped the platform-agnostic transaction core (`src/lib/secure-fs-transaction.ts`)
and two POSIX adapters (`src/lib/secure-fs-posix.ts`: Linux `getfacl`, macOS `/bin/ls -lde`).
`selectSecureFs("win32")` returns `null` (`secure-fs-posix.ts:401-408`), so the manager refuses
every Windows install/repair with `windows-secure-object-unavailable` and mutates nothing
(`claude-hook-manager.ts:600-608`). Slice 3b implements the Windows `PlatformSecureFs` behind
the **same `PlatformSecureFs` interface — 11 methods from 3a plus the Round-4 `proveManagedContainer`
seam** (`secure-fs-transaction.ts:54-119`), backed by a
bundled, digest-bound PowerShell helper (`Approach 1`, locked) that owns the real OS handles.

Four seams keep the change surgical; only ONE touches the agnostic engine, via a single minimal,
role-based addition — a twelfth `PlatformSecureFs` method, `proveManagedContainer`, that the core
calls on the dirs it OWNS (`.claude`, `.claude/hooks`), distinct from the lenient ancestor `gate()`
(see the Round-4 reconciliation for why this seam is required and why it is NOT a `process.platform`
branch):

- **The `.ps1` helper** (`assets/claude-hooks/javi-forge-windows-secure-object.ps1`) is the only
  place a Windows shell/`.NET` security API runs. It is a long-lived, framed-stdin session
  process that returns machine-parseable framed results. It is sha256-bound in `manifest.json`
  exactly like the `.mjs` runtime. **Critically, every by-path proof/identity op re-opens the
  path no-follow on a FRESH kernel handle per call** (the win32 mirror of the POSIX per-call
  `lstat`/`O_NOFOLLOW open` model at `secure-fs-posix.ts:215-251,274-302,322-336`); it does NOT
  answer a proof from a stale retained directory handle, because a retained handle cannot observe
  a path swapped underneath it. The only handles that outlive a single call are the
  `openDirNoFollow`'d directory handles referenced by `handleId` (the parent-chain gate), and even
  those are re-validated against a fresh no-follow stat of the path (see Decision 2, Handle model).
- **`src/lib/secure-fs-windows.ts`** implements `PlatformSecureFs` for win32 on top of an
  injectable `HelperTransport` seam (the win32 analog of the POSIX `SpawnFn` seam,
  `secure-fs-posix.ts:49`). `createWindowsSecureFs(transport)` builds requests, parses frames,
  and maps every transport error to a fail-closed refusal. `createPs1Session()` is the real
  transport (digest-verify → spawn → frame); a fake transport drives adapter unit tests with
  zero Windows host.
- **`selectSecureFs`** gains one win32 branch — it is already the single platform switch in the
  codebase and it is NOT `runTransaction`. The core's no-`process.platform` invariant holds.
- **The transaction core interface** gains **additive, logic-free type members**
  (`SecureRefusal |= "unsafe-windows-dacl"`, `SecureIdentity.opaque?: string`) PLUS the single
  role-based method `proveManagedContainer(dirPath): Promise<SecureResult<void>>` (Round-4 / JDA-401
  seam). `runTransaction` reads neither `dev`/`ino` nor the refusal string — it passes
  `SecureIdentity` opaquely back to the adapter and propagates refusals — and it calls
  `proveManagedContainer` with a plain path exactly like every other proof, branching on NOTHING
  platform-specific: the CORE (which constructs `.claude`/`.claude/hooks`) knows which dirs are
  managed containers and expresses that knowledge by WHICH METHOD it calls, so no `process.platform`
  ever enters the engine. Two win32-only semantics ride
  on these additive members and are enforced ENTIRELY inside the win32 adapter + `.ps1`, never in
  the core: (a) the `mode: number` argument threaded through `createDirExclusive`/`writeExclusive`/
  `applyExactMode` and the `mode` returned by `captureFile` is NOT interpreted as POSIX permission
  bits on win32 — it is a stable sentinel (Decision 1a); (b) `SecureIdentity.opaque` (the NTFS
  `volumeSerial:FileId`) is the ONLY field compared for identity on win32, and an absent, zero, or
  unavailable `opaque` is a hard refusal, never a fallback to truncated `dev`/`ino` (Decision 1b).

The adapter is exercised host-independently by a fake `HelperTransport` (canned frames per
op → every parse/refusal/round-trip branch). The **real `.ps1` behavior is validated only by the
`windows-latest` CI job** (Decision 3); it cannot be verified on the Linux dev box.

## Scope Recap (Locked)

- **Approach 1** (parent + 3a): bundled digest-bound `.ps1` invoked via `child_process`;
  Approaches 2 (native addon) and 3 (weaker guarantee) rejected in exploration.
- In scope: the `.ps1`, `secure-fs-windows.ts`, the `selectSecureFs` win32 branch, the manifest
  binding flip, the `claude-hook-assets.test.ts:61` guard flip, the `package:check` extension,
  and the `windows-latest` secure-fs/manager job.
- Out of scope (Slice 4): CLI dispatch, `init` wiring, effective-execution matrix.
- **Non-negotiable bar (from 3a Decision 2)**: never degrade silently. Any inconclusive
  ownership/DACL/handle/exclusive-create result **refuses**; Windows must not be a weaker
  fail-closed tier than POSIX.

---

## THE THREE DECISIONS (for ratification)

### DECISION 1 — Windows security predicates (fail-closed analog of POSIX Decision 2)

NT has no "ACL absent" state: a NULL DACL means *everyone: full control* (the worst case), an
empty DACL means *no one*, and every object always carries a security descriptor. POSIX Decision 2
splits its guarantee across two proofs that the agnostic core runs on EVERY gated path: (a)
`proveOwnershipAndMode` — trusted owner (`uid == euid || uid == 0`, `secure-fs-posix.ts:176-179`)
AND no group/other **write** bit (`stats.mode & 0o022`, `:234`) — which TOLERATES group/other
read/execute (so `/`, `/home` at mode `0755` pass); and (b) `proveNoExtendedAcl` — no extended ACL
entry (`:249-251`), which passes on real POSIX ancestors because vanilla `/`, `/home`,
`/home/<user>` carry no extended ACLs at all. The win32 adapter binds these SAME two methods.

**Two distinct predicates — the round-2 correction (JD-101/JD-102).** The round-1 design collapsed
Windows security into ONE strict predicate (protected DACL + zero inherited ACEs + allowlist-only
trustees) and bound it to the runtime `proveOwnershipAndMode`/`proveNoExtendedAcl` methods. But the
agnostic core (`secure-fs-transaction.ts:200-210,255-260`) walks `ancestorChain` to the FS root and
runs BOTH proofs on EVERY pre-existing ancestor (`C:\`, `C:\Users`, the profile, the project dir).
No real Windows ancestor is protected/inheritance-free — they all carry inherited ACEs plus
`Users`/`Authenticated Users` read grants — so the strict predicate refuses on the FIRST ancestor
and a win32 install can NEVER commit, even elevated. The strict "protected + zero-inherited"
requirement was a **Windows-ism** with no POSIX analog; the ancestor chain needs the LENIENT
analog of POSIX (trusted owner + no foreign *write*, tolerating inheritance and read grants). We
therefore split the design into two clearly-named predicates:

**PREDICATE A — the RUNTIME GATE predicate (lenient POSIX analog; what `proveOwnershipAndMode` +
`proveNoExtendedAcl` actually enforce on EVERY gated path — ancestors AND source/leaf targets).**
The adapter receives only a path and cannot tell an ancestor from a leaf, so ONE predicate must be
satisfiable by real ancestors yet still fail-closed. A security descriptor PASSES the runtime gate
iff ALL of:

1. **Owner SID ∈ trusted set** `{ current-user SID ([WindowsIdentity]::GetCurrent().User),
   LocalSystem (S-1-5-18), BUILTIN\Administrators (S-1-5-32-544), NT SERVICE\TrustedInstaller
   (S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464) }`. Administrators and SYSTEM
   are **unconditionally** trusted (the root-equivalent, see the W3 reversal below), not gated on the
   current process's elevation. `TrustedInstaller` is trusted **as an OWNER only** (see JDB-204/F4a):
   `C:\Program Files` / `C:\Windows` subtrees are owned by `TrustedInstaller`, a non-impersonatable
   service principal, so an install whose ancestor chain runs through such a tree must not refuse on
   ownership alone. It is NOT added to the trusted-*trustee* set — a foreign TrustedInstaller WRITE
   grant is still analysed by rules 2/3. Any owner outside this set → refuse. (POSIX analog:
   `ownershipTrusted` trusting `uid == 0` unconditionally, `:176-179`.)

   **CREATOR OWNER / CREATOR GROUP placeholder SIDs (JDB-202/F2).** `CREATOR OWNER` (S-1-3-0) and
   `CREATOR GROUP` (S-1-3-1) are template placeholders, NOT real principals. On real ancestors they
   appear almost exclusively as INHERIT_ONLY ACEs (`CREATOR OWNER:(OI)(CI)(IO)(F)`) that are skipped
   by rule 2's IO rule below. If a `CREATOR OWNER` ACE is *materialized* (NOT inherit-only) on the
   object, it resolves to the object's owner — which rule 1 already governs — so treat a materialized
   `CREATOR OWNER` ACE as **owner-equivalent (trusted)**, never foreign. A materialized `CREATOR
   GROUP` ACE is NOT owner-equivalent; it is treated as an ordinary (foreign unless it resolves into
   the trusted set) trustee under rule 2. In practice both are IO and never materialize.

2. **No foreign trustee holds a PATH-ENDANGERING right** (JDB-201/F1 — narrowed from the round-2
   blanket "any WRITE-class right", which refused the REAL `C:\`). A "foreign" trustee is any SID
   OUTSIDE the trusted-trustee allowlist `{ current-user SID, SYSTEM S-1-5-18, BUILTIN\Administrators
   S-1-5-32-544 }` (NOT TrustedInstaller — that is owner-only). The **root cause** of the JD-round-3
   BLOCKER: the real `C:\` DACL carries `BUILTIN\Users:(CI)(AD)` and `NT AUTHORITY\Authenticated
   Users:(AD)` — `AD` = `FILE_ADD_SUBDIRECTORY` (0x0004), which is the *same bit* as
   `FILE_APPEND_DATA`. The round-2 mask listed `FILE_APPEND_DATA` as WRITE-class, so it refused the
   real drive root and no install on `C:\` could ever commit. The correct threat model: what
   endangers OUR specific managed target is a foreign principal that can DELETE, RENAME, or REPLACE a
   component **on the path to** that target — NOT a foreigner who can create an unrelated new sibling
   far up the tree. The refuse-mask is therefore object-type-aware and applied to the object itself:

   - **On any node (file or directory)** — refuse a foreign ALLOW grant of `DELETE` (0x00010000,
     deletes THIS on-path node), `WRITE_DAC` (0x00040000, rewrites the ACL → then anything), or
     `WRITE_OWNER` (0x00080000, takes ownership → then anything). Call this
     `PATH_ENDANGER_COMMON = DELETE | WRITE_DAC | WRITE_OWNER`.
   - **On a DIRECTORY node** — additionally refuse `FILE_DELETE_CHILD` (0x00000040): it lets a
     foreigner delete/rename the directory's children, i.e. OUR next path segment.
     `PATH_ENDANGER_DIR = PATH_ENDANGER_COMMON | FILE_DELETE_CHILD`.
   - **On a FILE node** (a source/leaf capture target) — additionally refuse `FILE_WRITE_DATA`
     (0x0002) and `FILE_APPEND_DATA` (0x0004): on a file these ARE content modification/append, which
     poisons the bytes we capture/read. `PATH_ENDANGER_FILE = PATH_ENDANGER_COMMON | FILE_WRITE_DATA
     | FILE_APPEND_DATA`.
   - **TOLERATED on a DIRECTORY node at the uniform runtime gate** — `FILE_ADD_FILE` (0x0002) and
     `FILE_ADD_SUBDIRECTORY` (0x0004). On a directory these bits mean "create a new child", NOT
     "modify this container". A foreign add-child on a HIGH ancestor that is not the immediate parent
     of a managed component (`C:\`, `C:\Users`) only lets a foreigner create UNRELATED new siblings
     far up the tree; it can never alter, delete, rename, or replace our specific target path, so it
     MUST be tolerated (this is exactly what makes the real `C:\` accept). The managed-container case
     is handled separately (by `proveManagedContainer`, Round-4 / JDA-401, which the core calls ONLY
     on `.claude`/`.claude/hooks`), NOT here — because the uniform proof cannot tell a traversal
     ancestor from a dir the tool owns.

   Rename of an on-path node is covered: renaming a component requires `FILE_DELETE_CHILD` on its
   *parent* directory, which `PATH_ENDANGER_DIR` already refuses on that parent. If ANY **allow** ACE
   grants a foreign trustee a bit in the object-type-appropriate mask → refuse
   (`foreign trustee <SID> path-endangering`).
3. **Generic rights MUST be expanded before masking (JDB-203/R3-001/F3).** icacls `(M)`/`(F)` emit
   specific bits, but a hand/`.NET`-authored ACE can carry raw `GENERIC_WRITE` (0x40000000) or
   `GENERIC_ALL` (0x10000000), which do NOT numerically intersect the specific refuse-mask. For EACH
   ACE the `.ps1` MUST first call `MapGenericMask(&accessMask, &fileGenericMapping)` with the file
   object's `GENERIC_MAPPING` to expand generic bits into their specific rights, THEN test the
   refuse-mask. Consequence: `GENERIC_ALL` expands to `FILE_ALL_ACCESS` — which includes `DELETE`,
   `FILE_DELETE_CHILD`, `WRITE_DAC`, `WRITE_OWNER` — so a foreign `GENERIC_ALL` refuses on EVERY node
   (file or directory). `GENERIC_WRITE` expands to `FILE_WRITE_DATA | FILE_APPEND_DATA |
   FILE_WRITE_EA | FILE_WRITE_ATTRIBUTES | READ_CONTROL | SYNCHRONIZE` — so a foreign `GENERIC_WRITE`
   refuses on a FILE (content-write bits) and refuses on a managed container via
   `proveManagedContainer` (add-child), but on a HIGH ancestor directory at the uniform gate expands
   only to tolerated add-child bits and is (correctly) tolerated. `MapGenericMask` is the chosen mechanism (not literal-bit ORing), so a
   future non-standard generic mapping stays correct.
4. **Skip INHERIT_ONLY_ACE when evaluating rights on the object (JDB-202/F2).** Any ACE with the
   `INHERIT_ONLY_ACE` (`IO`, 0x08) flag set grants NOTHING on the object itself — it is a template
   applied only to future children. Real ancestors ubiquitously carry
   `CREATOR OWNER:(OI)(CI)(IO)(F)` and often `Authenticated Users:(OI)(CI)(IO)(M)`; treating those
   IO ACEs as effective rights would over-refuse ordinary directories. The predicate MUST **skip any
   ACE whose `AceFlags` include `INHERIT_ONLY_ACE`** before rules 2/3. (An ACE that is BOTH inherited
   and effective — `(I)` set, `IO` NOT set — is still evaluated; only `IO` skips.)
5. **Inheritance is ALLOWED, and read/execute/list grants to foreign trustees are TOLERATED.** Do
   NOT require `SE_DACL_PROTECTED`; do NOT refuse on the `Inherited` (`INHERITED_ACE`, `(I)`) flag;
   do NOT refuse a foreign trustee that holds ONLY read/execute/list/attribute rights
   (`FILE_READ_DATA`/`FILE_LIST_DIRECTORY`, `FILE_EXECUTE`/`FILE_TRAVERSE`, `FILE_READ_EA`,
   `FILE_READ_ATTRIBUTES`, `READ_CONTROL`, `SYNCHRONIZE`). **Deliberate mask omissions (JDB-204/R3-002/
   F4b):** `FILE_WRITE_ATTRIBUTES` (0x0100) and `FILE_WRITE_EA` (0x0010) are INTENTIONALLY NOT in any
   refuse-mask — neither can alter file content, delete/rename an on-path node, or add a child, so
   neither endangers our target. This is a considered decision, not an oversight.
6. **NULL DACL → refuse** (grants *everyone: full control* → the whole path-endangering set to a
   foreign trustee). An EMPTY DACL (present, zero ACEs → grants no one) is fine. **Deny ACEs do not
   grant**, so a foreign trustee named only in a `Deny` ACE never trips rule 2 (it removes access);
   only an **allow** ACE granting a path-endangering right refuses.

This mirrors POSIX faithfully: trusted owner (the `uid == 0` analog = `Administrators`/`SYSTEM`/
`TrustedInstaller`-as-owner) plus no foreign *path-endangering* right, tolerating read grants,
inheritance, IO-only templates, and harmless add-child on high ancestors — which is precisely why
`/` and `/home` pass on POSIX and the REAL `C:\`, `C:\Users`, the profile and the project dir now
pass on Windows.

**Managed-container strictness — enforced by `proveManagedContainer` on EVERY run, not the uniform
gate and NOT the create/write ops (JDB-201/F1 + JDA-401 reconciliation).** A foreign
`FILE_ADD_FILE`/`FILE_ADD_SUBDIRECTORY` on a container we manage (`.claude`, `.claude/hooks`) IS a
threat (a foreigner could plant a sibling `settings.local.json` or hook Claude Code would later
load), so it must be refused — but the uniform `proveOwnershipAndMode`/`proveNoExtendedAcl` proof
CANNOT enforce it: verified at `secure-fs-transaction.ts:255-260`, the core's `gate()` runs the
identical two proofs on EVERY held directory (every ancestor via preflight `:300-306`, plus
`.claude`/`.claude/hooks` via `ensureDir`), passing only a path — it never signals "this one is a
managed container." The round-3 design put the add-child strictness on the win32 `createDir`/
`writeExcl` ops (which structurally receive the parent handle), but **that is exactly the JDA-401
BLOCKER**: those ops only fire when a child is WRITTEN into the container this run. On an asset-only
repair (`settings.desired === null`, reachable per `claude-hook-manager.ts:666-668`) no child is
written into `.claude` — the asset writes into `.claude/hooks`, and `.claude` (the settings' parent /
asset's GRANDPARENT) is opened via `ensureDir`'s existing-dir branch and gated ONLY leniently — so a
pre-existing foreign `FILE_ADD_FILE` on `.claude` was tolerated and an attacker could plant
`.claude/settings.local.json`. The correct enforcement is tied to the container's ROLE, not to
whether a write happens: the core calls a dedicated `proveManagedContainer(dirPath)` on `.claude`
and `.claude/hooks` on EVERY run (both `ensureDir` branches AND the pre-commit re-prove), applying
the EXTENDED refuse-mask `CREATE_PARENT_DIR = PATH_ENDANGER_DIR | FILE_ADD_FILE |
FILE_ADD_SUBDIRECTORY` (after generic expansion and IO-skip). Effect: a container we CREATE is
Predicate-B strict (no foreign trustees at all — no add-child possible); a PRE-EXISTING managed
container that grants a foreign add-child is REFUSED regardless of whether a child is written into it
this run — closing the asset-only-repair grandparent gap. Exact-name plant of our component is still
independently caught by `CREATE_NEW` (EXCL-1/EXCL-2), and post-install deletion/rename of our
component by the uniform `FILE_DELETE_CHILD` refusal on that container — so component integrity holds
regardless. The win32 `createDir`/`writeExcl` ops NO LONGER carry the parent add-child proof (it was
both incomplete — missed the no-write case — and wrongly applied to `projectDir` when creating
`.claude`); that dimension now lives entirely in `proveManagedContainer`.

**PREDICATE B — the CREATION posture (strict hardening of OUR own objects at birth; C3, unchanged
intent).** Objects the helper CREATES (`createDir`/`writeExcl`) are still born **owner-only +
`SE_DACL_PROTECTED` + inheritance-stripped + allowlist-only** via a `SECURITY_ATTRIBUTES` passed at
`CREATE_NEW` (see the creation block below). This is a hardening of the objects WE own, applied at
creation time only — NOT the runtime gate predicate. A freshly-created owner-only protected object
trivially ALSO satisfies Predicate A (its owner is the current user; it grants write to no foreign
trustee; a stripped DACL has no foreign trustees at all).

**The strict "protected + zero-inherited + allowlist-only" requirement is REMOVED from the runtime
proof predicate** (it was the Windows-ism wrongly imposed on the ancestor chain) and is RETAINED
ONLY as create-time hardening (Predicate B). This does NOT relitigate ratified Decision 1: the
managed objects we own are still created strict AND still pass the runtime check; the runtime gate
is simply the correct fail-closed POSIX analog for the pre-existing ancestor chain the agnostic core
is required to traverse. The single ratified idea — "Windows must express a positive, fail-closed
*no-foreign-write* guarantee rather than an ACL-absent check" — is preserved; only its
over-strictness on inherited ancestors is corrected.

   **W3 — Administrators-as-trustee, REVERSED (JD-102 fix).** Round 2 tightened rule 4 to make
   `BUILTIN\Administrators` a FOREIGN trustee whenever the current process is non-elevated. That was
   wrong and is the direct cause of JD-A-102: real profiles carry an inherited `Administrators:(F)`
   ACE, so the tightening made the non-elevated primary target refuse independently of the ancestor
   problem. `Administrators` (and `SYSTEM`) are therefore **ALWAYS** in the trusted trustee
   allowlist as write-capable principals, regardless of the current process's elevation — because on
   Windows an administrator is the root-equivalent: an admin can already write anywhere, exactly as
   POSIX `uid == 0` is trusted unconditionally (`:176-179`). Flagging `Administrators` as foreign
   gives NO real protection (an admin is already omnipotent over the machine — it can take ownership
   and rewrite any DACL at will) and makes every real install refuse. The elevation-gated-trustee
   logic from round 2 is REMOVED. (Owner-trust may still note that a current-user owner is the
   normal, expected case for objects we create; but `Administrators`/`SYSTEM` as *trustees* are
   unconditionally allowed.)

**How the `.ps1` proves Predicate A (fail-closed, no text parsing, FRESH no-follow handle per
call):** the proof methods (`proveDacl`, `proveOwner`) receive a PATH, not a retained handle. For
EVERY such call the `.ps1` MUST, in order: (a) open the path with
`FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS` (no-follow) on a fresh handle;
(b) REFUSE immediately if `FILE_ATTRIBUTE_REPARSE_POINT` is set on that handle
(`GetFileInformationByHandle` → `dwFileAttributes`); (c) read the descriptor via P/Invoke
`GetSecurityInfo(freshHandle, SE_FILE_OBJECT, OWNER|DACL)` — **from that fresh handle, never
`Get-Acl <path>`**, which re-resolves the path and can follow a reparse point (a TOCTOU/symlink
hole). This mirrors POSIX re-opening no-follow per call (`secure-fs-posix.ts:274-302,322-336`); a
retained directory handle can never observe a swap and would be drift-blind. Enumerate with
`System.Security.AccessControl.RawSecurityDescriptor` / `RawAcl` / `CommonAce`, reading
`ControlFlags`, `AceFlags`, `AceQualifier` (Allow vs Deny), `AccessMask`, and `SecurityIdentifier`.
Read `FILE_ATTRIBUTE_DIRECTORY` from `GetFileInformationByHandle` so the predicate knows whether the
node is a file or a directory (the 0x0002/0x0004 bits mean content-write on a file but add-child on a
directory — the crux of the JDB-201 fix). Apply Predicate A: `proveOwner` checks rule 1 (owner ∈
trusted set, TrustedInstaller owner-only, materialized CREATOR OWNER = owner-equivalent);
`proveDacl` checks rules 2-6 — for each ALLOW ACE: (a) skip it if `AceFlags` has `INHERIT_ONLY_ACE`
(rule 4); (b) `MapGenericMask(&mask, &fileGenericMapping)` to expand generic bits (rule 3); (c) if
the trustee SID is foreign AND the expanded mask intersects the object-type-appropriate
path-endangering mask (`PATH_ENDANGER_FILE` on a file, `PATH_ENDANGER_DIR` on a directory at the
uniform gate; `proveManagedContainer` uses `CREATE_PARENT_DIR = PATH_ENDANGER_DIR | FILE_ADD_FILE |
FILE_ADD_SUBDIRECTORY` on `.claude`/`.claude/hooks`) → refuse; a NULL DACL → refuse. Deny ACEs, read-only foreign grants, IO-only
templates, and harmless add-child on high ancestors are tolerated; inheritance and the `(I)` flag
are NOT grounds to refuse. Structured `.NET` enumeration is chosen over `icacls` string output
(locale-dependent, SID-vs-name ambiguous, brittle to parse) — the win32 equivalent of the POSIX
"argv, `LC_ALL=C`, bounded" discipline, and strictly better because it never round-trips through
localized text. Any exception, a set reparse-point attribute, a NULL DACL, an unreadable descriptor,
or an unrecognized ACE type → refuse. The path-endangering masks are named constants in the `.ps1`,
auditable in one place:

```
FILE_WRITE_DATA/FILE_ADD_FILE           = 0x0002   FILE_APPEND_DATA/FILE_ADD_SUBDIRECTORY = 0x0004
FILE_DELETE_CHILD                       = 0x0040   DELETE                                 = 0x00010000
WRITE_DAC                               = 0x00040000 WRITE_OWNER                          = 0x00080000
PATH_ENDANGER_COMMON = DELETE | WRITE_DAC | WRITE_OWNER
PATH_ENDANGER_DIR    = PATH_ENDANGER_COMMON | FILE_DELETE_CHILD                 # uniform gate, directory
PATH_ENDANGER_FILE   = PATH_ENDANGER_COMMON | FILE_WRITE_DATA | FILE_APPEND_DATA # uniform gate, file
CREATE_PARENT_DIR    = PATH_ENDANGER_DIR | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY # proveManagedContainer only
# generic bits expanded via MapGenericMask BEFORE masking:
#   GENERIC_ALL (0x10000000)  -> FILE_ALL_ACCESS  (⊇ DELETE|FILE_DELETE_CHILD|WRITE_DAC|WRITE_OWNER)
#   GENERIC_WRITE(0x40000000) -> FILE_WRITE_DATA|FILE_APPEND_DATA|FILE_WRITE_EA|FILE_WRITE_ATTRIBUTES|READ_CONTROL|SYNCHRONIZE
# INTENTIONALLY excluded from every mask: FILE_WRITE_ATTRIBUTES (0x0100), FILE_WRITE_EA (0x0010)
```

The predicate is re-proven immediately before commit (3a Decision 6 parity,
`secure-fs-transaction.ts:366-380`) — again on a fresh no-follow handle, not a cached read.

**How the `.ps1` CREATES objects (Predicate B — C3, atomic protected DACL at creation).**
`CreateDirectory`/`CreateFile` with default (`NULL`) security INHERIT the parent's ACEs and are NOT
protected. On any normal user profile the parent (`%USERPROFILE%`, `.claude`'s grandparent) carries
inherited `Users`/`Authenticated Users` grants; a default-created `.claude` object would inherit
those, and if the inherited grant is anything more than read (e.g. a `Users:(M)` modify grant) it
would carry a *foreign write* ACE. Rather than depend on the parent's inherited grants being
read-only, the helper hardens OUR objects at birth: `createDir` (`createDirExclusive`) and
`writeExcl` (`writeExclusive`) MUST create the object with an explicit `SECURITY_ATTRIBUTES` whose
`lpSecurityDescriptor` is a **self-relative, `SE_DACL_PROTECTED` (inheritance-stripped), owner =
current-user SID, allowlist-only** DACL, built in-process and passed AT CREATION — a single atomic
step. There is NO `CreateDirectory`-then-`SetSecurityInfo` sequence, which would leave a window in
which the object carries inherited/foreign ACEs (a TOCTOU exposure). A freshly-created object then
trivially satisfies Predicate A **by construction** (owner = current user; no foreign trustee at
all, so certainly no foreign write), and `createDir` still re-opens no-follow and re-proves via the
runtime gate (defense in depth, matching POSIX `createDirExclusive` at
`secure-fs-posix.ts:253-272`). `CREATE_NEW` disposition preserves the `O_EXCL` refusal on a
pre-existing target (Decision 3 EXCL-1/EXCL-2).

**Managed-container add-child proof via `proveManagedContainer` (JDB-201/F1 + JDA-401).** The core
calls `proveManagedContainer(dirPath)` on `.claude` and `.claude/hooks` — the dirs it ensures via
`ensureDir` — on EVERY run and again in the pre-commit re-prove loop. The win32 op proves the
container (fresh no-follow handle, reparse-refuse, owner ∈ trusted set) with the EXTENDED mask
`CREATE_PARENT_DIR = PATH_ENDANGER_DIR | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY` (after generic
expansion + IO-skip). This is the ONLY place the add-child bits are refused, and it is correct
because the CORE — not the adapter — knows which dirs are managed containers (it constructs their
paths) and calls this method ONLY on them, never on a traversal ancestor. A container we created
ourselves passes trivially (Predicate B stripped all foreign trustees); a pre-existing managed
container that grants a foreign add-child is refused here whether or not a child is written into it
this run — the JDA-401 fix. POSIX implements `proveManagedContainer` as its existing strict check
(POSIX `proveOwnershipAndMode` already refuses group/other write, which IS add-child permission on a
directory), so POSIX behavior is unchanged and the seam has teeth only on win32 — without any
platform branch in the engine.

Note the asymmetry deliberately: Predicate B (creation) is STRICT because we control it; Predicate A
(uniform runtime gate) is LENIENT because it must tolerate the real, inherited-ACE-laden,
add-child-granting ancestor chain (the real `C:\` grants `Authenticated Users:0x4` add-subdir) the
core traverses; `proveManagedContainer` sits in between — it runs the strict `CREATE_PARENT_DIR`
add-child refusal on the two dirs the tool OWNS (`.claude`, `.claude/hooks`) on every run,
regardless of whether a child is written into them, while the deep ancestor chain stays lenient.
**(Round-5 / JDB5-001 — "on every run" is a claim, not yet a guarantee, until each managed container
is actually OPENED on every `anyWrite` run.** The Round-4 call sites tied the `.claude/hooks` open to
`if (needsWrite(input.asset))`, so a SETTINGS-ONLY repair never opens `.claude/hooks` — it receives
neither the uniform `gate()` `PATH_ENDANGER_DIR` check NOR `proveManagedContainer`, i.e. ZERO checks.
The Round-5 reconciliation decouples the container proof from the per-run write plan so the invariant
holds by construction for `{claudeDir, hooksDir}` alike; see that section.)

**Framed result:** `{ "ok": false, "refusal": "unsafe-windows-dacl", "detail":
"foreign trustee S-1-1-0 path-endangering" | "foreign trustee S-1-1-0 add-child" | "null DACL" |
"foreign owner <SID>" }`. (There is no "inherited ACE", "IO ACE", or "DACL not protected" refusal on
the runtime gate — inheritance, IO-only templates, and harmless add-child on high ancestors are
tolerated; those states are only ever *asserted present* on objects WE create, never a runtime-gate
refusal cause. `add-child` is only ever emitted by `proveManagedContainer` on `.claude`/
`.claude/hooks`, never by the uniform ancestor gate.)

**Runner-up — owner-only check via `Get-Acl` (exploration Approach 3):** verify only owner SID,
skip ACE enumeration. **Rejected**: it is exactly the "documented weaker guarantee" 3a Decision 2
forbids; it would let a foreign `Everyone:(F)` ACE the owner check never sees grant an outside
principal delete/rename/replace on an on-path node, making Windows the one platform with a materially
weaker guarantee — a guaranteed judgment-day finding at the design gate. Predicate A still enumerates
every allow ACE (after generic expansion + IO-skip) for a foreign path-endangering right; it only
*tolerates* read grants, inheritance, and harmless add-child on high ancestors, which the owner-only
runner-up cannot distinguish from a foreign delete/write-owner grant at all.

---

### DECISION 1a — The Windows "mode" model (C1: what `mode` means on win32)

Four interface methods thread a POSIX `mode: number`: `captureFile` RETURNS `mode`;
`writeExclusive(dir,name,bytes,mode)`; `applyExactMode(target,mode)` (sets + re-verifies exact
mode, then re-proves ACL absence); `createDirExclusive(parent,name,mode)`. NTFS has no POSIX
permission bits, so a numeric `mode` has no meaning to map. This governs the **happy path** — it
decides whether an install ever commits, not merely an edge case — so it MUST be defined
explicitly, not left implicit.

**Definition (win32):**

1. **`mode` is NOT interpreted as POSIX bits.** The win32 adapter/`.ps1` ignore the integer's
   `rwx` semantics entirely. Access control is expressed SOLELY by the fixed owner-only protected
   allowlist DACL (the Decision-1 clean set, created atomically per C3). There is no per-object
   variable permission on win32.
2. **What `captureFile` returns for `mode` (win32).** A stable sentinel constant,
   `WIN32_MODE_SENTINEL = 0o600` (chosen because it is the mode `runTransaction` already threads for
   private FILES — the core threads `mode` as opaque literals, `0o600` for files and `0o700` for
   dirs; there is NO core mode arithmetic, it only stores and re-emits the value). `runTransaction`
   stores it opaquely in `CapturedFile.mode` and later hands it back to
   `applyExactMode`/`writeExclusive` unchanged; the value's only contract is that it survives the
   round-trip, which a constant trivially satisfies.
3. **What `applyExactMode(target, mode)` does (win32).** It does NOT set or verify any numeric
   mode. It (a) re-opens `target` no-follow on a fresh handle (per C2), (b) re-asserts the
   owner-only protected allowlist DACL on that object (re-applying the Predicate B descriptor is
   idempotent and repairs any drift toward inheritance), and (c) re-proves **Predicate A** (the
   runtime gate) on that fresh handle. The `mode` argument is accepted and ignored beyond a
   defense-in-depth assertion that it equals `WIN32_MODE_SENTINEL` (that the core round-tripped our
   own file value, not a security control). **JD-A-104 — this sentinel assertion lives ONLY in
   `applyExactMode`.** It MUST NOT be hoisted into `createDir`/`createDirExclusive`: the core threads
   `0o700` (dir mode) to `createDirExclusive`, so a `mode == WIN32_MODE_SENTINEL (0o600)` assertion
   there would ALWAYS trip and break every install. `createDir` ignores the integer entirely (it
   creates with the Predicate B descriptor regardless of the numeric `mode`); only the file-oriented
   `applyExactMode` — which the core only ever calls with the `0o600` file mode it captured — carries
   the sentinel equality check.
4. **What the "AndMode" half of `proveOwnershipAndMode` checks (win32).** There is NO separate
   mode check. `proveOwner` on win32 proves ownership (Predicate A rule 1) and hands the DACL half
   to `proveDacl` (rules 2, 4, 5) — i.e. the "mode" dimension is subsumed entirely by the runtime
   gate's no-foreign-write rule. On POSIX the "no group/other **write** bits" check is the mode half
   (`secure-fs-posix.ts:234`); on win32 "no foreign trustee holds a WRITE-class right" is the direct
   analog and replaces it.

**Consequence for the interface-addition notes:** `secure-fs-windows.ts` defines
`WIN32_MODE_SENTINEL` and treats all four `mode` touchpoints per the rules above; no core signature
changes, and POSIX behavior is untouched (POSIX still interprets `mode` as real bits).

---

### DECISION 1b — Opaque identity is mandatory on win32 (C4: absent/zero opaque = refuse)

`SecureIdentity.opaque?: string` is optional at the type level (POSIX leaves it undefined). On
win32 it carries `"<volumeSerialHex>:<fileIdHex>"` from `GetFileInformationByHandle`
(`dwVolumeSerialNumber` + `nFileIndexHigh/Low`, or `FILE_ID_INFO` for 128-bit ReFS ids). The prior
draft said "compare on `opaque` when present," which silently falls back to the truncated 32-bit
`dev`/`ino` when `opaque` is absent — two distinct 64-bit `FileId`s alias into one 32-bit `ino` →
a swap is accepted (fail-open). Separately, `FileId == 0` occurs on some SMB/network/exotic
filesystems, making distinct objects share `opaque = "...:0"`.

**Rule (win32, enforced in `secure-fs-windows.ts` and the `.ps1`):**

- Any identity comparison (`revalidateIdentity`, `unlinkIfIdentity`, `rmdirIfIdentityEmpty`) where
  the held OR the freshly-read `opaque` is **absent, empty, malformed, or has a zero `FileId`
  component** is a HARD REFUSAL (`unsafe-parent-chain`, detail `unresolvable identity <path>`).
  Never fall back to `dev`/`ino`.
- The truncated `dev`/`ino` numbers the adapter fills for display are **display-only** and MUST
  NEVER participate in a security comparison on win32. The comparison is performed `.ps1`-side on
  full-precision `volumeSerial:FileId` read from a fresh no-follow handle (per C2), never on JS
  numbers.
- `openDir`/`createDir`/`capture` that cannot obtain a non-zero `FileId` for the object they just
  opened refuse at capture time, so no handle with an unusable identity ever enters the transaction.

This makes network/SMB/exotic-FS installs refuse rather than run on a colliding identity — the
same fail-closed spirit as POSIX refusing shared/CI trees.

---

### DECISION 2 — Invocation protocol (long-lived framed-stdin session)

Per-call spawn (~100-300ms PowerShell cold start × up to ~15 secure-fs calls per transaction =
1.5-4.5s per `_run`, and the digest hash + spawn repeat every call) vs one long-lived session
process per transaction (spawn + digest once; framed request/response over retained stdin/stdout).

**RECOMMENDATION — one long-lived framed-stdin session per transaction, spawned lazily,
lifecycle owned entirely inside the win32 adapter.**

Why the session wins even on the fault-injection axis: the exploration's worry ("per-spawn fault
injection is easier to test") **dissolves** because faults are injected at the `HelperTransport`
fake seam, not at real spawns — the fake returns any refusal/timeout/garbage frame per request
regardless of protocol. Testability is therefore equal, and the session is faster and hashes+spawns
once per transaction.

**Transport seam (the boundary the win32 fake plugs into):**

```ts
// src/lib/secure-fs-windows.ts
export interface HelperRequest  { op: HelperOp; args: Record<string, unknown> }
export interface HelperResponse { ok: boolean; value?: unknown; refusal?: SecureRefusal; detail?: string }
export interface HelperTransport {
  request(req: HelperRequest): Promise<HelperResponse>; // strictly serial: one outstanding request
  close(): Promise<void>;                               // idempotent; kills the child
}
export function createWindowsSecureFs(transport: HelperTransport): PlatformSecureFs;
export function createPs1Session(opts?: {...}): HelperTransport;   // real: digest-verify + spawn + frame
export function refusingTransport(detail: string): HelperTransport; // digest mismatch → every op refuses
```

**Framing (mirrors the audited `readBoundedStdin` reader, `...pre-tool-use.mjs:774`):**

- Wire unit = `[uint32 big-endian byteLength][UTF-8 JSON body]`, both directions.
- **Strictly serial**: exactly one outstanding request; the adapter never writes a second frame
  before the prior response resolves (`runTransaction` already awaits each method). No correlation
  IDs, no pipelining — this is what keeps the session protocol small and auditable.
- **Bounded**: reject any frame whose declared length exceeds `HELPER_FRAME_LIMIT` (8 MiB;
  hook assets are tiny, this is defensive) → kill + refuse, exactly like the `.mjs`
  `oversized-input`.
- **Binary payloads** (`captureFile` bytes out, `writeExclusive` bytes in) are base64 in the JSON
  body — one format, auditable, negligible overhead for small assets.
- **Startup handshake**: on spawn the `.ps1` emits `{"ready":true,"protocolVersion":1}`; a
  missing/mismatched handshake → kill + refuse before any op.
- **`.ps1` stdout hygiene (W2 — a desync is fail-closed but flaky, so PREVENT it).** The `.ps1`
  MUST do raw binary I/O via `[Console]::OpenStandardOutput()` / `[Console]::OpenStandardInput()`
  (NOT `Write-Output`/`Write-Host`, which apply text encoding and line endings), set
  `$ErrorActionPreference = 'Stop'` and `$ProgressPreference = 'SilentlyContinue'`, and emit ONLY
  length-prefixed frames on stdout. Every diagnostic, verbose, progress, warning, and error stream
  MUST be redirected to stderr (`2>&1` is BANNED; use per-stream redirection so nothing leaks onto
  stdout). Any stray byte on stdout desyncs the length framing; the adapter treats a malformed/
  short/oversized frame as a hard kill + refuse (fail-closed), but because a desync is flaky the
  hygiene rules above exist to prevent it from arising at all.

**Handle model (why a session is required, not just faster) — C2 corrected.** The parent-chain
gate holds no-follow directory handles for the whole transaction. The `.ps1` process owns those OS
handles in a `[handleId → SafeHandle]` table. `openDirNoFollow`/`createDirExclusive` return an
opaque `handleId`; `SecureDirHandle.path` is the path, `SecureDirHandle.close()` sends a
`releaseHandle` op. Methods taking a `SecureDirHandle` send its `handleId`. If the session dies,
every handle dies and every subsequent op refuses — fail-closed.

**But a retained handle is NEVER the source of a proof or identity re-check.** The prior draft
claimed proofs read "from the same held handle, TOCTOU-free." That is WRONG and drift-blind: a
retained directory handle keeps referring to the ORIGINAL object even after an attacker swaps the
path to a junction/symlink, so comparing a retained handle's info can never detect a path swap —
directly contradicting the REPARSE-4 fixture (swap dir→junction between `openDir` and
`revalidate`). Therefore:

- Every **by-path** proof/identity method (`revalidate`, `proveOwner`, `proveDacl`, `capture`,
  `applyMode`) — several of which (`proveNoExtendedAcl(component.path)`, `applyExactMode(target)`,
  `captureFile(target)`) have NO retained handle at all — MUST open the path on a FRESH handle with
  `FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS` (no-follow), REFUSE if
  `FILE_ATTRIBUTE_REPARSE_POINT` is set, and read DACL/owner (`GetSecurityInfo`) and identity
  (`GetFileInformationByHandle`) from THAT fresh handle. This is the exact win32 mirror of POSIX
  re-opening no-follow / re-`lstat`ing per call (`secure-fs-posix.ts:215-251,274-302,322-336`).
- A `handleId` may still be reused where a handle is LEGITIMATELY retained (an `openDirNoFollow`'d
  directory referenced by later ops via a `path→handleId` map) — but the identity re-check for that
  directory still requires a FRESH no-follow stat of the path, and refuses on drift, so reuse buys
  performance without ever answering "is the path still the same object?" from the stale handle.
- The "held handle, TOCTOU-free" language is removed throughout; the retained handle's only role is
  keeping the directory open (parent-chain lock) and carrying a `handleId`, not serving proofs.

**Identity across the boundary — C4 corrected (mandatory opaque, no fallback).** NTFS `FileId` is
64-bit (128-bit on ReFS) and does **not** fit `SecureIdentity.ino: number` without precision loss,
yet `revalidateIdentity`/`unlinkIfIdentity`/`rmdirIfIdentityEmpty` compare the held identity by
value. Resolution: the **additive optional** `SecureIdentity.opaque?: string`. The win32 adapter
sets `opaque = "<volumeSerialHex>:<fileIdHex>"` (full precision) and sets `dev`/`ino` to
best-effort truncated numbers **for display only — they NEVER participate in a comparison on
win32**. Per Decision 1b, an absent, empty, malformed, or zero-`FileId` `opaque` (held or
freshly-read) is a HARD REFUSAL, never a fallback to `dev`/`ino`. The comparison is done inside the
`.ps1` between the value carried in `held.opaque` and the `GetFileInformationByHandle`
(`nFileIndexHigh/Low` + `dwVolumeSerialNumber`) read from a FRESH no-follow re-open of the path —
never against the long-lived retained handle, and never against truncated JS numbers.

**Error / refusal encoding & lifecycle:**

- Every method maps a transport failure to a fail-closed `SecureResult`: spawn `ENOENT`, bad
  handshake, non-UTF-8 or oversized frame, child exit mid-request, or **per-request timeout**
  (`HELPER_OP_TIMEOUT_MS`, 5s; 10s for byte-carrying ops) → return
  `refuse("windows-secure-object-unavailable", "helper <cause>")` and mark the session dead.
- **Kill-on-abort**: any transport error immediately `child.kill()`s; a broken session is never
  reused. `runTransaction` sees the refusal and runs its existing preflight-abort or guarded
  rollback (fail-closed).
- **No process leak without touching the core**: `child.unref()` so it never keeps Node alive;
  a `process.once("exit")` hook hard-kills any surviving child; an **idle watchdog** kills the
  child after `HELPER_IDLE_MS`. **W1 correction — "idle" means STRICTLY BETWEEN TRANSACTIONS, with
  ZERO outstanding handles.** The watchdog MUST NOT fire while any `handleId` is live in the
  `.ps1` handle table (i.e. while a transaction holds parent-chain directory handles); otherwise it
  would kill the session mid-transaction and drop the handles that ARE the lock. The adapter tracks
  outstanding-handle count and only arms the idle timer when it reaches zero. Re-spawn is
  transparent ONLY between transactions (next transaction lazily spawns a fresh session); it is NOT
  transparent mid-transaction. A `.ps1` crash or watchdog-eligible kill mid-commit yields a
  fail-closed STOP + manual recovery (see residuals W1) — a deliberate resilience asymmetry vs
  POSIX, not silent re-spawn. This keeps `runTransaction` and the `PlatformSecureFs` interface
  untouched — no `dispose()` seam is added to the agnostic core.

**Method → op map:** all 12 methods route through the helper (even `revalidateIdentity`) so
identity uses NTFS `FileId` read from a FRESH no-follow re-open of the path (C2), not a retained
handle and not Node's unreliable Windows `fs.Stats`:
`openDirNoFollow→openDir`, `revalidateIdentity→revalidate`, `proveOwnershipAndMode→proveOwner`,
`proveNoExtendedAcl→proveDacl`, `proveManagedContainer→proveContainer` (Round-4 / JDA-401; applies
`CREATE_PARENT_DIR`), `createDirExclusive→createDir`, `captureFile→capture`,
`writeExclusive→writeExcl`, `applyExactMode→applyMode`, `renameInDir→rename`,
`unlinkIfIdentity→unlink`, `rmdirIfIdentityEmpty→rmdir`; plus `releaseHandle` and the handshake.

**Runner-up — per-call spawn.** Dead simple, no session state, no idle/desync race class.
**Rejected as primary**: 15 cold PowerShell starts + 15 digest hashes per transaction is
seconds of CI latency per `_run` across the matrix, and the fake-transport seam already gives
per-request fault injection, so simplicity buys nothing testability-wise. Kept as the documented
fallback if session desync ever proves unstable on the runner (the `HelperTransport` seam lets us
swap `createPs1Session` for a per-call implementation with zero adapter change).

---

### DECISION 3 — Empirical verification plan (`windows-latest` CI, cannot run on the Linux dev box)

The job runs the **real** `selectSecureFs("win32")` (real `.ps1`) plus adapter/manager tests.
Each fail-closed guarantee gets a concrete hostile fixture and an assertion.

**A. Durable-commit (POSIX fsync-parent analog).**
- `FLUSH-1`: open a directory handle **with `FILE_FLAG_BACKUP_SEMANTICS`**, call
  `FlushFileBuffers(dirHandle)`, assert it returns success (non-backup dir handles fail here —
  this proves the handle is opened correctly *and* NTFS accepts the flush).
- `FLUSH-2`: commit via `MoveFileEx(from, to, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`
  over an existing target; assert success and byte-exact content afterward.
- **Residual (flagged):** true power-loss durability is unprovable in CI — identical to POSIX
  `fsync`, which 3a also cannot prove under power loss. The safe substitute is asserting the
  `WRITE_THROUGH` rename + directory `FlushFileBuffers` API path succeeds; documented as residual.

**B. Reparse-point refusal (`O_NOFOLLOW` analog).** windows-latest runs elevated, so junction and
symlink creation both work.
- `REPARSE-1`: `.claude` created as a **junction** (`cmd /c mklink /J`) → `openDirNoFollow` refuses
  (open with `FILE_FLAG_OPEN_REPARSE_POINT|FILE_FLAG_BACKUP_SEMANTICS`, then reject if
  `FILE_ATTRIBUTE_REPARSE_POINT` is set).
- `REPARSE-2`: a **directory symlink** (`New-Item -ItemType SymbolicLink`) at a path segment → refuse.
- `REPARSE-3`: a **file symlink** at the capture target → `captureFile` refuses (never dereferences).
- `REPARSE-4`: swap a real dir for a junction **between** `openDir` and `revalidate` → the
  `revalidate` op's FRESH no-follow re-open (C2) sees `FILE_ATTRIBUTE_REPARSE_POINT` set AND/OR a
  changed `volumeSerial:FileId` vs `held.opaque` → refuse. This fixture is the direct proof that
  `revalidate` re-opens the PATH per call and does NOT answer from the retained handle (which would
  be drift-blind); assert it refuses, not that a stale handle "matched".

**C. Security predicates (Decision 1) — the runtime gate is Predicate A (lenient), so every ancestor
fixture models a REAL Windows ACL posture (JDB-201/JDB-202/JDB-203), NOT an idealized clean root.**

*Real-ACL accept fixtures (EMPIRICALLY CAPTURED on windows-latest — probe run 31990199153, sha
79492673, `scripts/win-acl-probe.ps1`; these REPLACE the round-3 idealized/recalled postures — see
the Empirical grounding section):*
- `ACL-C` (accept, the REAL `C:\` — the JDB-201 + JDB-204 fixture): read-only `Get-Acl C:\` /
  `GetSecurityInfo` and assert `proveOwner` + `proveDacl` return **ok** against the drive root's
  ACTUAL captured descriptor
  `O:S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464G:SYD:AI(A;OICIIO;SDGXGWGR;;;AU)(A;;LC;;;AU)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)(A;;0x1000a1;;;S-1-15-3-...)`.
  Decoded: **owner = `NT SERVICE\TrustedInstaller`** (S-1-5-80-956008885-...), `PROTECTED=False`;
  non-IO ACEs `Authenticated Users:LC` (`0x4` = `FILE_ADD_SUBDIRECTORY`), `SYSTEM:FA`,
  `Administrators:FA`, `Users:0x1200a9` (read/exec), an AppContainer-capability SID `0x1000a1`
  (read); plus one INHERIT_ONLY ACE `Authenticated Users:(OI)(CI)(IO) SDGXGWGR` (`0xE0010000` =
  `DELETE|GENERIC_*`). This is the fixture that would have caught the round-3 BLOCKER AND validates
  JDB-204: owner `TrustedInstaller` → trusted OWNER-only (rule 1 / F4a); `Authenticated Users:0x4`
  non-IO add-subdir on a directory → TOLERATED (rule 2, high-ancestor add-child); the
  `Authenticated Users:(IO) 0xE0010000` ACE is INHERIT_ONLY → skipped BEFORE `MapGenericMask` (rule
  4 — this is precisely the real IO+GENERIC template JDB-202/JDB-203 predicted); `Users`/AppContainer
  read grants → tolerated (rule 5); `SYSTEM`/`Administrators:FA` → trusted trustees. Assert
  **ACCEPT**. (Under the round-2 blanket mask this refused — no install on `C:\` could commit.)
- `ACL-C2` (accept, the REAL `C:\Users`): captured **owner = `SYSTEM`, `PROTECTED=True`**; non-IO
  `Everyone`/`Users` read-only, `SYSTEM:FA`, `Administrators:FA`, AppContainer read; plus IO GENERIC
  templates (skipped, rule 4). No foreign write on the container → assert **ACCEPT**. `Everyone`/
  `Users` read → tolerated (rule 5); `PROTECTED` is neither required nor refused (rule 5).
- `ACL-P` (accept, the REAL profile `C:\Users\runneradmin`): captured **owner = `SYSTEM`,
  `PROTECTED=True`**; `SYSTEM:FA`, `Administrators:FA`, `runneradmin(RID-500):FA`, AppContainer read.
  All trusted/read → assert **ACCEPT**. NOTE the empirical correction: the round-3 draft claimed the
  profile is owned by the current user and ubiquitously carries a materialized-template
  `CREATOR OWNER` — on this image the profile is owner=`SYSTEM`, protected, and carries **no
  materialized `CREATOR OWNER`** (JDB-202's "ubiquitous" was image-specific). Owner `SYSTEM` is
  trusted (rule 1), so the accept holds regardless.
- `ACL-IO` (accept, CREATOR OWNER + IO templates — SYNTHETIC, `.NET`-authored, defensive superset):
  a directory carrying `CREATOR OWNER:(OI)(CI)(IO)(F)` + `NT AUTHORITY\Authenticated Users:(OI)(CI)(IO)(M)`
  + `Users:(RX)` → **ACCEPT**. Since the real ancestors on this image did NOT materialize
  `CREATOR OWNER` (see `ACL-P` note), this is now explicitly a SYNTHETIC fixture that keeps the
  IO-skip + materialized-CREATOR-OWNER=owner-equivalent handling covered as a defensive superset,
  not a claim about the runner's real ancestors. Companion negative: `ACL-IOm` (a MATERIALIZED,
  non-IO foreign `Authenticated Users:(M)` on the same dir) → **REFUSE** — proves the IO-skip is
  flag-scoped, not a blanket AuthUsers exemption.

*Our-created-object accept fixtures:*
- `ACL-1` (accept, our created object satisfies BOTH predicates): dir created by the helper's
  `createDir` — self-relative, `SE_DACL_PROTECTED`, owner=current-user, allowlist-only DACL AT
  CREATION (Predicate B / C3). Assert the created object IS protected and carries ZERO inherited ACEs
  (proving C3's atomic-creation path, not a `CreateDirectory`-then-`SetSecurityInfo` window) AND that
  it passes the lenient runtime gate `proveDacl`/`proveOwner` AND `proveManagedContainer` (a strict
  owner-only object trivially has no foreign add-child). **Empirical baseline:** the read-only probe
  observed that a DEFAULT-security created tree on this runner is owner=`BUILTIN\Administrators`
  (elevated), `PROTECTED=False`, inherited `SYSTEM:FA`/`Administrators:FA`/`runneradmin(RID-500):FA`,
  ZERO foreign trustees — which ACCEPTS under Predicate A as-is; Predicate B then STRIPS this to the
  owner-only protected posture at creation.
- `ACL-1b` (accept, explicit-owner set — W4 / JD-B-007): assert the C3 `createDir` object has the
  owner set EXPLICITLY in the creation descriptor (`[WindowsIdentity]::GetCurrent().User`, which on
  this runner is `runneradmin`, RID-500) and `proveOwner` accepts it. **Elevated-runner residual,
  EMPIRICALLY CONFIRMED (JD-B-007):** `windows-latest` runs ELEVATED (`isElevated=True`,
  runner=`runneradmin` built-in Administrator RID-500), so a DEFAULT-created object is owned by
  `BUILTIN\Administrators`, NOT the current user — the natural NON-elevated current-user-OWNER accept
  (OS-assigned current-user owner + inheritable parent `Users` ACEs) is NOT reproducible natively on
  this runner and is exercisable ONLY via a `.NET`-authored synthetic fixture whose owner is a
  non-elevated user SID. Covered at the fake-transport level + that synthetic fixture (residual #10).

*Refuse fixtures (real foreign path-endangering grants still refuse — anti-relaxation):*
- `ACL-2` (refuse foreign full-control): `icacls <dir> /grant "Everyone:(F)"` → refuse
  (`foreign trustee S-1-1-0 path-endangering`). `(F)` includes `DELETE`/`WRITE_DAC`/`WRITE_OWNER`/
  `FILE_DELETE_CHILD`.
- `ACL-2b` (refuse a NON-privileged foreign principal with allow-WRITE, MANDATORY anti-relaxation):
  `icacls <dir> /grant "Authenticated Users:(M)"` (materialized, non-IO) → refuse. `(M)` = Modify
  includes `DELETE` → path-endangering. Proves the lenient gate STILL refuses real foreign write.
- `ACL-2c` (refuse foreign raw `GENERIC_WRITE` on a FILE — the JDB-203/R3-001 fixture, `.NET`-
  authored because icacls cannot emit generic bits): author a leaf/source FILE whose DACL grants
  `Everyone` ONLY raw `GENERIC_WRITE` (0x40000000) via `RawSecurityDescriptor`/`CommonAce` +
  `SetSecurityInfo` → refuse. After `MapGenericMask`, `GENERIC_WRITE` expands to
  `FILE_WRITE_DATA|FILE_APPEND_DATA` (content-write) → `PATH_ENDANGER_FILE`. Proves generic expansion
  on the file branch.
- `ACL-2d` (refuse foreign raw `GENERIC_ALL` on a DIRECTORY — the JDB-203/R3-001 fixture): author a
  directory whose DACL grants `Everyone` ONLY raw `GENERIC_ALL` (0x10000000) via `.NET` → refuse.
  After `MapGenericMask`, `GENERIC_ALL` → `FILE_ALL_ACCESS` ⊇ `DELETE|FILE_DELETE_CHILD|WRITE_DAC|
  WRITE_OWNER` → `PATH_ENDANGER_DIR`. Proves generic expansion catches the dangerous superset even on
  a directory (where a mere `GENERIC_WRITE`/add-child would be tolerated). **These two fixtures are
  the ONLY coverage of generic-rights expansion; `ACL-2`/`ACL-2b` do NOT cover it (icacls emits
  specific bits only).**
- `ACL-3a` (accept inheritance-only read): `icacls <parent> /grant:r "Users:(OI)(CI)(RX)"`, create
  the child **inheriting** (DACL not protected) → **ACCEPT** (non-protected child carrying only
  inherited `Users:(RX)` passes; inheritance per se never refuses).
- `ACL-3b` (refuse inherited path-endangering): `icacls <parent> /grant:r "Users:(OI)(CI)(M)"`,
  create the child inheriting → **refuse** (`foreign trustee S-1-5-32-545 path-endangering`) — the
  inherited (but materialized on the child, NOT IO) `(M)` grant includes `DELETE`. Inheritance never
  refuses; a foreign inherited path-endangering grant does.
- `ACL-4` (refuse NULL DACL): write a descriptor with a NULL DACL via `.NET`
  (`RawSecurityDescriptor` with `DiscretionaryAcl = null`, `SetSecurityInfo`) → refuse (`null DACL`).
- `ACL-5` (refuse foreign owner): `icacls <file> /setowner "<a non-trusted user SID>"` → refuse
  (`foreign owner`). Use a concretely non-trusted principal — NOT `TrustedInstaller`, which per F4a
  is now an ACCEPTED owner. **Runner limitation (flagged):** single-identity + elevated runner, so
  some owner permutations are only exercised at the fake-transport level; `ACL-5` covers the real
  refusal path. (`Administrators`/`SYSTEM`/`TrustedInstaller` as owner now ACCEPT — W3 + F4a — so
  they are NOT refusal fixtures.)
- `ACL-6` (refuse foreign add-child on a managed container — the JDB-201/F1 + JDA-401 fixture):
  `icacls <dir> /grant "Everyone:(AD)"` (add-subdirectory, materialized), then drive
  `proveManagedContainer(<dir>)` → refuse (`foreign trustee S-1-1-0 add-child`), while the SAME
  `Everyone:(AD)` posture ACCEPTS at the uniform `gate()`/`proveDacl` (companion assertion against
  `ACL-C`'s tolerated `Authenticated Users:0x4`). This is the fixture that shows add-child is
  tolerated on high ancestors but refused on a dir the tool OWNS.
- `ACL-7` (refuse asset-only-repair grandparent — the JDA-401 regression fixture): pre-create a
  real `.claude` with a foreign `FILE_ADD_FILE` ACE (`icacls <project>\.claude /grant "Everyone:(WD)"`,
  materialized non-IO), leave `.claude/hooks/<asset>` present but STALE (asset drifts → write) and
  `settings.json` already-current (settings noop → `settings.desired === null`), then drive the full
  manager `_run(install)` (or `runTransaction` directly). Assert the whole op **REFUSES** with
  `unsafe-windows-dacl` / `foreign trustee S-1-1-0 add-child` and ZERO mutation — proving
  `proveManagedContainer` fires on `.claude` (the asset's GRANDPARENT / settings' parent) even though
  no child is written into it this run. Under the round-3 create/write-op-only design this committed
  (the grandparent escaped the strict check) — this fixture is the direct proof of the JDA-401 fix.
- `ACL-8` (refuse settings-only-repair hooks-dir — the JDB5-001 regression fixture, symmetric mirror
  of `ACL-7`): pre-create a real `.claude/hooks` carrying a foreign `FILE_DELETE_CHILD` ACE
  (`icacls <project>\.claude\hooks /grant "Everyone:(DC)"`, materialized non-IO), leave the
  settings-referenced `.claude/hooks/<asset>` (`pre-tool-use.mjs`) present and CURRENT (asset noop →
  `asset.desired === null` → `needsWrite(asset)=false`, reachable per `claude-hook-manager.ts:624,664-665`)
  and `settings.json` DRIFTED (settings write), then drive the full manager `_run(repair)` (or
  `runTransaction` directly). Assert the whole op **REFUSES** with `unsafe-windows-dacl` /
  `foreign trustee S-1-1-0 path-endangering` and ZERO mutation — proving that `.claude/hooks` (the
  asset's PARENT, into which NO child is written this run) is now OPENED + `gate()`d (uniform
  `PATH_ENDANGER_DIR` refuses the foreign `FILE_DELETE_CHILD`) AND `proveManagedContainer`'d on a
  settings-only repair. Under the round-4 `if (needsWrite(input.asset))`-guarded `ensureDir(hooksDir)`
  this committed (hooks-dir was never opened → ZERO checks) — this fixture is the direct proof of the
  JDB5-001 fix. `FILE_DELETE_CHILD` on hooks-dir is the delete-half of the swap: it lets an attacker
  delete the real `pre-tool-use.mjs` and (with add-child, independently refused by
  `proveManagedContainer`'s `CREATE_PARENT_DIR`) plant a malicious same-named replacement Claude Code
  then executes while the settings-only repair reports `ok`. Companion: `ACL-8b` (same setup but the
  foreign right is `FILE_ADD_FILE` (`icacls ... /grant "Everyone:(WD)"`) → refuse
  `foreign trustee S-1-1-0 add-child` at `proveManagedContainer`) proves the plant-half is caught too.
- `ACL-9` (refuse settings-only-repair hooks-dir that is a REPARSE POINT — the JDA6-001 regression
  fixture): with the settings-only-repair setup of `ACL-8` (`asset.desired === null` →
  `needsWrite(asset)=false`, `settings.json` drifted → write, `createIfAbsent=false` for `hooksDir`),
  replace `.claude/hooks` with a JUNCTION pointing elsewhere (`rmdir <project>\.claude\hooks` then
  `mklink /J <project>\.claude\hooks <attacker-dir>`; the settings-referenced `pre-tool-use.mjs`
  byte-matches the manifest sha THROUGH the junction, so the Slice-2 plain classify read FOLLOWS it →
  `assetPlan=noop`). Drive the full manager `_run(repair)`. Assert `openDirNoFollow(hooksDir)` refuses
  with `notFound === false` (the reparse point is PRESENT, not absent) → `ensureManagedContainer`
  FAILS CLOSED (`must` propagates the refusal), the whole op **REFUSES** with ZERO mutation — proving a
  present-but-unopenable-no-follow managed container is refused, NOT silently skipped via `return null`.
  Contrast with the pre-Round-6 behavior where `openDirNoFollow` collapsed the reparse refusal into a
  generic `ok=false` and the `createIfAbsent=false` branch `return null`'d → the container was skipped,
  settings committed referencing `.claude/hooks/pre-tool-use.mjs` which resolved THROUGH the attacker
  junction → an attacker-controlled hook loaded while the tool reported `ok`. Companion `ACL-9b`: the
  fresh/asset-only path (`createIfAbsent=true`) on the SAME junction at `hooksDir` also refuses (now
  BEFORE `createDirExclusive`, on the explicit `notFound=false` branch — no longer relying on the
  incidental `CREATE_NEW`/EEXIST), proving both `createIfAbsent` branches fail closed symmetrically.

**D. Exclusive-create refuses a pre-existing target.**
- `EXCL-1`: pre-create a file at the staging/backup name → `writeExcl` refuses
  (`CreateFile(CREATE_NEW)` → `ERROR_FILE_EXISTS`/`ERROR_ALREADY_EXISTS`), the exact `O_EXCL` analog.
- `EXCL-2`: pre-create the dir segment → `createDir` refuses.

**E. End-to-end manager transaction on real Windows (JD-103 — now satisfiable).** Run
`_run(tempProject,"install",{},realDeps)` with the real win32 adapter, where `tempProject` is an
ordinary temp dir whose ancestor chain carries the REAL postures of section C (`ACL-P` profile +
`ACL-C2` `C:\Users` + `ACL-C` `C:\`). Assert: the full ancestor-chain gate PASSES on every ancestor
up to the drive root (concrete proof that Predicate A tolerates real ancestors — under the round-2
mask this `_run` would refuse on the first ancestor carrying `(AD)` and could never commit); BOTH
components commit; a second run is a zero-write no-op. Then the negative: plant `Everyone:(F)`
(foreign path-endangering) on `.claude/hooks` and assert the whole op refuses with
`unsafe-windows-dacl` and ZERO mutation. Do NOT plant a merely inherited, IO-only, read-only, or
high-ancestor add-child ACE for the negative case — those would (correctly) NOT refuse.

**E-root — MANDATORY real-`C:\` probe (the JDB-201 false-green guard).** The `windows-latest`
runner's workspace and `RUNNER_TEMP` live on **`D:\`**, whose root DACL DIFFERS from `C:\` (in
particular `D:\` may lack the `Users:(CI)(AD)` / `Authenticated Users:(AD)` grants that broke the
round-2 predicate). If section E's `tempProject` resolves under `D:\`, the E2E would PASS while never
exercising the real `C:\` posture — a FALSE GREEN that hides exactly the JDB-201 BLOCKER. The CI job
MUST therefore additionally run a **read-only** assertion (`Get-Acl` / `GetSecurityInfo`, NO
mutation) driving `proveOwner` + `proveDacl` directly against the ACTUAL `C:\` and `C:\Users` (the
`ACL-C`/`ACL-C2` fixtures read live, not synthesized) and assert ACCEPT. Additionally, place at least
one E2E `tempProject` on the `C:\` volume (e.g. under `C:\Users\runneradmin\...` rather than
`RUNNER_TEMP`) so a full ancestor chain that includes the real `C:\` root is gated end-to-end. Without
this, section E is not a valid proof of the fix.

**F. Digest verification.** Corrupt the on-disk `.ps1` (flip a byte) or pass a wrong expected hash
→ `createPs1Session` returns `refusingTransport`, **no PowerShell is spawned**, and `_run` refuses
with `windows-secure-object-unavailable` (`helper digest mismatch`).

**PowerShell host (sub-decision, flagged for ratification):** pin to `powershell.exe` (Windows
PowerShell 5.1 — always present on windows-latest, mature `System.Security.AccessControl` on .NET
Framework) rather than `pwsh` (7.x, not guaranteed, subtly different security-API surface). Spawn:
`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <verified-path>`.

---

## Digest-verify-before-invoke (tamper-evident, symmetric with the `.mjs`)

- The `.ps1` lives at `assets/claude-hooks/javi-forge-windows-secure-object.ps1` (parent design
  name, line 461).
- `manifest.json` → `installerHelpers.windowsSecureObject = { "name": "javi-forge-windows-secure-object.ps1",
  "sha256": "<full-file sha256>" }`. As with `asset.sha256`, the value is **hand-authored and
  cross-checked by the test** (`claude-hook-assets.test.ts`) — there is no generator script, matching
  the existing convention.
- **Before spawning**, `createPs1Session` reads the `.ps1` bytes from `CLAUDE_HOOK_ASSETS_DIR`,
  computes sha256, and compares to `manifest.installerHelpers.windowsSecureObject.sha256`. Missing
  file, `null` binding, or mismatch → return `refusingTransport("helper digest mismatch")`; spawn
  only on match. This is byte-symmetric with the `.mjs` binding (`claude-hook-assets.test.ts:62`).
- **Spawn posture:** hash-then-spawn-by-path, accepting the *same* residual the `.mjs` accepts (an
  attacker who can rewrite the install-tree file between hash and spawn also defeats the `.mjs`).
  The digest binding's job is the supply-chain / tarball-integrity guarantee, not runtime TOCTOU.
  *(Stronger option, noted for the user: `-EncodedCommand` of the verified bytes closes the
  disk-TOCTOU but hits the ~32k command-line limit for a non-trivial `.ps1`; deferred unless the
  user wants the stronger posture.)*

## Module & File Layout

| Path | Change | Notes |
|------|--------|-------|
| `assets/claude-hooks/javi-forge-windows-secure-object.ps1` | New | Framed-stdin session helper; `.NET` security APIs; no external deps; raw binary stdio + stderr-only diagnostics (W2); handshake + handle table + 11 ops + `releaseHandle`. **Per-call FRESH no-follow re-open for every by-path proof/identity op (C2); atomic protected owner-only DACL at `createDir`/`writeExcl` creation (C3); full-precision `volumeSerial:FileId` identity, zero/absent = refuse (C4).** **Predicate A path-endangering masks (`PATH_ENDANGER_COMMON`/`_DIR`/`_FILE`, JDB-201); reads `FILE_ATTRIBUTE_DIRECTORY` for object-type-aware 0x0002/0x0004 interpretation; skips `INHERIT_ONLY_ACE` + materialized-CREATOR-OWNER = owner-equivalent (JDB-202); `MapGenericMask` generic expansion before masking (JDB-203); `CREATE_PARENT_DIR` add-child refusal via the `proveContainer` op on `.claude`/`.claude/hooks` (JDB-201/F1 + JDA-401 — NO longer on `createDir`/`writeExcl`); `TrustedInstaller` trusted owner-only (JDB-204).** |
| `src/lib/secure-fs-windows.ts` | New | `HelperTransport`/`HelperRequest`/`HelperResponse` types; `WIN32_MODE_SENTINEL` (C1); `createWindowsSecureFs(transport)`; `createPs1Session()` (digest-verify + spawn + framing + lifecycle + outstanding-handle-gated idle watchdog, W1); `refusingTransport()`; frame encode/decode. Treats `mode` as a sentinel not POSIX bits (C1); refuses on absent/zero `opaque` (C4); never compares `dev`/`ino`. **Implements `proveManagedContainer` → the `proveContainer` op (Round-4 / JDA-401), applying `CREATE_PARENT_DIR`.** **`openDir` maps `ERROR_FILE_NOT_FOUND` (2) / `ERROR_PATH_NOT_FOUND` (3) to `notFound: true` on the refusal; every other status (a set `FILE_ATTRIBUTE_REPARSE_POINT`, `ERROR_ACCESS_DENIED`, transient) is a plain refusal with `notFound` absent — the win32 half of the Round-6 / JDA6-001 discriminator (`CreateFile` opened `FILE_FLAG_OPEN_REPARSE_POINT`, so a junction OPENS and is refused by the reparse-attribute check, NOT surfaced as not-found).** |
| `src/lib/secure-fs-transaction.ts` | Modify (additive + minimal seam) | `SecureRefusal \|= "unsafe-windows-dacl"`; `SecureIdentity.opaque?: string`; **additive `notFound?: boolean` on the refusal shape of `SecureResult` (Round-6 / JDA6-001) — set ONLY by `openDirNoFollow` for a genuine not-found; every other refusal leaves it absent/false**; **new `PlatformSecureFs.proveManagedContainer(dirPath)` method (Round-4 / JDA-401 seam)**. `ensureManagedContainer` fails closed on any non-`notFound` `openDirNoFollow` refusal (present-but-unopenable managed container → refuse the transaction), and only a genuine `notFound` proceeds to create-or-skip (Round-6). `runTransaction` proves the COMPLETE managed-container set `{claudeDir, hooksDir}` (the `:242-243` locals) on EVERY `anyWrite` run, decoupled from the per-run write plan: `ensureDir` runs `gate()` + `proveManagedContainer` on BOTH branches (`:268`, `:281`); the segment block (`:308-313`) is restructured so `.claude/hooks` is CREATED only when a child is written into it (`needsWrite(input.asset)`) but is OPENED + gated + proved whenever it EXISTS — the **Round-5 / JDB5-001 fix** that closes the settings-only-repair hooks-dir gap (see the Round-5 reconciliation); the pre-commit re-prove loop (`:366-380`) re-proves every held handle whose path ∈ `{claudeDir, hooksDir}` (an existing `.claude/hooks` is now in `heldOrder`, so TOCTOU parity is automatic). **No `process.platform` branch; the core distinguishes managed containers from ancestors by WHICH method it calls, not by platform.** |
| `src/lib/secure-fs-posix.ts:401-408` | Modify | `if (platform === "win32") return createWindowsSecureFs(createPs1Session());`. Keeps `selectSecureFs` as the single platform switch. **Also: `openDirNoFollow` (`:192-213`) sets `notFound: true` on its refusal ONLY when `errCode(error) === "ENOENT"`; every other errno (ELOOP/reparse, EACCES, ENOTDIR, transient) leaves `notFound` absent — the Round-6 / JDA6-001 discriminator, additive to the existing `refuse("unsafe-parent-chain", …)` shape.** **Also implement `proveManagedContainer` on the POSIX adapter as a delegation to its existing strict check (`proveOwnershipAndMode` — the group/other write-bit refusal at `:234` IS add-child permission on a directory), so POSIX behavior is provably unchanged (the `.claude`/`.claude/hooks` dirs, created 0o700 owner-only, already passed it).** |
| `assets/claude-hooks/manifest.json` | Modify | Flip `installerHelpers.windowsSecureObject` `null` → `{name,sha256}`. |
| `src/__tests__/claude-hook-assets.test.ts:61` | Modify | Replace the `windowsSecureObject: null` assertion with a real-sha256 assertion mirroring `:62` (read `.ps1` bytes, hash, compare). **Flip this guard first** (else the change looks green while shipping nothing). |
| `scripts/verify-package-contents.mjs` | Modify | Add `assets/claude-hooks/javi-forge-windows-secure-object.ps1` to `REQUIRED_FILES` (BY NAME; fail on omission). |
| `.github/workflows/claude-hook-windows.yml` | Modify | Add the win32 secure-fs/manager job (Decision 3) + `pnpm package:check`. |

**CLAUDE.md / core invariant note:** `runTransaction` (and `secure-fs-transaction.ts` generally)
must NOT gain any `process.platform` branch. The single platform switch stays in `selectSecureFs`.
The Round-4 seam is the ONLY engine logic change: `runTransaction` now calls the new
`proveManagedContainer` method on the dirs it OWNS (`.claude`/`.claude/hooks`) — a ROLE distinction
the core already holds (it constructs those paths), expressed by WHICH method it calls, NOT by any
platform test. Every adapter (POSIX, win32, fake) implements the method; POSIX delegates to its
existing strict check so its behavior is unchanged. The host-independent `runTransaction`/manager
tests still run unchanged on every OS (the fake adapter answers `proveManagedContainer` too),
keeping the no-`process.platform` invariant asserted by construction. The existing module-level
comment in `secure-fs-transaction.ts:1-11` already states the invariant — reaffirm it in the PR.

## Testing Strategy

**Host-independent (Linux dev box + all CI):**
- Existing `PlatformSecureFs` fake → `runTransaction`/manager matrix — unchanged (proves the core
  never learned about Windows).
- **New `src/lib/secure-fs-windows.test.ts`** — `createWindowsSecureFs(fakeTransport)`; the fake
  returns canned frames per op. Drives: request-building per method, response parsing, every
  refusal mapping (`unsafe-windows-dacl`, `unsafe-parent-chain`,
  `windows-secure-object-unavailable`), the `opaque` identity round-trip
  (`openDir`→`revalidate`/`unlink`/`rmdir`), the **`proveManagedContainer`→`proveContainer` request
  build + accept/`add-child`-refuse mapping (Round-4 / JDA-401)**, and
  transport-error→fail-closed-refusal (timeout, exit, oversized/garbage frame). This is the win32
  analog of the POSIX `SpawnFn`-fake tests that cover `getfacl`/`ls` parsing.
- **Core-seam host-independent test** — extend the fake-`PlatformSecureFs` `runTransaction`/manager
  matrix with a fake that ACCEPTS the lenient `gate()` on `.claude` but REFUSES
  `proveManagedContainer(.claude)`, driven through an ASSET-ONLY repair (`settings.desired===null`,
  asset drifts). Assert the transaction REFUSES with ZERO mutation. This proves the JDA-401 fix at
  the engine level on the Linux dev box — independent of any real Windows ACL (the real-ACL variant
  is `ACL-7` on the windows-latest job).
- **Core-seam host-independent test (JDB5-001, the symmetric mirror)** — a fake that ACCEPTS the
  lenient `gate()` on `.claude/hooks` but REFUSES `proveManagedContainer(.claude/hooks)`, driven
  through a SETTINGS-ONLY repair (`asset.desired===null` with a PRE-EXISTING `.claude/hooks`,
  `settings` drifts). Assert the transaction REFUSES with ZERO mutation. This proves the Round-5
  structural fix — that `.claude/hooks` is opened + proved even when no asset is written — at the
  engine level on the Linux dev box (real-ACL variant `ACL-8`/`ACL-8b` on windows-latest). Add a
  companion POSITIVE case: settings-only repair with a CLEAN existing `.claude/hooks` commits, and a
  settings-only repair where `.claude/hooks` does NOT exist neither creates nor proves it.
- **Core-seam host-independent test (JDA6-001, the fail-OPEN discriminator)** — a fake
  `PlatformSecureFs` whose `openDirNoFollow(hooksDir)` returns a NON-`notFound` refusal
  (`{ ok:false, refusal:"unsafe-parent-chain", notFound:false }` — the reparse/EACCES class),
  driven through a SETTINGS-ONLY repair (`asset.desired===null`, `createIfAbsent=false` for
  `hooksDir`, `settings` drifts). Assert `ensureManagedContainer` PROPAGATES the refusal (the whole
  transaction REFUSES) with ZERO mutation — proving the container is NOT silently skipped via
  `return null` when it is present-but-unopenable. Companion assertions on the SAME fake seam:
  (i) `openDirNoFollow` returning `{ ok:false, notFound:true }` on `createIfAbsent=false` → `return
  null`, no mutation, transaction proceeds (genuine absence is the only safe skip); (ii) the same
  non-`notFound` refusal on `createIfAbsent=true` also fails closed (both branches symmetric). This
  proves the JDA6-001 fix at the engine level on the Linux dev box — independent of any real reparse
  point (the real-ACL/junction variant is `ACL-9`/`ACL-9b` on the windows-latest job).
- **Framing unit tests** — length-prefixed encode/decode, oversized-frame refusal, base64 payload
  round-trip; pure and host-independent.
- **Digest-verify unit test** — `createPs1Session` with a wrong expected hash returns
  `refusingTransport` and never spawns (inject a fake spawner to assert zero spawns).

**Windows-only (`windows-latest` job):** the real `.ps1` — all of Decision 3 (A-F). This is the
only place the fail-closed guarantees are actually proven; inspection is explicitly insufficient
(proposal Risk 1).

## POSIX-Guarantee Gaps (and the safe fail-closed substitute)

1. **64-bit `FileId` vs `ino: number`** — cannot round-trip losslessly. *Substitute:* additive
   `SecureIdentity.opaque?: string` carrying full-precision `volumeSerial:fileId`; comparison done
   `.ps1`-side on a FRESH no-follow re-open of the path (C2), never a retained handle. Per C4, an
   absent/zero/malformed `opaque` is a HARD REFUSAL — `dev`/`ino` are display-only and never
   compared. Not a weakening; stronger (network/SMB/exotic-FS installs refuse rather than run on a
   colliding identity).
2. **`FlushFileBuffers` on a directory handle** — NTFS supports it (backup semantics); power-loss
   durability is unprovable in CI. *Substitute:* `MoveFileEx(...MOVEFILE_WRITE_THROUGH)` +
   directory `FlushFileBuffers`, both asserted to succeed. Documented residual — identical class to
   POSIX `fsync`.
3. **No atomic dirfd-relative `renameat`** — absent on Windows too; 3a already conceded this for
   POSIX. `MoveFileEx(MOVEFILE_REPLACE_EXISTING)` is an atomic same-volume replace (arguably
   stronger than POSIX `rename` for the replace case); same-directory constraint preserved. Not a gap.
4. **Owner "root" analog** — POSIX trusts `uid == euid || 0` (`uid == 0` unconditionally,
   `secure-fs-posix.ts:176-179`). Windows trusts current-user SID + SYSTEM + `Administrators`
   (unconditionally, the root-equivalent; W3 reversal, JD-102) + `TrustedInstaller` as OWNER-only
   (JDB-204/F4a, so `C:\Program Files`/`C:\Windows` ancestor chains don't refuse on ownership). Same
   fail-closed spirit, documented in Decision 1 Predicate A rule 1.
5. **No "ACL absent" state** — replaced by TWO positive definitions (Decision 1): Predicate A (the
   runtime gate) = trusted owner + no foreign **path-endangering** right (`DELETE`/`FILE_DELETE_CHILD`/
   `WRITE_DAC`/`WRITE_OWNER` on any on-path node, content-write on a leaf file), tolerating
   inheritance, IO-only templates, read grants, and harmless add-child on high ancestors — the
   faithful lenient analog of POSIX (`proveOwnershipAndMode` tolerating group/other read at `:234` +
   `proveNoExtendedAcl` passing on real ancestors); Predicate B (creation) = strict owner-only
   protected allowlist DACL on objects WE create, plus the managed-container add-child refusal via
   `proveManagedContainer` on `.claude`/`.claude/hooks` every run (JDA-401). Not a weakening: the
   gate still refuses any foreign path-endangering grant
   (`ACL-2`/`ACL-2b`/`ACL-2c`/`ACL-2d`/`ACL-3b`/`ACL-6`/`ACL-7`), generic bits are expanded via
   `MapGenericMask` before masking, and our own objects are still born strict. The round-2
   blanket-WRITE mask was CORRECTED to the path-endangering subset (JDB-201) — the real `C:\` grants
   foreign `(AD)` add-subdir, which the blanket mask wrongly refused; the narrowed mask still refuses
   every grant that could delete/rename/replace an on-path node or poison a source file.
6. **Exclusive create** — `CreateFile(CREATE_NEW)` == `O_CREAT|O_EXCL`. Exact match, no gap.
7. **No POSIX permission bits (C1)** — win32 has no mode. *Substitute:* `mode` is a sentinel
   (`WIN32_MODE_SENTINEL = 0o600`, the file mode the core threads); the core threads `mode` as
   opaque literals (`0o600` files, `0o700` dirs) with NO arithmetic. Access is expressed by the
   owner-only protected DACL on objects we create (Predicate B) and gated at runtime by Predicate A;
   `applyExactMode` re-asserts Predicate B's DACL + re-proves Predicate A instead of checking a mode
   integer (its sentinel-equality assertion is scoped to `applyExactMode` only, NOT `createDir`
   which receives `0o700` — JD-A-104); the "AndMode" half of `proveOwner` is subsumed by Predicate
   A's no-foreign-write rule (the direct analog of POSIX "no group/other **write** bits").
8. **Objects WE create are hardened protected + owner-set atomically (Predicate B / C3)** — default
   `CreateDirectory`/`CreateFile` inherit the parent's ACEs and are unprotected; if any inherited
   grant is a foreign WRITE (e.g. `Users:(M)`) the object would fail the runtime gate, and even a
   safe inherited object is weaker than we want for objects we own. *Substitute:* create with an
   explicit `SECURITY_ATTRIBUTES` (self-relative, `SE_DACL_PROTECTED`, owner=current-user,
   allowlist-only) in one atomic step; the object satisfies Predicate A by construction. This is a
   hardening of OUR objects, distinct from the lenient runtime gate applied to pre-existing
   ancestors. Not a gap.
11. **Managed-container add-child must be proven every run, not only when a child is written
    (JDA-401)** — a foreign `FILE_ADD_FILE` on `.claude` (asset's grandparent) lets an attacker plant
    `.claude/settings.local.json` on an ASSET-ONLY repair where settings is a noop; the round-3
    create/write-op enforcement missed it because no child is written into `.claude` that run.
    *Substitute:* the core calls the role-based `proveManagedContainer` on `.claude`/`.claude/hooks`
    on every run (both `ensureDir` branches + the pre-commit re-prove), applying `CREATE_PARENT_DIR`.
    POSIX delegates to its existing strict check (no behavior change). Not a gap — a stricter,
    complete replacement of the op-scoped check.
12. **The managed-container proof must reach `.claude/hooks` even when NO asset is written that run
    (JDB5-001, the symmetric mirror of JDA-401)** — the Round-4 segment block opened `.claude/hooks`
    only under `if (needsWrite(input.asset))`, so a SETTINGS-ONLY repair (`asset.desired === null`,
    `settings.desired` non-null) never opened it → neither the uniform `gate()` `PATH_ENDANGER_DIR`
    check nor `proveManagedContainer` ran on it (zero checks); a foreign `FILE_DELETE_CHILD` on a
    pre-existing `.claude/hooks` let an attacker delete the settings-referenced `pre-tool-use.mjs` and
    plant a malicious same-named replacement while the repair reported `ok`. *Substitute (structural):*
    the segment block proves the COMPLETE managed set `{claudeDir, hooksDir}` on every `anyWrite` run —
    `.claude/hooks` is CREATED only when a child is written into it but OPENED + gated + proved whenever
    it EXISTS, decoupled from the write plan. Not a gap — the invariant "every existing managed
    container is proven on every `anyWrite` run" now holds by construction for both dirs. POSIX
    unchanged (`proveManagedContainer` delegates to `proveOwnershipAndMode`, idempotent on the
    already-gated 0o700 dir).
9. **Mid-transaction helper crash is fail-closed STOP, not auto-recovered (W1)** — a `.ps1` crash
   or kill while handles are outstanding drops the parent-chain lock; the transaction refuses and
   the operator retries. A resilience asymmetry vs POSIX (whose in-process handles die with the
   Node process anyway), accepted because it is fail-closed. The idle watchdog is gated on
   zero-outstanding-handles so it never causes this itself.
10. **Non-elevated end-user owner path only fake/synthetic-tested (W4 / JD-B-007 — EMPIRICALLY
    CONFIRMED)** — probe run 31990199153 confirmed `windows-latest` runs ELEVATED
    (`isElevated=True`, runner=`runneradmin` RID-500) and DEFAULT-created objects are owned by
    `BUILTIN\Administrators`, NOT the current user. C3 sets the current-user owner explicitly so
    `ACL-1b` asserts the explicit-owner ACCEPT on the runner, but the natural NON-elevated profile
    (OS-assigned current-user owner + inheritable parent `Users` ACEs) is NOT reproducible there and
    is exercisable ONLY via a `.NET`-authored synthetic fixture (owner = a non-elevated user SID) +
    the fake-transport level. Acknowledged coverage limit, now grounded in real probe data.

## Open Risks

- **Runtime-gate predicate mis-modeled** (over-strict → install can't commit, or under-strict →
  foreign path-endangering right slips through): only the real runner validates; mitigated by the
  real-posture accept fixtures (`ACL-C` real `C:\`, `ACL-C2` real `C:\Users`, `ACL-P` real profile,
  `ACL-1` real created tree, `ACL-IO` synthetic CREATOR OWNER/IO), the anti-relaxation refuse fixtures
  (`ACL-2`/`ACL-2b`/`ACL-2c`/`ACL-2d`/`ACL-3b`/`ACL-6` managed-container add-child/`ACL-7`
  asset-only-repair grandparent), and the section-E E2E + E-root real-`C:\` probe that gates the full
  ancestor chain. (Proposal Risk 2.)
- **JDB-201 false green** (E2E on `D:\` never exercises the real `C:\` posture): mitigated by the
  MANDATORY E-root read-only probe against live `C:\`/`C:\Users` plus a C:-volume `tempProject`; see
  section E-root. Flagged because it is the exact failure mode the round-3 BLOCKER hid behind.
- **Session desync / partial-frame bugs**: mitigated by strictly-serial framing, kill-on-any-error,
  bounded frames, and full fake-transport coverage; per-call spawn is the documented fallback
  behind the same `HelperTransport` seam.
- **Runner is single-identity + elevated**: some owner-mismatch/ACL permutations are only fully
  exercised at the fake-transport level; `ACL-5` covers the real owner-refusal path.
- **PowerShell host choice** (`powershell.exe` 5.1 vs `pwsh` 7): pinned to 5.1 for guaranteed
  availability and mature `.NET Framework` `System.Security.AccessControl`; needs user ratification.
- **Digest spawn residual** (W5): hash-then-spawn-by-path shares the `.mjs` TOCTOU residual —
  accepted parity, honest disclosure kept; stronger `-EncodedCommand` posture noted as the deferred
  option (hits the ~32k command-line limit for a non-trivial `.ps1`).
- **Mid-transaction helper crash** (W1): a `.ps1` crash while handles are outstanding is a
  fail-closed STOP + manual retry (no transparent mid-transaction re-spawn); resilience asymmetry
  vs POSIX, accepted. The idle watchdog is gated on zero outstanding handles so it never triggers
  this itself.
- **stdout desync** (W2): a stray stdout byte desyncs framing → hard kill + refuse (fail-closed but
  flaky); prevented by raw binary stdio + stderr-only diagnostics + `$ErrorActionPreference='Stop'`.
- **Non-elevated end-user owner path** (W4 / JD-B-007 — EMPIRICALLY CONFIRMED by probe run
  31990199153): elevated runner owns DEFAULT-created objects as `BUILTIN\Administrators`, so the
  natural non-elevated profile is only fake/synthetic-tested (`.NET`-authored owner = non-elevated
  user SID). `ACL-1b` covers the explicit-owner accept where achievable.
- **Managed-container add-child on asset-only repair** (JDA-401): resolved by the `proveManagedContainer`
  core seam; validated by the host-independent core-seam test + real-ACL `ACL-7`. Residual: like every
  win32 ACL guarantee, the REAL-ACL half is only proven on the `windows-latest` job.
- **Managed-container proof skipped for `.claude/hooks` on settings-only repair** (JDB5-001, symmetric
  mirror of JDA-401): resolved structurally by proving `{claudeDir, hooksDir}` prove-if-exists on every
  `anyWrite` run (Round-5); validated by a new host-independent core-seam test (fake refuses
  `proveManagedContainer(.claude/hooks)` on a settings-only repair → transaction refuses, zero mutation)
  + real-ACL `ACL-8`/`ACL-8b`. Residual: the REAL-ACL half is only proven on the `windows-latest` job.
- **Settings-only-repair asset content not re-verified under the gate** (JDB5-003, accepted residual):
  on a settings-only repair the asset bytes are trusted from a Slice-2 plain pre-read
  (`claude-hook-manager.ts:611`) and never re-captured under secure-fs. The now-proven `.claude/hooks`
  container closes the swap/delete/plant class by construction, and a tool-created asset is Predicate-B
  owner-only protected (no foreign content-write ACE), so container integrity + Predicate-B-at-birth
  imply full asset integrity for tool-managed installs. The uncovered case (a non-tool-created asset
  that byte-matches the manifest sha AND carries a foreign `FILE_WRITE_DATA` ACE on the file itself) is
  contrived and only refusable (not repairable) on a settings-only run; the stronger posture (option b,
  asset re-capture + `PATH_ENDANGER_FILE` proof + sha re-check on settings-only repairs) is noted as
  deferred. See the Round-5 reconciliation.
- **`openDirNoFollow` fail-OPEN on present-but-unopenable managed container** (JDA6-001): resolved by the
  additive `notFound` discriminator + 4 fail-closed `ensureManagedContainer` branches — only a genuine
  `notFound` (ENOENT / `ERROR_FILE_NOT_FOUND`|`ERROR_PATH_NOT_FOUND`) skips/creates; a junction/reparse,
  EACCES, ENOTDIR, or transient refusal fails the transaction closed. Validated by a host-independent
  core-seam test + real-junction `ACL-9`/`ACL-9b` on `windows-latest`. Residual: the REAL-junction half
  is only proven on the `windows-latest` job. See the Round-6 reconciliation.
- **Settings referencing a genuinely-deleted hook** (JDA6-002, accepted residual): a `hooksDir` deleted
  externally between the Slice-2 classify read and the transaction (ENOENT, `createIfAbsent=false`) →
  `return null`, and `settings.json` may commit referencing a now-absent hook. The referenced hook
  merely fails to load (no code executes); the tool guarantees no attacker-controlled execution, not
  that the referenced hook still exists after external deletion. Same stale-classify-read class as
  JDB5-003(a). Non-blocking.

---

## Judgment-Day Round 1 reconciliation

Two blind judges independently converged on the same four CRITICALs and five WARNINGs against the
Round-0 design. The three user-RATIFIED decisions (DACL-clean allowlist-only; one long-lived
framed-stdin session per transaction over injectable `HelperTransport`; `powershell.exe` 5.1) are
UNCHANGED — these are soundness corrections to HOW the design expresses/implements them.

| Finding | Judge refs | Resolution |
|---|---|---|
| **C1** — Windows "mode" model undefined (4 methods thread POSIX mode; NTFS has no bits) | JD-A-003 / JD-B-003 | New **Decision 1a**: `mode` is NOT POSIX bits on win32; it is `WIN32_MODE_SENTINEL` (0o600) that round-trips harmlessly; `captureFile` returns it; `applyExactMode` re-asserts + re-proves the owner-only protected DACL (not a mode int); the "AndMode" half of `proveOwner` is subsumed by the DACL-clean predicate. Stated to govern the happy path (whether install commits). |
| **C2** — "same held handle, TOCTOU-free" overclaim is drift-blind (proofs receive PATHS; source-file ops retain no handle) | JD-A-001 / JD-B-002 | Decision 2 "Handle model" rewritten: EVERY by-path proof/identity op re-opens the path on a FRESH `FILE_FLAG_OPEN_REPARSE_POINT\|FILE_FLAG_BACKUP_SEMANTICS` handle, refuses on `FILE_ATTRIBUTE_REPARSE_POINT`, and reads DACL/owner/identity from THAT handle; `revalidate` compares fresh `volumeSerial:FileId` vs `held.opaque`, never the retained handle. Retained `handleId` reuse allowed only for the parent-chain dir lock, still re-checked by fresh stat. "Held handle" language removed throughout; mirrors POSIX per-call re-open. REPARSE-4 updated to prove it. |
| **C3** — default `CreateDirectory`/`CreateFile` inherit parent ACEs + unprotected → helper's own new object refuses → Windows always refuses on normal profiles | JD-A-002 / JD-B-004 | New "How the `.ps1` CREATES objects" block: `createDir`/`writeExcl` pass a `SECURITY_ATTRIBUTES` with a self-relative, `SE_DACL_PROTECTED`, inheritance-stripped, owner=current-user, allowlist-only DACL AT CREATION (single atomic step, no `Create`-then-`SetSecurityInfo` window). Object satisfies `proveDacl` by construction. ACL-1 updated to assert protected + zero inherited ACEs. |
| **C4** — optional `opaque` silently falls back to truncated `dev`/`ino`; `FileId==0` on SMB/exotic FS collides → swap accepted | JD-B-001 / JD-A-006 | New **Decision 1b** + identity-section rewrite: absent/empty/malformed/zero-`FileId` `opaque` (held or fresh) is a HARD REFUSAL on win32; `dev`/`ino` are display-only and NEVER compared. Stated in the identity section and in `revalidateIdentity`/`unlinkIfIdentity`/`rmdirIfIdentityEmpty`. |
| **W1** — idle watchdog could fire mid-transaction; "transparent re-spawn" false | JD-A-004 / JD-B-006 | Watchdog gated on ZERO outstanding handles (idle = strictly between transactions); re-spawn transparent only between transactions; mid-commit crash = fail-closed STOP + manual recovery, documented as a resilience asymmetry residual. |
| **W2** — `.ps1` stdout hygiene unspecified; a desync is fail-closed but flaky | JD-A-005 / JD-B-008 | Framing section: raw binary I/O via `[Console]::OpenStandardOutput()/OpenStandardInput()`, `$ErrorActionPreference='Stop'`, `$ProgressPreference='SilentlyContinue'`, only length-prefixed frames on stdout, ALL diagnostics to stderr (`2>&1` banned); desync → kill + refuse. |
| **W3** — Administrators elevation-gated as OWNER (rule 1) but allowlisted UNCONDITIONALLY as trustee (rule 4) → fail-open for non-admin user | JD-B-005 | RESOLVED (not accepted as residual): rule 4 now gates `Administrators`-as-trustee on the SAME elevation check as rule 1. Non-elevated end-user allowlist = `{current-user, SYSTEM}` exactly matching the C3-created DACL; elevated admin re-adds `Administrators` to both sets consistently. |
| **W4** — elevated runner owns new objects as Administrators → current-user-owner accept only fake-tested | JD-B-007 | C3 sets owner EXPLICITLY to current-user SID in the creation descriptor; new `ACL-1b` asserts the current-user-owner accept on the runner. Non-elevated natural-profile path acknowledged as covered only at fake-transport level (residual #10). |
| **W5** — hash-then-spawn-by-path TOCTOU | JD-B-009 | No change beyond keeping the honest disclosure; accepted parity with the `.mjs`; `-EncodedCommand` noted as the deferred stronger option. |

**Deviations / new sub-decisions surfaced:** (1) C1 required choosing a concrete sentinel value —
picked `0o600` because it is the private-file mode the core already threads, so no core special
casing is needed; flagged if the user prefers a distinct out-of-band constant. (2) W3 was resolved
by TIGHTENING (gating Administrators-as-trustee) rather than recording a residual — **REVERSED in
Round 2, see below.** (3) C3 introduces an in-`.ps1` self-relative DACL builder — a new
implementation surface (building a valid `SECURITY_DESCRIPTOR` via `.NET` `RawSecurityDescriptor` →
`GetBinaryForm` → a pinned `SECURITY_ATTRIBUTES`) that the ACL-1/ACL-1b fixtures must prove; noted
for the apply phase.

---

## Judgment-Day Round 2 reconciliation

Round 2 CLOSED the round-1 CRITICALs C1-C4. Both blind judges then converged on ONE BLOCKER
(JD-A-101 = JD-B-101) plus a reinforcing CRITICAL (JD-A-102) and two supporting findings
(JD-A-103, JD-A-104). Root cause of all four: round 1 bound ONE strict predicate (protected +
zero-inherited + allowlist-only) to the runtime `proveOwnershipAndMode`/`proveNoExtendedAcl`
methods that the agnostic core runs on EVERY pre-existing ancestor up to `C:\`
(`secure-fs-transaction.ts:200-210,255-260`). No real Windows ancestor satisfies it, so a win32
install could NEVER commit. The three ratified decisions (DACL/no-foreign-write allowlist model;
one long-lived framed-stdin session over injectable `HelperTransport`; `powershell.exe` 5.1) are
UNCHANGED. The C1-C4 fixes (Decision 1a sentinel, C2 fresh-handle-per-call, C3 atomic protected
creation, Decision 1b mandatory opaque) are UNCHANGED except where a fix explicitly builds on them.

**The two-predicate split (the core of this round):** the design now names TWO predicates —
**Predicate A = the RUNTIME GATE** (lenient POSIX analog: trusted owner + no foreign WRITE,
tolerating inheritance and read grants; what the adapter's `proveOwnershipAndMode` +
`proveNoExtendedAcl` actually enforce on every gated path, ancestor or leaf) and **Predicate B =
the CREATION posture** (strict owner-only + `SE_DACL_PROTECTED` + inheritance-stripped +
allowlist-only, applied ONLY to objects the helper creates at birth). The strict predicate is
REMOVED from the runtime proof and RETAINED only as create-time hardening.

| Finding | Judge refs | Resolution |
|---|---|---|
| **JD-101 (BLOCKER)** — strict Decision-1 predicate bound to the runtime gate refuses the FIRST real ancestor (`C:\`, `C:\Users`, profile, project dir all carry inherited ACEs + `Users` grants) → win32 install can NEVER commit, even elevated | JD-A-101 / JD-B-101 | Decision 1 split into **Predicate A** (lenient runtime gate: trusted owner ∈ {current-user, SYSTEM, Administrators}; NO foreign trustee holds a WRITE-class right; inheritance ALLOWED, `SE_DACL_PROTECTED` NOT required, read/execute grants tolerated; NULL DACL refuses; deny ACEs don't grant) and **Predicate B** (strict, creation-only). Strict "protected + zero-inherited" removed from the runtime proof. Explicitly reconciled as NOT relitigating ratified Decision 1 — our objects are still created strict AND pass the lenient gate. |
| **JD-102 (CRITICAL)** — round-2 W3 tightening made `Administrators` a foreign trustee when non-elevated → inherited `Administrators:(F)` on the profile independently refuses the non-elevated primary target | JD-A-102 | W3 tightening REVERSED. `BUILTIN\Administrators` (and `SYSTEM`) are ALWAYS trusted trustees and owners, regardless of process elevation — the Windows root-equivalent (an admin can write anywhere, like POSIX `uid == 0` trusted unconditionally at `secure-fs-posix.ts:176-179`). Flagging them foreign gives no real protection and breaks every real install. Elevation-gated-trustee logic removed. |
| **JD-103 (CRITICAL)** — the happy-path E2E `_run(install)` was unsatisfiable (its ordinary temp `projectDir`/ancestors would refuse), confirming JD-101 is real | JD-A-103 | Section E rewritten: `tempProject` + ancestors carry the ordinary `Users:(RX)` + inherited `Administrators:(F)` + `SYSTEM:(F)` posture and now PASS the full ancestor-chain gate; both components commit. New `ACL-0` accept fixture (real inheritance-enabled ancestor passes) + `ACL-2b`/`ACL-3b` anti-relaxation fixtures (foreign WRITE still refuses) + `ACL-3a` (inherited read-only child accepts). ACL-1/1b (created object) retained. |
| **JD-104 (WARNING)** — `mode == WIN32_MODE_SENTINEL (0o600)` assertion, if hoisted into `createDir`, trips because the core threads `0o700` to `createDirExclusive` | JD-A-104 | Decision 1a rule 3 clarified: the sentinel-equality assertion is scoped to `applyExactMode` ONLY (the core only ever calls it with the captured `0o600` file mode). `createDir` ignores the integer entirely. Sentinel rationale corrected: the core threads `mode` as opaque literals (`0o700` dirs / `0o600` files) with NO mode arithmetic. |

**New sub-decision surfaced:** the WRITE-class right mask is an explicit named constant in the `.ps1`
— **SUPERSEDED by the JD-round-3 path-endangering masks** (`PATH_ENDANGER_COMMON`/`_DIR`/`_FILE` +
`CREATE_PARENT_DIR`; see Round-3 reconciliation and Predicate A rule 2). The apply phase must pin
exactly those masks and the trusted-trustee SID set (`{current-user, S-1-5-18, S-1-5-32-544}`), with
`TrustedInstaller` in the trusted-OWNER set only. **Correction (JDB-203/R3-001):** the round-2 claim
that `ACL-2b`/`ACL-3b` cover generic-rights expansion was FALSE — icacls `(M)`/`(F)` emit specific
bits, never raw `GENERIC_WRITE`/`GENERIC_ALL`, so those fixtures never exercise `MapGenericMask`.
Generic expansion is load-bearing and is now covered ONLY by the `.NET`-authored `ACL-2c`
(`GENERIC_WRITE` on a file) and `ACL-2d` (`GENERIC_ALL` on a directory) fixtures.

---

## Judgment-Day Round 3 reconciliation

Round 2 closed JD-101/102/103/104 by splitting Predicate A (lenient runtime gate) from Predicate B
(strict creation). Round 3's two blind judges converged on ONE BLOCKER + two CRITICALs + two
WARNINGs, all rooted in the SAME cause: Predicate A was validated against an IDEALIZED ancestor ACL
(the round-2 `ACL-0`: "only `Users:(RX)` + inherited `Administrators:(F)` + `SYSTEM:(F)`") that does
NOT match REAL Windows ancestor ACLs. The real `C:\` grants foreign `(AD)` add-subdir, real ancestors
ubiquitously carry INHERIT_ONLY `CREATOR OWNER`/`Authenticated Users` ACEs, and the load-bearing
generic-rights expansion had no fixture. The three ratified decisions and the closed items (JD-102
Administrators-trust, JD-104 sentinel scoping, C1-C4) are UNCHANGED; the two-predicate split is
UNCHANGED — this round makes Predicate A CORRECT against REAL ancestor ACLs.

| Finding | Judge refs | Resolution |
|---|---|---|
| **JDB-201 (BLOCKER)** — the REAL `C:\` grants `Users:(CI)(AD)` + `Authenticated Users:(AD)` (foreign `FILE_ADD_SUBDIRECTORY` = 0x0004 = same bit as `FILE_APPEND_DATA`); the round-2 blanket WRITE-class mask listed `FILE_APPEND_DATA`, so Predicate A refused the real drive root → no install on `C:\` could ever commit | JDB-201 (both judges) | Predicate A rule 2 narrowed from "any WRITE-class right" to a **path-endangering subset**, object-type-aware: on any node refuse foreign `DELETE`/`WRITE_DAC`/`WRITE_OWNER`; on a directory add `FILE_DELETE_CHILD`; on a file add `FILE_WRITE_DATA`/`FILE_APPEND_DATA` (content-write). Foreign `FILE_ADD_FILE`/`FILE_ADD_SUBDIRECTORY` on a directory is TOLERATED at the uniform gate (can only create unrelated siblings, never touch our target). Immediate-parent add-child strictness moved to the create/write ops (which structurally receive the parent, verified `secure-fs-transaction.ts:311-312,341-350` vs uniform `gate()` `:255-260`) using `CREATE_PARENT_DIR = PATH_ENDANGER_DIR \| FILE_ADD_FILE \| FILE_ADD_SUBDIRECTORY`. Real `C:\` stated as `ACL-C` ACCEPT fixture; `ACL-6` proves the create-step add-child refusal. |
| **JDB-201 false-green** | JDB-201 (warning) | E-root section added: the `windows-latest` workspace/`RUNNER_TEMP` are on `D:\` whose root ACL differs from `C:\`; the CI job MUST additionally run a read-only `Get-Acl`/`GetSecurityInfo` assertion driving `proveOwner`/`proveDacl` against the LIVE `C:\` + `C:\Users`, and place a `tempProject` on the `C:\` volume, else the E2E is a false green hiding JDB-201. |
| **JDB-202 (CRITICAL)** — `INHERIT_ONLY_ACE` + CREATOR OWNER unspecified; real ancestors ubiquitously carry `CREATOR OWNER:(OI)(CI)(IO)(F)` + `Authenticated Users:(OI)(CI)(IO)(M)` → over-refusal | JDB-202 | Predicate A rule 4: SKIP any ACE with `INHERIT_ONLY_ACE` (0x08) set (grants nothing on the object itself). Rule 1: materialized (non-IO) `CREATOR OWNER` (S-1-3-0) = owner-equivalent (trusted, subsumed by the owner rule); `CREATOR GROUP` (S-1-3-1) is an ordinary trustee. Fixtures `ACL-IO` (IO templates ACCEPT) + `ACL-IOm` (materialized foreign write REFUSE) + `ACL-P` (real profile with `CREATOR OWNER:(I)(OI)(CI)(IO)(F)` ACCEPT). |
| **JDB-203 / R3-001 (CRITICAL, convergent)** — generic-rights expansion is the load-bearing lever but no fixture tests it, and the design falsely claimed `ACL-2b`/`ACL-3b` cover it (icacls emits specific bits, never raw generic) | JDB-203 / R3-001 | Predicate A rule 3: for each ACE, `MapGenericMask(&mask, &fileGenericMapping)` to expand generic bits to specific rights BEFORE testing the refuse-mask (chosen mechanism, not literal-bit ORing). `GENERIC_ALL`→`FILE_ALL_ACCESS` (refuses everywhere); `GENERIC_WRITE`→content-write (refuses on files + managed parents). New `.NET`-authored fixtures `ACL-2c` (`GENERIC_WRITE` on a file → REFUSE) + `ACL-2d` (`GENERIC_ALL` on a dir → REFUSE). False coverage claim corrected. |
| **JDB-204 / R3-003 (WARNING)** — TrustedInstaller-owned ancestor (`C:\Program Files` trees) would refuse on ownership | JDB-204 / R3-003 | DECISION: add `NT SERVICE\TrustedInstaller` (S-1-5-80-956008885-...) to the trusted-OWNER set for ancestors, as an OWNER only (non-impersonatable service principal), NOT a trusted trustee. Normal installs under `C:\Users\...` are unaffected; installs under a TrustedInstaller-owned tree no longer refuse on ownership alone. Recorded in Predicate A rule 1. |
| **R3-002 (WARNING)** — omitting `FILE_WRITE_ATTRIBUTES`/`FILE_WRITE_EA` from the WRITE-class mask reads as an oversight | R3-002 | DOCUMENTED as INTENTIONAL in Predicate A rule 5: `FILE_WRITE_ATTRIBUTES` (0x0100) and `FILE_WRITE_EA` (0x0010) cannot alter content, delete/rename an on-path node, or add a child, so neither endangers our target. Considered decision, not oversight. |

**New sub-decisions surfaced (round 3):**
1. **Immediate-parent enforcement site — SUPERSEDED by Round-4 (JDA-401).** Round 3 put the
   add-child strictness on `createDir`/`writeExcl` to keep `runTransaction` untouched. Round-4 judging
   proved that is INCOMPLETE: those ops only fire when a child is written into the container that run,
   so an asset-only repair (settings noop) leaves the grandparent `.claude` checked only leniently.
   The enforcement now lives in the role-based `proveManagedContainer` seam the core calls on
   `.claude`/`.claude/hooks` every run (see Round-4 reconciliation). Still no `process.platform`
   branch; the uniform ancestor gate stays lenient.
2. **Object-type awareness in the predicate.** The `.ps1` now reads `FILE_ATTRIBUTE_DIRECTORY` to
   interpret bits 0x0002/0x0004 (content-write on a file vs add-child on a directory) — the exact
   ambiguity that produced the BLOCKER. Flagged for the apply phase as load-bearing.
3. **Generic mapping mechanism pinned to `MapGenericMask`** (over literal-bit ORing) so a
   non-standard object generic mapping stays correct; the apply phase must pass the file
   `GENERIC_MAPPING`.

**Cannot be validated without the real runner (honest disclosure):** every fixture in this round
(`ACL-C`, `ACL-C2`, `ACL-P`, `ACL-IO`/`ACL-IOm`, `ACL-2c`/`ACL-2d`, `ACL-6`, E-root) asserts against
REAL or `.NET`-authored Windows ACLs and is ONLY exercisable on the `windows-latest` job — the Linux
dev box cannot enumerate a Windows security descriptor or call `MapGenericMask`. The fake-transport
adapter tests cover the request/parse/refusal plumbing but NOT the real ACL semantics. The JDB-201
fix in particular is unproven until the E-root probe runs against a live `C:\`; if the runner's `C:\`
DACL ever diverges from the documented posture, the probe (not a synthesized fixture) is the source
of truth and will surface it.

---

## Judgment-Day Round 4 reconciliation

Round 3 grounded Predicate A against real ancestor ACLs and moved the add-child strictness to the
create/write ops. Round 4's two blind judges surfaced ONE BLOCKER. Judge A identified it correctly;
Judge B missed the grandparent distinction (assessed CLEAN on the same path). My adjudication:
Judge A is right — the finding stands. The user explicitly authorized dropping the round-1..3
"frozen core" constraint ("do it right: core seam"), so the resolution is a MINIMAL core seam rather
than another adapter-only contortion. The three ratified decisions (DACL/no-foreign-write allowlist
model; one long-lived framed-stdin session over injectable `HelperTransport`; `powershell.exe` 5.1),
the two-predicate split, and all C1-C4 / JD-10x / JDB-20x / R3-00x closures are UNCHANGED.

| Finding | Judge refs | Resolution |
|---|---|---|
| **JDA-401 (BLOCKER)** — on an ASSET-ONLY repair (asset drifted, settings already current → `settings.desired === null`, reachable per `claude-hook-manager.ts:666-668`) the managed parent `.claude` (settings' parent / asset's GRANDPARENT) is opened via `ensureDir`'s existing-dir branch → only the LENIENT uniform gate runs; the stage loop skips settings (`needsWrite` false) so the round-3 create/write-op `CREATE_PARENT_DIR` add-child check NEVER runs on `.claude`. A pre-existing foreign `FILE_ADD_FILE` on `.claude` is tolerated → attacker plants `.claude/settings.local.json` (a Claude-loaded sibling) → commits. `.claude/hooks` is safe (the asset writes into it); the gap is `.claude`. | JDA-401 (Judge A; Judge B missed the grandparent) | **Root cause:** the win32 adapter receives only a path per call and cannot distinguish a MANAGED CONTAINER (`.claude`, `.claude/hooks` — dirs the tool owns, whose children must be protected from foreign add/delete) from a generic TRAVERSAL ANCESTOR (`C:\`, `C:\Users`, `projectDir` — where far-up foreign add-child is harmless and MUST be tolerated per the real-`C:\` data). Round 3 forced both roles through the same lenient `gate()` and bolted add-child onto the create/write ops, which only fire when a child is written that run. **Fix (minimal core seam):** add a 12th `PlatformSecureFs` method `proveManagedContainer(dirPath)` that applies the STRICT `CREATE_PARENT_DIR = PATH_ENDANGER_DIR \| FILE_ADD_FILE \| FILE_ADD_SUBDIRECTORY` mask; the CORE calls it on `.claude`/`.claude/hooks` (the dirs it ensures) on EVERY run and in the pre-commit re-prove, while traversal ancestors keep the lenient gate. The distinction is ROLE-based (the core knows which paths it constructs), NOT platform-based — no `process.platform` enters the engine. The create/write ops DROP their parent add-child proof (subsumed, and it was wrongly applied to `projectDir` when creating `.claude`). |

**The exact core seam (chosen: Option (a), a dedicated method — over Option (b), a role flag on an
existing method):**

- **Interface (`secure-fs-transaction.ts`):**
  `proveManagedContainer(dirPath: string): Promise<SecureResult<void>>` — "Prove a directory the tool
  OWNS as a managed container: refuse ALL foreign add/delete-child rights (stricter than the lenient
  ancestor gate)." Additive; the core reads only `.ok`, exactly as it does for every other proof.
- **Call sites in `runTransaction` (three, all role-based):**
  1. `ensureDir` existing-dir branch — after `gate(fullPath, opened.value)` (`:268`), call
     `must(...proveManagedContainer(fullPath))`. THIS is the JDA-401 fix path (`.claude` pre-exists).
  2. `ensureDir` created branch — after `gate(fullPath, created)` (`:281`), same call (a
     Predicate-B-fresh dir passes trivially; defense-in-depth + consistency).
  3. Pre-first-rename re-prove loop (`:366-380`) — for each held handle whose `handle.path` ∈
     `{claudeDir, hooksDir}` (the core already holds both locals, `:242-243`), also call
     `proveManagedContainer` (3a Decision 6 / JD-007 parity — closes the TOCTOU window between
     `ensureDir` and commit for the container's add-child dimension).
- **Why Option (a) over (b):** a distinct verb is self-documenting (grep the call → see exactly which
  dirs are managed containers), does NOT overload `proveNoExtendedAcl` — which is also invoked on the
  lenient ancestor chain AND on source files, three contexts a container flag would muddy — and
  matches the interface's existing one-verb-per-operation style. Churn is comparable (both need three
  adapter impls + core call sites); clarity decides it.
- **Minimality:** +1 interface method, +3 engine call sites, ZERO new `process.platform` branch,
  ZERO change to the 11 existing methods' signatures, ZERO change to `selectSecureFs`'s single switch.
  The create/write ops get SIMPLER (parent add-child proof removed).

**POSIX no-behavior-change proof.** `secure-fs-posix.ts` implements `proveManagedContainer(p)` as a
delegation to its existing strict ownership check (`proveOwnershipAndMode`). On POSIX, permission to
ADD a child to a directory IS the directory's write bit; `proveOwnershipAndMode` already refuses any
group/other write (`stats.mode & 0o022`, `:234`). So the POSIX container check is definitionally the
same predicate the core ALREADY ran on that path via `gate()` immediately before — idempotent, and
the `.claude`/`.claude/hooks` dirs (created 0o700 owner-only) already passed it. No new POSIX refusal
surface; the existing POSIX `runTransaction`/manager tests pass unchanged. The seam has TEETH only on
win32, where Predicate A deliberately TOLERATES add-child (the real `C:\` grants foreign `0x4`
add-subdir) — exactly the leniency that must NOT extend to dirs we own.

**JDA-401 fix trace on the asset-only-repair path.** `_run(install)` with `assetPlan=write`,
`settingsPlan=noop` → `desiredSettings=null` → `settings.desired===null` → `needsWrite(settings)=false`,
`anyWrite=true`. In `runTransaction`: preflight gates ancestors leniently (unchanged);
`ensureDir(projectHandle, claudeDir)` finds `.claude` existing → lenient `gate()` PLUS
**`proveManagedContainer(claudeDir)`** → the pre-existing foreign `FILE_ADD_FILE` on `.claude` now
trips `CREATE_PARENT_DIR` → REFUSE (`unsafe-windows-dacl` / `foreign trustee <SID> add-child`), ZERO
mutation. Under round 3 this reached commit (the grandparent escaped the create/write-op check because
no child is written into `.claude` when settings is a noop). Covered by host-independent core-seam
test (fake refuses `proveManagedContainer(.claude)`) + real-ACL fixture `ACL-7` on windows-latest.

**New sub-decision surfaced (round 4):** `proveManagedContainer` must run in the pre-commit re-prove
loop, not only at `ensureDir` — otherwise a foreign add-child planted on `.claude` AFTER `ensureDir`
but BEFORE the first rename would slip through (the existing re-prove uses the lenient proofs). The
loop already iterates `heldOrder`; the addition is a `Set` membership test against `{claudeDir,
hooksDir}`. Flagged for the apply phase as load-bearing (parity with 3a Decision 6).

---

## Empirical grounding (real windows-latest ACLs — probe run 31990199153)

The round-3 accept fixtures used RECALLED/idealized ancestor postures. A read-only probe
(`scripts/win-acl-probe.ps1` + `.github/workflows/win-acl-probe.yml`, branch
`feat/skillguard-windows-secure-object`, run 31990199153 success, sha 79492673) captured the ACTUAL
ACLs on `windows-latest` (Windows Server 2025, image `windows-2025-vs2026`). Runner = `runneradmin`
(built-in Administrator, RID-500), **`isElevated=True`**. These captured postures REPLACE the
idealized fixtures; the design's `ACL-C`/`ACL-C2`/`ACL-P`/`ACL-1` now assert against them.

| Object | Captured posture | Predicate A verdict |
|---|---|---|
| **`C:\`** (`ACL-C`) | owner=`NT SERVICE\TrustedInstaller` (S-1-5-80-956008885-...), `PROTECTED=False`; non-IO `Authenticated Users:0x4`(FILE_ADD_SUBDIRECTORY), `SYSTEM:FILE_ALL`, `Administrators:FILE_ALL`, `Users:0x1200A9`(read/exec), AppContainer-cap `0x1000a1`(read); IO `Authenticated Users:0xE0010000`(DELETE\|GENERIC_*) INHERIT_ONLY. SDDL: `O:S-1-5-80-956008885-...G:SYD:AI(A;OICIIO;SDGXGWGR;;;AU)(A;;LC;;;AU)(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)(A;;0x1000a1;;;S-1-15-3-...)` | **ACCEPT** — TrustedInstaller owner trusted (rule 1/F4a); AU `0x4` non-IO add-subdir tolerated on high ancestor (rule 2); AU IO GENERIC ACE skipped before MapGenericMask (rule 4); read grants tolerated (rule 5); SYSTEM/Admins FA trusted. Validates JDB-201 + JDB-202 + JDB-203 + JDB-204 against REAL data. |
| **`C:\Users`** (`ACL-C2`) | owner=`SYSTEM`, `PROTECTED=True`; Everyone/Users read-only, `SYSTEM:FA`, `Admins:FA`, AppContainer read; IO GENERIC templates. No foreign write. | **ACCEPT** — owner SYSTEM trusted; read grants tolerated; PROTECTED neither required nor refused. |
| **Profile `C:\Users\runneradmin`** (`ACL-P`) | owner=`SYSTEM`, `PROTECTED=True`; `SYSTEM:FA`, `Admins:FA`, `runneradmin(RID-500):FA`, AppContainer read. **No materialized `CREATOR OWNER`.** | **ACCEPT** — owner SYSTEM trusted; all trustees trusted/read. |
| **Created tree** `project/.claude/.claude/hooks/leaf` (`ACL-1`) | DEFAULT security → owner=`BUILTIN\Administrators` (elevated), `PROTECTED=False`, inherited `SYSTEM:FA`/`Admins:FA`/`runneradmin(RID-500):FA`, **zero foreign trustees**. | **ACCEPT** under Predicate A as captured; Predicate B then STRIPS to owner-only protected at creation. |

**Empirical corrections to round-3 assumptions:**
1. **Elevated runner → Administrators owner (JD-B-007 confirmed real).** DEFAULT-created objects are
   owned by `BUILTIN\Administrators`, not the current user. The non-elevated current-user-OWNER accept
   happy path is exercisable ONLY via a `.NET`-authored synthetic fixture (owner = a non-elevated user
   SID), never natively on this runner. Stated as residual #10 / open-risk W4.
2. **`CREATOR OWNER` did NOT materialize on this image's ancestors.** JDB-202's "ubiquitous" was
   image-specific; `ACL-IO` is now explicitly a SYNTHETIC defensive fixture. The IO-skip +
   materialized-CREATOR-OWNER=owner-equivalent handling remains as a defensive superset.
3. **`C:\` owner is TrustedInstaller (not SYSTEM as round-3 recalled).** This makes `ACL-C` the real
   fixture that also validates JDB-204's TrustedInstaller-as-owner accept, not just JDB-201.

Retained synthetic REFUSE fixtures (anti-relaxation, unchanged): `ACL-2` (Everyone:F), `ACL-2b`
(AuthUsers:M materialized), `ACL-2c` (`GENERIC_WRITE` on a file, `.NET`), `ACL-2d` (`GENERIC_ALL` on a
dir, `.NET`), `ACL-3b` (inherited materialized `(M)`), `ACL-4` (NULL DACL), `ACL-5` (foreign
non-TrustedInstaller owner), plus `ACL-6` (foreign add-child on a managed container → refuse
at `proveManagedContainer`), `ACL-7` (asset-only-repair grandparent → refuse — the JDA-401
regression fixture), `ACL-8`/`ACL-8b` (settings-only-repair `.claude/hooks` carrying a
foreign `FILE_DELETE_CHILD` / `FILE_ADD_FILE` → refuse — the JDB5-001 regression fixtures), and the
NEW `ACL-9`/`ACL-9b` (settings-only-repair / fresh-install `.claude/hooks` is a JUNCTION →
`openDirNoFollow` refuses with `notFound=false` → `ensureManagedContainer` fails closed, not skipped —
the JDA6-001 regression fixtures). The
**E-root live probe remains the source-of-truth gate**: the CI job runs
`proveOwner`/`proveDacl` read-only against the LIVE `C:\`/`C:\Users` and places a `tempProject` on the
`C:\` volume; `scripts/win-acl-probe.ps1` produced the captured postures above (remove the probe files
before the real PR).

---

## Judgment-Day Round 5 reconciliation

Round 4 closed JDA-401 by adding the role-based `proveManagedContainer` seam and calling it on
`{claudeDir, hooksDir}` at `ensureDir` and in the pre-commit re-prove. Round 5's two blind judges
split: Judge B surfaced ONE BLOCKER (JDB5-001) plus two lower findings (JDB5-002, JDB5-003); Judge A
assessed the same path CLEAN and raised one WARNING (JDA-501). My adjudication: **Judge B is right on
JDB5-001 — it stands as a BLOCKER**; Judge A missed it exactly as Judge A→B roles inverted from Round 4.
The Round-4 `proveManagedContainer` mechanism and the ratified predicates (Predicate A/B,
`CREATE_PARENT_DIR`, the trusted SID sets, `MapGenericMask`, C1-C4) are CORRECT and UNCHANGED — the
defect is that the Round-4 CALL SITES tied the `.claude/hooks` open to `needsWrite(input.asset)`, so
they do not deliver the design's own stated invariant. The fix is STRUCTURAL: make the invariant hold
by construction.

| Finding | Judge refs | Resolution |
|---|---|---|
| **JDB5-001 (BLOCKER)** — on a SETTINGS-ONLY repair (`asset` current → `assetPlan=noop` → `desiredAsset=null` → `asset.desired===null` → `needsWrite(asset)=false`; `settings` drifted → write; `anyWrite=true`), the segment block `if (needsWrite(input.asset)) await ensureDir(claudeHandle, hooksDir)` (`secure-fs-transaction.ts:312`) SKIPS opening `.claude/hooks`. So `.claude/hooks` is never `openDirNoFollow`'d, never `gate()`d (not even the uniform `PATH_ENDANGER_DIR` that refuses `FILE_DELETE_CHILD`), never in `heldOrder`, so neither the uniform gate NOR `proveManagedContainer` runs on it, and the re-prove loop (filtered on `{claudeDir, hooksDir}`) skips it — `.claude/hooks` gets ZERO checks. Exploit: a foreign `FILE_DELETE_CHILD` on a pre-existing `.claude/hooks` lets an attacker delete the settings-referenced `pre-tool-use.mjs` and plant a malicious same-named replacement; the settings-only repair commits and reports `ok` while the executed hook is attacker-controlled. Exact structural class as JDA-401 (a managed container left unproven on a run that writes no child into it), with `hooksDir` instead of `.claude` and `FILE_DELETE_CHILD` instead of add-child. | JDB5-001 (Judge B; Judge A missed it) | **Structural fix (make the invariant hold by construction), below.** Prove the COMPLETE managed-container set `{claudeDir, hooksDir}` on EVERY `anyWrite` run, decoupled from which child is written, whenever the container EXISTS. |
| **JDB5-003 (SUGGESTION)** — on a settings-only run the asset bytes are trusted from a Slice-2 plain pre-read (`claude-hook-manager.ts:611`), never re-captured/re-proven under secure-fs; now that `.claude/hooks` is proven the CONTAINER is secured but the asset FILE bytes are not re-verified. | JDB5-003 (Judge B) | **Determination: option (a) — accepted residual, with the boundary stated precisely (below).** Container integrity implies asset-NAME integrity by construction; content integrity holds transitively for tool-created assets via Predicate B; the one uncovered case is contrived and only refusable (not repairable) on a settings-only run. Option (b) noted as the deferred stronger posture. |
| **JDB5-002 (WARNING/info)** — rollback re-stages into managed containers under only the lenient `gateStillValid` (`:285-296`), which runs `revalidateIdentity` + `proveOwnershipAndMode` + `proveNoExtendedAcl` but NOT `proveManagedContainer`. | JDB5-002 (Judge B, non-blocking) | Documented acceptable (below) AND hardened cheaply: `gateStillValid` also calls `proveManagedContainer` for held handles whose path ∈ `{claudeDir, hooksDir}` — the same one-line `Set` test already used in the pre-commit loop, restoring full symmetry. |
| **JDA-501 (WARNING/info)** — the `projectDir`-as-immediate-parent of `.claude` gets only the lenient uniform gate; project-root files outside the managed set are unguarded. | JDA-501 (Judge A) | One sentence (below): `projectDir` is deliberately traversal-lenient, and project-root files OUTSIDE the managed set are explicitly out of scope. |

### The exact structural call-site change (JDB5-001)

**1. Define the managed-container set explicitly.** The dirs the tool OWNS — whose children include
the executed asset (`.claude/hooks/pre-tool-use.mjs`) and the settings the asset is referenced from
(`.claude/settings.json`) — are `claudeDir` and `hooksDir`, the locals already computed at
`secure-fs-transaction.ts:242-243`. This set is FIXED and known to the core regardless of the per-run
write plan.

**2. Restructure the segment block (`:308-313`) to prove-if-exists, decoupled from the write plan.**
Replace:

```ts
// --- SEGMENT CREATION: .claude then .claude/hooks, one at a time ---
if (anyWrite) {
    const projectHandle = heldByPath.get(projectDir) as SecureDirHandle;
    const claudeHandle = await ensureDir(projectHandle, claudeDir);
    if (needsWrite(input.asset)) await ensureDir(claudeHandle, hooksDir);   // ← JDB5-001 defect
}
```

with (the `.claude/hooks` open is decoupled from `needsWrite(asset)`; it is CREATED only when a child
is written into it, but OPENED + gated + proved whenever it EXISTS):

```ts
// --- SEGMENT CREATION + MANAGED-CONTAINER PROOF ---
// Prove the COMPLETE managed set {claudeDir, hooksDir} on every anyWrite run,
// decoupled from which child is written. A managed container that EXISTS is
// always gate()d + proveManagedContainer'd (→ pushed to heldOrder → re-proved
// pre-commit); one that is absent is CREATED only when a child is written into
// it this run (Predicate-B strict), else left alone (nothing to secure).
if (anyWrite) {
    const projectHandle = heldByPath.get(projectDir) as SecureDirHandle;
    // .claude always ensured on anyWrite (holds settings; grandparent of the asset).
    // createIfAbsent=true never returns null (opens, creates, or throws) → narrow non-null
    // before passing as parent (JDA6-003 / JDB6-001 — type-check only, apply phase).
    const claudeHandle = await ensureManagedContainer(projectHandle, claudeDir, /*createIfAbsent*/ true);
    // .claude/hooks: create when the asset writes into it; otherwise prove IF it exists
    // (settings-only repair must still secure the executed hook's container).
    await ensureManagedContainer(claudeHandle, hooksDir, /*createIfAbsent*/ needsWrite(input.asset));
}
```

**3. `ensureDir` becomes `ensureManagedContainer(parent, fullPath, createIfAbsent)`** — the same
open/create/gate logic, generalized so an EXISTING container is ALWAYS proven and a create only fires
when `createIfAbsent`:

```ts
async function ensureManagedContainer(
    parent: SecureDirHandle,
    fullPath: string,
    createIfAbsent: boolean,
): Promise<SecureDirHandle | null> {
    const opened = await secureFs.openDirNoFollow(fullPath);
    // (1) PRESENT + openable no-follow → gate + managed-container proof (→ heldOrder).
    if (opened.ok && opened.value) {
        await gate(fullPath, opened.value);                                   // uniform PATH_ENDANGER_DIR
        must(`container ${fullPath}`, await secureFs.proveManagedContainer(fullPath)); // CREATE_PARENT_DIR
        return opened.value;
    }
    // !ok: distinguish GENUINELY ABSENT (ENOENT / ERROR_FILE_NOT_FOUND|ERROR_PATH_NOT_FOUND)
    // from PRESENT-BUT-UNOPENABLE-NO-FOLLOW (reparse point / EACCES / ENOTDIR / transient)
    // via the additive `notFound` discriminator on the refusal (Round-6 / JDA6-001).
    // (4) ANY non-notFound refusal → FAIL CLOSED, regardless of createIfAbsent. A managed
    // container that is PRESENT but unopenable no-follow (a junction/symlink planted at
    // `.claude/hooks`, an EACCES, a transient error) MUST refuse the whole transaction —
    // never be silently skipped. This is the JDA6-001 fix.
    if (!opened.notFound) {
        must(`container ${fullPath}`, opened);   // propagates the refusal → throws; zero mutation
        return null;                             // unreachable (must has thrown)
    }
    // GENUINELY ABSENT from here on (notFound === true — the ONLY safe skip/create path):
    // (3) absent + no child written this run → nothing to secure.
    if (!createIfAbsent) return null;
    // (2) absent + a child IS written into it this run → create Predicate-B strict + prove.
    const created = must(`create ${fullPath}`,
        await secureFs.createDirExclusive(parent, path.basename(fullPath), 0o700));
    must(`revalidate-created ${fullPath}`, await secureFs.revalidateIdentity(fullPath, created.identity));
    createdDirs.push(created);
    await gate(fullPath, created);
    must(`container ${fullPath}`, await secureFs.proveManagedContainer(fullPath));
    return created;
}
```

The Round-4 change had already added `proveManagedContainer` to both `ensureDir` branches; Round-5
added the `createIfAbsent` parameter and the `return null` when a container is genuinely absent — so
an EXISTING `.claude/hooks` is now opened + gated + proved even when no asset is written. **Round-6
(JDA6-001) closes the residual fail-OPEN in that `return null`:** the pre-Round-6 code returned
`null` on ANY `openDirNoFollow` failure, so a container present-but-unopenable-no-follow (a junction
at the managed path, an EACCES) was silently skipped exactly like a genuinely-absent one. Only a
GENUINE `notFound` (ENOENT) now proceeds to create-or-skip; every other refusal fails closed. Both
`createIfAbsent` branches are made explicit above: `createIfAbsent=true` (fresh/asset-only) reaches
`createDirExclusive` ONLY on a genuine `notFound` (a reparse point at the create target now fails
closed BEFORE `createDirExclusive` rather than relying on the incidental `CREATE_NEW`/EEXIST refusal
— stated for symmetry); `createIfAbsent=false` (settings-only) returns `null` ONLY on a genuine
`notFound`, and refuses on a present-but-unopenable container.

**4. Handle "does not exist" vs "present-but-unopenable" correctly (Round-6 / JDA6-001).** If
`hooksDir` is GENUINELY absent (`openDirNoFollow` refuses with `notFound === true`, i.e. ENOENT on
POSIX / `ERROR_FILE_NOT_FOUND`|`ERROR_PATH_NOT_FOUND` on win32) and the run does not need to create
it (settings-only repair, no asset written), it is neither created nor proven — there is no executed
hook to protect and nothing to secure (`createIfAbsent=false` → `return null`). But if it EXISTS —
including the case where it is present but UNOPENABLE no-follow (a reparse point / junction / symlink,
an EACCES, ENOTDIR, or a transient error: `openDirNoFollow` refuses with `notFound` absent/false) —
it MUST NOT be skipped: any non-`notFound` refusal FAILS THE WHOLE TRANSACTION CLOSED, regardless of
`createIfAbsent`, because a compromised or reparse-pointed existing hooks dir means the executed asset
is untrustworthy even on a settings-only change. An existing managed container is NEVER silently
skipped; the ONLY safe skip is a genuine `notFound`.

**5. No `process.platform` branch, no regression.** The core still distinguishes managed containers
from ancestors by WHICH method it calls (`ensureManagedContainer` vs the preflight `gate()` loop),
never by platform. Create/fresh-install path (`needsWrite(asset)=true`): `createIfAbsent=true` →
`.claude/hooks` is created Predicate-B strict + proved, exactly as before — no regression. POSIX:
`proveManagedContainer` delegates to `proveOwnershipAndMode`; on an existing legitimate 0o700 hooks
dir it passes, and the only NEW call vs Round-4 (proving an existing hooks dir on a settings-only run)
is an idempotent re-run of the check `gate()` just performed — zero new refusal surface on any
legitimate tree.

### The completed invariant (precise wording)

> For every managed container in `{claudeDir, hooksDir}` that EXISTS at run time, on every `anyWrite`
> run the core runs `gate()` + `proveManagedContainer` at ensure time AND re-proves it
> (`revalidateIdentity` + the gate proofs + `proveManagedContainer`) in the pre-commit re-prove loop —
> INDEPENDENT of the per-run write plan (which child, if any, is written into it). A managed container
> that does NOT exist and into which no child is written this run is neither created nor proven (there
> is nothing to secure); one into which a child IS written is created Predicate-B-strict and proven.

This closes BOTH JDA-401 (asset-only repair → `.claude`, which `createIfAbsent=true` always ensures)
and JDB5-001 (settings-only repair → `.claude/hooks`, now proven-if-exists) and ANY write-plan
permutation (both-write, asset-only, settings-only, forced-repair) — by construction, because the
managed set is fixed and each existing member is opened+gated+proved on every `anyWrite` run.

### JDB5-001 fix trace (settings-only repair)

`_run(repair)` with `assetPlan=noop`, `settingsPlan=write` → `desiredAsset=null`
(`claude-hook-manager.ts:664-665`), `desiredSettings` serialized (`:666-675`) → `asset.desired===null`
→ `needsWrite(asset)=false`; `settings.desired` non-null → `needsWrite(settings)=true` → `anyWrite=true`.
In `runTransaction`: preflight gates ancestors leniently (unchanged);
`ensureManagedContainer(projectHandle, claudeDir, true)` finds `.claude` existing → `gate()` +
`proveManagedContainer(claudeDir)`; then `ensureManagedContainer(claudeHandle, hooksDir,
/*createIfAbsent=*/false)` — **Round-5: `.claude/hooks` EXISTS → it is now `openDirNoFollow`'d,
`gate()`d, and `proveManagedContainer`'d** (under Round-4 this call was skipped entirely because
`needsWrite(asset)=false`). The pre-existing foreign `FILE_DELETE_CHILD` on `.claude/hooks` trips the
uniform `PATH_ENDANGER_DIR` inside `gate()`'s `proveDacl` → REFUSE (`unsafe-windows-dacl` /
`foreign trustee <SID> path-endangering`), ZERO mutation; a foreign `FILE_ADD_FILE` would trip
`proveManagedContainer`'s `CREATE_PARENT_DIR` → `add-child`. `.claude/hooks` is now in `heldOrder`, so
the pre-commit re-prove loop re-proves it too (TOCTOU parity). Under Round-4 this reached commit
(hooks-dir was never opened → zero checks). Covered by a host-independent core-seam test (fake accepts
the lenient `gate()` on `.claude/hooks` but refuses `proveManagedContainer(.claude/hooks)`, driven
through a settings-only repair → transaction refuses, zero mutation) + real-ACL `ACL-8`/`ACL-8b` on
`windows-latest`.

### JDB5-003 determination — option (a), accepted residual (with boundary)

The container-implies-integrity argument, verified against the predicate:

- **Asset-NAME integrity holds by construction.** Swapping the asset by name requires deleting/renaming
  the existing file (needs `FILE_DELETE_CHILD` on `.claude/hooks`) and/or creating a same-named
  replacement (needs `FILE_ADD_FILE`). `proveManagedContainer(hooksDir)` now runs on every `anyWrite`
  run and refuses BOTH via `CREATE_PARENT_DIR = PATH_ENDANGER_DIR | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY`
  (and the uniform `gate()` refuses `FILE_DELETE_CHILD` via `PATH_ENDANGER_DIR` independently). So no
  foreign principal can swap, delete, rename, or plant the asset — the JDB5-001 exploit class is closed.
- **Asset-CONTENT integrity holds transitively for tool-created assets.** In-place foreign rewrite of
  the existing asset needs a foreign `FILE_WRITE_DATA`/`FILE_APPEND_DATA` ACE on the FILE itself
  (`PATH_ENDANGER_FILE` bits), which `proveManagedContainer` (a CONTAINER proof) does not read. But any
  asset our tool created is Predicate-B owner-only + `SE_DACL_PROTECTED` (inheritance-stripped) → it
  carries NO foreign write ACE → in-place foreign rewrite is impossible. Thus for a tool-managed
  installation (the repair target), container integrity + Predicate-B-at-birth together give full asset
  integrity (name AND content).
- **The single uncovered case** is a NON-tool-created asset that (i) byte-matches the manifest sha at
  the Slice-2 read AND (ii) carries a foreign `FILE_WRITE_DATA` ACE set directly on the file. This is a
  contrived provisioning outside the tool's own creation path; even if detected, a settings-only run
  could only REFUSE it (it does not rewrite the asset, so it cannot strip the ACE). Detecting it is
  option (b): on settings-only repairs, `captureFile(asset)` (O_NOFOLLOW) + prove the asset file's DACL
  (`PATH_ENDANGER_FILE`) + re-check its sha against `currentAssetSha`, refusing on drift or a foreign
  content-write ACE.

**Decision: (a).** Accept the residual because JDB5-003 is a SUGGESTION, the exploit-relevant
swap/delete/plant class is closed by construction, and tool-created assets are content-safe via
Predicate B. Option (b) is recorded as the deferred stronger posture (residual JDB5-003 / open risk),
consistent with the design's treatment of the W5 digest-TOCTOU residual — chosen honestly rather than
claiming container integrity fully implies content integrity, which it does NOT for the contrived
foreign-file-ACE case.

### JDB5-002 — rollback re-stage (documented + cheap hardening)

Rollback is UNDO-only: it re-stages prior bytes into a FRESH nonce'd `tempName` via `writeExclusive`
(`CREATE_NEW`, the `O_EXCL` analog → a foreign file planted at that name refuses) then `renameInDir`,
and `gateStillValid` already `revalidateIdentity`s every held handle, so a foreign add-child on the
container cannot intercept our create+identity+rename — hence Judge B's non-blocking rating is correct.
For full symmetry the design ALSO adds `proveManagedContainer` to `gateStillValid` for held handles
whose path ∈ `{claudeDir, hooksDir}` (the same one-line `Set` membership test used in the pre-commit
loop), so the container add/delete-child dimension is re-checked on the rollback path too — cheap and
symmetric, closing the WARNING by construction rather than by argument.

### JDA-501 — projectDir scope (one sentence)

The `projectDir` immediate parent of `.claude` is DELIBERATELY traversal-lenient (it gets the uniform
`gate()` — `FILE_DELETE_CHILD` on it is refused, and our component is protected by `CREATE_NEW` +
reparse-refusal + identity revalidation — but NOT the strict `CREATE_PARENT_DIR` add-child refusal,
because `projectDir` is a user-owned working directory, not a dir the tool owns), and project-root
files OUTSIDE the tool's managed set (`CLAUDE.md`, `.mcp.json`, etc.) are EXPLICITLY out of the tool's
integrity guarantee — the tool guarantees only `.claude/settings.json` and `.claude/hooks/<asset>`.

---

## Judgment-Day Round 6 reconciliation

Round 5 closed JDB5-001 by proving the complete managed set `{claudeDir, hooksDir}` prove-if-exists on
every `anyWrite` run via `ensureManagedContainer`. Round 6's two blind judges split again: Judge A
surfaced ONE BLOCKER (JDA6-001) plus two lower findings (JDA6-002 WARNING, JDA6-003 SUGGESTION); Judge
B assessed the `ensureManagedContainer` path CLEAN. My adjudication: **Judge A is right on JDA6-001 — it
stands as a BLOCKER**; Judge B missed the junction/reparse case exactly as the A→B roles inverted from
Round 5. The ratified predicates (Predicate A/B, `CREATE_PARENT_DIR`, the trusted SID sets,
`MapGenericMask`, C1-C4), the `proveManagedContainer` seam, the `{claudeDir, hooksDir}` managed set,
and the completed-invariant wording are all CORRECT and UNCHANGED — Round 6 makes the invariant TRUE
(it was falsifiable before, because "EXISTS at run time" was silently conflated with "openable
no-follow"). The defect is a residual fail-OPEN inside `ensureManagedContainer`'s handling of
`openDirNoFollow` failure.

| Finding | Judge refs | Resolution |
|---|---|---|
| **JDA6-001 (BLOCKER)** — `openDirNoFollow` (`secure-fs-posix.ts:207-212`) collapses EVERY failure — genuine ENOENT, ELOOP/reparse-point, EACCES, ENOTDIR, transient — into one indistinguishable `refuse("unsafe-parent-chain")`. On a settings-only repair, `ensureManagedContainer(_, hooksDir, createIfAbsent=false)` then took `return null` on ANY failure → the container was silently SKIPPED (never gated, never `proveManagedContainer`'d, not in `heldOrder`). Exploit: a junction planted at `.claude/hooks` (by a previously-privileged attacker who removed their `.claude` ACE, or a user who legitimately symlinked it) — the Slice-2 plain classify read (`claude-hook-manager.ts:452-453,611`) FOLLOWS the junction and byte-matches the asset sha → `assetPlan=noop` → settings-only run; `openDirNoFollow(hooksDir)` refuses (reparse) → swallowed → `return null` → skip → `settings.json` commits referencing `.claude/hooks/pre-tool-use.mjs` which resolves THROUGH the attacker junction → Claude Code loads an attacker-controlled hook, SkillGuard subverted, the tool reports `ok`. The asymmetry that proves it a defect: `createIfAbsent=true` (fresh/asset-only) fail-CLOSES on the same junction (`openDirNoFollow` fails → `createDirExclusive` → EEXIST → refuse); only `createIfAbsent=false` fail-OPENED. Violates the Decision-2 bar "never degrade silently; any inconclusive result refuses." | JDA6-001 (Judge A; Judge B missed the junction case) | **Fixed below.** Additive `notFound` discriminator on `openDirNoFollow`'s refusal + 4 fail-closed `ensureManagedContainer` branches: only a genuine `notFound` skips/creates; every other refusal fails the transaction closed. |
| **JDA6-002 (WARNING/info)** — with the fix, a GENUINELY-deleted `hooksDir` (ENOENT, `createIfAbsent=false`) still returns `null`, and `settings.json` could commit referencing a now-absent hook. | JDA6-002 (Judge A, non-blocking) | **Accepted residual.** Settings referencing a MISSING hook merely fails to load — no code executes; the tool guarantees no attacker-controlled execution, NOT that the referenced hook exists after external deletion. Same stale-classify-read class as JDB5-003(a). Recorded, non-blocking. |
| **JDA6-003 / JDB6-001 (SUGGESTION)** — the `claudeHandle: SecureDirHandle \| null` returned by the `createIfAbsent=true` call to `ensureManagedContainer` needs a non-null narrowing before being passed as `parent` to the `hooksDir` call. | JDA6-003 (Judge A) / JDB6-001 (Judge B) | **Flagged for apply (type-check only).** `createIfAbsent=true` never returns `null` (it opens, creates, or throws); assert/narrow non-null at the call site so it type-checks. See below. |

### The exact fix (JDA6-001) — the `notFound` discriminator + 4 fail-closed branches

**1. `openDirNoFollow` surfaces a distinguishable NOT-FOUND signal, additive to the existing refusal.**
Keep the `refuse("unsafe-parent-chain", …)` shape; add an optional `notFound?: boolean` to the
refusal, set to `true` ONLY for a genuine absence:

- **POSIX** (`secure-fs-posix.ts:207-212`): `notFound: true` iff `errCode(error) === "ENOENT"`. Every
  other errno — `ELOOP`/reparse, `EACCES`, `ENOTDIR`, transient — leaves `notFound` absent/false.
- **win32** (`secure-fs-windows.ts` / `.ps1` `openDir`): `notFound: true` iff the `CreateFile` status is
  `ERROR_FILE_NOT_FOUND` (2) or `ERROR_PATH_NOT_FOUND` (3). A junction OPENS (the handle uses
  `FILE_FLAG_OPEN_REPARSE_POINT`) and is refused by the reparse-attribute check with `notFound` absent;
  `ERROR_ACCESS_DENIED` and every transient status are plain refusals with `notFound` absent.

**2. `ensureManagedContainer` — the 4 fail-closed branches** (authoritative code in the Round-5
section, updated in place):

- `opened.ok` → `gate()` + `proveManagedContainer` + push `heldOrder` + return handle (unchanged).
- `!ok && notFound && createIfAbsent` → `createDirExclusive` (Predicate-B strict) path (unchanged).
- `!ok && notFound && !createIfAbsent` → `return null` (genuinely absent, nothing to secure — the ONLY
  safe skip).
- `!ok && !notFound` (ANY non-ENOENT refusal — reparse/EACCES/ENOTDIR/transient) → **FAIL CLOSED:
  propagate the refusal via `must(opened)`, regardless of `createIfAbsent`.** A present-but-unopenable
  managed container (a junction at `.claude/hooks`) now REFUSES the whole transaction with zero
  mutation instead of being silently skipped. This is the JDA6-001 fix.

Both `createIfAbsent` branches are made explicit that only a genuine `notFound` proceeds to
create-or-skip; the `createIfAbsent=true` reparse case fails closed on the explicit `!notFound` branch
(no longer relying on the incidental `createDirExclusive`/EEXIST refusal — stated for symmetry).

**3. No regression.** Fresh install (genuine ENOENT → create) still works; a legitimate existing 0o700
hooks dir opens fine (POSIX/win32) → gated + proved; the settings-only clean case (real dir) still
proves it. POSIX invariance preserved: only ENOENT is `notFound`, so a group/other-writable existing
dir still OPENS then refuses at `proveOwnershipAndMode` (unchanged) — the discriminator only splits
the FAILURE-to-open path, never the successful-open gate.

**4. JDA6-002 — residual (non-blocking).** A genuinely-deleted `hooksDir` (ENOENT, `createIfAbsent=false`)
still returns `null`; `settings.json` could commit referencing a now-absent hook. Documented residual:
a settings entry pointing at a missing hook merely fails to load — no code executes — so the tool's
guarantee (no attacker-controlled execution) holds; it does NOT guarantee the referenced hook still
exists after an external deletion between the Slice-2 classify read and the transaction. Same
stale-classify-read class as JDB5-003(a). Recorded, non-blocking.

**5. JDA6-003 / JDB6-001 — non-null narrowing (apply, type-check only).** The
`ensureManagedContainer(projectHandle, claudeDir, /*createIfAbsent*/ true)` call returns
`SecureDirHandle | null`, but `createIfAbsent=true` NEVER returns `null` (it opens, creates, or
throws). Before passing the result as `parent` to the `hooksDir` call, apply a non-null narrowing
(a `must`-style non-null assertion or an explicit `if (!claudeHandle) throw` guard) so the code
type-checks. Flagged for the apply phase; no design change.

### JDA6-001 fix trace (settings-only repair, junction at `.claude/hooks`)

`_run(repair)` with a JUNCTION at `.claude/hooks`: the Slice-2 plain classify read
(`claude-hook-manager.ts:452-453,611`) FOLLOWS the junction, the referenced `pre-tool-use.mjs`
byte-matches the manifest sha → `assetPlan=noop` → `asset.desired===null` → `needsWrite(asset)=false`;
`settings` drifted → `needsWrite(settings)=true` → `anyWrite=true`. In `runTransaction`:
`ensureManagedContainer(projectHandle, claudeDir, true)` gates + proves `.claude`; then
`ensureManagedContainer(claudeHandle, hooksDir, /*createIfAbsent=*/false)` — `openDirNoFollow(hooksDir)`
opens the junction with `FILE_FLAG_OPEN_REPARSE_POINT` and refuses on the set reparse attribute with
`notFound === false` (POSIX: `open(..., O_NOFOLLOW)` → `ELOOP`, `notFound` absent). **Round-6: the
`!ok && !notFound` branch fires → `must(opened)` propagates the refusal → the whole transaction
REFUSES with ZERO mutation.** Under the pre-Round-6 code this hit `return null` (any-failure skip) →
`.claude/hooks` was skipped → `settings.json` committed referencing a hook that resolved THROUGH the
attacker junction → attacker-controlled hook loaded, tool reported `ok`. Covered by the host-independent
core-seam test (fake `openDirNoFollow` returns a non-`notFound` refusal for `hooksDir` on a
settings-only run → `ensureManagedContainer` propagates, zero mutation) + real-junction `ACL-9`/`ACL-9b`
on `windows-latest`.
