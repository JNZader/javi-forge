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
