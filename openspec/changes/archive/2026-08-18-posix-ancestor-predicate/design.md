# Design: Narrow the POSIX Ancestor ACL Predicate to Path-Endangering Entries (JD-P-001)

## Technical Approach

Split the single blunt any-extended-ACL predicate into two role-scoped predicates and let the
transaction core pick which one to call by the role it already knows (`managedContainers` set),
never by `process.platform`. Ancestors get a new **lenient** `proveNoEndangeringAcl` that parses
`getfacl` and refuses only entries that let a foreign principal swap/delete/rename the on-path
node. Managed containers (`.claude`, `.claude/hooks`) keep the **strict** any-extended-entry check,
relocated INTO POSIX `proveManagedContainer` so their net guarantee stays byte-identical. Faithful
mirror of ratified Windows Predicate A (lenient uniform gate + extra strictness in
proveManagedContainer). Approach A (full effective-permission computation) — DECIDED, not reopened.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|---|---|---|---|
| Owner-UID source for carve-out | **lstat the dir** (reuse the uid the ancestor gate already needs) | drop `--omit-header`, parse `# owner:` line | Current spawn uses `--omit-header`; keeping it means ONE parser shape (base/named/mask/default) with no header branch. `lstat` is already done by `proveOwnershipAndMode` — the uid is authoritative, cheaper than re-parsing header text, and immune to getfacl output drift. Keeps `--numeric` + `--omit-header` unchanged. |
| Mask math | Compute `effective = raw ∩ mask` ourselves; parse `mask::` once | Trust getfacl's inline `#effective:` suffix | getfacl only emits `#effective:` when it DIFFERS — absence is ambiguous. Owning `user::`/`other::` are NOT mask-limited; only named-user/named-group/owning-group are. |
| Strict/lenient split | New adapter method `proveNoEndangeringAcl` (lenient) alongside `proveNoExtendedAcl` (strict); core selects by `managedContainers` | platform branch in engine; one method with a flag arg | Mirrors how the core already expresses managed-container role via WHICH method it calls. No `process.platform` in the transaction engine (invariant). |
| macOS | darwin `proveNoEndangeringAcl` = its `proveNoExtendedAcl` (no-op to strict) | parse `/bin/ls -lde` ACE text for effective rights | Deferred (user: Linux only). darwin ancestors stay strict = status-quo over-refusal, not the reported bug. Documented follow-up. |
| Default ACL disposition | TOLERATE `default:*` on ancestors | refuse | Default ACLs affect only inheritance of FUTURE children, not the on-path node. Backstopped by the strict managed-container check on the CREATED `.claude` (chmod does not strip inherited named entries → strict check is the real guard). |

## The lenient predicate `proveNoEndangeringAcl` (parser pseudocode)

Same spawn as strict: `getfacl --absolute-names --numeric --omit-header -- <target>`, `LC_ALL=C`,
2s bound, `--numeric`. Same spawn-failure fail-closed edges (absent/timeout/nonzero → refuse).

```
proveNoEndangeringAcl(target):
  ownerUid = lstat(target).uid        # authoritative carve-out source
  euid     = geteuid()
  trusted  = { ownerUid, 0, euid }

  # PASS 1 — find the mask (order-independent). Refuse an unparseable mask line.
  mask = ALL                          # sentinel: "no mask entry present"
  for line in nonEmptyNonComment(stdout):
    strip inline "#effective:..." suffix (tab-separated) before matching
    if line matches /^mask::([r-][w-][x-])$/:  mask = parsePerms($1)
    elif line matches /^mask::/:               refuse(extendedAclEntry)   # malformed mask

  # PASS 2 — classify each entry.
  for line in nonEmptyNonComment(stdout):
    strip inline "#effective:" suffix
    switch classify(line):
      BASE       /^(user|group|other)::/            -> ALLOW  # base write owned by proveOwnershipAndMode mode&0o022
      MASK       /^mask::/                           -> ALLOW  # ceiling, already parsed in PASS 1
      DEFAULT    /^default:/                         -> ALLOW  # inheritance-only; strict managed-container backstop
      NAMED_USER /^user:(\d+):([r-][w-][x-])$/       -> checkNamed(uid=$1, raw=$2, maskLimited=true, isUser=true)
      NAMED_GRP  /^group:(\d+):([r-][w-][x-])$/      -> checkNamed(gid=$1, raw=$2, maskLimited=true, isUser=false)
      OWNING_GRP # group:: handled by BASE above
      else                                          -> refuse(extendedAclEntry)  # unrecognized shape → fail closed

  return ok()

checkNamed(id, raw, maskLimited, isUser):
  if 'w' not in raw:            return ALLOW           # x-only traverse / r-only read ≠ endanger
  # raw has 'w' — apply mask ceiling
  if mask == ALL and no "mask::" entry existed and rawHasW:
      # a named entry carrying raw w REQUIRES a mask to be effective; POSIX always
      # emits a mask when a named entry exists. Its absence is anomalous → FAIL CLOSED.
      refuse(extendedAclEntry)
  effective = raw ∩ mask
  if 'w' not in effective:      return ALLOW           # e.g. user:1000:rwx under mask::r-- → r-- → allow
  # effective w present:
  if isUser and id in trusted:  return ALLOW           # owner/root/euid = owner-equivalent (POSIX CREATOR OWNER analog)
  return refuse(extendedAclEntry)                       # foreign named-user OR any named-group with effective w
```

Refuse decision (the ONLY new REFUSE surface): a named-user with FOREIGN uid (∉ {ownerUid,0,euid})
AND effective `w`, OR any named-group with effective `w` (all named groups treated as
potentially-foreign — a foreign principal may be a member). Detail token reuses
`ACL_DETAIL.extendedAclEntry` (no new remediation-table key needed).

Fail-closed edges (all → refuse): getfacl absent/timeout/nonzero (unchanged); unrecognized/unparseable
line; malformed `mask::`; named entry with raw `w` when no mask entry present. Symlink ancestors
already refused upstream by `O_NOFOLLOW` in `openDirNoFollow`.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/lib/secure-fs-posix.ts` | Modify | Add `proveNoEndangeringAcl` to `PosixAclAdapter` + Linux adapter (lenient parser above); darwin adapter's `proveNoEndangeringAcl = proveClean` (no-op to strict). Add `proveNoEndangeringAcl` to `createPosixSecureFs` delegating to `acl`. POSIX `proveManagedContainer` gains the STRICT `acl.proveClean` check AND-ed with `proveOwnershipAndMode`. `LINUX_BASE_ENTRY`, `proveClean`, `proveOwnershipAndMode`, leaf `source-acl` UNCHANGED. |
| `src/lib/secure-fs-transaction.ts` | Modify | Add `proveNoEndangeringAcl` to `PlatformSecureFs` interface. `gate()` :292 calls `proveNoEndangeringAcl` (lenient). `gateStillValid()` :364 ancestor arm calls `proveNoEndangeringAcl`; managed-container arm (:367-371) unchanged (its `proveManagedContainer` now carries strict ACL). |
| `src/lib/secure-fs-posix.test.ts` | Modify | New unit table (injected getfacl) — see Testing. |
| `src/__integration__/secure-fs-posix.integration.test.ts` | Modify | Move base resolution back under `$HOME`/`RUNNER_TEMP` (drop `JF_INT_BASE`); add real-`setfacl` cases. |
| `.github/workflows/claude-hook-linux.yml` | Modify | Drop `JF_INT_BASE=/jf-int` + `/jf-int` fixture step; add a golden-capture diagnostic step (below). |

## The split — exact call-site changes

`gate()` and `gateStillValid` today call the SAME strict `proveNoExtendedAcl` on ancestors AND
managed containers. The narrowing must be applied at BOTH ancestor call-sites consistently, and the
strict guarantee re-homed into the managed-container proof:

| Call-site | Today | After |
|---|---|---|
| `gate()` :292 (every held dir incl ancestors) | `proveNoExtendedAcl` (strict) | `proveNoEndangeringAcl` (lenient) |
| `gateStillValid()` :364 (re-prove ALL held handles) | `proveNoExtendedAcl` (strict) | `proveNoEndangeringAcl` (lenient) |
| `gateStillValid()` :367-371 managed-container arm | `proveManagedContainer` (= ownership only) | UNCHANGED call — but `proveManagedContainer` now ALSO runs strict ACL |
| `ensureManagedContainer` :320,:351 | `proveManagedContainer` | UNCHANGED call — strict ACL now inside |
| POSIX `proveManagedContainer` :487-489 | `proveOwnershipAndMode` only | `proveOwnershipAndMode` AND `acl.proveClean` (strict) |
| leaf `source-acl` :434, `applyExactMode` :425 | `proveNoExtendedAcl` / `proveClean` | UNCHANGED (stay strict) |

Net: `.claude`/`.claude/hooks` get gated (lenient) THEN proveManagedContainer'd (strict) — so ANY
extended entry on a managed container still refuses, exactly as today. Only the ancestor-only
segments loosen. `applyExactMode`'s re-prove on the STAGED temp file stays strict (out of scope).

## GH /home golden fixture

The exact `getfacl /home` line cannot be captured at design time (no runner in hand). Plan:

1. **CI diagnostic step** in `claude-hook-linux.yml` (with-acl leg, before the integration run):
   `getfacl --absolute-names --numeric --omit-header -- /home` dumped to the job log AND written to
   `$RUNNER_TEMP/getfacl-home.txt`, uploaded as an artifact `gh-home-getfacl`. Non-fatal (`|| true`)
   — diagnostic, never a gate.
2. **Golden test** asserts the narrowed predicate ALLOWS the captured `/home` class. Until the exact
   bytes are pinned from a real run, the golden is a REPRESENTATIVE fixture of the documented
   `ubuntu-latest` shape (root-owned uid 0, mode 0755 → mode check passes; a benign
   `mask::` / read-or-exec-only named entry / `default:*`). First green CI run pins the artifact's
   exact line into the fixture constant; a follow-up commit replaces the representative with the
   captured bytes. The integration suite's `aclOffendingAncestors` already walks the whole chain, so
   the real /home entry flows through the REAL adapter regardless.
3. **Default-ACL disposition CONFIRMED**: tolerate on ancestors. `/home` default ACLs (if any) are
   inheritance-only; the strict managed-container check on the created `.claude` is the backstop.
   Flag for user confirmation below.

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | Lenient predicate, injected `SpawnFn` stdout | masked read-only named-user (`user:5000:rwx`+`mask::r--`) ALLOWED; foreign named-user effective-w (`user:5000:rwx`+`mask::rwx`) REFUSED; named-group effective-w REFUSED; x-only foreign (`user:5000:--x`) ALLOWED; owner/root/euid named-user with w ALLOWED (id ∈ trusted); `default:user:5000:rwx` ALLOWED; `mask::` alone ALLOWED; mask-absent-with-named-w REFUSED; unparseable line REFUSED; getfacl nonzero/absent/timeout REFUSED |
| Unit | Managed container STILL strict | benign entry (`user:5000:r--` or `mask::r--`) on `.claude` → `proveManagedContainer` REFUSES (strict path intact) |
| Integration | Real `getfacl`/`setfacl` on a private 0700 base | `setfacl -m u:$FOREIGN:r masked-RO` → ALLOWED; `setfacl -m u:$FOREIGN:rwx` foreign-write → REFUSED; a /home-class entry (mask/read-only/default) → ALLOWED |
| Integration | **Validation-via-revert** | Drop `JF_INT_BASE=/jf-int` from workflow + suite base resolution; base back under `$HOME`/`RUNNER_TEMP`. Suite green = `/home` (real ubuntu ACL) is now ALLOWED = the JD-P-001 over-refusal is closed. Strong regression signal. |

## Threat Matrix

Applicable — the design touches a subprocess boundary (`getfacl` spawn) and a security predicate.

| Row | Applicable? | Safe/failure behavior | RED test |
|---|---|---|---|
| Subprocess argv injection | Applicable | argv array, never a shell string; `--` before target; `--numeric` avoids name resolution | existing spawn contract unchanged; unit asserts argv shape |
| Subprocess timeout/absence | Applicable | absent/timeout/nonzero → refuse (fail-closed, unchanged) | unit: spawnError/timedOut/code≠0 → REFUSE |
| Untrusted tool output parsing | Applicable | unrecognized/malformed line → refuse; mask-absent-with-w → refuse | unit: unparseable REFUSED, malformed mask REFUSED |
| Privilege/effective-permission logic | Applicable | foreign named principal with effective w → refuse; owner/root/euid carve-out | unit: foreign-w REFUSED, trusted-w ALLOWED |
| Symlink/path swap | N/A here | already refused by `O_NOFOLLOW` upstream in `openDirNoFollow` | existing |

## Migration / Rollout

No migration/state. Two-file single-capability change. Rollback = revert both files to blunt refusal
+ re-apply `JF_INT_BASE`.

## Slice / PR plan + size forecast

Single PR (bounded, ~2 core files + tests + CI). Forecast: implementation ~120-170 authored lines
(lenient parser ~70, interface+delegation ~20, proveManagedContainer strict AND ~5, call-site
swaps ~4) + tests ~150-200. **400-line budget risk: Medium** (authored, goldens excluded).
Recommended ONE PR — the change is atomic (loosening ancestors + re-homing strict into
proveManagedContainer MUST land together or the managed-container guarantee regresses). Do NOT slice
the loosen/re-home apart. 3vr MANDATORY (security loosening on fail-closed installer).

**Stays untouched**: `proveOwnershipAndMode` (owner/mode checks), leaf `source-acl` strict check,
`applyExactMode` staged-temp re-prove, `LINUX_BASE_ENTRY`, the Windows adapter, macOS strict
behavior (no-op documented).

## Open Questions

- [ ] **Owner-UID sourcing** — design picks `lstat` over parsing `# owner:`. Confirm (recommended:
  lstat, avoids dropping `--omit-header` and a second parser branch).
- [ ] **Default-ACL tolerance** — design tolerates `default:*` on ancestors, backstopped by strict
  managed-container check. Confirm this is acceptable (recommended: tolerate).
- [ ] **Golden fixture** — exact `/home` line pinned by first green CI run; representative fixture
  until then. Acceptable to land representative + follow-up commit to pin exact bytes?
