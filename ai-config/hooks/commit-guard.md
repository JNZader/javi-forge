---
name: commit-guard
description: Valida que los mensajes de commit sigan el formato Conventional Commits antes de ejecutar git commit. Trigger: PreToolUse Bash
event: PreToolUse
tools:
  - Bash
match_pattern: "git commit"
action: warn
metadata:
  author: project-starter-framework
  version: "1.0"
---

# Commit Guard Hook

> Valida el formato Conventional Commits antes de ejecutar `git commit`.

## Propósito

Garantizar que todos los commits sigan el estándar Conventional Commits (`feat`, `fix`, `refactor`, etc.) para mantener un historial limpio y semver automático.

## Formato Válido

```
type(scope): descripción en imperativo

[cuerpo opcional]

[footer opcional]
```

### Tipos Permitidos

| Tipo | Cuándo usarlo |
|------|---------------|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `refactor` | Reestructuración sin cambio de comportamiento |
| `docs` | Solo documentación |
| `test` | Añadir o actualizar tests |
| `chore` | Build, CI, dependencias |
| `perf` | Mejora de performance |
| `style` | Formato, espacios (sin cambio lógico) |
| `ci` | Cambios en CI/CD |
| `revert` | Revertir commit anterior |

## Comportamiento

1. **Intercepta** comandos que contienen `git commit`
2. **Extrae** el mensaje de commit (`-m "..."`)
3. **Valida** contra el patrón `^(feat|fix|refactor|docs|test|chore|perf|style|ci|revert)(\(.+\))?: .{1,72}$`
4. **Alerta** si no cumple, muestra ejemplo correcto
5. **Permite** continuar (es warning, no block)

## Implementación Claude Code

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "echo \"$TOOL_INPUT\" | grep -q 'git commit' && echo \"$TOOL_INPUT\" | grep -oP '(?<=-m \")[^\"]+' | grep -qP '^(feat|fix|refactor|docs|test|chore|perf|style|ci|revert)(\\(.+\\))?: .{1,72}$' || (echo 'WARN: Mensaje no sigue Conventional Commits. Ejemplo: feat(auth): add login endpoint' && exit 0)" }]
      }
    ]
  }
}
```

## Ejemplos

### ✅ Válidos
```
feat(auth): add JWT refresh token endpoint
fix(api): handle null response from external service
refactor(db): extract query builder into separate module
docs: update README with new setup instructions
```

### ❌ Inválidos
```
"fixed stuff"
"WIP"
"update"
"Added new feature for the user authentication system"
```

## Notas

No bloquea el commit — es un recordatorio. Para enforcement estricto cambiar `action: warn` a `action: block`.
