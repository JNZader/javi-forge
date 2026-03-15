---
name: compound
description: Post-completion workflow — summarize what was learned, append to learnings.md, and suggest CLAUDE.md improvements. Triggered after significant task completion.
category: workflows
---

# /workflows:compound

Capture learnings after completing significant work and improve project AI configuration.

## Usage

```
/workflows:compound [<feature-name>]
```

Run this after completing a feature, fixing a complex bug, or finishing a refactoring session.

## What It Does

1. **Summarizes the work**: What was built, changed, or discovered
2. **Extracts learnings**: Patterns found, mistakes made, approaches that worked
3. **Appends to learnings.md**: Persistent knowledge base at project root
4. **Suggests CLAUDE.md improvements**: 1-3 specific, actionable improvements

## PostToolUse Pattern

This command is designed to trigger after significant task completion. Add to your workflow:
```
After every /workflows:work completion → run /workflows:compound
After every major debugging session → run /workflows:compound
After every architecture decision → run /workflows:compound
```

## Process

```
STEP 1: Review what was just completed
         → Read tasks/<feature-name>/plan.md (if exists)
         → Read tasks/<feature-name>/files-edited.md (if exists)
         → Reflect on the conversation/session

STEP 2: Synthesize learnings
         → What patterns were discovered?
         → What went wrong and how was it resolved?
         → What would you do differently next time?
         → What project-specific context would help future sessions?

STEP 3: Append to learnings.md
         → Create if it doesn't exist
         → Add dated entry with feature name

STEP 4: Suggest CLAUDE.md improvements
         → Review current CLAUDE.md
         → Propose 1-3 specific additions or changes
```

## learnings.md Format

```markdown
## YYYY-MM-DD — <feature-name or topic>

### What Was Done
[Brief summary of work completed]

### Key Learnings
- [Learning 1: specific and reusable]
- [Learning 2: specific and reusable]

### What Went Wrong
- [Issue encountered and how it was resolved]

### Patterns to Reuse
- [Approach that worked well and should be applied again]
```

## CLAUDE.md Suggestion Format

```
Suggested CLAUDE.md improvements:

1. **Add command to run tests**: `npm test` — discovered during this session that
   tests need to be run with --watch=false in CI context

2. **Document auth pattern**: Project uses custom JWT middleware — add to CLAUDE.md
   so future sessions don't re-discover this

3. **Note environment variables**: DATABASE_URL must be set — add to setup section
```
