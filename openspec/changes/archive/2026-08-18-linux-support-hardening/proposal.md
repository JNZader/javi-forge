# Proposal: Linux Support Hardening

## Intent

On stock Linux the managed Claude `PreToolUse` guard either **cannot be installed** or **silently never fires**, and no diagnostic says so.

| # | Defect | Evidence |
|---|---|---|
| P0-1 | `getfacl` (Debian/Alpine `acl` package, absent from minimal/slim images) missing → install refuses on `/` with opaque `acl /: getfacl absent`, no package hint; doctor never probes it | `secure-fs-posix.ts:123-124`, `secure-fs-transaction.ts:290-295,378-384`, `claude-hook-manager.ts:598-682` |
| P0-2 | Installed hook is exec-form `command: "node"`, but Claude Code on Linux is a native binary — Node is not guaranteed; doctor measures javi-forge's own `process.versions.node`. Spawn failure is FAIL-OPEN (`HOST_RESIDUAL`) | `claude-hook-ownership.ts:59-67`, `claude-hook-manager.ts:55-56,628` |
| P1-3 | Guard refusal `return`s before the hook-profile merge → unrelated secrets/deps wiring lost | `init/steps/security.ts:85-93,99-104` |
| P1-4 | The only real-POSIX test roots under `/tmp` (mode 1777) → refusal → `if (!first.ok) return;` asserts nothing on every Linux host, permanently. `setfacl` absent from `src/`. Windows has a real-NTFS CI job; Linux has none | `claude-hook-manager.run.test.ts:304-328`, `.github/workflows/claude-hook-windows.yml` |
| P2 | Strict `=== true` for `allowManagedHooksOnly`; docs say an invalid value is treated as `true` → false `runnable` (fail-open) | `claude-hook-settings.ts:113-115` |

## Scope

### In Scope
- **Slice A (~150-250 lines)** — ACL-capability probe as a `hooks doctor claude` row; `SecureRefusal → remediation` mapping (`apt install acl` · `apk add acl` · `dnf install acl`); init reports the refusal but still runs the `setHookFeature` merge; document the `acl` dependency in README/help.
- **Slice B (~200 lines + workflow)** — real-Linux integration suite rooted at a PRIVATE 0700 base (`RUNNER_TEMP`/`mkdtemp` under `$HOME`, never `/tmp`): clean install, idempotent re-run, real `setfacl -m u:nobody:r` → `unsupported-posix-acl`, and a PATH-without-getfacl leg. Two CI legs: with `acl` and with getfacl actively removed/shadowed.
- **Slice C (~80-120 lines)** — doctor resolves `node` on PATH independently (`node --version`), reported as a row DISTINCT from `process.versions.node` and labelled a HEURISTIC; plus invalid non-boolean `allowManagedHooksOnly`/`disableAllHooks` treated per documented semantics (never silently clear).

### Out of Scope
- **Approach D** (getfacl-less ACL fallback) — REJECTED: no stable Node xattr API; a hand-rolled binary ACL parser is a new security-critical surface that weakens an airtight proof.
- **Approach E** (podman/rootless `--userns=keep-id`/SELinux relabel) — separate change `container-engine-linux`; needs a real Fedora box.
- P2 runtime-`.mjs` sensitive-path additions (`/proc/*/environ`, `/etc/shadow`, …) — touching the asset rotates its SHA and the settings identity; deliberate asset-version-bump change only, never a drive-by.
- Hidden `.x.json` drop-ins, `package:check` `/tmp` path, jargon strings.

## Scope Decision

- **Mode**: Selective
- **Justification**: The incoming A+B+C set is already the minimal high-value slice — it closes both P0s on the primary platform. D is refused on security grounds (it would trade an airtight ACL proof for installability) and E is carved out because container-engine work has a different blast radius and cannot be validated without a real SELinux host.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `skillguard-transactional-install-posix`: ACL-capability probe + actionable remediation on `unsupported-posix-acl` refusals; a real `ubuntu-latest` two-leg CI job becomes the verification gate for the POSIX adapter (mirrors the existing win32 gate requirement).
- `skillguard-pretooluse-hook`: the 4b execution matrix gains an ACL-capability row, a node-on-PATH heuristic row, and invalid-value semantics for the two blocking flags.
- `skillguard-cli-dispatch`: `init` guard-step refusal no longer aborts the hook-profile merge; refusal rendering surfaces remediation.

## Approach

Fail-closed posture is RETAINED. We make refusals **actionable and visible**, not the guard installable-at-all-costs. Read-only probes (`getfacl` resolvable? `node --version`?) feed the existing doctor execution matrix; design decides whether absent-getfacl and absent-node are `blocker` or `unknown` (fail-closed leaning). Delivered as three chained PRs, each under the 400-line budget.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/lib/secure-fs-posix.ts` | Modified | Capability probe seam; refusal detail carries a remediation code |
| `src/lib/claude-hook-manager.ts` | Modified | Doctor ACL row + node-on-PATH row; matrix wiring |
| `src/lib/claude-hook-settings.ts` | Modified | Invalid-value flag semantics |
| `src/commands/init/steps/security.ts` | Modified | Decouple refusal from profile merge |
| `src/commands/claude-hooks.ts` | Modified | Render remediation text |
| `src/__integration__/secure-fs-posix.integration.test.ts` | New | Real getfacl/setfacl suite |
| `.github/workflows/` | New/Modified | Two-leg Linux job (with / without `acl`) |
| `README.md`, CLI help | Modified | Document the `acl` dependency |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| The node-on-PATH probe is a HEURISTIC (javi-forge's PATH ≠ Claude Code's PATH) — replacing a false `runnable` with false confidence | High | Label the row explicitly as a heuristic; never assert `runnable` from it; fail-closed leaning in the matrix |
| The without-acl CI leg proves nothing if getfacl is still present (GitHub runners preinstall `acl`) | High | The leg MUST actively remove or shadow `getfacl` and assert the new refusal text |
| A skip-branch regression reintroduces silent no-assert tests (the P1-4 bug-class) | Medium | Assert the 0700 private base up front; ban the `if (!ok) return;` skip pattern — failures must fail |

## Rollback Plan

Each slice is an independent PR. Revert the offending slice's merge commit: A and C are additive doctor rows plus messaging (no mutation-path behavior change); B is tests plus a workflow file. No asset bytes, no manifest SHA, and no settings identity are touched, so no installed-state migration is needed on revert.

## Dependencies

- `acl` package (`getfacl`/`setfacl`) available on the CI runner for the with-acl leg.
- Documented Claude Code semantics for `allowManagedHooksOnly` (invalid → treated as `true`).

## Success Criteria

- [ ] On a getfacl-less host, `hooks install claude` still refuses, but prints the package-manager remediation, and `hooks doctor claude` names the ACL capability as the cause.
- [ ] `init` on a getfacl-less host reports the guard error AND still writes the secrets/permissions/deps hook profile.
- [ ] The Linux integration suite executes real `getfacl`/`setfacl` assertions on `ubuntu-latest` with zero skip branches; the without-acl leg fails if `getfacl` is present.
- [ ] Doctor reports node-on-PATH as a row distinct from `process.versions.node`, explicitly labelled a heuristic.
- [ ] An invalid `allowManagedHooksOnly` value never yields a clear `runnable`.
- [ ] Each slice PR is under 400 changed lines.
