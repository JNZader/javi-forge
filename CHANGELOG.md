## [1.7.0](https://github.com/JNZader/javi-forge/compare/v1.6.0...v1.7.0) (2026-08-08)

### Features

* add Agent Teams parallel dispatch presets for team workflows ([8a8f339](https://github.com/JNZader/javi-forge/commit/8a8f339acb0c59030d307cbb898000b829b9e93b))
* add AI harness audit scoring and multi-agent detection ([ed36296](https://github.com/JNZader/javi-forge/commit/ed3629640f500b75f09f61c5fee2a76be55b708d))
* add Atlassian MCP pre-config for Jira/Confluence integration ([ef300b9](https://github.com/JNZader/javi-forge/commit/ef300b9e3a0f32cb967c077c52c74abe3b971637))
* add beads-style task tracking for scaffolded projects ([#36](https://github.com/JNZader/javi-forge/issues/36)) ([2083438](https://github.com/JNZader/javi-forge/commit/2083438b3bb4f26e0b021b45df916c0a3efb5230))
* add crash recovery from git commit history ([3c3212c](https://github.com/JNZader/javi-forge/commit/3c3212c63a120c616456f8e198a1c7b19752bbe6))
* add hash-based task IDs with hierarchical subtask support ([#35](https://github.com/JNZader/javi-forge/issues/35)) ([ec1ccfa](https://github.com/JNZader/javi-forge/commit/ec1ccfa13954e7f2933feb2395b92324ae57bdc1))
* add parallel batch sub-agent execution for quality scoring ([4eacee6](https://github.com/JNZader/javi-forge/commit/4eacee6a12299771c04276ac14a80d8de7288103))
* add secret regex scanner with 24-pattern credential detection bundle ([d8d5cd0](https://github.com/JNZader/javi-forge/commit/d8d5cd03dc0f4561aa28b55a57c9ca33005ad668))
* add supply chain protection with Socket Firewall and lockfile enforcement ([98181b4](https://github.com/JNZader/javi-forge/commit/98181b44d9c5fd5ee6fd7b6bca53eb4676c27c52))
* **agent-skills:** generate skills.json manifest during project init ([2ef0d8e](https://github.com/JNZader/javi-forge/commit/2ef0d8e4302948f1d681de8576fb57ba4aa5e37e))
* **ci-local:** add uninstall.sh and uninstall.ps1 (closes M4) ([cfc3f28](https://github.com/JNZader/javi-forge/commit/cfc3f28ef5bdba3685b3e7662a48054e836ad06c))
* **ci-local:** hook conflict warning + .git/hooks backup (closes M3+H1) ([32b0e3b](https://github.com/JNZader/javi-forge/commit/32b0e3b0d830ced9efd4b5c1ad84e53a51be648d))
* **ci-local:** log elapsed time in pre-commit and pre-push (closes M7) ([be99c41](https://github.com/JNZader/javi-forge/commit/be99c41fcb28ca244c57292d49edca5a58a8d154))
* **ci-local:** native Windows / PowerShell port ([32f41a0](https://github.com/JNZader/javi-forge/commit/32f41a04c25608f408df13d7aa6207e4bcf1c669))
* **ci:** add --config flag and document --stack override limits ([31eab87](https://github.com/JNZader/javi-forge/commit/31eab87b9165a028bbe1a1603c3f3041113356d0))
* **ci:** add versioned mixed-runner config schema and loader ([0406322](https://github.com/JNZader/javi-forge/commit/0406322fd811441e93103059dc69c1341eeb86df))
* **ci:** resolve CI runners once with config and --stack override ([0c39378](https://github.com/JNZader/javi-forge/commit/0c39378be50e0f994d03f9bd7f02e859c367c4a2))
* **ci:** thread resolved runner through docker and enforce required tools ([a1e896d](https://github.com/JNZader/javi-forge/commit/a1e896df7e14dac0e3cbb6298f4a1122a48fd547))
* **context:** improve .context/ with dependency detection and auto-refresh ([ea9e7e9](https://github.com/JNZader/javi-forge/commit/ea9e7e9a636470335c97f1e26abbe485dd1c9fa7))
* **deps:** upgrade ink 6.8 -> 7.0 and require Node 22+ ([7c11f28](https://github.com/JNZader/javi-forge/commit/7c11f28cb0b07b1e7bd3ee7bf301b833032e4557))
* **hook-profiles:** add hook reliability profile selection to project init ([f51a288](https://github.com/JNZader/javi-forge/commit/f51a288a69e37720ee5bb350f57ccf0fa3f158dc))
* **init:** add local AI stack template (Ollama + WebUI + n8n + Supabase) ([e174bf8](https://github.com/JNZader/javi-forge/commit/e174bf8ac4ffe12fa345de34f4aefba2ab875fc2))
* **init:** generate stack-aware CLAUDE.md with detected skills and patterns ([5a4bb56](https://github.com/JNZader/javi-forge/commit/5a4bb566d4098c4848deccc5007f8db7607e92c9))
* **init:** scaffold 6-layer security hooks and runtime AI guardrails ([747dab5](https://github.com/JNZader/javi-forge/commit/747dab517857c4f0effc7d3033cda8c01b0425b0))
* **init:** scaffold Docker zero-downtime deploy workflows ([3edb1a3](https://github.com/JNZader/javi-forge/commit/3edb1a32ab0676bf150a78eb9d8d70f4a6e3552d))
* **init:** scaffold repoforge graph config, CI workflow, and MCP config ([b374e63](https://github.com/JNZader/javi-forge/commit/b374e638c30725056ee22e996245eedf8d4273fc))
* **lib:** CI_LOCAL_STACK env override for stack detection (closes M2) ([7841f65](https://github.com/JNZader/javi-forge/commit/7841f6520460de33d82ceb08519258ab1e166514))
* **plugin:** add Agent Skills spec export (skills.json generation) ([b0f54bd](https://github.com/JNZader/javi-forge/commit/b0f54bdad6bf69a69f830758b8dbf6febea0c6d9))
* **plugin:** add auto-wiring for plugin sync ([478ee03](https://github.com/JNZader/javi-forge/commit/478ee03102ae58e56b0aaf935790ef2f0c81c6da))
* **security:** add CI-level skill security scanner for pre-install ([580c834](https://github.com/JNZader/javi-forge/commit/580c8344eded5d087fedfc6a8c06c67d53054cbb))
* **security:** add severity filtering, allowlist, and staleness detection ([05c0bc6](https://github.com/JNZader/javi-forge/commit/05c0bc6a436045e86ca17e7bdd31731e28796633))
* **security:** add Trail of Bits security analysis for CI pipeline ([abe91c9](https://github.com/JNZader/javi-forge/commit/abe91c9a259228a1648560b29aabb053d9c4eff8))
* **skills:** add auto-detect and install skills based on project stack ([e928aa0](https://github.com/JNZader/javi-forge/commit/e928aa08ab314ad21ae191eb6f2c818c7cb2a204))
* **skills:** add semantic conflict detection and budget optimization ([69dde78](https://github.com/JNZader/javi-forge/commit/69dde78b401dfbb47ede960f05e3fce0940bc692))
* **tdd:** add TDD pipeline enforcement hook with strict/warn modes ([b81c508](https://github.com/JNZader/javi-forge/commit/b81c508583c0417f175291bb4fd8dffe9a8a07be))
* **workflow:** add deterministic workflow graphs with DOT/Mermaid parsing ([8b72283](https://github.com/JNZader/javi-forge/commit/8b722838037e07719ed09eda8be562dc68ee2959))

### Bug Fixes

* **ci-local:** close C5 audit findings — symlink traversal, env-var FPs, NTFS ACL ([583cd22](https://github.com/JNZader/javi-forge/commit/583cd225109d11e0b1f0f897b4e8cbef740fc369)), closes [#Requires](https://github.com/JNZader/javi-forge/issues/Requires)
* **ci-local:** close real bypasses in commit-msg hook found by audit ([c1d7304](https://github.com/JNZader/javi-forge/commit/c1d7304dd7137945c8642e84e5ed1ace794827b1))
* **ci-local:** close round-4 hijacks — lib symlink, realpath fail-open, pwsh 7.2 ([b2271e8](https://github.com/JNZader/javi-forge/commit/b2271e8ef4f7f681518b6591e1f5046644460d17)), closes [#Requires](https://github.com/JNZader/javi-forge/issues/Requires) [#Requires](https://github.com/JNZader/javi-forge/issues/Requires)
* **ci-local:** close round-5 — alias shadow defense, TOCTOU source, dangling links ([8162279](https://github.com/JNZader/javi-forge/commit/816227926120f374ec2aef8866be2c748437dad5))
* **ci-local:** commit-msg fails closed, strips combining marks, honest docs ([e7ebe9a](https://github.com/JNZader/javi-forge/commit/e7ebe9a2609c18f03a6df23b24f7bcc99761d990))
* **ci-local:** correct hooksPath, add symlink resolution and writable-cache warnings ([17fafc7](https://github.com/JNZader/javi-forge/commit/17fafc7f63c3f2fa5dd8f0874002fdce8c8e9807))
* **ci-local:** harden commit-msg hook against AI attribution bypasses ([2d93f36](https://github.com/JNZader/javi-forge/commit/2d93f364e38acfa5d3bf1e9d0c76248b9c568a10))
* **ci-local:** harden install.sh, wire hook tests into CI, refresh docs ([1d61bcf](https://github.com/JNZader/javi-forge/commit/1d61bcf23a4eebdf903956c20125c1eeb53930ae))
* **ci-local:** require javi-forge CLI before installing hooks ([792f796](https://github.com/JNZader/javi-forge/commit/792f796578e93cda3a6c060e7597a744484da215))
* **ci:** audit before test, pack tarball for self-CI, honest manifest wording ([9bce60b](https://github.com/JNZader/javi-forge/commit/9bce60b23d2a1ed27167b2a21a395cddfe0275bd))
* **ci:** install ruff before pnpm test in Release and CI workflows ([9c06d1d](https://github.com/JNZader/javi-forge/commit/9c06d1d3e8b1d7f300183bb8811b0adf75b61b3a))
* **ci:** use /tmp vitest cacheDir so CI container can write config temp ([d21fe49](https://github.com/JNZader/javi-forge/commit/d21fe49cac658d959bbd2e70253154831b805ddc))
* close round-7 review findings — symlink + traversal + tighter tests ([97c5535](https://github.com/JNZader/javi-forge/commit/97c553598e15688d707a07ba198eb5d29e9932b5))
* **docker:** use --mount syntax to avoid colon-in-path hijack (closes F1) ([e00cca3](https://github.com/JNZader/javi-forge/commit/e00cca3034de05074577e035a29a5312807bae51))
* **forge:** add package content gate ([9cb2fd1](https://github.com/JNZader/javi-forge/commit/9cb2fd1285f8bd9fb2113f7b125c001e040e3c95))
* **forge:** restore TypeScript build ([9baa06d](https://github.com/JNZader/javi-forge/commit/9baa06db369b5019526aab60d2e23a7eddd221f1))
* **lint:** add biome config and fix noImplicitAnyLet errors across src ([248e1b2](https://github.com/JNZader/javi-forge/commit/248e1b2e8f883e83e4a85a81a83c1bc2008b9df2))
* reject symlink writes, distinguish ENOENT in audit mock, pin npm audit fixture (F2..F8) ([d8e6331](https://github.com/JNZader/javi-forge/commit/d8e63317d540e1a6f1f9aaa8ca53f99ecdaa7f6f))

### Refactoring

* bundle 3 cosmetic nits from post-M8 reviews ([cdc2f41](https://github.com/JNZader/javi-forge/commit/cdc2f4186ff8905b74999b1d8f23ee449a6e902d))
* **cli:** cleanup post-M8 — validators.ts + cast fixes + JSDocs ([4deb976](https://github.com/JNZader/javi-forge/commit/4deb976f23b31e9a9c15c258288ca28fa3830eed))
* **cli:** extract help text and runtime utilities to src/cli/ ([545161c](https://github.com/JNZader/javi-forge/commit/545161c4fc6bf0e87494b53e39a45bb6f2b1272d))
* **cli:** extract shared dispatch types to types.ts ([fda38cf](https://github.com/JNZader/javi-forge/commit/fda38cf88bde10823083b7b8d7965cba58963daa))
* **cli:** extract simple renderers + tdd + ci handlers to src/cli/dispatch/ ([dd569e4](https://github.com/JNZader/javi-forge/commit/dd569e4cada9d5e2f579cefd67966e5dacf34941))
* **cli:** extract skills-cmd handler to src/cli/dispatch/ ([2cefa67](https://github.com/JNZader/javi-forge/commit/2cefa678c256c0775d7fb98db798bc0e82a68e32))
* **cli:** extract workflow, security, skill-publish handlers to src/cli/dispatch/ ([4dddaf2](https://github.com/JNZader/javi-forge/commit/4dddaf2c2b14f8ff0deb9344ba2778d1574c0edf))
* **cli:** unify dispatch ctx type + declare mode flag in schema ([3d31481](https://github.com/JNZader/javi-forge/commit/3d31481c68baaeeaed31f156347da29a75076e19))
* eliminate all 48 any type occurrences across codebase ([b0332ef](https://github.com/JNZader/javi-forge/commit/b0332ef101c94419df041ea4ca0e8d6a5e9cfc2a))
* **init/test:** colocate tests per step ([358777c](https://github.com/JNZader/javi-forge/commit/358777cd848bd10fe5a0d005f7d1afe666632f37))
* **init:** cleanup post-M8 — stepId globalize + nits ([5812103](https://github.com/JNZader/javi-forge/commit/5812103261940a8f38bbcdc5b8ff660db6cd6966))
* **init:** extract agent-skills + manifest, prune facade — closes M8 split ([75da2ab](https://github.com/JNZader/javi-forge/commit/75da2ab9483d40b935578c88c95a4927227e2e48))
* **init:** extract ai-sync, sdd, ghagga, mock steps to src/commands/init/steps/ ([26e48c0](https://github.com/JNZader/javi-forge/commit/26e48c0613f6255f15df584430730e7475c6cc28))
* **init:** extract ci, gitignore, memory steps to src/commands/init/steps/ ([6296619](https://github.com/JNZader/javi-forge/commit/62966199fbb93859256285c74b9259f8c565c469))
* **init:** extract context-dir, claude-md, docker-deploy steps ([f0d9311](https://github.com/JNZader/javi-forge/commit/f0d93110edbbcd14016840f028077b9613b44638))
* **init:** extract git steps to src/commands/init/ + step-ordering test ([67ef12f](https://github.com/JNZader/javi-forge/commit/67ef12f28b1eed3889ad56755b2d3948405d5697))
* **init:** extract security, code-graph, local-ai steps ([d2a6283](https://github.com/JNZader/javi-forge/commit/d2a62839bcf2410742d1694d56393f5aa2840317))
* **init:** rename inner stepGitignore var to stepId for consistency ([b51f0d2](https://github.com/JNZader/javi-forge/commit/b51f0d2d3d0890b8e0634149711d95f7c994bf22))
* **lib:** extract execFileAsync to src/lib/exec.ts (single source of truth) ([15060d9](https://github.com/JNZader/javi-forge/commit/15060d9c6e0e521c039d13099caa9c3539a39dec))
* **skills/test:** colocate tests per CLAUDE.md lockstep convention ([bc06af5](https://github.com/JNZader/javi-forge/commit/bc06af5b7ed4fbbc5cfdfe2f827104cae9d2dfef))
* **skills:** cleanup post-M8 — rules.ts extract + safety + dedups ([b5e9d02](https://github.com/JNZader/javi-forge/commit/b5e9d02fe2739e8972336bf355a1154e3bc28ab7))
* **skills:** extract constants and directives to skills/ subdir ([30201e6](https://github.com/JNZader/javi-forge/commit/30201e6b82db61f364de4af7370f4b26863e8085))
* **skills:** extract parsing and analysis to skills/ subdir ([899a465](https://github.com/JNZader/javi-forge/commit/899a465afe5ab9c92b65941995e39b19fa74399d))
* **skills:** extract scoring and benchmark to skills/ subdir ([a4ea3ac](https://github.com/JNZader/javi-forge/commit/a4ea3aced727b4060a0524c2c6b3ed70d326d7dd))
* **skills:** tighten facade — drop unjustified constant re-exports ([56485cf](https://github.com/JNZader/javi-forge/commit/56485cf92dbfe436e3fbf341465b6cf26d3c97ec))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] — Unreleased

### Added

- **Mixed-stack CI** — `javi-forge ci` now supports hybrid repositories via
  `.javi-forge/ci.yaml`: ordered runners, each with stack, working directory,
  image or build-context, setup/lint/build/test/security commands, and
  fail-closed required-tool checks.
- **`--config <path>`** — load an explicit mixed-runner config file.
- **`--stack <stack>` override for `ci`** — force a single explicit stack
  (single-stack repos only; insufficient for hybrid repos).
- **Deterministic build-context images** — configure `build-context` with a
  directory containing a `Dockerfile`; javi-forge builds and caches it by
  content hash.
- **Digest-pinned images** — `image: name@sha256:...` references are passed
  through verbatim to Docker.

### Changed

- `runInContainer()` no longer re-detects the stack from filesystem markers.
  The resolved runner (stack/image/build-context) is passed through the full
  call chain, eliminating caller-vs-Docker disagreements.

### Fixed

- Missing required tools no longer become skipped or silently-successful
  checks; a missing tool aborts the run with an explicit error naming the
  runner, the tool, and the image/environment.

## [1.6.0] — 2026-03-31

### Added

- **`.context/` directory generation** — `init` now generates `.context/INDEX.md` and `.context/summary.md` with stack-aware project context for AI tools
- **`CLAUDE.md` generation** — `init` generates a project-level `CLAUDE.md` tailored to the detected stack, conventions, skills, and installed modules
- **`plugin sync` command** — auto-detect installed plugins and wire them into the forge manifest
- **`plugin export` command** — export plugins to Agent Skills spec format (`skills.json`)
- **`plugin export --codex`** — export plugins to Codex-compatible TOML subagent files
- **`plugin import` command** — import Agent Skills spec packages as javi-forge plugins
- **`security baseline` command** — create a security baseline from current audit findings (supports node, python, go, rust)
- **`security check` command** — detect regressions against baseline (exits non-zero if new vulnerabilities found)
- **`security update` command** — re-snapshot baseline to acknowledge current vulnerabilities
- **`tdd init` command** — install TDD-enforcing pre-commit hook that auto-detects stack and test command
- **`skills doctor` command** — health report for installed skills with token budget analysis
- **`skills doctor --deep`** — conflict detection (contradicting critical rules) and duplicate detection (overlapping triggers)
- **`skills budget` command** — show token cost of all loaded skills with budget threshold and suggestions
- **`skills score` command** — score a skill on 4 quality dimensions (completeness, clarity, testability, token efficiency)
- **`skills benchmark` command** — structural quality checks (frontmatter, triggers, rules, code examples, sections, vague terms)
- **`llms-txt` command** — generate AI-friendly `llms.txt` with compact project notation (~75% token reduction)
- **Mock-first mode** — `init --mock` generates `.env.example` and `.env` with mock values for local development
- **CI simulation** — `ci` command runs lint + compile + test + security + ghagga with Docker support
- **CI flags** — `--quick`, `--shell`, `--detect`, `--no-security`, `--timeout`
