# Exploration: skillguard-pretooluse-hook

> Change `skillguard-pretooluse-hook`; hybrid artifact store; exploration only. Repository: `main` at `0a3ee93b` (PR #47). Protocol evidence was checked against the current Claude Code Hooks reference on 2026-08-13 and the locally installed Claude Code `2.1.231`.

## Current State

### Existing hook generation and installation

There are three distinct mechanisms named "hooks" today. They must not be conflated:

1. **Managed Git hooks** are packaged static assets. `HOOK_ASSETS_DIR` resolves to `assets/hooks` (`src/constants.ts:26-27`); `installCIHooks` reads the manifest and installs `pre-commit`, `pre-push`, and `commit-msg` into `.git/hooks` (`src/commands/ci.ts:2422-2487`). The pre-commit/push shims invoke `javi-forge hooks run <name>` (`assets/hooks/pre-commit:7-16`). The assets and manifest have hash/history guards (`src/__tests__/hook-assets.test.ts:18-84,140-195`) and execution tests (`src/__integration__/ci-hooks-exec.integration.test.ts:97-109,169-207`).
2. **The Git-hook dispatcher** composes only `pre-commit | pre-push`. Its `HookName`, `SectionId`, config loader, and exit contract are Git-specific (`src/commands/hooks.ts:32-48,102-119,289-355`); the CLI route accepts only `hooks run <pre-commit|pre-push>` (`src/cli/dispatch/hooks.tsx:20-29`; `src/index.tsx:61-63`). `SectionId` is therefore not a direct Claude Code PreToolUse extension point. Its fail-fast and injectable-section patterns are reusable, but its protocol is not.
3. **A Claude security-settings scaffold** is copied by `init` when security hooks are selected. `initProject` runs `stepSecurityHooks` (`src/commands/init.ts:41-58`), which copies `templates/security-hooks/claude-settings-security.json` to `.claude/settings.json` only when the destination does not exist (`src/commands/init/steps/security.ts:30-43,76-88`). Tests explicitly preserve an existing file (`src/commands/init/steps/security.test.ts:97-117`).

The third mechanism is stale relative to the current Claude Code protocol. The template uses a singular inline `hook` field and `$CLAUDE_TOOL_INPUT` / `$CLAUDE_TOOL_OUTPUT` (`templates/security-hooks/claude-settings-security.json:5-25`). Current command hooks require a nested `hooks` array and receive JSON on stdin. Existing projects with any `.claude/settings.json` receive no scaffold at all; projects that received the old exact template need a controlled migration.

Plugin auto-wiring is not an alternative installer. A plugin declares only opaque `hooks?: string[]` (`src/types/index.ts:93-103`), and sync writes those strings to a non-protocol `hooks["plugin-hooks"]` array (`src/lib/auto-wire.ts:31-57,226-290`; test at `src/lib/auto-wire.test.ts:220-237`). It does not create a Claude lifecycle hook.

### Packaging and CLI flow

- The npm package exposes only `dist/index.js` as `javi-forge` (`package.json:6-8`) and includes all `assets/` and `templates/` (`package.json:26-40`).
- `scripts/verify-package-contents.mjs:4-48` asserts each Git-hook asset by name, but no Claude runtime hook asset exists or is asserted.
- `pnpm package:check` currently passes with 377 files. A generated MJS asset would already fall under `templates/` or `assets/`, but must also be asserted by exact path to prevent a partial package from silently disabling the gate.
- The existing `hooks` CLI dispatch is lazy-imported to protect Git-hook cold start (`src/cli/dispatch/hooks.tsx:1-8,20-28`). Invoking the full `javi-forge` entry still parses meow, starts the update-notifier path, and imports Ink/React surfaces (`src/index.tsx:1-30`), which is avoidable overhead for every tool call.

### Current SkillGuard capabilities

SkillGuard is a **SKILL.md content scanner**, not a runtime capability engine:

- It scans text lines for credential theft, injection, exfiltration, scope escape, self-modification, hook tampering, destructive commands, traversal, and related patterns (`src/lib/skill-scanner.ts:98-282,313-365`).
- A critical finding becomes `block`; high findings only become `warn` (`src/lib/skill-scanner.ts:371-375`). The safe-read path caps SKILL.md at 1 MiB and returns `unscannable` on incomplete reads (`src/lib/skill-scanner.ts:426-500`).
- Install gates reject `block` and `unscannable`, with `--force` lifting only `unscannable` (`src/lib/skill-install-gate.ts:29-45`). Package gates additionally reject incomplete walks, symlinks, undeclared skill files, and case-collision ambiguity (`src/lib/skill-install-gate.ts:71-123`). Scanner/evaluation throws are converted to unconditional refusal messages (`src/lib/skill-install-gate.ts:126-134`).

No persisted runtime policy, granted-capability set, or install-time verdict is associated with a later tool call. Install metadata records the plugin manifest, not a tool policy (`src/lib/plugin.ts:237-249`).

**Honest bridge conclusion:** Claude Code PreToolUse input does not identify the active/causal skill. It identifies a tool invocation. Consequently, the first slice cannot truthfully enforce "this installed skill may/may not call this tool." It can enforce a global, deterministic **tool-invocation policy inspired by the same threat taxonomy**. Calling `scanSkillContent(JSON.stringify(tool_input))` would be security theater: it would add missing-provenance findings to non-skill JSON, interpret line-oriented SKILL.md regexes out of context, and permit several high-severity runtime commands because `warn` is installable.

Claude Code now supports hooks in a skill's own frontmatter while that skill is active, but javi-forge does not generate/own such frontmatter and direct `/skillname` expansion has a separate lifecycle. That could become a later attribution mechanism; it is not present now.

### Authoritative Claude Code PreToolUse protocol

Current documentation: [Hooks reference](https://code.claude.com/docs/en/hooks) and [Hooks guide](https://code.claude.com/docs/en/hooks-guide).

- **Configuration:** project hooks live in `.claude/settings.json` (shareable) or `.claude/settings.local.json` (local). User hooks live in `~/.claude/settings.json`; plugin hooks live in `hooks/hooks.json`. Sources merge; they do not replace one another.
- **Shape:** `hooks.PreToolUse[]` contains matcher groups `{ "matcher": "...", "hooks": [{ "type": "command", "command": "...", "args": [...], "timeout": 30 }] }`. `"*"`, `""`, or an omitted matcher matches every tool. `Bash|PowerShell` is an exact-name alternative matcher; MCP tools use names such as `mcp__server__tool`.
- **Input:** a command hook receives JSON on stdin. Common fields include `session_id`, optional `prompt_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`, and optional agent fields. PreToolUse adds `tool_name`, tool-specific `tool_input`, and `tool_use_id`. Bash/PowerShell use `tool_input.command`; Write/Edit/Read use absolute `tool_input.file_path` (Windows separators remain backslashes).
- **Allow:** exit `0` with no output means "no objection"; it does not bypass Claude's normal permission system. Structured output is optional and, for PreToolUse, uses `hookSpecificOutput.permissionDecision`.
- **Deny:** exit `2`, with the reason on stderr, blocks the tool call. Exit `1` and other non-2 codes are normally non-blocking unless valid structured JSON independently denies. This change should use the requested simple contract: allow = `0`; denial or any evaluator error after process start = `2`.
- **Important host limitation:** a command-hook timeout, missing executable, or failure to start is non-blocking; Claude continues through normal permission flow. Therefore a generated command hook can fail closed on malformed input, missing policy, internal exceptions, and explicit denials **after it starts**, but cannot guarantee fail-closed behavior when Claude itself times it out or cannot spawn it. This residual must be documented, not hidden.

The reference-only Microsoft implementation has the useful outer pattern: `hooks/hooks.json` invokes a Node/MJS handler with a 30-second timeout; the handler reads stdin, loads policy, evaluates, and catches every exception to stderr + exit 2. It must be imitated, never imported or depended upon.

## Affected Areas

- `templates/security-hooks/claude-settings-security.json:1-30` — obsolete Claude hook schema; known legacy content to migrate, not a current protocol source.
- `src/commands/init/steps/security.ts:30-43,76-112` — current Claude settings copy/install behavior and security-profile entrypoint.
- `src/commands/init/steps/security.test.ts:84-181` — current no-overwrite and profile behavior to preserve or deliberately revise.
- `src/commands/hooks.ts:32-48,289-355` — reusable fail-fast patterns, but Git-specific protocol; do not append PreToolUse to `SectionId` as if it were another Git section.
- `src/cli/dispatch/hooks.tsx:14-34`, `src/cli/help.ts:166-190` — likely namespace for an explicit Claude hook install/doctor command if product scope includes one.
- `src/lib/skill-scanner.ts:98-282,313-500` — source taxonomy and install scanner; not directly reusable as the runtime evaluator.
- `src/lib/skill-install-gate.ts:29-45,71-134` — fail-closed semantics and message style to imitate; no tool-call bridge exists here.
- `src/lib/auto-wire.ts:226-290` — unsafe to reuse: opaque plugin-hook metadata and parse-error-to-empty behavior are not a managed settings merger.
- `src/constants.ts:26-30` — asset-root pattern for a new packaged Claude hook asset.
- `package.json:26-40`, `scripts/verify-package-contents.mjs:4-48` — package inclusion and exact-file guard.
- New tests should sit beside the new evaluator/installer plus real execution tests analogous to `src/__integration__/ci-hooks-exec.integration.test.ts:97-207`.

## Approaches

### 1. Generated standalone MJS hook with an embedded local policy

Ship a dependency-free Node MJS asset, copy it to a managed project path such as `.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs`, and merge one managed PreToolUse handler into `.claude/settings.json`. Use exec form (`command: "node"`, `args: ["${CLAUDE_PROJECT_DIR}/.claude/hooks/..."]`) to avoid shell quoting and profile behavior.

- **Pros:** smallest startup path; no Ink/meow/update-notifier load; no runtime npm/global CLI lookup; same bytes can be package-guarded, copied, executed, and hash/version classified; Node 22 is already javi-forge's runtime; cross-platform exec form and MJS are practical.
- **Cons:** project copy drifts until reinstalled/upgraded; policy logic is duplicated unless the shipped asset itself is the tested source of truth; a project-local attacker can edit the hook/settings; still fails open if Node cannot start or Claude times it out.
- **Effort:** Medium.

### 2. Generated shim shells into `javi-forge` for every evaluation

Merge a PreToolUse handler that pipes stdin into a new command such as `javi-forge hooks evaluate pre-tool-use`.

- **Pros:** one policy implementation in TypeScript; a global package update changes behavior without regenerating project files; familiar CLI dispatch/testing surface.
- **Cons:** full CLI startup on every tool call; PATH/global-version skew; update-notifier and imported UI stack are inappropriate in a hot security path; missing CLI commonly exits 127, which Claude treats as non-blocking; shell form adds quoting/platform risk; `npx` fallback would add network and supply-chain risk and must not be used.
- **Effort:** Medium, with the worst runtime failure mode.

### 3. Generated hook loads a shared library or separate policy artifact

Keep a thin MJS runner and load either a copied policy module/JSON or a library from the installed javi-forge package.

- **Pros:** separates protocol parsing from policy; policy can eventually become user-configurable; unit testing is clean.
- **Cons:** two or more artifacts can drift or disappear; resolving a globally installed npm library from a project hook is not portable; loading by mutable environment path creates poisoning risk; copying the shared module beside the runner collapses back into approach 1 with more failure points.
- **Effort:** Medium–High.

## Recommendation

Choose **Approach 1: a generated, standalone, dependency-free MJS asset**, with these first-slice boundaries:

1. Treat it as a **global tool-call policy**, not an installed-skill capability policy. Name the limitation in user-facing docs.
2. Parse stdin incrementally with a documented byte ceiling (recommended starting point: 1 MiB). Empty, malformed, oversized, non-object, wrong-event, missing/non-string `tool_name`, or non-object `tool_input` is a policy-evaluation error: write a concise reason to stderr and exit 2.
3. Normalize file paths, including Windows separators. Implement a small schema-aware evaluator for an explicitly approved tool set. A credible initial rule set is:
   - Bash/PowerShell: deny a narrow tested set of destructive commands, pipe-to-shell downloads, direct sensitive-file reads, agent-config/hook tampering, and force push.
   - Read: deny sensitive credential paths.
   - Write/Edit: deny sensitive credential paths and managed agent/security configuration paths.
   - Other tools: apply an explicit documented default chosen in proposal (recommended compatibility default: allow/no objection, while registering the hook with `matcher: "*"` so malformed envelopes still fail closed).
4. Keep runtime rules separate from `THREAT_PATTERNS`. Reuse category names/reasons where semantics match, but do not call the SKILL.md scanner over tool JSON and do not inherit its `high => warn` threshold.
5. Copy/version/hash the MJS asset and merge only the owned handler into `.claude/settings.json` with atomic write and backup/refusal behavior. Preserve unrelated settings and hook groups. Auto-upgrade an exact known javi-forge legacy template/entry; refuse ambiguous edited managed content rather than clobbering it.
6. Install from the existing selected `securityHooks` init step and add an explicit idempotent install/repair/doctor command under the `hooks` namespace so existing repositories can opt in without re-running full init. This product surface requires confirmation in proposal.
7. Set a practical hook timeout (30 seconds matches the reference, though normal evaluation should be milliseconds). Explicitly document that Claude command-hook timeout and spawn failure are host fail-open residuals.

### `_hardening.py`-style environment denylist

**Later, not first slice.** There are two different threats:

- denying requested shell commands that set `LD_PRELOAD`, `NODE_OPTIONS`, or `PYTHONSTARTUP`; and
- protecting the hook process from variables already inherited before it starts.

An in-process check is too late for the second threat: `LD_PRELOAD` and `NODE_OPTIONS` may affect process startup before MJS executes, while `PYTHONSTARTUP` does not harden a Node hook. Adding three string checks would overclaim protection. A later hardening slice should define the threat model and use launch-level environment sanitization or managed policy where possible.

### Explicit non-goals

- Per-skill attribution, capabilities, or denial (no causal identity exists in PreToolUse input today).
- Rescanning SKILL.md on every tool call or passing tool JSON through `scanSkillContent`.
- Depending on, vendoring, or API-coupling to `microsoft/agent-governance-toolkit`.
- LLM/prompt/agent/HTTP policy hooks; evaluation remains deterministic and local.
- Audit-log infrastructure, anomaly detection, privilege rings, or a general policy language.
- Protecting `@file` prompt references or `EndConversation`, for which PreToolUse does not fire.
- Claiming fail-closed behavior for Claude-enforced command-hook timeout or failure-to-spawn.
- Environment-variable hardening denylist in the first slice.
- Reworking Git hook `SectionId` composition or plugin `hooks?: string[]` schema.

## First-Slice Test Strategy

Strict TDD applies (`openspec/config.yaml:14-27`). Proposed layers:

1. **Pure policy unit tests:** one table per supported tool schema; safe/deny cases; command chaining/substitution; path normalization; case and Windows separators; unknown tool behavior; no `any` types.
2. **Protocol parser tests:** chunked stdin, empty/malformed JSON, primitive/array JSON, wrong event, missing fields, oversized payload, early stream error, and bounded diagnostic output. Every evaluator error resolves to code 2.
3. **Real process tests:** spawn the actual shipped MJS asset, write fixture JSON to stdin, and assert exact process status: safe `0`; deny `2`; malformed/oversized/missing policy `2`; denial reason on stderr and no noisy stdout.
4. **Installer real-filesystem tests:** absent settings, unrelated settings preserved, existing hook groups preserved, idempotent second install (bytes/mtime), exact legacy scaffold migration, edited/foreign collision refusal, symlink/non-regular target refusal, backup-before-replace, atomic temp-write/rename failure.
5. **Package tests:** exact MJS asset and any manifest required in packed tarball; hash/version guard; generated bytes equal packaged bytes.
6. **Compatibility tests:** generated matcher/handler shape fixture against the current documented protocol; paths with spaces; Linux/macOS/Windows command representation. Do not rely on grepping alone—execute the generated handler.
7. **Manual verification:** inspect `/hooks` in Claude Code and exercise one allow and one deny on supported Claude Code. Record the tested version. Timeout/spawn fail-open remains a documented host property, not a passing security test.

## Migration, Compatibility, and Blast Radius

- **Fresh projects:** selected security-hooks init can install the managed MJS and merge the handler.
- **Existing settings:** must be merged, never replaced. Current `stepSecurityHooks`'s copy-only-if-absent behavior is insufficient.
- **Legacy javi-forge scaffold:** recognize and migrate exact known generated content. Unknown edits require an explicit repair/force decision; silently preserving invalid legacy entries may leave Claude rejecting the settings file, while blindly deleting them can destroy user policy.
- **Existing global consumers:** the CLI is npm/global-installed and project hooks outlive package updates. Project-copied standalone bytes require an explicit upgrade path and doctor status.
- **Claude versions:** nested `hooks` arrays and stdin JSON are the supported baseline. Avoid newer optional matcher syntax and `if` optimizations in the first slice unless a minimum Claude Code version is stated.
- **Review budget:** likely 5–8 implementation/test files plus one generated asset and docs. Keep the evaluator, settings installer, and CLI/init wiring as separate work units; target under the 800-line change budget or use the agreed PR strategy after asking.

## Security and Reliability Risks

- **R1 — no skill identity (High):** marketing the policy as per-skill enforcement would be false. Mitigation: global-policy language and explicit non-goal.
- **R2 — timeout/spawn fail-open (High):** Claude discards a timed-out command hook and treats missing executables as non-blocking. Mitigation: standalone fast asset, no I/O after startup, generous timeout, doctor checks, honest residual documentation.
- **R3 — settings clobber or stale invalid config (High):** replacement loses user hooks; preserve-only leaves old invalid javi-forge entries. Mitigation: ownership classification, exact legacy migration, atomic merge, backup/refusal.
- **R4 — command parsing bypass/false positive (High):** regex-only shell parsing is incomplete. Mitigation: narrow deny rules with adversarial fixtures; document the envelope; do not claim general shell safety.
- **R5 — oversized input DoS (Medium):** Write payloads can be large. Mitigation: bounded streaming read and explicit denial; product must accept the chosen limit.
- **R6 — unknown/new tools (Medium):** deny-by-default breaks Claude upgrades; allow-by-default leaves uncovered operations. Mitigation: explicit product decision and tests.
- **R7 — project-local tampering (Medium):** an agent able to edit `.claude/settings.json` or the MJS can disable the guard. Mitigation: policy denies those writes when invoked through covered tools plus doctor/hash status; Bash can still modify files, so rules must cover that path too. This is defense in depth, not an immutable boundary.
- **R8 — environment poisoning (Medium):** inherited startup variables can act before MJS. Mitigation deferred; do not overclaim.
- **R9 — all matching hooks run in parallel (Low/Medium):** this denial does not prevent sibling hook side effects. Mitigation: document Claude's merge behavior; avoid relying on ordering.
- **R10 — cross-platform path/shell variance (Medium):** Windows file paths arrive with backslashes and PowerShell may replace Bash. Mitigation: match both, normalize paths, use exec-form command + args.

## Product Questions for Interactive Proposal

1. **Policy identity:** Is the product promise explicitly a global tool-call guard, accepting that per-installed-skill attribution is unavailable, or should the change pause until a real skill-activation identity mechanism is designed?
2. **Unknown tools:** Should a structurally valid but unknown/new tool be allowed for compatibility (recommended first slice), denied fail-closed, or limited through a matcher that only runs on supported tools?
3. **Installation scope:** Should the hook be installed automatically whenever `securityHooks` is selected during `init`, and should `javi-forge hooks install claude` (plus doctor/repair) be added for existing projects?
4. **Migration/ownership:** May the installer automatically replace exact known legacy javi-forge hook entries while preserving all unrelated settings, and should edited managed entries require `--force` with backup?
5. **Payload and policy breadth:** Is a 1 MiB stdin ceiling acceptable, and should the first rule set cover Bash/PowerShell + Read/Write/Edit only, leaving env-var hardening and broader MCP/Web policies for later?

## Excavation Report

### Hidden Assumptions

| # | Assumption | Category | Load-bearing? | What if wrong? | Validation |
|---|---|---|---|---|---|
| 1 | PreToolUse identifies the responsible skill | Technical | Yes | Per-skill enforcement is impossible | Verified current input schema: it does not carry skill identity |
| 2 | Existing Claude scaffold is current | Dependency | Yes | Generated settings may be rejected and no guard runs | Compared template with current authoritative schema |
| 3 | Any nonzero hook failure blocks | Technical | Yes | Exit 1/127 and timeout permit the call | Verified exit-code and timeout tables; only exit 2 blocks by code |
| 4 | Reusing SkillGuard regexes preserves semantics | Knowledge | Yes | Runtime policy allows dangerous high/warn calls or produces false positives | Compared scanner inputs and `computeVerdict` thresholds |
| 5 | A local copied hook stays current and untampered | Temporal | Yes | Old or edited policy silently persists | Require managed hash/version, doctor, and upgrade flow |

### Root Cause Chain

```text
Stated problem: apply SkillGuard fail-closed behavior at tool execution time
    ^ constrained by
SkillGuard evaluates static SKILL.md text at installation
    ^ while
PreToolUse exposes only the resulting tool invocation
    ^ and
javi-forge persists no skill capability policy or causal activation identity
    ^ therefore
ROOT CAUSE: the ecosystem has two security stages but no semantic identity/policy bridge between them
```

### The Real Problem

The immediate deliverable is not "run SkillGuard again." It is to establish a truthful, managed Claude Code tool-policy boundary with correct exit-2 behavior, while acknowledging that per-skill runtime governance needs a future identity/capability model.

## Stress-Test Report

### Breaking Points

| # | What breaks | Dimension | Threshold/condition | Failure mode | Detection | Priority |
|---|---|---|---|---|---|---|
| 1 | Host timeout | Failure | handler exceeds configured timeout | tool proceeds | Claude debug/hook notice; no deny | P1 |
| 2 | Runtime missing | Failure | `node` not found / asset missing | spawn error, tool proceeds | `/hooks`, doctor, transcript notice | P1 |
| 3 | Input memory bound | Scale/adversarial | stdin exceeds chosen cap | deliberate deny after process starts | stderr + exit 2 | P1 |
| 4 | New tool schema | Temporal | Claude adds/changes a tool | false allow or compatibility denial | unknown-tool test/telemetry; user report | P1 |
| 5 | Settings merge collision | Human/adversarial | existing edited managed entry | clobber or duplicate handlers | installer classification/refusal | P1 |
| 6 | Shell obfuscation | Adversarial | command escapes narrow parser | dangerous call allowed | adversarial regression fixture; incident | P1 |

### Failure Cascades

```text
missing Node/asset or timeout
  -> hook does not emit exit 2
    -> Claude continues normal permission flow
      -> permissive mode may execute the denied operation
        -> USER IMPACT: guard appears installed but does not enforce

unsafe settings replacement
  -> unrelated user/managed project hooks disappear
    -> multiple protections are silently lost
      -> USER IMPACT: installing one guard weakens the overall security posture
```

### Stress Verdict

**Overall resilience: Fragile unless the first slice includes managed installation, bounded parsing, real-process exit tests, and explicit host fail-open documentation.** The standalone asset minimizes but cannot eliminate Claude's timeout/spawn residual.

## Ready for Proposal

**Yes, after the five product questions are answered interactively.** The proposal should lock the honest global-policy promise, unknown-tool default, installation/migration ownership, payload ceiling, and narrow initial rule set. It should not promise per-skill attribution or absolute fail-closed behavior under host timeout/spawn failure.
