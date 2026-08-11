/**
 * CLI metadata: help text and meow flags schema.
 *
 * Pure data module — no runtime imports. Consumed by `src/index.tsx`
 * when constructing the `meow` parser.
 */

/**
 * Help banner shown by meow when `--help` is passed or invalid args are supplied.
 * Multi-line template literal — preserve exact formatting (whitespace is significant).
 */
export const HELP_TEXT = `
  Usage
    $ javi-forge [command] [options]

  Commands
    init              Bootstrap a new project (default)
    ci                Run CI simulation (lint + compile + test + security + ghagga)
    ci validate       Validate .javi-forge/ci.yaml without running anything
    ci init           Install git hooks that call javi-forge ci
    tdd init          Enable the TDD pre-commit section + install managed hooks
    tdd pipeline      Enable the TDD pre-push section (--mode strict|warn)
    hooks run         Run a git hook's composed sections (pre-commit | pre-push)
    analyze           Run repoforge skills analysis
    doctor            Show health report
    workflow show     Render a workflow graph as ASCII (--template <name> or file path)
    workflow validate Validate project state against a workflow graph
    workflow list     List available workflows and built-in templates
    plugin add        Install a plugin from GitHub (org/repo)
    plugin remove     Remove an installed plugin
    plugin list       List installed plugins
    plugin search     Search the plugin registry
    plugin validate   Validate a local plugin directory
    plugin sync       Auto-detect and wire installed plugins
    plugin export     Export plugin to Agent Skills spec format (skills.json)
    plugin export     --codex: Export plugin to Codex-compatible TOML subagent files
    plugin export-skills  Generate aggregated skills.json from all installed plugins
    plugin export-skills global  Generate global skills.json from all globally installed plugins
    plugin import     Import an Agent Skills spec package as a javi-forge plugin
    skills doctor     Show skills health report (add --deep for conflict detection)
    skills budget     Show token cost of loaded skills (add -b N for custom budget)
    skills score      Score a skill on quality dimensions (completeness, clarity, testability, token-efficiency)
    skills benchmark  Benchmark a skill with structural quality checks
    skills auto       Auto-detect project stack and suggest/install matching AI skills
    skills auto-install  Alias for skills auto
    skill publish     Package a skill directory for marketplace distribution (generates plugin.json)
    security baseline   Create security baseline from current audit findings
    security check      Check for regressions against baseline (exits non-zero if found)
    security update     Re-snapshot baseline (acknowledge current vulns)
    security allowlist  Add all current findings to the allowlist (suppress in future checks)
    llms-txt          Generate AI-friendly llms.txt for current project

  Options
    --dry-run       Preview changes without writing files
    --stack         Project stack (node, python, go, rust, java-gradle, java-maven, elixir)
    --ci            CI provider (github, gitlab, woodpecker)
    --memory        Memory module (engram, obsidian-brain, memory-simple, none)
    --project-name  Project name (skips name prompt)
    --ghagga        Enable GHAGGA review system
    --mock          Enable mock-first mode (no real API keys needed)
    --local-ai      Include local AI dev stack (Ollama + Docker Compose)
    --batch         Non-interactive mode (auto-proceed, no keyboard input)
    --deep          Enable deep analysis (conflict + duplicate detection)
    --budget, -b    Token budget limit for skills (default: 8000)
    --skills-dir    Custom skills directory path
    --author        Author name for skill publish
    --repo          Repository URL for skill publish
    --version       Show version
    --help          Show this help

  CI options (javi-forge ci)
    --quick         Lint + compile only (fast, for pre-commit)
    --shell         Open interactive shell in CI container
    --detect        Show detected stack and exit
    --config PATH   Load ordered CI runners from a versioned config file
                    (default discovery: .javi-forge/ci.yaml)
    --stack STACK   Force a single explicit stack (single-stack repos only —
                    insufficient for hybrid repos; use --config instead)
    --no-docker     Run commands natively (no Docker)
    --no-ci-ghagga  Skip GHAGGA review
    --no-security   Skip Semgrep security scan
    --timeout N     Per-step timeout in seconds (default: 600)

  CI hooks (javi-forge ci init)
    Install git hooks that call javi-forge ci.
    No files copied — hooks reference the global CLI.
    Existing hooks javi-forge did not write are refused, never clobbered.
    --force         Overwrite a foreign or locally modified hook. The previous
                    content is copied to a .bak sibling first; if that backup
                    cannot be written, the hook is left untouched. Symlinked
                    hook paths are refused even with --force.

  Examples
    $ javi-forge
    $ javi-forge init --dry-run
    $ javi-forge init --stack node --ci github
    $ javi-forge ci
    $ javi-forge ci init
    $ javi-forge ci init --force
    $ javi-forge tdd init
    $ javi-forge ci --quick
    $ javi-forge ci --no-ci-ghagga --no-security
    $ javi-forge ci --no-docker
    $ javi-forge ci --shell
    $ javi-forge ci --config .javi-forge/ci.yaml
    $ javi-forge ci validate
    $ javi-forge ci --help
    $ javi-forge analyze
    $ javi-forge doctor
    $ javi-forge plugin add mapbox/agent-skills
    $ javi-forge plugin list
`;

/**
 * Per-command help for `ci`, shown by `javi-forge ci --help` (or when `ci` is
 * given an unknown subcommand). Kept consistent with the global HELP_TEXT
 * layout — whitespace is significant.
 */
export const CI_HELP_TEXT = `
  Usage
    $ javi-forge ci [subcommand] [options]

    Run a local CI simulation (lint + compile + test + security + ghagga).
    With no subcommand, the full pipeline runs.

  Subcommands
    init            Install git hooks that call javi-forge ci
    validate        Validate .javi-forge/ci.yaml without running anything

  Options
    --quick         Lint + compile only (fast, for pre-commit)
    --no-docker     Run commands natively (no Docker)
    --no-security   Skip Semgrep security scan
    --no-ci-ghagga  Skip GHAGGA review
    --force         (ci init) Overwrite a foreign or modified hook (backs up first)
    --config PATH   Load ordered CI runners from a versioned config file
                    (default discovery: .javi-forge/ci.yaml)
    --stack STACK   Force a single explicit stack (single-stack repos only)
    --json          (ci validate) Emit the result as JSON
    --help          Show this help

  Examples
    $ javi-forge ci
    $ javi-forge ci --quick
    $ javi-forge ci validate
    $ javi-forge ci validate --json
    $ javi-forge ci init --force
`;

/**
 * Per-command help for `hooks`, shown by `javi-forge hooks --help` (or when
 * `hooks` is given an unknown subcommand). Whitespace is significant.
 */
export const HOOKS_HELP_TEXT = `
  Usage
    $ javi-forge hooks run <pre-commit|pre-push>

    Run the sections enabled under hooks: in .javi-forge/ci.yaml, in a fixed
    cheap→expensive order, fail-fast. With no hooks: config the default is the
    quick native CI gate (setup + lint + compile + gates — no tests, no coverage).

  Subcommands
    run pre-commit  Run the composed pre-commit sections
    run pre-push    Run the composed pre-push sections

  Notes
    A blocking section failure exits non-zero and blocks the commit/push.
    A broken .javi-forge/ci.yaml exits 1 (fail-closed — never skips a gate).
    To skip: git commit --no-verify   (pre-push: git push --no-verify)

  Examples
    $ javi-forge hooks run pre-commit
    $ javi-forge hooks run pre-push
`;

export const FLAGS_SCHEMA = {
	// `--help` is handled manually (autoHelp is disabled at the entrypoint so
	// `ci --help` can show ci-specific usage instead of the global banner).
	help: { type: "boolean", shortFlag: "h", default: false },
	dryRun: { type: "boolean", default: false },
	stack: { type: "string", default: "" },
	ci: { type: "string", default: "" },
	memory: { type: "string", default: "" },
	projectName: { type: "string", default: "" },
	ghagga: { type: "boolean", default: false },
	mock: { type: "boolean", default: false },
	localAi: { type: "boolean", default: false },
	batch: { type: "boolean", default: false },
	// CI flags
	quick: { type: "boolean", default: false },
	shell: { type: "boolean", default: false },
	detect: { type: "boolean", default: false },
	config: { type: "string", default: "" },
	docker: { type: "boolean", default: true },
	ciGhagga: { type: "boolean", default: true },
	security: { type: "boolean", default: true },
	timeout: { type: "number", default: 600 },
	// ci init: overwrite a foreign / locally modified hook (backs it up first)
	force: { type: "boolean", default: false },
	// Security check flags
	minSeverity: { type: "string", default: "low" },
	staleDays: { type: "number", default: 30 },
	json: { type: "boolean", default: false },
	// Plugin flags
	codex: { type: "boolean", default: false },
	// Skills flags
	deep: { type: "boolean", default: false },
	budget: { type: "number", shortFlag: "b", default: 8000 },
	skillsDir: { type: "string", default: "" },
	// Skill publish flags
	author: { type: "string", default: "" },
	repo: { type: "string", default: "" },
	// Workflow flags
	template: { type: "string", default: "" },
	// TDD flags
	mode: { type: "string", default: "strict" },
} as const;
