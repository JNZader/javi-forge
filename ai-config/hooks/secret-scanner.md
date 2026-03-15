---
name: secret-scanner
description: Escanea archivos antes de escribir/editar para detectar secrets y credenciales. Trigger: PreToolUse Write/Edit
event: PreToolUse
tools:
  - Write
  - Edit
action: warn
metadata:
  author: project-starter-framework
  version: "1.0"
---

# Secret Scanner Hook

> Detecta secrets, tokens y credenciales antes de escribir archivos.

## Propósito

Prevenir que API keys, tokens, passwords y otras credenciales sean escritas en archivos del proyecto o commits.

## Patrones Detectados

| Patrón | Ejemplo |
|--------|---------|
| AWS keys | `AKIA[0-9A-Z]{16}` |
| Private keys | `-----BEGIN (RSA\|EC\|DSA) PRIVATE KEY-----` |
| Tokens Bearer | `Bearer [a-zA-Z0-9_-]{20,}` |
| GitHub PAT | `ghp_[a-zA-Z0-9]{36}` |
| Generic secret | `(secret\|password\|passwd\|pwd)\s*=\s*[^\s]{8,}` |
| API Key pattern | `api[_-]?key\s*=\s*[^\s]{8,}` |
| .env secrets | Variables en archivos `.env` con valores reales |

## Comportamiento

1. **Analiza** el contenido antes de escribir
2. **Detecta** patrones de secrets conocidos
3. **Alerta** al usuario con la línea problemática
4. **Sugiere** usar variables de entorno o `.env.example` en su lugar

## Implementación Claude Code

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [{ "type": "command", "command": "echo \"$TOOL_INPUT\" | python3 -c \"import sys,re; content=sys.stdin.read(); patterns=[r'AKIA[0-9A-Z]{16}', r'-----BEGIN.*(RSA|EC).PRIVATE', r'ghp_[a-zA-Z0-9]{36}', r'(?i)(password|secret|api_?key)\\s*=\\s*[\\S]{8,}']; found=[p for p in patterns if re.search(p,content)]; print('SECRET DETECTED: '+str(found)) if found else None; sys.exit(1 if found else 0)\"" }]
      }
    ]
  }
}
```

## Excepciones Legítimas

- Archivos `.env.example` con valores placeholder (`YOUR_KEY_HERE`)
- Archivos de test con datos ficticios (`fake-secret-for-testing`)
- Documentación que explica el formato (sin valores reales)

## Notas

Complementa al hook `block-dangerous-commands`. Para secrets reales usar siempre variables de entorno.
