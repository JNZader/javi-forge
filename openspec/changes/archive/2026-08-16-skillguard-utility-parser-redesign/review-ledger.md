# Review Ledger — skillguard-utility-parser-redesign

## Design Judgment Day — Round 1

**Verdict:** ESCALATED — two blind judges confirmed one BLOCKER and one CRITICAL design defect. Six single-judge CRITICAL candidates remain suspect and are not authorized for automatic fixes.

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JD-DES-001 | judgment-day | `design.md:382-415` | BLOCKER | fixed | **Confirmed by both judges.** The reference-form machine assigns every non-option operand as a target and cannot preserve a distinct mode role when reference, mode, and targets coexist, contradicting Requirement 1 / S03. **Fix R1:** mixed literal-mode + `--reference` forms are normatively `rejected-by-profile` (`mixed-mode-reference`) with complete `partialRoles`; mode777 only from accepted mode role; reference-only forms unaffected. |
| JD-DES-002 | judgment-day | `design.md:257-304,401-404,430-437` | CRITICAL | fixed | **Confirmed by both judges.** Apple source revisions and complete immutable option tables are deferred to implementation, so accepted/rejected/unsupported union outcomes are not reviewable deterministically before code. **Fix R1:** all seven registry entries now carry concrete immutable bindings (GNU Coreutils 9.4 nodes; Apple chmod(1) 2017-01-07, bintrans(1) 2022-04-18) plus fully enumerated normative option tables; GNU `--r` resolved as ambiguous→rejected; deferral language removed (grep-verified). |
| JD-DES-003 | judgment-day | `design.md:339-357` | CRITICAL | refuted | **Suspect — Judge A only.** `NAME=VALUE` remains in `OPTIONS`, potentially allowing later option-looking tokens to be parsed after env assignments despite options-before-operands semantics. **Triage:** refuted — assignments are neither options nor operands; machine honors options-before-operands for the command operand and matches current runtime parity. |
| JD-DES-004 | judgment-day | `design.md:414-415,460-469` | CRITICAL | refuted | **Suspect — Judge A only.** The chmod ambiguity adapter appears to deny every all-unsupported parse with a possible critical target without separately proving recursive/mode-777 uncertainty. **Triage:** refuted — spec condition is a disjunction; a remaining possibleTarget IS unproven target roles. |
| JD-DES-005 | judgment-day | `design.md:357-374,532-539` | CRITICAL | fixed | **Triage: stands.** Split output spliced into the queue can reintroduce `-S` without a cumulative cap → Θ(L²) work. **Fix R1:** cumulative bound `splitOps <= 32` AND `splitBytes <= 8 * N`; exceed → `unsupported(split-work-limit)` → wrapper-extraction ambiguity denial; complexity limits and failure-mode rows updated. |
| JD-DES-006 | judgment-day | `design.md:202-209,439-448` | CRITICAL | refuted | **Suspect — Judge A only.** `Base64Facts` omits preserved downstream pipeline target evidence required by Requirement 1, even though assessment consults it transiently. **Triage:** refuted — the sink target is lexer-owned, structurally outside base64 argv, immutable by invariant, and recorded via adapter sink category. |
| JD-DES-007 | judgment-day | `design.md:13,58-65,308-318,359-378,479-485` | CRITICAL | refuted | **Suspect — Judge B only.** Existing tokenization may erase quote/escape/empty-token provenance needed to distinguish literal path identity from dynamic identity and missing arguments. **Triage:** refuted — quoted and bare names execute identically in Bash; dynamic forms reject quote-insensitively per S44. |
| JD-DES-008 | judgment-day | `design.md:173-185,338-351,376-380,460-469` | CRITICAL | fixed | **Triage: stands.** No accepted-safe terminal for commandless env; benign `env`/`env -i`/`env FOO=1` forced into wrapper ambiguity. **Fix R1:** nullable `eventualExecutable` with explicit commandless terminal classified accepted-safe; ambiguity reserved for genuinely unproven extraction; failure-mode row added. |

The phase-result parent-ledger hash mismatch was not confirmed as a design defect: the incorrect digest is absent from `design.md`, and direct verification shows the parent ledger remained unchanged at SHA-256 `423eac0ba98646463a7a425c0f5f1bf31db3d3b245c4f71772837ef01ccb71d1`.

## Design Suspect Triage — Round 1

**Adjudicator:** fresh-context sdd-design agent over design/spec/exploration/runtime only. No edits.

| id | verdict | evidence |
|---|---|---|
| JD-DES-003 | refuted | Assignments are neither options nor operands; the machine honors options-before-operands for the command operand and matches current runtime parity. Residual divergence is over-denial at an approved sink, never bypass. |
| JD-DES-004 | refuted | Spec condition is a disjunction; a remaining `possibleTarget` IS unproven target roles. Adapter never denies proven-safe forms; candidate misread OR as AND. |
| JD-DES-005 | **stands** | Split output spliced into the queue can reintroduce `-S` recursively; no cumulative split/work cap exists. Attached-remainder chain of length L forces Θ(L²) work against the design's own linear invariant. Correction: cumulative cap on split operations/re-scanned bytes; exceed → fixed unsupported(split) → wrapper-extraction ambiguity denial. |
| JD-DES-006 | refuted | Downstream pipeline target is lexer-owned, structurally outside base64 argv, immutable per design invariants, and recorded via the adapter's sink category. Requirement 1 names role preservation, not a fact field the requirement never names. |
| JD-DES-007 | refuted | Lexer behavior preserves marker characters; quoted `'env'` and bare `env` execute identically in Bash, so quote provenance is irrelevant to identity. All dynamic forms reject quote-insensitively per S44. No bypass direction exists. |
| JD-DES-008 | **stands** | `eventualExecutable` is non-nullable and COMMAND requires a literal operand; proven commandless env has no accepted-safe terminal and is forced into wrapper-extraction ambiguity. Collides with spec.md:86, S51, and proposal contracts 7/11. Correction: explicit commandless terminal classified accepted-safe when the option pass consumed every token as recognized options/assignments. |

**Triage counts:** stands 2 (JD-DES-005, JD-DES-008), refuted 4, inconclusive 0.

**Fix set authorized for Round 1 (subject to user approval):** JD-DES-001 (BLOCKER), JD-DES-002, JD-DES-005, JD-DES-008 — four design amendments. Refuted rows require no edits.

## Round 1 Status

All eight rows carry triage verdicts. Fix Round 1 applied by jd-fix-agent (user-approved): JD-DES-001/002/005/008 marked `fixed` in `design.md`; forecast re-checked at 647–792 changed lines (≤800). Scoped re-judgment completed (below).

## Design Re-Judgment — Round 1 (scoped)

**Target:** fix-touched sections of `design.md` only (chmod mixed-mode rule, registry bindings/tables, env split-work bound, commandless terminal, plus direct ripples).

**Verdicts on fixed rows:** both judges verified all four — JD-DES-001, JD-DES-002, JD-DES-005, JD-DES-008 → `verified`. Cross-consistency checks (evidence codes, adapter interactions, commandless/split-limit interplay, forecast) clean.

**New rows from the scoped pass:**

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JD-R1-001 | judgment-day | `design.md:708` | CRITICAL (Judge A) / WARNING (Judge B) | open | **Both judges agree the claim is real and wrong in substance:** the traceability annotation asserts `chmod 777 --reference=<ref> /` is denied through the critical-chmod ambiguity sink, but with that token order POSIX/Apple stop at `777` and the deny comes from mode777 danger dominance with the inherited rule ID; the ambiguity sink only fires for the reference-first ordering. Judges diverge on severity: A says CRITICAL (annotation mandates a test expectation a correct implementation cannot satisfy, forcing a RED-phase deviation); B says WARNING real-but-test-authoring-only. Contradiction escalated for manual decision. |
| JD-R1-002 | judgment-day | `design.md:425-443` (root pre-dates R1) | WARNING | info | Order-dependent asymmetry: mode-first reference forms can be accepted-safe under POSIX while reference-first permutations with critical targets hit ambiguity; pure reference form with critical target and no recursion is accepted-safe although mode-777 absence is unprovable. Spec-level tension between spec.md:86 and S27; not introduced by Fix R1; theoretical per both judges. No action in this change. |

**Judge verdicts:** A — ESCALATED (JD-R1-001 as CRITICAL on a fix-touched line); B — APPROVED (JD-R1-001 as WARNING/info). Contradiction on severity only; both verified the four fixes. User chose micro-fix Round 2.

## Design Round 2 — annotation micro-fix and final re-judgment

**Fix (user-approved, final round):** the JD-DES-001 traceability bullet at `design.md:708` now attributes each token ordering to its attainable mechanism — mode-first `chmod 777 --reference=<ref> /` denied via mode777 danger dominance with the inherited rule ID; reference-first `chmod --reference=<ref> 777 /` denied through the critical-chmod sink via mixed-mode-reference rejection; reference-only forms remain accepted (S24/S27 intact).

**Final scoped re-judgment:** both judges independently verified JD-R1-001 against the normative chmod machines, union precedence, and adapter mapping; all three orderings are attainable as exact test expectations with no RED-phase deviation. No new findings on fix-touched lines.

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JD-R1-001 | judgment-day | `design.md:708` | CRITICAL (A) / WARNING (B) | verified | Amended bullet reproduces exactly from design.md:420-515 for all three orderings; Round 1 unattainable expectation removed. |

**Convergence budget:** 2 of 2 fix rounds consumed. **Final state: `JUDGMENT: APPROVED` for the design.** All BLOCKER/CRITICAL rows are `verified` or `refuted`; JD-R1-002 remains WARNING/info (spec-level note, no action). Next phase: `sdd-tasks`.
