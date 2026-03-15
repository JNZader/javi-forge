---
name: review
description: Multi-perspective code review using code-reviewer and security-auditor agents on staged changes. Reads review policy before reviewing. Outputs inline comments with severity.
category: workflows
---

# /workflows:review

Run a multi-perspective review on staged changes before committing or opening a PR.

## Usage

```
/workflows:review [--scope staged|branch|<file-path>]
```

## What It Does

1. **Loads review policy**: Reads `.ai-config/prompts/review-policy.md` for project standards
2. **Gathers changes**: Gets staged diff or branch diff depending on scope
3. **Runs code-reviewer perspective**: Quality, SOLID, DRY, naming, test coverage
4. **Runs security-auditor perspective**: OWASP, injection, auth/authz, secrets
5. **Outputs consolidated report**: Inline comments grouped by file with severity

## Process

```
STEP 1: Load .ai-config/prompts/review-policy.md (if exists)
         → Use project-specific standards for what constitutes a violation

STEP 2: Gather diff
         git diff --staged                    # for staged changes
         git diff main...HEAD                 # for branch changes

STEP 3: Code Quality Review (code-reviewer agent)
         → Check each changed file for quality issues

STEP 4: Security Review (security-auditor agent)
         → Check for vulnerabilities, secrets, auth issues

STEP 5: Consolidate and output report
```

## Output Format

### Per-file findings:

```
## src/path/to/file.ts

🔴 [CRITICAL] line 42 — Hardcoded secret in source
   Problem: API key visible in source code
   Fix: Move to environment variable, add to .gitignore

🟡 [WARNING] line 87 — Function violates Single Responsibility
   Problem: processPayment() handles validation + DB + email
   Fix: Extract into validatePayment(), savePayment(), notifyUser()

🔵 [SUGGESTION] line 103 — Variable name is unclear
   Problem: `d` is not descriptive
   Fix: Rename to `durationMs` or `delaySeconds`
```

### Summary block:

```
## Review Summary
Critical: N  |  Warnings: N  |  Suggestions: N
Recommendation: ✅ APPROVE | ⚠️ APPROVE WITH NOTES | ❌ REQUEST CHANGES
```

## Severity Guide

| Severity | Symbol | Meaning | Action |
|----------|--------|---------|--------|
| Critical | 🔴 | Bug, security, data loss | Must fix before merge |
| Warning | 🟡 | Quality, SOLID, test gap | Should fix |
| Suggestion | 🔵 | Style, naming, minor | Consider fixing |
