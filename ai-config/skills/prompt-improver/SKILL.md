---
name: prompt-improver
description: >
  Improves vague prompts before execution using a 4-phase Analyze→Research→Question→Execute flow.
  Trigger: vague prompt, unclear request, improve prompt, clarify, enhance prompt
tools:
  - Read
  - Grep
  - Bash
metadata:
  author: project-starter-framework
  version: "1.0"
  tags: [prompt-engineering, quality, workflow, clarification]
  updated: "2026-02"
---

# Prompt Improver Skill

Turn vague, under-specified prompts into actionable, high-quality instructions using a structured 4-phase process.

## Bypass

Prefix your prompt with `*` to skip all enrichment and execute immediately:
```
* just do it
* create the file without asking
```

---

## Phase 1 — Analyze

**Goal**: Determine if the prompt needs enrichment.

Detect vagueness by checking:
- Word count < 15
- No clear action verb present (`create`, `fix`, `refactor`, `add`, `remove`, `update`, `write`, `build`, `test`, `explain`, `analyze`, `generate`, `implement`, `debug`, `review`, `deploy`, `configure`)
- No context clues (file names, component names, tech stack keywords)
- Ambiguous scope (could mean many different things)

**If the prompt is clear → skip to Phase 4 (Execute).**

**If vague → proceed to Phase 2.**

---

## Phase 2 — Research

**Goal**: Gather context from the codebase to ask smarter questions.

Run targeted searches to understand what already exists:

```bash
# Find related files based on keywords in the prompt
grep -r "<keyword>" --include="*.ts" --include="*.py" --include="*.go" -l | head -10

# Check for existing patterns or similar implementations
grep -r "<concept>" --include="*.md" -l | head -5

# Understand project structure
ls -1 src/ 2>/dev/null || ls -1 | head -20
```

Use research findings to make the clarifying questions specific, not generic.

---

## Phase 3 — Question

**Goal**: Ask max 3 targeted questions. Wait for user answers before proceeding.

Select only the most impactful questions from these categories:

| Category | Question |
|----------|----------|
| **Output** | What is the expected output or deliverable? (file, endpoint, component, report…) |
| **Constraints** | What constraints apply? (language, framework, style guide, existing patterns to follow) |
| **Context** | What already exists that I should build on or avoid duplicating? |

**Rules:**
- Ask at most 3 questions, ideally fewer if research answered some already
- Make questions specific: "Should this use the existing `AuthService` or a new one?" not "What should I use?"
- Present findings from Phase 2 to show you've already looked
- Wait for answers before starting any code or file changes

**Example output:**
```
I found 2 existing auth handlers in src/api/auth.ts.

Before I proceed, 2 quick questions:
1. Should the new endpoint extend AuthService or create a separate flow?
2. What error format should failures return — current JSON schema or HTTP exceptions?
```

---

## Phase 4 — Execute

**Goal**: Proceed with full context, producing high-quality output.

With enriched context from the user's answers:
1. Restate the refined task in 1-2 sentences to confirm understanding
2. Execute with specificity — reference exact files, functions, and patterns found in Phase 2
3. Follow existing conventions from the codebase (naming, error handling, structure)
4. If anything is still ambiguous, make a reasonable decision and state the assumption explicitly

---

## Quick Reference

```
Vague prompt detected
        ↓
Phase 1: Analyze → Is it vague?
        ↓ yes
Phase 2: Research → grep codebase for context
        ↓
Phase 3: Question → ask ≤3 targeted questions → wait for answers
        ↓
Phase 4: Execute → proceed with enriched context
```

## Notes

This skill is triggered automatically by the `improve-prompt` hook in `.ai-config/hooks/improve-prompt.md`. You can also invoke it manually when a user seems uncertain about what they want.
