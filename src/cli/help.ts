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
    ai providers export-free  Generate portable Pi/OpenCode free-provider bundles
    ai providers convert  Convert provider metadata between Pi and OpenCode
    ai providers smoke-test  Probe Pi/OpenCode provider/model routes and write JSONL evidence
    ai providers apply-scope  Apply smoke-test pass scope to Pi/OpenCode config
    preparation template   Write an operator-owned preparation config template
    preparation outputs-template  Write an operator-owned outputs JSON template
    preparation policy    Print the fixed preparation policy and output names
    preparation digest    Compute a bounded SHA-256 digest for operator pins
    preparation preflight  Read-only production preparation preflight
    preparation bind       Compute a read-only production preparation binding
    preparation approval-message  Prepare the exact approval message to sign
    preparation approval-check  Verify approval evidence without consuming it
    preparation approval-revoke  Revoke approval evidence without executing
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
    pi providers export-free  Generate an exportable Pi free-provider bundle (no secrets)
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
    --refresh-context  Refresh .context/ during doctor (writes INDEX.md, summary.md, manifest timestamp)
    --deep          Enable deep analysis (conflict + duplicate detection)
    --budget, -b    Token budget limit for skills (default: 8000)
    --skills-dir    Custom skills directory path
    --author        Author name for skill publish
    --repo          Repository URL for skill publish
    --target        Provider bundle target (pi, opencode, both)
    --provider      Provider id filter for provider smoke tests
    --runtime       Provider smoke-test runtime (pi, opencode)
                    For OpenCode, omit --config to discover active \`opencode models\`
    --family        Provider/model/name substring filter for provider smoke tests
    --model         Model id substring filter for provider smoke tests
    --status        Retest only models with this status from --report
    --report PATH   Previous provider smoke-test JSONL report for --status retests
    --limit N       Maximum provider smoke-test routes to run
    --include-local Include local providers such as Ollama in provider smoke tests
    --env-file PATH Load machine-local provider keys for provider smoke tests
    --pi-command    Pi executable for provider smoke tests (default: pi)
    --opencode-command OpenCode executable for provider smoke tests (default: opencode)
    --opencode-agent OpenCode agent for smoke tests (default: title)
    --smoke-cwd PATH Working directory for provider smoke commands
    --pass-list PATH Provider smoke-test .pass.tsv input for apply-scope
    --pi-settings PATH Pi settings.json path for apply-scope
    --opencode-config PATH OpenCode opencode.json path for apply-scope
    --json          Emit JSON for commands that support structured output
    --version       Show version
    --help          Show this help

  CI options (javi-forge ci)
    --quick         Lint + compile only (fast, for pre-commit)
    --github-parity Run the locally reproducible subset of GitHub test-job steps
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

  Preparation options (javi-forge preparation)
    --output PATH   Write a preparation config/outputs template to this path
    --file PATH     File to hash for preparation digest
    --config PATH   Production preparation config JSON
    --outputs PATH  Production preparation outputs JSON for binding computation
    --binding HEX   Production preparation binding for approval-message
    --approval PATH Production preparation approval evidence JSON for approval-check/revoke
    --nonce HEX     Optional 32-byte hex approval nonce (generated if omitted)
    --issued-at MS  Optional approval issued-at epoch milliseconds
    --expires-at MS Optional approval expiry epoch milliseconds
    --force         Overwrite an existing preparation template output
    --json          Emit the bounded preflight result as JSON

  SkillGuard install gate (plugin add / plugin import / skills auto)
    Every install is scanned before anything is written. Refusals are
    fail-closed and name the offending files:
    - SKILL.md files that block (critical threats) are refused — always.
    - Unscannable files (binary, oversized, unreadable) are refused unless
      --force is given.
    - Symlinks anywhere in the tree and SKILL.md files outside the declared
      set are manifest-integrity refusals — they are refused even with --force.
    - Empty or missing skills.json \`skills\` array on import is refused.
    A refused install/auto-install exits non-zero (exit 1) so scripts and CI
    can tell a refusal apart from success; clean installs — including
    --force-lifted unscannable ones — exit 0.

  Examples
    $ javi-forge
    $ javi-forge init --dry-run
    $ javi-forge init --stack node --ci github
    $ javi-forge ci
    $ javi-forge ci init
    $ javi-forge ci init --force
    $ javi-forge plugin add org/repo
    $ javi-forge plugin add org/repo --force
    $ javi-forge tdd init
    $ javi-forge ci --quick
    $ javi-forge ci --github-parity
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
    $ javi-forge ai providers export-free --target both
    $ javi-forge ai providers convert pi opencode /tmp/pi-to-opencode --config ~/.pi/agent/models.json
    $ javi-forge ai providers smoke-test /tmp/pi-smoke --provider openrouter-free --env-file ~/.config/javi-forge/secrets/providers.env
    $ javi-forge ai providers smoke-test /tmp/opencode-smoke --runtime opencode --provider google --env-file ~/.config/javi-forge/secrets/providers.env
    $ javi-forge ai providers smoke-test /tmp/pi-smoke --family deepseek --limit 5
    $ javi-forge ai providers smoke-test /tmp/pi-smoke --status failed --report /tmp/previous-smoke.jsonl
    $ javi-forge ai providers apply-scope /tmp/pi-smoke/smoke.pass.tsv --target pi --dry-run
    $ javi-forge ai providers apply-scope /tmp/pi-smoke/smoke.jsonl --target both
    $ javi-forge pi providers export-free
    $ javi-forge pi providers export-free /tmp/pi-free-providers
    $ javi-forge preparation template --output preparation.config.example.json
    $ javi-forge preparation outputs-template --output preparation.outputs.example.json
    $ javi-forge preparation policy --json
    $ javi-forge preparation digest --file /usr/bin/bwrap --json
    $ javi-forge preparation preflight --config preparation.config.json --json
    $ javi-forge preparation bind --config preparation.config.json --outputs preparation.outputs.json --json
    $ javi-forge preparation approval-message --binding <hex> --json
    $ javi-forge preparation approval-check --config preparation.config.json --binding <hex> --approval preparation.approval.json --json
    $ javi-forge preparation approval-revoke --config preparation.config.json --binding <hex> --approval preparation.approval.json --json
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
    --github-parity Run the locally reproducible subset of GitHub test-job steps
                    (hosted runtime matrix and global-install self-CI remain follow-ups)
    --no-docker     Run commands natively (no Docker)
    --no-security   Skip Semgrep security scan
    --no-ci-ghagga  Skip GHAGGA review
    --force         (ci init) Overwrite a foreign or modified hook (backs up first)
    --config PATH   Load ordered CI runners from a versioned config file
                    (default discovery: .javi-forge/ci.yaml)
    --stack STACK   Force a single explicit stack (single-stack repos only)
    --timeout N     Per-command timeout in seconds (default: 600)
    --json          Emit config/gate-run JSON (not supported with --github-parity)
    --help          Show this help

  Examples
    $ javi-forge ci
    $ javi-forge ci --quick
    $ javi-forge ci --github-parity
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
    $ javi-forge hooks <install|doctor|repair> <claude|codex|opencode|grok|cursor> [--force]

    Run the sections enabled under hooks: in .javi-forge/ci.yaml, in a fixed
    cheap→expensive order, fail-fast. With no hooks: config the default is the
    quick native CI gate (setup + lint + compile + gates — no tests, no coverage).

  Subcommands
    run pre-commit    Run the composed pre-commit sections
    run pre-push      Run the composed pre-push sections
    install claude    Install the managed Claude PreToolUse guard (.claude/)
    doctor claude     Report Claude PreToolUse guard health (informational)
    repair claude     Repair the managed guard; --force overwrites edited assets
    install codex     Install the managed Codex PreToolUse guard (~/.codex/)
    doctor codex      Report Codex hook execution readiness and trust boundary
    repair codex      Repair the managed Codex guard; --force overwrites edits
    install opencode  Install the managed OpenCode global plugin (~/.config/opencode/plugins/)
    doctor opencode   Report OpenCode plugin file currency and inconclusive runtime evidence
    repair opencode   Repair the OpenCode plugin pair; --force overwrites edits
    install grok      Install the Grok Build global PreToolUse hook (~/.grok/hooks/)
    doctor grok       Report Grok hook file currency and inconclusive runtime evidence
    repair grok       Repair the Grok hook pair; --force overwrites edits
    install cursor    Install the Cursor global preToolUse hook (~/.cursor/)
    doctor cursor     Report Cursor hook file currency and inconclusive runtime evidence
    repair cursor     Repair the Cursor hook pair; --force overwrites edits

  Notes
    A blocking section failure exits non-zero and blocks the commit/push.
    A broken .javi-forge/ci.yaml exits 1 (fail-closed — never skips a gate).
    To skip: git commit --no-verify   (pre-push: git push --no-verify)
    doctor claude is informational (always exits 0); install/repair exit 0 on
    success, non-zero on refusal/failure. Use repair claude --force to overwrite
    a locally edited managed asset.
    doctor codex exits 0 when runnable, 1 when blocked, and 2 when inconclusive;
    it does not prove provider trust or runtime execution. Use repair codex
    --force only to overwrite an edited managed asset.
    doctor opencode inspects installed files only and exits 2/inconclusive
    because it cannot prove OpenCode discovered, loaded, or executed the plugin.
    doctor grok inspects installed files only and exits 2/inconclusive because
    it cannot prove Grok discovered, loaded, or executed the hook.
    doctor cursor inspects installed files only and exits 2/inconclusive because
    it cannot prove Cursor discovered, loaded, or executed the hook.
    Linux: install/repair claude, grok, and cursor need the acl package (getfacl) to
    prove the parent chain — apt install acl / apk add acl / dnf install acl.
    Without it
    they refuse fail-closed; an already-installed guard keeps firing, and
    doctor claude reports the acl capability as its own row.
    Claude Code spawns the guard with node from ITS path, so node must resolve
    there, not only inside javi-forge.

  Examples
    $ javi-forge hooks run pre-commit
    $ javi-forge hooks run pre-push
    $ javi-forge hooks install claude
    $ javi-forge hooks doctor claude
    $ javi-forge hooks repair claude --force
    $ javi-forge hooks install codex
    $ javi-forge hooks doctor codex
    $ javi-forge hooks repair codex --force
    $ javi-forge hooks install opencode
    $ javi-forge hooks doctor opencode
    $ javi-forge hooks repair opencode --force
    $ javi-forge hooks install grok
    $ javi-forge hooks doctor grok
    $ javi-forge hooks repair grok --force
    $ javi-forge hooks install cursor
    $ javi-forge hooks doctor cursor
    $ javi-forge hooks repair cursor --force
`;

export const FLAGS_SCHEMA = {
	// `--help` is handled manually (autoHelp is disabled at the entrypoint so
	// `ci --help` can show ci-specific usage instead of the global banner).
	help: { type: "boolean", shortFlag: "h", default: false },
	dryRun: { type: "boolean", default: false },
	refreshContext: { type: "boolean", default: false },
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
	githubParity: { type: "boolean", default: false },
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
	target: { type: "string", default: "" },
	runtime: { type: "string", default: "" },
	provider: { type: "string", default: "" },
	family: { type: "string", default: "" },
	model: { type: "string", default: "" },
	status: { type: "string", default: "" },
	report: { type: "string", default: "" },
	limit: { type: "number", default: 0 },
	includeLocal: { type: "boolean", default: false },
	envFile: { type: "string", default: "" },
	piCommand: { type: "string", default: "" },
	opencodeCommand: { type: "string", default: "" },
	opencodeAgent: { type: "string", default: "" },
	smokeCwd: { type: "string", default: "" },
	prompt: { type: "string", default: "" },
	passList: { type: "string", default: "" },
	piSettings: { type: "string", default: "" },
	opencodeConfig: { type: "string", default: "" },
	file: { type: "string", default: "" },
	outputs: { type: "string", default: "" },
	approval: { type: "string", default: "" },
	binding: { type: "string", default: "" },
	nonce: { type: "string", default: "" },
	issuedAt: { type: "number", default: 0 },
	expiresAt: { type: "number", default: 0 },
	// Workflow flags
	template: { type: "string", default: "" },
	output: { type: "string", default: "" },
	// TDD flags
	mode: { type: "string", default: "strict" },
} as const;
