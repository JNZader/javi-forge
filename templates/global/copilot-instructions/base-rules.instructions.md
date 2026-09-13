---
applyTo: "**"
---

# Base Rules

- NO AI attribution in commits, PRs, code or documentation
- NO destructive commands without confirmation (rm -rf, drop database, truncate)
- NO commit sensitive files (.env, credentials, secrets)
- ALWAYS read files before modifying them
- ALWAYS follow Conventional Commits: type(scope): description
- ALWAYS validate before push (run tests, lint)
- Never run build after changes unless the user explicitly authorizes the exact build command for the current repo/change.
- Prefer focused tests and typecheck before any build.
- Treat tests and typecheck as validation commands; treat local build as a gated validation step that needs scoped authorization.
- Build authorization is local-build-only: it does NOT authorize deploy, publish, release, Docker image build, Docker image push, committing generated artifacts, or any external side effect.
- Docker build, Docker push, deploy, publish, and release each require separate explicit authorization.
- Rationale: avoid generated artifacts, external side effects, dangerous package scripts, and verification placebo; allow a scoped local build only when a formal gate requires that evidence.
- Use imperative mood in commit messages, max 72 chars subject line
