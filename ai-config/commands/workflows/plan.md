---
name: plan
description: Decompose a feature into structured tasks with goal, acceptance criteria, estimates, risks, and dependencies. Saves to tasks/<feature-name>/plan.md
category: workflows
---

# /workflows:plan

Decompose a feature or task into a structured, actionable plan before writing any code.

## Usage

```
/workflows:plan <feature-name>
```

## What It Does

1. **Clarifies the goal**: What problem does this solve? What's the success state?
2. **Defines acceptance criteria**: Concrete, testable conditions for "done"
3. **Breaks down tasks**: Ordered list with time estimates and dependencies
4. **Identifies risks**: What could go wrong and how to mitigate it
5. **Saves the plan**: Writes to `tasks/<feature-name>/plan.md`

## Process

```
STEP 1: Ask clarifying questions if the feature is ambiguous
STEP 2: Draft the plan using the template below
STEP 3: Save to tasks/<feature-name>/plan.md
STEP 4: Confirm with user before starting implementation
```

## Plan Template

```markdown
# Plan: <feature-name>

## Goal
[One paragraph: what this feature does and why it matters]

## Acceptance Criteria
- [ ] [Testable condition 1]
- [ ] [Testable condition 2]
- [ ] [Testable condition 3]

## Task List

| # | Task | Estimate | Depends On | Status |
|---|------|----------|------------|--------|
| 1 | [Task description] | 30m | — | pending |
| 2 | [Task description] | 1h | 1 | pending |
| 3 | [Task description] | 45m | 2 | pending |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| [Risk 1] | Low/Med/High | Low/Med/High | [How to handle it] |

## Dependencies
- External services: [list any]
- Other features/branches: [list any]
- Team: [list any people/approvals needed]

## Notes
[Anything else relevant to implementation]
```

## Output Location

Plan is saved to: `tasks/<feature-name>/plan.md`

If the directory doesn't exist, create it:
```bash
mkdir -p tasks/<feature-name>
```
