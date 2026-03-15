#!/bin/bash
# =============================================================================
# INSTALL-ENGRAM: Instala Engram memory server para AI agents
# =============================================================================
# Uso:
#   ./install-engram.sh              # Instalar ultima version
#   ./install-engram.sh --check      # Solo verificar si esta instalado
#   ./install-engram.sh --mcp-config # Generar config MCP
#   ./install-engram.sh --no-verify  # Instalar sin verificar checksum (NO RECOMENDADO)
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO="Gentleman-Programming/engram"
INSTALL_DIR="${ENGRAM_INSTALL_DIR:-$HOME/.local/bin}"
NO_VERIFY=false

# =============================================================================
# Helpers
# =============================================================================

check_installed() {
    if command -v engram &> /dev/null; then
        local version
        version=$(engram --version 2>/dev/null || echo "unknown")
        echo -e "${GREEN}Engram ya instalado: $version${NC}"
        echo -e "  Path: $(which engram)"
        return 0
    fi
    return 1
}

detect_platform() {
    local os arch

    case "$(uname -s)" in
        Linux*)  os="Linux" ;;
        Darwin*) os="Darwin" ;;
        MINGW*|MSYS*|CYGWIN*) os="Windows" ;;
        *)       echo -e "${RED}OS no soportado: $(uname -s)${NC}"; exit 1 ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)  arch="x86_64" ;;
        arm64|aarch64) arch="arm64" ;;
        *)             echo -e "${RED}Arquitectura no soportada: $(uname -m)${NC}"; exit 1 ;;
    esac

    echo "${os}_${arch}"
}

get_latest_version() {
    curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
        | grep '"tag_name"' \
        | head -1 \
        | sed 's/.*"tag_name": *"//;s/".*//'
}

generate_mcp_config() {
    local project_name="${1:-$(basename "$(pwd)")}"
    cat << EOF
{
  "mcpServers": {
    "engram": {
      "command": "engram",
      "args": ["mcp"],
      "env": {
        "ENGRAM_PROJECT": "${project_name}"
      }
    }
  }
}
EOF
}

# =============================================================================
# Main
# =============================================================================

case "${1:-install}" in
    --check)
        if check_installed; then
            exit 0
        else
            echo -e "${YELLOW}Engram no instalado${NC}"
            exit 1
        fi
        ;;
    --mcp-config)
        generate_mcp_config "$2"
        exit 0
        ;;
    --no-verify)
        NO_VERIFY=true
        ;;
    install|"")
        ;;
    *)
        echo "Uso: $0 [--check|--mcp-config [project-name]|--no-verify]"
        exit 1
        ;;
esac

echo -e "${CYAN}=== Instalando Engram ===${NC}"

# Verificar si ya existe
if check_installed; then
    read -p "  Reinstalar? [y/N]: " REINSTALL
    [[ "$REINSTALL" != "y" && "$REINSTALL" != "Y" ]] && exit 0
fi

# Detectar plataforma
PLATFORM=$(detect_platform)
echo -e "${YELLOW}Plataforma: ${PLATFORM}${NC}"

# Obtener ultima version
echo -e "${YELLOW}Buscando ultima version...${NC}"
VERSION=$(get_latest_version)
if [[ -z "$VERSION" ]]; then
    echo -e "${RED}No se pudo obtener la ultima version${NC}"
    echo -e "${YELLOW}Instala manualmente desde: https://github.com/${REPO}/releases${NC}"
    exit 1
fi
echo -e "${GREEN}Version: ${VERSION}${NC}"

# Construir URL de descarga
ARCHIVE_NAME="engram_${PLATFORM}.tar.gz"
if [[ "$PLATFORM" == Windows_* ]]; then
    ARCHIVE_NAME="engram_${PLATFORM}.zip"
fi
DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ARCHIVE_NAME}"

# Descargar
echo -e "${YELLOW}Descargando ${DOWNLOAD_URL}...${NC}"
TMP_DIR=$(mktemp -d)
chmod 700 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! curl -fsSL -o "${TMP_DIR}/${ARCHIVE_NAME}" "$DOWNLOAD_URL"; then
    echo -e "${RED}Error descargando. Verifica la URL:${NC}"
    echo -e "  ${DOWNLOAD_URL}"
    echo -e "${YELLOW}Releases disponibles: https://github.com/${REPO}/releases${NC}"
    exit 1
fi

# Verify checksum (mandatory by default)
CHECKSUM_URL="https://github.com/${REPO}/releases/download/${VERSION}/checksums.txt"
if curl -fsSL -o "${TMP_DIR}/checksums.txt" "$CHECKSUM_URL" 2>/dev/null; then
    echo -e "${CYAN}Verifying checksum...${NC}"
    pushd "$TMP_DIR" > /dev/null
    if command -v sha256sum &>/dev/null; then
        sha256sum -c checksums.txt --ignore-missing || {
            echo -e "${RED}Checksum verification failed!${NC}"
            exit 1
        }
    elif command -v shasum &>/dev/null; then
        shasum -a 256 -c checksums.txt --ignore-missing || {
            echo -e "${RED}Checksum verification failed!${NC}"
            exit 1
        }
    fi
    popd > /dev/null
    echo -e "${GREEN}Checksum verified${NC}"
else
    if [[ "$NO_VERIFY" == "true" ]]; then
        echo -e "${YELLOW}WARNING: Skipping checksum verification (--no-verify)${NC}"
    else
        echo -e "${RED}Error: Could not download checksums. Cannot verify download integrity.${NC}"
        echo -e "${YELLOW}Use --no-verify flag to skip verification (NOT RECOMMENDED).${NC}"
        exit 1
    fi
fi

# Extraer
echo -e "${YELLOW}Extrayendo...${NC}"
if [[ "$ARCHIVE_NAME" == *.zip ]]; then
    unzip -o "${TMP_DIR}/${ARCHIVE_NAME}" -d "${TMP_DIR}" > /dev/null
else
    tar xzf "${TMP_DIR}/${ARCHIVE_NAME}" -C "${TMP_DIR}"
fi

# Instalar
mkdir -p "$INSTALL_DIR"
cp "${TMP_DIR}/engram" "${INSTALL_DIR}/engram" 2>/dev/null \
    || cp "${TMP_DIR}/engram.exe" "${INSTALL_DIR}/engram.exe" 2>/dev/null
chmod +x "${INSTALL_DIR}/engram" 2>/dev/null || true

# Verificar PATH
if ! echo "$PATH" | tr ':' '\n' | grep -q "^${INSTALL_DIR}$"; then
    echo -e "${YELLOW}Agrega ${INSTALL_DIR} a tu PATH:${NC}"
    echo -e "  export PATH=\"\$PATH:${INSTALL_DIR}\""
    echo -e "  # O agrega a ~/.bashrc / ~/.zshrc"
fi

# Verificar instalacion
if command -v engram &> /dev/null || [[ -f "${INSTALL_DIR}/engram" ]]; then
    echo -e "${GREEN}Engram instalado correctamente${NC}"
    echo -e "  Path: ${INSTALL_DIR}/engram"
else
    echo -e "${RED}Error: engram no encontrado despues de instalar${NC}"
    exit 1
fi

# Generar config MCP
echo -e ""
echo -e "${CYAN}Config MCP para tu proyecto:${NC}"
echo -e ""
generate_mcp_config
echo -e ""
echo -e "${GREEN}Copia esto a .mcp.json en la raiz de tu proyecto${NC}"
