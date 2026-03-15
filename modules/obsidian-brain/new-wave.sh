#!/bin/bash
# =============================================================================
# NEW-WAVE: Crear oleada de tareas paralelas
# =============================================================================
# Uso:
#   ./scripts/new-wave.sh "T-001 T-002 T-003"
#   ./scripts/new-wave.sh --from-vibekanban
#   ./scripts/new-wave.sh --list
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WAVES_FILE="$PROJECT_DIR/.project/Memory/WAVES.md"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

sed_inplace() {
    if sed --version 2>/dev/null | grep -q GNU; then
        sed -i "$@"
    else
        sed -i '' "$@"
    fi
}

escape_sed() {
    printf '%s\n' "$1" | sed 's/[&/\]/\\&/g'
}

# Asegurar que existe el archivo de oleadas
if [[ ! -f "$WAVES_FILE" ]]; then
    cat > "$WAVES_FILE" << 'EOF'
# Oleadas de Trabajo

> Registro de oleadas de tareas paralelas

---

## Oleada Actual

**Numero:** 0
**Estado:** Ninguna activa
**Tareas:** -

---

## Historial

| # | Tareas | Inicio | Fin | Estado |
|---|--------|--------|-----|--------|
EOF
fi

show_help() {
    echo -e "${CYAN}NEW-WAVE: Gestion de oleadas de tareas paralelas${NC}"
    echo ""
    echo "Uso:"
    echo "  ./scripts/new-wave.sh \"T-001 T-002 T-003\"   Crear oleada con tareas"
    echo "  ./scripts/new-wave.sh --list                 Ver oleada actual"
    echo "  ./scripts/new-wave.sh --complete             Marcar oleada como completada"
    echo "  ./scripts/new-wave.sh --create-branches      Crear branches para tareas"
    echo ""
}

list_wave() {
    echo -e "${CYAN}=== Oleada Actual ===${NC}"
    echo ""
    grep -A 10 "## Oleada Actual" "$WAVES_FILE" | head -12
}

get_current_wave_number() {
    grep "^\*\*Numero:\*\*" "$WAVES_FILE" | head -1 | grep -oE '[0-9]+' || echo "0"
}

create_wave() {
    local tasks="$1"
    local wave_num=$(($(get_current_wave_number) + 1))
    local today=$(date +%Y-%m-%d)
    local task_count=$(echo "$tasks" | wc -w)

    local escaped_tasks
    escaped_tasks=$(escape_sed "$tasks")

    echo -e "${YELLOW}Creando Oleada $wave_num...${NC}"
    echo -e "  Tareas: $tasks"
    echo -e "  Total: $task_count tareas"

    # Actualizar archivo de oleadas
    sed_inplace "s/\*\*Numero:\*\* [0-9]*/\*\*Numero:\*\* $wave_num/" "$WAVES_FILE"
    sed_inplace "s/\*\*Estado:\*\* .*/\*\*Estado:\*\* En progreso/" "$WAVES_FILE"
    sed_inplace "s/\*\*Tareas:\*\* .*/\*\*Tareas:\*\* $escaped_tasks/" "$WAVES_FILE"

    echo -e "${GREEN}Oleada $wave_num creada${NC}"
    echo ""

    # Preguntar si crear branches
    read -p "Crear branches para cada tarea? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        create_branches "$tasks"
    fi
}

create_branches() {
    local tasks="$1"
    local base_branch="develop"

    echo -e "${YELLOW}Creando branches...${NC}"

    # Asegurar que estamos en develop
    git checkout "$base_branch" 2>/dev/null || git checkout -b "$base_branch"
    git pull origin "$base_branch" 2>/dev/null || true

    for task in $tasks; do
        local branch_name="feature/$(echo "$task" | tr '[:upper:]' '[:lower:]')"
        if git show-ref --verify --quiet "refs/heads/$branch_name"; then
            echo -e "  ${YELLOW}Branch $branch_name ya existe${NC}"
        else
            git checkout -b "$branch_name" "$base_branch"
            echo -e "  ${GREEN}Creado: $branch_name${NC}"
        fi
    done

    # Volver a develop
    git checkout "$base_branch"
    echo -e "${GREEN}Branches creados${NC}"
}

complete_wave() {
    local wave_num=$(get_current_wave_number)
    local today=$(date +%Y-%m-%d)
    local tasks=$(grep "^\*\*Tareas:\*\*" "$WAVES_FILE" | head -1 | sed 's/\*\*Tareas:\*\* //')

    local escaped_tasks
    escaped_tasks=$(escape_sed "$tasks")

    echo -e "${YELLOW}Completando Oleada $wave_num...${NC}"

    # Agregar al historial
    sed_inplace "/^|---|/a | $wave_num | $escaped_tasks | - | $today | Completada |" "$WAVES_FILE"

    # Resetear oleada actual
    sed_inplace "s/\*\*Estado:\*\* .*/\*\*Estado:\*\* Ninguna activa/" "$WAVES_FILE"
    sed_inplace "s/\*\*Tareas:\*\* .*/\*\*Tareas:\*\* -/" "$WAVES_FILE"

    echo -e "${GREEN}Oleada $wave_num completada${NC}"
}

# =============================================================================
# Main
# =============================================================================

case "${1:-}" in
    --help|-h)
        show_help
        ;;
    --list|-l)
        list_wave
        ;;
    --complete|-c)
        complete_wave
        ;;
    --create-branches|-b)
        tasks=$(grep "^\*\*Tareas:\*\*" "$WAVES_FILE" | head -1 | sed 's/\*\*Tareas:\*\* //')
        if [[ "$tasks" != "-" && -n "$tasks" ]]; then
            create_branches "$tasks"
        else
            echo -e "${RED}No hay tareas en la oleada actual${NC}"
        fi
        ;;
    "")
        show_help
        ;;
    *)
        create_wave "$1"
        ;;
esac
