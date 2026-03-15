---
name: ghagga-review
description: >
  AI code review patterns with GHAGGA multi-agent review system.
  Trigger: code review, PR review, GHAGGA, review automatico, consensus review

metadata:
  author: project-starter-framework
  version: "1.0"
  tags: [code-review, ai, github, quality]
  language: typescript
  scope: [.github/, supabase/, dashboard/]
---

# GHAGGA AI Code Review

> Patrones para trabajar con GHAGGA, sistema de code review multi-agente.

## When to Use

Usar este skill cuando:

- [ ] Configurando GHAGGA para un proyecto
- [ ] Creando reglas de review personalizadas
- [ ] Trabajando con Edge Functions de review
- [ ] Integrando GHAGGA en CI/CD pipeline
- [ ] Debuggeando reviews fallidas

## Critical Patterns

### Pattern 1: Reusable Workflow Integration

**Por que:** Integrar GHAGGA como paso de CI evita configuracion manual por repo.

```yaml
# .github/workflows/ci.yml
jobs:
  # ... build jobs ...

  review:
    needs: build
    if: github.event_name == 'pull_request'
    uses: JNZader/project-starter-framework/.github/workflows/reusable-ghagga-review.yml@main
    with:
      ghagga-url: ${{ vars.GHAGGA_URL }}
      review-mode: simple
    secrets:
      ghagga-token: ${{ secrets.GHAGGA_TOKEN }}
```

### Pattern 2: Review Mode Selection

**Por que:** Cada modo tiene diferente profundidad y costo.

```typescript
// Simple: 1 LLM, rapido, bajo costo
{ review_mode: "simple" }

// Workflow: multi-paso secuencial, analisis profundo
{ review_mode: "workflow" }

// Consensus: multiples LLMs votan, maxima confiabilidad
{ review_mode: "consensus" }
```

**Criterio de seleccion:**
- PRs chicos (< 100 lineas): `simple`
- PRs medianos o con logica compleja: `workflow`
- PRs criticos (auth, payments, infra): `consensus`

### Pattern 3: Custom Review Rules via Dashboard

**Por que:** Reglas custom evitan falsos positivos recurrentes.

```typescript
// Configurar en dashboard (http://localhost:5173/ghagga/)
// Settings > Review Rules > Add Rule

// Ejemplo: ignorar cambios en archivos generados
{
  "name": "skip-generated",
  "pattern": "**/*.generated.*",
  "action": "skip"
}

// Ejemplo: review estricto en archivos de seguridad
{
  "name": "strict-security",
  "pattern": "**/auth/**",
  "action": "consensus",
  "severity": "high"
}
```

## Code Examples

### Example 1: Trigger review via API

```typescript
// Desde una Edge Function o script
const response = await fetch(`${GHAGGA_URL}/functions/v1/review`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${GHAGGA_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    repository: "owner/repo",
    pull_request_number: 42,
    head_sha: "abc123",
    review_mode: "workflow",
  }),
});

const result = await response.json();
// { status: "completed", summary: "...", findings: [...] }
```

### Example 2: Configurar providers en Supabase

```sql
-- En Supabase SQL Editor o migracion
INSERT INTO review_providers (name, model, api_key_env, priority)
VALUES
  ('anthropic', 'claude-sonnet-4-20250514', 'ANTHROPIC_API_KEY', 1),
  ('openai', 'gpt-4o', 'OPENAI_API_KEY', 2),
  ('google', 'gemini-2.0-flash', 'GOOGLE_API_KEY', 3);
```

### Example 3: Webhook handler pattern

```typescript
// supabase/functions/webhook/index.ts
import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  const event = req.headers.get("x-github-event");
  const payload = await req.json();

  if (event === "pull_request" && ["opened", "synchronize"].includes(payload.action)) {
    // Trigger review
    await triggerReview({
      repo: payload.repository.full_name,
      pr: payload.pull_request.number,
      sha: payload.pull_request.head.sha,
    });
  }

  return new Response("ok", { status: 200 });
});
```

## Anti-Patterns

### Anti-Pattern 1: Review en cada commit

**Problema:** Consume API tokens innecesariamente, genera ruido.

```yaml
# NO: trigger en cada push
on:
  push:
    branches: ['**']

# SI: solo PRs a branches principales
on:
  pull_request:
    branches: [main, develop]
```

### Anti-Pattern 2: Consensus mode para todo

**Problema:** Costo x3, tiempo x3, para cambios triviales.

```typescript
// NO: consensus para todo
{ review_mode: "consensus" }

// SI: escalar segun criticidad
const mode = isCriticalPath(files)
  ? "consensus"
  : changedLines > 100
    ? "workflow"
    : "simple";
```

## Quick Reference

| Tarea | Como |
|-------|------|
| Setup basico | `./optional/ghagga/setup-ghagga.sh --workflow` |
| Deploy local | `docker compose -f docker-compose.ghagga.yml up -d` |
| Dashboard | `http://localhost:5173/ghagga/` |
| Ver logs | `supabase functions logs review` |
| Test webhook | `curl -X POST localhost:54321/functions/v1/webhook` |

## Resources

- [GHAGGA Repository](https://github.com/JNZader/ghagga/)
- [Installation Guide](https://github.com/JNZader/ghagga/blob/main/docs/INSTALLATION.md)
- [API Documentation](https://github.com/JNZader/ghagga/blob/main/docs/API.md)
- [GitHub App Setup](https://github.com/JNZader/ghagga/blob/main/docs/GITHUB_APP_SETUP.md)

---

## Related Skills

- `devops-infra`: CI/CD y GitHub Actions workflows
- `git-github`: GitHub API y CLI
- `playwright-e2e`: Testing E2E (complemento a AI review)

---

## Changelog

- **1.0** - Version inicial con patrones de integracion
