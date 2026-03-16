# Architecture

## Project Structure

```mermaid
flowchart TB
    subgraph "javi-forge package"
        SRC["src/<br/>CLI + commands"]
        TPL["templates/<br/>CI workflows"]
        MOD["modules/<br/>Memory + review"]
        AIC["ai-config/<br/>Agents, skills, hooks"]
        WF["workflows/<br/>Reusable GH Actions"]
        SCH["schemas/<br/>JSON validation"]
        CIL["ci-local/<br/>Git hooks"]
    end

    SRC --> TPL
    SRC --> MOD
    SRC --> AIC
    SRC --> WF
    SRC --> SCH
    SRC --> CIL
```

## Init Flow

The `init` command orchestrates 10 sequential steps:

```mermaid
sequenceDiagram
    participant User
    participant Forge as javi-forge
    participant Git
    participant FS as File System
    participant AI as javi-ai

    User->>Forge: javi-forge init --stack node --ci github

    rect rgb(249, 115, 22, 0.1)
        Note over Forge,Git: Step 1-2: Git Setup
        Forge->>Git: git init
        Forge->>FS: Copy ci-local/hooks
        Forge->>Git: git config core.hooksPath ci-local/hooks
    end

    rect rgb(249, 115, 22, 0.1)
        Note over Forge,FS: Step 3-5: CI + Files
        Forge->>FS: Generate .github/workflows/ci.yml
        Forge->>FS: Copy .gitignore template
        Forge->>FS: Generate .github/dependabot.yml
    end

    rect rgb(249, 115, 22, 0.1)
        Note over Forge,AI: Step 6-7: Memory + AI
        Forge->>FS: Install memory module to .javi-forge/modules/
        Forge->>AI: npx javi-ai sync --target all
    end

    rect rgb(249, 115, 22, 0.1)
        Note over Forge,FS: Step 8-10: SDD + Review
        Forge->>FS: Create openspec/ directory
        Forge->>FS: Install GHAGGA (optional)
        Forge->>FS: Write .javi-forge/manifest.json
    end

    Forge-->>User: Project bootstrapped
```

## Template Selection

Templates are selected based on stack + CI provider combination:

```mermaid
flowchart TD
    STACK["Stack selection"] --> MAP{"Lookup STACK_CI_MAP"}

    MAP --> GH["templates/github/<br/>ci-{stack}.yml"]
    MAP --> GL["templates/gitlab/<br/>gitlab-ci-{stack}.yml"]
    MAP --> WP["templates/woodpecker/<br/>woodpecker-{stack}.yml"]

    GH --> DEST_GH[".github/workflows/ci.yml"]
    GL --> DEST_GL[".gitlab-ci.yml"]
    WP --> DEST_WP[".woodpecker.yml"]

    STACK --> DEP{"Lookup STACK_DEPENDABOT_MAP"}
    DEP --> FRAG["templates/common/dependabot/"]
    FRAG --> DEST_DEP[".github/dependabot.yml"]
```

## Module Installation

Memory modules are copied from `modules/` to the project's `.javi-forge/modules/`:

```mermaid
flowchart LR
    subgraph "javi-forge/modules/"
        ENG["engram/"]
        OBS["obsidian-brain/"]
        SIM["memory-simple/"]
        GHA["ghagga/"]
    end

    subgraph "project/.javi-forge/modules/"
        P_ENG["engram/"]
        P_GHA["ghagga/"]
    end

    ENG --> P_ENG
    GHA --> P_GHA
```

## Manifest

The forge manifest at `.javi-forge/manifest.json` tracks project configuration:

```json
{
  "version": "0.1.0",
  "projectName": "my-app",
  "stack": "node",
  "ciProvider": "github",
  "memory": "engram",
  "createdAt": "2025-01-15T10:30:00.000Z",
  "updatedAt": "2025-01-15T10:30:00.000Z",
  "modules": ["engram", "ghagga", "sdd", "ai-config"]
}
```

## Ecosystem Integration

```mermaid
flowchart TB
    subgraph "User Workflow"
        DOTS["npx javi-dots<br/>(workstation setup)"]
        FORGE["npx javi-forge init<br/>(project scaffold)"]
    end

    subgraph "Core Engine"
        AI["javi-ai<br/>(skills + configs)"]
    end

    subgraph "External"
        ATL["agent-teams-lite"]
        ENG["engram"]
        GHA["ghagga"]
        RF["repoforge"]
    end

    DOTS -->|"installs"| AI
    DOTS -->|"installs"| ATL
    DOTS -->|"installs"| ENG
    FORGE -->|"calls sync"| AI
    FORGE -->|"analyze"| RF
    FORGE -.->|"optional"| GHA

    style DOTS fill:#06b6d4,color:#fff
    style AI fill:#f97316,color:#fff
    style FORGE fill:#f97316,color:#fff
```

## Tech Stack

| Component | Technology |
|-----------|------------|
| CLI framework | [meow](https://github.com/sindresorhus/meow) |
| TUI rendering | [Ink](https://github.com/vadimdemedes/ink) (React for CLI) |
| File operations | [fs-extra](https://github.com/jprichardson/node-fs-extra) |
| YAML parsing | [yaml](https://github.com/eemeli/yaml) |
| Language | TypeScript (strict) |
| Runtime | Node.js 18+ |
| Testing | Vitest + Stryker mutation testing |
