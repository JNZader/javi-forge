# javi-forge

Project scaffolding and AI-ready CI bootstrap tool.

**javi-forge** generates production-ready project structures with CI/CD pipelines, AI agent configurations, and developer tooling — all from a single command.

## Directory Structure

```
javi-forge/
├── README.md              # This file
├── .gitignore             # Standard ignores
├── package.json           # Package metadata and scripts
├── templates/             # CI/CD pipeline templates
│   ├── github/            # GitHub Actions workflows
│   ├── gitlab/            # GitLab CI pipelines
│   ├── woodpecker/        # Woodpecker CI pipelines
│   ├── common/            # Shared config (dependabot fragments)
│   └── global/            # AI tool configs (Claude, Copilot, Gemini, etc.)
├── workflows/             # Reusable GitHub Actions workflows
├── modules/               # Optional integration modules
│   ├── engram/            # Persistent memory via Engram MCP
│   ├── obsidian-brain/    # Obsidian-based project memory
│   ├── ghagga/            # Multi-agent code review system
│   └── memory-simple/     # Minimal file-based project memory
├── ai-config/             # AI agent and skill library
│   ├── agents/            # Agent definitions (by domain)
│   ├── skills/            # Skill definitions (by domain)
│   ├── commands/          # Slash-command definitions
│   ├── hooks/             # Pre/post tool-use hooks
│   └── prompts/           # System prompts and modes
├── schemas/               # JSON schemas for validation
├── tasks/                 # Task templates
└── src/                   # CLI source code
```

## Quick Start

```bash
npx javi-forge init my-project --stack node --ci github
```

## License

MIT
