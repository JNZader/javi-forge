# Proposal: Install an Honest Global Claude PreToolUse Guard

## Decision Summary

javi-forge will install a managed, deterministic Claude Code `PreToolUse` command hook that evaluates **supported tool invocations globally**. It is defense in depth for projects that enable javi-forge security hooks; it is not per-skill authorization, a complete shell sandbox, or a replacement for Claude's permission flow.

The first release will:

- match only `Bash`, `PowerShell`, `Read`, `Write`, and `Edit`;
- allow a valid supported invocation with exit `0` when no rule denies it;
- block a policy denial or guarded evaluator failure with exit `2`;
- install during Standard/Strict security-enabled `init`, during Minimal only after a separate explicit guard opt-in, and through explicit install, doctor, and repair commands;
- preserve unrelated Claude settings and hooks under strict managed-ownership rules; and
- document that Claude host spawn failures and timeouts remain fail-open.

## Problem and Current Gap

### Target users and situations

This change serves developers who:

- select security hooks during `javi-forge init` for a new project;
- want to add the guard to an existing repository without re-running init;
- need to verify or repair a project-local hook after a package upgrade or local edit; or
- run Claude Code in permission modes where an additional deterministic check reduces the chance of destructive commands, credential access, or agent-security configuration tampering.

### Current behavior

The existing SkillGuard gate scans static `SKILL.md` content when skills are installed. It does not persist capabilities or associate a later Claude tool call with the skill that caused it. Claude `PreToolUse` input likewise contains tool-call data but no causal skill identity.

The current security-enabled init also copies a stale Claude settings scaffold only when `.claude/settings.json` is absent. That scaffold uses an obsolete hook shape and environment variables instead of the current nested command-handler schema and JSON stdin. Existing project settings are not merged, and existing repositories have no install, health-check, or repair path.

### Desired outcome

Projects that opt in have a truthful, locally executable guard for a narrow set of high-risk tool calls. Users can tell whether it is installed and current, recover safely from drift, and understand both what it blocks and what it cannot enforce.

## Scope

### In scope

1. Ship a dependency-free Node MJS handler as a versioned, hashed package asset and copy it to `.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs`; package/hash the installer-only Windows secure-object helper alongside it.
2. Merge one owned `PreToolUse` command handler into `.claude/settings.json` using the current nested `hooks` schema and exec-form `node` plus `args` configuration.
3. Register the matcher as `Bash|PowerShell|Read|Write|Edit`; unknown and future tools do not invoke this guard and continue through normal Claude behavior.
4. Read JSON stdin incrementally with a 1 MiB ceiling and evaluate a deterministic, schema-aware policy:
   - `Bash` and `PowerShell`: a narrow tested set of destructive operations, pipe-to-shell downloads, sensitive-file access, force push, and agent/security-hook tampering;
   - `Read`: sensitive credential paths;
   - `Write` and `Edit`: sensitive credential paths and managed agent/security configuration paths.
5. Install through Standard/Strict security-enabled `javi-forge init`, separately opted-in Minimal init, and explicit commands:
   - `javi-forge hooks install claude`
   - `javi-forge hooks doctor claude`
   - `javi-forge hooks repair claude [--force]`
6. Classify the managed asset and settings entry before mutation; preserve unrelated settings and hooks; migrate only exact known javi-forge legacy content.
7. Provide actionable refusal diagnostics, backup-before-force behavior for edited managed content, atomic settings updates, package-content checks, and real-process tests.
8. Document supported versions, policy boundaries, host fail-open residuals, rollout, and manual rollback.

### Explicit non-goals

- Per-skill attribution, per-installed-skill capabilities, or claims that a denied call came from a particular skill.
- Re-running the `SKILL.md` scanner over tool-call JSON or rescanning installed skills per invocation.
- Matching or governing unknown tools, MCP tools, Web tools, agent/prompt hooks, `@file` expansion, or `EndConversation` in this slice.
- An environment-poisoning denylist for `LD_PRELOAD`, `NODE_OPTIONS`, `PYTHONSTARTUP`, or equivalent variables.
- A complete shell parser, immutable sandbox, general policy language, audit platform, anomaly detector, or privilege-ring system.
- Depending on the full `javi-forge` CLI, `npx`, an external service, an LLM, or the Microsoft agent-governance toolkit at hook runtime.
- Reworking the Git-hook `SectionId` dispatcher or plugin `hooks?: string[]` metadata.
- Claiming that Claude host startup failure or timeout is fail-closed.
- Automatically rewriting existing repositories merely because the global linuxbrew/npm package is upgraded.

## Product Approach

### Runtime boundary

The installed MJS handler is the tested runtime artifact and contains its required policy data. It avoids the full CLI startup path, global package resolution, shell quoting, network access, and update-notifier/UI dependencies. Normal evaluation should take milliseconds; the generated Claude handler will use a practical 30-second host timeout.

The handler validates the event and supported tool schema before applying policy. It emits no noisy stdout. Denial and error messages go to stderr, are bounded, identify the rule or validation problem, and do not echo the complete command or file contents.

### Failure contract: two distinct boundaries

| Boundary | Examples | Observable result | Product claim |
|---|---|---|---|
| Evaluator is running inside its guarded main path | explicit policy denial; empty, malformed, oversized, primitive, or wrong-event input; missing required fields; missing/invalid embedded policy registry; evaluation or stdin error | stderr reason and exit `2`; Claude blocks the supported tool call | Fail-closed after evaluator startup |
| Claude/host cannot obtain evaluator exit `2` | `node` or handler cannot be spawned, MJS cannot parse/start, process is killed by Claude's timeout, or host discards the result | Claude continues its normal permission flow | Known host fail-open residual |

Exit `0` means only "the global javi-forge policy has no objection." It does not grant permission or bypass Claude's own permission checks. No other evaluator exit code is intentionally produced.

Doctor, package integrity checks, a standalone asset, and real execution tests reduce the host residual; they cannot eliminate or truthfully relabel it. Doctor reports observable host-policy blockers as unhealthy and unresolved higher-precedence policy as `INCONCLUSIVE`, never healthy.

## User Flows

### 1. Security-enabled init

1. The user selects security hooks during `javi-forge init`.
2. Standard and Strict invoke the same managed installer used by the explicit install command. Minimal remains CI-only and skips the runtime guard unless the user separately opts into it.
3. The installer preflights the asset path and Claude settings and classifies ownership. Before any mutation it must prove the target-parent chain is stable against principals outside the process trust boundary: on POSIX this requires held no-follow directory handles, stable identities, no untrusted write path, and conclusive ACL inspection; on Windows it requires the packaged helper's held directory handles, stable file IDs, local supported-volume checks, and a DACL that grants mutation rights only to the current user and trusted operating-system administrators. Node exposes no portable `openat`/`renameat`, so a pathname-only or `lstat`-before/after check is insufficient. If that proof is unavailable, including an unsupported/shared writable parent or inconclusive ACL inspection, install/repair refuses before target mutation and tells the user to use a private supported parent. A fresh safe install may then create and record restrictive parent directories before same-directory staging; it does not claim impossible zero mutation before staging.
4. On an absent/current/complete-exact-known-legacy-cohort state, it installs, no-ops, or migrates as appropriate and reports the managed path and covered tools.
5. On an edited managed or foreign collision, the security-hook step is reported as refused/incomplete. It must not claim that the guard is active, leaves all Claude-hook target files unchanged, and removes only transaction-created parent directories that remain identity-matched and empty; hard-crash remnants remain an explicitly diagnosable limit. Unrelated init output is preserved.
6. The refusal points to `javi-forge hooks doctor claude` and, only for edited managed content, the eligible `repair claude --force` path.

### 2. Explicit install, doctor, and repair

#### Install

`javi-forge hooks install claude` is idempotent. It installs absent managed content, leaves current content byte- and mtime-stable, and auto-migrates only exact released identities, the exact full legacy scaffold, or the complete exact four-object legacy cohort. Partial, duplicate, or edited legacy cohorts are foreign and remain untouched. It refuses ambiguity rather than treating resemblance as ownership.

#### Doctor

`javi-forge hooks doctor claude` is read-only. Component detail may be current, missing, outdated, edited-managed, or foreign, but the authoritative overall status has exactly three values and one precedence rule: `BLOCKED`/exit `1` when any known installation, Node, configuration, or launch blocker is present (even if another source is unknown); otherwise `INCONCLUSIVE`/exit `2` when any relevant higher-precedence or current-launch policy source cannot be observed or resolved; otherwise `RUNNABLE`/exit `0` only when both components and command shape are current, Node is usable, and every relevant source in the supported policy-source inventory is observably absent or permitting project hooks. The inventory includes `disableAllHooks`, managed `allowManagedHooksOnly`, managed strict plugin-only hook customization, safe-mode environment/launch state, and supported server/MDM representations or a supported resolved-settings probe. Mere failure to detect a source is not proof that it is clear. `BLOCKED` names blocker IDs and their state-specific repair; `INCONCLUSIVE` names unknown-source IDs and always directs the user to `claude doctor`/`/status` and `/hooks` outside safe mode; both set healthy false. `RUNNABLE` still repeats the timeout/spawn fail-open residual instead of returning a blanket "secure" verdict.

#### Repair

`javi-forge hooks repair claude` restores missing or exact-outdated managed pieces without force. An edited managed entry or asset is refused unless `--force` is explicit and a safe backup is created first. Foreign/arbitrary user content is never a force-overwrite target.

### 3. Runtime refusal UX

- A policy denial exits `2` and prints a concise message such as `javi-forge PreToolUse denied Bash: <rule reason>`.
- A malformed, oversized, missing-policy, or evaluator-error case exits `2` and says evaluation failed closed, without dumping the payload.
- An allowed call exits `0` silently and proceeds to normal Claude permission handling.
- Tools outside the five-tool matcher never invoke the handler; javi-forge emits no allow or deny decision for them.

## Managed Ownership and Migration Rules

Classification occurs before any write and applies independently to both the installed MJS asset and the owned settings entry.

| State | Required behavior |
|---|---|
| Absent | Install the managed object. |
| Managed current | No-op; preserve bytes and mtime. |
| Exact released outdated | Upgrade automatically because bytes/hash prove javi-forge ownership. |
| Exact full legacy scaffold or complete four-object cohort | Remove/replace only that complete proven legacy content; preserve every unrelated setting and hook group. |
| Partial, duplicate, or edited legacy cohort | Treat as foreign/unowned; preserve and refuse in every mode. |
| Edited managed | Refuse by default. `repair --force` may proceed only after an exclusive, regular-file backup succeeds. |
| Foreign or arbitrary user content | Preserve and refuse the colliding operation, including with `--force`; never infer ownership from a similar command or path. |
| Symlink or non-regular write/backup target | Refuse in all modes and leave it untouched. |

Settings are parsed and merged structurally, not replaced wholesale. The installer first proves the parent-chain trust and identity contract, keeps its directory handles open, and revalidates them around every pathname mutation; it then safely creates/revalidates missing parents when necessary, writes through same-directory temporary files, and renames individual files atomically. This is not portable dirfd-relative atomicity: security against a swap-out/swap-back attacker derives from refusing parents writable by untrusted principals, not from claiming that two path observations close the race. On Linux and macOS the installer also refuses mutation when the required native ACL inspector is unavailable, ACL absence is inconclusive, any source file has an extended ACL, or any parent has an access/default/inheritable ACL; it never degrades to mode-only preservation. Any failed preflight or backup leaves target files unmodified and removes only transaction-created directories that remain identity-matched and empty. A forced-repair backup contains complete prior bytes, the exact source mode, and no extended ACL, and replacement/backup access is never broader than the source.

## Compatibility and Installed-Consumer Impact

- **Claude Code:** target the current nested command-hook schema and JSON-stdin protocol, verified during exploration against Claude Code `2.1.231`. The supported baseline must be stated in release documentation and checked manually through `/hooks`.
- **Node/platforms:** use the package's existing Node `>=22` baseline and exec-form `command`/`args`; bound Windows drive/UNC/extended aliases and Darwin case-insensitive comparisons explicitly; use native ACL inspection (`getfacl` on Linux, `/bin/ls -lde` on macOS) and refuse installer mutation when its result is unavailable or inconclusive; refuse unsupported/shared writable parent chains rather than claiming portable dirfd-relative rename; test Bash/PowerShell schemas separately; continuously validate the focused slice on `windows-latest`.
- **Existing `.claude/settings.json`:** preserve all unrelated keys, hook events, matcher groups, and handlers. Exact stale javi-forge entries migrate; edited or foreign content does not.
- **Unknown/new tools:** excluded from the matcher, so Claude upgrades do not become automatic denials. They remain explicitly uncovered by this release.
- **Global consumers:** the linuxbrew/global installation and roughly eight repositories using javi-forge Git hooks are unaffected unless a repository selects security-enabled init or runs the explicit Claude-hook commands. Existing Git hooks are not changed by this feature.
- **Project-local copies:** upgrading javi-forge does not silently update copied handlers. Doctor identifies drift; install/repair provides the explicit upgrade path.

## Rollout and Rollback

### Rollout

1. Land policy/evaluator, managed installer, and init/CLI wiring as separate review units; keep the combined review within the agreed 800-line budget or split before implementation review.
2. Require strict TDD, real spawned-MJS exit assertions, real-filesystem merge/ownership fixtures, package tarball checks, and Linux/macOS/Windows representation fixtures.
3. Publish through the existing semantic-release/npm path.
4. Auto-install only for new or re-run Standard/Strict security-enabled init. Minimal requires a separate explicit guard opt-in. Existing projects opt in with `hooks install claude`; no fleet-wide rewrite occurs.
5. Release notes lead with global-policy semantics, five-tool coverage, the 1 MiB ceiling, and the host timeout/spawn residual.

### Rollback

- A project rollback removes only the exact managed PreToolUse handler and exact managed asset. It must not delete the containing `hooks.PreToolUse` array or `.claude/settings.json` when unrelated content remains.
- After a forced repair, restoring the recorded full settings backup and asset backup returns the project to its exact prior bytes.
- A product rollback is a semantic-release patch that recognizes the released managed hashes and removes or replaces only those exact managed objects. Downgrading the global package alone is insufficient because project-local assets outlive package upgrades.
- If ownership cannot be proven during rollback, stop and give manual instructions; never trade rollback speed for clobbering user hooks.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `assets/claude-hooks/` | New | Versioned standalone MJS runtime, installer-only Windows secure-object helper, and ownership/hash metadata. |
| `.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs` | New generated file | Project-local managed evaluator installed for opted-in consumers. |
| `.claude/settings.json` | Structurally modified | One owned supported-tool `PreToolUse` handler is merged without replacing unrelated content. |
| `templates/security-hooks/claude-settings-security.json` | Migrated/removed | Becomes exact legacy input rather than the active installation mechanism. |
| `src/commands/init/steps/security.ts` | Modified | Delegates security-enabled init to the managed Claude-hook installer and reports refusal honestly. |
| `src/commands/` and `src/lib/` Claude-hook modules | New | Ownership classification, atomic install/repair, doctor status, and command results. |
| `src/cli/dispatch/hooks.tsx`, `src/cli/help.ts` | Modified | Expose install, doctor, and repair user flows without changing Git `hooks run`. |
| `scripts/verify-package-contents.mjs` | Modified | Requires the exact runtime asset/metadata in the published tarball. |
| `.github/workflows/claude-hook-windows.yml` | New | Runs the focused runtime, manager, real-process, ACL/path, and package checks on `windows-latest`. |
| Co-located unit and `src/__integration__/` tests | New/modified | Exercise policy, bounded protocol parsing, real process exit codes, and real filesystem migration. |

## Risks and Tradeoffs

| Risk / tradeoff | Level | Mitigation or accepted boundary |
|---|---|---|
| Users mistake a global policy for per-skill enforcement | High | Product naming, docs, doctor, and refusal text explicitly say global; per-skill attribution is a non-goal. |
| Claude spawn failure or timeout permits normal flow | High | Small standalone asset, 30-second timeout, package/doctor/execution checks, and explicit fail-open residual documentation. |
| Narrow shell rules can be bypassed or create false positives | High | Small schema-aware rule set, adversarial fixtures, bounded claims, and no "complete sandbox" language. |
| Settings or local assets are clobbered during migration | High | Exact ownership, full preflight, structural merge, atomic writes, backup-before-force, and no force overwrite for foreign content. |
| Pathname parent swap or ACL loss redirects/broadens a replacement | High | Hold and revalidate directory identities, require a private/non-untrusted-writable chain, inspect POSIX ACLs with native tools, refuse any extended/inconclusive ACL state, and disclose that Node has no portable `openat`/`renameat`; Windows uses the packaged handle/DACL helper on supported local volumes. |
| Local edits disable or weaken the guard | Medium | Managed hashes, doctor/repair, and rules covering managed config tampering through supported tools; acknowledge project-local tampering remains possible. |
| Inputs over 1 MiB are blocked even when legitimate | Medium | Fixed documented ceiling and concise error; users may proceed only by disabling/removing the guard, not by silently bypassing evaluation. |
| Unknown/new tools remain uncovered | Medium | Deliberate matcher exclusion preserves compatibility; expand only in a separately specified release. |
| Platform-specific shell/path behavior diverges | Medium | Exec form, path normalization, PowerShell-specific fixtures, and real process tests. |
| Matching Claude hooks execute independently/possibly in parallel | Low/Medium | Do not rely on sibling hook ordering or claim this denial prevents sibling side effects. |
| Scope exceeds review budget | Medium | Separate evaluator, installer, and wiring work units; split delivery if the 800-line budget cannot be met. |

## Dependencies

- Claude Code's documented command-hook protocol and exit-`2` blocking behavior.
- Node `>=22`, already required by javi-forge.
- For installer mutation on Linux, an executable `getfacl` with parseable numeric output; on macOS, parseable `/bin/ls -lde` ACL output. Their absence causes safe refusal, not a weaker fallback.
- Existing semantic-release/npm packaging and security-enabled init selection.
- No new runtime package, service, network, or toolkit dependency.

## Acceptance Signals

- [ ] Standard/Strict security-enabled init installs the managed handler when safe; Minimal installs only after separate explicit opt-in; no path reports success after a refused/incomplete install.
- [ ] Explicit install is idempotent; doctor is read-only and actionable; repair respects force and backup rules.
- [ ] Install/repair refuses unsupported or untrusted-writable parent chains and any POSIX ACL state it cannot prove safe; replacements/backups never discard an extended ACL or broaden access.
- [ ] Claude settings with unrelated keys and hooks remain semantically and byte-content-wise preserved outside the owned change.
- [ ] Only the exact full legacy scaffold or complete exact four-object cohort migrates automatically; partial legacy cohorts and arbitrary user hooks are never overwritten; one-byte-edited managed content requires eligible backup plus `--force`.
- [ ] The installed matcher names exactly `Bash|PowerShell|Read|Write|Edit`; an unknown tool does not invoke the guard.
- [ ] Safe supported input exits `0` silently; an explicit policy denial exits `2` with a bounded stderr reason.
- [ ] Empty, malformed, oversized (>1 MiB), wrong-event, incomplete, missing-policy, and guarded evaluator-error cases exit `2` after evaluator startup.
- [ ] Documentation and doctor clearly distinguish evaluator fail-closed behavior from Claude host spawn/timeout fail-open behavior.
- [ ] The actual packaged MJS is spawned in tests; package checks prove the runtime asset and ownership metadata ship.
- [ ] Linux/macOS path-with-spaces and Windows separator/PowerShell fixtures pass without shell-string invocation.
- [ ] Release and rollback instructions state the impact on global linuxbrew/npm consumers and project-local copied assets.
- [ ] No user-facing artifact claims per-skill attribution or complete prevention of dangerous tool execution.

## Antithesize Report

### Core Claim

Installing a narrowly scoped, managed global PreToolUse evaluator materially improves opted-in project safety without misrepresenting it as per-skill enforcement.

### Counter-Argument

A global five-tool denylist may create more confidence than protection: it cannot identify the responsible skill, unknown tools bypass it by design, shell syntax can evade narrow rules, and Claude proceeds when the process cannot start or times out. In permissive Claude modes, users could interpret "SkillGuard installed" as a security boundary even though the most consequential host failures are non-blocking.

### Evidence Against

| Evidence | Source | Strength |
|---|---|---|
| PreToolUse input contains the invocation but no causal skill identity. | Current protocol and repository state from exploration | Strong |
| Claude command-hook timeout/spawn failure is non-blocking. | Current Claude hook contract verified in exploration | Strong |
| Only five tools are matched, and shell deny rules cannot form a complete parser/sandbox. | Approved scope and first principles | Strong |
| Project-local settings and handler bytes can be edited outside the covered evaluator path. | Local trust model | Moderate |

### Confidence Impact

**Level:** Moderate

**Conditions for the counter to win:** the feature is marketed as SkillGuard per-skill enforcement or a complete fail-closed boundary; doctor returns an unqualified "secure" status; host failures are common enough that the hook is routinely bypassed; or users rely on uncovered tools/shell encodings as though they were governed.

### Steel-Man Rebuttal

The proposal does not rely on attribution and does not claim complete mediation. A standalone local evaluator can still block common, high-impact supported calls before execution, while strict ownership, real-process tests, doctor/repair, explicit matcher boundaries, and conspicuous host-residual language make its limited guarantee inspectable. Defense in depth remains valuable when the limitation is part of the product contract rather than hidden in implementation notes.

### Verdict

**Modify** — proceed with the global guard only under the bounded naming, doctor output, acceptance signals, and residual-risk disclosures included above.

### Recommended Mitigations

- Use "global PreToolUse guard" consistently; reserve "per-skill" for a future identity/capability slice.
- Make doctor report coverage and residuals, not a binary secure/insecure badge.
- Test the shipped process and ownership transitions, not only pure policy functions.
- Treat additional tools, environment hardening, and attribution as separate proposals with independent threat models.
