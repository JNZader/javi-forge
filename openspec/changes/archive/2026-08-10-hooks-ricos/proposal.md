# Proposal: hooks-ricos — adopt richer hook bodies fleet-wide (fail-closed, no degrade)

## Intent

Backlog item HOOKS-1 asked to promote the richer `ci-local/hooks/*` variants into the
shipped/installed hook assets fleet-wide. The exploration (engram
`sdd/hooks-ricos/explore`) **corrected HOOKS-1's premise**: the SHIPPED
`assets/hooks/pre-push` is ALREADY fail-closed on Docker
(`assets/hooks/pre-push:5-9` — `if ! docker info; then exit 1`), and it is the
`ci-local/hooks/pre-push` VARIANT that DEGRADES when Docker is down
(`ci-local/hooks/pre-push:14-33` — falls through to `javi-forge ci --quick --no-docker
--no-security`). Adopting that variant verbatim would REGRESS the fail-closed policy the
archived `containerized-gates` change established
(`openspec/specs/ci-gates/spec.md`, "Fail-closed containerized gate execution matrix").

This change therefore adopts the variants' **richness and ergonomics WITHOUT the
Docker-down degrade branch**, and — for pre-push — reframes what the gate runs so the
fail-closed guarantee lives at the GATE LAYER rather than at a Docker-presence check.
Success = both hook bodies land as versioned, auto-upgrading assets; commit-msg gains the
full anti-attribution guardian PLUS conventional-commit enforcement; pre-push runs a
substantive native gate that cannot silently pass an image gate; HOOKS-1 is closed at
archive.

## Scope

### In Scope
- **Slice A — commit-msg**: replace `assets/hooks/commit-msg` with the rich variant body
  (NFKC normalization, ~30 pattern families, RAW+normalized double-match); ADD
  conventional-commit subject enforcement with an explicit exemption set; promote
  `ci-local/hooks/commit-msg.test.sh` to a shipped/wired test asset; bump
  `manifest.json` `commit-msg.version` and retain the current v1 `sha256` in
  `historical[]`.
- **Slice B — pre-push**: replace `assets/hooks/pre-push` with a body that runs a
  substantive NATIVE gate (`javi-forge ci --quick --no-docker --no-security`) and adopts
  the variant's richer ergonomics (elapsed-time logging, clearer messaging) but STRIPS its
  Docker-down degrade branch; bump `manifest.json` `pre-push.version` and retain the v1
  `sha256` in `historical[]`.
- Update the byte-equivalence / manifest guard tests that snapshot released hashes
  (`src/__tests__/hook-assets.test.ts` `RELEASED_SNAPSHOT`, append-only per its own
  contract at `hook-assets.test.ts:34-45`) plus `src/commands/ci-hooks.test.ts` and
  `src/commands/ci.test.ts` as needed.

### Out of Scope
- **PREPUSH-EACCES** (containerized full pre-push run broken by pnpm EACCES in the
  runner). Approach 1 sidesteps it entirely, so it is NOT a prerequisite; it stays a
  separately-tracked backlog follow-up affecting only anyone who wants the containerized
  pre-push back.
- `assets/hooks/pre-commit` — unchanged (not in the richer-variant set).
- Any change to the hook INSTALL machinery (`classifyHookContent`, `renderHook`,
  `installCIHooks`) — the marker/manifest system already handles new bodies (see Approach,
  Slice B note; if commit-msg enforcement needs a code path beyond the shell body it is
  called out as an open question, not assumed).
- Closing HOOKS-1 in `docs/BACKLOG.md` — done at ARCHIVE, not in this proposal.
- Homoglyph / adversarial-grade attribution defense — the variant explicitly documents
  this as a non-goal (`ci-local/hooks/commit-msg:19-27`); unchanged.

## Scope Decision

- **Mode**: Selective
- **Justification**: The incoming scope is NOT accepted by default. The CEO lens
  challenged three things and trimmed/reframed each: (1) HOOKS-1's "make pre-push degrade
  when Docker is down" is REJECTED outright — it inverts the governing fail-closed policy,
  so we keep no-degrade. (2) Adopting the pre-push variant verbatim is REJECTED; instead
  pre-push is reframed to a native substantive gate so it neither degrades NOR inherits
  the PREPUSH-EACCES block — a deliberate reduction of blast radius. (3) The
  conventional-commit regex is a genuine EXPANSION beyond HOOKS-1 (user opted in), scoped
  to the subject line with an explicit exemption allowlist so local WIP/merge/fixup flows
  are not blocked. PREPUSH-EACCES and pre-commit are held out. Net: adopt the high-value
  richness, reject the one behavior that regresses policy, add one opt-in expansion behind
  an explicit exemption gate.

## Approach

Two INDEPENDENT slices (commit-msg and pre-push share no code). Sequence A then B; keep
them as separate PRs. Both are low-risk.

### Slice A — commit-msg (rich + conventional-commit regex + test asset + manifest)

1. Replace `assets/hooks/commit-msg` with the `ci-local/hooks/commit-msg` body: NFKC
   normalization (`ci-local/hooks/commit-msg:41-67`), the ~30 pattern families
   (`:83-129`), and the RAW+normalized double-match loop (`:133-135`). This already
   enforces the no-AI-attribution guardian (rejects `Co-Authored-By` / Claude-Session /
   provider variants) per the user's standing convention.
2. ADD conventional-commit SUBJECT enforcement — subject must match
   `^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)(\([a-z0-9._-]+\))?!?: .+`,
   applied to the first non-empty subject line only. EXEMPTIONS (must not be blocked):
   - merge commits — `^Merge `
   - autosquash prefixes — `^(fixup|squash)! ` (git re-applies these at rebase; the
     underlying commit was already validated)
   - revert bodies — git's generated `Revert "..."` subject
   The exact exemption set is a spec-time confirmation (see Open Questions).
3. Promote `ci-local/hooks/commit-msg.test.sh` (~90 cases) to a shipped/tested asset and
   wire it into the test run so the guardian + new regex are regression-covered.
4. Manifest: bump `manifest.json` `commit-msg.version` 1→2 and append the current v1
   `sha256` (`1c23a60cd4ba7f6bc666da400b5d2971c4294782c8d9ce41543e7815de11a1d6`,
   `manifest.json:23`) to `commit-msg.historical[]`. Also append it to
   `RELEASED_SNAPSHOT["commit-msg"].historical` in `src/__tests__/hook-assets.test.ts`
   in the SAME PR (the append-only forward-maintenance guard, `hook-assets.test.ts:34-45`).

### Slice B — pre-push (native substantive gate, no degrade, richer ergonomics + manifest)

1. Replace `assets/hooks/pre-push` with a body that:
   - runs `javi-forge ci --quick --no-docker --no-security` (native validate + coverage)
     unconditionally — NO `docker info` branch, NO degrade fallthrough.
   - adopts the variant's ergonomics: `$SECONDS` elapsed-time logging and clearer
     abort/skip messaging (`ci-local/hooks/pre-push:12,35-39`).
   - keeps `git push --no-verify` as the documented escape hatch.
2. Fail-closed is PRESERVED AT THE GATE LAYER, not at a Docker check: under `--no-docker`,
   `runGates` still REFUSES any blocking image gate rather than running it native/unpinned
   (`src/commands/ci.ts:1464-1486`; blocking image gate under `--no-docker` →
   `blockingFailures` → build failure). This sidesteps PREPUSH-EACCES (no containerized
   full run) while remaining policy-compliant. KNOWN CONSEQUENCE: a fleet repo that
   DECLARES a blocking image gate will fail-closed on every native pre-push — that is the
   policy biting by design, not a bug. `javi-forge` itself declares no image gates, so
   native pre-push runs clean.
3. Manifest: bump `manifest.json` `pre-push.version` 1→2 and append the current v1
   `sha256` (`7de58640aeef33085a49f31f1d9d0c8bacde0069d6d3265ae41aa8d3cd14d7a5`,
   `manifest.json:13`) to `pre-push.historical[]`; mirror into
   `RELEASED_SNAPSHOT["pre-push"].historical` in the same PR.

### Upgrade UX (both slices)

Retaining the outgoing hash in `historical[]` is what makes rollout SILENT: an existing
marked v1 install computes its body hash, finds it in `historical[]`, and classifies
`managed-outdated` → auto-upgrade on the next `ci init` with NO `--force` and NO `.bak`
(`classifyHookContent`, `src/commands/ci.ts:1759-1761`). DROPPING the old hash would flip
it to `managed-edited` → refused without `--force` (`ci.ts:1761`). Legacy unmarked repos
(~8 fleet installs) upgrade via the `legacy-v0` path regardless (`ci.ts:1767-1768`). No
`ci.ts` install LOGIC change is required — `HOOK_NAMES` and the `installCIHooks` loop
(`ci.ts:1700,2087`) already iterate all three hooks from the single `assets/hooks/*`
source hashed by the manifest.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `assets/hooks/commit-msg` | Modified | rich body + conventional-commit subject regex + exemptions |
| `assets/hooks/pre-push` | Modified | native substantive gate, no degrade, richer ergonomics |
| `assets/hooks/manifest.json` | Modified | version 1→2 + append v1 hash to `historical[]` for both hooks |
| `ci-local/hooks/commit-msg.test.sh` | Promoted | shipped/tested asset wired into the test run |
| `src/__tests__/hook-assets.test.ts` | Modified | append outgoing hashes to `RELEASED_SNAPSHOT` (append-only guard) |
| `src/commands/ci-hooks.test.ts` | Modified (verify) | classification/upgrade coverage for v2 bodies |
| `src/commands/ci.test.ts` | Modified (verify) | any install/render assertions coupled to hook bytes |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Conventional-commit regex blocks legitimate local flows (merge/fixup/WIP) | Med | Explicit exemption allowlist (`^Merge `, `^(fixup\|squash)! `, revert bodies); confirm exact set at spec time; regression-cover in commit-msg.test.sh |
| Dropping the outgoing hash → `managed-edited` → refused upgrade (fleet-brick) | Med | Retain v1 hash in `historical[]` AND `RELEASED_SNAPSHOT` in the same PR; the append-only guard (`hook-assets.test.ts:34-45`) fails the build if omitted |
| Fleet repo with a blocking image gate fails-closed on every native pre-push | Med | Documented KNOWN CONSEQUENCE of the fail-closed policy; not a regression; escape hatch `--no-verify` remains |
| commit-msg enforcement needs logic beyond the shell body | Low | Verify at spec time; if true, note the additional code path (see Open Questions) — do not assume `ci.ts` is untouched |
| `perl`/`Unicode::Normalize` absent on a fleet host degrades NFKC | Low | Variant already degrades to RAW-only matching (`ci-local/hooks/commit-msg:41-48,66`); guardian still fires on literal patterns |

## Rollback Plan

Purely asset-level. Revert = restore the v1 `assets/hooks/*` bodies and revert the
`manifest.json` version bump + `historical[]` append (and the mirrored `RELEASED_SNAPSHOT`
entry). No persisted consumer state; the marker/manifest classifier re-derives everything
from the shipped assets. Published via semantic-release; a patch release reverts cleanly
for the global install and ~8 hook consumers. Because `historical[]` is append-only, even
a repo that already auto-upgraded to v2 re-classifies cleanly against a reverted manifest.

## Open Questions (spec-time)

1. **Exact conventional-commit exemption set** — confirm the allowlist: `^Merge `,
   `^(fixup|squash)! `, git-generated `Revert "..."` subjects. Should we also exempt
   `^Revert ` broadly, or only git's exact form? Any need to allow a bare WIP prefix for
   local-only branches (vs relying on `--no-verify`)?
2. **commit-msg enforcement location** — confirm the subject regex lives entirely in the
   shell hook body (no `ci.ts` code path). If a shared validator is preferred for reuse by
   `javi-forge ci`, that is a code path beyond the hook body and expands Slice A scope.
3. **Test-asset placement** — where does the promoted `commit-msg.test.sh` ship (under
   `assets/hooks/` vs a test-only dir) and how is it invoked in CI (vitest shim vs a
   dedicated shell step)? The hook-asset byte guard covers only the 3 hook BODIES, not the
   test script.
4. **pre-push gate composition** — confirm `--quick --no-docker --no-security` is the
   intended substantive subset (validate + coverage) vs including/excluding
   `--no-ci-ghagga` (the variant passes `--no-ci-ghagga` only on its degrade branch,
   `ci-local/hooks/pre-push:26`).
