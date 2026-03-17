---
name: diagnose
description: Chained diagnosis workflow — investigate issue, verify with devil's advocate, then solve. Uses ACH (Analysis of Competing Hypotheses).
category: workflows
chain:
  - investigate
  - verify
  - solve
suggests_next:
  - /workflows:compound
  - /workflows:review
---

# /workflows:diagnose

Structured diagnosis workflow for complex bugs and issues.

## Usage

```
/workflows:diagnose <issue-description>
```

## Chain Steps

### Step 1: Investigate
Gather evidence and generate hypotheses using the debug-mode skill.

1. Reproduce the issue (or understand the reproduction steps)
2. Gather context: error messages, stack traces, recent changes, logs
3. Generate 3-5 competing hypotheses ranked by likelihood
4. Map evidence to hypotheses (which evidence supports/contradicts each)

Output: ACH matrix

```
## ACH Matrix: <issue>
| Evidence | H1 (70%) | H2 (20%) | H3 (10%) |
|----------|----------|----------|----------|
| Error at line 42 | Consistent | Inconsistent | Neutral |
| Works in staging | Inconsistent | Consistent | Consistent |
```

**After completion, suggest**: "Investigation complete. Run step 2 for devil's advocate verification, or jump to step 3 if confident."

### Step 2: Verify (Devil's Advocate)
Challenge the leading hypothesis:

1. **Assume H1 is wrong** — what evidence would you expect to see?
2. **Check for that evidence** — does it exist?
3. **Try to reproduce with H1 fixed** — does the fix actually work?
4. If H1 survives the challenge, proceed to fix. Otherwise, promote H2.

**After completion, suggest**: "Verification complete. H[N] confirmed. Run step 3 to implement the fix."

### Step 3: Solve
Implement the fix based on the verified hypothesis:

1. Write the fix
2. Verify the original reproduction steps pass
3. Run the full test suite
4. Document what was wrong and why (for Engram)

**After completion, suggest**: "Fix applied. Next: `/workflows:compound` to capture learnings, or `/workflows:review` for code review."

## Rules

1. Never skip step 2 for Medium+ complexity issues
2. Always document the root cause in Engram
3. If 3 rounds of investigation don't converge, escalate to user
