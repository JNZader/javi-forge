---
name: ci-local-guide
description: >
  Guide for using CI-Local to run CI/CD locally before pushing.
  Trigger: run tests locally, CI simulation, pre-push validation, debugging CI failures, Docker CI
tools:
  - Read
  - Bash
  - Grep
metadata:
  author: project-starter-framework
  version: "2.0"
  tags: [ci-cd, testing, docker, pre-push, validation]
  updated: "2026-02"
---

# CI-Local Guide

Run your CI/CD pipeline locally before pushing to avoid broken builds in GitHub Actions.

## Quick Commands

### Check Stack Detection
```bash
./.ci-local/ci-local.sh detect   # Linux/Mac
.\.ci-local\ci-local.ps1 detect  # Windows
```

### Quick Validation (pre-commit level)
```bash
./.ci-local/ci-local.sh quick    # Lint + compile
```

### Full CI Simulation (pre-push level)
```bash
./.ci-local/ci-local.sh full     # Complete CI in Docker
```

### Debug Mode (interactive shell)
```bash
./.ci-local/ci-local.sh shell    # Opens bash in CI container
```

## Supported Stacks

| Stack | Detection | Lint Command | Test Command |
|-------|-----------|--------------|--------------|
| Java/Gradle | `build.gradle(.kts)` | `./gradlew spotlessCheck` | `./gradlew test` |
| Java/Maven | `pom.xml` | `./mvnw spotless:check` | `./mvnw test` |
| Go | `go.mod` | `golangci-lint run` | `go test ./...` |
| Rust | `Cargo.toml` | `cargo clippy` | `cargo test` |
| Node.js | `package.json` | `npm run lint` | `npm test` |
| Python | `pyproject.toml` | `ruff check .` | `pytest` |

## Git Hooks

CI-Local installs these hooks automatically:

| Hook | Trigger | Checks |
|------|---------|--------|
| `pre-commit` | `git commit` | AI attribution, lint, security (Semgrep) |
| `commit-msg` | After message | No AI attribution in message |
| `pre-push` | `git push` | Full CI in Docker container |

## Bypass Hooks (Emergency Only)

```bash
git commit --no-verify  # Skip pre-commit
git push --no-verify    # Skip pre-push
```

**Warning**: Only use when absolutely necessary. You risk breaking CI.

## Troubleshooting

### "Docker not running"
Start Docker Desktop or run `docker info` to verify.

### "Tests pass locally but fail in pre-push"
That's the point! The pre-push uses Docker to replicate the exact CI environment.
Debug with:
```bash
./.ci-local/ci-local.sh shell
# You're now in the same environment as CI
```

### "Hook blocked my commit"
Check the error message. Common causes:
- AI attribution detected (remove `Co-authored-by: Claude` etc.)
- Lint errors (run `./gradlew spotlessApply`)
- Security issues (check Semgrep output)

## Configuration

### Add Custom Semgrep Rules
Edit `.ci-local/semgrep.yml`:
```yaml
rules:
  - id: my-custom-rule
    pattern: $DANGER_PATTERN
    message: "Dangerous pattern detected"
    severity: ERROR
```

### Modify CI Commands
Edit the `detect_stack()` function in:
- `.ci-local/ci-local.sh` (Linux/Mac)
- `.ci-local/ci-local.ps1` (Windows)

## Philosophy

> "If it passes locally, it MUST pass in CI."

CI-Local ensures:
1. Same JDK/runtime version as CI
2. Same Docker image as GitHub Actions
3. No "works on my machine" syndrome
4. Fast feedback loop before push
