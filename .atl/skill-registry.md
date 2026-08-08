# Skill Registry — javi-forge

**Generated**: 2026-08-08 by `sdd-init`
**Project root**: `/home/javier/programacion/platform/javi-forge`
**Purpose**: index of runtime instruction contracts available to SDD phase agents. This file is an INDEX, not a summary — sub-agents receive the exact `SKILL.md` path and read the full source of truth themselves.

## How to use

1. Match your task against the trigger text in the index below.
2. Read the exact `SKILL.md` path listed. Do not paraphrase from this table.
3. Multiple skills may apply simultaneously (e.g. `typescript` + `react-19`).

## Scan result

| Scope | Directory | Skills indexed |
|---|---|---|
| user | `~/.claude/skills` | 55 |
| user | `~/.codex/skills` | 8 |
| user | `~/.agents/skills` | 9 |
| user | `~/.copilot/skills` | 1 |
| project | (none found) | 0 |

Directories scanned that contributed **zero** unique entries:

- `~/.config/opencode/skills` — 22 real (non-symlink) skill directories, but every name already exists in `~/.claude/skills` or `~/.codex/skills`, so all 22 were deduplicated away. These are independent copies, not symlinks; if a skill is edited in `~/.claude/skills` the opencode copy will drift.
- `~/.qwen/skills` — exists, empty.

Absent entirely: `~/.pi/agent/skills`, `~/.config/agents/skills`, `~/.kimi/skills`, `~/.config/kilo/skills`, `~/.gemini/skills`, `~/.gemini/antigravity/skills`, `~/.cursor/skills`, `~/.codeium/windsurf/skills`, `~/.kiro/skills`, `~/.openclaw/skills`.

Note on `~/.agents/skills`: every entry there is a **symlink** into `~/.gentleman/skills/{curated,community}/`. The paths in the index below are the symlink paths and resolve correctly for reading; the canonical source lives under `~/.gentleman/skills/`.

Project-level skill directories checked and NOT present: `skills/`, `.opencode/skills/`, `.claude/skills/`, `.gemini/skills/`, `.cursor/skills/`, `.github/skills/`, `.codex/skills/`, `.qwen/skills/`, `.kiro/skills/`, `.openclaw/skills/`, `.pi/skills/`, `.agent/skills/`, `.agents/skills/`, `.atl/skills/`.

Excluded by convention: `sdd-*`, `_shared`, `skill-registry`. Deduplicated by skill name; project scope would win over user scope, but no project skills exist.

## Retired — do NOT load

Per `~/.claude/CLAUDE.md`, these are indexed for completeness only and MUST NOT be loaded: `branch-pr`, `github-pr`, `issue-creation`. All three impose an upstream `status:approved` issue gate that does not exist in this repo, and all three are GitHub-only. Use `forge-pr` instead (it detects the forge from `git remote get-url origin`).

## Most likely relevant for javi-forge

| Task shape | Skill |
|---|---|
| Any TypeScript work in `src/` | `typescript` |
| Ink/React TUI components in `src/cli/dispatch/*.tsx`, `src/ui/` | `react-19` |
| Writing or restructuring vitest tests | (no vitest skill; follow `openspec/config.yaml` `apply.guidelines`) |
| Splitting an oversized change | `chained-pr`, `work-unit-commits` |
| Opening the PR | `forge-pr` |
| Scoping impact of a change to `src/commands/ci.ts` | `blast-radius` |
| Adversarial review after design/apply | `judgment-day` |
| Verifying a claim before asserting it | `claim-verification`, `evidence-grading` |

## Index

| Skill | Trigger / description | Path | Scope |
|---|---|---|---|
| `agent-governance` | Declarative agent capability model with privilege rings, kill switches, and behavioral anomaly detection. Trigger: When configuring agent permissions, setting up safety guardrails, discussing agent trust, or user ment... | `/home/javier/.claude/skills/agent-governance/SKILL.md` | user:~/.claude/skills |
| `agent-testing` | Testing pyramid for AI agents — unit tests for prompts, scenario tests for workflows, and evaluation suites for quality. Trigger: When testing AI agents, validating prompt changes, evaluating LLM output quality, or bu... | `/home/javier/.claude/skills/agent-testing/SKILL.md` | user:~/.claude/skills |
| `ai-sdk-5` | Vercel AI SDK 5 patterns. Trigger: When building AI chat features - breaking changes from v4. | `/home/javier/.claude/skills/ai-sdk-5/SKILL.md` | user:~/.claude/skills |
| `auto-continuation` | Recursive agent spawning with context preservation for tasks that exceed a single context window. Trigger: When a task is too large for one context, generating long documents, multi-file implementations, or user asks ... | `/home/javier/.claude/skills/auto-continuation/SKILL.md` | user:~/.claude/skills |
| `blast-radius` | Dependency graph analysis that identifies only affected files for any change, reducing token usage by up to 49x. Trigger: When reviewing code, planning changes, scoping impact, or user asks about blast radius, affecte... | `/home/javier/.claude/skills/blast-radius/SKILL.md` | user:~/.claude/skills |
| `branch-pr` | Create Gentle AI pull requests with issue-first checks. Trigger: creating, opening, or preparing PRs for review. | `/home/javier/.codex/skills/branch-pr/SKILL.md` | user:~/.codex/skills |
| `chained-pr` | Trigger: PRs over 400 lines, stacked PRs, review slices. Split oversized changes into chained PRs that protect review focus. | `/home/javier/.claude/skills/chained-pr/SKILL.md` | user:~/.claude/skills |
| `claim-verification` | Commercial claim-verification lens. Extracts every factual capability claim from public or sales-facing material (landing copy, deck, proposal, README feature list, client-facing roadmap, in-app UI copy) and classifie... | `/home/javier/.claude/skills/claim-verification/SKILL.md` | user:~/.claude/skills |
| `codebase-cartography` | Auto-generate codebase maps for AI context — file trees, dependency graphs, topologically ordered chapters, and architectural overviews. Trigger: When starting work on unfamiliar codebase, onboarding, or when AI needs... | `/home/javier/.claude/skills/codebase-cartography/SKILL.md` | user:~/.claude/skills |
| `cognitive-doc-design` | Design docs that reduce cognitive load. Trigger: writing guides, READMEs, RFCs, onboarding, architecture, or review-facing docs. | `/home/javier/.claude/skills/cognitive-doc-design/SKILL.md` | user:~/.claude/skills |
| `comment-writer` | Write warm, direct collaboration comments. Trigger: PR feedback, issue replies, reviews, Slack messages, or GitHub comments. | `/home/javier/.claude/skills/comment-writer/SKILL.md` | user:~/.claude/skills |
| `complexity-router` | Classifies task complexity (Small/Medium/Large) and routes to specialized agents with fresh context per phase. Trigger: When receiving a new task, feature request, or bug report that needs complexity assessment before... | `/home/javier/.claude/skills/complexity-router/SKILL.md` | user:~/.claude/skills |
| `context7-mcp` | This skill should be used when the user asks about libraries, frameworks, API references, or needs code examples. Activates for setup questions, code generation involving libraries, or mentions of specific frameworks ... | `/home/javier/.claude/skills/context7-mcp/SKILL.md` | user:~/.claude/skills |
| `cost-tracking` | AI token usage and cost tracking patterns — per-session monitoring, budget alerts, model cost comparison, and optimization. Trigger: When tracking AI costs, setting usage budgets, comparing model costs, or optimizing ... | `/home/javier/.claude/skills/cost-tracking/SKILL.md` | user:~/.claude/skills |
| `debug-mode` | Hypothesis-driven debugging with tagged instrumentation, isolated logs, and automated cleanup. Trigger: When debugging, investigating bugs, user says "debug", "why is this failing", or encounters unexpected behavior. | `/home/javier/.claude/skills/debug-mode/SKILL.md` | user:~/.claude/skills |
| `django-drf` | Django REST Framework patterns. Trigger: When building REST APIs with Django - ViewSets, Serializers, Filters. | `/home/javier/.claude/skills/django-drf/SKILL.md` | user:~/.claude/skills |
| `electron` | Electron patterns for building cross-platform desktop applications. Trigger: When building desktop apps, working with Electron main/renderer processes, IPC communication, or native integrations. | `/home/javier/.agents/skills/electron/SKILL.md` | user:~/.agents/skills |
| `elixir-antipatterns` | Core catalog of 8 critical Elixir/Phoenix anti-patterns covering error handling, separation of concerns, Ecto queries, and testing. Trigger: During Elixir code review, refactoring sessions, or when writing Phoenix/Ect... | `/home/javier/.agents/skills/elixir-antipatterns/SKILL.md` | user:~/.agents/skills |
| `embedding-strategies` | Embedding model selection, optimization, and evaluation for search and RAG systems. Trigger: When choosing embedding models, optimizing embedding pipelines, or evaluating retrieval quality. | `/home/javier/.claude/skills/embedding-strategies/SKILL.md` | user:~/.claude/skills |
| `evidence-grading` | A four-grade vocabulary that forces a claim to declare HOW it is known — `executed` (ran it, with cmd/exit/cwd), `read` (cited at path:line), `inferred` (derived from a named anchor), `assumed` (not verified). Ships a... | `/home/javier/.claude/skills/evidence-grading/SKILL.md` | user:~/.claude/skills |
| `findings-store` | Compaction-survivable findings-store for the review lenses. Persists lens findings to disk (JSONL) anchored on path:line so the fix agent reads them by session slug instead of the conversation. Fallback ONLY for the `... | `/home/javier/.claude/skills/findings-store/SKILL.md` | user:~/.claude/skills |
| `forge-pr` | Forge-detecting POLICY layer for opening a PR/MR on GitHub (`gh`) or GitLab (`glab`): auto-merge and hot-path rules, conditional issue linking, and the evidence-first body contract. Delegates GitLab mechanics to GitLa... | `/home/javier/.claude/skills/forge-pr/SKILL.md` | user:~/.claude/skills |
| `github-pr` | Create high-quality Pull Requests with conventional commits and proper descriptions. Trigger: When creating PRs, writing PR descriptions, or using gh CLI for pull requests. | `/home/javier/.agents/skills/github-pr/SKILL.md` | user:~/.agents/skills |
| `go-testing` | Trigger: Go tests, go test coverage, Bubbletea teatest, golden files. Apply focused Go testing patterns. | `/home/javier/.claude/skills/go-testing/SKILL.md` | user:~/.claude/skills |
| `hexagonal-architecture-layers-java` | Hexagonal architecture layering for Java services with strict boundaries. Trigger: When structuring Java apps by Domain/Application/Infrastructure, or refactoring toward clean architecture. | `/home/javier/.agents/skills/hexagonal-architecture-layers-java/SKILL.md` | user:~/.agents/skills |
| `issue-creation` | Create Gentle AI issues with issue-first checks. Trigger: creating GitHub issues, bug reports, or feature requests. | `/home/javier/.codex/skills/issue-creation/SKILL.md` | user:~/.codex/skills |
| `java-21` | Java 21 language and runtime patterns for modern, safe code. Trigger: When writing Java 21 code using records, sealed types, or virtual threads. | `/home/javier/.agents/skills/java-21/SKILL.md` | user:~/.agents/skills |
| `jira-epic` | Creates Jira epics for large features following a structured format. Trigger: When user asks to create an epic, large feature, or multi-task initiative. | `/home/javier/.agents/skills/jira-epic/SKILL.md` | user:~/.agents/skills |
| `jira-task` | Creates Jira tasks following a structured format with configurable project settings. Trigger: When user asks to create a Jira task, ticket, or issue. | `/home/javier/.agents/skills/jira-task/SKILL.md` | user:~/.agents/skills |
| `judgment-day` | Trigger: judgment day, dual review, adversarial review, juzgar. Run blind dual review, fix confirmed issues, then re-judge. | `/home/javier/.claude/skills/judgment-day/SKILL.md` | user:~/.claude/skills |
| `knowledge-guard` | Knowledge-drift guard. Anchors a knowledge unit — an engram topic, a document versioned in the repo, or both — to code globs in a versioned repo manifest, and emits ONE mechanical signal: the code under this anchor ch... | `/home/javier/.claude/skills/knowledge-guard/SKILL.md` | user:~/.claude/skills |
| `llm-evaluation` | Comprehensive LLM evaluation framework with automated metrics, LLM-as-Judge, and RAG evaluation. Trigger: When evaluating LLM outputs, building eval pipelines, comparing models, or measuring RAG quality. | `/home/javier/.claude/skills/llm-evaluation/SKILL.md` | user:~/.claude/skills |
| `mantine-combobox` | Build custom dropdown/select/autocomplete/multiselect components using Mantine's Combobox primitives. Use this skill when: (1) creating a new custom select-like component with Combobox primitives, (2) building a searc... | `/home/javier/.codex/skills/mantine-combobox/SKILL.md` | user:~/.codex/skills |
| `mantine-custom-components` | Build custom components that integrate with Mantine's theming, Styles API, and core features. Use this skill when: (1) creating a new component using factory(), polymorphicFactory(), or genericFactory(), (2) adding St... | `/home/javier/.codex/skills/mantine-custom-components/SKILL.md` | user:~/.codex/skills |
| `mantine-form` | Build forms using @mantine/form in the mantine-9 repository. Use this skill when: (1) setting up a form with useForm, (2) adding validation rules or async validation, (3) working with nested object or array fields, (4... | `/home/javier/.codex/skills/mantine-form/SKILL.md` | user:~/.codex/skills |
| `maplibre-mapbox-migration` | Migrating from Mapbox GL JS to MapLibre GL JS — package and import changes, removing the access token, choosing tile sources, plugin equivalents, and what you gain or give up. Use when moving an existing Mapbox map to... | `/home/javier/.codex/skills/maplibre-mapbox-migration/SKILL.md` | user:~/.codex/skills |
| `maplibre-pmtiles-patterns` | Serverless vector and raster tiles with PMTiles for MapLibre GL JS — single-file format, HTTP range requests, hosting on S3/R2/GitHub Pages, generating with Planetiler or tippecanoe, and the pmtiles protocol. Use when... | `/home/javier/.codex/skills/maplibre-pmtiles-patterns/SKILL.md` | user:~/.codex/skills |
| `maplibre-tile-sources` | How to choose and configure data sources for MapLibre GL JS — rendering your own data without tiles, hosted tile services, serverless PMTiles, self-hosted tile servers, tile schemas, glyphs, and sprites. | `/home/javier/.codex/skills/maplibre-tile-sources/SKILL.md` | user:~/.codex/skills |
| `multi-round-synthesis` | Multi-round agent orchestration — coordinator delegates to specialists, synthesizes, and iterates until the answer is complete. Trigger: When orchestrating multiple agents, implementing group chat patterns, or buildin... | `/home/javier/.claude/skills/multi-round-synthesis/SKILL.md` | user:~/.claude/skills |
| `nextjs-15` | Next.js 15 App Router patterns. Trigger: When working with Next.js - routing, Server Actions, data fetching. | `/home/javier/.claude/skills/nextjs-15/SKILL.md` | user:~/.claude/skills |
| `obsidian-braindump` | Quick capture of thoughts and decisions into Obsidian vault. Trigger: When user says braindump, capture thought, quick note, record idea, or wants to dump unstructured thoughts. | `/home/javier/.claude/skills/obsidian-braindump/SKILL.md` | user:~/.claude/skills |
| `obsidian-consolidation` | Periodic synthesis of scattered notes into frameworks and insights. Trigger: When user says consolidate, weekly synthesis, knowledge review, or wants to summarize recent notes. | `/home/javier/.claude/skills/obsidian-consolidation/SKILL.md` | user:~/.claude/skills |
| `obsidian-resource-capture` | Capture URLs and resources with auto-extracted insights into Obsidian vault. Trigger: When user says capture resource, save link, bookmark, or shares a URL to save with notes. | `/home/javier/.claude/skills/obsidian-resource-capture/SKILL.md` | user:~/.claude/skills |
| `plan-pact` | Cross-agent negotiation protocol for planning documents with Decision Register, Decision Log, and dispute tracking. Trigger: When multiple agents collaborate on planning, when planning docs need formal tracking, or wh... | `/home/javier/.claude/skills/plan-pact/SKILL.md` | user:~/.claude/skills |
| `playbooks` | Executable markdown playbooks for AI agents — checkbox task documents, batch processing, and repeatable workflows. Trigger: When creating task documents for AI execution, running batch workflows, or building repeatabl... | `/home/javier/.claude/skills/playbooks/SKILL.md` | user:~/.claude/skills |
| `playwright` | Playwright E2E testing patterns. Trigger: When writing E2E tests - Page Objects, selectors, MCP workflow. | `/home/javier/.claude/skills/playwright/SKILL.md` | user:~/.claude/skills |
| `portfolio-design-standards` | Design system for Javier's portfolio (portfolio-2025) — exact Tailwind 4 oklch tokens, the restrained "ingeniero, no salesy" register, and the token-driven light/dark discipline. Read BEFORE building or editing any po... | `/home/javier/.claude/skills/portfolio-design-standards/SKILL.md` | user:~/.claude/skills |
| `pr-review` | Review GitHub PRs and Issues with structured analysis for open source projects. Trigger: When user wants to review PRs (even if first asking what's open), analyze issues, or audit PR/issue backlog. Key phrases: "pr re... | `/home/javier/.claude/skills/pr-review/SKILL.md` | user:~/.claude/skills |
| `project-memory` | Auto-generates CLAUDE.md capturing project knowledge, flags irreversible decisions (one-way-door), and generates LESSONS.md retrospectives. Trigger: When onboarding to a project, after major changes, user says "genera... | `/home/javier/.claude/skills/project-memory/SKILL.md` | user:~/.claude/skills |
| `prompt-engineering` | Advanced prompt engineering patterns for production LLM applications. Trigger: When designing prompts, system messages, structured output, or optimizing token usage. | `/home/javier/.claude/skills/prompt-engineering/SKILL.md` | user:~/.claude/skills |
| `prompt-improver` | Improves vague prompts before execution using a 4-phase Analyze→Research→Question→Execute flow. Trigger: vague prompt, unclear request, improve prompt, clarify, enhance prompt | `/home/javier/.copilot/skills/prompt-improver/SKILL.md` | user:~/.copilot/skills |
| `pytest` | Pytest testing patterns for Python. Trigger: When writing Python tests - fixtures, mocking, markers. | `/home/javier/.claude/skills/pytest/SKILL.md` | user:~/.claude/skills |
| `rag-advanced` | Advanced RAG patterns beyond basic retrieval — HyDE, reranking, hybrid search, and production strategies. Trigger: When building production RAG pipelines, improving retrieval quality, or evaluating RAG systems. | `/home/javier/.claude/skills/rag-advanced/SKILL.md` | user:~/.claude/skills |
| `react-19` | React 19 patterns with React Compiler. Trigger: When writing React components - no useMemo/useCallback needed. | `/home/javier/.claude/skills/react-19/SKILL.md` | user:~/.claude/skills |
| `react-native` | React Native patterns for mobile app development with Expo and bare workflow. Trigger: When building mobile apps, working with React Native components, using Expo, React Navigation, or NativeWind. | `/home/javier/.agents/skills/react-native/SKILL.md` | user:~/.agents/skills |
| `reverse-engineer` | Auto-generates PRD and Design Docs from existing code, then verifies them against the codebase. Trigger: When onboarding to an existing codebase, user says "reverse engineer", "understand this code", "generate docs fr... | `/home/javier/.claude/skills/reverse-engineer/SKILL.md` | user:~/.claude/skills |
| `session-memory` | Session memory patterns and toolset profiles for AI coding assistants — persistent context, /remember commands, and mode-based tool access. Trigger: When managing AI context across sessions, implementing /remember pat... | `/home/javier/.claude/skills/session-memory/SKILL.md` | user:~/.claude/skills |
| `shared-tree-lock` | OPT-IN — lease-based advisory file locks + append-only events.jsonl for coordinating MULTIPLE writer sub-agents that run on the SAME git working tree (not isolated worktrees). Prevents the shared-tree writer collision... | `/home/javier/.claude/skills/shared-tree-lock/SKILL.md` | user:~/.claude/skills |
| `skill-creator` | Trigger: new skills, agent instructions, documenting AI usage patterns. Create LLM-first skills with valid frontmatter. | `/home/javier/.claude/skills/skill-creator/SKILL.md` | user:~/.claude/skills |
| `skill-eval` | Pre-registered evaluation contracts for deciding whether a skill stays in the catalog. Borrows clinical-trial pre-registration: the primary metric, the PLACEBO arm, the off-target set, the calibration band and the ver... | `/home/javier/.claude/skills/skill-eval/SKILL.md` | user:~/.claude/skills |
| `skill-improver` | Trigger: improve skills, audit skills, refactor skills, skill quality. Audit and upgrade existing LLM-first skills. | `/home/javier/.claude/skills/skill-improver/SKILL.md` | user:~/.claude/skills |
| `skillguard` | Security scanner for AI agent skills — detects credential theft, code injection, data exfiltration, and scope escape before installation. Trigger: When installing skills, reviewing skill files, user mentions skill sec... | `/home/javier/.claude/skills/skillguard/SKILL.md` | user:~/.claude/skills |
| `spring-boot-3` | Spring Boot 3 patterns for configuration, DI, and web services. Trigger: When building or refactoring Spring Boot 3 applications. | `/home/javier/.agents/skills/spring-boot-3/SKILL.md` | user:~/.agents/skills |
| `tailwind-4` | Tailwind CSS 4 patterns and best practices. Trigger: When styling with Tailwind - cn(), theme variables, no var() in className. | `/home/javier/.claude/skills/tailwind-4/SKILL.md` | user:~/.claude/skills |
| `token-compression` | 5-layer token compression engine that reduces AI context costs by 70-97%. Trigger: When context is too large, token budget is exceeded, session is long, or user asks to compress/optimize context. | `/home/javier/.claude/skills/token-compression/SKILL.md` | user:~/.claude/skills |
| `typescript` | TypeScript strict patterns and best practices. Trigger: When writing TypeScript code - types, interfaces, generics. | `/home/javier/.claude/skills/typescript/SKILL.md` | user:~/.claude/skills |
| `vector-index-tuning` | Vector index optimization — HNSW tuning, quantization, and performance monitoring for production search. Trigger: When tuning vector database performance, choosing index types, or optimizing search latency and recall. | `/home/javier/.claude/skills/vector-index-tuning/SKILL.md` | user:~/.claude/skills |
| `vercel-react-best-practices` | React and Next.js performance optimization guidelines from Vercel Engineering. This skill should be used when writing, reviewing, or refactoring React/Next.js code to ensure optimal performance patterns. Triggers on t... | `/home/javier/.claude/skills/vercel-react-best-practices/SKILL.md` | user:~/.claude/skills |
| `work-packet` | The bounded contract for delegating work to a subagent: objective, allowed paths, explicit forbidden paths, allowlisted commands, objectively checkable acceptance criteria, an iteration budget with escalation, a devia... | `/home/javier/.claude/skills/work-packet/SKILL.md` | user:~/.claude/skills |
| `work-unit-commits` | Plan commits as reviewable work units. Trigger: implementation, commit splitting, chained PRs, or keeping tests and docs with code. | `/home/javier/.claude/skills/work-unit-commits/SKILL.md` | user:~/.claude/skills |
| `worktree-flow` | Automated git worktree workflows — isolate each task in its own worktree, work in parallel, and auto-create PRs. Trigger: When running parallel tasks with git worktrees, automating PR creation from worktrees, or confi... | `/home/javier/.claude/skills/worktree-flow/SKILL.md` | user:~/.claude/skills |
| `zod-4` | Zod 4 schema validation patterns. Trigger: When using Zod for validation - breaking changes from v3. | `/home/javier/.claude/skills/zod-4/SKILL.md` | user:~/.claude/skills |
| `zustand-5` | Zustand 5 state management patterns. Trigger: When managing React state with Zustand. | `/home/javier/.claude/skills/zustand-5/SKILL.md` | user:~/.claude/skills |

## Project convention files

| File | Status |
|---|---|
| `AGENTS.md` / `agents.md` | not present |
| project `CLAUDE.md` | not present |
| `.cursorrules` | not present |
| `GEMINI.md` | not present |
| `copilot-instructions.md` | not present |
| `README.md` | present — `/home/javier/programacion/platform/javi-forge/README.md` |
| `docs/architecture.md` | present — `/home/javier/programacion/platform/javi-forge/docs/architecture.md` |
| `docs/ci-runners.md` | present — `/home/javier/programacion/platform/javi-forge/docs/ci-runners.md` (relevant to `ci-engine-unification`) |
| `docs/ci-providers.md` | present — `/home/javier/programacion/platform/javi-forge/docs/ci-providers.md` |
| `docs/commands.md` | present — `/home/javier/programacion/platform/javi-forge/docs/commands.md` |

The user-level `~/.claude/CLAUDE.md` is the governing instruction file for this machine and applies to this project. There is no project-level override.
