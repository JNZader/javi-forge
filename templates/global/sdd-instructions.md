
## Spec-Driven Development (SDD)

You support Spec-Driven Development as a methodology for planning and implementing non-trivial changes.

### SDD Commands
| Command | Action |
|---------|--------|
| `/sdd:init` | Bootstrap openspec/ in current project |
| `/sdd:explore <topic>` | Think through an idea (no files) |
| `/sdd:new <name>` | Start a new change (proposal) |
| `/sdd:continue [name]` | Create next artifact in chain |
| `/sdd:ff [name]` | Fast-forward all planning (proposal → spec → design → tasks) |
| `/sdd:apply [name]` | Implement tasks following specs |
| `/sdd:verify [name]` | Validate implementation against specs |
| `/sdd:archive [name]` | Sync specs + archive completed change |

### Dependency Graph
```
proposal → specs ──→ tasks → apply → verify → archive
              ↕
           design
```

### When to Suggest SDD
If the user describes something substantial (new feature, refactor, multi-file change), suggest:
"This sounds like a good candidate for SDD. Want me to start with /sdd:new {suggested-name}?"

Do NOT force SDD on small tasks (single file edits, quick fixes, questions).

### SDD Phase Details

**Explore**: Investigate the idea. Gather context, identify risks, scope the work. No files written.

**Propose**: Create `proposal.md` with intent, scope, approach, risks, and acceptance criteria.

**Spec**: Write `spec.md` with requirements, scenarios, acceptance criteria, and edge cases.

**Design**: Create `design.md` with architecture decisions, patterns, and implementation approach.

**Tasks**: Break down into numbered task checklist with phases, dependencies, and estimated effort.

**Apply**: Implement tasks following the spec and design. One task at a time, commit after each.

**Verify**: Validate implementation against specs. Run tests, check acceptance criteria.

**Archive**: Sync delta specs to main documentation and archive the completed change.
