# AI Config

`javi-forge` ships with a comprehensive AI configuration library in `ai-config/`. This gets synced into your project during `init` via `javi-ai sync`.

## Inventory

| Category | Count | Location |
|----------|-------|----------|
| **Agents** | 8 groups | `ai-config/agents/` |
| **Skills** | 84 skills | `ai-config/skills/` |
| **Commands** | 20 commands | `ai-config/commands/` |
| **Hooks** | 11 hooks | `ai-config/hooks/` |
| **Prompts** | System prompts | `ai-config/prompts/` |

## Agents

Agent definitions organized by domain. Each agent has a name, description, and specialized instructions.

The 8 agent groups cover:

- Backend development
- Frontend development
- Infrastructure and DevOps
- Database and data
- Testing and quality
- Documentation
- Workflow automation
- Systems and IoT

## Skills

84 skills organized by domain, covering the full development lifecycle:

```mermaid
flowchart TB
    subgraph "ai-config/skills/"
        BE["backend/<br/>REST, GraphQL, gRPC,<br/>auth, search, BFF"]
        FE["frontend/<br/>React, Astro, Mantine,<br/>state, validation"]
        INF["infrastructure/<br/>Docker, K8s, CI/CD,<br/>observability"]
        DB["database/<br/>Redis, SQLite, TimescaleDB,<br/>graph, pgx"]
        DA["data-ai/<br/>LangChain, PyTorch, MLflow,<br/>vector DB, analytics"]
        MO["mobile/<br/>Ionic, React Native"]
        SY["systems-iot/<br/>Rust, Tokio, Modbus, MQTT"]
        WF["workflow/<br/>Git, wave, IDE plugins"]
        DO["docs/<br/>Technical writing,<br/>API docs, templates"]
    end

    style BE fill:#f97316,color:#fff
    style FE fill:#f97316,color:#fff
    style INF fill:#f97316,color:#fff
    style DB fill:#f97316,color:#fff
    style DA fill:#f97316,color:#fff
    style MO fill:#f97316,color:#fff
    style SY fill:#f97316,color:#fff
    style WF fill:#f97316,color:#fff
    style DO fill:#f97316,color:#fff
```

## Commands

20 slash-command definitions for Claude Code. These are copied to `project/.claude/commands/` during sync.

Commands include SDD workflow commands (`/sdd:new`, `/sdd:apply`, etc.) and utility commands.

## Hooks

11 pre/post tool-use hooks for automation:

- Auto-formatting after file edits
- Type checking on save
- Test runner triggers
- Protection hooks for sensitive files

## .skillignore

The `ai-config/.skillignore` file controls which skills are excluded from sync:

```
# Exclude a skill from all CLIs
skill-name

# Exclude only from a specific CLI
opencode:skill-name
```

## How Sync Works

During `javi-forge init`, the AI config is synced via `javi-ai`:

```mermaid
sequenceDiagram
    participant Forge as javi-forge
    participant AI as javi-ai sync
    participant Config as .ai-config/
    participant Output as Project root

    Forge->>AI: npx javi-ai sync --target all
    AI->>Config: Read agents/ and skills/
    AI->>Config: Apply .skillignore
    AI->>Output: Generate CLAUDE.md
    AI->>Output: Generate AGENTS.md
    AI->>Output: Generate GEMINI.md
    AI->>Output: Generate CODEX.md
    AI->>Output: Generate .github/copilot-instructions.md
    AI->>Output: Copy commands/ to .claude/commands/
    AI-->>Forge: Sync complete
```

## AUTO_INVOKE.md

The `ai-config/AUTO_INVOKE.md` file contains instructions that are automatically included in generated config files, providing base-level instructions for all AI coding assistants.

## config.yaml

The `ai-config/config.yaml` controls sync behavior: which skills to include, agent ordering, and provider-specific overrides.
