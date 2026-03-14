#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME=$(basename "$0")
DEFAULT_CONTRACT_VERSION="0.1.0"
DEFAULT_GENERATOR="generator.project.init"

SUPPORTED_GENERATORS=(
  "generator.project.init"
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
  - This WI-022 scaffold defines the stable public request shape only.
  - Template layout and generator implementation stay internal to later work items.
EOF
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

if [[ -z "$template_id" ]]; then
  printf 'error: --template is required unless --list-contracts is used\n' >&2
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

if ! contains "$template_id" "${SUPPORTED_TEMPLATES[@]}"; then
  printf 'error: unsupported template ID: %s\n' "$template_id" >&2
  exit 1
fi

if [[ -n "$stack_id" ]] && ! contains "$stack_id" "${SUPPORTED_STACKS[@]}"; then
  printf 'error: unsupported stack ID: %s\n' "$stack_id" >&2
  exit 1
fi

printf 'entrypoint: javi-forge/scripts/forge-init.sh\n'
printf 'mode: scaffold\n'
printf 'contract_version: %s\n' "$contract_version"
printf 'generator: %s\n' "$generator_id"
printf 'template: %s\n' "$template_id"
printf 'project_name: %s\n' "$project_name"
printf 'destination: %s\n' "${destination:-current-directory}"
printf 'stack: %s\n' "${stack_id:-none-requested}"

if [[ "$dry_run" -eq 1 ]]; then
  printf 'result: dry-run request accepted by scaffold\n'
else
  printf 'result: scaffold accepted request shape; generation behavior not implemented yet\n'
fi
