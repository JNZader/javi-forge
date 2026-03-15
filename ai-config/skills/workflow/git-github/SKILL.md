---
name: git-github
description: >
  Git version control and GitHub collaboration workflows with conventional commits, branch strategies, and CI/CD.
  Trigger: git, github, version control, branching, commits, pull request, CI/CD
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: plataforma-industrial
  version: "2.0"
  tags: [git, github, version-control, ci-cd]
  updated: "2026-02"
---

# Git & GitHub Workflow

## Branching Strategy: GitHub Flow

```
main (production)
  |
  +-- feature/TASK-123-description
  |     └── (merge via PR)
  |
  +-- fix/TASK-456-bug-fix
  |     └── (merge via PR)
  |
  └── hotfix/TASK-789-critical
        └── (merge via PR, immediate deploy)
```

### Rules
1. `main` always deployable
2. Features in short-lived branches (< 1 week)
3. PRs small (< 400 lines)
4. Hotfixes direct to main via express PR

## Conventional Commits

### Format
```
<type>(<scope>): <description>

[body]

[footer]
```

### Types

| Type | Use | Example |
|------|-----|---------|
| `feat` | New feature | `feat(auth): add social login` |
| `fix` | Bug fix | `fix(api): resolve token expiration` |
| `docs` | Documentation | `docs(readme): update setup guide` |
| `style` | Formatting | `style: format with prettier` |
| `refactor` | Code refactor | `refactor(db): simplify queries` |
| `perf` | Performance | `perf(cache): reduce latency` |
| `test` | Tests | `test(auth): add unit tests` |
| `build` | Build/deps | `build: upgrade to node 20` |
| `ci` | CI/CD | `ci: add e2e tests` |
| `chore` | Maintenance | `chore: update .gitignore` |

### Examples

```bash
# Simple feature
git commit -m "feat(sensors): add validation"

# With body
git commit -m "fix(auth): resolve token race condition

Added mutex lock around token refresh.

Fixes #234"

# Breaking change
git commit -m "feat(api)!: change response format

BREAKING CHANGE: 'items' field is now an object."
```

## Git Workflow

### Start Feature

```bash
git checkout main
git pull origin main
git checkout -b feature/TASK-123-description
```

### During Development

```bash
# Frequent small commits
git add src/feature/
git commit -m "feat(feature): add component"

# Sync with main
git fetch origin main
git rebase origin/main
```

### Prepare PR

```bash
# Clean up commits
git rebase -i origin/main

# Push
git push origin feature/TASK-123 --force-with-lease
```

### After Merge

```bash
git checkout main
git pull origin main
git branch -d feature/TASK-123
```

## Pull Request Template

```markdown
## Description
[Brief description of changes]

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation

## Changes
- [Change 1]
- [Change 2]

## How to Test
1. [Step 1]
2. [Step 2]

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Self-review completed
```

## Git Hooks (Husky)

```bash
# Install
npm install -D husky
npx husky init

# Pre-commit
echo 'npm run lint-staged' > .husky/pre-commit

# Commit-msg
echo 'npx commitlint --edit "$1"' > .husky/commit-msg
```

### lint-staged config

```json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "*.{md,json,yaml}": ["prettier --write"]
  }
}
```

### commitlint config

```javascript
// commitlint.config.js
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 72],
  },
};
```

## GitHub Actions CI

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm run test
```

## Dependabot

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      npm-deps:
        patterns: ["*"]
    commit-message:
      prefix: "build(deps)"

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    commit-message:
      prefix: "ci"
```

## Useful Commands

### History
```bash
git log --oneline --graph --all
git log --follow -p -- path/to/file
git log --grep="keyword"
git log -S "functionName" --source --all
```

### Undo
```bash
git checkout -- path/to/file      # Discard changes
git reset HEAD path/to/file       # Unstage
git reset --soft HEAD~1           # Undo commit, keep changes
git reset --hard HEAD~1           # Undo commit, discard changes
git revert abc1234                # Revert specific commit
```

### Stash
```bash
git stash push -m "WIP"
git stash list
git stash pop
git stash apply stash@{2}
```

### Bisect
```bash
git bisect start
git bisect bad                    # Current is broken
git bisect good v1.0.0           # Known good
# Test each commit, mark good/bad
git bisect reset                 # When done
```

## .gitignore

```gitignore
# OS
.DS_Store
Thumbs.db

# IDEs
.idea/
.vscode/

# Dependencies
node_modules/
vendor/

# Build
dist/
build/

# Environment
.env
.env.local
!.env.example

# Logs
*.log
logs/

# Secrets (NEVER commit)
*.pem
*.key
credentials.json
```

## CODEOWNERS

```
# .github/CODEOWNERS

* @tech-lead

/apps/backend/   @backend-team
/apps/frontend/  @frontend-team
/.github/        @devops-team
```

## Best Practices

1. **Atomic commits** - One logical change per commit
2. **Descriptive branch names** - `feature/TASK-123-add-auth`
3. **Rebase before merge** - Keep history clean
4. **Never force push to main**
5. **Protect main branch** - Require reviews and CI

## Related Skills

- `git-workflow`: Branch strategies
- `devops-infra`: GitHub Actions
- `technical-docs`: PR documentation
