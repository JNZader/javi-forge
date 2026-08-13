# Tasks: Managed Global Claude PreToolUse Guard

## Planning Basis

- Change: `skillguard-pretooluse-hook`
- Base implementation branch: `feat/skillguard-pretooluse-hook`
- Artifact mode: hybrid (OpenSpec + Engram)
- Delivery policy: ask-always; implementation MUST NOT begin until the user selects a chain strategy.
- Review limit: every PR slice MUST remain at or below 800 changed lines; every work-unit commit SHOULD remain below 400 changed lines and keep its tests with its behavior.
- Execution model: complete the four slices sequentially in the design dependency order. Do not assign parallel writers to one shared working tree.
- TDD rule: within every work unit, execute RED tasks before GREEN tasks, then REFACTOR/VERIFY. A GREEN task is not complete until its named RED tests pass.
- Source coverage note: the approved current spec contains 18 requirements and **65** scenarios. The earlier input count of 49 scenarios predates Judgment Day amendments; this plan maps all 65 scenarios now present in `spec.md`.

## Requirement and Scenario IDs

| ID | Requirement | Scenario IDs in source order |
|---|---|---|
| R1 | Global guard scope is explicit and bounded | R1.S1 Allowed invocation remains subject to Claude permissions; R1.S2 Denial has no skill attribution |
| R2 | Matcher covers exactly the supported tools | R2.S1 Supported tool invokes the guard; R2.S2 Unknown tool is excluded |
| R3 | Runtime input is bounded and schema-aware | R3.S1 Valid payload at the ceiling; R3.S2 Oversized stdin; R3.S3 Malformed JSON; R3.S4 Wrong event or missing schema |
| R4 | Bash policy produces deterministic decisions | R4.S1 Safe Bash; R4.S2 Denied Bash |
| R5 | PowerShell policy is distinct and deterministic | R5.S1 Safe PowerShell; R5.S2 Denied PowerShell |
| R6 | Read protects sensitive paths | R6.S1 Ordinary Read; R6.S2 Sensitive Read |
| R7 | Write protects sensitive and managed paths | R7.S1 Ordinary Write; R7.S2 Protected Write |
| R8 | Edit protects sensitive and managed paths | R8.S1 Ordinary Edit; R8.S2 Protected Edit |
| R9 | Evaluator errors fail closed only after startup | R9.S1 Missing policy; R9.S2 Evaluation exception; R9.S3 Host spawn failure residual; R9.S4 Host timeout residual |
| R10 | Diagnostics are bounded and non-sensitive | R10.S1 Denial does not leak command; R10.S2 Malformed input is not dumped |
| R11 | Packaged runtime is standalone/current Claude shape | R11.S1 Nested exec form; R11.S2 No package-resolution dependency |
| R12 | Security-enabled init uses managed installer | R12.S1 Safe init; R12.S2 Minimal consent boundary; R12.S3 Honest collision report |
| R13 | Explicit install, doctor, and repair UX | R13.S1 Install idempotency; R13.S2 Doctor read-only; R13.S3 Effective blocker; R13.S4 Unresolved policy; R13.S5 Blocker dominates unknown; R13.S6 Explicit all-clear; R13.S7 Repair safe drift; R13.S8 Force eligibility |
| R14 | Strict ownership preserves unrelated hooks | R14.S1 Exact legacy migration; R14.S2 Partial cohort refusal; R14.S3 One-byte edit; R14.S4 Similar foreign handler; R14.S5 Mixed-handler preservation; R14.S6 Edited matcher refusal; R14.S7 Symlink/non-regular refusal; R14.S8 Malformed settings refusal |
| R15 | Safe backups, writes, rollback, and permissions | R15.S1 Backup failure; R15.S2 Atomic settings; R15.S3 Safe parent creation; R15.S4 Windows DACL refusal; R15.S5 POSIX ACL refusal; R15.S6 Unsafe parent refusal; R15.S7 Later-failure rollback; R15.S8 Diagnosable partial state |
| R16 | Cross-platform paths and shell schemas remain separate | R16.S1 Path with spaces; R16.S2 Windows sensitive path; R16.S3 Windows extended alias; R16.S4 Darwin case alias; R16.S5 File content not shell input |
| R17 | Rollback removes only proven managed objects | R17.S1 Manual rollback preserves unrelated hooks; R17.S2 Ambiguous rollback stops |
| R18 | Acceptance tests exercise shipped behavior | R18.S1 Exact MJS exit contract; R18.S2 Open-writer oversized exit; R18.S3 Windows validation; R18.S4 Package omission; R18.S5 Real-filesystem state matrix |

## Slice 1: Standalone Runtime Policy (forecast: 700-780 changed lines)

### Slice Contract

- **Objective:** deliver the exact dependency-free MJS evaluator, embedded v1 policy, runtime manifest identities, pure policy tests, and real-process enforcement tests without exposing installer or CLI mutation behavior.
- **Allowed paths:**
  - `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs`
  - `assets/claude-hooks/manifest.json`
  - `src/constants.ts`
  - `src/__tests__/claude-hook-assets.test.ts`
  - `src/__integration__/claude-pretooluse-exec.integration.test.ts`
  - `.github/workflows/claude-hook-windows.yml` (runtime-only job in this slice)
- **Forbidden/deferred paths:** `src/lib/claude-hook-settings.ts`, `src/lib/claude-hook-manager.ts`, command/dispatch/init/UI/help/package-verifier/README files, and the stale legacy template.
- **Dependency:** approved proposal/spec/design and CLEAN review ledger only; no production slice dependency.
- **Autonomous start:** the branch contains the approved planning artifacts and no implementation from a later slice.
- **Autonomous finish:** focused asset and spawned-process suites pass on Linux; the runtime-only Windows job is valid; the MJS can be imported and spawned without CLI/package dependencies; no install command exists yet.
- **Verification commands:**
  - `pnpm vitest run src/__tests__/claude-hook-assets.test.ts`
  - `pnpm vitest run src/__integration__/claude-pretooluse-exec.integration.test.ts`
  - `pnpm typecheck && pnpm typecheck:test`
  - `pnpm lint`
- **Rollback boundary:** revert only the runtime asset, runtime manifest entries, constants, runtime tests, and runtime-only Windows workflow job. No project settings or consumer files can have been mutated by this slice.
- **Demo/acceptance:** spawn the exact asset with one safe Bash event (silent exit `0`), one denied Bash event (bounded stderr and exit `2`), one ordinary file-tool event, and an oversized stream whose writer remains open; show that an unknown tool is outside the managed matcher contract rather than treated as allowed.

### Work Unit 1A — Protocol, scope, and file-tool policy (<400 lines)

- [x] **1.1 RED — Define exact asset/manifest contract tests.** Create `src/__tests__/claude-hook-assets.test.ts` fixtures that import the exact MJS and fail until it exports a versioned registry, exact five-tool support set, 240-byte diagnostic cap, exact managed marker, Node-built-in-only imports, and manifest-bound SHA-256 identity. Cover R1.S1-R1.S2, R2.S1-R2.S2, R10.S1-R10.S2, and R11.S2.
- [x] **1.2 RED — Define schema and path-policy tables.** In `src/__tests__/claude-hook-assets.test.ts`, add table-driven failures for empty/primitive/array/malformed/wrong-event/wrong-tool-input payloads, exact 1,048,576-byte acceptance, and Read/Write/Edit allow/deny corpora. Include Windows separator/drive/UNC/recognized extended aliases, unsupported device namespaces, Darwin case/Unicode aliases, nearest-ancestor realpath behavior, and file content containing shell deny text. Cover R3.S1-R3.S4, R6.S1-R8.S2, and R16.S2-R16.S5.
- [x] **1.3 GREEN — Implement bounded guarded evaluator foundation.** Create `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs` with pure exports, exact marker, embedded registry validation, byte-counted stdin reader, schema validation, host-independent/native path canonicalization, protected path corpora, once-only `denyAndExit`, synchronous bounded stderr, stdin destroy/unref, and intentional exits `0|2` only. Make 1.1-1.2 pass without importing package dependencies or inspecting file content fields.
- [x] **1.4 GREEN — Bind runtime identity.** Create `assets/claude-hooks/manifest.json`, add `CLAUDE_HOOK_ASSETS_DIR` in `src/constants.ts`, and make tests recompute rather than trust current asset/version/policy hashes. Establish the append-only historical-array invariant without adding future identities.
- [x] **1.5 REFACTOR/VERIFY — Harden pure runtime boundaries.** Remove duplicate normalizers/finalizers, assert allowed evaluations are silent, assert diagnostics omit secret-looking suffixes/payloads and are at most 240 UTF-8 bytes plus newline, and rerun the Work Unit 1A tests.
- [x] **1.6 COMMIT — Record Work Unit 1A with tests and behavior together.** Candidate message: `feat(skillguard): add standalone PreToolUse protocol and path policy`. Confirm `git diff --stat` keeps the commit below 400 changed lines; split by protocol vs file-policy behavior only if required, never by “tests then code.”

### Work Unit 1B — Shell corpora and exact-process enforcement (<400 lines)

- [x] **1.7 RED — Define separate Bash and PowerShell policy corpora.** Extend `src/__tests__/claude-hook-assets.test.ts` with independent lexer/rule tables for destructive roots/disks, pipe-to-shell, sensitive display/search/source/transfer/input-redirection commands, force push, managed-config tampering, and obfuscated nested interpreters. Include Bash `cat|less|more|head|tail|bat|grep|rg|sed|awk|source|.|cp|install` and PowerShell `Get-Content|gc|cat|type|Select-String|Copy-Item|cp|copy`, plus safe near misses. Cover R4.S1-R5.S2 and the shell portions of R16.S5.
- [x] **1.8 GREEN — Implement deterministic shell-specific lexers/rules.** Extend the MJS with bounded Bash and PowerShell segmentation, fixed wrapper/alias handling, recursive recognized substitutions, deterministic rule order/IDs, path operand extraction, and no environment-poisoning/general-shell-parser claims. Make 1.7 pass while preserving the file-tool schema boundary.
- [x] **1.9 RED — Specify spawned exact-asset behavior.** Create `src/__integration__/claude-pretooluse-exec.integration.test.ts` to spawn `process.execPath` with the exact packaged MJS. Assert safe/denied/malformed/exact-ceiling/oversized/missing-policy/evaluator-throw cases, no stdout, exit `0|2`, complete bounded stderr, no secret echo, path-with-spaces argv integrity, and independence from global javi-forge/dependencies. For oversized input, leave parent stdin open and require close within 500 ms without the 2-second kill timer. Cover R3.S1-R3.S3, R9.S1-R9.S2, R10.S1-R10.S2, R11.S2, R16.S1, R18.S1-R18.S2.
- [x] **1.10 GREEN — Complete guarded process entry and denial-only fault injection.** Add entry-point-only `main()`, top-level guarded registry/read/evaluate flow, and only `--javi-forge-test-fault=missing-policy|evaluator-throw`; ensure neither flag can turn a denial into an allow and every started-evaluator error forces exit `2`.
- [x] **1.11 GREEN — Add runtime-only Windows continuous validation.** Create `.github/workflows/claude-hook-windows.yml` for `pull_request` and `push` to `main`, `windows-latest`, Node 22, pnpm 10, frozen install, typechecks, and the focused asset/real-process suites available in this slice. Do not yet reference manager/package tests that do not exist.
- [x] **1.12 REFACTOR/VERIFY — Close runtime slice.** Run all Slice 1 commands, statically reject non-`node:*` imports/network/package resolution, verify MJS/manifest hashes, and document in test names that pre-start spawn/parse/timeout failures remain host fail-open residuals rather than evaluator denials.
- [x] **1.13 COMMIT — Record Work Unit 1B with tests and behavior together.** Candidate message: `feat(skillguard): enforce shell policy in the shipped evaluator`. Keep the runtime workflow with the exact process behavior it validates and keep the commit below 400 changed lines.

## Slice 2: Ownership, Migration, and Read-Only Doctor Core (forecast: 650-750 changed lines)

### Slice Contract

- **Objective:** define exact current settings shape, handler-granular ownership, finite legacy migration, safe removal planning, independent component diagnosis, and pure ordered doctor status semantics without any filesystem mutation API.
- **Allowed paths:**
  - `src/lib/claude-hook-settings.ts`
  - `src/lib/claude-hook-settings.test.ts`
  - `src/lib/claude-hook-manager.ts` (read-only classification/doctor only)
  - `src/lib/claude-hook-manager.test.ts` (read-only fixtures only)
  - `assets/claude-hooks/manifest.json` (settings canonical identity/history only)
  - `templates/security-hooks/claude-settings-security.json` (read as an exact fixture; MUST remain byte-stable)
- **Forbidden/deferred paths:** mutation helpers, Windows secure-object helper, command/dispatch/init/UI/help/package-verifier/README, and runtime-policy behavior except manifest identity consumption.
- **Dependency:** Slice 1 merged/available; imports current runtime and manifest identity but does not modify evaluator behavior.
- **Autonomous start:** Slice 1 verification is green and its exact asset hash is stable.
- **Autonomous finish:** all settings/ownership states and full/partial legacy cases classify deterministically; pure doctor ordering produces `BLOCKED|INCONCLUSIVE|RUNNABLE`; no test creates a backup/temp or mutates a consumer target.
- **Verification commands:**
  - `pnpm vitest run src/lib/claude-hook-settings.test.ts src/lib/claude-hook-manager.test.ts`
  - `pnpm vitest run src/__tests__/claude-hook-assets.test.ts`
  - `pnpm typecheck && pnpm typecheck:test`
  - `pnpm lint`
- **Rollback boundary:** revert only pure settings/ownership/doctor modules, tests, and settings identity metadata. Slice 1 runtime remains usable and no consumer installation exists.
- **Demo/acceptance:** feed fixtures for current, complete legacy cohort, partial/duplicate/edited legacy, one-byte edited managed, similar foreign, mixed-handler, malformed, and partial component states; show exact nested exec shape, preserved unrelated values, safe removal plans, and deterministic doctor status/exit for blocker, unknown, blocker-plus-unknown, and all-clear inputs.

### Work Unit 2A — Settings identity and migration ownership (<400 lines)

- [ ] **2.1 RED — Specify exact generated settings identity.** Create `src/lib/claude-hook-settings.test.ts` tests for `hooks.PreToolUse`, exact matcher `Bash|PowerShell|Read|Write|Edit`, nested `{type:"command", command:"node", args:["${CLAUDE_PROJECT_DIR}/.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs"], timeout:30, statusMessage:<version/hash marker>}`, canonical structural hash, paths with spaces as one arg, unknown-tool exclusion, and no shell-form fields. Cover R2.S1-R2.S2 and R11.S1.
- [ ] **2.2 GREEN — Implement settings construction/canonical identity.** Create `src/lib/claude-hook-settings.ts` with typed pure helpers that build and validate only the approved schema, clone only relevant containers, preserve insertion order/value content, and bind marker identity to recomputed manifest hashes.
- [ ] **2.3 RED — Specify strict handler/component ownership matrix.** Add tables for absent/current/released-outdated/edited-managed/foreign/duplicate marker/malformed/symlink/non-regular descriptors; handler-granular mixed groups; edited matcher with siblings; similar commands/paths without marker; and one-byte changes. Cover R14.S3-R14.S8.
- [ ] **2.4 RED — Specify finite legacy ownership and migration.** Add exact hash assertion for the byte-stable legacy template and structural fixtures for exactly one of each four-object cohort, full-file scaffold, missing/duplicate/edited partial cohorts, and unrelated sibling preservation. Cover R14.S1-R14.S2.
- [ ] **2.5 GREEN — Implement classifier, merge, migration, and removal plans.** Add pure classification and plan types for install/repair/removal. Migrate only full exact scaffold/cohort; force eligibility applies only to marker-proven edited-managed handlers; foreign/partial/mixed edited-matcher collisions always refuse; preserve unrelated values/positions; removal targets only proven current/historical identities. Cover R17.S1-R17.S2 at plan level.
- [ ] **2.6 REFACTOR/VERIFY — Prove no-op and preservation invariants.** Add exact current-input byte/no-serialization assertions, parsed unrelated-subtree equality after real changes, deterministic canonicalization, and tests that the legacy template remains unchanged.
- [ ] **2.7 COMMIT — Record Work Unit 2A.** Candidate message: `feat(skillguard): classify managed Claude hook ownership`. Keep identity tests, legacy fixtures, and pure behavior together under 400 changed lines.

### Work Unit 2B — Read-only doctor model and ordered status (<400 lines)

- [ ] **2.8 RED — Specify component-level read-only doctor reports.** In `src/lib/claude-hook-manager.test.ts`, use read-only filesystem fixtures for absent/current/outdated/edited/foreign/malformed/partial asset and settings combinations. Assert version/hash, exact matcher/command shape, Node availability/version, stable coverage, state-specific remediation, no writes/backups/mtime changes, and separate component reporting. Cover R13.S2 and R15.S8.
- [ ] **2.9 RED — Specify authoritative doctor tri-state decision.** Add pure source-inventory tables with stable IDs and `clear|blocking|unknown` values. Assert: any blocker => `BLOCKED`, healthy false, exit `1`; otherwise any unknown => `INCONCLUSIVE`, healthy false, exit `2`; explicit all-clear with current components/shape and Node >=22 => `RUNNABLE`, healthy true, exit `0`. Assert blocker precedence, stable ordering/messages, exact rerun/manual probes, five-tool coverage, and host residual. Cover R9.S3-R9.S4 and R13.S3-R13.S6.
- [ ] **2.10 GREEN — Implement read-only doctor core.** In `src/lib/claude-hook-manager.ts`, implement package/installed asset reads, settings reads/classification, Node probe abstraction, source-observation types, pure ordered status resolution, and `doctorClaudePreToolUse` report generation with no mutation imports or behavior.
- [ ] **2.11 REFACTOR/VERIFY — Keep doctor honest and deterministic.** Assert unreadable/unobservable sources cannot become clear, current bytes alone cannot become runnable, `secure`/unqualified `fail-closed` never appears, and host spawn/start/termination/timeout residual remains in every status.
- [ ] **2.12 COMMIT — Record Work Unit 2B.** Candidate message: `feat(skillguard): add read-only Claude hook doctor core`. Keep all doctor state/precedence tests with the report logic and below 400 changed lines.

## Slice 3: Transactional Install and Repair (forecast: 720-800 changed lines)

### Slice Contract

- **Objective:** complete library-level install/repair/removal transactions with strict ownership, private parent-chain proof, fail-closed POSIX ACL/DACL handling, restrictive backups/temps, asset-first atomic commits, recoverable rollback, and Windows helper-backed filesystem operations. No public command or init wiring yet.
- **Allowed paths:**
  - `src/lib/claude-hook-manager.ts`
  - `src/lib/claude-hook-manager.test.ts`
  - `assets/claude-hooks/javi-forge-windows-secure-object.ps1`
  - `assets/claude-hooks/manifest.json`
  - `.github/workflows/claude-hook-windows.yml` (manager/helper job extension)
- **Forbidden/deferred paths:** command/dispatch/init/UI/help/package-verifier/README and the exact legacy template; settings pure helpers may be consumed but not weakened.
- **Dependency:** Slices 1 and 2 complete; transaction plans consume exact runtime/settings identities and read-only doctor reports.
- **Autonomous start:** current asset/settings hashes and all classifier/doctor tests are green.
- **Autonomous finish:** library install/repair is idempotent; all target-file mutations pass the strict parent/ACL gate; force backs up only edited-managed content; recoverable later failures restore prior state; Windows focused CI validates helper-backed behavior. No CLI route invokes the manager yet.
- **Verification commands:**
  - `pnpm vitest run src/lib/claude-hook-settings.test.ts src/lib/claude-hook-manager.test.ts`
  - `pnpm vitest run src/__tests__/claude-hook-assets.test.ts src/__integration__/claude-pretooluse-exec.integration.test.ts`
  - `pnpm typecheck && pnpm typecheck:test`
  - `pnpm lint`
  - On Linux with ACL capability: run the focused manager test with real `setfacl/getfacl` fixtures; on macOS run its `chmod +a`/`/bin/ls -lde` counterpart.
- **Rollback boundary:** revert manager mutation code/tests, helper/manifest helper hash, and manager Windows job. Slice 2 remains a read-only doctor/classifier; no user-facing install route exists.
- **Demo/acceptance:** against temporary projects, demonstrate fresh install, stable no-op, known-outdated upgrade, exact legacy migration, edited-managed force with complete backups, foreign/partial/symlink/malformed refusal, unsafe parent/POSIX ACL/Windows DACL refusal, injected second-rename rollback, and doctor recovery guidance for an interrupted partial state.

### Work Unit 3A — Private parent chain and secure platform adapters (<400 lines)

- [ ] **3.1 RED — Specify fail-closed parent-chain abstraction.** Extend `src/lib/claude-hook-manager.test.ts` with injected adapters for held no-follow handles, stable `dev+ino` or volume/file IDs, around-mutation revalidation, local-filesystem proof, owner/trusted-principal checks, group/world/untrusted-ACE refusal, symlink/reparse/UNC/network/unsupported-volume refusal, and swap/swap-back attempts. Assert `unsafe-parent-chain` and zero target-file mutation. Cover R14.S7 and R15.S6.
- [ ] **3.2 RED — Specify POSIX ACL refusal and restrictive creation.** Add always-running adapter tests for unavailable/malformed/changed inspector output, named/mask/default/inherited ACLs, unsafe ownership/mode, and no mode-only fallback. Add capability-gated real Linux `setfacl/getfacl` and macOS `chmod +a`/`/bin/ls -lde` fixtures. Assert new parent/temp/backup modes are restrictive before content and ACL absence is rechecked. Cover R15.S3 and R15.S5.
- [ ] **3.3 GREEN — Implement Linux/macOS parent and ACL adapters.** Add bounded locale-`C` inspector execution, exact parsers, held identity lifecycle, restrictive segment-wise `.claude`/`hooks` creation, around-operation proof, identity-matched empty reverse cleanup, and refusal on any inconclusive capability. Do not claim pathname checks provide dirfd-relative safety.
- [ ] **3.4 RED — Specify Windows helper integrity and DACL behavior.** Add tests/fixtures for helper hash validation, framed stdin bytes, held `CreateFileW` directory handles, stable IDs, NTFS/ReFS-only policy, reparse/UNC refusal, trusted SID mutation rights, unresolved/conditional/object ACE refusal, explicit secure DACL creation, exact source DACL preservation, and no inherited-then-tightened intermediate. Cover R15.S4 and Windows portion of R15.S6.
- [ ] **3.5 GREEN — Implement and bind Windows secure-object helper.** Create `assets/claude-hooks/javi-forge-windows-secure-object.ps1`, update its exact hash in `manifest.json`, and add manager adapter invocation that fails before content/target mutation on helper/hash/DACL/volume/identity ambiguity.
- [ ] **3.6 REFACTOR/VERIFY — Validate platform refusal boundaries.** Ensure every pathname mutation passes through one gate; POSIX extended ACLs are never stripped; Windows access is never broadened; malicious same-user/trusted-admin behavior remains an explicit residual in report details.
- [ ] **3.7 COMMIT — Record Work Unit 3A.** Candidate message: `feat(skillguard): enforce private parent and ACL preflights`. Keep adapter tests and helper behavior together and below 400 changed lines.

### Work Unit 3B — Two-target transaction, force backups, and recovery (<400 lines)

- [ ] **3.8 RED — Specify install/repair state matrix on real files.** Add temporary-project tests for absent/current/released-outdated/full legacy/partial legacy/edited-managed/foreign/malformed/symlink/non-regular/partial states. Assert install and repair plan both components before target mutation, current bytes/mtime remain stable, missing/known drift repairs without force, force only applies to edited-managed, and similar foreign content refuses even with force. Cover R13.S1, R13.S7-R13.S8, R14.S1-R14.S8, and R18.S5.
- [ ] **3.9 RED — Specify backup/temp/commit failure matrix.** Inject deterministic clock/nonces and failures for exclusive backup collision/exhaustion, open/write/fsync/mode-or-DACL verification/rename, destination revalidation, settings-second commit, rollback, cleanup, and concurrent post-write edits. Assert complete prior bytes/permissions, asset-first ordering, same-directory temps, backup naming, backup-before-target mutation, reverse rollback only on transaction-owned hashes, and manual recovery when proof is lost. Cover R15.S1-R15.S2 and R15.S7-R15.S8.
- [ ] **3.10 GREEN — Implement transactional install/repair/removal primitive.** Extend `src/lib/claude-hook-manager.ts` with full preflight, prepared restrictive backups/rollback temps, asset-first then settings atomic renames, fsync/durability boundaries, exact mode/DACL preservation, rollback/remove-created-target logic, and changed/backups/errors results. Expose `installClaudePreToolUse`, `repairClaudePreToolUse`, and ownership-safe `planManagedClaudeHookRemoval`; do not expose uninstall dispatch.
- [ ] **3.11 GREEN — Recover fresh-parent and partial states.** Integrate parent creation as recorded first mutations, remove only identity-matched empty created parents on recoverable failure, retain diagnosable remnants on lost proof/crash simulation, and ensure post-operation doctor reports coherent current or component-level partial state.
- [ ] **3.12 GREEN — Extend Windows continuous validation for manager/helper.** Update `.github/workflows/claude-hook-windows.yml` to run the focused asset/settings/manager/real-process suite available through Slice 3, including DACL/path/reparse/local-volume fixtures. Package verification remains deferred to Slice 4.
- [ ] **3.13 REFACTOR/VERIFY — Close mutation library.** Run Slice 3 commands; assert no blind recursive mkdir, direct truncate/write, foreign force overwrite, ACL stripping, shell-form process invocation, or mtime change on current no-op.
- [ ] **3.14 COMMIT — Record Work Unit 3B.** Candidate message: `feat(skillguard): install and repair Claude hooks transactionally`. Keep state-matrix/fault tests with transaction behavior and below 400 changed lines.

## Slice 4: Product Wiring, Packaging, Rollout, and Manual Acceptance (forecast: 520-680 changed lines)

### Slice Contract

- **Objective:** expose install/doctor/repair console UX, complete effective-policy inventory and tri-state output, integrate the shared installer into Standard/Strict and explicitly opted-in Minimal init, verify package contents, finish Windows continuous validation, and document honest rollout/manual rollback.
- **Allowed paths:**
  - `src/commands/claude-hooks.ts`
  - `src/cli/dispatch/hooks.tsx`
  - `src/cli/dispatch/hooks.test.ts`
  - `src/cli/help.ts`
  - `src/commands/init/steps/security.ts`
  - `src/commands/init/steps/security.test.ts`
  - `src/ui/App.tsx`
  - `src/ui/OptionSelector.tsx`
  - `src/ui/OptionSelector.test.tsx`
  - `src/types/index.ts`
  - `src/lib/claude-hook-manager.ts` and `.test.ts` (effective policy-source inventory adapters only)
  - `scripts/verify-package-contents.mjs`
  - `.github/workflows/claude-hook-windows.yml`
  - `README.md`
- **Forbidden paths:** runtime policy corpus, ownership weakening, legacy template edits, Git-hook `SectionId` behavior, plugin `hooks?: string[]`, automatic uninstall command, and unrelated init output.
- **Dependency:** Slices 1-3 complete and green; public routes may call only the shared manager API proven in Slice 3.
- **Autonomous start:** library install/doctor/repair demos pass with no command/UI exposure.
- **Autonomous finish:** commands and init trigger matrix are public and tested; doctor inventories supported effective sources and returns exact `0|1|2`; package tarball verification and the final Windows workflow pass; README/manual `/hooks` checklist covers rollout/rollback and residuals.
- **Verification commands:**
  - `pnpm vitest run src/cli/dispatch/hooks.test.ts src/commands/init/steps/security.test.ts src/ui/OptionSelector.test.tsx src/lib/claude-hook-manager.test.ts`
  - `pnpm vitest run src/__tests__/claude-hook-assets.test.ts src/lib/claude-hook-settings.test.ts src/__integration__/claude-pretooluse-exec.integration.test.ts`
  - `pnpm package:check`
  - `pnpm validate`
  - `pnpm build`
- **Rollback boundary:** revert command/dispatch/init/UI/help/effective-source adapters/package verifier/workflow/docs. Library and runtime remain present in the npm source tree but are unreachable from public install/init flows; existing project-local copies are not removed by reverting the global package.
- **Demo/acceptance:** run public install twice, doctor in `BLOCKED`, `INCONCLUSIVE`, and `RUNNABLE` fixtures, repair safe drift, force-refusal/eligible-force cases, Standard/Strict init, Minimal default skip and explicit opt-in, tarball verification, Windows workflow, and the documented Claude `/hooks` allow/deny check on Claude >=2.1.214 (record tested version, target 2.1.231+).

### Work Unit 4A — Public lifecycle commands and doctor inventory (<400 lines)

- [ ] **4.1 RED — Specify command routing and flags.** Extend `src/cli/dispatch/hooks.test.ts` for `hooks install claude`, `hooks doctor claude`, and `hooks repair claude [--force]`; reject `--force` outside repair; preserve lazy `hooks run <pre-commit|pre-push>` behavior. Assert install/repair success `0`, refusal `1`, and doctor exact `0|1|2`. Cover R13.S1-R13.S8.
- [ ] **4.2 RED — Specify exact console/help honesty.** Add assertions for component states, five tools, managed path, version/hash/shape, eligible remediation only, `RUNNABLE|BLOCKED|INCONCLUSIVE`, stable IDs, `installed bytes do not prove execution`, exact Claude manual probes, host residual, global-not-per-skill language, unknown-tool exclusion, no “secure” badge, and no uninstall command. Cover R1.S1-R1.S2, R2.S2, R9.S3-R9.S4, and R13.S2-R13.S6.
- [ ] **4.3 RED — Specify effective policy-source adapters.** Extend `src/lib/claude-hook-manager.test.ts` for project/local/user/managed/server/MDM/resolved-settings sources, `disableAllHooks`, `allowManagedHooksOnly`, strict plugin-only hook customization, safe mode, and current-launch visibility. Assert unreadable/unsupported/unobservable becomes unknown, known blockers dominate, and stable inventory order is independent of filesystem enumeration.
- [ ] **4.4 GREEN — Implement command-facing lifecycle and effective doctor inventory.** Create `src/commands/claude-hooks.ts`, add only policy-source adapter completion to the manager, route lazily from `src/cli/dispatch/hooks.tsx`, and update `src/cli/help.ts`. Keep Ink/React out of `src/lib`; map manager result/report to deterministic console output and exits.
- [ ] **4.5 REFACTOR/VERIFY — Preserve Git-hook behavior and bounded claims.** Run existing hooks dispatch regression tests; verify no public text claims per-skill attribution, complete mediation, permission grant from exit `0`, or fail-closed host spawn/timeout.
- [ ] **4.6 COMMIT — Record Work Unit 4A.** Candidate message: `feat(skillguard): expose Claude hook lifecycle commands`. Keep dispatch/help/effective doctor tests with command behavior and below 400 changed lines.

### Work Unit 4B — Init consent, package acceptance, docs, and release gate (<400 lines)

- [ ] **4.7 RED — Specify init trigger and refusal matrix.** Extend `src/commands/init/steps/security.test.ts` and `src/ui/OptionSelector.test.tsx` for: securityHooks false => skip; Minimal without separate opt-in => CI-only skip/no parents; Minimal with `claudePreToolUseGuard` => shared installer; Standard/Strict => shared installer; dry-run => plan/no mutation; safe install => exact path/five tools; refusal => Claude sub-step incomplete with doctor and only state-eligible repair while unrelated `.javi-forge/ci.yaml` output remains. Cover R12.S1-R12.S3.
- [ ] **4.8 GREEN — Carry explicit Minimal opt-in and invoke shared installer.** Update `src/types/index.ts`, `src/ui/App.tsx`, `src/ui/OptionSelector.tsx`, and `src/commands/init/steps/security.ts` so the dedicated boolean defaults false for Minimal, Standard/Strict behavior follows the matrix, dry-run is side-effect free, stale template copying stops, and no refusal claims activation.
- [ ] **4.9 RED — Specify package tarball acceptance.** Extend package-verifier fixtures/tests as appropriate so `scripts/verify-package-contents.mjs` fails when the exact MJS, manifest, Windows helper, current hashes, or ownership metadata are missing/changed; assert installed/generated MJS bytes equal the package asset. Cover R18.S4.
- [ ] **4.10 GREEN — Enforce package contents and final Windows workflow.** Update `scripts/verify-package-contents.mjs`; finalize `.github/workflows/claude-hook-windows.yml` with Node 22/pnpm 10, frozen install, `pnpm typecheck`, `pnpm typecheck:test`, the exact focused asset/settings/manager/real-process suite, then `pnpm package:check`, each with PowerShell exit propagation. Cover R18.S3-R18.S4.
- [ ] **4.11 GREEN — Document rollout, residuals, and ownership-safe manual rollback.** Update `README.md` with minimum Claude 2.1.214 (record 2.1.231+ manual target), Node >=22, five-tool/global scope, 1 MiB ceiling, shell/path limitations, sibling-hook and spawn/start/termination/timeout residuals, explicit install/doctor/repair, Minimal consent, no fleet rewrite on npm/linuxbrew upgrade, exact managed-only rollback, backup restore, ambiguous stop/manual guidance, and downgrade-not-removal warning. Cover R1, R9.S3-R9.S4, R17.S1-R17.S2.
- [ ] **4.12 VERIFY — Run complete automated acceptance.** Run focused suites, `pnpm package:check`, `pnpm validate`, and `pnpm build`; confirm coverage thresholds remain unchanged and the Windows workflow command exactly matches the approved design sequence. Cover R18.S1-R18.S5.
- [ ] **4.13 VERIFY — Perform and record manual Claude acceptance.** On a private supported project path, run doctor, inspect Claude `/hooks`, record Claude version, exercise one supported safe call and one supported denied call, and separately note that a missing command/start failure is a host residual rather than a denial test. Do not modify the automated guarantee based on this manual observation.
- [ ] **4.14 COMMIT — Record Work Unit 4B.** Candidate message: `feat(skillguard): integrate Claude guard into init and packaging`. Keep init tests, package assertions, workflow, and user-visible docs with their owning behavior and below 400 changed lines.

## Requirement-to-Task Traceability

| Requirement | Scenario-to-task mapping | Coverage |
|---|---|---|
| R1 | S1 -> 1.1, 1.5, 4.2, 4.5, 4.11; S2 -> 1.1, 1.5, 4.2, 4.5 | Complete |
| R2 | S1 -> 1.1, 2.1-2.2; S2 -> 1.1, 2.1, 4.2 | Complete |
| R3 | S1 -> 1.2-1.3, 1.9-1.10; S2 -> 1.2-1.3, 1.9-1.10; S3 -> 1.2-1.3, 1.9-1.10; S4 -> 1.2-1.3 | Complete |
| R4 | S1 -> 1.7-1.8; S2 -> 1.7-1.8, 1.9-1.10 | Complete |
| R5 | S1 -> 1.7-1.8; S2 -> 1.7-1.8, 1.9-1.10 | Complete |
| R6 | S1 -> 1.2-1.3; S2 -> 1.2-1.3, 1.9 | Complete |
| R7 | S1 -> 1.2-1.3; S2 -> 1.2-1.3, 1.9 | Complete |
| R8 | S1 -> 1.2-1.3; S2 -> 1.2-1.3, 1.9 | Complete |
| R9 | S1 -> 1.9-1.10; S2 -> 1.9-1.10; S3 -> 2.9, 4.2, 4.5, 4.11; S4 -> 2.9, 4.2, 4.5, 4.11 | Complete |
| R10 | S1 -> 1.1, 1.5, 1.9-1.10; S2 -> 1.1, 1.5, 1.9-1.10 | Complete |
| R11 | S1 -> 2.1-2.2; S2 -> 1.1, 1.4, 1.9 | Complete |
| R12 | S1 -> 4.7-4.8; S2 -> 4.7-4.8; S3 -> 4.7-4.8 | Complete |
| R13 | S1 -> 3.8, 4.1; S2 -> 2.8-2.11, 4.1-4.4; S3 -> 2.9-2.11, 4.1-4.4; S4 -> 2.9-2.11, 4.1-4.4; S5 -> 2.9-2.11, 4.1-4.4; S6 -> 2.9-2.11, 4.1-4.4; S7 -> 3.8, 3.10-3.11, 4.1; S8 -> 3.8-3.10, 4.1-4.2 | Complete |
| R14 | S1 -> 2.4-2.6, 3.8; S2 -> 2.4-2.6, 3.8; S3 -> 2.3, 2.5, 3.8; S4 -> 2.3, 2.5, 3.8; S5 -> 2.3, 2.5, 3.8; S6 -> 2.3, 2.5, 3.8; S7 -> 2.3, 3.1, 3.8; S8 -> 2.3, 3.8 | Complete |
| R15 | S1 -> 3.9-3.10; S2 -> 3.9-3.10; S3 -> 3.2-3.3, 3.9-3.11; S4 -> 3.4-3.6; S5 -> 3.2-3.3; S6 -> 3.1, 3.3-3.6; S7 -> 3.9-3.11; S8 -> 2.8, 3.9-3.11 | Complete |
| R16 | S1 -> 1.9, 2.1; S2 -> 1.2-1.3; S3 -> 1.2-1.3; S4 -> 1.2-1.3; S5 -> 1.2-1.3, 1.7-1.8 | Complete |
| R17 | S1 -> 2.5, 3.10, 4.11; S2 -> 2.5, 3.10, 4.11 | Complete |
| R18 | S1 -> 1.9-1.10, 4.12; S2 -> 1.9-1.10, 4.12; S3 -> 1.11, 3.12, 4.10, 4.12; S4 -> 4.9-4.10, 4.12; S5 -> 3.8-3.11, 4.12 | Complete |

### Traceability Gap Report

- Requirements mapped: **18/18**.
- Current approved scenarios mapped: **65/65**.
- Unmapped requirements/scenarios: **none**.
- Count discrepancy: the delivery prompt says 49 scenarios, but the current approved `openspec/changes/skillguard-pretooluse-hook/specs/skillguard-pretooluse-hook/spec.md` has 65 scenario headings after Judgment Day amendments. The 16 additional current scenarios are intentionally included rather than treated as scope gaps.

## Work-Unit Commit Plan

| Commit | Slice | Deliverable behavior | Includes tests/docs | Rollback scope |
|---|---:|---|---|---|
| `feat(skillguard): add standalone PreToolUse protocol and path policy` | 1 | Bounded schema-aware runtime and file-tool policy | Exact asset unit tests + manifest assertions | Runtime protocol/path unit only |
| `feat(skillguard): enforce shell policy in the shipped evaluator` | 1 | Bash/PowerShell rules and exact-process exit behavior | Shell tables, spawned tests, runtime Windows job | Shell/process layer only |
| `feat(skillguard): classify managed Claude hook ownership` | 2 | Settings identity, exact migration, preservation/removal plans | Settings/legacy matrix | Pure ownership layer only |
| `feat(skillguard): add read-only Claude hook doctor core` | 2 | Component diagnosis and pure ordered tri-state | Read-only fixtures/precedence tests | Doctor core only |
| `feat(skillguard): enforce private parent and ACL preflights` | 3 | POSIX/Windows private-parent and ACL/DACL gate | Adapter/real ACL tests + helper | Platform gate/helper only |
| `feat(skillguard): install and repair Claude hooks transactionally` | 3 | Backups, staging, atomic commits, rollback, idempotency | Real-filesystem/fault matrix + Windows manager job | Mutation transaction only |
| `feat(skillguard): expose Claude hook lifecycle commands` | 4 | Public commands, effective doctor inventory, help | Dispatch/doctor source tests | Public lifecycle UX only |
| `feat(skillguard): integrate Claude guard into init and packaging` | 4 | Init consent, package gate, final CI/docs | Init/UI/package tests, README, workflow | Init/package/rollout only |

Each commit is a deliverable work unit, not a file-type bucket. If a commit forecast exceeds 400 changed lines, split it by independently testable behavior while retaining RED/GREEN code and tests in the same commit.

## Required Chain Skill and Strategy Decision

- Required skill before apply/PR work: `/home/javier/.config/opencode/skills/chained-pr/SKILL.md`.
- Commit discipline skill: `/home/javier/.config/opencode/skills/work-unit-commits/SKILL.md`.
- The four slices are sequential. Do not mix strategies after selection, and do not create parallel writers on the shared tree.

### Option A — Stacked PRs to `main`

Each slice starts only after its predecessor has merged (or is rebased/retargeted so the PR diff contains only its own slice):

```text
feat/skillguard-pretooluse-hook-01-runtime             -> main
feat/skillguard-pretooluse-hook-02-ownership-doctor    -> main  (after Slice 1)
feat/skillguard-pretooluse-hook-03-transaction-manager -> main  (after Slice 2)
feat/skillguard-pretooluse-hook-04-product-wiring      -> main  (after Slice 3)
```

Every PR body must state start/end/dependency/follow-up/out-of-scope, show a dependency diagram with the current PR marked `📍`, and report actual additions + deletions against the 800-line budget.

### Option B — Feature Branch Chain

Open `feat/skillguard-pretooluse-hook -> main` as the draft/no-merge tracker. Child PR targets are exactly:

```text
feat/skillguard-pretooluse-hook-01-runtime
  -> feat/skillguard-pretooluse-hook

feat/skillguard-pretooluse-hook-02-ownership-doctor
  -> feat/skillguard-pretooluse-hook-01-runtime

feat/skillguard-pretooluse-hook-03-transaction-manager
  -> feat/skillguard-pretooluse-hook-02-ownership-doctor

feat/skillguard-pretooluse-hook-04-product-wiring
  -> feat/skillguard-pretooluse-hook-03-transaction-manager
```

Review child PRs against their immediate parent. Integrate children in dependency order and merge the tracker to `main` only after all four slices are reviewed and the final aggregate verification passes. A polluted child diff is a branching/base error and must be corrected before review.

## Review Workload Forecast

| Slice | Estimated changed lines | 800-line budget status |
|---|---:|---|
| Slice 1 — Standalone Runtime Policy | 700-780 | Within budget; 20-line minimum headroom |
| Slice 2 — Ownership, Migration, and Read-Only Doctor Core | 650-750 | Within budget; 50-line minimum headroom |
| Slice 3 — Transactional Install and Repair | 720-800 | At-risk boundary; MUST split before review if actual count exceeds 800 |
| Slice 4 — Product Wiring, Packaging, Rollout | 520-680 | Within budget; 120-line minimum headroom |
| **Total** | **2,590-3,010** | Requires four review slices |

- **Chained PRs recommended Yes/No:** **Yes**.
- **800-line budget risk:** **High for Slice 3; Medium overall.** Slice 3 reaches the hard limit, and Slice 1 has little headroom. Tests/generated assets/fixtures count as changed lines and are not free.
- **Decision needed before apply:** **Yes — ask the user to select either Stacked PRs to `main` or Feature Branch Chain. Do not choose a strategy implicitly and do not start production implementation before the answer.**

## Final Apply Gate

- [ ] User selected one chain strategy under the ask-always policy.
- [ ] The selected exact branch/base sequence is recorded and will not be mixed with the alternative.
- [ ] Slice 1 starts from approved planning only; each later slice starts from its verified predecessor.
- [ ] One writer executes slices sequentially unless isolated worktrees and a separately approved orchestration plan are introduced later; no shared-tree parallel writers are assumed here.
- [ ] Every work unit follows RED -> GREEN -> REFACTOR/VERIFY and keeps tests/docs with behavior.
- [ ] Actual changed-line counts are checked before every PR; any slice over 800 is split with its owning tests before review, never accepted by silently excluding generated/runtime/test lines.
