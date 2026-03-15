---
name: model-router
description: Detects task complexity from prompt keywords and recommends the appropriate Claude model. Logs a recommendation comment without blocking execution.
event: UserPromptSubmit
action: log

metadata:
  author: project-starter-framework
  version: "1.0"
  updated: "2026-02"
---

# Model Router Hook

> Recommends the optimal Claude model based on task complexity keywords. Non-blocking — documents the recommendation as a comment.

## Purpose

Help developers choose the right model for cost and quality efficiency. Complex reasoning
tasks benefit from Opus; routine edits benefit from Haiku; most work is Sonnet territory.

## Evento

- **Trigger:** UserPromptSubmit (or SessionStart)
- **Action:** log (recommendation only — does not force model selection)
- **Condition:** Every prompt is evaluated; only logs when a non-default model is recommended

## Model Routing Table

| Keywords in Prompt | Recommended Model | Reason |
|-------------------|-------------------|--------|
| `architect`, `system design`, `design pattern`, `scalability`, `microservice`, `distributed`, `trade-off`, `ADR` | `claude-opus-4-5` | Complex multi-step reasoning required |
| `security audit`, `threat model`, `CVE`, `OWASP`, `pentest`, `cryptography` | `claude-opus-4-5` | Security analysis needs deep reasoning |
| `performance profile`, `memory leak`, `flame graph`, `bottleneck analysis` | `claude-opus-4-5` | Diagnostic reasoning over complex systems |
| `quick fix`, `typo`, `rename`, `lint`, `format`, `simple`, `one-liner`, `obvious` | `claude-haiku-4-5` | Fast and cost-effective for trivial tasks |
| `add comment`, `update README`, `fix spacing`, `bump version` | `claude-haiku-4-5` | Lightweight documentation/formatting tasks |
| *(default — everything else)* | `claude-sonnet-4-5` | Balanced capability and cost |

## Lógica

```
SI prompt matches opus keywords
ENTONCES log "💡 Model recommendation: claude-opus-4-5 (complex reasoning detected)"
SINO SI prompt matches haiku keywords
ENTONCES log "💡 Model recommendation: claude-haiku-4-5 (simple task detected)"
SINO log nothing (sonnet is default, no recommendation needed)
```

## Implementación

### Para Claude Code

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": ".*",
        "command": "bash .ai-config/scripts/model-router.sh \"$CLAUDE_USER_PROMPT\""
      }
    ]
  }
}
```

### Script: .ai-config/scripts/model-router.sh

```bash
#!/bin/bash
PROMPT="$1"
OPUS_PATTERN="architect|system design|design pattern|scalability|microservice|distributed|trade.off|ADR|security audit|threat model|CVE|OWASP|pentest|cryptography|performance profile|memory leak|flame graph|bottleneck analysis"
HAIKU_PATTERN="quick fix|typo|rename|lint|format|simple|one.liner|obvious|add comment|update README|fix spacing|bump version"

if echo "$PROMPT" | grep -qiE "$OPUS_PATTERN"; then
  echo "💡 Model recommendation: claude-opus-4-5 — complex reasoning detected in prompt"
elif echo "$PROMPT" | grep -qiE "$HAIKU_PATTERN"; then
  echo "💡 Model recommendation: claude-haiku-4-5 — simple task detected, consider switching for cost savings"
fi
# Default (sonnet): no output needed
```

## Notes

- This hook is **advisory only** — it does not change the active model
- To actually switch models, use the `/model` command or configure in `CLAUDE.md`
- Tune the keyword patterns for your team's vocabulary
