---
name: technical-docs
description: >
  Technical documentation writing including ADRs, API docs, runbooks, and README files with proper structure.
  Trigger: documentation, ADR, architecture decision, API docs, runbook, README, technical writing
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [documentation, adr, api-docs, technical-writing]
  updated: "2026-02"
---

# Technical Documentation

## Documentation Structure

```
docs/
├── architecture/
│   ├── ADR/                  # Architecture Decision Records
│   │   ├── 001-monorepo.md
│   │   └── template.md
│   ├── C4/                   # C4 Diagrams
│   └── overview.md
├── api/
│   ├── openapi/
│   └── endpoints.md
├── guides/
│   ├── getting-started.md
│   ├── development.md
│   └── deployment.md
├── runbooks/
│   ├── incident-response.md
│   └── database-backup.md
└── README.md
```

## Architecture Decision Records (ADR)

### Template

```markdown
# ADR-XXX: [Concise Title]

**Status**: Proposed | Accepted | Rejected | Deprecated | Supersedes ADR-XXX
**Date**: YYYY-MM-DD
**Authors**: @username

## Context

[Describe the problem or situation requiring a decision.
Include technical, business, or time constraints.]

## Decision

[Describe the decision clearly and directly.
Use active voice: "We will use X" not "X will be used".]

## Consequences

### Positive
- [Benefit 1]
- [Benefit 2]

### Negative
- [Trade-off 1]
- [Trade-off 2]

### Risks
- [Risk and mitigation]

## Alternatives Considered

### Alternative A: [Name]
- **Pros**: ...
- **Cons**: ...
- **Why not**: ...

## References

- [Relevant documentation link]
- [Related issue or discussion]
```

### Example ADR

```markdown
# ADR-002: Rust for Edge Components

**Status**: Accepted
**Date**: 2024-01-15
**Authors**: @developer

## Context

Edge components require:
- Predictable latency (<10ms)
- Minimal memory usage (<50MB)
- High reliability (24/7 operation)

## Decision

We will use **Rust** for edge-gateway and edge-anomaly components.

## Consequences

### Positive
- Predictable latency without GC pauses
- Memory safety without runtime overhead
- Small, standalone binaries

### Negative
- Steeper learning curve
- Slower compilation than Go

## Alternatives Considered

### Go for all Edge
- **Pros**: Single language, more developers
- **Cons**: Unpredictable GC pauses
- **Why not**: Doesn't meet latency requirements
```

## API Documentation

### OpenAPI Example

```yaml
openapi: 3.0.3
info:
  title: API Name
  description: |
    API description.

    ## Authentication
    Requires `Authorization: Bearer <token>` header.

    ## Rate Limiting
    - 100 requests/minute per IP
  version: 1.0.0

servers:
  - url: https://api.example.com/v1
    description: Production

paths:
  /items:
    get:
      summary: List items
      tags: [items]
      security:
        - bearerAuth: []
      parameters:
        - name: status
          in: query
          schema:
            type: string
            enum: [active, inactive]
        - name: page
          in: query
          schema:
            type: integer
            default: 1
      responses:
        '200':
          description: Item list
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ItemListResponse'

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT

  schemas:
    Item:
      type: object
      required: [id, name]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
```

### Markdown API Docs

```markdown
# API Endpoints

Base URL: `https://api.example.com/v1`

## Authentication

\`\`\`bash
curl -X POST /auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "user@example.com", "password": "secret"}'
\`\`\`

## GET /items

List all items.

**Query Parameters:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| status | string | No | Filter by status |
| page | int | No | Page (default: 1) |

**Example:**

\`\`\`bash
curl -X GET "/items?status=active" \
  -H "Authorization: Bearer $TOKEN"
\`\`\`

**Response 200:**

\`\`\`json
{
  "data": [{ "id": "...", "name": "Item 1" }],
  "meta": { "total": 42, "page": 1 }
}
\`\`\`
```

## Runbook Template

```markdown
# Runbook: [Procedure Name]

**Last Updated**: YYYY-MM-DD
**Author**: @username
**Estimated Time**: X minutes

## Description

[Brief description of procedure and when to use it]

## Prerequisites

- [ ] Access to [system/tool]
- [ ] [Required permissions]

## Procedure

### 1. [Step 1]

\`\`\`bash
command --flag value
\`\`\`

**Verification**: [How to verify step succeeded]

### 2. [Step 2]

...

## Rollback

If something goes wrong:

1. [Rollback step 1]
2. [Rollback step 2]

## Troubleshooting

### Problem: [Description]
**Symptom**: [What you observe]
**Cause**: [Why it happens]
**Solution**: [How to fix]

## Contacts

- **Primary**: @user (Slack: @user)
- **Escalation**: @manager
```

## README Template

```markdown
# Project Name

[![Build Status](badge-url)](link)
[![Coverage](badge-url)](link)

> Brief one-line description.

## Quick Start

\`\`\`bash
git clone https://github.com/org/project.git
cd project
cp .env.example .env
make dev
\`\`\`

## Architecture

\`\`\`
+---------+     +---------+
| Client  |---->|   API   |
+---------+     +----+----+
                     |
                +----+----+
                |   DB    |
                +---------+
\`\`\`

## Development

### Requirements

- Node 20+
- Docker 24+

### Commands

\`\`\`bash
make dev        # Start development
make test       # Run tests
make lint       # Run linters
make build      # Build for production
\`\`\`

## API

See [API documentation](docs/api/).

## Contributing

1. Fork the repository
2. Create branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m "feat: add feature"`
4. Push: `git push origin feature/my-feature`
5. Create Pull Request

## License

[MIT](LICENSE)
```

## Mermaid Diagrams

```markdown
## Data Flow

\`\`\`mermaid
flowchart LR
    Client -->|HTTP| API
    API -->|SQL| DB[(Database)]
    API -->|Cache| Redis[(Redis)]
\`\`\`

## Sequence Diagram

\`\`\`mermaid
sequenceDiagram
    User->>Frontend: Login
    Frontend->>API: POST /auth/login
    API->>DB: Verify credentials
    DB-->>API: User valid
    API-->>Frontend: JWT Token
    Frontend-->>User: Redirect
\`\`\`

## Entity Relationship

\`\`\`mermaid
erDiagram
    USER ||--o{ ORDER : places
    ORDER ||--|{ ITEM : contains

    USER {
        uuid id PK
        string email
    }
\`\`\`
```

## Style Guide

### Markdown Conventions

- **Titles**: Imperative ("Configure", not "Configuration of")
- **Voice**: Active ("Run the command", not "The command should be run")
- **Length**: Lines <100 chars, paragraphs <5 sentences
- **Links**: Descriptive ("see deployment guide", not "click here")

### Formatting

```markdown
# H1 - One per document

## H2 - Main sections

### H3 - Subsections

**Bold** for important emphasis.
*Italic* for new technical terms.
`code` for commands, variables, files.

- Lists for items (max 7)
- Sub-items if needed
  - Max 2 levels

1. Numbered lists for steps
2. When order matters

> Quotes for important notes or warnings.

| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |
```

## Documentation Checklist

### For each feature:
- [ ] README updated if API changes
- [ ] ADR if architectural decision
- [ ] Code comments for complex logic
- [ ] Changelog entry

### For releases:
- [ ] Complete changelog
- [ ] Migration guide if breaking changes
- [ ] API docs updated
- [ ] Runbooks reviewed

## Related Skills

- `git-workflow`: Commit documentation
- `git-github`: PR documentation
- `devops-infra`: CI/CD docs
