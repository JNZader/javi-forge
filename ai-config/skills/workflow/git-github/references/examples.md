# Git Workflow Examples

> Concrete command sequences for common git scenarios.
> Referenced from [../SKILL.md](../SKILL.md) — load this file when you need step-by-step examples.

---

## 1. Feature Branch Workflow

Full cycle from starting a feature to opening a pull request:

```bash
# 1. Start from up-to-date main
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feat/user-authentication

# 3. Work and commit incrementally
git add src/auth/
git commit -m "feat(auth): add JWT token generation"

git add src/auth/ tests/auth/
git commit -m "feat(auth): add login endpoint with validation"

git add tests/auth/
git commit -m "test(auth): add unit tests for JWT service"

# 4. Keep branch up to date (rebase preferred over merge)
git fetch origin
git rebase origin/main

# 5. Push and open PR
git push origin feat/user-authentication
gh pr create --title "feat: user authentication" --body "Closes #42"
```

---

## 2. Hotfix Workflow

Emergency fix that needs to go to production immediately:

```bash
# 1. Branch from main (production state)
git checkout main
git pull origin main
git checkout -b hotfix/null-pointer-login

# 2. Make the minimal fix
git add src/auth/login.ts
git commit -m "fix(auth): handle null user object on failed login"

# 3. Merge to main
git checkout main
git merge --no-ff hotfix/null-pointer-login
git tag -a v1.2.1 -m "Hotfix: null pointer on login"
git push origin main --tags

# 4. Also merge to develop to keep branches in sync
git checkout develop
git merge --no-ff hotfix/null-pointer-login
git push origin develop

# 5. Clean up
git branch -d hotfix/null-pointer-login
git push origin --delete hotfix/null-pointer-login
```

---

## 3. Conventional Commit Examples

Reference for commit message format: `<type>(<scope>): <description>`

```bash
# Features
git commit -m "feat(auth): add OAuth2 login with Google"
git commit -m "feat(api): add cursor-based pagination to /users endpoint"

# Bug fixes
git commit -m "fix(auth): prevent session fixation after login"
git commit -m "fix(db): handle connection timeout with retry logic"

# Chores (non-functional changes)
git commit -m "chore(deps): bump express from 4.18.1 to 4.19.2"
git commit -m "chore(ci): add node 20 to test matrix"

# Documentation
git commit -m "docs(api): add OpenAPI examples for /orders endpoint"
git commit -m "docs(readme): update setup instructions for M1 Mac"

# Refactoring
git commit -m "refactor(auth): extract token validation into TokenService"
git commit -m "refactor(orders): replace callback chain with async/await"

# Tests
git commit -m "test(auth): add integration tests for refresh token flow"

# Breaking changes (note the ! or BREAKING CHANGE footer)
git commit -m "feat(api)!: change /users pagination from offset to cursor"
git commit -m "feat(auth): require email verification

BREAKING CHANGE: users without verified email can no longer access protected routes"
```

---

## 4. Resolving Merge Conflicts

Step-by-step guide for resolving conflicts cleanly:

```bash
# 1. Start the merge/rebase that triggers conflicts
git rebase origin/main
# → CONFLICT (content): Merge conflict in src/users/service.ts

# 2. See which files have conflicts
git status
# → both modified: src/users/service.ts

# 3. Open the conflicting file — look for conflict markers:
# <<<<<<< HEAD (your changes)
# const timeout = 5000;
# =======
# const timeout = 3000;
# >>>>>>> origin/main (incoming changes)

# 4. Edit the file to resolve — remove markers, keep correct code:
# const timeout = 5000;  # or merge both intentions if needed

# 5. Stage the resolved file
git add src/users/service.ts

# 6. Continue the rebase (or merge)
git rebase --continue
# (use --abort to cancel and return to pre-rebase state)

# 7. Verify the result
git log --oneline -5
git diff origin/main

# 8. Push (force-with-lease is safer than --force after rebase)
git push origin feat/my-branch --force-with-lease
```

### Conflict prevention tips

```bash
# Rebase frequently to minimize divergence
git fetch origin && git rebase origin/main

# Use rerere to remember conflict resolutions
git config --global rerere.enabled true

# See what will conflict before merging
git merge --no-commit --no-ff origin/main
git merge --abort  # undo the dry run
```
