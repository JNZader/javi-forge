# Design: SkillGuard Utility Parser Redesign

## Executive Decision

Replace the three boolean utility helpers with a bounded semantic pipeline inside the existing packaged MJS. The pipeline will preserve shell-token provenance, normalize literal utility identity, evaluate fixed GNU and Apple profile interpretations, reduce those interpretations with danger-dominant union rules, and apply ambiguity denial only at the three protected sinks.

The shipped runtime remains one dependency-free Node MJS file. It does not execute utilities, inspect the host, parse help output, generate profiles, import a sibling parser, or emulate utility output. The implementation review unit changes exactly the runtime, the two existing focused test files, and the manifest digest.

## Scope and Non-Negotiable Invariants

| Area | Design invariant |
|---|---|
| Shell boundary | Existing `lex` remains the authority for real outer Bash separators. Utility parsing consumes argv only and cannot create a shell pipeline. |
| Identity | Only a literal bare or path-qualified basename equal to `env`, `chmod`, or `base64` enters an exact profile. No lookup, alias/function resolution, symlink resolution, `PATH`, multicall inference, or expansion occurs. |
| Semantics | Utility-specific normalizers return structured evidence; production policy never decides from a parser boolean. |
| Profiles | Fixed committed GNU and Apple interpretations are always evaluated in registry order. GNU default and GNU `POSIXLY_CORRECT` are distinct modes where option ordering differs. |
| Reduction | Any accepted-dangerous interpretation dominates accepted-safe, rejected-by-profile, and unsupported interpretations. Rejection never cancels danger. |
| Ambiguity | Unsupported/indeterminate semantics deny only at wrapper extraction, critical-root chmod, or base64-to-shell. |
| Packaging | One MJS, Node built-ins only, no package or lockfile changes, and exact SHA-256 manifest binding. |
| Compatibility | All inherited deny families remain denied. Prior-safe cases remain silent unless they intersect a specified protected ambiguity sink. |
| Workflow | The child starts from `69823570`, targets `feat/skillguard-pretooluse-hook-01-runtime`, and leaves the parent ledger and both open findings unchanged. |

## Architecture

### Component boundaries inside the single MJS

```text
Bash command string
  |
  v
lex()  --------------------------------------------------------------+
  |  shell words + real separators; quote/control boundary fixed      |
  v                                                                  |
commandWords()/reduceWrappers()                                      |
  |  wrapper traces + one or more eventual argv candidates           |
  |  (env profiles may produce candidates or unsupported evidence)   |
  v                                                                  |
normalizeLiteralUtilityIdentity()                                    |
  |                                                                  |
  +--> normalizeEnvProfile() ----+                                   |
  +--> normalizeChmodProfile() --+--> assessProfile()                |
  +--> normalizeBase64Profile() -+        |                          |
                                           v                          |
                                    reduceProfileUnion()              |
                                           |                          |
                                           v                          |
                                    adaptProtectedSink() <------------+
                                           |
                                           v
                                      evaluateBash()
                                           |
                                           v
                              inherited deny or silent no objection
```

The boundaries are functions and frozen tables in the existing MJS, not modules. They remain independently importable by exact-MJS tests, but only `evaluateBash` composes them into production policy.

### Decision 1: Preserve the lexer and add utility semantics after it

**Choice:** Keep `lex` as the outer shell boundary. Add semantic normalization over each command segment's already-tokenized words and the lexer-owned separator metadata.

**Alternatives considered:** Replace the lexer with a shell AST; rescan normalized argv for shell operators.

**Rationale:** The inherited lexer already distinguishes real unquoted pipes from quoted pipe data. A shell AST does not solve `getopt` semantics and would violate the dependency, packaging, and review-budget boundaries. Rescanning `env -S` output would be wrong because split-string output is argv, not another shell program.

### Decision 2: Use utility-specific state machines, not a generic option parser

**Choice:** Implement three small normalizers sharing only trivial primitives: literal identity, exact/unique long-option lookup, a consumed-argument recorder, and the profile union reducer.

**Alternatives considered:** One configurable generic `getopt` engine; retain and extend boolean predicates.

**Rationale:** GNU `env -S`, chmod operand roles, and Apple/GNU base64 bundles have different state transitions. A generic parser would need enough callbacks and exceptions to become harder to audit than three linear machines. Boolean helpers caused the current bypass because they discarded delimiter, argument, role, and profile evidence.

### Decision 3: Separate parsing, policy assessment, and union reduction

**Choice:** A profile normalizer first returns accepted facts, rejected grammar, or unsupported evidence. `assessProfile` then applies only the policy-relevant sink facts. `reduceProfileUnion` applies fixed precedence.

**Alternatives considered:** Mark flags dangerous while scanning; merge all profile options into one permissive grammar.

**Rationale:** A decode flag is not dangerous without a real shell pipeline, `/` is not a chmod target when it is a reference argument, and an Apple rejection cannot erase GNU danger. Separation makes those statements explicit and testable.

### Decision 4: Keep profile authority embedded and source-bound

**Choice:** Store frozen profile metadata and semantic tables in the MJS, then assert their exact IDs, source bindings, and complete committed option tables from `claude-hook-assets.test.ts`. The deterministic corpus lives in the same two existing test files.

**Alternatives considered:** Runtime JSON/profile file; generated profiles; a test-only profile fixture file; host help or utility probes.

**Rationale:** A runtime profile file or sibling parser breaks copied-one-file packaging and creates a second integrity target. Generated/host-derived profiles make policy machine-dependent. A fifth test-only file is unnecessary: compact frozen metadata in the runtime plus table-driven tests provide reviewable authority without widening the changed-file set.

### Decision 5: Treat unsupported as evidence, not automatically as danger

**Choice:** Preserve unsupported separately from rejected-by-profile and from policy ambiguity. Convert unsupported to ambiguity only through the protected-sink adapter.

**Alternatives considered:** Deny every unknown option; treat profile rejection as safe.

**Rationale:** SkillGuard is not a utility validator. Global denial would regress benign commands; treating rejection as safety would recreate the cross-profile bypass.

## Semantic Data Model

The following are pseudotypes for MJS objects documented with JSDoc. Constants are the runtime source of truth; tests derive the corresponding TypeScript types instead of maintaining free-form string unions.

```ts
const OVERALL_CLASS = {
	SAFE: "safe",
	DANGEROUS: "dangerous",
	AMBIGUOUS: "ambiguous",
} as const;

const PROFILE_STATUS = {
	ACCEPTED_SAFE: "accepted-safe",
	ACCEPTED_DANGEROUS: "accepted-dangerous",
	REJECTED: "rejected-by-profile",
	UNSUPPORTED: "unsupported",
} as const;

const UTILITY = { ENV: "env", CHMOD: "chmod", BASE64: "base64", UNSUPPORTED: "unsupported" } as const;
const SINK = {
	WRAPPER: "wrapper-extraction",
	CRITICAL_CHMOD: "critical-chmod",
	BASE64_SHELL: "base64-to-shell",
} as const;

type ValueOf<T> = T[keyof T];
type OverallClass = ValueOf<typeof OVERALL_CLASS>;
type ProfileStatus = ValueOf<typeof PROFILE_STATUS>;
type Utility = ValueOf<typeof UTILITY>;
type Sink = ValueOf<typeof SINK>;
```

### Common evidence shapes

```ts
interface LiteralIdentity {
	rawToken: string;
	basename: string;
	utility: Utility;
	literal: boolean;
	pathQualified: boolean;
}

interface OptionArgument {
	option: string;             // canonical fixed option name
	tokenIndex: number;
	source: "attached" | "next-token" | "split-string";
	role: "split-string" | "reference" | "input" | "output" | "wrap" | "other";
	value: string;              // retained in-memory for role evaluation; never diagnostic output
}

interface DelimiterState {
	seen: boolean;
	tokenIndex?: number;
}

interface ProfileApplicability {
	profileId: string;
	utility: Utility;
	mode: "default" | "posixly-correct" | "apple";
	applicable: boolean;
}

interface UnsupportedEvidence {
	code: string;               // fixed internal category, never raw token text
	phase: "identity" | "option" | "split" | "roles" | "wrapper";
	tokenIndex?: number;
}
```

`value` fields are necessary to determine roles and eventual argv. They are ephemeral, never copied into `Decision`, logs, or stderr.

### Utility facts

```ts
interface EnvFacts {
	utility: "env";
	wrapperOptions: readonly string[];
	assignments: readonly string[];
	splitInput?: OptionArgument;
	consumedArguments: readonly OptionArgument[];
	delimiter: DelimiterState;
	eventualExecutable: string | null;  // null is the proven commandless terminal; never "unproven"
	eventualArgv: readonly string[];    // always empty when eventualExecutable is null
	activeExpansion: boolean;
	terminatedByControlEscape: boolean;
}

interface ChmodRoles {
	mode?: string;
	reference?: string;
	targets: readonly string[];
	possibleTargets: readonly string[];
}

interface ChmodFacts {
	utility: "chmod";
	recursive: boolean;
	mode777: boolean;
	roles: ChmodRoles;
	consumedArguments: readonly OptionArgument[];
	delimiter: DelimiterState;
}

interface Base64Facts {
	utility: "base64";
	decode: boolean;
	booleanOptions: readonly string[];
	operands: readonly string[];
	consumedArguments: readonly OptionArgument[];
	delimiter: DelimiterState;
}

type UtilityFacts = EnvFacts | ChmodFacts | Base64Facts;
```

### Per-profile and union results

```ts
interface AcceptedProfileResult {
	status: "accepted-safe" | "accepted-dangerous";
	applicability: ProfileApplicability;
	facts: UtilityFacts;
}

interface RejectedProfileResult {
	status: "rejected-by-profile";
	applicability: ProfileApplicability;
	reasonCode: string;
	partialRoles?: ChmodRoles;
}

interface UnsupportedProfileResult {
	status: "unsupported";
	applicability: ProfileApplicability;
	evidence: UnsupportedEvidence;
	partialRoles?: ChmodRoles;
}

type ProfileResult = AcceptedProfileResult | RejectedProfileResult | UnsupportedProfileResult;

interface ProfileUnion {
	classification: "safe" | "dangerous" | "unsupported";
	utility: Utility;
	results: readonly ProfileResult[];
	acceptedFacts: readonly UtilityFacts[];
}

interface SemanticDecision {
	classification: OverallClass;
	utility: Utility;
	sink?: Sink;
	profileCategory?: string;
	ruleId?: string;
}
```

`rejected-by-profile` means the committed grammar rejects the invocation. `unsupported` means exact normalization stopped at a form or identity outside the committed semantic boundary. Neither is silently rewritten to accepted-safe.

## Committed Profile Registry and Governance

### Registry representation

The MJS exports a frozen `UTILITY_PROFILE_REGISTRY` used by normalizers and exact-MJS tests. Each entry has this shape:

```ts
interface ProfileSourceBinding {
	publisher: "GNU" | "Apple";
	artifact: string;           // fixed manual/man-page title
	version: string;            // GNU release or immutable Apple documentation revision label
	section: string;
	sourceReference: string;    // reviewable canonical citation; never fetched at runtime
}

interface UtilityProfile {
	id: string;
	utility: "env" | "chmod" | "base64";
	mode: "default" | "posixly-correct" | "apple";
	source: ProfileSourceBinding;
	longOptions: readonly LongOptionSpec[];
	shortOptions: Readonly<Record<string, ShortOptionSpec>>;
}
```

Registry IDs are stable semantic versions, not host versions:

- `gnu-env-v1`
- `gnu-chmod-default-v1`
- `gnu-chmod-posix-v1`
- `apple-chmod-v1`
- `gnu-base64-default-v1`
- `gnu-base64-posix-v1`
- `apple-base64-v1`

The seven source bindings are selected NOW, at design level, and are immutable for the lifetime of each `-v1` ID:

| Profile ID | Publisher | Artifact | Immutable revision | Section | Reference |
|---|---|---|---|---|---|
| `gnu-env-v1` | GNU | GNU Coreutils manual (`doc/coreutils.texi`) | Coreutils 9.4 release | "env invocation"; "Common options" (permutation, unique abbreviations) | GNU Coreutils 9.4 release tarball / gnu.org Coreutils manual, 9.4 node set |
| `gnu-chmod-default-v1` | GNU | GNU Coreutils manual (`doc/coreutils.texi`) | Coreutils 9.4 release | "chmod invocation"; "Common options" | same as above |
| `gnu-chmod-posix-v1` | GNU | GNU Coreutils manual (`doc/coreutils.texi`) | Coreutils 9.4 release | "chmod invocation"; "Common options" (`POSIXLY_CORRECT` ordering) | same as above |
| `apple-chmod-v1` | Apple | `chmod(1)`, macOS General Commands Manual | man page dated **January 7, 2017** (Mac OS X 12) | SYNOPSIS; ACL MANIPULATION OPTIONS | Apple public man page (xcode-man-pages mirror), `chmod.1` |
| `gnu-base64-default-v1` | GNU | GNU Coreutils manual (`doc/coreutils.texi`) | Coreutils 9.4 release | "base64 invocation"; "Common options" | same as GNU above |
| `gnu-base64-posix-v1` | GNU | GNU Coreutils manual (`doc/coreutils.texi`) | Coreutils 9.4 release | "base64 invocation"; "Common options" (`POSIXLY_CORRECT` ordering) | same as GNU above |
| `apple-base64-v1` | Apple | `bintrans(1)`, macOS General Commands Manual | man page dated **April 18, 2022** (Mac OS X 12) | `base64` options | Apple public man page (xcode-man-pages mirror), `bintrans.1` |

The Coreutils 9.4 release is an immutable published revision, and the exploration host introspection confirmed the 9.4 toolchain. Apple publishes no immutable revision number for these man pages, so per the approved fallback each Apple binding is the **dated public-document snapshot** named above; the `-v1` IDs are bound to those exact dated snapshots. A placeholder such as `latest`, a host-reported version, or a localized help capture is invalid. Any re-verification against a different GNU release or a different Apple document date advances the profile ID per the governance below — the tables must never be silently re-bound.

### Committed option tables (normative)

These tables ARE the per-profile grammars. Implementation encodes them verbatim; a reviewer audits them here before code. `flag` = boolean, consumes nothing; `arg` = consumes the attached bundle remainder or the next argv token and terminates its bundle.

**`gnu-env-v1`** — short: `0` flag, `a` arg, `C` arg, `i` flag, `S` arg, `u` arg, `v` flag. Long: `--argv0` arg, `--chdir` arg, `--debug` flag, `--help` flag, `--ignore-environment` flag, `--null` flag, `--split-string` arg, `--unset` arg, `--version` flag; unique-prefix abbreviations per `matchLongOption` over exactly these nine names. `--` terminates the option pass; the next token begins the command, and end-of-input reaches the commandless terminal.

**`gnu-chmod-default-v1` / `gnu-chmod-posix-v1`** (one shared table; only operand ordering differs) — short: `c` flag, `f` flag, `R` flag, `v` flag. Long: `--changes` flag, `--help` flag, `--no-preserve-root` flag, `--preserve-root` flag, `--quiet` flag, `--recursive` flag, `--reference` arg, `--silent` flag, `--verbose` flag, `--version` flag; abbreviations are computed over exactly these ten names, so `--r` is ambiguous (recursive vs reference) and rejected, while `--rec` through `--recursive` uniquely name `--recursive`. `--` terminates option parsing; later dash-prefixed tokens are operands. Default mode permutes options after operands until `--`; `POSIXLY_CORRECT` mode stops option recognition at the first non-option operand.

**`apple-chmod-v1`** — short (all twelve are flags; no argument-taking options exist): generic `f`, `H`, `h`, `L`, `P`, `R`, `v` and ACL flags `C`, `E`, `I`, `N`, `i`. Long: **none** — every `--name` token, including `--recursive`, `--reference`, and `--` itself, is rejected-by-profile because the cited January 7, 2017 revision documents no long-option family and no `--`. Option ordering is options-before-operands per the cited SYNOPSIS (`[-fhv] [-R [-H | -L | -P]] mode file ...`). The ACL mode forms (`+a`, `-a`, `=a#`, `+ai`, `+a#`, `-a#`, `+ai#` and their ACE operands) are mode-grammar extensions, not options: encountering `a` in option position, or any of these forms in operand position, returns unsupported `chmod-acl-mode` role evidence rather than rejection or a guessed parse.

**`gnu-base64-default-v1` / `gnu-base64-posix-v1`** (one shared table) — short: `d` flag (decode), `i` flag, `w` arg. Long: `--decode` flag, `--help` flag, `--ignore-garbage` flag, `--version` flag, `--wrap` arg; abbreviations computed over exactly these five names, so every prefix from `--d` through `--decode` uniquely names `--decode`. `--` terminates option parsing; later tokens are operands. Default mode permutes; `POSIXLY_CORRECT` mode stops at the first operand.

**`apple-base64-v1`** — short: `b` arg, `d` flag (decode), `D` flag (decode), `h` flag, `i` arg (input file), `o` arg (output file), `w` arg (GNU-compatibility wrap). Long (exact names only; abbreviations are NOT inferred into Apple semantics): `--break` arg, `--decode` flag, `--help` flag, `--input` arg, `--output` arg, `--wrap` arg, `--ignore-garbage` flag (documented as accepted but unimplemented; recorded as a plain boolean and never as decode). The cited bintrans(1) revision contains a self-conflict between its compatibility sentence (`-i` as ignore-garbage) and its own option list (`-i input_file`); the committed resolution is that the option list governs — `i` is the argument-taking input option — and the GNU-compatible ignore-garbage semantic exists only as the long-form boolean. `--` is not documented in the cited revision and is rejected-by-profile. Option ordering is options-before-operands per the cited SYNOPSIS.

### Update governance

A profile update is one review unit and must change together:

1. profile ID or source version binding;
2. the affected frozen option/split table in the MJS;
3. source-binding assertion and deterministic corpus rows in `claude-hook-assets.test.ts`;
4. spawned protected and benign regressions in `claude-pretooluse-exec.integration.test.ts` when observable policy changes;
5. manifest SHA-256.

No runtime or test discovers authority from `process.platform`, `PATH`, locale, installed binaries, `--help`, network access, or conditional skips. Existing live utility probes in the integration file are removed from the acceptance oracle; host-independent committed cases replace them.

## Deterministic Algorithms

### Literal utility identity normalization

`normalizeLiteralUtilityIdentity(token)` performs only lexical checks:

1. Reject an empty token or a token containing shell expansion/construction markers (`$`, backtick, `*`, `?`, bracket/glob syntax, command separators, or NUL) as non-literal.
2. Split the already-lexed token on `/`; do not call `path`, `realpath`, `which`, or inspect the filesystem.
3. Compare the final non-empty component case-insensitively (case-folded, host-independent) with `env`, `chmod`, and `base64`, returning the canonical lowercase utility. **Amended (JD-R1-002):** the original case-sensitive rule silently regressed the inherited destructive-root/pipe-to-shell deny families on case-insensitive filesystems (macOS/Windows), where `CHMOD -R 777 /`, `BASE64 -d | sh`, and `ENV -S …` resolve to the real binaries. Case-insensitive matching reconciles this rule with the compatibility invariant ("All inherited deny families remain denied") without consulting `process.platform`, and mirrors the darwin/win32 basename folding `lexicalNormalize` already performs. On case-sensitive filesystems the only effect is a harmless fail-closed denial of an uppercase command that would not resolve to a binary anyway.
4. Return the same utility for `env` and `/usr/bin/env` (likewise chmod/base64).
5. Return unsupported identity for `busybox env`, aliases/functions represented by another literal name, variable/substitution identities, or any other basename.

A bare token named `env` is treated according to the literal policy profile without claiming what a future shell alias/function/PATH lookup will execute. The evaluator never tries to resolve that residual.

### Exact long-option matching

`matchLongOption(token, profile.longOptions)` does not call the current generic prefix helper:

1. Separate the option name from one optional `=` value.
2. Collect all committed long option names beginning with the supplied name.
3. Accept only when exactly one name matches and its table permits the attached/separated argument form.
4. Return rejected-by-profile for zero or multiple matches.
5. Record the canonical full option name and any consumed argument.

This yields reviewable unique abbreviations. It prevents a newly added sibling option from silently retaining an abbreviation that is no longer unique.

### GNU `env -S` state machine

#### Wrapper option pass

The GNU env profile scans a queue of tagged argv tokens. Tags distinguish outer shell words from split-generated argv but do not affect option meaning.

```text
state OPTIONS
  --                         -> delimiter.seen; state COMMAND
  recognized boolean option -> record; continue
  recognized argument option-> consume remainder or next token; record; continue
  -<bundle>                  -> scan left-to-right
  NAME=VALUE                 -> record assignment; continue
  literal operand           -> state COMMAND
  unsupported option        -> unsupported(wrapper)
  end-of-input              -> commandless terminal (see below)

state COMMAND
  first token               -> eventual executable
  remaining tokens          -> eventual argv
  end-of-input with no token-> commandless terminal (see below)
```

**Commandless terminal (normative).** When the option pass fully consumes every token as recognized options, option arguments, or assignments — including any split-generated tokens spliced by `-S` — and reaches end-of-input with no command operand, the profile result is `accepted-safe` with `eventualExecutable: null` and `eventualArgv: []`. This is a *proven* invocation shape (real GNU `env` with no command prints the environment and exits); it is not an extraction failure. The null executable is the single consistent representation of the commandless fact across `EnvFacts`, this state machine, the wrapper reducer, and the protected-sink adapter. Wrapper-extraction ambiguity is reserved for genuinely unproven extraction: a commandless `accepted-safe` result MUST NOT be collapsed into wrapper-extraction ambiguity, and an `unsupported` env result MUST NOT be relabeled commandless.

The short table is exactly the `gnu-env-v1` committed table above. `i`, `v`, `0`, and the other admitted boolean flags continue the bundle. `u`, `C`, `a`, and `S` consume an attached remainder or the next argv token and terminate that bundle. Therefore `-iS value` and `-vS value` process `i`/`v`, then let `S` consume `value`. Text consumed by `u`, `C`, `a`, or `S` is never rescanned as option characters.

The long table is exactly the nine-name `gnu-env-v1` committed table, which is what makes uniqueness computable. `--split-string`, attached/separated forms, and every unique prefix represented by the table (including `--split-str`) normalize to `split-string`.

When `S` is processed, its split output is spliced at the current queue position and the untouched outer trailing argv remains after it. The option pass continues over the resulting queue. This is what preserves `env -S 'cat\c' ~/.ssh/id` and permits further fixed wrapper reduction. Split-generated tokens may themselves contain a further `-S` option; the machine honors it exactly like an outer `-S`, subject to the cumulative split-work bound below.

**Cumulative split-work bound (normative).** Let `N` be the total byte count of the outer env argv tokens handed to the profile. Across the entire option pass — including every nested split introduced by spliced output — the machine maintains two monotone counters: `splitOps` (number of `-S`/`--split-string` operations performed) and `splitBytes` (total split-input bytes scanned, summed over every split operation). The hard bound is `splitOps <= 32` AND `splitBytes <= 8 * N`. Because each split operation scans its input once and splices at most its own byte count back into the queue, this bound caps total queue-processing work at `O(N)` with the constant factor 8 plus the 32-operation ceiling; the attached-remainder chain of length `L` can no longer force `Θ(L²)` re-scans. Exceeding either counter stops the machine immediately and returns fixed `unsupported(split-work-limit)` evidence with `phase: "split"`; per the approved fail-closed posture this flows to wrapper-extraction ambiguity denial. The 32-wrapper cap alone does not subsume this bound; both are enforced.

#### Split-string parser

`splitEnvString` is a dedicated character machine with states `UNQUOTED`, `SINGLE_QUOTED`, and `DOUBLE_QUOTED`; flags `wordStarted`, `escapedDollar`, and `stopped`; and an output argv array.

- Whitespace uses an explicit committed ASCII class, never locale or JavaScript's expanding Unicode `\s` set.
- An unquoted comment marker follows the committed GNU start-of-word rule.
- Single-quoted content is literal until its closing quote.
- Double-quoted and unquoted escapes follow the committed context table.
- `\_` ends the current word when unquoted and appends one literal space in a quoted context where the source table defines that behavior.
- `\c` stops split-input processing according to the committed context row. It does not delete outer trailing argv.
- A supported escaped dollar appends literal `$` and marks that character non-active.
- An unescaped `${VARNAME}` in an expansion-active context returns unsupported `env-active-expansion`; it is never substituted.
- An unknown escape, missing escape argument, unclosed quote, or missing `-S` argument returns fixed unsupported evidence rather than throwing away wrapper state.
- Generated `|`, `&&`, `;`, redirection characters, and shell-looking text are ordinary argv data. They never modify `lex().separators`.

The parser is linear in split-string bytes and creates no output larger than the split input plus the already-bounded trailing argv. Cumulative cost across nested splits is governed by the split-work bound above, so total split work for one env invocation is `O(N)` in outer argv bytes, not merely per-split linear.

#### Resulting wrapper reduction

Each accepted env interpretation with a non-null `eventualExecutable` returns an eventual argv candidate. `reduceWrappers` re-enters the existing fixed wrapper loop for that candidate, including `command --`. It does not call `lex` again. Candidates are deduplicated by exact argv equality before inherited policy evaluation. An accepted commandless interpretation (`eventualExecutable: null`) produces no candidate and no wrapper-loop entry; it is already a complete `accepted-safe` result.

If any accepted candidate reaches an inherited deny, that profile becomes accepted-dangerous. If accepted candidates all remain safe, they are accepted-safe. If no profile proves an eventual executable/argv and no profile proves the commandless terminal, the protected wrapper adapter returns ambiguity denial.

### GNU and Apple chmod state machines

Each profile performs one left-to-right pass while preserving token roles.

#### GNU default mode

- Recognized options continue to permute before and after the mode, reference form, and target operands until `--`.
- `-R` and uppercase `R` in an admitted short bundle set `recursive`.
- Exact `--recursive` and every unique committed abbreviation from `--rec` through `--recursive` set `recursive`.
- `--reference=FILE` or separated `--reference FILE` consumes and records `FILE` as `reference`, never as a target.
- Other admitted boolean options are recorded without affecting recursion.
- If no reference option supplies the mode source, the first non-option operand is `mode`; later non-option operands are `targets`.
- If reference supplies the mode source, the mixed-form rule below decides acceptance; operands are never blindly reassigned as targets.
- `--` records the delimiter and makes all following dash-prefixed tokens operands; mode/target assignment still follows the preceding rules.

#### GNU `POSIXLY_CORRECT` mode

The option grammar and role recorder are the same, but option recognition stops at the first non-option operand. Later dash-prefixed tokens are operands. This interpretation participates independently in the union; it cannot weaken dangerous GNU default permutation. The mixed-form rule below applies identically in this mode.

#### Mixed literal-mode and reference form (normative rule)

**Chosen rule: the mixed form is rejected-by-profile with complete partial-role evidence.** When `--reference` is present AND at least one non-option operand matches the committed literal-mode shape, the invocation mixes a literal mode operand with a reference mode source. Real GNU chmod discards the literal mode and reassigns every operand — including the mode-looking one — as a target, which would destroy the distinct mode role and violate Requirement 1 / S03 (mode, reference, and targets MUST remain distinguishable whenever all three coexist). Instead of modeling that destructive reassignment, every GNU chmod profile (default and `POSIXLY_CORRECT`) returns `rejected-by-profile` with reason code `mixed-mode-reference` and preserves complete partial roles in `partialRoles`:

- `mode`: the first non-option operand matching the literal-mode shape, recorded as the mode candidate;
- `reference`: the consumed `--reference` argument;
- `targets`: every remaining non-option operand, recorded as target candidates.

The committed literal-mode shape is bounded and fixed: an octal absolute mode (`0?[0-7]{3,4}`) or a symbolic clause list (`[ugoa]*[+=-][rwxXstugo]+` clauses separated by commas). An operand not matching this shape is never a mode candidate. When `--reference` is present and NO operand matches the mode shape, the reference form is accepted normally: all non-option operands are targets, the reference is never a target, and `/` used solely as the reference argument remains non-target evidence (S27). The Apple profile never reaches this rule because its committed table contains no `--reference` option; a GNU-style reference invocation is rejected-by-profile under Apple.

`mode777` consistency: `mode777` is asserted ONLY from an accepted profile's real `mode` role. The mode candidate inside a rejected mixed form's `partialRoles` never sets `mode777` directly. Instead, the rejected result feeds the unsupported/ambiguity path below: because the effective mode source is a host file whose contents the evaluator never reads, recursive or mode-777 semantics for any critical target candidate are unproven, and the critical-chmod adapter applies unchanged.

#### Apple mode

The Apple chmod machine implements exactly the `apple-chmod-v1` committed table above: the twelve source-documented no-argument flags (including uppercase `R` for recursion and the `H`/`L`/`P` traversal flags), admitted bundles scanning left-to-right, options-before-operands ordering, and no long-option family — Apple does not accept the GNU long recursive/reference family merely because GNU does, and `--` is rejected-by-profile because the cited revision does not document it. ACL/mode forms outside the committed bounded table (`+a`/`-a`/`=a#` family) return unsupported role evidence rather than being guessed.

#### Role and danger assessment

For every accepted profile:

1. `mode777` is true only when the selected mode role matches inherited `0?777`; option arguments and targets are not searched for that text.
2. A critical target is true only when a target role exactly matches the inherited corpus: `/`, `/*`, `~`, `$HOME`, `${HOME}`, `.`, `..`, or `PROJECT_ROOT`.
3. The profile is accepted-dangerous when a critical target has either `recursive` or `mode777`.
4. `/` used solely as a reference is non-target evidence and cannot trigger danger.

On unsupported parses, each attempt retains consumed arguments, reference, mode, target, and unknown token roles reached so far; a rejected mixed-mode/reference result contributes its preserved `partialRoles` (mode candidate, reference, target candidates) the same way. A raw critical literal is a `possibleTarget` unless every attempt that reached it proves a non-target role. A mode candidate recorded in `partialRoles` is not a `possibleTarget`, and a proven reference is never a `possibleTarget`. If no profile accepts and a possible critical target remains, the adapter denies critical-chmod ambiguity. If all possible targets are proven outside the critical corpus, the unsupported form receives no objection.

### GNU and Apple base64 state machines

#### GNU default mode

- Short `d` sets decode; short `i` is boolean; short `w` consumes the bundle remainder or next argv token as wrap width.
- Bundles scan left-to-right. Thus `-id` is boolean `i` plus decode `d`, while `-wid` lets `w` consume `id` and does not activate decode.
- The long table recognizes `--decode` and every unique prefix from `--d` through `--decode`; admitted boolean and argument-taking long options follow their table.
- Options permute after operands until `--`.
- `--` makes all later tokens operands.

#### GNU `POSIXLY_CORRECT` mode

The same option table is used, but option recognition stops at the first operand. It remains a separate result in the union.

#### Apple mode

- Short `d` and `D` set decode.
- Short `b`, `i`, and `o` consume the attached remainder or the following argv token and terminate bundle scanning.
- Every other option is admitted or rejected exactly as the `apple-base64-v1` committed table above states, with the explicit boolean/argument behavior enumerated there; there is no residual "when listed" deferral.
- Therefore `-Di input` records `D` as decode and `i` as consuming `input`; characters inside `input` are never flags.
- GNU long abbreviations are not inferred into Apple semantics; only the exact long names in the committed table are recognized.
- `--` is rejected-by-profile per the committed Apple table (the cited revision does not document it).

#### Actual pipeline sink

Base64 profile facts are assessed as dangerous only when all conditions hold:

1. `lex().separators[index]` is the real outer `|` separator;
2. the immediate downstream command is reduced by existing fixed wrappers to a literal executable;
3. that executable is exactly one of `sh`, `bash`, `zsh`, `dash`, or `ksh`;
4. the profile accepted the producer and set `decode`.

A quoted `|` token and an `env -S`-generated pipe never satisfy condition 1. Decode without the protected downstream shell is accepted-safe for this rule. If no profile accepts and the real protected shell sink exists, the adapter denies base64-to-shell ambiguity; without that sink, it returns no objection.

## Host-Independent Union and Contextual Ambiguity

### Exact profile reduction precedence

Profiles run in the registry's fixed order; host state is never an input. Reduction uses this precedence exactly:

1. If one or more results are `accepted-dangerous`, return `dangerous`. This dominates every other status.
2. Otherwise, if one or more results are `accepted-safe`, return `safe`. Rejected-by-profile and unsupported attempts do not invalidate proven accepted safety.
3. Otherwise, if no profile accepted, return `unsupported`. Preserve all rejected/unsupported evidence; do not relabel rejection as safety.

The protected-sink adapter then maps the union:

| Union | Sink evidence | Overall result |
|---|---|---|
| dangerous | any applicable protected sink | dangerous deny using inherited policy rule |
| safe | any | safe/no objection from this utility rule |
| unsupported | unresolved env eventual argv | ambiguous deny: wrapper-extraction |
| unsupported | possible critical chmod target | ambiguous deny: critical-chmod |
| unsupported | real pipe to supported shell | ambiguous deny: base64-to-shell |
| unsupported | no protected sink | safe/no objection from this utility rule |

This ordering resolves rejected-by-profile versus unsupported explicitly: profile grammar rejection is retained per profile, but an all-rejected union is `unsupported`; it becomes `ambiguous` only when the contextual adapter finds a protected sink.

A proven commandless env result enters this mapping as `accepted-safe` (union row `safe`), carries no eventual argv candidate, and therefore can never reach the `unresolved env eventual argv` row. Wrapper-extraction ambiguity remains possible only for genuinely unproven extraction. Because a commandless result is a no-objection outcome, the S47 silence guarantee (no stdout/stderr on allow) and the S51 prior-safe guarantee are preserved unchanged.

### Candidate-level danger dominance

Env wrapper reduction may produce more than one accepted eventual argv across profiles/modes. `evaluateBash` evaluates each deduplicated candidate with inherited policy. A deny from any candidate wins. Chmod/base64 assessment similarly occurs per accepted profile before union. No profile can select a weaker machine-dependent decision.

## Integration with Existing Runtime

### `lex`

`lex` keeps its public behavior and remains the only source of command segments and real separators. No utility parser receives the original command string when argv is sufficient, and no utility parser may alter `commands` or `separators`.

### `commandWords`

The internal implementation becomes `reduceWrappers(input, context)` and returns structured wrapper candidates plus traces. A small `commandWords` compatibility function may remain for existing non-utility call sites, but it must return only when reduction has one proven candidate; ambiguity is surfaced to `evaluateBash`, not silently collapsed.

Fixed behavior for `sudo`, `command`, `builtin`, and `nohup` remains scoped to the inherited wrapper grammar. Env handling delegates to the env profile normalizer. Resulting `command --` argv is reduced without reparsing as shell source.

### `evaluateBash`

For each lexed command segment:

1. reduce wrappers and evaluate every proven eventual argv candidate;
2. preserve inherited destructive, sensitive-read, force-push, managed-config, substitution, and nested-shell rules;
3. call the chmod normalizer only for literal chmod identity;
4. call the base64 normalizer only when the lexer exposes a real immediate pipeline;
5. apply profile union and the protected-sink adapter;
6. return the first deterministic deny according to existing rule order, with candidate danger dominating utility rejection;
7. remain silent when no rule objects.

### Helper export migration

The current `parseEnvSplit`, `hasChmodRecursive`, and `hasBase64Decode` exports are test seams, not published product APIs. They are removed after the focused tests migrate to semantic exports such as `normalizeEnvInvocation`, `normalizeChmodInvocation`, `normalizeBase64Invocation`, and `reduceProfileUnion`.

Production code must not retain boolean adapters. Stable runtime exports used by packaging and consumers (`MANAGED_MARKER`, `INPUT_LIMIT_BYTES`, `SUPPORTED_TOOLS`, `POLICY_REGISTRY`, path helpers, `evaluateEvent`, `parseAndEvaluateInput`, `readBoundedStdin`, and `main`) remain compatible. Observable allow/deny behavior changes only for the specified bypasses and protected ambiguity cases.

## Diagnostics and Observability

### Public reason categories

Ambiguity denials use exactly:

```text
reason:  utility-ambiguity
utility: env | chmod | base64 | unsupported
profile: <committed profile id> | unsupported
sink:    wrapper-extraction | critical-chmod | base64-to-shell
```

Internal unsupported codes are fixed enums used in tests and control flow, not rendered values. They include categories such as active expansion, unsupported split escape, unresolved wrapper, unresolved chmod roles, and unresolved decode semantics.

For a profile-specific ambiguity, `profile` is the first fixed-registry-order unsupported attempt that produced the controlling evidence. If no exact profile controls it, the category is `unsupported`. This makes category selection deterministic without host inspection.

### Bounded stderr contract

`Decision` carries only fixed categories to `denialDiagnostic`. The diagnostic never receives command text, split text, assignments, option values, operands, paths, stdin, environment values, or host utility output. The existing UTF-8 truncation remains the final 240-byte guard; all fixed templates are designed to fit before truncation. Exit remains `2`, stdout remains empty, and allowed decisions write neither stream.

Dangerous non-ambiguity cases retain inherited rule IDs (`shell.destructive-root`, `shell.pipe-to-shell`, or the downstream inherited rule). They do not need utility context to satisfy this change.

## Security Boundaries, Complexity Limits, and Failure Modes

### Complexity limits

- Global stdin remains bounded at 1 MiB.
- Every utility/profile parser is one linear pass: `O(argv bytes + token count)` time and `O(token count)` evidence.
- The profile registry is fixed at seven entries for this design; no runtime discovery can increase it.
- Env split processing is linear per split operation and cannot emit more bytes than its input plus existing trailing argv; cumulative cost is governed by the next bullet, which is what makes the claimed linear bound hold across nested splits.
- Cumulative env split work is hard-capped per invocation: `splitOps <= 32` split operations AND `splitBytes <= 8 * N` total re-scanned split-input bytes, where `N` is the outer env argv byte count. Exceeding either counter yields fixed `unsupported(split-work-limit)` evidence (phase `split`) and therefore wrapper-extraction ambiguity denial. This is enforced in the option-pass state machine, not just asserted here.
- Wrapper reduction is capped at 32 wrapper transitions. Exceeding the cap yields unsupported wrapper evidence and therefore denies only at wrapper extraction. This cap does not replace the split-work bound; both are enforced independently.
- Profile candidates are deduplicated after each env reduction; no Cartesian product or recursive shell parse is introduced.
- Existing nested Bash evaluation depth remains 4.
- Long-option matching scans a small frozen table and accepts only one match; no user-controlled regex is built.

### Failure-mode mapping

| Failure | Result |
|---|---|
| Outer shell command cannot be lexed | Existing `shell.obfuscated-interpreter` denial |
| Env split quote/escape/expansion cannot be normalized | Unsupported, then wrapper-extraction ambiguity denial |
| Env cumulative split-work bound exceeded (nested `-S` blowup) | Unsupported `split-work-limit`, then wrapper-extraction ambiguity denial |
| Env option pass consumes every token as options/assignments with no command operand | Accepted-safe commandless result (`eventualExecutable: null`); no objection, silent exit per S47/S51 |
| Chmod mixes a literal mode operand with `--reference` | Rejected-by-profile `mixed-mode-reference` with preserved partial roles (mode candidate, reference, target candidates); ambiguity denial only via the critical-chmod sink |
| Chmod roles unresolved with possible critical target | Critical-chmod ambiguity denial |
| Chmod unsupported away from proven critical targets | No objection from this utility policy |
| Base64 decode unresolved at real supported shell pipe | Base64-to-shell ambiguity denial |
| Base64 unsupported without protected shell pipe | No objection from this utility policy |
| Static registry invariant fails or evaluator throws | Existing guarded `internal-error` fail-closed path |
| Host utility absent/different/localized | No effect; host is never consulted |
| Manifest digest differs from runtime bytes | Integrity test failure; artifact is not accepted |

### Explicit residuals

This design does not claim complete shell parsing, complete utility validity, actual binary provenance, alias/function semantics, symlink target identity, BusyBox/custom behavior, environment expansion, utility output, filesystem effects, or ACL semantics. Unsupported residuals are handled only through the three approved contextual sinks.

## Test Architecture

### Strict RED -> GREEN -> REFACTOR sequence

This is a verification architecture, not a task plan.

**RED:** First replace incorrect helper expectations and add failing exact-MJS semantic tables for all profile states, roles, abbreviations, bundles, delimiter behavior, env escapes/expansion, and union precedence. Add spawned failures for every inherited judge bypass and protected ambiguity diagnostic before runtime changes. The incorrect GNU `base64 -id` allow expectation must fail visibly rather than be edited after implementation.

**GREEN:** Implement the smallest profile tables/state machines and protected-sink adapter needed to satisfy the semantic corpus. Keep inherited safe/deny corpora unchanged. Update the manifest digest only after runtime bytes stabilize so the hash gate remains a deliberate red signal during implementation.

**REFACTOR:** Remove old boolean exports and duplicate scans, consolidate only genuinely shared primitives, freeze tables, and rerun the exact-MJS and spawned suites. Do not generalize into a generic parser. Refactoring is complete only when table/property invariants, prior-safe/prior-deny regression, diagnostics bounds, manifest identity, and the existing Windows lane remain green.

No host-conditioned utility test is acceptance evidence. Optional manual conformance work belongs to profile maintenance and cannot skip or change committed expectations.

### Layers

| Layer | Location | Responsibility |
|---|---|---|
| L1 semantic exact-MJS | `src/__tests__/claude-hook-assets.test.ts` | Import the packaged MJS; assert structured profile results, roles, consumed arguments, delimiter state, unsupported evidence, and union precedence. |
| L2 event policy exact-MJS | same file | Assert end-to-end `evaluateEvent` decisions, prior-safe/prior-deny corpus, literal identity, and silent allow behavior. |
| L3 property/table corpus | same file | Enumerate unique prefixes, bundle argument termination, permutation positions, delimiter invariants, quote/escape rows, profile rejection, and source-binding invariants. |
| L4 spawned integration | `src/__integration__/claude-pretooluse-exec.integration.test.ts` | Execute the exact MJS with PATH restricted to Node; assert exit/stdout/stderr, non-leakage, judge probes, and no package/utility dependency. |
| L5 integrity/governance | unit file + `assets/claude-hooks/manifest.json` | Bind source/profile IDs and exact SHA-256; reject byte drift and historical-identity fabrication. |
| L6 Windows host-independent lane | existing `.github/workflows/claude-hook-windows.yml` | Run the same focused files without GNU/Apple utility availability or platform skips. No workflow edit is forecast. |
| L7 workflow verification | git/SDD verification evidence | Verify base/target, <=800 product diff, parent ledger byte identity/open findings, and absence of fabricated native JSON. |

### Scenario-to-test-layer traceability

Scenario IDs below follow specification order exactly.

| ID | Scenario | Primary evidence |
|---|---|---|
| S01 | Option argument text is not reinterpreted as a flag | L1 + L3 |
| S02 | Delimiter state survives normalization | L1 + L3 |
| S03 | Chmod roles remain distinct | L1 |
| S04 | Dangerous profile dominates rejection | L1 + L2 |
| S05 | Safe accepted profile is not invalidated by rejection | L1 + L2 |
| S06 | GNU option permutation dominates POSIXLY_CORRECT | L1 + L3 + L4 |
| S07 | Environment cannot select a weaker decision | L2 + L4 + L6 |
| S08 | Unsupported env wrapper is denied contextually | L2 + L4 |
| S09 | Unsupported chmod form with critical-root uncertainty is denied | L2 + L4 |
| S10 | Unsupported chmod form away from critical roots receives no objection | L2 + L4 |
| S11 | Unsupported base64 form without a protected shell sink receives no objection | L2 + L4 |
| S12 | Unsupported base64 form at a protected shell sink is denied | L2 + L4 |
| S13 | Bundled env -iS cannot hide a sensitive read | L1 + L2 + L4 |
| S14 | Bundled env -vS cannot hide a sensitive read | L1 + L2 + L4 |
| S15 | Accepted env long abbreviation cannot hide a sensitive read | L3 + L4 |
| S16 | Active env expansion is denied without evaluation | L1 + L2 + L4 |
| S17 | Escaped dollar remains literal | L1 + L3 |
| S18 | Env c escape preserves trailing argv | L1 + L2 + L4 |
| S19 | Env wrapper reduction continues after split | L1 + L2 + L4 |
| S20 | Env split pipe is literal argv | L1 + L2 + L4 |
| S21 | Unsupported env escape cannot bypass wrapper inspection | L1 + L2 + L4 |
| S22 | Documented env quote/comment/whitespace corpus is exact | L3 |
| S23 | GNU recursive option after mode and target is denied | L1 + L2 + L4 |
| S24 | GNU recursive option after reference form is denied | L1 + L2 + L4 |
| S25 | Every accepted chmod recursive abbreviation is denied at root | L3 + L4 |
| S26 | Chmod short-bundle order does not weaken recursion | L3 + L4 |
| S27 | Reference root is not a target | L1 + L2 + L4 |
| S28 | Non-dangerous mode after delimiter is a benign near miss | L1 + L2 + L4 |
| S29 | Mode 777 is dangerous without recursion | L1 + L2 + L4 |
| S30 | Apple rejection does not cancel GNU danger | L1 + L2 |
| S31 | GNU bundled -id is decode | L1 + L2 + L4 |
| S32 | GNU separated -i does not consume -d | L1 + L2 + L4 |
| S33 | Apple bundled -Di is decode with an input argument | L1 + L2 + L4 |
| S34 | Every accepted base64 decode abbreviation is denied at shell sink | L3 + L4 |
| S35 | GNU permutation after operand is denied | L1 + L2 + L4 |
| S36 | Apple option arguments containing d are benign | L1 + L2 + L4 |
| S37 | Base64 delimiter makes -d an operand | L1 + L2 + L4 |
| S38 | Quoted base64 pipe is data | L2 + L4 |
| S39 | Every supported downstream shell is protected | L3 + L4 |
| S40 | Unsupported downstream program is outside this sink | L2 + L4 |
| S41 | Path-qualified env has the same identity | L1 + L2 + L4 |
| S42 | Path-qualified chmod has the same identity | L1 + L2 + L4 |
| S43 | Path-qualified base64 has the same identity | L1 + L2 + L4 |
| S44 | Dynamic identity is not profiled by execution or lookup | L1 + L2 + L6 |
| S45 | Active expansion diagnostic does not leak assignment data | L4 |
| S46 | Chmod ambiguity diagnostic does not leak paths | L4 |
| S47 | Allowed decision remains silent | L4 |
| S48 | Profile drift requires an explicit reviewed update | L3 + L5 |
| S49 | Missing host utility cannot skip profile acceptance | L4 + L6 |
| S50 | Localized help is not a grammar oracle | L3 + source inspection |
| S51 | Prior safe corpus remains safe | L2 + L4 |
| S52 | Documented protected ambiguity may change prior behavior | L2 + L4 |
| S53 | Parent denials remain denied | L2 + L4 |
| S54 | Final-judge env bypass family is acceptance evidence | L4 + L7 |
| S55 | Final-judge chmod/base64 bypass family is acceptance evidence | L4 + L7 |
| S56 | Exact MJS runs without package dependencies | L4 + L6 |
| S57 | MJS byte drift breaks manifest binding | L5 |
| S58 | Unreleased parent identity is replaced honestly | L5 + L7 |
| S59 | Native recommendation cannot override inherited open findings | L7 |
| S60 | Specification does not close inherited findings | L7 |
| S61 | Review budget breach requires a split decision | L7 |
| S62 | Rollback preserves parent history | L7 |

Design Round 1 amendments (JD-DES-001/002/005/008) refine layer obligations within existing scenario rows; no scenario IDs are added or renumbered:

- **Mixed mode/reference rejection (JD-DES-001)** strengthens S03 at L1: the corpus asserts the `mixed-mode-reference` rejection preserves mode candidate, reference, and target candidates as distinguishable partial roles, plus an L2/L4 row that `chmod 777 --reference=<ref> /` is denied via mode777 danger dominance with the inherited dangerous rule ID (not through the utility-ambiguity sink, because the trailing `--reference=<ref>` is an operand after the first operand `777` under GNU POSIXLY_CORRECT and Apple), that the reference-first ordering `chmod --reference=<ref> 777 /` is denied through the critical-chmod sink via the mixed-mode-reference rejection path, and that `chmod --reference=<ref> /` without a mode-shaped operand remains accepted (S24/S27 behavior intact).
- **Enumerated committed tables (JD-DES-002)** strengthen S48/S50 at L3/L5: source-binding assertions now cover the complete seven-entry binding table (publisher, artifact, immutable revision/date, section, reference) and the full option tables, not representative rows.
- **Cumulative split-work bound (JD-DES-005)** adds one L3 corpus row under S21/S08: a nested `-S` attached-remainder chain exceeding `splitOps`/`splitBytes` returns `split-work-limit` and denies at wrapper extraction; and one L2 row asserting a within-bound nested `-S` chain still resolves normally.
- **Commandless env terminal (JD-DES-008)** adds L1/L2 benign rows under S47/S51: `env`, `env -i`, and `env NAME=VALUE` are accepted-safe commandless results with silent exit 0, and an L1 row asserting a commandless result never enters the wrapper-extraction ambiguity path.

## Requirement-to-Component Traceability

| Requirement | Implementing components | Acceptance concentration |
|---|---|---|
| Semantic results preserve parse evidence | Common evidence shapes; three normalizers | L1/L3 role, argument, delimiter tables |
| Profile union is host-independent and danger-dominant | `assessProfile`, `reduceProfileUnion` | S04-S07, L6 |
| Ambiguity denial is limited to protected sinks | `adaptProtectedSink`; commandless env terminal; mixed-form partial roles | S08-S12 |
| GNU env split-string semantics | env option pass, split machine, cumulative split-work bound, wrapper reducer | S13-S22 |
| Chmod permutation and operand roles | GNU default/POSIX and Apple chmod machines; mixed-mode/reference rejection | S23-S30 |
| Base64 decode and option arguments | GNU default/POSIX and Apple base64 machines; pipeline context | S31-S40 |
| Literal utility identity | `normalizeLiteralUtilityIdentity` | S41-S44 |
| Stable bounded diagnostics | semantic decision context; `denialDiagnostic`; existing truncator | S45-S47 |
| Profile governance | `UTILITY_PROFILE_REGISTRY`; source assertions; deterministic corpus | S48-S50 |
| Compatibility | inherited L2/L4 corpora; ambiguity exception labels | S51-S55 |
| Packaged runtime and manifest identity | single MJS; exact import/spawn tests; manifest | S56-S58 |
| Relationship/workflow guards | branch/ledger/budget verification | S59-S62 |

## Exact Changed-File Forecast and Review Budget

The future implementation review unit changes exactly these four product files from `69823570`:

| File | Action | Forecasted changed lines | Why |
|---|---|---:|---|
| `assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs` | Modify | 365-440 | Replace three helpers and env wrapper path; add frozen profiles with the complete enumerated option tables, semantic shapes, three bounded machines, mixed-form rejection, commandless terminal, split-work counters, union/sink adapter, and fixed diagnostics context. |
| `src/__tests__/claude-hook-assets.test.ts` | Modify | 175-220 | Pure structured semantics, complete profile/source-binding and option-table assertions, properties/tables, mixed-form and commandless corpus rows, split-work bound row, prior-safe/prior-deny, and manifest invariants. |
| `src/__integration__/claude-pretooluse-exec.integration.test.ts` | Modify | 105-140 | Remove host-oracle/helper tests; add exact spawned bypass, ambiguity, non-leakage, and standalone cases. |
| `assets/claude-hooks/manifest.json` | Modify | 2 | Replace the single minified line and bind the new exact SHA-256; keep `historical: []`. |
| **Total** |  | **647-792** | Defensible below the configured 800-line cap with 8 lines contingency. |

Changed lines mean additions plus deletions in the child product diff. The estimate includes all 62 scenario obligations through compact tables and shared process fixtures; it does not defer evidence or compress semantics into unreadable regexes. The Round 1 amendments move the forecast from 637-787 to 647-792: the fully enumerated option tables replace deferred prose with data rows the original frozen-profile forecast already carried, while the genuinely new logic (mixed-mode/reference role check, commandless terminal, split-work counters) is three small bounded branches inside machines already forecast. Profile source/version evidence is embedded in the runtime registry and asserted in the pure test, so no fifth metadata file is required. The existing Windows workflow remains unchanged and runs the same files.

SDD control-plane artifacts and the already-modified parent ledger are not part of the implementation product diff and must not be staged into the child review unit. Reaching 793 lines exhausts forecast contingency and forbids adding scope; a defensible reforecast above 800 triggers the configured ask-always split decision. The preferred split boundary is env wrapper extraction first, then chmod/base64 together; no normative scenario may be omitted to fit.

## Relationship, Branch, Rollout, and Rollback

### Relationship and branch plan

```text
amends: skillguard-pretooluse-hook
depends-on: skillguard-pretooluse-hook@69823570

feat/skillguard-pretooluse-hook-01-runtime @ 69823570
  -> child: feat/skillguard-utility-parser-redesign
  -> PR target: feat/skillguard-pretooluse-hook-01-runtime
```

The child must be created from exact `69823570ccae4b3a78e717b6510c3c402bb8975a`. It does not supersede the parent, retarget the parent PR, advance Slice 2, or rewrite parent SDD/review history.

`JD-S1-FR3-001` and `JD-S1-FR3-002` remain open until fresh post-apply Judgment Day verifies implementation evidence. Native status cannot override the Markdown ledger. No `reviews/ledger.json`, synthetic native review state, or other JSON authority is created.

### Rollout

There is no data migration or automatic consumer rewrite. Because `69823570` is unreleased, the child replaces that unreleased runtime identity in place:

- keep manifest asset version/policy ownership semantics consistent with the unreleased v1 identity;
- replace the exact SHA-256;
- keep `historical: []` rather than pretending the parent hash was released;
- do not claim npm, Linuxbrew, or existing project-local hooks contain the new bytes.

### Rollback

Rollback is exact: return the child product files to `69823570`. Do not revert, reset, edit, or regenerate parent proposal/spec/design, review attempts, or ledger history. The target parent branch remains the recovery anchor.

## Alternatives Rejected

| Alternative | Rejection reason |
|---|---|
| Extend boolean regex helpers | Repeats the root failure: no role, consumed-argument, delimiter, mode, or profile evidence survives. |
| Full GNU/Apple coreutils emulation | Adds output/error/filesystem semantics that cannot improve the three policy decisions and cannot fit the security/review budget. |
| Generic configurable getopt abstraction | Hides utility-specific state behind callback complexity and encourages unsupported grammar growth. |
| Shell AST dependency | Does not solve utility option semantics; breaks dependency-free copied runtime and expands package/lockfile scope. |
| Host `process.platform` selection | A host does not identify the binary selected by a later shell and creates weaker machine-dependent decisions. |
| Execute utilities or parse localized help | Unsafe as a pre-execution oracle, unavailable on Windows, PATH/version/locale dependent, and forbidden by the product contract. |
| Runtime/sibling profile JSON | Breaks the exact single-file installation and introduces a second integrity/deployment target. |
| Deny every unsupported utility form | Turns SkillGuard into a general validator and breaks approved compatibility outside protected sinks. |
| Evaluate `${VARNAME}` | The evaluator cannot reproduce outer assignments or future environment state; pretending otherwise creates a time-of-check bypass. |

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Protected-sink false positives | Ambiguity adapter is limited to three sinks; safe accepted profile results outrank rejection/unsupported results. |
| Profile drift | Versioned source bindings, profile ID changes, exact tables, corpus, spawned regressions, and digest update move together. |
| Parser complexity exceeds auditability | Three linear state machines, fixed profile count, explicit 32-wrapper cap, no generic parser or shell reparse. |
| Cross-profile role disagreement | Preserve per-profile facts; danger dominates; no merged-role guess. |
| Sensitive diagnostic leakage | Render only fixed reason/utility/profile/sink enums; assert exact bound and secret/path absence in spawned tests. |
| Review budget breach | Four-file 647-792 forecast with 8-line contingency; ask-always split instead of evidence compression. |
| Inherited behavior regression | Retain complete prior-safe and prior-deny corpora in both exact-import and spawned layers. |
| Workflow incorrectly advances | Manual parent-ledger gate remains authoritative; findings stay open; no fabricated JSON. |

## Open Questions

None. The design implements the eleven approved product decisions and all 12 requirements/62 scenarios without widening runtime or workflow scope.
