# skillguard-pretooluse-hook Specification

## Purpose

Define the first release of an opt-in, project-local Claude Code `PreToolUse` guard. The guard evaluates supported tool invocations against a deterministic global policy. It is defense in depth: it is not per-skill authorization, a complete shell sandbox, or a replacement for Claude's permission flow.

## Requirements

### Requirement: Global guard scope is explicit and bounded

The system MUST describe and enforce this feature as a global tool-invocation guard. It MUST NOT attribute an invocation or denial to an installed or active skill, MUST NOT claim complete mediation of dangerous operations, and MUST NOT claim that exit `0` grants permission. Per-skill attribution, per-skill capabilities, environment-variable poisoning controls, unknown or future tools, MCP/Web tools, and a general shell sandbox SHALL remain outside this release.

#### Scenario: Allowed invocation remains subject to Claude permissions

- GIVEN a valid supported invocation that the global policy does not deny
- WHEN the evaluator exits `0`
- THEN the result means only that javi-forge has no objection
- AND Claude's normal permission handling still applies

#### Scenario: Denial has no skill attribution

- GIVEN a supported invocation that the global policy denies
- WHEN the evaluator reports the denial
- THEN the diagnostic identifies the global guard, tool, and policy reason
- AND it does not claim that any named skill caused the invocation

### Requirement: Matcher covers exactly the supported tools

The installed matcher MUST be exactly `Bash|PowerShell|Read|Write|Edit`. Unknown, future, MCP, Web, and all other tool names MUST NOT match this handler and SHALL continue through Claude's normal behavior without a javi-forge allow or deny decision.

#### Scenario: Supported tool invokes the guard

- GIVEN the managed matcher is installed
- WHEN Claude issues a `Bash`, `PowerShell`, `Read`, `Write`, or `Edit` `PreToolUse` event
- THEN the matcher selects the managed handler for evaluation

#### Scenario: Unknown tool is excluded

- GIVEN the managed matcher is installed
- WHEN Claude issues a `PreToolUse` event for a tool not in the five supported names
- THEN the managed handler is not invoked for that event
- AND javi-forge emits no allow or deny decision for it

### Requirement: Runtime input is bounded and schema-aware

After evaluator startup, the handler MUST read JSON from stdin incrementally with a maximum accepted size of 1 MiB (1,048,576 bytes). It MUST require a JSON object for a `PreToolUse` event, a supported string `tool_name`, an object `tool_input`, and the supported tool's policy-relevant field: a string `command` for `Bash` and `PowerShell`, or an absolute string `file_path` for `Read`, `Write`, and `Edit`. It MUST evaluate no more input than is required by the supported schema and policy.

#### Scenario: Valid payload at the ceiling is evaluated normally

- GIVEN a valid supported `PreToolUse` JSON payload whose encoded stdin is exactly 1,048,576 bytes
- WHEN the evaluator reads stdin
- THEN it evaluates the supported tool policy rather than rejecting the payload for size alone

#### Scenario: Oversized stdin fails closed

- GIVEN stdin exceeds 1,048,576 bytes by at least one byte
- WHEN the running evaluator detects the excess
- THEN it stops accepting input, synchronously emits the complete bounded evaluation-error diagnostic on stderr, destroys/unrefs stdin, and forcibly exits `2` without waiting for the writer to close

#### Scenario: Malformed JSON fails closed

- GIVEN stdin is empty, malformed JSON, a JSON primitive, or a JSON array
- WHEN the running evaluator parses and validates the payload
- THEN it emits a bounded evaluation-error diagnostic on stderr and exits `2`

#### Scenario: Wrong event or missing tool schema fails closed

- GIVEN JSON input has the wrong event name, a missing or non-string `tool_name`, a non-object `tool_input`, or a missing or invalid policy-relevant field
- WHEN the running evaluator validates the event
- THEN it emits a bounded evaluation-error diagnostic on stderr and exits `2`

### Requirement: Bash policy produces deterministic allow and deny decisions

For valid `Bash` input, the evaluator MUST apply a versioned, deterministic shell policy covering the approved narrow classes: destructive operations, pipe-to-shell downloads, direct sensitive-file access, force push, and managed agent/security-hook tampering. A command outside the shipped deny corpus MUST exit `0` silently; a command in the deny corpus MUST exit `2` with a bounded reason on stderr. The policy MUST NOT be represented as a complete shell parser or sandbox.

The Bash sensitive-access corpus MUST include literal display/search/source commands and ordinary literal transfer commands. At minimum, protected source operands for `cat`, `less`, `more`, `head`, `tail`, `bat`, `grep`, `rg`, `sed`, `awk`, `source`, `.`, `cp`, and `install`, plus protected input-redirection operands, MUST be denied under the bounded operand grammar.

#### Scenario: Valid safe Bash command is allowed

- GIVEN a valid `Bash` event whose `tool_input.command` is a policy fixture outside every deny class
- WHEN the evaluator runs
- THEN it writes no stdout, writes no stderr, and exits `0`

#### Scenario: Valid denied Bash command is blocked

- GIVEN a valid `Bash` event whose `tool_input.command` is a policy fixture for a destructive operation, pipe-to-shell download, sensitive-file read, force push, or managed-hook tampering
- WHEN the evaluator runs
- THEN it writes no stdout, emits the matching bounded rule reason on stderr, and exits `2`

### Requirement: PowerShell policy is distinct and deterministic

For valid `PowerShell` input, the evaluator MUST apply PowerShell-specific fixtures and interpretations for the same approved narrow deny classes. It MUST NOT assume that Bash syntax or tokenization defines PowerShell behavior. A command outside the shipped deny corpus MUST exit `0` silently; a command in the deny corpus MUST exit `2` with a bounded reason on stderr.

The PowerShell sensitive-access corpus MUST include literal display/search and ordinary literal transfer commands. At minimum, protected path operands for `Get-Content`/`gc`/`cat`/`type`, `Select-String`, `Copy-Item`/`cp`/`copy`, and input redirection MUST be denied under the bounded positional/`-Path`/`-LiteralPath` grammar.

#### Scenario: Valid safe PowerShell command is allowed

- GIVEN a valid `PowerShell` event whose `tool_input.command` is a PowerShell policy fixture outside every deny class
- WHEN the evaluator runs
- THEN it writes no stdout, writes no stderr, and exits `0`

#### Scenario: Valid denied PowerShell command is blocked

- GIVEN a valid `PowerShell` event whose `tool_input.command` is a PowerShell policy fixture for a destructive operation, pipe-to-shell download, sensitive-file read, force push, or managed-hook tampering
- WHEN the evaluator runs
- THEN it writes no stdout, emits the matching bounded rule reason on stderr, and exits `2`

### Requirement: Read policy protects sensitive credential paths

For valid `Read` input, the evaluator MUST normalize the absolute `tool_input.file_path` for policy comparison across supported platforms. It MUST exit `2` when the normalized path belongs to the versioned sensitive-credential path corpus and MUST exit `0` silently for a path outside that corpus.

#### Scenario: Valid non-sensitive Read is allowed

- GIVEN a valid `Read` event with an absolute path outside the sensitive-credential corpus
- WHEN the evaluator runs
- THEN it writes no output and exits `0`

#### Scenario: Valid sensitive Read is denied

- GIVEN a valid `Read` event with an absolute path classified as a sensitive credential path
- WHEN the evaluator runs
- THEN it writes no stdout, emits a bounded sensitive-path reason on stderr, and exits `2`

### Requirement: Write policy protects sensitive and managed paths

For valid `Write` input, the evaluator MUST normalize the absolute `tool_input.file_path` for policy comparison. It MUST exit `2` for a path in either the sensitive-credential corpus or the managed agent/security-configuration corpus and MUST exit `0` silently for a path outside both corpora. File content MUST NOT be included in diagnostics.

#### Scenario: Valid ordinary Write is allowed

- GIVEN a valid `Write` event with an absolute path outside both protected path corpora
- WHEN the evaluator runs
- THEN it writes no output and exits `0`

#### Scenario: Valid protected Write is denied

- GIVEN a valid `Write` event with an absolute path classified as sensitive or managed agent/security configuration
- WHEN the evaluator runs
- THEN it writes no stdout, emits a bounded protected-path reason on stderr without file content, and exits `2`

### Requirement: Edit policy protects sensitive and managed paths

For valid `Edit` input, the evaluator MUST normalize the absolute `tool_input.file_path` for policy comparison. It MUST exit `2` for a path in either the sensitive-credential corpus or the managed agent/security-configuration corpus and MUST exit `0` silently for a path outside both corpora. Old, new, or replacement text MUST NOT be included in diagnostics.

#### Scenario: Valid ordinary Edit is allowed

- GIVEN a valid `Edit` event with an absolute path outside both protected path corpora
- WHEN the evaluator runs
- THEN it writes no output and exits `0`

#### Scenario: Valid protected Edit is denied

- GIVEN a valid `Edit` event with an absolute path classified as sensitive or managed agent/security configuration
- WHEN the evaluator runs
- THEN it writes no stdout, emits a bounded protected-path reason on stderr without edited text, and exits `2`

### Requirement: Evaluator errors fail closed only after startup

Once execution reaches the evaluator's guarded main path, a missing or invalid embedded policy registry, stdin read error, policy evaluation exception, or other caught internal error MUST emit a bounded failure diagnostic on stderr and exit `2`. The evaluator MUST intentionally produce only exit `0` for no objection and exit `2` for denial or evaluator error.

Claude host inability to spawn `node` or the MJS, MJS parse/start failure before the guarded path, host-enforced timeout, process termination, or host discarding the result MUST be documented separately as non-blocking host residuals. The product MUST NOT label those residuals fail-closed.

#### Scenario: Missing policy fails closed after startup

- GIVEN the evaluator has started but its required embedded policy registry is absent or invalid
- WHEN guarded evaluation begins
- THEN it emits a bounded failed-closed diagnostic on stderr and exits `2`

#### Scenario: Evaluation exception fails closed after startup

- GIVEN a valid supported payload causes the policy evaluator to throw inside the guarded main path
- WHEN the top-level evaluator handles the exception
- THEN it emits a bounded failed-closed diagnostic on stderr and exits `2`

#### Scenario: Host spawn failure is not reported as evaluator denial

- GIVEN Claude cannot spawn `node` or the managed MJS
- WHEN no evaluator process returns exit `2`
- THEN Claude continues its normal behavior according to the host contract
- AND javi-forge documentation and doctor report this as a fail-open host residual, not an evaluator denial

#### Scenario: Host timeout is not reported as fail-closed

- GIVEN the managed command handler exceeds the host timeout
- WHEN Claude terminates or ignores the handler without receiving exit `2`
- THEN Claude continues its normal behavior according to the host contract
- AND no product output claims the operation was blocked

### Requirement: Diagnostics are actionable, bounded, and non-sensitive

Runtime denial and evaluator-error diagnostics MUST go to stderr, MUST use a fixed tested maximum length, and SHOULD identify the tool and rule or validation class when safely available. They MUST NOT echo the complete stdin payload, complete command, file content, edit text, tokens, credentials, or an unbounded path. Allowed evaluations MUST be silent on stdout and stderr.

#### Scenario: Denial does not leak the full command

- GIVEN a denied shell command contains additional secret-looking text beyond the matched operation
- WHEN the evaluator emits its reason
- THEN the diagnostic stays within the tested bound and identifies the rule without reproducing the complete command or secret-looking suffix

#### Scenario: Malformed input is not dumped

- GIVEN malformed or oversized stdin contains sensitive-looking data
- WHEN parsing fails closed
- THEN stderr states the validation class within the tested bound and does not reproduce the payload

### Requirement: Packaged runtime is standalone and uses the current Claude shape

The npm package MUST contain a versioned and hashed, dependency-free Node MJS runtime asset. The asset MAY use Node built-ins but MUST NOT require the javi-forge CLI, an installed npm dependency, `npx`, network access, an external service, an LLM, or runtime resolution of a global package.

The managed project settings entry MUST use the current nested `hooks.PreToolUse` matcher-group shape with a nested command handler, `type: "command"`, exec-form `command: "node"`, an `args` array that addresses the project-local MJS without shell-string quoting, and a 30-second timeout. Installation MUST copy the packaged runtime bytes to `.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs` and MUST bind ownership metadata to the packaged version and hash.

#### Scenario: Installed settings use nested exec form

- GIVEN the guard is installed into a project
- WHEN `.claude/settings.json` is inspected
- THEN the owned entry is under `hooks.PreToolUse` with matcher `Bash|PowerShell|Read|Write|Edit`
- AND its nested command handler uses `node`, an argument for the project-local MJS, and timeout `30` without a shell command string

#### Scenario: Runtime has no package-resolution dependency

- GIVEN the project-local MJS and Node are available but the global javi-forge executable and package dependencies are unavailable
- WHEN a valid supported event is passed to the MJS
- THEN the MJS still produces the required allow or deny result

### Requirement: Security-enabled init uses the managed installer

When a user selects security hooks during `javi-forge init`, Standard and Strict profiles MUST invoke the same managed Claude installer as `javi-forge hooks install claude`. Minimal MUST NOT install the runtime guard unless the user separately and explicitly opts into the Claude guard; selecting security hooks alone is not sufficient consent for Minimal. An explicit install or repair command remains an opt-in independent of init profile. The installer MUST preflight all Claude targets before mutating target files. A safe absent, current, exact-released-outdated, or complete exact-known-legacy cohort SHALL install, no-op, upgrade, or migrate respectively. A refusal MUST mark the Claude-guard sub-step incomplete, MUST NOT claim the guard is active, and MUST leave all Claude-hook target files unchanged while preserving unrelated init output.

#### Scenario: Security-enabled init installs safely

- GIVEN security hooks are selected with Standard or Strict, or with Minimal plus separate explicit Claude-guard opt-in, and the Claude targets are absent or safely manageable
- WHEN init reaches the security-hook step
- THEN the managed asset and settings entry are installed or migrated through the shared installer
- AND init reports the managed path and exactly the five covered tools

#### Scenario: Minimal does not imply runtime-guard consent

- GIVEN security hooks are selected with the Minimal profile
- AND the user does not separately opt into the Claude guard
- WHEN init reaches the security-hook step
- THEN it does not invoke the Claude installer or create Claude guard parents/files
- AND it reports that Minimal remains CI-only and names the explicit opt-in/install path

#### Scenario: Init reports collision honestly

- GIVEN security hooks are selected and a Claude target is edited-managed, foreign, symlinked, or otherwise unsafe to mutate
- WHEN init preflights the installation
- THEN the Claude-hook operation is refused without mutating any Claude-hook target
- AND init reports the step as incomplete and points to doctor plus only the repair path eligible for that ownership state

### Requirement: Install, doctor, and repair provide explicit idempotent UX

The CLI MUST expose `javi-forge hooks install claude`, `javi-forge hooks doctor claude`, and `javi-forge hooks repair claude [--force]`.

`install` MUST install absent objects, no-op on current objects, and automatically replace only exact released-outdated or complete exact known legacy cohorts. `doctor` MUST be read-only and MUST report the asset and settings entry separately, including version/hash, command/args shape, matcher, Node availability, ownership state, actionable remediation, five-tool coverage, and host spawn/timeout residual. It MUST classify each supported project/local/user/managed/server/MDM/safe-mode/current-launch source as `clear`, `blocking`, or `unknown`; inability to prove a relevant source absent or resolved MUST be `unknown`, not `clear`. Its authoritative ordered matrix is: (1) any known installation, Node, configuration, or observed launch blocker produces `BLOCKED`, healthy false, exit `1`, even if another source is unknown; (2) otherwise any relevant higher-precedence or current-launch source that is unobservable/unresolved produces `INCONCLUSIVE`, healthy false, exit `2`; (3) only current components and exact shape/matcher with Node `>=22` and every relevant source explicitly clear produce `RUNNABLE`, healthy true, exit `0`. Blocker and unknown IDs MUST use committed stable order. `BLOCKED` MUST print the state-specific fix and rerun command. `INCONCLUSIVE` MUST print `installed bytes do not prove execution` and direct the user to `claude doctor`/`/status` and `/hooks` outside safe mode before rerunning. `RUNNABLE` MUST still print the host spawn/start/termination/timeout residual and MUST NOT say secure or fully fail-closed. `repair` without force MUST restore missing and exact-outdated managed pieces; `repair --force` MAY replace edited-managed objects only after required backups succeed. Repeating any successful command against its resulting runnable state MUST produce no further file changes; current files MUST remain byte- and mtime-stable.

#### Scenario: Install is idempotent

- GIVEN a healthy current managed installation
- WHEN `javi-forge hooks install claude` runs again
- THEN it reports the installation as current
- AND settings, asset bytes, and mtimes remain unchanged

#### Scenario: Doctor is read-only and qualified

- GIVEN any absent, healthy, outdated, edited-managed, foreign-collision, or partial installation state
- WHEN `javi-forge hooks doctor claude` runs
- THEN it reports each component's state and appropriate next action without changing bytes, mtimes, or creating backups
- AND it reports coverage and the host residual rather than an unqualified `secure` verdict

#### Scenario: Doctor detects effective execution blocker

- GIVEN managed or effective settings disable project hooks, restrict hooks to managed/plugin sources, or observable safe mode suppresses project hooks
- WHEN doctor inspects an otherwise current installation
- THEN it reports `BLOCKED`, identifies the blocker, sets healthy false, and exits non-zero

#### Scenario: Doctor cannot resolve higher-precedence policy

- GIVEN installation bytes are current
- AND a relevant server-managed, MDM, or launch policy source cannot be observed reliably
- WHEN doctor evaluates effective execution
- THEN it reports `INCONCLUSIVE`, sets healthy false, and exits non-zero
- AND it provides concrete `claude doctor`/`/status` and `/hooks` verification instructions

#### Scenario: Known blocker dominates a simultaneous unknown

- GIVEN an otherwise current installation has an observed effective blocker
- AND a different relevant higher-precedence or current-launch source is unknown
- WHEN doctor evaluates the ordered matrix
- THEN it reports `BLOCKED`, sets healthy false, exits `1`, and lists the known blocker before the secondary unknown
- AND it emits the blocker's deterministic remediation plus the doctor rerun command

#### Scenario: Runnable requires explicit all-clear evidence

- GIVEN both components are current, command shape and matcher are exact, and Node `>=22` is available
- AND every relevant supported policy and current-launch source is observably absent or permitting project hooks
- WHEN doctor evaluates effective execution
- THEN it reports `RUNNABLE`, sets healthy true, and exits `0`
- AND it still prints the host spawn/start/termination/timeout residual

#### Scenario: Repair without force restores safe drift

- GIVEN a managed component is missing or exactly matches a known released outdated version and no unsafe collision exists
- WHEN `javi-forge hooks repair claude` runs
- THEN it restores the current managed object without requiring force
- AND a second repair is a byte- and mtime-stable no-op

#### Scenario: Force is limited to edited-managed content

- GIVEN an edited-managed asset or settings entry
- WHEN repair runs without `--force`
- THEN it refuses and identifies backup plus `repair claude --force` as the eligible path
- AND when repair runs with `--force`, it proceeds only after safe backups of every edited managed target succeed

### Requirement: Ownership classification is strict and preserves unrelated hooks

Before any mutation, the installer MUST classify the asset and owned settings handler independently as absent, managed current, exact released outdated, exact known legacy, edited-managed, foreign, symlink, or non-regular. Managed objects MUST carry or be bound to an unambiguous javi-forge ownership marker plus known version/hash identity; a similar command, path, matcher, filename, partial marker, or partial legacy cohort MUST NOT prove ownership.

The installer SHALL automatically replace exact released-outdated and the complete exact known legacy cohort only. A partial cohort MUST remain foreign/unowned and MUST refuse migration in every mode. It MUST refuse edited-managed objects by default and MUST refuse foreign, symlink, and non-regular collisions even with `--force`. Settings changes MUST be structural and MUST preserve all unrelated keys, hook events, matcher groups, handlers, and their value content. Force repair MUST replace only the exact proven managed handler in a valid mixed-handler group; if the shared matcher is edited and unrelated handlers are present, it MUST refuse even with force. An already-current no-op MUST preserve the complete file bytes.

#### Scenario: Exact known legacy content migrates

- GIVEN the settings file exactly matches the known legacy scaffold or contains the complete one-of-each exact legacy cohort
- WHEN install or repair runs
- THEN only the exact full scaffold or complete cohort is removed and replaced by the current managed entry
- AND every unrelated setting and hook remains present and unchanged in value

#### Scenario: Partial legacy cohort is not independently owned

- GIVEN settings contain fewer than all exact legacy cohort members, duplicate a cohort member, or contain an edited cohort member
- WHEN install or repair, including `--force`, runs
- THEN migration is refused and every partial-cohort object remains untouched
- AND doctor reports a foreign partial-legacy cohort with manual guidance

#### Scenario: One-byte edited managed object requires force

- GIVEN a marked managed asset or settings entry differs from its known bytes or hash by one byte
- WHEN install or repair runs without force
- THEN the object is classified edited-managed and mutation is refused
- AND `repair --force` remains eligible only with successful backup

#### Scenario: Similar foreign handler is never overwritten

- GIVEN an arbitrary user handler resembles the managed path, command, or matcher but lacks provable managed identity
- WHEN install or `repair --force` runs
- THEN the colliding operation is refused
- AND the foreign handler and all unrelated hooks remain untouched

#### Scenario: Force preserves unrelated handlers

- GIVEN a valid matcher group contains one exact proven managed handler plus unrelated handlers
- WHEN `repair --force` replaces edited managed content without changing the shared matcher
- THEN only the proven managed handler is replaced at its position
- AND every unrelated handler remains unchanged in value

#### Scenario: Edited matcher with mixed handlers refuses force

- GIVEN an edited managed matcher group also contains unrelated handlers
- WHEN `repair --force` runs
- THEN repair refuses rather than replacing or retargeting the group
- AND all handlers remain untouched

#### Scenario: Symlink target is never followed for mutation

- GIVEN an asset, settings, temporary, or backup target is a symlink or non-regular object
- WHEN install or repair preflights it
- THEN the operation is refused before mutation and the object is left untouched

#### Scenario: Malformed settings refuse without replacement

- GIVEN `.claude/settings.json` is a regular file but is not valid JSON with the required structural containers
- WHEN install or repair preflights it
- THEN the operation is refused before any Claude-hook target is mutated
- AND the complete settings bytes remain unchanged for manual recovery

### Requirement: Backups, writes, rollback, and permissions are safe

The installer MUST preflight the complete existing ancestor chain before mutation and MUST keep no-follow handles with stable directory identities through the operation. Because Node has no portable dirfd-relative `openat`/`renameat`, before/after `lstat` alone MUST NOT be represented as race protection. The installer MUST additionally refuse every parent chain on which identity/local-filesystem support is inconclusive or a principal outside the defined trusted set can create, rename, or delete a traversed entry. The trusted set is the effective uid plus root on POSIX and the current user SID plus `SYSTEM`/`BUILTIN\\Administrators` on Windows; malicious same-user/trusted-administrator processes remain a documented residual. On Linux/macOS, every controlling directory MUST be effective-user/root owned, have no group/other write bits, and pass the platform ACL-absence check. Linux MUST use bounded, locale-`C` `getfacl --absolute-names --numeric --omit-header -- <path>` and refuse named/mask/default entries; macOS MUST use bounded, locale-`C` `/bin/ls -lde -- <path>` and refuse numbered/inherited ACL entries. Tool absence, parse error, changed output, or unsupported filesystem result MUST refuse. On Windows the packaged helper MUST hold no-reparse directory handles, compare volume serial plus file ID around each mutation, allow only supported local NTFS/ReFS volumes, and refuse a DACL granting create/write/delete-child/delete/write-DAC/write-owner rights to any untrusted SID or containing an unresolved mutation ACE. UNC/network paths and reparse points MUST refuse installer mutation.

For fresh installs the installer MAY create missing `.claude` and `.claude/hooks` parents one segment at a time with restrictive creation permissions, immediately open/verify/hold each directory, and only then stage; it MUST NOT promise zero filesystem mutation before same-directory staging when those parents were absent. Before and after every mkdir, temp/backup create, rename, unlink, or rmdir it MUST revalidate path identities against held handles and repeat the applicable access proof; a lost proof MUST stop mutation/cleanup and require manual recovery. These checks detect drift but the no-untrusted-writer gate is what excludes swap-out/swap-back attacks within the supported threat model. The installer MUST complete ownership, parse, target, temporary-file, backup, and permission preflights before mutating a managed target file. A failed required backup MUST leave every Claude-hook target file unmodified and MUST remove only transaction-created directories whose held identities still match and which remain empty.

Each file replacement MUST use a same-directory temporary regular file followed by atomic rename. If a later mutation fails while the installer can recover, it MUST restore every already-mutated managed target to its exact pre-operation bytes. A process or host crash between separate atomic renames MAY leave a detectable partial installation; doctor MUST identify that state and repair MUST recover it under the same ownership rules.

Temporary and backup files MUST be created exclusively with restrictive permissions **at creation time before any content write**, then written, fsynced, verified, and renamed. On POSIX, creation mode MUST be at most `0o600`; content MUST be written/fsynced while still restrictive, after which replacements/backups MUST restore the exact existing regular file mode without adding permissions and MUST verify that no extended ACL exists. Node has no portable ACL API, so this release MUST refuse replacement and forced backup when the required Linux/macOS inspector is unavailable/inconclusive, when the source has any extended ACL, or when the parent has a default/inheritable ACL; it MUST NOT strip the ACL or fall back to mode-only copying. New POSIX files/directories MUST be verified to have no extended ACL after creation. On Windows, a package-hashed built-in OS helper MUST pass the captured source DACL or protected new-file/directory DACL atomically to `CreateFileW`/`CreateDirectoryW`; creating with inherited access and tightening afterward is forbidden. The installer MUST write/flush through that securely created handle and verify the resulting DACL before rename. If helper integrity or exact source DACL preservation cannot be proven, replacement/backup MUST refuse rather than inherit or broaden access. The MJS MUST NOT require an executable bit because Node launches it explicitly. Backup permissions MUST be equal to or narrower than the source permissions.

Rollback MUST remove transaction-created parents only in reverse order, only while identity still matches, and only while empty. A crash MAY leave empty created directories, temps, or one committed component; doctor MUST report detectable remnants/partial state. The product MUST NOT claim cross-file or parent-creation atomicity.

#### Scenario: Backup failure prevents force repair

- GIVEN an edited-managed target and `repair claude --force`
- WHEN an exclusive regular-file backup cannot be created safely
- THEN repair refuses before any managed target is changed
- AND the original bytes and permissions remain intact

#### Scenario: Settings replacement is atomic

- GIVEN a safe settings update is ready to commit
- WHEN writing or flushing the same-directory temporary file fails before rename
- THEN the original settings path still contains its complete prior bytes
- AND no successful installation is reported

#### Scenario: Fresh install creates parents safely

- GIVEN `.claude` and `.claude/hooks` are absent beneath an existing regular project directory
- WHEN installation preflight succeeds
- THEN each missing parent is created restrictively one segment at a time and identity-revalidated before staging
- AND a later recoverable failure removes only those created parents that remain identity-matched and empty

#### Scenario: Windows ACL cannot be preserved

- GIVEN a Windows replacement or forced backup whose source DACL cannot be captured, applied, or verified exactly
- WHEN install or repair preflights permissions
- THEN it refuses before writing content or mutating target files
- AND it does not fall back to a broader inherited ACL

#### Scenario: POSIX extended ACL refuses replacement and backup

- GIVEN a Linux or macOS managed source has an extended ACL, its parent has a default/inheritable ACL, or the required ACL inspector cannot prove ACL absence
- WHEN install or forced repair preflights replacement and backup permissions
- THEN it refuses before creating backup/temp content or mutating a target file
- AND it does not strip the ACL, copy only mode bits, or broaden effective access

#### Scenario: Untrusted-writable parent refuses pathname mutation

- GIVEN a controlling parent is group/world writable, has an ACL/DACL mutation grant to an untrusted principal, is a reparse/network/unsupported path, or cannot provide stable handle identity
- WHEN install or repair preflights or revalidates the chain
- THEN it reports `unsafe-parent-chain` and performs no target-file mutation
- AND it does not treat matching `lstat` observations as proof against a swap-out/swap-back race

#### Scenario: Later mutation failure rolls back earlier mutation

- GIVEN all preflights succeed and one managed target is replaced before a later managed-target operation fails
- WHEN the installer can still perform recovery
- THEN it restores the earlier target to its exact pre-operation bytes and reports failure

#### Scenario: Partial state after process interruption is diagnosable

- GIVEN the process is interrupted between independent atomic renames
- WHEN doctor inspects the project afterward
- THEN it reports the asset and settings entry separately as a partial or mismatched installation
- AND repair offers only the action allowed by each object's provable ownership

### Requirement: Cross-platform paths and shell schemas remain separate

The runtime and installer MUST support Node `>=22` on the package's supported platforms. They MUST use exec-form command plus arguments, preserve paths containing spaces as one argument, canonicalize platform path aliases within an explicit bounded model, and keep Bash and PowerShell command schemas and fixtures distinct. Windows comparison MUST normalize case plus ordinary drive/UNC and recognized extended/device aliases (`\\?\`, `\\?\UNC\`, `\??\`, and drive-backed `\\.\`); unsupported device namespaces MUST fail closed rather than compare as ordinary paths. Darwin comparison MUST conservatively Unicode-normalize and case-fold paths to cover default case-insensitive volumes, with documented false-positive risk on case-sensitive volumes. Existing targets or nearest existing ancestors MUST use native realpath where available. `Read`, `Write`, and `Edit` path policy MUST use `file_path`; shell policy MUST use `command`. The implementation MUST NOT reinterpret file content fields as shell commands and MUST NOT claim perfect canonicalization across every symlink, short-name, mount, Unicode, or race alias.

#### Scenario: Project path containing spaces launches correctly

- GIVEN the project-local hook path contains spaces
- WHEN Claude launches the managed command and args representation
- THEN Node receives the MJS path as one argument without shell quoting or splitting

#### Scenario: Windows sensitive path is normalized

- GIVEN a valid supported file-tool event uses an absolute Windows path with backslashes
- WHEN the evaluator compares the path to the protected corpus
- THEN it reaches the same allow or deny class as the equivalent normalized platform path

#### Scenario: Windows extended alias does not bypass a protected path

- GIVEN a protected Windows path is expressed as an ordinary drive/UNC path or its recognized extended/device alias
- WHEN the evaluator canonicalizes it
- THEN every representation reaches the same deny class

#### Scenario: Darwin case alias does not bypass a protected path

- GIVEN a protected path on Darwin differs only by case or normalizable Unicode representation
- WHEN the evaluator canonicalizes it
- THEN it reaches the protected deny class

#### Scenario: File content is not treated as a shell command

- GIVEN a valid `Write` or `Edit` event whose content contains text matching a shell deny fixture but whose path is outside protected path corpora
- WHEN the evaluator runs
- THEN it bases the first-slice decision on the file-tool path schema and does not apply Bash or PowerShell command parsing to the content

### Requirement: Rollback removes only proven managed objects

Release documentation MUST provide a project rollback procedure. Project rollback MUST remove only the exact managed `PreToolUse` handler and exact managed asset whose ownership is proven; it MUST preserve unrelated hooks, preserve `.claude/settings.json` whenever unrelated content remains, and remove empty containers only when doing so cannot remove user content. If ownership cannot be proven, rollback MUST stop and provide manual instructions rather than deleting or rewriting the object.

The first slice SHALL NOT invent an automatic uninstall command not included in the proposal. A product rollback release MUST recognize the released managed identities it removes or replaces. Documentation MUST state that downgrading the global package alone does not remove project-local copied assets and that successful forced-repair backups can restore exact prior bytes.

#### Scenario: Manual rollback preserves unrelated hooks

- GIVEN settings contain the exact managed handler plus unrelated `PreToolUse` handlers and other hook events
- WHEN the documented project rollback is performed
- THEN only the exact managed handler and exact managed asset are removed
- AND unrelated handlers, hook events, and settings remain intact

#### Scenario: Ambiguous rollback stops safely

- GIVEN the candidate handler or asset no longer has provable managed ownership
- WHEN rollback classification runs
- THEN it does not remove or overwrite the ambiguous object
- AND it provides manual recovery guidance

### Requirement: Acceptance tests exercise shipped behavior

Implementation MUST follow strict TDD and MUST include: table-driven allow/deny policy tests for every supported tool category and the enumerated literal read/transfer command families; malformed, boundary-size, oversized, stream-error, missing-policy, and evaluator-exception tests; real-process tests spawning the actual shipped MJS and asserting exit `0` or `2`, including oversized input with the parent writer intentionally left open; real-filesystem installer tests for every ownership state, full/partial legacy cohorts, mixed-handler force behavior, idempotency, merge preservation, held parent identity, group/world/untrusted-ACE refusal, swap and swap-back attempts, safe parent creation/cleanup, backup, symlink/non-regular refusal, atomic failure, rollback, POSIX modes/ACL refusal, and Windows DACL/volume/reparse preservation/refusal; complete doctor-matrix tests for each blocker and unknown, blocker-plus-unknown precedence, all-clear `RUNNABLE`, deterministic ordering/messages, and exits `0|1|2`; Minimal trigger-matrix tests; Linux/macOS and Windows path/command representation fixtures; a `windows-latest` GitHub Actions workflow running the focused runtime/manager/integration suite plus package check; and package-tarball assertions for the exact runtime asset, Windows secure-object helper, and ownership metadata. Linux ACL integration fixtures MUST use `setfacl`/`getfacl`; macOS fixtures MUST use `chmod +a` and `/bin/ls -lde`. A real ACL fixture MAY skip only when the host lacks the capability to create/inspect that ACL; adapter tests proving refusal on unavailable, malformed, changed, or ACL-present results MUST always run.

Generated or installed MJS bytes MUST equal the package-verified asset bytes for the same version/hash. Acceptance MUST include a manual Claude `/hooks` check with the tested supported Claude version recorded and one supported allow plus one supported deny exercised. Tests and documentation MUST retain the distinction between evaluator-started failures and host spawn/timeout residuals.

#### Scenario: Actual packaged MJS enforces exit contract

- GIVEN the runtime asset selected for packaging
- WHEN tests spawn that exact MJS with valid safe, valid denied, malformed, oversized, missing-policy, and evaluator-error fixtures
- THEN safe fixtures exit `0` silently
- AND denied and evaluator-error fixtures exit `2` with bounded stderr and no sensitive payload dump

#### Scenario: Oversized process exits while writer remains open

- GIVEN tests spawn the actual packaged MJS and write at least 1,048,577 bytes without closing parent stdin
- WHEN the evaluator detects the first excess byte
- THEN the child closes promptly with code `2` and the complete bounded diagnostic
- AND the test does not need its timeout kill to obtain process close

#### Scenario: Windows continuous validation runs the supported slice

- GIVEN a pull request or push to main
- WHEN `.github/workflows/claude-hook-windows.yml` runs on `windows-latest`
- THEN it executes type checks, the focused asset/settings/manager/real-process suite, and `pnpm package:check`

#### Scenario: Package omission fails acceptance

- GIVEN an npm tarball omits or changes the required MJS asset or ownership metadata
- WHEN package-content verification runs
- THEN verification fails rather than publishing a package that cannot install the verified guard

#### Scenario: Installer state matrix is exercised on real files

- GIVEN real temporary-project fixtures for absent, current, outdated, exact legacy, edited-managed, foreign, symlink, non-regular, malformed-settings, and partial states
- WHEN install, doctor, repair, forced repair, and rollback tests run
- THEN each operation produces the ownership-preserving behavior required by this specification

## Non-Goals

- Per-skill attribution, per-installed-skill capabilities, or causal skill identity.
- Re-running the `SKILL.md` scanner over tool-call JSON.
- Matching or governing unknown/future, MCP, Web, prompt, agent, `@file`, or `EndConversation` operations.
- Environment poisoning deny rules for `LD_PRELOAD`, `NODE_OPTIONS`, `PYTHONSTARTUP`, or equivalents.
- A complete shell parser, immutable sandbox, general policy language, audit platform, anomaly detector, or privilege-ring system.
- Runtime dependency on the full javi-forge CLI, `npx`, external services, LLMs, or the Microsoft agent-governance toolkit.
- Changes to the Git-hook `SectionId` dispatcher or plugin `hooks?: string[]` metadata.
- Automatic rewriting of existing projects solely because a globally installed javi-forge package was upgraded.
- An automatic uninstall CLI command in this slice; rollback is exact-ownership-based and documented.

## Stress-Test Appendix

### Dimensions tested

Scale, adversarial, and temporal pressure were applied to the runtime boundary, managed installation, and future Claude compatibility.

### Breaking points

| # | Breaking point | Dimension | Threshold or condition | Failure mode | Detection | Priority |
|---|---|---|---|---|---|---|
| BP-1 | Input ceiling | Scale/adversarial | stdin exceeds 1,048,576 bytes | Deliberate evaluator denial | Bounded stderr plus exit `2` | P1 |
| BP-2 | Host cannot obtain evaluator result | Temporal/failure | spawn/start failure or 30-second host timeout | Tool continues through normal Claude flow | Doctor, `/hooks`, host diagnostics; no exit `2` | P1 |
| BP-3 | Managed-state collision or interrupted multi-file operation | Adversarial/temporal | edited/foreign target or interruption between renames | Refusal or partial installation | Ownership classification and component-level doctor status | P1 |

### Failure cascades

```text
BP-1: payload exceeds 1 MiB
  -> evaluator refuses after startup with exit 2
    -> supported tool call is blocked
      -> USER IMPACT: legitimate oversized calls require explicit guard removal, never silent bypass

BP-2: Node/MJS cannot start or host timeout fires
  -> no evaluator exit 2 reaches Claude
    -> Claude continues normal permission flow
      -> USER IMPACT: permissive host settings may allow an operation the global policy would deny

BP-3: ownership is ambiguous or installation is interrupted
  -> installer refuses or components disagree
    -> doctor reports per-component state
      -> USER IMPACT: guard is not reported healthy until ownership-safe repair succeeds
```

### Stress verdict

**Adequate within the declared boundary.** No P0 issue is introduced if implementation preserves the 1 MiB fail-closed evaluator path, strict ownership and rollback rules, and conspicuous host fail-open disclosure. BP-2 remains an accepted P1 residual that this command-hook protocol cannot eliminate.
