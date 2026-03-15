# Code Review Policy

Guidelines for AI agents conducting code reviews. Apply these consistently across all PRs.

---

## Naming Conventions

- Use clear, descriptive names that reveal intent — no abbreviations unless universally known (`url`, `id`, `db` are fine; `mgr`, `tmp`, `cb` are not).
- Booleans: prefer `is`, `has`, `can`, `should` prefixes (`isLoading`, `hasPermission`).
- Functions: use verbs (`fetchUser`, `calculateTotal`); avoid nouns (`userData`, `total`).
- Follow language conventions: `camelCase` for JS/TS/Go, `snake_case` for Python/Rust, `PascalCase` for types/classes everywhere.
- Constants: `UPPER_SNAKE_CASE` for true constants; regular naming for `const` variables that aren't fixed values.

---

## Error Handling

- Every error must be explicitly handled — no silent `catch` blocks, no empty `except`.
- Log errors with enough context to reproduce: include IDs, input values, stack traces.
- User-facing error messages must be clear and actionable; never expose internal stack traces or system paths.
- Distinguish between recoverable errors (return/log) and fatal errors (fail fast).
- For async code: handle rejected promises; never swallow errors with bare `catch () {}`.

---

## Security

- No hardcoded secrets, tokens, passwords, or API keys — use environment variables.
- Validate and sanitize all external inputs (API params, form fields, file uploads).
- Check for injection vulnerabilities: SQL injection, XSS, command injection.
- Apply least privilege: services, DB users, and IAM roles should have only what they need.
- Avoid exposing sensitive data in logs, error messages, or API responses.
- Verify authentication/authorization checks on every protected endpoint.

---

## Performance

- Avoid N+1 queries — use batch fetches, joins, or `include`/`preload` where appropriate.
- Avoid unnecessary loops inside loops; prefer set operations or indexed lookups.
- Prefer lazy loading for heavy resources not needed at startup.
- Cache expensive operations with a clear invalidation strategy.
- Flag unbounded queries — always paginate or limit result sets from the database.

---

## Test Coverage

- New features must include unit tests covering happy path and key edge cases.
- Bug fixes must include a regression test that would have caught the original bug.
- Target ≥ 80% line coverage; don't game it with trivial tests.
- Tests must be deterministic — no flaky tests, no `sleep` for timing, no hardcoded dates.
- Test the behavior, not the implementation — avoid over-mocking internal details.

---

## Code Smells

Flag the following (don't block unless egregious, but note them):

| Smell | Threshold |
|-------|-----------|
| Duplicate code (DRY violation) | 3+ repeated lines without extraction |
| Long functions | > 50 lines |
| Deep nesting | > 3 levels of indentation |
| Magic numbers | Unexplained literals (except 0, 1, -1) |
| God class / god function | Does too many unrelated things |
| Dead code | Unreachable branches, unused imports, commented-out blocks |

---

## PR Conventions

- Title must follow Conventional Commits: `type(scope): description` (e.g., `fix(auth): handle expired token refresh`).
- Description must explain **WHY** the change was made, not just what changed — that's what the diff is for.
- Link related issues with `Closes #123` or `Refs #456`.
- Each PR should be a single logical change — split unrelated fixes into separate PRs.
- Breaking changes must be flagged with `BREAKING CHANGE:` in the commit footer and explained in the PR description.
