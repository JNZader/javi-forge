# Design Review Ledger — skillguard-pretooluse-hook

## Judgment Day — Design Round 1

**Verdict:** CHANGES_REQUIRED

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JD-001 | judgment-day | `design.md:173` (**Bounded reader**), `design.md:181` (**Guarded main and exit contract**); `spec.md:54` (**Oversized stdin fails closed**), `spec.md:476` (**Oversized process exits while writer remains open**) | CRITICAL | fixed | Oversize finalization now synchronously writes the bounded diagnostic, destroys/unrefs stdin, and forces exit `2`; the spawned test leaves the writer open and requires prompt close without timeout kill. |
| JD-002 | judgment-day | `design.md:128` (**Decision 5**), `design.md:355` (**Atomic write, fsync, rename, and rollback**); `spec.md:358` (**Backups, writes, rollback, and permissions**), `spec.md:382` (**Fresh install creates parents safely**) | CRITICAL | fixed | Fresh install now walks/validates ancestors, creates missing parents segment-wise with restrictive permissions, revalidates identities, stages afterward, and removes only transaction-created identity-matched empty dirs; crash/non-atomic limits are explicit. |
| JD-003 | judgment-day | `design.md:309` (**Independent component states**); `spec.md:331` (**Force preserves unrelated handlers**), `spec.md:338` (**Edited matcher with mixed handlers refuses force**) | CRITICAL | fixed | Ownership is handler-granular: force replaces only the exact proven managed handler and preserves siblings; an edited shared matcher with unrelated handlers refuses even with force. |
| JD-004 | judgment-day | `design.md:319` (**Exact legacy recognition**); `spec.md:303` (**Exact known legacy content migrates**), `spec.md:310` (**Partial legacy cohort is not independently owned**) | CRITICAL | fixed | Legacy migration is cohort-only: exactly one of all four known objects migrates; missing, duplicate, or edited partial cohorts are foreign/unowned and remain untouched in every mode. |
| JD-005 | judgment-day | `design.md:371` (**Manager Interfaces and CLI UX**); `spec.md:269` (**Doctor detects effective execution blocker**), `spec.md:275` (**Doctor cannot resolve higher-precedence policy**) | CRITICAL | fixed | Doctor now evaluates observable `disableAllHooks`, `allowManagedHooksOnly`, strict plugin-only hooks, and safe mode; blockers are unhealthy/non-zero and unresolved higher-precedence policy is `INCONCLUSIVE`/exit `2` with concrete UX. |
| JD-006 | judgment-day | `design.md:213` (**Cross-platform path canonicalization**); `spec.md:425` (**Windows extended alias does not bypass a protected path**), `spec.md:431` (**Darwin case alias does not bypass a protected path**) | CRITICAL | fixed | Path policy now bounds Windows extended/device/UNC aliases, Windows case folding, Darwin Unicode/case folding, and native realpath/ancestor resolution, while documenting short-name/mount/race and case-sensitive-volume limitations. |
| JD-007 | judgment-day | `design.md:253` (**Bash lexical boundary and rules**), `design.md:279` (**PowerShell lexical boundary and rules**); `spec.md:72` (**Bash policy...**), `spec.md:90` (**PowerShell policy...**) | CRITICAL | fixed | The literal sensitive-access corpus now includes Bash `cat`/`cp`/`install` and PowerShell `Get-Content`/`type`/`Copy-Item` command families with explicit allow/deny fixture requirements. |
| JD-008 | judgment-day | `design.md:343` (**Backup naming, permissions, and safety**), `design.md:355` (**Atomic write...**); `spec.md:358` (**Backups, writes, rollback, and permissions**), `spec.md:389` (**Windows ACL cannot be preserved**) | CRITICAL | fixed | Temps/backups are restrictive at creation before bytes, fsynced, mode/DACL-preserving, and Windows ACL capture/apply/verify failure refuses instead of inheriting broader access; backups follow the same contract. |
| JD-009 | judgment-day | `design.md:444` (**File Changes**), `design.md:472` (**Testing Strategy**); `spec.md:483` (**Windows continuous validation runs the supported slice**); `proposal.md:162` (**Affected Areas**) | CRITICAL | fixed | File plan adds `.github/workflows/claude-hook-windows.yml` on `windows-latest` with exact Node/pnpm setup and focused typecheck, runtime/settings/manager/real-process, ACL/path, and package-check command. |
| JD-010 | judgment-day | `design.md:432-442` (init trigger matrix); `spec.md:234` (**Minimal does not imply runtime-guard consent**); `proposal.md:3` (**Decision Summary**), `proposal.md:89` (**Security-enabled init**) | WARNING | info | Amended per user authorization: Minimal no longer installs from `securityHooks` alone; only a separate explicit init opt-in or explicit hooks command triggers the runtime guard. |

Judges also validated the current Claude matcher/config protocol, JSON stdin fields, exact supported-tool matcher, exit 2 blocking semantics, standalone asset packaging, 1 MiB ceiling intent, explicit host fail-open residual, and four delivery slices.

## Fix Round 1 Re-review

**Verdict:** FAIL

- Judge A could not independently verify the fixes because all planning artifacts were still untracked; no pre-fix → post-fix diff existed. This is a review-evidence failure, not a new product defect. A committed planning baseline is required before Fix Round 2.
- Judge B verified JD-001, JD-003, JD-004, JD-006, JD-007, JD-009, and the JD-010 amendment.

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JD-FR1-001 | judgment-day | `design.md:359-366` | CRITICAL | open | Parent identity is checked but subsequent temp creation and rename remain pathname-based. A symlink/junction swap after validation can redirect staging or replacement. |
| JD-FR1-002 | judgment-day | `design.md:426-430`; `spec.md:253,275-281`; `proposal.md:104-106` | CRITICAL | open | Doctor status is contradictory: design permits RUNNABLE while proposal/spec require INCONCLUSIVE when relevant higher-precedence or launch policy is unobservable. |
| JD-FR1-003 | judgment-day | `design.md:351-369`; `spec.md:358-366` | CRITICAL | open | Existing POSIX extended ACLs are not captured or preserved; mode-only replacement can broaden effective access. |

Fix Round 2 must establish an auditable baseline, resolve these three findings, and then run one final scoped re-review. Anything still open after that round is reported without extending the loop.

## Fix Round 1 — Amendment Evidence

Design/spec artifacts only; no production files were changed.

| Finding | Amendment evidence | Exact anchors |
|---|---|---|
| JD-001 | Deterministic denial finalizer and open-writer spawned-process assertion. | `design.md` — **Bounded reader**, **Guarded main and exit contract**, **Testing Strategy / Spawned integration**; `spec.md` — **Runtime input is bounded and schema-aware / Oversized stdin fails closed**, **Acceptance tests / Oversized process exits while writer remains open**. |
| JD-002 | Honest parent-first transaction with segment identity checks, restrictive creation, staged-after-parent ordering, and bounded empty-dir rollback. | `design.md` — **Decision 5**, **Atomic write, fsync, rename, and rollback**; `spec.md` — **Backups, writes, rollback, and permissions / Fresh install creates parents safely**. |
| JD-003 | Handler-granular managed identity and mixed-group force refusal when matcher scope changed. | `design.md` — **Independent component states**; `spec.md` — **Ownership classification... / Force preserves unrelated handlers**, **Edited matcher with mixed handlers refuses force**. |
| JD-004 | One deterministic full-cohort rule; partial/duplicate/edited cohort is foreign and non-removable. | `design.md` — **Exact legacy recognition**; `spec.md` — **Ownership classification... / Exact known legacy content migrates**, **Partial legacy cohort is not independently owned**. |
| JD-005 | Effective execution status (`RUNNABLE|BLOCKED|INCONCLUSIVE`), blocker sources, non-zero exits, and manual resolved-settings UX. | `design.md` — **Manager Interfaces and CLI UX**; `spec.md` — **Install, doctor, and repair... / Doctor detects effective execution blocker**, **Doctor cannot resolve higher-precedence policy**. |
| JD-006 | Platform-specific Windows namespace/case and Darwin case/Unicode normalization plus realpath and honest residuals. | `design.md` — **Cross-platform path canonicalization**; `spec.md` — **Cross-platform paths... / Windows extended alias...**, **Darwin case alias...**. |
| JD-007 | Added ordinary literal transfer/read command families and tests while retaining bounded lexer claims. | `design.md` — **Bash lexical boundary and rules**, **PowerShell lexical boundary and rules**; `spec.md` — **Bash policy...**, **PowerShell policy...**, **Acceptance tests...**. |
| JD-008 | Restrictive create-before-write, fsync, POSIX mode preservation, Windows DACL adapter, and fail-on-unprovable ACL policy. | `design.md` — **Backup naming, permissions, and safety**, **Atomic write...**; `spec.md` — **Backups, writes, rollback, and permissions / Windows ACL cannot be preserved**. |
| JD-009 | Concrete `windows-latest` workflow path and exact focused command. | `design.md` — **File Changes**, **Testing Strategy**; `spec.md` — **Acceptance tests... / Windows continuous validation runs the supported slice**; `proposal.md` — **Affected Areas**. |
| JD-010 | Explicit trigger matrix keeps Minimal CI-only absent separate opt-in. | `design.md` — **Manager Interfaces and CLI UX** trigger matrix; `spec.md` — **Security-enabled init... / Minimal does not imply runtime-guard consent**; `proposal.md` — **Decision Summary**, **Security-enabled init**. |
