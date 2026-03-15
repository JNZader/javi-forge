---
name: work
description: Execute the current plan by creating a git worktree, checking off tasks, and tracking files edited. Reads plan from tasks/<feature-name>/plan.md
category: workflows
---

# /workflows:work

Execute the plan for a feature, tracking progress and edited files as you go.

## Usage

```
/workflows:work <feature-name>
```

## What It Does

1. **Reads the plan**: Loads `tasks/<feature-name>/plan.md`
2. **Creates git worktree**: Isolates work in a dedicated branch/worktree
3. **Executes tasks in order**: Respects task dependencies from the plan
4. **Tracks progress**: Checks off tasks as they complete
5. **Records file changes**: Appends to `tasks/<feature-name>/files-edited.md`

## Process

```
STEP 1: Read tasks/<feature-name>/plan.md
         → If not found, prompt user to run /workflows:plan first

STEP 2: Create git worktree
         git worktree add ../worktrees/<feature-name> -b feature/<feature-name>

STEP 3: For each task in the plan (in dependency order):
         a. Mark task as "in-progress" in the plan
         b. Implement the task
         c. Run tests if applicable
         d. Mark task as "done" ✅ in plan.md
         e. Append edited files to files-edited.md

STEP 4: When all tasks complete, summarize what was done
```

## files-edited.md Format

```markdown
## Files Changed — <feature-name>

### <task-name>
- `src/path/to/file.ts` — [what changed]
- `tests/path/to/file.test.ts` — [what changed]

### <next-task>
- ...
```

## Git Worktree Commands

```bash
# Create worktree for the feature
git worktree add ../worktrees/<feature-name> -b feature/<feature-name>

# List active worktrees
git worktree list

# Remove worktree after merging
git worktree remove ../worktrees/<feature-name>
```

## Rules

- Do not skip tasks unless they're blocked (document why in the plan)
- Commit after each logical unit of work: `git commit -m "feat: <task-name>"`
- Update `tasks/<feature-name>/plan.md` task statuses in real time
- If a task reveals new sub-tasks, add them to the plan before proceeding
