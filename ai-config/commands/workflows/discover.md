---
name: discover
description: Chained discovery workflow — brainstorm ideas, identify assumptions, prioritize experiments, then execute. Progressive suggestions after each step.
category: workflows
chain:
  - brainstorm
  - identify-assumptions
  - prioritize
  - experiment
suggests_next:
  - /workflows:plan
  - /workflows:work
---

# /workflows:discover

End-to-end discovery workflow that chains 4 steps with progressive suggestions.

## Usage

```
/workflows:discover <topic>
```

## Chain Steps

### Step 1: Brainstorm
Generate 5-10 ideas related to the topic. No filtering, quantity over quality.

Output format:
```
## Ideas for: <topic>
1. [idea] — [one-line rationale]
2. [idea] — [one-line rationale]
...
```

**After completion, suggest**: "Ideas generated. Run step 2 to identify assumptions, or pick specific ideas to explore."

### Step 2: Identify Assumptions
For the top 3-5 ideas, list the key assumptions that must be true for each to work.

Output format:
```
## Assumptions
### Idea 1: [name]
- [assumption] — risk: high/medium/low
- [assumption] — risk: high/medium/low
```

**After completion, suggest**: "Assumptions mapped. Run step 3 to prioritize by risk, or go back to brainstorm more."

### Step 3: Prioritize
Rank ideas by: (1) impact, (2) effort, (3) assumption risk. Create a 2x2 matrix.

Output format:
```
## Priority Matrix
| Idea | Impact | Effort | Risk | Priority |
|------|--------|--------|------|----------|
```

**After completion, suggest**: "Priority matrix ready. Run step 4 to design experiments for the top picks."

### Step 4: Experiment Design
For the top 2-3 ideas, design a minimal experiment to validate the riskiest assumption.

Output format:
```
## Experiments
### Experiment 1: [name]
- Validates: [assumption]
- Method: [how to test]
- Success criteria: [what proves it works]
- Effort: [time estimate]
```

**After completion, suggest**: "Experiments designed. Next steps: `/workflows:plan` to plan implementation, or `/workflows:work` to start building."

## Chaining Rules

1. Each step can be run independently or as part of the chain
2. Output of each step is input context for the next
3. Progressive suggestions appear after every step completion
4. User can skip steps or go back at any point
5. The full chain takes ~15 minutes of agent time
