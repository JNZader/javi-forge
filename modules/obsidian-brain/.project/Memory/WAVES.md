---
type: waves
updated: "[FECHA]"
---

# Oleadas de Trabajo

> Registro historico de oleadas de tareas paralelas.
> Para gestion dia a dia, usar [[KANBAN]]. WAVES.md es el historial de oleadas completadas.

---

## Oleada Actual

**Numero:** 0
**Estado:** Ninguna activa
**Tareas:** -
**Branches:** -
**Inicio:** -

---

## Como usar oleadas

### 1. Analizar dependencias

```
Tareas disponibles:
- T-001: Setup monorepo          (sin deps)
- T-002: Configurar CI           (depende de T-001)
- T-003: Agregar linters         (depende de T-001)
- T-004: Docker compose          (sin deps)
- T-005: Integrar linters en CI  (depende de T-002, T-003)
```

### 2. Agrupar en oleadas

```
Oleada 1: T-001, T-004  (sin dependencias entre si)
Oleada 2: T-002, T-003  (dependen solo de T-001)
Oleada 3: T-005         (depende de oleada 2)
```

### 3. Ejecutar

```bash
# Crear oleada
./scripts/new-wave.sh "T-001 T-004"

# Crear branches
./scripts/new-wave.sh --create-branches

# Trabajar en paralelo...

# Completar y merge
./scripts/new-wave.sh --complete
```

---

## Historial

| # | Tareas | Inicio | Fin | Estado |
|---|--------|--------|-----|--------|
| - | - | - | - | - |

---

## Tips

- **Maximo recomendado:** 5-7 tareas por oleada para mantener foco
- **Sin limite tecnico:** El sistema soporta cualquier cantidad
- **Merge order:** Mergear a develop cuando todas las tareas de la oleada esten listas
- **Conflictos:** Si hay conflictos entre branches de la misma oleada, revisar dependencias

---

*Ultima actualizacion: [FECHA]*
