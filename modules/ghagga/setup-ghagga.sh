#!/bin/bash
# =============================================================================
# SETUP-GHAGGA: Configura GHAGGA code review para tu proyecto
# =============================================================================
# Uso:
#   ./setup-ghagga.sh               # Setup interactivo
#   ./setup-ghagga.sh --workflow     # Solo copiar reusable workflow
#   ./setup-ghagga.sh --docker       # Setup Docker Compose
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}=== Setup GHAGGA Code Review ===${NC}"

# =============================================================================
# Helpers
# =============================================================================

setup_workflow() {
    echo -e "${YELLOW}Configurando GitHub Actions workflow...${NC}"

    mkdir -p .github/workflows

    cat > .github/workflows/ghagga-review.yml << 'EOF'
# =============================================================================
# GHAGGA AI Code Review
# =============================================================================
# Trigger: Pull requests to main/develop
# Requires: GHAGGA_URL and GHAGGA_TOKEN in repo settings
# =============================================================================

name: AI Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main, develop]

concurrency:
  group: ghagga-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  review:
    uses: JNZader/project-starter-framework/.github/workflows/reusable-ghagga-review.yml@main
    with:
      ghagga-url: ${{ vars.GHAGGA_URL }}
      review-mode: simple
    secrets:
      ghagga-token: ${{ secrets.GHAGGA_TOKEN }}
EOF

    echo -e "${GREEN}  Creado .github/workflows/ghagga-review.yml${NC}"
    echo -e ""
    echo -e "${YELLOW}Configura en tu repo (Settings > Secrets and variables):${NC}"
    echo -e "  Variables:"
    echo -e "    GHAGGA_URL = URL de tu instancia GHAGGA"
    echo -e "  Secrets:"
    echo -e "    GHAGGA_TOKEN = Token de autenticacion"
}

setup_docker() {
    echo -e "${YELLOW}Configurando Docker Compose...${NC}"

    if [[ -f "$SCRIPT_DIR/docker-compose.yml" ]]; then
        cp "$SCRIPT_DIR/docker-compose.yml" ./docker-compose.ghagga.yml
        echo -e "${GREEN}  Copiado docker-compose.ghagga.yml${NC}"
    fi

    if [[ -f "$SCRIPT_DIR/.env.example" ]]; then
        if [[ ! -f ".env.ghagga" ]]; then
            cp "$SCRIPT_DIR/.env.example" .env.ghagga
            echo -e "${GREEN}  Copiado .env.ghagga (editar con tus API keys)${NC}"
        else
            echo -e "${YELLOW}  .env.ghagga ya existe, no se sobreescribe${NC}"
        fi
    fi

    echo -e ""
    echo -e "${CYAN}Para levantar GHAGGA local:${NC}"
    echo -e "  1. Editar .env.ghagga con tus API keys"
    echo -e "  2. docker compose -f docker-compose.ghagga.yml up -d"
    echo -e "  3. Dashboard: http://localhost:5173"
}

setup_gitignore() {
    local entries=(".env.ghagga" "docker-compose.ghagga.yml")
    for entry in "${entries[@]}"; do
        if ! grep -qF "$entry" .gitignore 2>/dev/null; then
            echo "$entry" >> .gitignore
        fi
    done
    echo -e "${GREEN}  .gitignore actualizado${NC}"
}

# =============================================================================
# Main
# =============================================================================

case "${1:-interactive}" in
    --workflow)
        setup_workflow
        ;;
    --docker)
        setup_docker
        setup_gitignore
        ;;
    interactive|"")
        echo -e "  ${CYAN}Como quieres integrar GHAGGA?${NC}"
        echo -e "    1) GitHub Actions workflow (recomendado)"
        echo -e "    2) Docker Compose local"
        echo -e "    3) Ambos"
        echo -e ""
        read -p "  Opcion [1/2/3]: " GHAGGA_CHOICE

        case "$GHAGGA_CHOICE" in
            1) setup_workflow ;;
            2) setup_docker; setup_gitignore ;;
            3) setup_workflow; setup_docker; setup_gitignore ;;
            *) echo -e "${GREEN}  Sin GHAGGA${NC}" ;;
        esac
        ;;
    *)
        echo "Uso: $0 [--workflow|--docker]"
        exit 1
        ;;
esac

echo -e ""
echo -e "${GREEN}Setup GHAGGA completado${NC}"
echo -e "Docs: https://github.com/JNZader/ghagga/"
