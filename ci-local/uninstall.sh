#!/bin/bash
# =============================================================================
# CI-LOCAL: Uninstall Script
# =============================================================================
# Reverses what install.sh did:
#   - Unset core.hooksPath
#   - Optionally restore .git/hooks/ backups (if --restore-backups given)
#   - Optionally delete the ci-local/ directory (if --purge given)
#
# Usage:
#   ./uninstall.sh                       # only unset core.hooksPath
#   ./uninstall.sh --restore-backups     # also restore .bak hooks
#   ./uninstall.sh --purge               # also rm -rf ci-local/ + lib/common.sh
# =============================================================================


CI_LOCAL_ENTRYPOINT_SOURCE="${BASH_SOURCE[0]}"
if [[ "$CI_LOCAL_ENTRYPOINT_SOURCE" == /* ]]; then
    CI_LOCAL_ENTRYPOINT_PATH="$CI_LOCAL_ENTRYPOINT_SOURCE"
else
    CI_LOCAL_ENTRYPOINT_PATH="$PWD/$CI_LOCAL_ENTRYPOINT_SOURCE"
fi
CI_LOCAL_ENTRYPOINT_DIR="${CI_LOCAL_ENTRYPOINT_PATH%/*}"

function ci_local_normalize_platform() {
    local platform="${1:?platform required}"

    case "$platform" in
        MINGW*_NT-*|MSYS*|CYGWIN*) printf '%s\n' 'Windows' ;;
        *) printf '%s\n' "$platform" ;;
    esac
}

function ci_local_main() {
    local platform
    platform="$(ci_local_normalize_platform "${1:?platform required}")"
    shift

    case "$platform" in
        Linux|Windows) ci_local_startup_body "$@" ;;
        *) printf '%s\n' 'unsupported-platform: javi-forge supports Linux and Windows only.'; return 1 ;;
    esac
}

function ci_local_startup_body() {
    set -e

SCRIPT_DIR="$CI_LOCAL_ENTRYPOINT_DIR"
PROJECT_DIR="${SCRIPT_DIR%/*}"

# Source colors if available; degrade gracefully if not.
if [ -f "$SCRIPT_DIR/../lib/common.sh" ]; then
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/../lib/common.sh" 2>/dev/null || true
fi
: "${RED:=}" "${GREEN:=}" "${YELLOW:=}" "${CYAN:=}" "${NC:=}"

RESTORE_BACKUPS=0
PURGE=0
for arg in "$@"; do
    case "$arg" in
        --restore-backups) RESTORE_BACKUPS=1 ;;
        --purge)           PURGE=1 ;;
        --help|-h)
            echo "Usage: $0 [--restore-backups] [--purge]"
            exit 0
            ;;
        *)
            echo "Unknown argument: $arg" >&2
            echo "Usage: $0 [--restore-backups] [--purge]" >&2
            exit 1
            ;;
    esac
done

cd "$PROJECT_DIR"

echo -e "${CYAN}=== CI-LOCAL Uninstall ===${NC}"

# 1. Unset core.hooksPath if it points at us
echo -e "${YELLOW}[1/3] Removing core.hooksPath...${NC}"
current=$(git config --get core.hooksPath 2>/dev/null || echo "")
if [ -n "$current" ]; then
    git config --unset core.hooksPath
    echo -e "${GREEN}Removed hooksPath = $current${NC}"
else
    echo -e "${YELLOW}No core.hooksPath was set; nothing to remove${NC}"
fi

# 2. Restore .bak hooks if requested
echo -e "${YELLOW}[2/3] Restoring hook backups...${NC}"
if [ "$RESTORE_BACKUPS" -eq 1 ]; then
    restored=0
    for hook in pre-commit commit-msg pre-push; do
        if [ -f ".git/hooks/$hook.bak" ]; then
            mv ".git/hooks/$hook.bak" ".git/hooks/$hook"
            echo -e "${GREEN}Restored .git/hooks/$hook${NC}"
            restored=$((restored + 1))
        fi
    done
    if [ "$restored" -eq 0 ]; then
        echo -e "${YELLOW}No .bak hooks found to restore${NC}"
    fi
else
    echo -e "${YELLOW}Skipped (pass --restore-backups to enable)${NC}"
fi

# 3. Purge ci-local/ directory if requested
echo -e "${YELLOW}[3/3] Purging ci-local/ directory...${NC}"
if [ "$PURGE" -eq 1 ]; then
    if [ -d ".ci-local" ]; then
        rm -rf ".ci-local"
        echo -e "${GREEN}Removed .ci-local/${NC}"
    fi
    if [ -d "ci-local" ] && [ "$(realpath "$SCRIPT_DIR")" = "$(realpath "$PROJECT_DIR/ci-local")" ]; then
        echo -e "${YELLOW}WARNING: ci-local/ directory contains THIS uninstall script.${NC}"
        echo -e "${YELLOW}Refusing to delete it. Remove manually after this script exits.${NC}"
    fi
else
    echo -e "${YELLOW}Skipped (pass --purge to delete directories)${NC}"
fi

echo -e ""
echo -e "${GREEN}Uninstall complete!${NC}"
echo -e ""
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    ci_local_main "$(/usr/bin/uname -s)" "$@"
fi
