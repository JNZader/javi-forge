# SkillGuard Utility Parser Redesign Specification

## Purpose

This specification amends the bounded Bash policy in `skillguard-pretooluse-hook` so `env`, `chmod`, and `base64` option semantics cannot hide an inherited denied operation. It defines host-independent observable decisions and acceptance evidence without requiring full utility emulation or general command validation.

## Terms and Decision Classes

The following terms are normative:

| Term | Meaning |
|---|---|
| **supported profile** | A committed, named GNU coreutils or Apple system-utility semantic profile covered by this specification. GNU default and GNU `POSIXLY_CORRECT` are separate evaluation modes. |
| **accepted-safe** | The profile accepts the invocation and proves that the policy-relevant protected semantic is absent. |
| **accepted-dangerous** | The profile accepts the invocation and proves that the policy-relevant protected semantic is present. |
| **rejected-by-profile** | The profile rejects the invocation under its documented option grammar. Rejection is not evidence that another profile is safe. |
| **unsupported** | No exact supported profile governs the utility identity or form. Unsupported does not by itself mean dangerous. |
| **ambiguous** | The evaluator cannot prove the policy-relevant executable, option meaning, operand role, or sink relationship needed to classify a protected sink. |
| **no objection** | The hook writes no stdout or stderr and exits `0`. This is not utility validation or permission to execute. |
| **deny** | The hook writes no stdout, emits a bounded non-sensitive diagnostic on stderr, and exits `2`. |

## Requirements

### Requirement: Semantic results preserve policy-relevant parse evidence

For each supported `env`, `chmod`, or `base64` candidate, the evaluator MUST preserve enough semantic evidence to distinguish an overall `safe`, `dangerous`, or `ambiguous` result and each profile's `accepted-safe`, `accepted-dangerous`, or `rejected-by-profile` result. The evidence MUST preserve the literal utility identity, profile and mode applicability, whether `--` terminated option parsing, every consumed option argument, and policy-relevant operand roles.

For `env`, the preserved roles MUST distinguish wrapper options, split-string input, assignments, the resulting executable, and its argv. For `chmod`, they MUST distinguish mode, reference input, option argument, and target operands, together with recursive and mode-`777` semantics. For `base64`, they MUST distinguish decode flags, boolean flags, argument-taking options, operands, and the real downstream pipeline target. The evaluator MUST NOT infer a flag from characters that belong to a consumed option argument.

#### Scenario: Option argument text is not reinterpreted as a flag

- GIVEN a supported profile classifies an argv token or following token as an option argument
- WHEN that argument contains `d`, `D`, `R`, `777`, `--`, or another policy-significant spelling
- THEN the semantic result records the token as the consumed option argument
- AND the contained text does not independently activate decode, recursion, mode, or option termination

#### Scenario: Delimiter state survives normalization

- GIVEN a supported utility invocation contains `--`
- WHEN the semantic result is produced
- THEN it records that option parsing terminated at that token for the selected profile
- AND every later dash-prefixed token is classified only as an operand in that profile

#### Scenario: Chmod roles remain distinct

- GIVEN a supported `chmod` invocation contains a mode, a `--reference` argument, and one or more targets
- WHEN the semantic result is produced
- THEN the mode, reference input, and targets remain distinguishable
- AND neither the reference input nor an option argument is classified as a target

### Requirement: Profile union is host-independent and danger-dominant

The evaluator SHALL evaluate the committed GNU coreutils and Apple system-utility profiles without selecting a profile from the host operating system, `PATH`, locale, installed binary, or installed version. GNU default and GNU `POSIXLY_CORRECT` modes MUST both participate in the deterministic union wherever the committed GNU profile makes them relevant.

If any supported profile accepts an invocation as dangerous, the overall result MUST be dangerous even when another profile accepts it as safe or rejects it. If at least one supported profile accepts the invocation and every accepting profile proves the protected semantic absent, the overall result MUST be safe. If no supported profile accepts the form, the overall result MUST be unsupported and SHALL become ambiguous only under the protected-sink rules in this specification.

#### Scenario: Dangerous profile dominates rejection

- GIVEN one supported profile classifies an invocation as accepted-dangerous
- AND another supported profile classifies the same invocation as rejected-by-profile
- WHEN the packaged hook evaluates the command
- THEN it denies with exit `2`

#### Scenario: Safe accepted profile is not invalidated by rejection

- GIVEN at least one supported profile classifies an invocation as accepted-safe
- AND every other supported profile either classifies it as accepted-safe or rejected-by-profile
- WHEN the packaged hook evaluates the command
- THEN it returns no objection with silent exit `0`

#### Scenario: GNU option permutation dominates POSIXLY_CORRECT

- GIVEN GNU default accepts an option after an operand and classifies the invocation as dangerous
- AND GNU `POSIXLY_CORRECT` does not apply that later token as an option
- WHEN the packaged hook evaluates the command
- THEN the GNU default result dominates and the hook denies with exit `2`

#### Scenario: Environment cannot select a weaker decision

- GIVEN the same command string and committed profile set are evaluated on Linux, macOS, and Windows
- WHEN `LANG`, `PATH`, the host utility version, or host utility availability differs
- THEN the classification, exit code, and stable diagnostic category are identical

### Requirement: Ambiguity denial is limited to protected sinks

The evaluator MUST deny ambiguity during `env` wrapper extraction when it cannot identify the eventual executable and argv. For `chmod`, it MUST deny ambiguity only when a critical-root candidate is present and it cannot prove target roles or the absence of recursive or mode-`777` semantics for that critical target. For `base64`, it MUST deny ambiguity only when uncertain decode semantics feed a real unquoted pipeline into exactly `sh`, `bash`, `zsh`, `dash`, or `ksh`.

An unsupported form outside those protected sinks MUST receive no objection. The evaluator MUST NOT use this utility analysis as a general syntax validator.

#### Scenario: Unsupported env wrapper is denied contextually

- GIVEN a literal supported `env` identity uses a split or wrapper form whose resulting executable and argv cannot be proven
- WHEN the packaged hook evaluates the command
- THEN it denies with exit `2` and the ambiguity diagnostic category for wrapper extraction

#### Scenario: Unsupported chmod form with critical-root uncertainty is denied

- GIVEN a literal supported `chmod` identity contains `/` as a possible target
- AND the profiles cannot prove target roles or the absence of recursive or mode-`777` semantics
- WHEN the packaged hook evaluates the command
- THEN it denies with exit `2` and the ambiguity diagnostic category for the critical-chmod sink

#### Scenario: Unsupported chmod form away from critical roots receives no objection

- GIVEN a literal supported `chmod` identity uses an unsupported option form
- AND every possible target is proven outside the inherited critical-root corpus
- WHEN the packaged hook evaluates the command
- THEN it returns no objection with silent exit `0`

#### Scenario: Unsupported base64 form without a protected shell sink receives no objection

- GIVEN a literal supported `base64` identity uses an unsupported option form
- AND its output does not feed a real unquoted pipeline into `sh`, `bash`, `zsh`, `dash`, or `ksh`
- WHEN the packaged hook evaluates the command
- THEN it returns no objection with silent exit `0`

#### Scenario: Unsupported base64 form at a protected shell sink is denied

- GIVEN a literal supported `base64` identity uses a form whose decode semantics cannot be proven
- AND its output feeds a real unquoted pipeline into `bash`
- WHEN the packaged hook evaluates the command
- THEN it denies with exit `2` and the ambiguity diagnostic category for the base64-to-shell sink

### Requirement: GNU env split-string semantics preserve wrapper extraction

For a literal `env` identity, the GNU profile MUST recognize separated and attached `-S`, bundled `-iS` and `-vS`, full `--split-string`, and every unique accepted long abbreviation recorded by the committed profile, including `--split-str`. Split-string processing MUST follow the profile's versioned GNU documentation for quoting, comments, whitespace, and documented escapes, including `\_` and `\c`.

Split-string output MUST be argv, not a second shell program. `\c` MUST stop processing the split string without discarding trailing argv supplied outside that string. Wrapper reduction MUST continue over a resulting supported `command --` wrapper. A literal pipe produced inside the split string MUST remain argv data rather than becoming an outer Bash pipeline.

An active `${VARNAME}` in split-string input MUST be classified as unsupported ambiguity and MUST NOT be evaluated. A dollar escaped according to the committed GNU split-string profile MUST remain literal and MUST NOT trigger active-expansion ambiguity.

#### Scenario: Bundled env -iS cannot hide a sensitive read

- GIVEN the Bash command `env -iS 'cat\_~/.ssh/id'`
- WHEN the packaged hook evaluates it
- THEN wrapper extraction reaches `cat` with `~/.ssh/id` as an operand
- AND the hook denies with exit `2`

#### Scenario: Bundled env -vS cannot hide a sensitive read

- GIVEN the Bash command `env -vS 'cat\_~/.ssh/id'`
- WHEN the packaged hook evaluates it
- THEN wrapper extraction reaches `cat` with `~/.ssh/id` as an operand
- AND the hook denies with exit `2`

#### Scenario: Accepted env long abbreviation cannot hide a sensitive read

- GIVEN the Bash command `env --split-str='cat\_~/.ssh/id'`
- WHEN the packaged hook evaluates it under the committed GNU profile
- THEN `--split-str` is accepted as the recorded unique abbreviation of `--split-string`
- AND the hook denies with exit `2`

#### Scenario: Active env expansion is denied without evaluation

- GIVEN the Bash command `READER=cat env -S '${READER}\_~/.ssh/id'`
- WHEN the packaged hook evaluates it
- THEN it does not read or substitute `${READER}` from either the evaluator or future shell environment
- AND it denies as wrapper-extraction ambiguity with exit `2`

#### Scenario: Escaped dollar remains literal

- GIVEN an `env -S` split string contains `\${VARNAME}` in a profile-documented context where the backslash escapes the dollar
- WHEN the packaged hook evaluates the command
- THEN the resulting argv contains the literal `${VARNAME}` text
- AND active-expansion ambiguity is not raised for that text

#### Scenario: Env c escape preserves trailing argv

- GIVEN the Bash command `env -S 'cat\c' ~/.ssh/id`
- WHEN the packaged hook evaluates it
- THEN `\c` stops the split string after `cat` and the trailing `~/.ssh/id` remains in the resulting argv
- AND the hook denies with exit `2`

#### Scenario: Env wrapper reduction continues after split

- GIVEN the Bash command `env -S 'command -- cat\_~/.ssh/id'`
- WHEN the packaged hook evaluates it
- THEN it reduces the resulting `command --` wrapper and reaches the sensitive `cat` invocation
- AND the hook denies with exit `2`

#### Scenario: Env split pipe is literal argv

- GIVEN the Bash command `env -S 'printf\_x|bash'`
- WHEN the packaged hook evaluates it
- THEN the `|` produced by split-string processing is an argv token or argv text rather than an outer Bash pipeline
- AND the hook returns no objection with silent exit `0`

#### Scenario: Unsupported env escape cannot bypass wrapper inspection

- GIVEN the Bash command `env -S 'printf\q'`
- WHEN the packaged hook evaluates it
- THEN the unsupported split escape prevents proven wrapper extraction
- AND the hook denies as ambiguity with exit `2`

#### Scenario: Documented env quote comment and whitespace corpus is exact

- GIVEN the committed GNU `env -S` corpus contains one source-cited row for every documented quote context, comment rule, whitespace class, and supported escape
- WHEN each row is normalized
- THEN its resulting argv and trailing-argv boundary exactly match the row's documented expected argv
- AND any row whose resulting executable performs an inherited denied operation causes packaged-hook exit `2`

### Requirement: Chmod profiles preserve permutation and operand roles

The GNU `chmod` profile MUST model GNU default option permutation and GNU `POSIXLY_CORRECT` behavior as separate union modes. It MUST recognize `-R`, short bundles containing uppercase `R`, `--recursive`, and every unique accepted abbreviation from `--rec` through `--recursive`. It MUST consume `--reference` and its reference argument without treating that argument as a target. It MUST continue GNU default option recognition after a mode, reference form, or target operand until `--` terminates option parsing.

The Apple `chmod` profile MUST cover only the committed, source-documented Apple option surface needed to determine recursion, consumed option arguments, mode, and targets. It MUST NOT accept the GNU long-option family merely because GNU accepts it. Across profiles, recursive modification or mode `777` of an inherited critical root MUST be dangerous; mode `777` MUST remain dangerous for a critical target independently of recursion.

#### Scenario: GNU recursive option after mode and target is denied

- GIVEN the Bash command `chmod 755 / --recursive`
- WHEN the packaged hook evaluates it
- THEN GNU default classifies `/` as the target and the later option as recursive
- AND the hook denies with exit `2`

#### Scenario: GNU recursive option after reference form is denied

- GIVEN the Bash command `chmod --reference=/tmp/ref / --recursive`
- WHEN the packaged hook evaluates it
- THEN `/tmp/ref` remains the reference input and `/` remains the target
- AND the hook denies with exit `2`

#### Scenario: Every accepted chmod recursive abbreviation is denied at root

- GIVEN each Bash command in the inclusive committed corpus from `chmod --rec 755 /` through `chmod --recursive 755 /`
- WHEN the packaged hook evaluates each command
- THEN the GNU profile accepts each recorded unique abbreviation as recursive
- AND every command is denied with exit `2`

#### Scenario: Chmod short-bundle order does not weaken recursion

- GIVEN the Bash commands `chmod -vR 755 /` and `chmod -Rv 755 /`
- WHEN the packaged hook evaluates each command
- THEN uppercase `R` is recursive in either supported bundle order
- AND each command is denied with exit `2`

#### Scenario: Reference root is not a target

- GIVEN the Bash command `chmod -R --reference=/ /tmp/safe`
- WHEN the packaged hook evaluates it
- THEN `/` is classified only as the reference input and `/tmp/safe` as the target
- AND the hook returns no objection with silent exit `0`

#### Scenario: Non-dangerous mode after delimiter is a benign near miss

- GIVEN the Bash command `chmod 755 -- /`
- WHEN the packaged hook evaluates it
- THEN `755` is the mode, `/` is the target, and no recursive semantic is active
- AND the hook returns no objection with silent exit `0`

#### Scenario: Mode 777 is dangerous without recursion

- GIVEN the Bash command `chmod 777 -- /`
- WHEN the packaged hook evaluates it
- THEN mode `777` applies to the critical target independently of recursion
- AND the hook denies with exit `2`

#### Scenario: Apple rejection does not cancel GNU danger

- GIVEN `chmod --recursive 755 /` is rejected by the committed Apple profile and accepted-dangerous by the GNU profile
- WHEN the packaged hook evaluates it on any host
- THEN the Apple rejection does not weaken the union result
- AND the hook denies with exit `2`

### Requirement: Base64 profiles preserve decode and option-argument semantics

The GNU `base64` profile MUST recognize `-d`, boolean `-i`, bundles such as `-id`, argument-taking `-w`, full `--decode`, and every accepted decode abbreviation from `--d` through `--decode`. GNU default and GNU `POSIXLY_CORRECT` option-order behavior MUST be evaluated as separate union modes.

The Apple `base64` profile MUST recognize `-d`, `-D`, supported bundles, and the committed source-documented argument-taking `-b`, `-i`, and `-o` options, together with any other source-documented compatibility options admitted by the committed profile. Once an option consumes the remainder of a bundle or the following argv token as its argument, characters in that argument MUST NOT activate decode semantics. `--` MUST terminate option parsing in every profile that accepts it.

Decode semantics SHALL be dangerous only when decoded output feeds a real unquoted pipeline into exactly `sh`, `bash`, `zsh`, `dash`, or `ksh`.

#### Scenario: GNU bundled -id is decode

- GIVEN the Bash command `base64 -id payload | bash`
- WHEN the packaged hook evaluates it
- THEN GNU classifies `-i` as boolean and `-d` as decode within the bundle
- AND the real pipeline to `bash` is denied with exit `2`

#### Scenario: GNU separated -i does not consume -d

- GIVEN the Bash command `base64 -i -d payload | bash`
- WHEN the packaged hook evaluates it
- THEN GNU classifies `-i` as boolean and the following `-d` as decode
- AND the real pipeline to `bash` is denied with exit `2`

#### Scenario: Apple bundled -Di is decode with an input argument

- GIVEN the Bash command `base64 -Di input | bash`
- WHEN the packaged hook evaluates it
- THEN Apple classifies `-D` as decode and `-i` as consuming the input argument
- AND the real pipeline to `bash` is denied with exit `2`

#### Scenario: Every accepted base64 decode abbreviation is denied at shell sink

- GIVEN each Bash command in the inclusive committed corpus from `base64 --d payload | bash` through `base64 --decode payload | bash`
- WHEN the packaged hook evaluates each command
- THEN the GNU profile accepts each recorded unique decode abbreviation
- AND every command is denied with exit `2`

#### Scenario: GNU permutation after operand is denied

- GIVEN the Bash command `base64 payload -d | bash`
- WHEN the packaged hook evaluates it
- THEN GNU default classifies the later `-d` as decode even if another mode or profile does not
- AND the hook denies with exit `2`

#### Scenario: Apple option arguments containing d are benign

- GIVEN the Bash command `base64 -i input -o output -b 76 | bash`
- WHEN the packaged hook evaluates it
- THEN the Apple profile consumes `input`, `output`, and `76` as option arguments and finds no decode flag
- AND rejected-by-profile results elsewhere do not create decode semantics
- AND the hook returns no objection with silent exit `0`

#### Scenario: Base64 delimiter makes -d an operand

- GIVEN the Bash command `base64 -- -d | bash`
- WHEN the packaged hook evaluates it
- THEN `-d` is an operand after option termination rather than a decode flag
- AND the hook returns no objection with silent exit `0`

#### Scenario: Quoted base64 pipe is data

- GIVEN the Bash command `base64 -d payload '|' bash`
- WHEN the packaged hook evaluates it
- THEN the quoted `|` is data rather than a real pipeline operator
- AND the hook returns no objection with silent exit `0`

#### Scenario: Every supported downstream shell is protected

- GIVEN each shell name in `sh`, `bash`, `zsh`, `dash`, and `ksh`
- AND a supported `base64` invocation has accepted decode semantics and a real unquoted pipeline to that shell
- WHEN the packaged hook evaluates the command
- THEN it denies with exit `2`

#### Scenario: Unsupported downstream program is outside this sink

- GIVEN a supported decoded `base64` invocation feeds a real pipeline to a program outside `sh`, `bash`, `zsh`, `dash`, and `ksh`
- WHEN no other inherited deny rule matches
- THEN the base64-to-shell rule returns no objection with silent exit `0`

### Requirement: Literal utility identity is normalized without dynamic resolution

The evaluator MUST normalize the literal basename of a path-qualified command and apply the same supported profile as for the equivalent bare `env`, `chmod`, or `base64` name. It MUST perform literal basename normalization only; it MUST NOT resolve aliases, functions, command substitutions, variables, symlinks, `PATH`, multicall behavior, or dynamically constructed identities to claim an exact GNU or Apple profile.

An alias, function, BusyBox/custom implementation, or dynamic identity SHALL remain unsupported and SHALL be denied only when the bounded shell evidence places its uncertainty at a protected ambiguity sink. Otherwise it MUST receive no objection from this utility-profile policy.

#### Scenario: Path-qualified env has the same identity

- GIVEN the Bash command `/usr/bin/env -iS 'cat\_~/.ssh/id'`
- WHEN the packaged hook evaluates it
- THEN the literal basename normalizes to `env`
- AND the hook denies with exit `2`

#### Scenario: Path-qualified chmod has the same identity

- GIVEN the Bash command `/bin/chmod -R 755 /`
- WHEN the packaged hook evaluates it
- THEN the literal basename normalizes to `chmod`
- AND the hook denies with exit `2`

#### Scenario: Path-qualified base64 has the same identity

- GIVEN the Bash command `/usr/bin/base64 -id payload | bash`
- WHEN the packaged hook evaluates it
- THEN the literal basename normalizes to `base64`
- AND the hook denies with exit `2`

#### Scenario: Dynamic identity is not profiled by execution or lookup

- GIVEN a command identity is supplied by expansion, alias, function, symlink semantics, or `PATH` lookup rather than a literal bare or path-qualified basename
- WHEN the utility-profile policy evaluates it
- THEN it does not execute, inspect, or resolve that identity to select a profile
- AND only the contextual ambiguity rules may deny it

### Requirement: Diagnostics are stable, bounded, and non-sensitive

Every utility ambiguity denial MUST emit the stable reason-code category `utility-ambiguity` plus fixed utility, profile, and sink categories. Utility categories MUST be limited to `env`, `chmod`, `base64`, or `unsupported`; profile categories MUST be limited to committed profile identifiers or `unsupported`; sink categories MUST be limited to `wrapper-extraction`, `critical-chmod`, or `base64-to-shell`.

Diagnostics MUST NOT include the complete command, split string, option argument, operand, environment assignment, secret, credential, arbitrary path, stdin payload, host path, or host utility output. Dangerous non-ambiguity denials MUST retain the inherited bounded policy reason and MAY include only the same fixed categories. Identical classified input MUST produce the same diagnostic category independent of host state.

#### Scenario: Active expansion diagnostic does not leak assignment data

- GIVEN an `env -S` command contains active `${VARNAME}` and a secret-looking outer assignment
- WHEN the hook denies the wrapper-extraction ambiguity
- THEN stderr contains `utility-ambiguity` and fixed `env`, profile, and `wrapper-extraction` categories
- AND stderr contains neither the assignment value nor the complete command or split string

#### Scenario: Chmod ambiguity diagnostic does not leak paths

- GIVEN an ambiguous `chmod` invocation contains a sensitive or user-specific path
- WHEN the hook denies at the critical-chmod sink
- THEN stderr contains only the stable reason and fixed context categories within the inherited diagnostic bound
- AND it does not reproduce the path or option argument

#### Scenario: Allowed decision remains silent

- GIVEN any scenario in this specification expects no objection
- WHEN the packaged hook returns exit `0`
- THEN it writes no stdout and no stderr

### Requirement: Profile governance is versioned and deterministic

Every supported profile MUST have a committed identifier, utility and mode scope, versioned GNU or Apple documentation source, deterministic accepted/rejected option table, and deterministic conformance corpus. Each source-to-table rule MUST be reviewable without querying the execution host. The corpus MUST include unique long abbreviations, short-bundle argument consumption, option permutation, profile rejection, `--`, role preservation, and protected/benign end-to-end cases required by this specification.

A profile change MUST update the profile identifier or documented version binding, source citation, affected deterministic tables, regression corpus, and review evidence in the same review unit. Runtime host introspection, localized help parsing, utility execution, `process.platform`, `PATH`, and environment-dependent skipping MUST NOT define or alter policy authority.

#### Scenario: Profile drift requires an explicit reviewed update

- GIVEN newer GNU or Apple documentation adds or changes a policy-relevant option semantic
- WHEN maintainers update the supported profile
- THEN the version/documentation binding, deterministic table, affected corpus, and regression evidence change together
- AND the prior profile is not silently reinterpreted from the host utility

#### Scenario: Missing host utility cannot skip profile acceptance

- GIVEN the deterministic corpus runs on a host without GNU `env`, `chmod`, or `base64`
- WHEN acceptance evidence is evaluated
- THEN every committed profile case still has the same expected result
- AND no case is skipped or reclassified because the host binary is absent

#### Scenario: Localized help is not a grammar oracle

- GIVEN host utility help text differs by locale or version
- WHEN the packaged hook evaluates a command
- THEN it does not read that help text
- AND the committed tables and corpus remain the sole profile authority

### Requirement: Compatibility preserves inherited policy behavior

The redesign MUST preserve every prior safe corpus case except a case explicitly documented as protected-sink ambiguity under this specification. It MUST preserve every inherited parent denial, including all denial families already fixed before `69823570`. It MUST close the exact residual families in `JD-S1-FR3-001` and `JD-S1-FR3-002` without duplicating their IDs or declaring them closed.

For a fixed command string and committed profile set, exact decisions MUST be identical on Linux, macOS, and Windows and MUST be independent of `LANG`, `PATH`, host utility presence, and host utility version.

#### Scenario: Prior safe corpus remains safe

- GIVEN a prior safe fixture does not intersect wrapper-extraction ambiguity, critical-chmod ambiguity, or base64-to-shell ambiguity
- WHEN the exact packaged MJS evaluates it after the redesign
- THEN it remains silent and exits `0`

#### Scenario: Documented protected ambiguity may change prior behavior

- GIVEN a prior safe fixture relied on an unsupported form at one of the three protected sinks
- WHEN the exact packaged MJS evaluates it after the redesign
- THEN it may change only to bounded ambiguity denial with exit `2`
- AND the corpus identifies the protected sink and stable diagnostic category responsible

#### Scenario: Parent denials remain denied

- GIVEN any retained denied fixture from the parent exact-asset and spawned-process corpora
- WHEN the redesigned packaged MJS evaluates it
- THEN it still exits `2` with a bounded non-sensitive diagnostic

#### Scenario: Final-judge env bypass family is acceptance evidence

- GIVEN the inherited open finding `JD-S1-FR3-001`
- WHEN its bundled `env -iS` and active `${VARNAME}` probes are run against the exact packaged MJS
- THEN both probes exit `2`
- AND the finding remains open until fresh post-apply judgment verifies the evidence

#### Scenario: Final-judge chmod and base64 bypass family is acceptance evidence

- GIVEN the inherited open finding `JD-S1-FR3-002`
- WHEN its GNU chmod permutation, GNU `base64 -id`, and GNU `base64 -i -d` probes are run against the exact packaged MJS
- THEN every probe exits `2`
- AND the finding remains open until fresh post-apply judgment verifies the evidence

### Requirement: Packaged runtime and manifest identity remain exact

The shipped evaluator MUST remain one dependency-free MJS file that can be imported and executed with Node `>=22` using Node built-ins only. It MUST NOT require a sibling parser module, package dependency, javi-forge CLI, `npx`, network service, external utility, or runtime-generated profile.

The manifest MUST bind the exact MJS bytes with SHA-256. Any MJS byte drift without the corresponding exact manifest digest MUST fail integrity acceptance. Because parent identity `69823570` is unreleased, the redesign SHALL replace that unreleased asset identity rather than record it as a historical released identity. The product MUST NOT claim that npm, Linuxbrew, or existing project-local hooks already contain the redesigned bytes.

#### Scenario: Exact MJS runs without package dependencies

- GIVEN the packaged MJS and Node `>=22` are available while javi-forge, package dependencies, GNU utilities, and Apple utilities are unavailable
- WHEN a deterministic safe and denied fixture are passed to the MJS
- THEN the safe fixture exits `0` silently and the denied fixture exits `2`

#### Scenario: MJS byte drift breaks manifest binding

- GIVEN any byte of the packaged MJS differs from the bytes bound by the manifest SHA-256
- WHEN integrity acceptance compares the asset with the manifest
- THEN acceptance fails until the manifest binds the exact new digest

#### Scenario: Unreleased parent identity is replaced honestly

- GIVEN the parent runtime identity exists only in the unreleased chain at `69823570`
- WHEN the redesigned MJS and digest replace it
- THEN ownership metadata does not list the parent digest as a historical released version
- AND no artifact claims existing npm, Linuxbrew, or project-local consumers were automatically rewritten

### Requirement: Relationship and workflow guards remain fail-closed

This change MUST retain `amends: skillguard-pretooluse-hook` and `depends-on: skillguard-pretooluse-hook@69823570` exactly. It MUST start its review unit from `69823570`, target `feat/skillguard-pretooluse-hook-01-runtime`, and remain at or below 800 changed lines. If that cap cannot be defended, the workflow MUST request a split decision rather than omit required semantics or evidence.

`JD-S1-FR3-001` and `JD-S1-FR3-002` MUST remain open in the parent ledger until a fresh post-apply Judgment Day explicitly verifies them. The parent Slice 1 PR and Slice 2 MUST remain blocked until this child has implementation, verification, and clean Judgment Day evidence. Native status that ignores the Markdown ledger MUST NOT override these guards, and no actor SHALL fabricate `reviews/ledger.json` or any other native JSON artifact as authority.

#### Scenario: Native recommendation cannot override inherited open findings

- GIVEN native status recommends advancement while the parent Markdown ledger keeps `JD-S1-FR3-001` or `JD-S1-FR3-002` open
- WHEN workflow readiness is evaluated
- THEN the parent PR and Slice 2 remain blocked
- AND no native JSON authority is created to conceal the mismatch

#### Scenario: Specification does not close inherited findings

- GIVEN this specification cites the inherited findings as acceptance evidence
- WHEN this specification phase completes
- THEN neither finding is duplicated, reset, or changed from open by declaration
- AND the parent review ledger remains byte-for-byte unchanged

#### Scenario: Review budget breach requires a split decision

- GIVEN a defensible implementation and evidence forecast exceeds 800 changed lines from `69823570`
- WHEN delivery planning occurs
- THEN the workflow stops for the configured ask-always split decision
- AND it does not compress, remove, or defer a normative requirement to fit the cap

#### Scenario: Rollback preserves parent history

- GIVEN the child implementation must be rolled back
- WHEN rollback is performed
- THEN only this child is returned to exact parent commit `69823570`
- AND parent review attempts, ledger history, proposal, and artifacts are not rewritten

## Non-Requirements

The following are explicitly outside this change:

- Full GNU coreutils, Apple utility, BusyBox, Homebrew-prefixed utility, or custom utility emulation.
- Utility output, filesystem traversal, ACL behavior, encoding results, signal behavior, or complete diagnostics emulation.
- Evaluation of active `${VARNAME}` or reconstruction of the future shell environment.
- Alias, function, symlink-target, multicall, `PATH`, or dynamic executable identity resolution.
- A shell-AST replacement, general shell sandbox, general utility validator, or expansion of the inherited policy classes.
- New runtime dependencies, sibling runtime modules, host probes as policy authority, or execution of the user's utility.
- Installer, doctor, settings, ownership, Slice 2+, publishing, branch, commit, PR, issue, or parent-ledger changes.
- Automatic rewriting of global Linuxbrew/npm installations or existing project-local hook copies.

## Acceptance Probe Index

Every proposal-level bypass and benign near miss is bound to a scenario below. Expected `deny` means bounded stderr and exit `2`; expected `no objection` means silent exit `0`.

| Probe | Expected | Bound scenario |
|---|---:|---|
| `env -iS 'cat\_~/.ssh/id'` | deny | Bundled env -iS cannot hide a sensitive read |
| `env -vS 'cat\_~/.ssh/id'` | deny | Bundled env -vS cannot hide a sensitive read |
| `READER=cat env -S '${READER}\_~/.ssh/id'` | deny ambiguity | Active env expansion is denied without evaluation |
| `env --split-str='cat\_~/.ssh/id'` | deny | Accepted env long abbreviation cannot hide a sensitive read |
| `env -S 'cat\c' ~/.ssh/id` | deny | Env c escape preserves trailing argv |
| `env -S 'command -- cat\_~/.ssh/id'` | deny | Env wrapper reduction continues after split |
| env -S 'printf\_x\|bash' | no objection | Env split pipe is literal argv |
| `env -S 'printf\q'` | deny ambiguity | Unsupported env escape cannot bypass wrapper inspection |
| `/usr/bin/env -iS 'cat\_~/.ssh/id'` | deny | Path-qualified env has the same identity |
| `chmod 755 / --recursive` | deny | GNU recursive option after mode and target is denied |
| `chmod --reference=/tmp/ref / --recursive` | deny | GNU recursive option after reference form is denied |
| `chmod --rec 755 /` through `chmod --recursive 755 /` | deny each | Every accepted chmod recursive abbreviation is denied at root |
| `chmod -vR 755 /`; `chmod -Rv 755 /` | deny each | Chmod short-bundle order does not weaken recursion |
| `chmod -R --reference=/ /tmp/safe` | no objection | Reference root is not a target |
| `chmod 755 -- /` | no objection | Non-dangerous mode after delimiter is a benign near miss |
| `chmod 777 -- /` | deny | Mode 777 is dangerous without recursion |
| `/bin/chmod -R 755 /` | deny | Path-qualified chmod has the same identity |
| base64 -id payload \| bash | deny | GNU bundled -id is decode |
| base64 -i -d payload \| bash | deny | GNU separated -i does not consume -d |
| base64 -Di input \| bash | deny | Apple bundled -Di is decode with an input argument |
| base64 --d payload \| bash through `--decode` | deny each | Every accepted base64 decode abbreviation is denied at shell sink |
| base64 payload -d \| bash | deny | GNU permutation after operand is denied |
| base64 -i input -o output -b 76 \| bash | no objection | Apple option arguments containing d are benign |
| base64 -- -d \| bash | no objection | Base64 delimiter makes -d an operand |
| base64 -d payload '\|' bash | no objection | Quoted base64 pipe is data |
| /usr/bin/base64 -id payload \| bash | deny | Path-qualified base64 has the same identity |

## Traceability

### Proposal contract

| Proposal contract item | Requirements and scenarios |
|---|---|
| Decision: bounded profiles plus contextual ambiguity in a standalone MJS | Semantic results preserve policy-relevant parse evidence; Ambiguity denial is limited to protected sinks; Packaged runtime and manifest identity remain exact |
| `amends` and exact `depends-on` relationship | Relationship and workflow guards remain fail-closed |
| Child review unit, target branch, and 800-line cap | Relationship and workflow guards remain fail-closed / Review budget breach requires a split decision |
| Parent PR and Slice 2 remain blocked | Relationship and workflow guards remain fail-closed / Native recommendation cannot override inherited open findings |
| Product contract 1: contextual protected sinks | Ambiguity denial is limited to protected sinks |
| Product contract 2: host-independent GNU/Apple union | Profile union is host-independent and danger-dominant |
| Product contract 3: deny active `${VARNAME}` without evaluation | GNU env split-string semantics preserve wrapper extraction / Active env expansion is denied without evaluation |
| Product contract 4: GNU and Apple only | Profile union is host-independent and danger-dominant; Non-Requirements |
| Product contract 5: literal basenames only | Literal utility identity is normalized without dynamic resolution |
| Product contract 6: danger in any profile denies | Profile union is host-independent and danger-dominant / Dangerous profile dominates rejection |
| Product contract 7: unsupported outside sinks gets no objection | Ambiguity denial is limited to protected sinks |
| Product contract 8: GNU default plus `POSIXLY_CORRECT` | Profile union is host-independent and danger-dominant / GNU option permutation dominates POSIXLY_CORRECT |
| Product contract 9: stable non-sensitive ambiguity context | Diagnostics are stable, bounded, and non-sensitive |
| Product contract 10: profile update governance | Profile governance is versioned and deterministic |
| Product contract 11: preserve prior safe corpus | Compatibility preserves inherited policy behavior / Prior safe corpus remains safe |
| Success: `env -S` bundles, split semantics, expansion, paths | GNU env split-string semantics preserve wrapper extraction; Literal utility identity is normalized without dynamic resolution |
| Success: chmod/base64 roles and profile semantics | Chmod profiles preserve permutation and operand roles; Base64 profiles preserve decode and option-argument semantics |
| Success: union, modes, paths, and `--` are cross-host fixed | Semantic results preserve policy-relevant parse evidence; Profile union is host-independent and danger-dominant; Literal utility identity is normalized without dynamic resolution |
| Success: exact single-file MJS and SHA-256 | Packaged runtime and manifest identity remain exact |
| Success: inherited final-judge bypasses are acceptance evidence | Compatibility preserves inherited policy behavior / Final-judge env bypass family is acceptance evidence; Final-judge chmod and base64 bypass family is acceptance evidence |
| New/modified capability and installed-consumer impact | Purpose; Packaged runtime and manifest identity remain exact / Unreleased parent identity is replaced honestly |
| Non-goals | Non-Requirements |
| Risks and rollback | Compatibility preserves inherited policy behavior; Profile governance is versioned and deterministic; Relationship and workflow guards remain fail-closed / Rollback preserves parent history |
| Native status ignores Markdown ledger; no fabricated authority | Relationship and workflow guards remain fail-closed / Native recommendation cannot override inherited open findings |

### Inherited Judgment Day findings

| Inherited finding | Required closure evidence | Bound scenarios |
|---|---|---|
| `JD-S1-FR3-001` | GNU bundled `env -iS`, GNU split semantics, and active `${VARNAME}` no longer exit `0` for sensitive operations | Bundled env -iS cannot hide a sensitive read; Accepted env long abbreviation cannot hide a sensitive read; Env c escape preserves trailing argv; Active env expansion is denied without evaluation; Final-judge env bypass family is acceptance evidence |
| `JD-S1-FR3-002` | GNU chmod abbreviations/permutation, Apple `base64 -Di`, GNU `base64 -id`/`-i -d`, and option-argument near misses receive exact profile-union decisions | GNU recursive option after mode and target is denied; GNU recursive option after reference form is denied; Every accepted chmod recursive abbreviation is denied at root; GNU bundled -id is decode; GNU separated -i does not consume -d; Apple bundled -Di is decode with an input argument; Apple option arguments containing d are benign; Final-judge chmod and base64 bypass family is acceptance evidence |

The inherited findings remain open until fresh post-apply Judgment Day; this specification supplies acceptance obligations, not declarative closure.
