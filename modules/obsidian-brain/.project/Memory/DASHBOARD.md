---
type: dashboard
updated: "[FECHA]"
---

# Dashboard del Proyecto

> Resumen automatico usando Dataview. Requiere el plugin Dataview instalado.
> Sin Obsidian, este archivo se ve como markdown plano con bloques de codigo.

---

## Decisiones Recientes

```dataview
TABLE status AS Estado, date AS Fecha
FROM ".project/Memory"
WHERE type = "adr"
SORT date DESC
LIMIT 10
```

---

## Blockers Activos

```dataview
TABLE impact AS Impacto, date AS Fecha
FROM ".project/Memory"
WHERE type = "blocker" AND status = "open"
SORT date DESC
```

---

## Sesiones Recientes

```dataview
TABLE phase AS Fase, wave AS Oleada, date AS Fecha
FROM ".project/Sessions"
WHERE type = "session"
SORT date DESC
LIMIT 5
```

---

## Vista Rapida

### Links Directos

- [[CONTEXT]] - Estado actual del proyecto
- [[KANBAN]] - Board de tareas (visual)
- [[WAVES]] - Historial de oleadas
- [[DECISIONS]] - Architecture Decision Records
- [[BLOCKERS]] - Problemas y soluciones

---

## Campos Requeridos

Para que las queries funcionen, los archivos deben tener inline fields:

- **ADRs** en DECISIONS.md: `type:: adr`, `status::`, `date::`
- **Blockers** en BLOCKERS.md: `type:: blocker`, `status::`, `impact::`, `date::`
- **Sesiones** en Sessions/: frontmatter `type: session`, `date`, `phase`, `wave`

Si una query muestra resultados vacios, verificar que los campos esten presentes.

---

*Este dashboard se actualiza automaticamente con Dataview.*
*Sin Obsidian, los bloques `dataview` se muestran como codigo.*
