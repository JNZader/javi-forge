#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME=$(basename "$0")
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
DEFAULT_CONTRACT_VERSION="0.1.0"
DEFAULT_GENERATOR="generator.project.init"

SUPPORTED_GENERATORS=(
  "generator.project.init"
  "generator.review.automation"
)

SUPPORTED_TEMPLATES=(
  "template.web.base"
  "template.api.base"
  "template.fullstack.base"
  "template.docs.base"
)

SUPPORTED_STACKS=(
  "web"
  "api"
  "fullstack"
  "docs"
)

IMPLEMENTED_TEMPLATES=(
  "template.web.base"
  "template.api.base"
  "template.fullstack.base"
  "template.docs.base"
)

IMPLEMENTED_GENERATORS=(
  "generator.project.init"
  "generator.review.automation"
)

usage() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [options]

Stable forge project initialization entrypoint scaffold.

Options:
  --template ID            Published template ID to initialize.
  --project-name NAME      Project name for the generated scaffold.
  --generator ID           Published generator ID. Defaults to ${DEFAULT_GENERATOR}.
  --destination PATH       Output directory for the generated project.
  --stack ID               Optional stack or mode hint.
  --contract-version VER   Contract version to negotiate or pin.
  --dry-run                Print the accepted request without generating files.
  --list-contracts         Print published generator, template, and stack IDs.
  -h, --help               Show this help message.

Notes:
  - WI-023 implements the first bounded forge slice for template.web.base.
  - Other published template IDs remain contract-only until later work items land.
EOF
}

print_step() {
  printf '%s\n' "$1"
}

contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

print_contracts() {
  local item

  printf 'contract_version: %s\n' "$DEFAULT_CONTRACT_VERSION"
  printf 'entrypoint: javi-forge/scripts/forge-init.sh\n'
  printf 'default_generator: %s\n' "$DEFAULT_GENERATOR"

  printf 'generators:\n'
  for item in "${SUPPORTED_GENERATORS[@]}"; do
    printf '  - %s\n' "$item"
  done

  printf 'templates:\n'
  for item in "${SUPPORTED_TEMPLATES[@]}"; do
    printf '  - %s\n' "$item"
  done

  printf 'stacks:\n'
  for item in "${SUPPORTED_STACKS[@]}"; do
    printf '  - %s\n' "$item"
  done
}

dry_run_note() {
  if [[ "$dry_run" -eq 1 ]]; then
    printf 'dry-run: %s\n' "$1"
  fi
}

ensure_dir() {
  local dir="$1"
  if [[ "$dry_run" -eq 1 ]]; then
    dry_run_note "mkdir -p $dir"
  else
    mkdir -p "$dir"
  fi
}

copy_file() {
  local src="$1"
  local dest="$2"
  if [[ "$dry_run" -eq 1 ]]; then
    dry_run_note "copy $src -> $dest"
  else
    cp "$src" "$dest"
  fi
}

make_executable() {
  local path="$1"
  if [[ "$dry_run" -eq 1 ]]; then
    dry_run_note "chmod +x $path"
  else
    chmod +x "$path"
  fi
}

write_file() {
  local path="$1"
  local content="$2"
  if [[ "$dry_run" -eq 1 ]]; then
    dry_run_note "write $path"
  else
    printf '%s' "$content" > "$path"
  fi
}

generate_dependabot_yml() {
  local template_dir="$REPO_ROOT/templates/web/base/dependabot"

  if [[ -f "$template_dir/header.yml" ]]; then
    cat "$template_dir/header.yml"
  else
    printf 'version: 2\n\nupdates:\n'
  fi

  if [[ -f "$template_dir/github-actions.yml" ]]; then
    cat "$template_dir/github-actions.yml"
  fi

  if [[ -f "$template_dir/npm.yml" ]]; then
    cat "$template_dir/npm.yml"
  fi
}

write_default_gitignore() {
  local path="$1"
  local content
  content=$(cat <<'EOF'
# CI Local
.ci-local/docker/
.ci-local-image-built
semgrep-report.json
semgrep-results.json

# IDE
.idea/
.vscode/
*.swp

# OS
.DS_Store
Thumbs.db

# Env
.env
.env.local
.env.*.local
*.env

# Credentials
.npmrc
credentials.json
*.pem
*.key
*.p12
*.pfx
*.jks
*.keystore
.aws/
.ssh/
.gcp/
service-account*.json

# Build
*.log
coverage/
dist/
build/
target/
node_modules/
__pycache__/
.pytest_cache/
EOF
)
  write_file "$path" "$content"
}

copy_ci_local_family() {
  local destination_root="$1"
  local family_root="$REPO_ROOT/ci/bootstrap/ci-local"

  ensure_dir "$destination_root/.ci-local"
  ensure_dir "$destination_root/.ci-local/hooks"
  ensure_dir "$destination_root/lib"

  copy_file "$REPO_ROOT/lib/common.sh" "$destination_root/lib/common.sh"
  copy_file "$family_root/README.md" "$destination_root/.ci-local/README.md"
  copy_file "$family_root/ci-local.sh" "$destination_root/.ci-local/ci-local.sh"
  copy_file "$family_root/install.sh" "$destination_root/.ci-local/install.sh"
  copy_file "$family_root/semgrep.yml" "$destination_root/.ci-local/semgrep.yml"
  copy_file "$family_root/hooks/pre-commit" "$destination_root/.ci-local/hooks/pre-commit"
  copy_file "$family_root/hooks/commit-msg" "$destination_root/.ci-local/hooks/commit-msg"
  copy_file "$family_root/hooks/pre-push" "$destination_root/.ci-local/hooks/pre-push"

  make_executable "$destination_root/.ci-local/ci-local.sh"
  make_executable "$destination_root/.ci-local/install.sh"
  make_executable "$destination_root/.ci-local/hooks/pre-commit"
  make_executable "$destination_root/.ci-local/hooks/commit-msg"
  make_executable "$destination_root/.ci-local/hooks/pre-push"
}

init_template_api_base() {
  local destination_root="$1"
  local project_dir_name="$2"
  local template_root="$REPO_ROOT/templates/api/base"

  ensure_dir "$destination_root"
  ensure_dir "$destination_root/.github"
  ensure_dir "$destination_root/.github/workflows"

  copy_ci_local_family "$destination_root"
  copy_file "$template_root/github/ci-api.yml" "$destination_root/.github/workflows/ci.yml"
  copy_file "$template_root/github/dependabot-automerge.yml" "$destination_root/.github/workflows/dependabot-automerge.yml"

  if [[ ! -f "$destination_root/.gitignore" ]]; then
    write_default_gitignore "$destination_root/.gitignore"
  fi

  if [[ "$dry_run" -eq 1 ]]; then
    dry_run_note "write $destination_root/.github/dependabot.yml"
  else
    {
      cat "$template_root/dependabot/header.yml"
      cat "$template_root/dependabot/github-actions.yml"
    } > "$destination_root/.github/dependabot.yml"
  fi

  print_step "template_status: implemented"
  print_step "implemented_template: template.api.base"
  print_step "project_name: $project_dir_name"
  print_step "destination: $destination_root"
  print_step "ci_family: ci.bootstrap.local"
}

init_template_fullstack_base() {
  local destination_root="$1"
  local project_dir_name="$2"
  local template_root="$REPO_ROOT/templates/fullstack/base"

  ensure_dir "$destination_root"
  ensure_dir "$destination_root/.github"
  ensure_dir "$destination_root/.github/workflows"

  copy_ci_local_family "$destination_root"
  copy_file "$template_root/github/ci-fullstack.yml" "$destination_root/.github/workflows/ci.yml"
  copy_file "$template_root/github/dependabot-automerge.yml" "$destination_root/.github/workflows/dependabot-automerge.yml"

  if [[ ! -f "$destination_root/.gitignore" ]]; then
    write_default_gitignore "$destination_root/.gitignore"
  fi

  if [[ "$dry_run" -eq 1 ]]; then
    dry_run_note "write $destination_root/.github/dependabot.yml"
  else
    {
      cat "$template_root/dependabot/header.yml"
      cat "$template_root/dependabot/github-actions.yml"
    } > "$destination_root/.github/dependabot.yml"
  fi

  print_step "template_status: implemented"
  print_step "implemented_template: template.fullstack.base"
  print_step "project_name: $project_dir_name"
  print_step "destination: $destination_root"
  print_step "ci_family: ci.bootstrap.local"
}

init_template_web_base() {
  local destination_root="$1"
  local project_dir_name="$2"
  local template_root="$REPO_ROOT/templates/web/base"

  ensure_dir "$destination_root"
  ensure_dir "$destination_root/.github"
  ensure_dir "$destination_root/.github/workflows"

  copy_ci_local_family "$destination_root"
  copy_file "$template_root/github/ci-node.yml" "$destination_root/.github/workflows/ci.yml"
  copy_file "$template_root/github/dependabot-automerge.yml" "$destination_root/.github/workflows/dependabot-automerge.yml"

  if [[ ! -f "$destination_root/.gitignore" ]]; then
    write_default_gitignore "$destination_root/.gitignore"
  fi

  if [[ "$dry_run" -eq 1 ]]; then
    dry_run_note "write $destination_root/.github/dependabot.yml"
  else
    generate_dependabot_yml > "$destination_root/.github/dependabot.yml"
  fi

  print_step "template_status: implemented"
  print_step "implemented_template: template.web.base"
  print_step "project_name: $project_dir_name"
  print_step "destination: $destination_root"
  print_step "ci_family: ci.bootstrap.local"
}

template_id=""
project_name=""
generator_id="$DEFAULT_GENERATOR"
destination=""
stack_id=""
contract_version="$DEFAULT_CONTRACT_VERSION"
dry_run=0
list_contracts=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --template)
      [[ $# -ge 2 ]] || { printf 'error: --template requires a value\n' >&2; exit 1; }
      template_id="$2"
      shift 2
      ;;
    --project-name)
      [[ $# -ge 2 ]] || { printf 'error: --project-name requires a value\n' >&2; exit 1; }
      project_name="$2"
      shift 2
      ;;
    --generator)
      [[ $# -ge 2 ]] || { printf 'error: --generator requires a value\n' >&2; exit 1; }
      generator_id="$2"
      shift 2
      ;;
    --destination)
      [[ $# -ge 2 ]] || { printf 'error: --destination requires a value\n' >&2; exit 1; }
      destination="$2"
      shift 2
      ;;
    --stack)
      [[ $# -ge 2 ]] || { printf 'error: --stack requires a value\n' >&2; exit 1; }
      stack_id="$2"
      shift 2
      ;;
    --contract-version)
      [[ $# -ge 2 ]] || { printf 'error: --contract-version requires a value\n' >&2; exit 1; }
      contract_version="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --list-contracts)
      list_contracts=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'error: unknown option: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$list_contracts" -eq 1 ]]; then
  print_contracts
  exit 0
fi

if [[ "$contract_version" != "$DEFAULT_CONTRACT_VERSION" ]]; then
  printf 'error: unsupported contract version: %s\n' "$contract_version" >&2
  printf 'supported contract version: %s\n' "$DEFAULT_CONTRACT_VERSION" >&2
  exit 1
fi

# Allow generator-only invocation (e.g. --generator generator.review.automation)
# For template invocations, --template is still required
if [[ -z "$template_id" && "$generator_id" == "$DEFAULT_GENERATOR" ]]; then
  printf 'error: --template is required unless --list-contracts is used or --generator is a standalone generator\n' >&2
  exit 1
fi

if [[ -z "$project_name" ]]; then
  printf 'error: --project-name is required unless --list-contracts is used\n' >&2
  exit 1
fi

if ! contains "$generator_id" "${SUPPORTED_GENERATORS[@]}"; then
  printf 'error: unsupported generator ID: %s\n' "$generator_id" >&2
  exit 1
fi

if [[ -n "$template_id" ]] && ! contains "$template_id" "${SUPPORTED_TEMPLATES[@]}"; then
  printf 'error: unsupported template ID: %s\n' "$template_id" >&2
  exit 1
fi

if [[ -n "$stack_id" ]] && ! contains "$stack_id" "${SUPPORTED_STACKS[@]}"; then
  printf 'error: unsupported stack ID: %s\n' "$stack_id" >&2
  exit 1
fi

destination_root="${destination:-$(pwd)}"

printf 'entrypoint: javi-forge/scripts/forge-init.sh\n'
printf 'mode: scaffold\n'
printf 'contract_version: %s\n' "$contract_version"
printf 'generator: %s\n' "$generator_id"
printf 'template: %s\n' "${template_id:-none}"
printf 'project_name: %s\n' "$project_name"
printf 'destination: %s\n' "$destination_root"
printf 'stack: %s\n' "${stack_id:-default}"

# Dispatch template generation
if [[ -n "$template_id" ]]; then
  case "$template_id" in
    template.web.base)
      if [[ -n "$stack_id" && "$stack_id" != "web" ]]; then
        printf 'error: template.web.base only supports stack ID: web\n' >&2
        exit 1
      fi
      init_template_web_base "$destination_root" "$project_name"
      ;;
    template.api.base)
      if [[ -n "$stack_id" && "$stack_id" != "api" ]]; then
        printf 'error: template.api.base only supports stack ID: api\n' >&2
        exit 1
      fi
      init_template_api_base "$destination_root" "$project_name"
      ;;
    template.fullstack.base)
      if [[ -n "$stack_id" && "$stack_id" != "fullstack" ]]; then
        printf 'error: template.fullstack.base only supports stack ID: fullstack\n' >&2
        exit 1
      fi
      init_template_fullstack_base "$destination_root" "$project_name"
      ;;
    template.docs.base)
      if [[ -n "$stack_id" && "$stack_id" != "docs" ]]; then
        printf 'error: template.docs.base only supports stack ID: docs\n' >&2
        exit 1
      fi
      init_template_docs_base "$destination_root" "$project_name"
      ;;
    *)
      printf 'error: template dispatched but no handler found: %s\n' "$template_id" >&2
      exit 1
      ;;
  esac
fi

# Dispatch generator (composable with template)
if [[ "$generator_id" == "generator.review.automation" ]]; then
  generate_review_automation "$destination_root" "$project_name"
fi

if [[ "$dry_run" -eq 1 ]]; then
  printf 'result: dry-run request accepted\n'
else
  printf 'result: forge slice generated\n'
fi
