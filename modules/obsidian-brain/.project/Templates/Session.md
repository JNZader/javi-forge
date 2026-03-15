---
type: session
date: "<% tp.date.now("YYYY-MM-DD") %>"
phase: "<% await tp.system.prompt("Fase del proyecto (Foundation/MVP/Alpha/Beta)") %>"
wave: "<% await tp.system.prompt("Numero de oleada actual") %>"
---

# Sesion - <% tp.date.now("YYYY-MM-DD") %>

---

## Contexto Inicial

| Campo | Valor |
|-------|-------|
| **Fase** | <% await tp.system.prompt("Fase del proyecto") %> |
| **Oleada** | <% await tp.system.prompt("Oleada actual") %> |
| **Branch** | <% await tp.system.prompt("Branch activo") %> |
| **Tiempo Disponible** | <% await tp.system.prompt("Tiempo disponible (ej: 2 horas)") %> |

---

## Objetivos

- [ ] <% await tp.system.prompt("Objetivo principal de la sesion") %>
- [ ]
- [ ]

---

## Tareas Trabajadas

### [T-XXX] - [Titulo]

| Campo | Valor |
|-------|-------|
| Inicio | <% tp.date.now("HH:mm") %> |
| Fin | |
| Estado | En progreso |

**Cambios:**
-

**Commits:**
-

---

## Problemas

_(Completar si aparecen problemas)_

---

## Decisiones

_(Completar si se toman decisiones)_

---

## Aprendizajes

-

---

## Proxima Sesion

### Continuar:
- [ ]

### Preparar:
- [ ]

---

## Resumen

| Metrica | Valor |
|---------|-------|
| Tiempo total | |
| Tareas completadas | |
| Commits | |
| Blockers | |

---

*Fin de sesion: *
