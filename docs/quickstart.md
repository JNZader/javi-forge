# javi-forge Quickstart

Generate project scaffolding in seconds using the `forge-init.sh` entrypoint.

## Prerequisites

- git
- bash or zsh
- The repos cloned as siblings:

  ```
  platform/
  ├── javi-forge/   ← you are here
  ```

For CI bootstrap and code review features no extra tools are needed at generation time — they're installed into the generated project.

---

## Discover what's available

```bash
scripts/forge-init.sh --list-contracts
```

---

## Web project (Node.js)

```bash
# Preview
scripts/forge-init.sh \
  --template template.web.base \
  --project-name my-app \
  --destination ~/projects \
  --dry-run

# Generate
scripts/forge-init.sh \
  --template template.web.base \
  --project-name my-app \
  --destination ~/projects
```

Generated output:
- `.github/workflows/ci.yml` — Node.js CI
- `.github/workflows/dependabot-automerge.yml`
- `.github/dependabot.yml`
- `.ci-local/` — local CI simulation
- `.gitignore`

---

## API project by stack

### Go API

```bash
scripts/forge-init.sh \
  --template template.api.go \
  --project-name my-api \
  --destination ~/projects
```

CI: `actions/setup-go` + `golangci-lint` + `go test ./...`

### Java / Spring Boot

```bash
scripts/forge-init.sh \
  --template template.api.java \
  --project-name my-api \
  --destination ~/projects
```

CI: `actions/setup-java` (Java 21) + `./gradlew spotlessCheck test`

### Python / FastAPI

```bash
scripts/forge-init.sh \
  --template template.api.python \
  --project-name my-api \
  --destination ~/projects
```

CI: `actions/setup-python` + `ruff check` + `pytest`

### Generic API (language-agnostic)

```bash
scripts/forge-init.sh \
  --template template.api.base \
  --project-name my-api \
  --destination ~/projects
```

---

## Fullstack project

```bash
scripts/forge-init.sh \
  --template template.fullstack.base \
  --project-name my-app \
  --destination ~/projects
```

CI: parallel frontend (Node) + backend (generic) jobs.

---

## Documentation site (MkDocs)

```bash
scripts/forge-init.sh \
  --template template.docs.base \
  --project-name my-docs \
  --destination ~/projects
```

Generated output:
- `.github/workflows/ci.yml` — MkDocs build + GitHub Pages deploy
- `mkdocs.yml.example` — rename to `mkdocs.yml` and update `site_name`
- `docs/index.md` — starter index page

After generating:

```bash
pip install mkdocs-material
# rename the config
mv mkdocs.yml.example mkdocs.yml
# serve locally
mkdocs serve
```

---

## Add AI code review

Adds a GHAGGA code review GitHub Action workflow to any project.

### GitHub Action mode (free, no server)

```bash
scripts/forge-init.sh \
  --generator generator.review.automation \
  --project-name my-project \
  --destination ~/projects
```

### Self-hosted mode (your own ghagga server)

```bash
scripts/forge-init.sh \
  --generator generator.review.automation \
  --review-mode self-hosted \
  --project-name my-project \
  --destination ~/projects
```

The generated `ghagga.yml` uses `workflow_dispatch` and calls your server.  
Set `GHAGGA_SERVER_URL` and `GHAGGA_API_TOKEN` in repository secrets.

### Combine with a template

Review automation is composable with any template:

```bash
scripts/forge-init.sh \
  --template template.api.go \
  --generator generator.review.automation \
  --project-name my-go-api \
  --destination ~/projects
```

---

## Add CI bootstrap to an existing project

```bash
scripts/forge-init.sh \
  --generator generator.ci.bootstrap \
  --project-name my-existing-project \
  --destination ~/existing-project
```

Adds `.ci-local/` with local CI simulation hooks to any project without generating a full template.

---

## Dry-run everything first

Add `--dry-run` to any command to print the planned operations without touching the filesystem:

```bash
scripts/forge-init.sh \
  --template template.api.python \
  --generator generator.review.automation \
  --project-name my-api \
  --destination ~/projects \
  --dry-run
```

---

## Full template + generator list

| ID | Type | Description |
|---|---|---|
| `template.web.base` | template | Node.js web CI |
| `template.api.base` | template | Language-agnostic API CI |
| `template.api.go` | template | Go API (golangci-lint + go test) |
| `template.api.java` | template | Java/Gradle (Spotless + test) |
| `template.api.python` | template | Python (ruff + pytest) |
| `template.fullstack.base` | template | Parallel frontend + backend |
| `template.docs.base` | template | MkDocs + GitHub Pages |
| `generator.project.init` | generator | Default init generator |
| `generator.review.automation` | generator | GHAGGA AI code review |
| `generator.ci.bootstrap` | generator | CI bootstrap family standalone |
