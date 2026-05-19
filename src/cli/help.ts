/**
 * CLI metadata: help text and meow flags schema.
 *
 * Pure data module — no runtime imports. Consumed by `src/index.tsx`
 * when constructing the `meow` parser.
 */

export const HELP_TEXT = `
  Usage
    $ javi-forge [command] [options]

  Commands
    init              Bootstrap a new project (default)
    ci                Run CI simulation (lint + compile + test + security + ghagga)
    tdd init          Install TDD-enforcing pre-commit hook (auto-detects stack)
    tdd pipeline      Install TDD pipeline pre-push hook (--mode strict|warn)
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
    --no-docker     Run commands natively (no Docker)
    --no-ci-ghagga  Skip GHAGGA review
    --no-security   Skip Semgrep security scan
    --timeout N     Per-step timeout in seconds (default: 600)

  CI hooks (javi-forge ci init)
    Install git hooks that call javi-forge ci.
    No files copied — hooks reference the global CLI.

  Examples
    $ javi-forge
    $ javi-forge init --dry-run
    $ javi-forge init --stack node --ci github
    $ javi-forge ci
    $ javi-forge ci init
    $ javi-forge tdd init
    $ javi-forge ci --quick
    $ javi-forge ci --no-ci-ghagga --no-security
    $ javi-forge ci --no-docker
    $ javi-forge ci --shell
    $ javi-forge analyze
    $ javi-forge doctor
    $ javi-forge plugin add mapbox/agent-skills
    $ javi-forge plugin list
`;

export const FLAGS_SCHEMA = {
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
	docker: { type: "boolean", default: true },
	ciGhagga: { type: "boolean", default: true },
	security: { type: "boolean", default: true },
	timeout: { type: "number", default: 600 },
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
} as const;
