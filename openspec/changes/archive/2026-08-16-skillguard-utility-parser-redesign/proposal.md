# Proposal: Redesign SkillGuard Utility Parsing

## Decision

Amend `skillguard-pretooluse-hook`: the guard silently permits protected utility semantics because boolean helpers discard parse state. Use bounded, versioned GNU/Apple profiles plus contextual ambiguity denial in the dependency-free packaged single-file MJS.

## Relationships and Delivery

- `amends: skillguard-pretooluse-hook`; `depends-on: skillguard-pretooluse-hook@69823570` (exact commit); never supersedes or resets parent review/attempt history.
- Deliver a child review unit starting from `69823570`, targeting `feat/skillguard-pretooluse-hook-01-runtime`, at `<=800` changed lines. An undefendable forecast requires a split decision, not compressed scope.
- The parent Slice 1 PR and Slice 2 remain blocked until this child has implementation, verification, and clean Judgment Day.

## Approved Product Contract

1. Deny ambiguity only at protected sinks: hidden `env`, critical-root `chmod`, or base64-to-shell.
2. Use a host-independent union of committed GNU and Apple semantics.
3. Deny active `${VARNAME}` in `env -S` as unsupported ambiguity; never evaluate it.
4. Profile only GNU coreutils and Apple system utilities; BusyBox/custom forms are unsupported ambiguity.
5. Normalize literal path-qualified basenames; exclude aliases, functions, and dynamic identities.
6. Deny if any supported profile is dangerous, even if another rejects.
7. Give unsupported forms outside protected sinks no objection; this is not general validation.
8. Model GNU default and `POSIXLY_CORRECT` modes as a deterministic union.
9. Emit stable ambiguity reason code plus utility/profile/sink context, without sensitive data.
10. Profile updates require versioned source documentation, deterministic tables/corpus, regressions, and review; forbid host introspection as policy authority.
11. Preserve all prior safe corpus cases except documented protected-sink ambiguity denials.

## Scope and Success Criteria

- [ ] `env -S` handles bundles, documented split semantics, active-expansion ambiguity, and path-qualified names.
- [ ] `chmod` preserves mode/reference/target roles and permutation; `base64` distinguishes GNU/Apple decode and argument options.
- [ ] Profile union, GNU default/`POSIXLY_CORRECT`, path-qualified names, and `--` produce fixed cross-host decisions.
- [ ] Exact packaged MJS behavior is host-independent and Node-built-ins-only; any byte drift fails the manifest SHA-256 binding.
- [ ] `JD-S1-FR3-001/002` final-judge bypasses are mandatory acceptance evidence without duplicated IDs or declarative closure.

## Capabilities and Impact

**New:** None. **Modified:** `skillguard-pretooluse-hook` — bounded Bash utility semantics.

Affected: `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs`, `src/__tests__/claude-hook-assets.test.ts`, `src/__integration__/claude-pretooluse-exec.integration.test.ts`, and `assets/claude-hooks/manifest.json`.

Global linuxbrew/npm users and roughly eight Git-hook repositories are not auto-rewritten; later upgraded local guards receive these semantics.

## Non-Goals

Full coreutils emulation; host introspection/execution as runtime oracle; shell-AST replacement; BusyBox/custom profiles; aliases/functions/dynamic identities; installer, doctor, settings, Slice 2+; publishing, PRs, or parent-ledger changes.

## Risks, Rollback, and Workflow

Risks: protected-sink false positives, profile drift, and budget breach. Roll back only this child to `69823570`, restoring MJS/tests/manifest identity without rewriting parent history or artifacts.

rc.8 attempt authority works. Native status ignores the Markdown ledger, so manual parent-ledger inspection remains fail-closed; never fabricate `reviews/ledger.json`.

## Open Questions

None.
