---
name: improve-prompt
description: Intercepts vague user prompts and asks clarifying questions before execution. Bypass with *, /, #, or ! prefix.
event: UserPromptSubmit
action: execute
metadata:
  author: project-starter-framework
  version: "1.0"
  updated: "2026-02"
---

# Improve Prompt Hook

> Intercepts short or vague prompts and asks targeted clarifying questions to improve output quality.

## Purpose

Prevent low-quality AI responses caused by under-specified prompts. When a prompt is vague (< 15 words, no clear action verb), the hook pauses and asks up to 3 clarifying questions before proceeding.

## Bypass Prefixes

Prefix your prompt with any of the following to skip interception and pass through immediately:

| Prefix | Meaning |
|--------|---------|
| `*` | Force execute as-is |
| `/` | Slash command — pass through |
| `#` | Comment / meta instruction |
| `!` | Override / urgent |

**Example**: `* just do it` → skips all checks.

## Vagueness Detection

A prompt is considered vague when **both** conditions are true:
1. Word count < 15
2. No clear action verb detected (e.g., `create`, `fix`, `refactor`, `add`, `remove`, `update`, `write`, `build`, `test`, `explain`, `analyze`, `generate`)

## Clarifying Questions (up to 3)

Based on what's missing, the hook asks from:

1. **Output**: What is the expected output or deliverable?
2. **Constraints**: What constraints or requirements apply (language, framework, style)?
3. **Context**: What already exists that I should be aware of?

## Companion Skill

See `.ai-config/skills/prompt-improver/SKILL.md` for the full 4-phase logic used to enrich prompts before execution.

## Implementation (Claude Code JSON)

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"\nimport sys, os\nprompt = os.environ.get('CLAUDE_USER_PROMPT', '')\nbypass = ['*', '/', '#', '!']\nif any(prompt.strip().startswith(p) for p in bypass):\n    sys.exit(0)\nwords = prompt.strip().split()\naction_verbs = ['create','fix','refactor','add','remove','update','write','build','test','explain','analyze','generate','implement','debug','review','migrate','deploy','configure','setup','delete','rename','move','convert','optimize','document']\nhas_verb = any(v in prompt.lower() for v in action_verbs)\nif len(words) < 15 and not has_verb:\n    print('PROMPT IMPROVEMENT NEEDED')\n    print('Your prompt appears vague. Please answer up to 3 questions:')\n    print('  1. What is the expected output or deliverable?')\n    print('  2. What constraints apply (language, framework, style)?')\n    print('  3. What already exists that I should be aware of?')\n    print('Tip: Prefix with * to skip this check (e.g. \\\"* just do it\\\")')\n    sys.exit(1)\nsys.exit(0)\n\""
          }
        ]
      }
    ]
  }
}
```

## Examples

### ✅ Passes Through
```
* fix it quickly
/commit
# note: use typescript
! urgent: rollback last change
create a REST endpoint for user authentication using FastAPI with JWT
```

### 🛑 Intercepted (vague)
```
fix the bug
make it better
add feature
help
```

## Notes

This hook complements the `prompt-improver` skill. For prompts that pass through but still need enrichment, the skill applies the full 4-phase Analyze → Research → Question → Execute flow.
