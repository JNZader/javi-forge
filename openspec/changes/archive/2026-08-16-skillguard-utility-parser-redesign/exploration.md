# Exploration: SkillGuard Utility Parser Redesign

## Executive Summary

The remaining bypasses are not isolated missing spellings. The runtime currently asks three utility-semantic questions through helpers that discard the parse state needed to answer them safely:

- `env`: `parseEnvSplit` recognizes one option token, but wrapper extraction does not model bundled options or GNU `${VARNAME}` expansion.
- `chmod`: `hasChmodRecursive` stops at the first operand or `--reference`, while GNU option permutation can continue after both; the caller then treats every literal as a possible target, including option arguments.
- `base64`: `hasBase64Decode` uses one mixed short-option table even though GNU and macOS assign different meanings to `-i`, `-o`, `-b`, `-w`, and `-D`.

The redesign should **not** emulate all of coreutils. The smallest robust contract is a hybrid of:

1. explicit, versioned utility-specific semantic normalizers for only the policy facts SkillGuard needs; and
2. conservative denial when an unsupported or ambiguous form can hide a protected command, a critical `chmod` target, or decoded output piped to a shell.

The decision should be host-independent: evaluate the committed GNU/macOS profiles and deny when any supported profile yields dangerous semantics. `process.platform`, localized `--help`, or executing the user's utility are not reliable semantic oracles.

This change should **amend** and **depend on** `skillguard-pretooluse-hook` Slice 1, never supersede it. The parent Judgment Day ledger remains authoritative and `ESCALATED` until a later implementation and fresh review close `JD-S1-FR3-001/002`.

## Current State

### Runtime data flow

For Bash input, the packaged MJS currently performs:

```text
command string
  -> lex()                        shell words and real control operators
  -> commandWords()               assignments and fixed wrapper removal
  -> parseEnvSplit()              optional env -S argv injection
  -> evaluateBash()               policy predicates
       -> hasChmodRecursive()
       -> hasBase64Decode()
```

The utility helpers are exported only so tests can import the exact packaged MJS. Production policy consumes them from `commandWords` and `evaluateBash`; there is no TypeScript runtime parser or build-time bundling layer.

### First incorrect state: GNU `env -S`

Relevant code: `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs:105-170,191-207`.

1. `lex` correctly keeps shell operators inside outer quotes from becoming Bash pipelines, then removes those outer quotes while constructing words.
2. `commandWords` sees the `env` wrapper and calls `parseEnvSplit(tokens)` only against the first remaining token.
3. `parseEnvSplit` handles exact/attached `-S` and long-prefix `--split-string`, but not an option bundle where `S` is preceded by another flag.
4. `commandWords` therefore treats `-iS` as an ordinary unknown option and discards the whole token at line 203. The following split-string remains one already-lexed shell word, so the wrapped executable is never recovered. This is the first incorrect state for the bundled-option family.
5. `splitEnvString` implements quoting plus `\_`, `\c`, and the documented escape table, but never recognizes `${VARNAME}`. GNU expands that form using the environment inherited by `env`, before `-i`, `-u`, or assignments inside the split string take effect. The parser's argv first diverges from GNU at this missing expansion step.

Consequences:

- bundled `-iS`/`-vS` can hide the wrapped command;
- `${VARNAME}` can alter the command or protected operand before splitting;
- a leading shell assignment such as `READER=cat env -S '${READER}\_~/.ssh/id'` cannot be reproduced merely by reading the evaluator's own `process.env` because the outer shell assignment changes the environment passed to `env`;
- wrapper extraction has no explicit `safe | dangerous | ambiguous` outcome, so unsupported forms can silently become an unknown executable and pass.

Quoting boundary that must be preserved: the `env -S` string produces argv, not a second shell program. A literal `|` inside the split string is an argument unless a subsequently invoked shell interprets it. Treating it as the original Bash pipeline would be a false positive.

### First incorrect state: GNU/macOS `chmod`

Relevant code: `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs:130-135,172-179,262-278`.

`hasChmodRecursive` returns a boolean after scanning only an assumed leading option prefix:

- line 174 stops at the first non-option or at `--`;
- line 176 stops when it sees a `--reference` abbreviation;
- line 175 does recognize GNU `--rec` through `--recursive` through the generic prefix helper;
- short bundles containing uppercase `R` are recognized.

GNU's default option model permutes options and operands, so a recursive option may remain active after a mode, file operand, or `--reference` argument. `POSIXLY_CORRECT` can change that behavior. The helper loses this state at its first early break; this is the first incorrect state for the permutation family.

The caller then checks critical roots with `tokens.some(...)`. It does not distinguish:

- mode vs target operand;
- `--reference` argument vs target;
- option argument vs target;
- operands after `--` vs options before it.

That creates both directions of error: a real later recursive option can be missed, while `/` used only as a reference file can be mistaken for the recursively modified target.

macOS `chmod` exposes a different short-option/ACL surface and no documented GNU long-option family. A single generic prefix scanner cannot truthfully represent both utilities.

### First incorrect state: GNU/macOS `base64`

Relevant code: `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs:181-189,275-278` and `src/__integration__/claude-pretooluse-exec.integration.test.ts:137-160`.

`hasBase64Decode` uses one mixed short-option loop:

- `d` or `D` immediately means decode;
- every `i`, `o`, `w`, or `b` is treated as argument-taking and terminates the current bundle;
- `--decode` abbreviations are recognized;
- `--` correctly ends option parsing.

The short-option table is the first incorrect state:

| Profile | Decode flags | Other relevant options |
|---|---|---|
| GNU coreutils | `-d`, `--decode` | `-i` is a boolean ignore-garbage flag; `-w` takes a value; no GNU `-D`, `-o`, or `-b` |
| macOS `base64` | `-d`, `-D`, `--decode` | `-i`/`-o`/`-b` take values; current Apple documentation also describes GNU-compatible `-w`/`--ignore-garbage` behavior |

Therefore:

- GNU `-id` is `-i` plus `-d`, but the current parser consumes `d` as part of an input argument;
- GNU `-i -d` skips `-d` as the supposed argument to `-i`;
- macOS `-Di` begins with a decode flag and then an input option;
- blindly searching option arguments for `d` would deny benign input/output/wrap values;
- options after an operand depend on the utility profile and environment, not one universal loop.

The current test at `src/__integration__/claude-pretooluse-exec.integration.test.ts:148` explicitly expects `-id` to be non-decode. That expectation is correct for one macOS-style interpretation and incorrect for GNU; it is a test oracle defect, not merely a missing regression case.

### Evidence basis

- **[read]** The parent manual fail-closed source records `JUDGMENT: ESCALATED` and both open critical families at `openspec/changes/skillguard-pretooluse-hook/review-ledger.md:152-163`.
- **[read]** The exact current parser and call sites are at `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs:105-207,262-291`.
- **[read]** GNU's manual states that options normally permute with operands, `POSIXLY_CORRECT` changes that rule, and unambiguous long abbreviations are generally accepted: GNU Coreutils `doc/coreutils.texi`, “Common options”. It separately documents `env` options-before-operands, bundled `-[v]S`, `\_`, `\c`, and pre-clear `${VARNAME}` expansion.
- **[read]** GNU base64 documents `-d` and boolean `-i`; Apple `bintrans(1)` documents macOS `base64` `-d`/`-D` and argument-taking `-b`/`-i`/`-o`.
- **[executed]** Host introspection found Linux `/usr/bin/{env,chmod,base64}`, all GNU coreutils 9.4. Commands: `command -v env chmod base64 && uname -s && env --version && chmod --version && base64 --version`; exit `0`; cwd `/home/javier/programacion/platform/javi-forge`.
- **[executed]** The host `--help` output is localized in Spanish. Commands: `env --help && chmod --help && base64 --help`; exit `0`; same cwd. This is direct evidence that parsing help text is not a deterministic grammar API.
- **[executed]** Current Slice 1 is 760 added lines against `feat/skillguard-pretooluse-hook`. Command: `git diff --shortstat feat/skillguard-pretooluse-hook...HEAD`; exit `0`; same cwd.
- **[executed]** `69823570` is not an ancestor of `origin/main`, and no remote branch contains it. Commands: `git branch -r --contains 69823570` and `git merge-base --is-ancestor 69823570 origin/main`; ancestor exit `1`; same cwd. The runtime identity is not released from `main`.
- **[assumed]** BusyBox, Homebrew-prefixed utilities, and future GNU/Apple releases may add semantics outside these profiles. Verification would require explicitly adding their versioned documentation and conformance corpus.

No project tests, builds, package checks, or semantic utility executions were run during this exploration.

## Affected Areas and Blast Radius

### Direct

- `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs`
  - Symbols: `splitEnvString`, `parseEnvSplit`, `commandWords`, `hasChmodRecursive`, `hasBase64Decode`, and the `evaluateBash` call sites.
  - The redesign must preserve the dependency-free, copied-one-file runtime contract. A new sibling parser module would not be available to an installed hook unless the lifecycle design also copied and verified it.
- `src/__tests__/claude-hook-assets.test.ts`
  - Owns the pure exact-asset policy corpus and manifest binding. It needs profile tables, dangerous/safe/ambiguous boundaries, and end-to-end policy assertions.
- `src/__integration__/claude-pretooluse-exec.integration.test.ts`
  - Owns spawned exact-MJS behavior and currently imports the parser helpers directly. Lines 137-160 contain incomplete host-conditioned examples and the incorrect GNU `-id` expectation.
- `assets/claude-hooks/manifest.json`
  - Every MJS byte change requires a new exact SHA-256. Because the asset is not on `main` and no installer exists yet, the redesign can replace the unreleased v1 hash without inventing a released historical identity. Proposal should make that condition explicit.

### Indirect or likely unchanged

- `.github/workflows/claude-hook-windows.yml` — runs both focused files on Windows. It may remain byte-unchanged, but the committed corpus must not depend on GNU utilities being present on that runner.
- `src/constants.ts` — `CLAUDE_HOOK_ASSETS_DIR` remains valid; no parser behavior belongs here.
- `package.json` — `files: ["assets/"]` already includes the MJS and manifest; no dependency or lockfile change is needed for the recommended approach.
- `scripts/verify-package-contents.mjs` — currently proves only that some `assets/` content ships and does not name the Claude MJS or its manifest. Parent Slice 4 already owns the exact tarball gate; this redesign must preserve that dependency rather than silently claiming tarball-level proof now.
- Generated consumer path `.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs` — no installer or published project-local copy exists in the current chain. Later installation must copy the newly hashed bytes exactly.

### Blast-radius summary

The recommended redesign has four mandatory direct files out of the repository's broader TypeScript/runtime surface: the MJS, two focused test files, and manifest. The workflow is behavioral coverage, while constants, package metadata, and package verification are transitive integration points. Adding a third-party shell AST library would expand the radius to `package.json`, `pnpm-lock.yaml`, runtime packaging, and the installed-hook dependency model.

## Strategy Comparison

| Strategy | Security | Determinism | Portability | Maintenance | Testability | Backward compatibility | Assessment |
|---|---|---|---|---|---|---|---|
| **A. Explicit utility-specific semantic normalizers** | High when they return operand roles and ambiguity, not only booleans | High with committed profiles | High for the profiles explicitly modeled | Medium; option tables must track supported profiles | High; table and property corpora map directly to semantics | Good if limited to policy-relevant commands | **Required foundation**, but do not turn it into full coreutils emulation |
| **B. Conservative deny-on-ambiguity / supported subset** | Highest against parser gaps at protected sinks | High | High and host-independent | Low/Medium | High; every unsupported family has a fixed expected outcome | More false positives in dangerous contexts | **Required safety closure** around A |
| **C. Shell AST plus wrapper policy reduction** | Improves shell operator/quote boundaries, but still cannot know utility getopt semantics | Medium/High if one AST is vendored and versioned | Poor across Bash + PowerShell and standalone MJS | High; grammar and dependency lifecycle are large | Medium; large state space | Risky due changed lexer behavior | Useful only as a future shell-boundary project; it does not solve these utility findings by itself |
| **D. Host utility introspection or execution** | Low: PATH can select an unexpected binary and executing the original utility may perform the dangerous action | Low: version, locale, PATH, environment, and installed tool vary | Low; Windows/macOS/Linux differ and tools may be absent | High operational complexity | Low; CI becomes host-dependent | Unpredictable | **Reject** as a runtime decision mechanism |

### Why complete coreutils emulation is the wrong premise

SkillGuard does not need the utility's complete output or error behavior. It needs only these policy facts:

- what executable remains after a supported `env` wrapper;
- whether a supported `chmod` profile can apply recursive or mode-`777` semantics to a critical target;
- whether a supported `base64` profile can decode into a real downstream shell pipeline.

A normalizer can preserve just enough state to answer those questions: option delimiter reached, consumed arguments, mode/reference/target roles, per-profile interpretations, and ambiguity. Modeling file traversal, ACL behavior, encoding output, signal handling, or every diagnostics rule adds attack surface without improving the decision.

### Why host introspection is not a safe oracle

- `--help` is localized and unstructured; the explored host returned Spanish text.
- `process.platform` does not identify which binary resolves through `PATH`; macOS can run GNU coreutils and Linux can run BusyBox or wrappers.
- the Bash command may use an explicit path, function, alias, wrapper, or environment-modified `PATH` not represented by the evaluator's own lookup.
- probing the original `chmod` or `env` invocation would execute semantics that the guard is supposed to decide before execution.
- probing synthetic examples only identifies the current host/version and cannot define deterministic behavior on Windows CI or another consumer.

Host conformance probes can be optional evidence for maintaining a profile, never the production parser or CI oracle.

## Recommended Product Contract

### Supported semantic profiles

Commit a small, named support matrix:

1. GNU `env -S` split-string semantics needed for wrapper extraction.
2. GNU `chmod` recursive/reference/permutation behavior and Apple `chmod` documented short-option behavior.
3. GNU `base64` and Apple `base64` decode/argument-taking behavior.

BusyBox, arbitrary third-party utilities, shell functions, and dynamically constructed executable names remain outside exact emulation. Literal path-qualified supported utility names should either normalize to their basename or become ambiguity; silently treating `/usr/bin/base64` as unrelated is not robust.

### Deterministic decision rule

Use a host-independent union of supported profiles:

- **deny** when any supported profile accepts the argv and yields the protected semantic;
- **allow/no objection** when every applicable supported profile that accepts the argv proves the protected semantic absent;
- **deny as ambiguous** when parsing cannot prove safety and the ambiguity intersects a protected sink;
- never use `process.platform` to weaken a decision merely because one spelling is invalid on the current host.

This deliberately accepts cross-platform false positives. A command invalid on Linux but dangerous on macOS is denied on both. That is a stable policy, unlike a machine-dependent guard.

### Contextual ambiguity boundaries

Ambiguity should not block every unfamiliar command:

- `env`: deny when wrapper parsing cannot identify the eventual executable/argv, because all downstream policy would otherwise be bypassed.
- `chmod`: deny ambiguity only when a critical-root candidate is present and the parser cannot prove that recursive/mode-`777` semantics or target roles are absent. A proven non-critical target may pass.
- `base64`: deny ambiguity only when output reaches a real unquoted pipeline into `sh|bash|zsh|dash|ksh`. Without that sink, decode uncertainty alone is outside the current policy.
- `--` is always an option delimiter for the selected utility profile; later dash-prefixed values are operands.

### `env` expansion boundary

Do not attempt general `${VARNAME}` evaluation in the first redesign. The guard cannot faithfully reconstruct outer shell assignments or guarantee that its environment equals the later Bash process environment. Instead:

- recognize escaped dollar forms that GNU treats literally;
- classify an active `${VARNAME}` in a split string as unsupported/ambiguous;
- deny that ambiguity during wrapper extraction.

This closes the judges' bypass deterministically without pretending to solve environment/time-of-check semantics.

### Safe pass boundary

The guard may return no objection when the parser proves all of the following for the relevant rule:

- shell operators are literal or absent rather than a real pipeline/control boundary;
- option arguments are consumed according to every applicable profile;
- a `chmod` reference file is not mistaken for a target and no critical target receives denied semantics;
- no supported `base64` interpretation decodes into a downstream shell;
- wrapper extraction reaches a concrete executable/argv without active expansion or unsupported option ambiguity.

Exit `0` remains “no objection,” not proof that the utility invocation is valid or permission to execute it.

## Test Corpus and Existing Gaps

### Existing gaps

- no bundled GNU `env -iS`/`-vS` corpus at the wrapper normalizer boundary;
- no active/escaped `${VARNAME}` matrix or outer-assignment case;
- `chmod` tests codify the incorrect assumption that parsing stops at a mode or reference boundary;
- no target-role assertion separates `--reference=/` from a target `/`;
- `base64 -id` is explicitly expected to be non-decode despite GNU semantics;
- no per-profile short-bundle grammar with argument-taking termination;
- host-conditioned tests use the installed binary as partial truth and skip elsewhere, so Windows cannot validate the same semantic contract;
- pure parser assertions live in the spawned integration file instead of the exact-asset unit corpus;
- no literal path-qualified utility identity probes;
- no property invariant ties `--` to “all remaining tokens are operands.”

### Needed table/property corpus

- **GNU long abbreviations:** generate every unique accepted prefix and every ambiguous/too-short near miss from the committed option table.
- **Permutation:** place each GNU option before mode, between mode/reference and operands, and after an operand; repeat with `POSIXLY_CORRECT` represented as an explicit profile input if that mode is supported.
- **Short bundles:** enumerate flag order around argument-taking options. Once an option consumes the bundle remainder or next argv, characters inside that argument must never become flags.
- **Delimiter invariant:** after `--`, option-like tokens never alter semantic flags.
- **`env -S` quote/escape cross-product:** unquoted, single-quoted, and double-quoted `\_`, `\c`, `\$`, quotes, backslash, comments, whitespace classes, and active `${VARNAME}`.
- **Role preservation:** a `chmod` reference path and option argument are never targets; the selected mode and targets remain distinguishable.
- **Pipeline boundary:** adding quotes around `|` converts it from an operator to data; inserting `d` into a base64 option argument never creates decode semantics.
- **Profile union:** if one supported profile yields dangerous and another rejects or yields safe, the product result remains deny.
- **End-to-end exact asset:** every semantic table family has at least one spawned MJS deny and one benign near miss, including all final-judge bypasses.

The committed corpus should be the oracle. Optional host probes may compare a named profile against a harmless isolated fixture, but must not change expected results or skip the deterministic table on another OS.

## Falsifiable Acceptance Probes for Proposal

These are proposal-level behavioral probes, not an implementation plan. Every expected result is observable as packaged-hook exit `2` (deny) or silent exit `0` (no objection).

### GNU `env -S` and wrapper extraction

| Probe | Expected | Purpose |
|---|---:|---|
| `env -iS 'cat\_~/.ssh/id'` | deny | Judge A bundled `-iS` bypass |
| `env -vS 'cat\_~/.ssh/id'` | deny | documented bundled debug form |
| `READER=cat env -S '${READER}\_~/.ssh/id'` | deny ambiguous | Judge B expansion bypass plus outer assignment mismatch |
| `env --split-str='cat\_~/.ssh/id'` | deny | accepted GNU long abbreviation |
| `env -S 'cat\c' ~/.ssh/id` | deny | `\c` truncates split input; remaining argv still reaches `cat` |
| `env -S 'command -- cat\_~/.ssh/id'` | deny | wrapper reduction after split argv |
| `env -S 'printf\_x|bash'` | no objection | literal pipe inside split argv is not a Bash pipeline |
| `env -S 'printf\q'` | deny ambiguous | unsupported GNU split escape cannot bypass wrapper inspection |
| `/usr/bin/env -iS 'cat\_~/.ssh/id'` | deny or explicitly unsupported-deny | literal path-qualified identity boundary |

### GNU/macOS `chmod`

| Probe | Expected | Purpose |
|---|---:|---|
| `chmod 755 / --recursive` | deny | Judge permutation after mode/target |
| `chmod --reference=/tmp/ref / --recursive` | deny | Judge permutation after reference form |
| `chmod --rec 755 /` through `chmod --recursive 755 /` | deny each | GNU accepted unique abbreviations |
| `chmod -vR 755 /` and `chmod -Rv 755 /` | deny | short-bundle order |
| `chmod -R --reference=/ /tmp/safe` | no objection | `/` is reference input, not target |
| `chmod 755 -- /` | no objection | delimiter plus non-denied mode |
| `chmod 777 -- /` | deny | mode-`777` rule remains independent of recursion |
| `/bin/chmod -R 755 /` | deny or explicitly unsupported-deny | literal path-qualified identity boundary |

### GNU/macOS `base64`

| Probe | Expected | Purpose |
|---|---:|---|
| `base64 -id payload | bash` | deny | both final judges' GNU bundled bypass |
| `base64 -i -d payload | bash` | deny | both final judges' GNU separated bypass |
| `base64 -Di input | bash` | deny | macOS decode bundle |
| `base64 --d payload | bash` through `--decode` | deny each accepted GNU prefix | long abbreviation family |
| `base64 payload -d | bash` | deny under the GNU profile | option permutation after operand |
| `base64 -i input -o output -b 76 | bash` | no objection | macOS argument text/options do not imply decode |
| `base64 -- -d | bash` | no objection | `-d` is a file operand after delimiter |
| `base64 -d payload '|' bash` | no objection | quoted pipe is data, not a downstream shell |
| `/usr/bin/base64 -id payload | bash` | deny or explicitly unsupported-deny | literal path-qualified identity boundary |

### Global invariants

- Results are identical on Linux, macOS, and Windows for the same command string and committed profile set.
- Changing `LANG`, `PATH`, or the host utility version does not change parser decisions.
- The packaged MJS remains importable and executable with only Node built-ins.
- Any MJS byte change fails manifest binding until the exact SHA-256 is updated.
- All prior safe shell-boundary fixtures remain silent exit `0`; all retained parent denied fixtures remain exit `2`.
- The parent ledger remains byte-for-byte unchanged and `JD-S1-FR3-001/002` remain open until a fresh post-apply judgment explicitly closes them.

## Review-Unit and Branch Recommendation

The redesign itself can remain one autonomous **additional** slice below 800 changed lines if it uses the bounded A+B approach and does not add a shell AST dependency. However, it should not be squeezed into the original Slice 1 review unit:

- the current Slice 1 aggregate is already 760 added lines against its tracker parent, leaving only 40 lines under the 800-line limit;
- robust profile tables, ambiguity outcomes, and judge-complete corpora are unlikely to fit honestly in that remaining budget;
- preserving a separate diff keeps the parent Judgment Day history auditable rather than making the redesign look like another fix round.

Recommended chain insertion:

```text
feat/skillguard-pretooluse-hook-01-runtime @ 69823570
  -> feat/skillguard-utility-parser-redesign
  -> future feat/skillguard-pretooluse-hook-02-ownership-doctor
```

The redesign branch should start from exact `69823570` and target `feat/skillguard-pretooluse-hook-01-runtime`. Slice 2 must not start or retarget until the redesign implementation has its own clean verification and Judgment Day result. If proposal forecasting exceeds 800 lines, split by semantic family (`env` wrapper extraction, then `chmod`/`base64`) while keeping each family's behavior and tests together.

No branch, PR, task plan, commit, parent artifact, production file, or test file was changed during exploration; only this exploration artifact was created.

## OpenSpec Relationship Semantics

- **Primary relationship:** `amends: skillguard-pretooluse-hook` — it changes the bounded Bash-policy contract and implementation for blocked Slice 1.
- **Dependency:** `depends-on: skillguard-pretooluse-hook` at commit `69823570` — the parser, tests, manifest, and standalone runtime exist only because of the parent change.
- **Not `supersedes`:** the redesign does not replace the parent proposal, other policy rules, lifecycle slices, or its review history.
- The future proposal should cite `JD-S1-FR3-001` and `JD-S1-FR3-002` as inherited open acceptance evidence. It must not reset attempts, close findings by declaration, copy them under new IDs, or alter the parent ledger.
- Native status ignoring the Markdown ledger remains an independent fail-closed workflow risk. Manual inspection of the parent ledger is mandatory before any later apply/advance action.

## Approaches

1. **Bounded semantic profiles plus contextual ambiguity denial** — explicit GNU/macOS normalizers answer only policy-relevant questions and return safe/dangerous/ambiguous.
   - Pros: closes the root cause, deterministic, portable, dependency-free, directly testable, bounded claims.
   - Cons: intentional false positives at dangerous sinks; profile tables need maintenance.
   - Effort: Medium.

2. **Supported subset only, without semantic profiles** — accept only a few canonical forms and deny every other relevant utility invocation.
   - Pros: smallest implementation and strongest immediate fail-closed posture.
   - Cons: substantial compatibility regression; ordinary option bundles/permutations become blocked even when provably safe.
   - Effort: Low/Medium.

3. **Shell AST plus wrapper-policy reduction** — replace or augment the lexer, then still normalize utilities.
   - Pros: stronger shell syntax boundaries and future extensibility.
   - Cons: does not solve getopt semantics alone; dual-shell scope, package/runtime dependency, and line budget are disproportionate.
   - Effort: High.

4. **Host utility introspection/execution** — decide from installed binaries or help output.
   - Pros: can reflect one machine's installed version.
   - Cons: non-deterministic, localized, PATH-sensitive, unavailable on some platforms, and unsafe as a pre-execution oracle.
   - Effort: High operationally.

## Recommendation

Proceed with Approach 1: bounded utility-specific profiles combined with Approach 2 only at protected ambiguity boundaries. Keep the existing shell lexer unless proposal evidence finds a shell-boundary defect necessary for these two findings. Reject host introspection as runtime policy and defer a shell AST to a separate change.

The proposal should define semantic outcomes and compatibility boundaries before selecting parser data structures. In particular, it must bind profile union behavior, active `env` expansion handling, `--`, operand roles, path-qualified names, and contextual ambiguity denial as product requirements rather than test-only implementation details.

## Unresolved Product Decisions

The user must answer these before proposal:

1. **Ambiguity posture:** approve contextual fail-closed behavior for ambiguous `env` wrappers, critical-root `chmod`, and base64-to-shell pipelines, accepting false positives there; or preserve fail-open compatibility and accept known future bypass risk. **Recommendation: fail closed contextually.**
2. **Platform policy:** use a host-independent union of committed GNU/macOS semantics, or vary decisions by detected host. **Recommendation: union; do not weaken by `process.platform`.**
3. **`env` expansion:** deny active `${VARNAME}` as unsupported during wrapper extraction, or attempt environment evaluation despite outer-assignment and time-of-check mismatch. **Recommendation: deny active expansion in this redesign.**
4. **Supported implementations:** limit exact profiles to GNU coreutils and Apple system utilities, treating BusyBox/Homebrew-prefixed/custom implementations as unsupported ambiguity, or include additional named profiles now. **Recommendation: GNU + Apple only.**
5. **Literal command identity:** normalize literal path-qualified names such as `/usr/bin/base64` to supported utility identity, or classify them as unsupported and deny only at protected sinks. **Recommendation: normalize literal basename; keep aliases/functions/dynamic names outside scope.**
6. **Cross-profile invalid forms:** deny when any supported profile executes dangerous semantics even if another profile rejects the command. **Recommendation: yes; this is the security-preserving consequence of deterministic union semantics.**

These are security/product choices. The already-selected interactive mode, hybrid artifact store, ask-always chain policy, feature-branch chain, and 800-line review budget require no new answer.

## Risks

- Contextual ambiguity denial introduces observable false positives in commands that are malformed on one platform but dangerous on another.
- Profile drift can reopen bypasses when GNU or Apple changes options; profile updates require documentation evidence and corpus changes.
- Supporting active `env` expansion by evaluator environment would create a false equivalence with the later shell environment; denying it is safer but less compatible.
- Literal path, wrapper, alias, BusyBox multicall, and dynamically generated executable identity can expand scope unless the proposal freezes the command-identity boundary.
- A parser that returns only booleans will repeat the current failure; operand roles and ambiguity must survive normalization.
- Adding a separate runtime module breaks the copied-one-file packaged-hook contract unless lifecycle and hashing expand with it.
- Updating MJS bytes without the manifest hash blocks integrity tests; appending the unreleased hash to historical identities would falsely claim release compatibility.
- The original Slice 1 has only 40 lines of review-budget headroom. Treating this as another inline fix would force unsafe compression or violate the review cap.
- Native SDD status still ignores the parent Markdown ledger; an automated advance can incorrectly treat the blocked parent as ready.

## Ready for Proposal

**No — pending the six product decisions above.** Once answered, the proposal can be narrowly scoped to the runtime semantic contract, exact profile matrix, ambiguity policy, compatibility statement, acceptance probes, manifest identity, and inserted chained review unit. It must leave every parent artifact untouched.
