---
name: validate-workflow
description: Validates GitHub Actions workflow YAML files after writing or editing. Checks syntax and required keys.
event: PostToolUse
tools:
  - Write
  - Edit
match_pattern: "\\.github/workflows/.*\\.yml"
action: execute
metadata:
  author: project-starter-framework
  version: "1.0"
  updated: "2026-02"
---

# Validate Workflow Hook

> Automatically validates GitHub Actions workflow files after every write or edit.

## Purpose

Catch YAML syntax errors and missing required keys in workflow files immediately after saving, before a broken workflow gets pushed to the repository.

## Checks Performed

| Check | Rule |
|-------|------|
| YAML syntax | Valid YAML parseable by Python's `yaml.safe_load` |
| `on:` trigger | Workflow must define at least one trigger |
| `jobs:` key | Workflow must define at least one job |

## Behavior

1. **Triggers** after Write or Edit on any `.github/workflows/*.yml` file
2. **Validates** YAML syntax using `python3 -c "import yaml,sys; yaml.safe_load(open('$FILE'))"`
3. **Checks** for `on:` and `jobs:` keys
4. **Reports** any issues with line number if available
5. **Suggests** local testing tools if validation passes

## Local Testing Suggestion

If validation passes, the hook suggests running the workflow locally:

- **act** — [github.com/nektos/act](https://github.com/nektos/act): `act push --container-architecture linux/amd64`
- **wrkflw** — lightweight alternative: `wrkflw run`

## Implementation (Claude Code JSON)

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"\nimport sys, os, json\ntool_input = os.environ.get('TOOL_INPUT', '{}')\ntry:\n    data = json.loads(tool_input)\nexcept Exception:\n    sys.exit(0)\nfile_path = data.get('file_path', data.get('path', ''))\nimport re\nif not re.search(r'\\.github/workflows/.*\\.yml$', file_path):\n    sys.exit(0)\nimport yaml\ntry:\n    with open(file_path) as f:\n        content = yaml.safe_load(f)\nexcept yaml.YAMLError as e:\n    print('WORKFLOW SYNTAX ERROR: ' + str(e))\n    sys.exit(1)\nexcept FileNotFoundError:\n    sys.exit(0)\nwarnings = []\nif not content:\n    warnings.append('Workflow file is empty')\nelse:\n    if 'on' not in content and True not in content:\n        warnings.append('Missing required key: on (trigger definition)')\n    if 'jobs' not in content:\n        warnings.append('Missing required key: jobs')\nif warnings:\n    print('WORKFLOW VALIDATION WARNINGS for ' + file_path + ':')\n    for w in warnings:\n        print('  - ' + w)\nelse:\n    print('Workflow YAML valid: ' + file_path)\n    print('Tip: Test locally with:')\n    print('  act push --container-architecture linux/amd64')\n    print('  # or: wrkflw run')\nsys.exit(0)\n\""
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"\nimport sys, os, json\ntool_input = os.environ.get('TOOL_INPUT', '{}')\ntry:\n    data = json.loads(tool_input)\nexcept Exception:\n    sys.exit(0)\nfile_path = data.get('file_path', data.get('path', ''))\nimport re\nif not re.search(r'\\.github/workflows/.*\\.yml$', file_path):\n    sys.exit(0)\nimport yaml\ntry:\n    with open(file_path) as f:\n        content = yaml.safe_load(f)\nexcept yaml.YAMLError as e:\n    print('WORKFLOW SYNTAX ERROR: ' + str(e))\n    sys.exit(1)\nexcept FileNotFoundError:\n    sys.exit(0)\nwarnings = []\nif not content:\n    warnings.append('Workflow file is empty')\nelse:\n    if 'on' not in content and True not in content:\n        warnings.append('Missing required key: on (trigger definition)')\n    if 'jobs' not in content:\n        warnings.append('Missing required key: jobs')\nif warnings:\n    print('WORKFLOW VALIDATION WARNINGS for ' + file_path + ':')\n    for w in warnings:\n        print('  - ' + w)\nelse:\n    print('Workflow YAML valid: ' + file_path)\n    print('Tip: Test locally with: act push --container-architecture linux/amd64')\nsys.exit(0)\n\""
          }
        ]
      }
    ]
  }
}
```

## Examples

### ✅ Valid Workflow
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
```
→ Output: `Workflow YAML valid: .github/workflows/ci.yml`

### ❌ Invalid — Missing `jobs:`
```yaml
name: CI
on: [push]
# jobs: missing!
```
→ Output: `WORKFLOW VALIDATION WARNINGS: Missing required key: jobs`

## Notes

For local testing, install `act`: `brew install act` (macOS) or `apt install act` (Ubuntu via snap). See [nektos/act](https://github.com/nektos/act) for full docs.
