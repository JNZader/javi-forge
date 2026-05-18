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
echo -e "${GREEN}javi-forge: $(javi-forge --version 2>/dev/null || echo 'available')${NC}"

# 1. Configurar git hooks
echo -e "${YELLOW}[1/2] Configuring git hooks...${NC}"
git config core.hooksPath .ci-local/hooks
chmod +x "$SCRIPT_DIR/hooks/"* 2>/dev/null || true
chmod +x "$SCRIPT_DIR/"*.sh 2>/dev/null || true
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
