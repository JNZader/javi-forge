#!/bin/bash
# =============================================================================
# CI-LOCAL: Installation Script
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Source shared library for colors
source "$SCRIPT_DIR/../lib/common.sh"

echo -e "${CYAN}=== CI-LOCAL Installation ===${NC}"

cd "$PROJECT_DIR"

# 0. Verify javi-forge CLI is available (required by hooks)
# The git hooks (pre-commit, pre-push) invoke `javi-forge ci ...`.
# If the CLI is missing, hooks fail silently with "command not found".
# Catch this BEFORE configuring hooks so the user gets a clear error.
if ! command -v javi-forge >/dev/null 2>&1; then
    echo -e "${RED}ERROR: javi-forge CLI not found in PATH${NC}"
    echo -e ""
    echo -e "The git hooks (pre-commit, pre-push) require the javi-forge CLI."
    echo -e "Install it globally:"
    echo -e "  ${CYAN}npm install -g javi-forge${NC}"
    echo -e ""
    echo -e "Or, if you are developing javi-forge itself, link the workspace:"
    echo -e "  ${CYAN}pnpm link --global${NC}"
    echo -e ""
    exit 1
fi

# Log resolved path. The hooks will trust whatever PATH gives them at commit
# time — surface the binary location so the user catches a hijack early.
# readlink -f resolves any symlink chain so a symlink trick (~/.local/bin
# pointing to /tmp/evil) doesn't escape the writable-path warning below.
JAVI_FORGE_PATH=$(command -v javi-forge)
JAVI_FORGE_REAL=$(readlink -f "$JAVI_FORGE_PATH" 2>/dev/null || printf "%s" "$JAVI_FORGE_PATH")
JAVI_FORGE_VERSION_OUTPUT=$(javi-forge --version 2>&1) && JAVI_FORGE_VERSION_OK=1 || JAVI_FORGE_VERSION_OK=0

if [ "$JAVI_FORGE_VERSION_OK" -eq 1 ]; then
    if [ "$JAVI_FORGE_PATH" = "$JAVI_FORGE_REAL" ]; then
        echo -e "${GREEN}javi-forge: ${JAVI_FORGE_VERSION_OUTPUT} (${JAVI_FORGE_PATH})${NC}"
    else
        echo -e "${GREEN}javi-forge: ${JAVI_FORGE_VERSION_OUTPUT} (${JAVI_FORGE_PATH} -> ${JAVI_FORGE_REAL})${NC}"
    fi
else
    echo -e "${RED}ERROR: javi-forge found at ${JAVI_FORGE_PATH} but '--version' failed${NC}"
    echo -e "${YELLOW}Output: ${JAVI_FORGE_VERSION_OUTPUT}${NC}"
    echo -e "Reinstall: ${CYAN}npm install -g javi-forge${NC}"
    exit 1
fi

# Warn if the RESOLVED (post-symlink) path is in a writable-by-many or temp
# location. Audit (2026-05-17) flagged additional locations beyond /tmp:
# user-controlled caches and globals can be hijacked by a malicious package.
case "$JAVI_FORGE_REAL" in
    /tmp/*|/var/tmp/*|/dev/shm/*)
        echo -e "${YELLOW}WARNING: javi-forge resolves to a temp directory (${JAVI_FORGE_REAL}).${NC}"
        echo -e "${YELLOW}This is unusual and may indicate a compromised install.${NC}"
        ;;
    "$HOME"/.cache/*|"$HOME"/.npm/_npx/*|"$HOME"/.pnpm-store/*)
        echo -e "${YELLOW}WARNING: javi-forge resolves to a cache directory (${JAVI_FORGE_REAL}).${NC}"
        echo -e "${YELLOW}Caches can be overwritten by package installs — prefer a stable global location.${NC}"
        ;;
esac

# 1. Configurar git hooks
echo -e "${YELLOW}[1/2] Configuring git hooks...${NC}"
# Compute hooksPath relative to the project root so this works whether the
# directory is "ci-local" (development checkout) or ".ci-local" (user's
# project, after copying via the install instructions).
HOOKS_DIR="$SCRIPT_DIR/hooks"
HOOKS_REL=$(realpath --relative-to="$PROJECT_DIR" "$HOOKS_DIR" 2>/dev/null || printf "%s" "$HOOKS_DIR")

# SECURITY: reject hooksPath that escapes the project root. If $SCRIPT_DIR or
# $SCRIPT_DIR/hooks is a symlink pointing outside the project, realpath
# resolves through it and emits "../../tmp/evil/hooks". Setting that as
# core.hooksPath means every future commit executes whatever lives there.
# Audit (round 3, 2026-05-17) caught this; same fix applied to install.ps1.
HOOKS_ABS=$(realpath "$HOOKS_DIR" 2>/dev/null || printf "%s" "$HOOKS_DIR")
PROJECT_ABS=$(realpath "$PROJECT_DIR" 2>/dev/null || printf "%s" "$PROJECT_DIR")
case "$HOOKS_ABS" in
    "$PROJECT_ABS"|"$PROJECT_ABS"/*) ;;
    *)
        echo -e "${RED}ERROR: hooks directory resolves outside the project root${NC}"
        echo -e "${YELLOW}  HOOKS_DIR resolved to: $HOOKS_ABS${NC}"
        echo -e "${YELLOW}  PROJECT_DIR:           $PROJECT_ABS${NC}"
        echo -e "${YELLOW}Refusing to set core.hooksPath. Investigate symlinks under ci-local/.${NC}"
        exit 1
        ;;
esac

git config core.hooksPath "$HOOKS_REL"
echo -e "${GREEN}hooksPath = $HOOKS_REL${NC}"
# Explicit 0755 (and only when files exist) — owner rwx, group/others rx.
# Avoids group-writable hooks AND avoids passing a literal "*" to chmod
# when the glob expands to nothing.
shopt -s nullglob
hook_files=("$HOOKS_DIR"/* "$SCRIPT_DIR"/*.sh)
if [ ${#hook_files[@]} -gt 0 ]; then
    chmod 0755 "${hook_files[@]}"
fi
shopt -u nullglob
echo -e "${GREEN}Done${NC}"

# 2. Verificar dependencias
echo -e "${YELLOW}[2/2] Checking dependencies...${NC}"

if command -v docker &> /dev/null && docker info &> /dev/null; then
    echo -e "${GREEN}Docker: available${NC}"
else
    echo -e "${YELLOW}Docker: not running (required for pre-push CI)${NC}"
fi

if command -v semgrep &> /dev/null; then
    echo -e "${GREEN}Semgrep: installed (native)${NC}"
elif command -v docker &> /dev/null && docker info &> /dev/null 2>&1; then
    echo -e "${GREEN}Semgrep: available via Docker (returntocorp/semgrep)${NC}"
else
    echo -e "${YELLOW}Semgrep: not available (install semgrep or Docker)${NC}"
fi

echo -e ""
echo -e "${GREEN}Setup complete!${NC}"
echo -e ""
echo -e "Hooks enabled:"
echo -e "  - pre-commit: AI check + lint + security"
echo -e "  - commit-msg: Block AI attribution"
echo -e "  - pre-push:   CI simulation in Docker"
echo -e ""
