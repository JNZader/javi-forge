---
name: skill-validator
description: Validates new SKILL.md files being written to ensure they follow the required format and conventions.
event: PreToolUse
tools:
  - Write
  - Edit
match_pattern: ".ai-config/skills/.*/SKILL\\.md"
action: warn
metadata:
  author: project-starter-framework
  version: "1.0"
  updated: "2026-02"
---

# Skill Validator Hook

> Validates SKILL.md files before they are written to ensure they meet required format standards.

## Purpose

Prevent malformed or incomplete skill files from being saved. Catches common issues like missing required fields, absolute paths, wildcard tool usage, and missing trigger keywords.

## Checks Performed

| Check | Rule |
|-------|------|
| `name` field | Must be present in frontmatter |
| `description` field | Must contain trigger keywords (e.g., `Trigger:`) |
| `tags` field | Must be present and non-empty |
| Absolute paths | No `/Users/` or `/home/` paths in content |
| Wildcard tools | Tools list must not contain `"*"` |

## Behavior

1. **Intercepts** Write/Edit operations targeting `SKILL.md` files under `.ai-config/skills/`
2. **Reads** the content being written
3. **Validates** each rule above
4. **Warns** with specific failure reasons if any check fails
5. **Allows** the write to proceed (action: warn, not block)

## Implementation (Claude Code JSON)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"\nimport sys, os, json, re\ntool_input = os.environ.get('TOOL_INPUT', '{}')\ntry:\n    data = json.loads(tool_input)\nexcept Exception:\n    sys.exit(0)\nfile_path = data.get('file_path', data.get('path', ''))\nif not re.search(r'\\.ai-config/skills/.+/SKILL\\.md', file_path):\n    sys.exit(0)\ncontent = data.get('content', '')\nwarnings = []\nif not re.search(r'^name:\\s*.+', content, re.MULTILINE):\n    warnings.append('MISSING: name field in frontmatter')\nif not re.search(r'Trigger:', content):\n    warnings.append('MISSING: Trigger keywords in description field')\nif not re.search(r'^tags:', content, re.MULTILINE):\n    warnings.append('MISSING: tags field in frontmatter')\nif re.search(r'/Users/|/home/', content):\n    warnings.append('INVALID: Absolute path detected (/Users/ or /home/). Use relative paths.')\nif re.search(r'tools:\\s*\\[\\s*\\\"\\*\\\"', content) or re.search(r\"tools:\\s*\\[\\s*'\\*'\", content):\n    warnings.append('INVALID: Wildcard tool [\\\"*\\\"] is not allowed. List specific tools.')\nif warnings:\n    print('SKILL VALIDATION WARNINGS:')\n    for w in warnings:\n        print('  - ' + w)\n    print('Fix these issues to ensure the skill works correctly.')\nsys.exit(0)\n\""
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"\nimport sys, os, json, re\ntool_input = os.environ.get('TOOL_INPUT', '{}')\ntry:\n    data = json.loads(tool_input)\nexcept Exception:\n    sys.exit(0)\nfile_path = data.get('file_path', data.get('path', ''))\nif not re.search(r'\\.ai-config/skills/.+/SKILL\\.md', file_path):\n    sys.exit(0)\nnew_content = data.get('new_str', data.get('new_content', ''))\nif not new_content:\n    sys.exit(0)\nwarnings = []\nif re.search(r'/Users/|/home/', new_content):\n    warnings.append('INVALID: Absolute path detected (/Users/ or /home/). Use relative paths.')\nif re.search(r'tools:\\s*\\[\\s*\\\"\\*\\\"', new_content) or re.search(r\"tools:\\s*\\[\\s*'\\*'\", new_content):\n    warnings.append('INVALID: Wildcard tool [\\\"*\\\"] is not allowed. List specific tools.')\nif warnings:\n    print('SKILL VALIDATION WARNINGS (Edit):')\n    for w in warnings:\n        print('  - ' + w)\nsys.exit(0)\n\""
          }
        ]
      }
    ]
  }
}
```

## Examples

### ✅ Valid SKILL.md
```yaml
---
name: my-skill
description: >
  Does something useful.
  Trigger: keyword1, keyword2
tools:
  - Read
  - Bash
metadata:
  tags: [tag1, tag2]
---
```

### ❌ Will Warn
```yaml
---
# Missing name field
description: Does something.  # Missing Trigger:
tools:
  - "*"                        # Wildcard not allowed
---

# Content with /Users/john/project/file.ts  ← absolute path
```

## Notes

This hook validates Write and Edit operations. For a full skill authoring guide, see `.ai-config/skills/_TEMPLATE.md`.
