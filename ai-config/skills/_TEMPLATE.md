---
# =============================================================================
# SKILL TEMPLATE (Gentleman-Skills Compatible)
# =============================================================================
# Formato compatible con: https://github.com/Gentleman-Programming/Gentleman-Skills
#
# ESTRUCTURA DE CARPETA:
#   .ai-config/skills/{category}/{skill-name}/
#   └── SKILL.md          ← este archivo
#   └── assets/           ← opcional: templates, schemas, ejemplos
#   └── references/       ← opcional: links a docs locales
# =============================================================================

name: mi-skill
description: >
  Descripción breve del skill.
  Trigger: Contexto que activa este skill (ej: "trabajando con React")

metadata:
  author: tu-usuario-github
  version: "1.0"
  tags: [frontend, backend, testing]
  language: typescript  # typescript | python | go | rust | java
---

# [Nombre del Skill]

> [Descripción de una línea de lo que hace este skill]

## When to Use

Usar este skill cuando:

- [ ] Condición 1 (ej: "Editando archivos .tsx")
- [ ] Condición 2 (ej: "Creando componentes React")
- [ ] Condición 3 (ej: "Implementando estado con hooks")

## Critical Patterns

### Pattern 1: [Nombre del patrón]

**Por qué:** [Explicación de por qué este patrón es importante]

```typescript
// ✅ Correcto
[código ejemplo correcto]

// ❌ Incorrecto
[código ejemplo incorrecto]
```

### Pattern 2: [Nombre del patrón]

**Por qué:** [Explicación]

```typescript
// ✅ Correcto
[código]
```

### Pattern 3: [Nombre del patrón]

**Por qué:** [Explicación]

```typescript
// ✅ Correcto
[código]
```

## Code Examples

### Example 1: [Título descriptivo]

```typescript
// Ejemplo completo y funcional
// Con comentarios explicativos

[código completo]
```

### Example 2: [Título descriptivo]

```typescript
[código completo]
```

### Example 3: [Título descriptivo]

```typescript
[código completo]
```

## Anti-Patterns

### ❌ Anti-Pattern 1: [Nombre]

**Problema:** [Por qué es malo]

```typescript
// ❌ No hacer esto
[código malo]

// ✅ Hacer esto en su lugar
[código bueno]
```

### ❌ Anti-Pattern 2: [Nombre]

**Problema:** [Por qué es malo]

```typescript
// ❌ Evitar
[código malo]
```

## Quick Reference

| Tarea | Snippet |
|-------|---------|
| [Tarea 1] | `[código corto]` |
| [Tarea 2] | `[código corto]` |
| [Tarea 3] | `[código corto]` |

## Resources

- [Documentación Oficial](URL)
- [Guía de Mejores Prácticas](URL)
- [Repositorio de Ejemplos](URL)

---

## Related Skills

- `related-skill-1`: Descripción breve de cuándo usar
- `related-skill-2`: Descripción breve de cuándo usar
- `related-skill-3`: Descripción breve de cuándo usar

---

## Changelog

- **1.0** - Versión inicial

---

## Progressive Disclosure Pattern (Optional)

For complex skills, split content into references/:
```
skills/my-skill/
├── SKILL.md          # Core logic only (~150 lines max)
└── references/
    ├── examples.md   # Concrete examples (loaded on demand)
    └── patterns.md   # Advanced patterns (loaded on demand)
```
In SKILL.md, reference them with:
> For examples, see [references/examples.md](references/examples.md)
