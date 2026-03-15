---
name: verification-before-completion
description: >
  Ejecuta un checklist de verificación estándar antes de marcar una tarea como completa.
  Trigger: antes de terminar, marcar como done, cerrar tarea, completar feature, verification checklist
tools:
  - Bash
  - Read
metadata:
  author: project-starter-framework
  version: "1.0"
  tags: [workflow, quality, checklist, done]
  updated: "2026-02"
---

# Verification Before Completion Skill

## Propósito

Antes de declarar una tarea como completa, ejecutar un checklist sistemático para garantizar calidad y evitar regresiones.

## Checklist Universal

### 1. Tests
- [ ] Los tests unitarios pasan: `npm test` / `go test ./...` / `pytest`
- [ ] Los tests de integración pasan (si existen)
- [ ] No hay tests nuevos saltados o deshabilitados sin justificación
- [ ] La cobertura no decreció significativamente

### 2. Código
- [ ] El linter no reporta errores nuevos
- [ ] No hay `console.log`, `print()` o `fmt.Println` de debug sin remover
- [ ] No hay código comentado innecesario (está en git history)
- [ ] No hay TODOs sin resolver relacionados a esta tarea

### 3. Git
- [ ] Los cambios están en el branch correcto
- [ ] El branch está actualizado con el base branch (`git pull --rebase origin main`)
- [ ] No hay archivos staged innecesarios (`.env`, archivos generados)
- [ ] Los mensajes de commit siguen Conventional Commits

### 4. Funcionalidad
- [ ] La feature funciona en el happy path
- [ ] Los edge cases identificados están manejados
- [ ] El error handling es apropiado
- [ ] El comportamiento es consistent con los requerimientos

### 5. Documentación
- [ ] El README está actualizado si cambiaron instrucciones de setup
- [ ] Los cambios de API están documentados
- [ ] Los comentarios en código son correctos y útiles

## Comandos de Verificación Rápida

```bash
# Verificación completa en un solo bloque
git status && \
git diff --stat origin/main...HEAD && \
go test ./... 2>&1 | tail -5 && \
echo "=== VERIFICATION COMPLETE ==="
```

## Cuándo NO completar

- Si algún item del checklist falla → resolverlo primero
- Si hay dudas sobre el comportamiento → consultar antes de marcar done
- Si hay deuda técnica significativa introducida → crear issue para tracking

## Related Skills

- git-github
- git-workflow
- finishing-a-development-branch
