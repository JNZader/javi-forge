# javi-forge

> **Project scaffolding for the Javi ecosystem.** Generate production-ready CI pipelines, GitHub Actions workflows, and AI code review automation for any stack — in seconds.

---

## What is javi-forge?

`javi-forge` is the scaffolding engine of the Javi ecosystem. It provides:

- **7 stack-specific templates** — Node.js, Go, Java, Python, generic API, fullstack, and MkDocs docs
- **3 generators** — project init, CI bootstrap, and review automation
- **AI integration** — optional project-facing AI packages from `javi-ai` for any generated repo

Everything is delivered via `scripts/forge-init.sh`, a contract-based CLI entrypoint. Consumers reference templates and generators by stable published IDs — never by internal directory paths.

---

## Ecosystem Role

```mermaid
graph TB
    subgraph DOTS["javi-dots · Orchestrator"]
        JS["scripts/javi.sh\n--template-choice\n--generator-choice"]
    end

    subgraph FORGE["javi-forge · Scaffolding"]
        FI["scripts/forge-init.sh\n(contract entrypoint)"]
        TMPL["7 Templates\nweb · api-base · api-go\napi-java · api-python\nfullstack · docs"]
        GEN["3 Generators\nproject.init\nci.bootstrap\nreview.automation"]
    end

    subgraph AI["javi-ai · AI Layer"]
        PROJ["4 Project Packages\nai.instructions · sdd.base\nmemory.engram · ai.review"]
    end

    subgraph OUT["Generated Project"]
        GH[".github/workflows/\nci.yml\ndependabot-automerge.yml"]
        CI[".ci-local/\nci-local.sh · hooks/"]
        AIFILES["CLAUDE.md · agents/\nhooks/ · memory/"]
    end

    JS -->|forge contracts| FI
    FI --> TMPL & GEN
    TMPL & GEN -->|optional AI request| PROJ
    TMPL --> GH & CI
    GEN --> GH
    PROJ --> AIFILES
```

---

## Template and Generator Flow

```mermaid
flowchart LR
    CLI(["scripts/forge-init.sh\n--template / --generator\n--project-name --destination"])

    CLI --> TV["Validate\nrequest"]

    TV --> TP{"Template?"}
    TP -->|"template.web.base"| TW["Node.js CI\ntest + build"]
    TP -->|"template.api.base"| TA["Generic API\nlang-agnostic CI"]
    TP -->|"template.api.go"| TG["Go\ngolangci-lint + go test"]
    TP -->|"template.api.java"| TJ["Java / Spring Boot\nSpotless + Gradle"]
    TP -->|"template.api.python"| TPY["Python / FastAPI\nruff + pytest"]
    TP -->|"template.fullstack.base"| TFS["Frontend + Backend\nparallel CI jobs"]
    TP -->|"template.docs.base"| TD["MkDocs\nbuild strict + Pages"]

    TV --> GP{"Generator?"}
    GP -->|"generator.review.automation\n--mode github-action"| GRA["ghagga.yml\nGitHub Action (free)"]
    GP -->|"generator.review.automation\n--mode self-hosted"| GRS["ghagga-selfhosted.yml\nwebhook trigger stub"]
    GP -->|"generator.ci.bootstrap"| GCI[".ci-local/\nCI family only"]

    TW & TA & TG & TJ & TPY & TFS & TD --> OUT[("Generated Project\n.github/ · .ci-local/\nlib/ · .gitignore")]
    GRA & GRS & GCI --> OUT
```

---

## Quick Links

- [Getting Started](/getting-started) — standalone and via javi-dots
- [Templates](/templates) — all 7 templates with generated output examples
- [Generators](/generators) — project.init, ci.bootstrap, review.automation
- [AI Integration](/ai-integration) — optional AI packages for generated projects
