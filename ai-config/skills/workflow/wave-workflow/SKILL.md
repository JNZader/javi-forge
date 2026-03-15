---
name: wave-workflow
description: >
  Guide for executing parallel task waves using VibeKanban integration.
  Trigger: parallel execution, task waves, oleadas, multiple tasks, wave planning
tools:
  - Read
  - Write
  - Bash
  - Grep
metadata:
  author: project-starter-framework
  version: "2.0"
  tags: [workflow, parallel, vibekanban, tasks, oleadas]
  updated: "2026-02"
---

# Wave Workflow (Oleadas)

Execute tasks in parallel waves based on dependency analysis.

## Concept

```
Oleada 1: [T-001] [T-002] [T-003]  ← No dependencies, run in parallel
              ↓ merge all → develop
Oleada 2: [T-004] [T-005]          ← Depend on Oleada 1
              ↓ merge all → develop
Release: develop → main
```

## Quick Commands

```bash
# View current wave status
./scripts/new-wave.sh --list

# Create new wave with tasks
./scripts/new-wave.sh "T-001 T-002 T-003"

# Create branches for all tasks
./scripts/new-wave.sh --create-branches

# Mark wave as complete
./scripts/new-wave.sh --complete
```

## Workflow Steps

### 1. Analyze Dependencies
Before creating a wave, identify which tasks can run in parallel:
- Tasks with NO dependencies on each other → Same wave
- Tasks that depend on others → Next wave

### 2. Create Wave
```bash
./scripts/new-wave.sh "T-001 T-002 T-003"
```

This:
- Creates entry in `.project/Memory/WAVES.md`
- Records start timestamp
- Sets wave status to "in-progress"

### 3. Create Branches
```bash
./scripts/new-wave.sh --create-branches
```

Creates:
- `feature/t-001-description`
- `feature/t-002-description`
- `feature/t-003-description`

### 4. Work on Tasks (Parallel)
Each task can be worked on independently:

```bash
# Terminal 1
git checkout feature/t-001
# ... work ...
git commit -m "feat(scope): implement T-001"
git push

# Terminal 2
git checkout feature/t-002
# ... work ...
git commit -m "feat(scope): implement T-002"
git push
```

### 5. Create PRs
For each task, create PR to `develop`:
```bash
gh pr create --base develop --title "feat: T-001 description"
```

### 6. Merge Wave
Once ALL tasks in wave are complete and PRs approved:
```bash
# Merge all PRs to develop
gh pr merge <pr-number> --merge
```

### 7. Complete Wave
```bash
./scripts/new-wave.sh --complete
```

This:
- Updates `.project/Memory/WAVES.md`
- Records completion timestamp
- Deletes merged branches (optional)

### 8. Next Wave
Repeat for the next wave of tasks.

## Best Practices

### Dependency Analysis
- Draw a simple dependency graph
- Group independent tasks
- Never exceed ~15 parallel tasks (cognitive limit)

### Branch Naming
- `feature/t-xxx-short-description`
- `fix/t-xxx-bug-description`
- Keep descriptions short (max 3-4 words)

### PR Strategy
- One PR per task
- Base all PRs on `develop`
- Review in batches when possible

### Merge Order
- Merge in any order if truly independent
- If hidden dependencies found, pause and re-analyze

## Integration with VibeKanban

Tasks come from VibeKanban:
1. List tasks: `mcp__vibe_kanban__list_tasks`
2. Get details: `mcp__vibe_kanban__get_task`
3. Update status: `mcp__vibe_kanban__update_task`

### Sync Workflow
```
VibeKanban (todo) → Wave created → Work → PR merged → VibeKanban (done)
```

## Example Session

```bash
# Morning: Analyze and plan
./scripts/new-wave.sh --list

# Create Oleada 3
./scripts/new-wave.sh "T-010 T-011 T-012 T-013"

# Create branches
./scripts/new-wave.sh --create-branches

# Work through the day...
# Each dev takes 1-2 tasks

# End of day: All merged
./scripts/new-wave.sh --complete

# Check what's next
./scripts/new-wave.sh --list
```

## Memory Files

Wave progress is tracked in:
- `.project/Memory/WAVES.md` - All waves history
- `.project/Memory/CONTEXT.md` - Current state summary
- `.project/Memory/KANBAN.md` - Visual task board (Obsidian Brain)
