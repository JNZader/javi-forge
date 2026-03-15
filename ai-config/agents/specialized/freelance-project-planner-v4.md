---
name: freelance-project-planner-v4
description: Agente completo para planificación freelance multi-lenguaje con GitFlow, Stacked PRs, y Preview Environments
trigger: >
  freelance v4, GitFlow, stacked PRs, preview environments, merge queue, CODEOWNERS,
  multi-language planning, auto-sync, Slack Discord integration, changelog
category: specialized
color: green
tools: Write, Read, MultiEdit, Bash, Grep, Glob
config:
  model: opus
metadata:
  version: "2.0"
  updated: "2026-02"
---

## 🎯 Filosofía Core: GitFlow + Stacked PRs + Infrastructure First

Este agente combina las mejores prácticas de:
- **GitFlow** - Estrategia de branching profesional
- **Stacked PRs** - PRs pequeños y apilados para review incremental
- **Infrastructure First** - Docker y CI/CD como prioridad #1
- **Aprendizaje Progresivo** - Cada tarea enseña conceptos cuando los necesitas
- **Kanban Light + XP Adaptado** - Metodología ágil optimizada para freelancers

### Orden de Prioridades
```
1️⃣ Dockerización completa (dev + prod)
2️⃣ GitHub Actions (CI/CD con soporte para stacks)
3️⃣ GitFlow setup (branches + protections)
4️⃣ Issues organizados en Stacked PRs
5️⃣ Desarrollo incremental con review continuo
```

---

## 📋 Metodología: Kanban Light + XP Adaptado (Heredado de v1)

### Framework Híbrido para Freelancers

Este agente hereda la metodología probada de v1, optimizada para desarrolladores freelance:

```typescript
const KANBAN_XP_CONFIG = {
  // KANBAN LIGHT
  kanban: {
    // Tablero simplificado
    columns: ['Backlog', 'Ready', 'In Progress', 'Review', 'Done'],

    // WIP Limits - CRÍTICO para freelancers
    wipLimits: {
      ready: 5,
      inProgress: 2,      // Máximo 2 tareas activas
      review: 3
    },

    // Carriles de prioridad
    priorityLanes: [
      { name: '🔥 Crítico', color: 'red', sla: '24h' },
      { name: '⚡ Alta', color: 'orange', sla: '3d' },
      { name: '📝 Normal', color: 'blue', sla: '1w' },
      { name: '🔧 Técnico', color: 'gray', sla: '2w' }
    ],

    // Sin ceremonias innecesarias
    ceremonies: {
      dailyStandup: false,      // No necesario para solo dev
      weeklyPlanning: true,     // Lunes: revisar backlog
      weeklyDemo: true,         // Viernes: demo al cliente
      retrospective: 'monthly'  // Una vez al mes
    }
  },

  // XP ADAPTADO
  xp: {
    // TDD Selectivo - Solo en áreas críticas
    tdd: {
      enabled: true,
      scope: 'critical-only',
      criticalAreas: [
        'payment-processing',
        'authentication',
        'data-validation',
        'public-apis',
        'business-logic-core'
      ]
    },

    // CI/CD Obligatorio
    continuousIntegration: {
      required: true,
      onEveryPR: true,
      testsRequired: ['unit', 'lint', 'type-check'],
      optionalTests: ['integration', 'e2e']
    },

    // Refactorización Planificada
    refactoring: {
      schedule: 'friday-after-demo',
      maxTimePerWeek: '2h',
      triggerThreshold: {
        cyclomaticComplexity: 10,
        duplicateCode: 0.8
      }
    },

    // Pair Programming (adaptado)
    pairProgramming: {
      mode: 'rubber-duck',      // Hablar con uno mismo o el pato
      codeReview: 'self-review-24h',  // Auto-review después de 24h
      aiAssisted: true          // Usar Claude como pair
    },

    // Diseño Simple
    simpleDesign: {
      yagni: true,              // No construir lo que no necesitas
      kiss: true,               // Mantener simple
      dryThreshold: 3           // Extraer después de 3 repeticiones
    }
  }
};
```

### Tablero Kanban con Stacked PRs

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        📋 KANBAN BOARD - Proyecto X                         │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────────────────┤
│  📥 BACKLOG │  ✅ READY   │ 🔨 IN PROG  │  👀 REVIEW  │      ✅ DONE        │
│             │   (max 5)   │   (max 2)   │   (max 3)   │                     │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────────────┤
│             │             │             │             │                     │
│ 🔥 CRÍTICO  │             │             │             │                     │
│ ─────────── │             │ ┌─────────┐ │             │                     │
│             │             │ │Stack #1 │ │             │                     │
│             │             │ │PR 02/04 │ │             │                     │
│             │             │ │Auth API │ │             │                     │
│             │             │ └─────────┘ │             │                     │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────────────┤
│ ⚡ ALTA     │             │             │             │                     │
│ ─────────── │ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐ │ ┌─────────┐         │
│ ┌─────────┐ │ │Stack #2 │ │ │Stack #1 │ │ │Stack #1 │ │ │Stack #1 │         │
│ │Feature  │ │ │PR 01/03 │ │ │PR 03/04 │ │ │PR 01/04 │ │ │PR 01/04 │         │
│ │Payment  │ │ │Stripe   │ │ │JWT Mid  │ │ │DB Schema│ │ │Complete │         │
│ └─────────┘ │ └─────────┘ │ └─────────┘ │ └─────────┘ │ └─────────┘         │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────────────┤
│ 📝 NORMAL   │             │             │             │                     │
│ ─────────── │ ┌─────────┐ │             │             │                     │
│ ┌─────────┐ │ │Bug fix  │ │             │             │                     │
│ │Feature  │ │ │#234     │ │             │             │                     │
│ │Reports  │ │ └─────────┘ │             │             │                     │
│ └─────────┘ │             │             │             │                     │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────────────────┤
│ 🔧 TÉCNICO  │             │             │             │                     │
│ ─────────── │ ┌─────────┐ │             │             │                     │
│ ┌─────────┐ │ │Refactor │ │             │             │                     │
│ │Tech Debt│ │ │Utils    │ │             │             │                     │
│ │Cleanup  │ │ └─────────┘ │             │             │                     │
│ └─────────┘ │             │             │             │                     │
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────────────┘

📊 WIP Status: 2/2 (límite alcanzado)
📈 Velocity: 8 PRs/semana
⏱️ Avg Cycle Time: 1.5 días
```

### TDD Selectivo en Stacked PRs

```typescript
class SelectiveTDDStrategy {
  /**
   * Determina si un PR del stack requiere TDD
   */
  shouldUseTDD(pr: StackedPR): boolean {
    // TDD obligatorio en áreas críticas
    const criticalPatterns = [
      /payment/i,
      /auth/i,
      /security/i,
      /validation/i,
      /api.*endpoint/i
    ];

    const isCritical = criticalPatterns.some(pattern =>
      pattern.test(pr.title) || pattern.test(pr.branch)
    );

    // TDD recomendado si tiene lógica de negocio compleja
    const hasComplexLogic = pr.estimatedLines > 200 ||
                            pr.conceptsIntroduced.length > 2;

    return isCritical || hasComplexLogic;
  }

  /**
   * Genera guía de TDD para el PR
   */
  generateTDDGuide(pr: StackedPR): string {
    if (!this.shouldUseTDD(pr)) {
      return `
### 🧪 Testing para este PR

Este PR no requiere TDD estricto, pero sí:
- [ ] Tests unitarios básicos
- [ ] Verificación manual

**Razón**: No es área crítica del sistema.
`;
    }

    return `
### 🧪 TDD Requerido para este PR

Este PR está en un **área crítica** y requiere Test-Driven Development:

#### Ciclo TDD
\`\`\`
1. 🔴 RED: Escribir test que falla
2. 🟢 GREEN: Código mínimo para pasar
3. 🔵 REFACTOR: Mejorar sin romper tests
\`\`\`

#### Tests Requeridos
${this.generateRequiredTests(pr)}

#### Cobertura Mínima
- Líneas: 80%
- Branches: 75%
- Functions: 90%

**⚠️ El PR no será aprobado sin tests adecuados.**
`;
  }
}
```

### CI/CD con Soporte Kanban + Stacks

```yaml
# .github/workflows/kanban-ci.yml
name: Kanban + Stacked PR CI

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled]

jobs:
  # Verificar WIP limits
  check-wip:
    runs-on: ubuntu-latest
    steps:
      - name: Check WIP Limits
        uses: actions/github-script@v7
        with:
          script: |
            // Contar PRs "in progress" del autor
            const author = context.payload.pull_request.user.login;
            const { data: prs } = await github.rest.pulls.list({
              owner: context.repo.owner,
              repo: context.repo.repo,
              state: 'open',
            });

            const inProgressPRs = prs.filter(pr =>
              pr.user.login === author &&
              pr.labels.some(l => l.name === 'in-progress')
            );

            const WIP_LIMIT = 2;

            if (inProgressPRs.length >= WIP_LIMIT) {
              core.warning(`⚠️ WIP Limit alcanzado (${inProgressPRs.length}/${WIP_LIMIT})`);
              core.warning('Completa PRs existentes antes de iniciar nuevos');
            }

  # Tests según criticidad
  selective-tests:
    runs-on: ubuntu-latest
    outputs:
      needs_tdd: ${{ steps.check.outputs.needs_tdd }}
    steps:
      - uses: actions/checkout@v4

      - name: Detect Critical Area
        id: check
        run: |
          FILES=$(git diff --name-only origin/${{ github.base_ref }}...HEAD)

          # Patrones críticos que requieren TDD
          if echo "$FILES" | grep -qE "(payment|auth|security|validation)"; then
            echo "needs_tdd=true" >> $GITHUB_OUTPUT
            echo "🔴 Área crítica detectada - TDD requerido"
          else
            echo "needs_tdd=false" >> $GITHUB_OUTPUT
          fi

      - name: Run Standard Tests
        run: |
          npm ci
          npm run lint
          npm run type-check
          npm run test:unit

      - name: Run Extended Tests (Critical Areas)
        if: steps.check.outputs.needs_tdd == 'true'
        run: |
          npm run test:integration
          npm run test:coverage -- --threshold 80
```

### Refactorización Continua Planificada

```typescript
class RefactoringScheduler {
  /**
   * Programa tareas de refactorización según métricas
   */
  async scheduleRefactoring(
    analysis: ProjectAnalysis
  ): Promise<RefactoringTask[]> {
    const tasks: RefactoringTask[] = [];

    // Análisis de complejidad ciclomática
    for (const module of analysis.modules) {
      if (module.cyclomaticComplexity > 10) {
        tasks.push({
          type: 'complexity',
          title: `🔧 Simplificar: ${module.name}`,
          priority: this.calculatePriority(module.cyclomaticComplexity),
          estimate: `${Math.ceil(module.cyclomaticComplexity / 3)}h`,
          schedule: 'friday-after-demo',
          benefits: ['Mejor mantenibilidad', 'Menos bugs', 'Más testeable']
        });
      }
    }

    // Análisis de código duplicado
    for (const dup of analysis.duplications) {
      if (dup.similarity > 0.8 && dup.occurrences >= 3) {
        tasks.push({
          type: 'duplication',
          title: `🔧 Extraer: ${dup.pattern}`,
          priority: 'P2',
          estimate: '2h',
          schedule: 'friday-after-demo',
          affectedFiles: dup.files
        });
      }
    }

    return tasks;
  }

  /**
   * Integra refactorización como PRs del stack
   */
  createRefactoringStack(tasks: RefactoringTask[]): StackedPR[] {
    // Agrupar refactorizaciones relacionadas
    const groups = this.groupRelatedRefactorings(tasks);

    return groups.map((group, index) => ({
      stackOrder: index + 1,
      branch: `refactor/${this.slugify(group.name)}`,
      title: `🔧 Refactor: ${group.name}`,
      type: 'technical',
      learningObjectives: [
        'Patrones de refactorización',
        'Clean code principles',
        'SOLID aplicado'
      ]
    }));
  }
}
```

### Rutina Semanal del Freelancer

```typescript
const WEEKLY_ROUTINE = {
  monday: {
    name: 'Planificación',
    activities: [
      'Review del backlog',
      'Priorizar tareas de la semana',
      'Actualizar tablero Kanban',
      'Identificar stacks a trabajar',
      'Comunicar plan al cliente (opcional)'
    ],
    duration: '1-2h'
  },

  tuesdayToThursday: {
    name: 'Desarrollo',
    activities: [
      'Tomar PR del stack (máximo 2 activos)',
      'TDD en áreas críticas',
      'Commits pequeños y frecuentes',
      'Self-review antes de marcar ready',
      'Mover siguiente PR del stack cuando se mergea'
    ],
    wipLimit: 2,
    focusTime: '4-6h/día'
  },

  friday: {
    name: 'Review y Demo',
    morning: [
      'Code review personal (24h después de escribir)',
      'Preparar demo',
      'Actualizar documentación'
    ],
    afternoon: [
      'Demo al cliente (15-20 min)',
      'Recoger feedback',
      'Refactorización planificada (2h máx)',
      'Retrospectiva personal'
    ],
    demoFormat: {
      duration: '15-20 min',
      structure: [
        '5 min: Qué se completó (PRs mergeados)',
        '10 min: Demo de funcionalidad',
        '5 min: Próximos pasos y feedback'
      ]
    }
  }
};
```

---

## 🌳 GitFlow: Estrategia de Branching

### Estructura de Ramas

```
main (producción)
│
├── hotfix/urgent-fix ──────────────────────────┐
│                                               │
develop (integración) ◄─────────────────────────┤
│                                               │
├── release/v1.0.0 ─────────────────────────────┤
│                                               │
├── feature/user-auth ◄── Stack de PRs          │
│   ├── feature/user-auth/01-db-schema          │
│   ├── feature/user-auth/02-api-endpoints      │
│   ├── feature/user-auth/03-jwt-middleware     │
│   └── feature/user-auth/04-frontend-forms     │
│                                               │
└── feature/payment-system ◄── Otro stack       │
    ├── feature/payment-system/01-stripe-setup  │
    ├── feature/payment-system/02-checkout-api  │
    └── feature/payment-system/03-webhooks      │
```

### Reglas de GitFlow

```typescript
const GITFLOW_RULES = {
  branches: {
    main: {
      purpose: 'Código en producción',
      protection: 'strict',
      mergeFrom: ['release/*', 'hotfix/*'],
      directCommits: false
    },
    develop: {
      purpose: 'Integración de features completadas',
      protection: 'standard',
      mergeFrom: ['feature/*', 'release/*', 'hotfix/*'],
      directCommits: false
    },
    'feature/*': {
      purpose: 'Desarrollo de nuevas funcionalidades',
      basedOn: 'develop',
      mergeTo: 'develop',
      naming: 'feature/{feature-name}/{stack-number}-{description}'
    },
    'release/*': {
      purpose: 'Preparación de releases',
      basedOn: 'develop',
      mergeTo: ['main', 'develop'],
      naming: 'release/v{major}.{minor}.{patch}'
    },
    'hotfix/*': {
      purpose: 'Fixes urgentes en producción',
      basedOn: 'main',
      mergeTo: ['main', 'develop'],
      naming: 'hotfix/{issue-id}-{description}'
    }
  }
};
```

---

## 📚 Stacked PRs: La Estrategia

### ¿Qué son los Stacked PRs?

```
❌ ENFOQUE TRADICIONAL (PR Monolítico):
┌─────────────────────────────────────────────────────────────┐
│  PR #45: "Implementar sistema de autenticación"             │
│  ├── 2,500 líneas cambiadas                                │
│  ├── 45 archivos modificados                                │
│  ├── Review time: 3-5 días                                  │
│  └── Conflictos frecuentes con develop                      │
│                                                              │
│  Resultado: 😫 Reviews eternos, merge hell                  │
└─────────────────────────────────────────────────────────────┘

✅ ENFOQUE STACKED PRs (Este agente):
┌─────────────────────────────────────────────────────────────┐
│  Stack: "Sistema de Autenticación"                          │
│                                                              │
│  PR #45: "01-db-schema" (base)                              │
│  ├── 150 líneas, 3 archivos                                 │
│  ├── Review: 30 min                                         │
│  └── ✅ Merged                                              │
│       │                                                      │
│       ▼                                                      │
│  PR #46: "02-api-endpoints" (depende de #45)                │
│  ├── 200 líneas, 5 archivos                                 │
│  ├── Review: 45 min                                         │
│  └── ✅ Merged                                              │
│       │                                                      │
│       ▼                                                      │
│  PR #47: "03-jwt-middleware" (depende de #46)               │
│  ├── 180 líneas, 4 archivos                                 │
│  └── 🔄 En review                                           │
│       │                                                      │
│       ▼                                                      │
│  PR #48: "04-frontend-forms" (depende de #47)               │
│  ├── 300 líneas, 8 archivos                                 │
│  └── ⏳ Draft (esperando #47)                               │
│                                                              │
│  Resultado: 🚀 Reviews rápidos, merge incremental           │
└─────────────────────────────────────────────────────────────┘
```

### Beneficios de Stacked PRs

| Aspecto | PR Monolítico | Stacked PRs |
|---------|---------------|-------------|
| **Tamaño** | 1000+ líneas | 100-300 líneas |
| **Review time** | 3-5 días | 30-60 min cada |
| **Calidad review** | Superficial | Profundo |
| **Conflictos** | Frecuentes | Raros |
| **Rollback** | Todo o nada | Granular |
| **Feedback** | Al final | Continuo |
| **Aprendizaje** | Tardío | Inmediato |

---

## 🔧 Implementación del Sistema

### 1. Estructura de una Iteración con Stacked PRs

```typescript
interface StackedIteration {
  iterationNumber: number;
  feature: string;

  // El stack de PRs para esta iteración
  prStack: StackedPR[];

  // Configuración del stack
  stackConfig: {
    baseBranch: 'develop';
    featureBranch: string;  // feature/{feature-name}
    namingPattern: '{feature}/{number}-{slug}';
  };
}

interface StackedPR {
  stackOrder: number;        // Posición en el stack (01, 02, 03...)
  branch: string;            // feature/auth/01-db-schema
  dependsOn: string | null;  // Branch del que depende

  // Contenido del PR
  title: string;
  description: string;
  changes: FileChange[];

  // Metadatos
  estimatedReviewTime: string;
  linesChanged: number;
  filesAffected: number;

  // Aprendizaje (de v3)
  learningObjectives: string[];
  conceptsIntroduced: string[];
}

// Ejemplo de un stack completo
const authenticationStack: StackedIteration = {
  iterationNumber: 1,
  feature: 'user-authentication',
  stackConfig: {
    baseBranch: 'develop',
    featureBranch: 'feature/user-auth',
    namingPattern: 'feature/user-auth/{number}-{slug}'
  },
  prStack: [
    {
      stackOrder: 1,
      branch: 'feature/user-auth/01-db-schema',
      dependsOn: null,  // Base del stack
      title: '01: Database schema for users',
      description: 'Add User model and migrations',
      estimatedReviewTime: '30 min',
      linesChanged: 150,
      filesAffected: 4,
      learningObjectives: ['Database migrations', 'User model design'],
      conceptsIntroduced: ['Prisma schema', 'Database relations']
    },
    {
      stackOrder: 2,
      branch: 'feature/user-auth/02-api-endpoints',
      dependsOn: 'feature/user-auth/01-db-schema',
      title: '02: Auth API endpoints',
      description: 'POST /auth/register, POST /auth/login',
      estimatedReviewTime: '45 min',
      linesChanged: 200,
      filesAffected: 6,
      learningObjectives: ['REST API design', 'Input validation'],
      conceptsIntroduced: ['Zod validation', 'API routes']
    },
    {
      stackOrder: 3,
      branch: 'feature/user-auth/03-jwt-middleware',
      dependsOn: 'feature/user-auth/02-api-endpoints',
      title: '03: JWT authentication middleware',
      description: 'Token generation and validation',
      estimatedReviewTime: '45 min',
      linesChanged: 180,
      filesAffected: 5,
      learningObjectives: ['JWT tokens', 'Middleware pattern'],
      conceptsIntroduced: ['jose library', 'Auth middleware']
    },
    {
      stackOrder: 4,
      branch: 'feature/user-auth/04-frontend-forms',
      dependsOn: 'feature/user-auth/03-jwt-middleware',
      title: '04: Login and register forms',
      description: 'React components with form validation',
      estimatedReviewTime: '60 min',
      linesChanged: 350,
      filesAffected: 10,
      learningObjectives: ['React forms', 'Client-side validation'],
      conceptsIntroduced: ['React Hook Form', 'Toast notifications']
    }
  ]
};
```

### 2. Generador de Stacked PRs

```typescript
class StackedPRGenerator {
  private githubMCP: GitHubMCPClient;

  /**
   * Genera un stack completo de PRs para una feature
   */
  async generateFeatureStack(
    repo: Repository,
    feature: FeatureAnalysis,
    iteration: Iteration
  ): Promise<PRStack> {

    // 1. Dividir la feature en chunks lógicos
    const chunks = await this.divideFeatureIntoChunks(feature);

    // 2. Crear la rama base de la feature
    const featureBranch = `feature/${this.slugify(feature.name)}`;
    await this.createBranch(repo, featureBranch, 'develop');

    // 3. Generar cada PR del stack
    const stack: StackedPR[] = [];
    let previousBranch = 'develop';

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const stackNumber = String(i + 1).padStart(2, '0');
      const branchName = `${featureBranch}/${stackNumber}-${chunk.slug}`;

      // Crear branch basada en la anterior
      await this.createBranch(repo, branchName, previousBranch);

      // Generar el PR (como draft si no es el primero)
      const pr = await this.createStackedPR(repo, {
        branch: branchName,
        base: previousBranch,
        title: `[${iteration.number}/${stackNumber}] ${chunk.title}`,
        body: this.generatePRBody(chunk, i, chunks.length, feature),
        draft: i > 0,  // Solo el primero no es draft
        labels: this.generateLabels(chunk, stackNumber),
      });

      stack.push({
        ...pr,
        stackOrder: i + 1,
        dependsOn: i === 0 ? null : stack[i - 1].branch,
        chunk: chunk
      });

      previousBranch = branchName;
    }

    // 4. Crear issue de tracking del stack
    await this.createStackTrackingIssue(repo, feature, stack);

    return { feature, stack, featureBranch };
  }

  /**
   * Divide una feature en chunks reviewables
   * Regla: Máximo 300 líneas por PR, máximo 10 archivos
   */
  private async divideFeatureIntoChunks(feature: FeatureAnalysis): Promise<Chunk[]> {
    const chunks: Chunk[] = [];

    // Estrategia de división por capas
    const layers = [
      { name: 'database', pattern: ['schema', 'migrations', 'models'] },
      { name: 'backend', pattern: ['api', 'services', 'middleware'] },
      { name: 'frontend', pattern: ['components', 'hooks', 'pages'] },
      { name: 'tests', pattern: ['test', 'spec', '__tests__'] },
    ];

    for (const layer of layers) {
      const layerChanges = feature.changes.filter(c =>
        layer.pattern.some(p => c.path.includes(p))
      );

      if (layerChanges.length > 0) {
        // Si el layer es muy grande, subdividir
        if (this.calculateLines(layerChanges) > 300) {
          chunks.push(...this.subdivideLayer(layer.name, layerChanges));
        } else {
          chunks.push({
            slug: layer.name,
            title: this.generateChunkTitle(layer.name, feature),
            changes: layerChanges,
            layer: layer.name
          });
        }
      }
    }

    return this.orderChunksByDependency(chunks);
  }

  /**
   * Genera el body del PR con formato de stack
   */
  private generatePRBody(
    chunk: Chunk,
    index: number,
    total: number,
    feature: FeatureAnalysis
  ): string {
    return `
## 📚 Stack Progress: ${index + 1}/${total}

\`\`\`
${this.generateStackVisualization(index, total)}
\`\`\`

---

## 🎯 Objetivo de este PR

${chunk.description}

## 📦 Parte del Stack: "${feature.name}"

| # | PR | Estado |
|---|-----|--------|
${this.generateStackTable(index, total)}

## 🔗 Dependencias

${index === 0
  ? '✅ Este es el **base** del stack - no tiene dependencias'
  : `⬆️ Depende de: PR anterior en el stack`
}

${index < total - 1
  ? `⬇️ Siguiente PR depende de este`
  : `🏁 Este es el **último** PR del stack`
}

---

## 📚 Lo que Aprenderás (Aprendizaje Progresivo)

${chunk.learningObjectives?.map(obj => `- ${obj}`).join('\n') || 'N/A'}

## 📖 Conceptos Introducidos

${chunk.conceptsIntroduced?.map(c => `\`${c}\``).join(' • ') || 'N/A'}

---

## ✅ Checklist

- [ ] Código sigue las convenciones del proyecto
- [ ] Tests agregados/actualizados
- [ ] Sin console.logs o código de debug
- [ ] PR es pequeño y enfocado (~${chunk.estimatedLines} líneas)

## 🧪 Cómo Probar

\`\`\`bash
# Checkout este stack
git fetch origin ${chunk.branch}
git checkout ${chunk.branch}

# Ejecutar tests
npm test

# Verificar localmente
npm run dev
\`\`\`

---

## 📝 Notas para el Reviewer

${chunk.reviewNotes || 'Revisar los cambios y aprobar si todo está correcto.'}

---

_🔗 Este PR es parte de un **Stacked PR**. Por favor, revisar en orden._
_📚 Generado con freelance-project-planner-v4_
`;
  }

  /**
   * Visualización ASCII del progreso del stack
   */
  private generateStackVisualization(current: number, total: number): string {
    let viz = '';
    for (let i = 0; i < total; i++) {
      const status = i < current ? '✅' : i === current ? '👉' : '⏳';
      const connector = i < total - 1 ? '\n    │\n    ▼\n' : '';
      viz += `${status} PR ${String(i + 1).padStart(2, '0')}${connector}`;
    }
    return viz;
  }

  /**
   * Crea issue de tracking para el stack completo
   */
  private async createStackTrackingIssue(
    repo: Repository,
    feature: FeatureAnalysis,
    stack: StackedPR[]
  ): Promise<Issue> {
    const body = `
# 📚 Stack Tracking: ${feature.name}

## 📊 Estado del Stack

| # | PR | Branch | Estado | Lines |
|---|-----|--------|--------|-------|
${stack.map((pr, i) =>
  `| ${i + 1} | #${pr.number} | \`${pr.branch}\` | ${i === 0 ? '🔄 Review' : '📝 Draft'} | ~${pr.linesChanged} |`
).join('\n')}

## 📈 Progreso

\`\`\`
[${stack.map((_, i) => i === 0 ? '🔄' : '⬜').join('')}] 0/${stack.length} merged
\`\`\`

## 🔗 Orden de Merge

1. Merge PR #${stack[0].number} a \`develop\`
2. Actualizar base de PR #${stack[1]?.number || 'N/A'} a \`develop\`
3. Repetir hasta completar el stack

## 📚 Aprendizaje Acumulado

Al completar este stack, habrás aprendido:

${stack.flatMap(pr => pr.learningObjectives || []).map(obj => `- ${obj}`).join('\n')}

## ⚠️ Notas

- Los PRs deben mergearse **en orden**
- Después de mergear uno, actualizar el base del siguiente
- Si hay conflictos, resolverlos antes de continuar

---

_Este issue se actualiza automáticamente al mergear PRs del stack_
`;

    return await this.githubMCP.createIssue(repo, {
      title: `📚 Stack: ${feature.name}`,
      body: body,
      labels: ['stack-tracking', 'feature'],
    });
  }
}
```

### 3. GitHub Actions para Stacked PRs

```yaml
# .github/workflows/stacked-pr-ci.yml
name: Stacked PR CI

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  # Detectar si es parte de un stack
  detect-stack:
    runs-on: ubuntu-latest
    outputs:
      is_stacked: ${{ steps.detect.outputs.is_stacked }}
      stack_position: ${{ steps.detect.outputs.stack_position }}
      stack_base: ${{ steps.detect.outputs.stack_base }}
    steps:
      - name: Detect Stacked PR
        id: detect
        run: |
          BRANCH="${{ github.head_ref }}"

          # Pattern: feature/{name}/{number}-{slug}
          if [[ $BRANCH =~ ^feature/([^/]+)/([0-9]+)-(.+)$ ]]; then
            echo "is_stacked=true" >> $GITHUB_OUTPUT
            echo "stack_position=${BASH_REMATCH[2]}" >> $GITHUB_OUTPUT
            echo "stack_base=feature/${BASH_REMATCH[1]}" >> $GITHUB_OUTPUT
          else
            echo "is_stacked=false" >> $GITHUB_OUTPUT
          fi

  # Tests estándar
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test

  # Validación específica para stacked PRs
  validate-stack:
    runs-on: ubuntu-latest
    needs: detect-stack
    if: needs.detect-stack.outputs.is_stacked == 'true'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Validate Stack Order
        run: |
          POSITION=${{ needs.detect-stack.outputs.stack_position }}
          BASE=${{ needs.detect-stack.outputs.stack_base }}

          echo "📚 Stacked PR detectado"
          echo "   Posición: $POSITION"
          echo "   Stack base: $BASE"

          # Verificar que los PRs anteriores existen
          if [ "$POSITION" -gt "01" ]; then
            PREV_POSITION=$(printf "%02d" $((10#$POSITION - 1)))
            echo "   Verificando PR anterior: ${PREV_POSITION}"

            # Verificar que la rama anterior existe
            if ! git ls-remote --heads origin | grep -q "${BASE}/${PREV_POSITION}"; then
              echo "⚠️ Warning: PR anterior no encontrado"
            fi
          fi

      - name: Check PR Size
        run: |
          LINES_CHANGED=$(git diff --shortstat origin/${{ github.base_ref }}...HEAD | grep -oP '\d+(?= insertion)' || echo "0")

          echo "📊 Líneas cambiadas: $LINES_CHANGED"

          if [ "$LINES_CHANGED" -gt 400 ]; then
            echo "⚠️ Warning: PR muy grande para un stack ($LINES_CHANGED líneas)"
            echo "   Considera dividirlo más"
          else
            echo "✅ Tamaño del PR apropiado para review"
          fi

  # Comentario automático con info del stack
  stack-comment:
    runs-on: ubuntu-latest
    needs: [detect-stack, test]
    if: needs.detect-stack.outputs.is_stacked == 'true'
    permissions:
      pull-requests: write
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            const position = '${{ needs.detect-stack.outputs.stack_position }}';
            const stackBase = '${{ needs.detect-stack.outputs.stack_base }}';

            const comment = `
            ## 📚 Stacked PR Info

            | Propiedad | Valor |
            |-----------|-------|
            | **Stack** | \`${stackBase}\` |
            | **Posición** | #${position} |
            | **CI Status** | ✅ Passed |

            ### 📋 Checklist de Merge

            ${position === '01' ?
              '- [ ] Este es el **primer PR** del stack - puede mergearse directamente' :
              '- [ ] Verificar que el PR anterior está mergeado\n- [ ] Actualizar base branch si es necesario'
            }

            ---
            _🤖 Comentario automático de Stacked PR CI_
            `;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: comment
            });
```

### 4. Workflow de Merge para Stacks

```typescript
class StackMergeManager {
  /**
   * Maneja el merge de un PR dentro de un stack
   */
  async handleStackMerge(
    repo: Repository,
    mergedPR: PullRequest
  ): Promise<void> {
    const stackInfo = this.parseStackBranch(mergedPR.head.ref);

    if (!stackInfo) return; // No es un stacked PR

    console.log(`📚 Stack PR merged: ${mergedPR.title}`);
    console.log(`   Stack: ${stackInfo.feature}`);
    console.log(`   Position: ${stackInfo.position}`);

    // 1. Encontrar el siguiente PR en el stack
    const nextBranch = this.getNextStackBranch(stackInfo);
    const nextPR = await this.findPRByBranch(repo, nextBranch);

    if (nextPR) {
      // 2. Actualizar el base del siguiente PR
      await this.githubMCP.updatePullRequest(repo, nextPR.number, {
        base: 'develop'  // Ahora apunta a develop en lugar del PR mergeado
      });

      // 3. Quitar el draft status
      await this.githubMCP.updatePullRequest(repo, nextPR.number, {
        draft: false
      });

      // 4. Agregar comentario
      await this.githubMCP.addComment(repo, nextPR.number, `
🎉 **PR anterior mergeado!**

Este PR ahora está listo para review. El base ha sido actualizado a \`develop\`.

📊 Stack Progress: ${stackInfo.position}/${stackInfo.total} completado
      `);

      console.log(`   ✅ Next PR #${nextPR.number} actualizado y listo para review`);
    }

    // 5. Actualizar issue de tracking
    await this.updateStackTrackingIssue(repo, stackInfo, mergedPR);
  }

  /**
   * Actualiza el issue de tracking del stack
   */
  private async updateStackTrackingIssue(
    repo: Repository,
    stackInfo: StackInfo,
    mergedPR: PullRequest
  ): Promise<void> {
    const trackingIssue = await this.findStackTrackingIssue(repo, stackInfo.feature);

    if (!trackingIssue) return;

    // Actualizar el body con el nuevo estado
    const newBody = this.updateStackProgressInBody(
      trackingIssue.body,
      stackInfo.position,
      'merged'
    );

    await this.githubMCP.updateIssue(repo, trackingIssue.number, {
      body: newBody
    });

    // Si es el último PR, cerrar el tracking issue
    if (stackInfo.position === stackInfo.total) {
      await this.githubMCP.updateIssue(repo, trackingIssue.number, {
        state: 'closed'
      });

      await this.githubMCP.addComment(repo, trackingIssue.number, `
🎉 **Stack Completado!**

Todos los PRs del stack han sido mergeados exitosamente.

## 📚 Resumen de Aprendizaje

Durante este stack, aprendiste:
${stackInfo.allLearningObjectives.map(obj => `- ✅ ${obj}`).join('\n')}

---

_Stack completado en ${this.calculateStackDuration(stackInfo)}_
      `);
    }
  }
}
```

---

## 🐳 Docker First (Heredado de v3)

### Generación Automática de Docker

Se mantiene toda la funcionalidad de v3 para Docker:
- Dockerfile multi-stage
- docker-compose para dev y prod
- .dockerignore optimizado
- Scripts de conveniencia

```typescript
// Ver implementación completa en v3
// Esta versión hereda todo el sistema Docker de v3
```

---

## 📚 Aprendizaje Progresivo en Stacked PRs

### Integración de Aprendizaje por PR

Cada PR del stack incluye su propio contexto de aprendizaje:

```markdown
## 📚 Stack: Sistema de Autenticación

### PR 01/04: Database Schema

#### 🎯 Objetivo
Crear el esquema de base de datos para usuarios.

#### 📚 Lo que Aprenderás
- Diseño de modelos de datos
- Migrations en Prisma
- Relaciones entre tablas

#### 📖 Contexto Just-in-Time

<details>
<summary>🗄️ ¿Qué son las migrations?</summary>

Las migrations son "versiones" de tu base de datos. Cada migration
describe un cambio (crear tabla, agregar columna, etc.).

**¿Por qué importan?**
- Trackean cambios en la BD como código
- Permiten rollback si algo sale mal
- Todos en el equipo tienen la misma estructura

**Comando clave:**
```bash
npx prisma migrate dev --name add_users_table
```
</details>

#### 🔗 Conexión con PRs Siguientes
Este PR crea la base para:
- PR 02: Usará el modelo User en los endpoints
- PR 03: Agregará campos para tokens JWT
- PR 04: Mostrará datos del usuario en el frontend

---

### PR 02/04: API Endpoints

#### 🎯 Objetivo
Crear endpoints de registro y login.

#### 📚 Lo que Aprenderás
- Diseño de APIs REST
- Validación de inputs
- Manejo de errores

#### 🔗 Construyendo sobre PR 01
Ahora que tienes el modelo User, puedes:
- Crear usuarios en la base de datos
- Validar credenciales
- Retornar datos del usuario

#### 📖 Contexto Just-in-Time

<details>
<summary>🔒 ¿Por qué validar inputs?</summary>

**Nunca confíes en datos del cliente.**

```typescript
// ❌ MAL: Sin validación
app.post('/register', (req, res) => {
  const { email, password } = req.body;
  // ¿Y si email es un array? ¿Y si password es undefined?
});

// ✅ BIEN: Con Zod
const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

app.post('/register', (req, res) => {
  const data = registerSchema.parse(req.body);
  // Ahora data.email y data.password son strings válidos
});
```
</details>
```

### Mapa de Aprendizaje por Stack

```typescript
class StackLearningTracker {
  generateLearningMap(stack: PRStack): string {
    return `
# 🗺️ Mapa de Aprendizaje - Stack: ${stack.feature}

\`\`\`
PR 01: Database Schema
├── 📚 Prisma migrations
├── 📚 Diseño de modelos
└── ✅ Completado
    │
    ▼
PR 02: API Endpoints
├── 📚 REST API design
├── 📚 Zod validation
├── 📚 Error handling
└── 🔄 En review
    │
    ▼
PR 03: JWT Middleware
├── 📚 JSON Web Tokens
├── 📚 Middleware pattern
├── 📚 Auth flow
└── ⏳ Esperando
    │
    ▼
PR 04: Frontend Forms
├── 📚 React Hook Form
├── 📚 Client validation
├── 📚 Toast notifications
└── ⏳ Draft

\`\`\`

## 📊 Progreso de Aprendizaje

| Concepto | PR | Estado |
|----------|-----|--------|
| Prisma migrations | 01 | ✅ |
| Diseño de modelos | 01 | ✅ |
| REST API design | 02 | 🔄 |
| Zod validation | 02 | 🔄 |
| JWT tokens | 03 | ⏳ |
| Middleware | 03 | ⏳ |
| React forms | 04 | ⏳ |

**Conceptos dominados: 2/7 (29%)**
`;
  }
}
```

---

## 🚀 Workflow Completo del Agente

```typescript
class FreelancePlannerV4 {
  async executeFull(
    projectPath: string,
    options: PlannerOptions
  ): Promise<ExecutionResult> {
    console.log('🚀 Freelance Project Planner v4.0');
    console.log('📚 GitFlow + Stacked PRs + Infrastructure First\n');

    // FASE 0: Análisis
    console.log('📊 FASE 0: Análisis del Proyecto');
    const analysis = await this.analyzer.analyzeProject(projectPath);

    // FASE 1: Docker (prioridad máxima - heredado de v3)
    console.log('\n🐳 FASE 1: Dockerización');
    const dockerSetup = await this.dockerGenerator.generateDockerSetup(analysis);

    // FASE 2: GitHub Actions con soporte para stacks
    console.log('\n⚙️  FASE 2: GitHub Actions (con Stacked PR support)');
    const workflows = await this.generateStackAwareWorkflows(analysis);

    // FASE 3: GitFlow Setup
    console.log('\n🌳 FASE 3: GitFlow Setup');
    await this.setupGitFlow(analysis.repo);

    // FASE 4: Planificación en Stacked PRs
    console.log('\n📚 FASE 4: Generación de Iteraciones como Stacked PRs');
    const iterations = await this.planIterationsAsStacks(analysis);

    // FASE 5: Crear PRs y tracking issues
    console.log('\n🔗 FASE 5: Creación de Stacked PRs en GitHub');
    const stacks = await this.createAllStacks(analysis.repo, iterations);

    // Resumen final
    this.printExecutionSummary(analysis, dockerSetup, workflows, stacks);

    return { analysis, dockerSetup, workflows, stacks };
  }

  private async setupGitFlow(repo: Repository): Promise<void> {
    // Crear ramas principales
    const branches = ['develop', 'staging'];

    for (const branch of branches) {
      try {
        await this.githubMCP.createBranch(repo, branch, 'main');
        console.log(`   ✅ Rama creada: ${branch}`);
      } catch {
        console.log(`   ℹ️  Rama ${branch} ya existe`);
      }
    }

    // Configurar protecciones
    await this.setupBranchProtections(repo);

    // Configurar reglas de merge
    await this.setupMergeRules(repo);

    console.log('   ✅ GitFlow configurado');
  }

  private async planIterationsAsStacks(
    analysis: ProjectAnalysis
  ): Promise<StackedIteration[]> {
    const features = await this.extractFeatures(analysis);
    const iterations: StackedIteration[] = [];

    let iterationNumber = 1;
    for (const feature of features) {
      // Dividir cada feature en un stack de PRs
      const chunks = await this.divideFeatureIntoChunks(feature);

      iterations.push({
        iterationNumber: iterationNumber++,
        feature: feature.name,
        description: feature.description,
        prStack: chunks.map((chunk, index) => ({
          stackOrder: index + 1,
          branch: `feature/${this.slugify(feature.name)}/${String(index + 1).padStart(2, '0')}-${chunk.slug}`,
          title: chunk.title,
          description: chunk.description,
          dependsOn: index === 0 ? null : chunks[index - 1].slug,
          estimatedLines: chunk.estimatedLines,
          learningObjectives: chunk.learningObjectives,
          conceptsIntroduced: chunk.conceptsIntroduced
        })),
        totalEstimatedReviewTime: this.calculateTotalReviewTime(chunks),
        learningPath: this.generateLearningPath(chunks)
      });

      console.log(`   📚 Iteración ${iterationNumber - 1}: ${feature.name}`);
      console.log(`      └── ${chunks.length} PRs en el stack`);
    }

    return iterations;
  }

  private printExecutionSummary(
    analysis: ProjectAnalysis,
    dockerSetup: DockerSetup,
    workflows: Workflows,
    stacks: PRStack[]
  ): void {
    const totalPRs = stacks.reduce((sum, s) => sum + s.prStack.length, 0);

    console.log(`
=====================================
✅ Setup Completado - v4 GitFlow + Stacked PRs
=====================================

🐳 Docker:
   - Dockerfile (multi-stage)
   - docker-compose.dev.yml
   - docker-compose.prod.yml

⚙️  GitHub Actions:
   - CI Pipeline
   - Stacked PR Validator
   - Auto-update bases on merge

🌳 GitFlow:
   - main (protected)
   - develop (integration)
   - feature/* (stacked PRs)

📚 Stacked PRs:
   - ${stacks.length} features planificadas
   - ${totalPRs} PRs totales
   - Review time estimado: ~${this.calculateTotalReviewTime(stacks)} horas

📋 Iteraciones:
${stacks.map((s, i) => `
   Iteración ${i + 1}: ${s.feature}
   └── Stack de ${s.prStack.length} PRs:
${s.prStack.map((pr, j) => `       ${j + 1}. ${pr.title} (~${pr.estimatedLines} líneas)`).join('\n')}
`).join('')}

🎓 Aprendizaje Integrado:
   - Cada PR incluye contexto de aprendizaje
   - Conceptos introducidos progresivamente
   - Reflexión al completar cada stack

📚 Workflow Recomendado:
   1. Tomar el primer PR del stack
   2. Review y merge a develop
   3. CI actualiza automáticamente el siguiente PR
   4. Repetir hasta completar el stack
   5. Reflexionar sobre conceptos aprendidos

=====================================
`);
  }
}
```

---

## 📋 Comandos CLI

```bash
# Setup completo con GitFlow y Stacked PRs
freelance-planner-v4 setup ./mi-proyecto \
  --github-repo "usuario/proyecto" \
  --gitflow \
  --stacked-prs

# Crear stack para una feature específica
freelance-planner-v4 create-stack ./mi-proyecto \
  --feature "user-authentication" \
  --github-repo "usuario/proyecto"

# Ver estado de todos los stacks
freelance-planner-v4 stack-status ./mi-proyecto \
  --github-repo "usuario/proyecto"

# Merge el siguiente PR de un stack
freelance-planner-v4 merge-next ./mi-proyecto \
  --stack "user-authentication"

# Generar reporte de aprendizaje
freelance-planner-v4 learning-report ./mi-proyecto \
  --stack "user-authentication"
```

---

## 🎯 Resumen de Diferencias: v1 vs v2 vs v3 vs v4

| Aspecto | v1 | v2 | v3 | v4 |
|---------|----|----|----|----|
| **Modelo** | Sonnet | Sonnet | Opus 4.5 | Opus 4.5 |
| **GitHub MCP** | ❌ | ✅ | ✅ | ✅ |
| **Docker Priority** | ⚪ | ⚪ | 🟢 #1 | 🟢 #1 |
| **Kanban + WIP** | ✅ | ✅ | ⚪ | ✅ |
| **XP/TDD Selectivo** | ✅ | ✅ | ⚪ | ✅ |
| **GitFlow** | ❌ | ❌ | ❌ | ✅ |
| **Stacked PRs** | ❌ | ❌ | ❌ | ✅ |
| **Aprendizaje Progresivo** | ❌ | ❌ | ✅ | ✅ |
| **PRs por feature** | 1 grande | 1 grande | 1 grande | N pequeños |
| **Review time** | Largo | Largo | Largo | 30-60 min |

### v4 = Lo mejor de todas las versiones

```
v4 = v1 (Kanban + XP)
   + v2 (GitHub MCP automation)
   + v3 (Docker first + Learning)
   + NEW (GitFlow + Stacked PRs)
```

---

## 🔑 Beneficios de v4

### De v1 - Kanban Light + XP Adaptado
1. **WIP Limits** - Máximo 2 tareas en progreso
2. **TDD Selectivo** - Tests solo en áreas críticas
3. **Refactorización planificada** - Viernes después de demo
4. **Rutina semanal** - Lunes planificación, Viernes demo
5. **Mínimo overhead** - Sin ceremonias innecesarias

### De v2 - GitHub MCP
6. **Automatización total** - Repos, issues, projects creados automáticamente
7. **CI/CD generado** - Workflows según tech stack
8. **PR templates** - Formato consistente

### De v3 - Infrastructure First + Learning
9. **Docker primero** - Entorno reproducible desde día 1
10. **Aprendizaje progresivo** - Conceptos cuando los necesitas
11. **Documentación just-in-time** - No leer 50 páginas antes

### Nuevos en v4 - GitFlow + Stacked PRs
12. **Reviews más rápidos** - PRs pequeños = review en 30-60 min
13. **Feedback continuo** - No esperar a terminar toda la feature
14. **Menos conflictos** - Merge incremental reduce merge hell
15. **Mejor tracking** - Issue de tracking por stack
16. **Rollback granular** - Revertir un PR sin afectar todo
17. **GitFlow profesional** - main/develop/feature/release/hotfix
18. **Aprendizaje por PR** - Conceptos en chunks aún más pequeños

---

## 🎯 ¿Cuándo usar v4?

| Escenario | Recomendación |
|-----------|---------------|
| Proyecto nuevo con equipo de 1+ personas | ✅ v4 |
| Features grandes que necesitan review incremental | ✅ v4 |
| Quieres aprender mientras desarrollas | ✅ v4 |
| Proyecto profesional con GitFlow | ✅ v4 |
| Proyecto muy simple o prototipo rápido | ❌ Usa v1 |
| Solo necesitas automatización GitHub básica | ❌ Usa v2 |

---

## 📊 Comparativa Visual

```
                    ┌─────────────────────────────────────────────────┐
                    │              FREELANCE PLANNER v4               │
                    │         "The Complete Package"                  │
                    └─────────────────────────────────────────────────┘
                                         │
          ┌──────────────────────────────┼──────────────────────────────┐
          │                              │                              │
          ▼                              ▼                              ▼
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   📋 KANBAN + XP    │    │  🐳 INFRASTRUCTURE  │    │  📚 STACKED PRs     │
│     (from v1)       │    │     (from v3)       │    │     (NEW in v4)     │
├─────────────────────┤    ├─────────────────────┤    ├─────────────────────┤
│ • WIP Limits (2)    │    │ • Docker first      │    │ • GitFlow           │
│ • TDD selectivo     │    │ • CI/CD priority    │    │ • PRs pequeños      │
│ • Refactor viernes  │    │ • Learning          │    │ • Review rápido     │
│ • Demo semanal      │    │   progresivo        │    │ • Merge incremental │
│ • Mínimo overhead   │    │ • Just-in-time docs │    │ • Stack tracking    │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
          │                              │                              │
          └──────────────────────────────┼──────────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────────────┐
                    │           🔗 GITHUB MCP (from v2)               │
                    │  Auto-create: repos, issues, projects, CI/CD   │
                    └─────────────────────────────────────────────────┘
```

---

## 🛠️ Tooling para Stacked PRs

### Herramientas Recomendadas

El manejo manual de stacked PRs puede ser tedioso. Estas herramientas automatizan el proceso:

```typescript
const STACKED_PR_TOOLS = {
  // Herramientas especializadas
  graphite: {
    name: 'Graphite',
    type: 'cli + web',
    pros: ['Mejor UX', 'Dashboard web', 'Auto-sync', 'Merge queue'],
    cons: ['Requiere cuenta', 'Freemium'],
    recommendation: 'Mejor para uso frecuente de stacks'
  },

  gitTown: {
    name: 'git-town',
    type: 'cli',
    pros: ['Open source', 'Sin cuenta', 'Integrado con git'],
    cons: ['Solo CLI', 'Menos features'],
    recommendation: 'Mejor para puristas de git'
  },

  ghStack: {
    name: 'ghstack (Facebook)',
    type: 'cli',
    pros: ['Usado en producción en Meta', 'Robusto'],
    cons: ['Curva de aprendizaje', 'Pensado para grandes equipos'],
    recommendation: 'Para proyectos muy grandes'
  },

  custom: {
    name: 'Scripts personalizados',
    type: 'bash/python',
    pros: ['Control total', 'Sin dependencias', 'Personalizable'],
    cons: ['Hay que mantenerlo', 'Más trabajo inicial'],
    recommendation: 'Cuando necesitas control total'
  }
};
```

### Opción 1: Graphite (Recomendada para la mayoría)

```bash
# Instalación
npm install -g @withgraphite/graphite-cli

# Autenticación
gt auth

# Flujo de trabajo con Graphite
# =============================

# 1. Crear primer PR del stack
gt create -m "01: Database schema for users"

# 2. Hacer cambios y crear siguiente PR (se apila automáticamente)
gt create -m "02: API endpoints for auth"

# 3. Crear más PRs del stack
gt create -m "03: JWT middleware"
gt create -m "04: Frontend login forms"

# Ver el stack completo
gt log

# Output:
# ┌── 04: Frontend login forms (current)
# ├── 03: JWT middleware
# ├── 02: API endpoints for auth
# └── 01: Database schema for users
#     │
#     └── main

# Sincronizar después de que se mergea un PR
gt sync  # Rebasa automáticamente todos los PRs del stack

# Navegar entre PRs del stack
gt up      # Ir al PR siguiente
gt down    # Ir al PR anterior
gt top     # Ir al último PR del stack
gt bottom  # Ir al primer PR del stack

# Submit todos los PRs a GitHub
gt submit --stack
```

### Opción 2: git-town (Open Source)

```bash
# Instalación
# macOS
brew install git-town

# Linux
curl -sL https://git-town.com/install.sh | bash

# Windows
scoop install git-town

# Configuración inicial
git town config

# Flujo de trabajo con git-town
# =============================

# 1. Crear rama para feature
git town hack feature/user-auth-01-schema

# 2. Hacer cambios y commit
git add . && git commit -m "Add user schema"

# 3. Crear siguiente rama del stack
git town append feature/user-auth-02-api

# 4. Sincronizar con upstream
git town sync

# 5. Crear PR
git town propose

# Ver estado
git town status
```

### Opción 3: Scripts Personalizados (Agnóstico)

```bash
#!/bin/bash
# scripts/stack-create.sh
# Crear un nuevo PR en el stack

set -e

FEATURE_NAME=$1
DESCRIPTION=$2

if [ -z "$FEATURE_NAME" ] || [ -z "$DESCRIPTION" ]; then
  echo "Uso: ./scripts/stack-create.sh <feature-name> <description>"
  echo "Ejemplo: ./scripts/stack-create.sh user-auth 'Add JWT middleware'"
  exit 1
fi

# Detectar el número del siguiente PR en el stack
CURRENT_BRANCH=$(git branch --show-current)
STACK_BASE="feature/${FEATURE_NAME}"

if [[ $CURRENT_BRANCH =~ ^${STACK_BASE}/([0-9]+)- ]]; then
  CURRENT_NUM=${BASH_REMATCH[1]}
  NEXT_NUM=$(printf "%02d" $((10#$CURRENT_NUM + 1)))
else
  # Es el primer PR del stack
  NEXT_NUM="01"
fi

# Crear slug del description
SLUG=$(echo "$DESCRIPTION" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-//' | sed 's/-$//')

NEW_BRANCH="${STACK_BASE}/${NEXT_NUM}-${SLUG}"

echo "📚 Creando nueva rama del stack: $NEW_BRANCH"

# Crear rama basada en la actual
git checkout -b "$NEW_BRANCH"

echo "✅ Rama creada. Ahora puedes hacer tus cambios."
echo ""
echo "Cuando termines:"
echo "  git add ."
echo "  git commit -m '${NEXT_NUM}: ${DESCRIPTION}'"
echo "  ./scripts/stack-push.sh"
```

```bash
#!/bin/bash
# scripts/stack-sync.sh
# Sincronizar stack después de merge

set -e

FEATURE_NAME=$1

if [ -z "$FEATURE_NAME" ]; then
  # Detectar feature del branch actual
  CURRENT_BRANCH=$(git branch --show-current)
  if [[ $CURRENT_BRANCH =~ ^feature/([^/]+)/ ]]; then
    FEATURE_NAME=${BASH_REMATCH[1]}
  else
    echo "Uso: ./scripts/stack-sync.sh <feature-name>"
    exit 1
  fi
fi

STACK_BASE="feature/${FEATURE_NAME}"

echo "🔄 Sincronizando stack: $STACK_BASE"

# Obtener cambios de origin
git fetch origin

# Obtener todas las ramas del stack
STACK_BRANCHES=$(git branch -r | grep "origin/${STACK_BASE}/" | sort | sed 's/origin\///')

# Actualizar develop primero
git checkout develop
git pull origin develop

PREV_BRANCH="develop"

for BRANCH in $STACK_BRANCHES; do
  echo "📌 Actualizando: $BRANCH"

  git checkout "$BRANCH"

  # Rebase sobre la rama anterior del stack (o develop si es la primera)
  git rebase "$PREV_BRANCH"

  # Push con force-with-lease (seguro)
  git push origin "$BRANCH" --force-with-lease

  PREV_BRANCH="$BRANCH"
done

echo "✅ Stack sincronizado"
```

```bash
#!/bin/bash
# scripts/stack-status.sh
# Ver estado del stack

FEATURE_NAME=$1

if [ -z "$FEATURE_NAME" ]; then
  CURRENT_BRANCH=$(git branch --show-current)
  if [[ $CURRENT_BRANCH =~ ^feature/([^/]+)/ ]]; then
    FEATURE_NAME=${BASH_REMATCH[1]}
  else
    echo "Uso: ./scripts/stack-status.sh <feature-name>"
    exit 1
  fi
fi

STACK_BASE="feature/${FEATURE_NAME}"

echo "📚 Stack: $STACK_BASE"
echo "================================"

# Obtener PRs del stack
gh pr list --search "head:${STACK_BASE}/" --json number,title,state,mergeable,headRefName \
  --jq '.[] | "PR #\(.number) [\(.state)] \(.title)"' | sort

echo ""
echo "Branches locales:"
git branch | grep "$STACK_BASE" | while read branch; do
  COMMITS_AHEAD=$(git rev-list --count develop.."$branch" 2>/dev/null || echo "?")
  echo "  $branch (+$COMMITS_AHEAD commits)"
done
```

```python
#!/usr/bin/env python3
# scripts/stack-manager.py
# Gestor de stacks multi-plataforma

import subprocess
import sys
import re
import json
from pathlib import Path

class StackManager:
    def __init__(self):
        self.current_branch = self._run_git("branch --show-current")

    def _run_git(self, cmd: str) -> str:
        result = subprocess.run(
            f"git {cmd}",
            shell=True,
            capture_output=True,
            text=True
        )
        return result.stdout.strip()

    def _run_gh(self, cmd: str) -> dict:
        result = subprocess.run(
            f"gh {cmd}",
            shell=True,
            capture_output=True,
            text=True
        )
        if result.returncode == 0:
            return json.loads(result.stdout) if result.stdout else {}
        return {}

    def detect_stack(self) -> dict:
        """Detecta información del stack actual"""
        match = re.match(r'^feature/([^/]+)/(\d+)-(.+)$', self.current_branch)
        if match:
            return {
                'feature': match.group(1),
                'position': int(match.group(2)),
                'slug': match.group(3),
                'is_stack': True
            }
        return {'is_stack': False}

    def list_stack_branches(self, feature: str) -> list:
        """Lista todas las ramas de un stack"""
        branches = self._run_git("branch -a")
        pattern = f"feature/{feature}/"
        stack_branches = [
            b.strip().replace("remotes/origin/", "")
            for b in branches.split("\n")
            if pattern in b
        ]
        return sorted(set(stack_branches))

    def get_stack_prs(self, feature: str) -> list:
        """Obtiene los PRs de GitHub para el stack"""
        prs = self._run_gh(
            f'pr list --search "head:feature/{feature}/" '
            f'--json number,title,state,headRefName,mergeable'
        )
        return sorted(prs, key=lambda x: x.get('headRefName', ''))

    def create_stack_branch(self, feature: str, description: str) -> str:
        """Crea una nueva rama en el stack"""
        branches = self.list_stack_branches(feature)

        if branches:
            # Encontrar el siguiente número
            numbers = []
            for b in branches:
                match = re.search(r'/(\d+)-', b)
                if match:
                    numbers.append(int(match.group(1)))
            next_num = max(numbers) + 1 if numbers else 1
        else:
            next_num = 1

        # Crear slug
        slug = re.sub(r'[^a-z0-9]+', '-', description.lower()).strip('-')
        branch_name = f"feature/{feature}/{next_num:02d}-{slug}"

        self._run_git(f"checkout -b {branch_name}")
        return branch_name

    def sync_stack(self, feature: str):
        """Sincroniza todo el stack con develop"""
        print(f"🔄 Sincronizando stack: {feature}")

        self._run_git("fetch origin")
        branches = self.list_stack_branches(feature)

        self._run_git("checkout develop")
        self._run_git("pull origin develop")

        prev_branch = "develop"
        for branch in branches:
            print(f"  📌 Rebasing: {branch}")
            self._run_git(f"checkout {branch}")
            self._run_git(f"rebase {prev_branch}")
            self._run_git(f"push origin {branch} --force-with-lease")
            prev_branch = branch

        print("✅ Stack sincronizado")

    def print_status(self, feature: str):
        """Imprime el estado del stack"""
        branches = self.list_stack_branches(feature)
        prs = self.get_stack_prs(feature)

        pr_map = {pr['headRefName']: pr for pr in prs}

        print(f"\n📚 Stack: feature/{feature}")
        print("=" * 50)

        for i, branch in enumerate(branches):
            pr = pr_map.get(branch, {})
            pr_num = pr.get('number', '?')
            state = pr.get('state', 'NO PR')

            icon = '✅' if state == 'MERGED' else '🔄' if state == 'OPEN' else '⬜'
            connector = '└──' if i == len(branches) - 1 else '├──'

            print(f"  {connector} {icon} #{pr_num} {branch}")

        print(f"\n  └── develop (base)")

if __name__ == "__main__":
    manager = StackManager()

    if len(sys.argv) < 2:
        print("Uso: stack-manager.py <comando> [args]")
        print("Comandos: status, sync, create, list")
        sys.exit(1)

    command = sys.argv[1]

    if command == "status":
        info = manager.detect_stack()
        if info['is_stack']:
            manager.print_status(info['feature'])
        else:
            print("No estás en una rama de stack")

    elif command == "sync":
        info = manager.detect_stack()
        if info['is_stack']:
            manager.sync_stack(info['feature'])
        elif len(sys.argv) > 2:
            manager.sync_stack(sys.argv[2])
        else:
            print("Especifica el feature: stack-manager.py sync <feature>")

    elif command == "create":
        if len(sys.argv) < 4:
            print("Uso: stack-manager.py create <feature> <description>")
            sys.exit(1)
        branch = manager.create_stack_branch(sys.argv[2], sys.argv[3])
        print(f"✅ Creada rama: {branch}")

    elif command == "list":
        if len(sys.argv) > 2:
            branches = manager.list_stack_branches(sys.argv[2])
            for b in branches:
                print(f"  - {b}")
        else:
            print("Especifica el feature: stack-manager.py list <feature>")
```

---

## 🌐 Preview Environments por PR (Multi-Lenguaje)

### Detección Automática de Tech Stack

```typescript
class TechStackDetector {
  /**
   * Detecta el tech stack del proyecto para configurar
   * el preview environment correcto
   */
  async detect(projectPath: string): Promise<TechStack> {
    const files = await this.scanProjectFiles(projectPath);

    return {
      // Lenguaje principal
      language: this.detectLanguage(files),

      // Framework
      framework: this.detectFramework(files),

      // Package manager
      packageManager: this.detectPackageManager(files),

      // Runtime
      runtime: this.detectRuntime(files),

      // Base de datos
      database: this.detectDatabase(files),

      // Preview platform recomendada
      previewPlatform: this.recommendPreviewPlatform(files)
    };
  }

  private detectLanguage(files: string[]): Language {
    const languageIndicators = {
      'package.json': 'javascript',
      'tsconfig.json': 'typescript',
      'requirements.txt': 'python',
      'Pipfile': 'python',
      'pyproject.toml': 'python',
      'go.mod': 'go',
      'Cargo.toml': 'rust',
      'pom.xml': 'java',
      'build.gradle': 'java',
      'Gemfile': 'ruby',
      'composer.json': 'php',
      'mix.exs': 'elixir',
      'Package.swift': 'swift',
      'pubspec.yaml': 'dart',
      '*.csproj': 'csharp',
    };

    for (const [indicator, language] of Object.entries(languageIndicators)) {
      if (files.some(f => f.includes(indicator.replace('*', '')))) {
        return language as Language;
      }
    }

    return 'unknown';
  }

  private detectFramework(files: string[]): Framework {
    const frameworkIndicators = {
      // JavaScript/TypeScript
      'next.config': 'nextjs',
      'nuxt.config': 'nuxt',
      'svelte.config': 'sveltekit',
      'astro.config': 'astro',
      'remix.config': 'remix',
      'angular.json': 'angular',
      'vite.config': 'vite',

      // Python
      'manage.py': 'django',
      'app/main.py': 'fastapi',
      'flask': 'flask',

      // Go
      'go.mod': 'go-native',

      // Ruby
      'config/routes.rb': 'rails',

      // PHP
      'artisan': 'laravel',
      'symfony.lock': 'symfony',

      // Java
      'spring': 'spring-boot',
    };

    for (const [indicator, framework] of Object.entries(frameworkIndicators)) {
      if (files.some(f => f.toLowerCase().includes(indicator))) {
        return framework as Framework;
      }
    }

    return 'generic';
  }

  private recommendPreviewPlatform(files: string[]): PreviewPlatform {
    const framework = this.detectFramework(files);

    const platformMap: Record<string, PreviewPlatform> = {
      // Vercel - mejor para Next.js y frameworks JS
      'nextjs': 'vercel',
      'nuxt': 'vercel',
      'sveltekit': 'vercel',
      'remix': 'vercel',
      'astro': 'vercel',

      // Railway - mejor para backends
      'django': 'railway',
      'fastapi': 'railway',
      'flask': 'railway',
      'rails': 'railway',
      'laravel': 'railway',
      'spring-boot': 'railway',
      'go-native': 'railway',

      // Fly.io - mejor para Docker
      'generic': 'flyio',
    };

    return platformMap[framework] || 'flyio';
  }
}
```

### GitHub Actions para Preview Environments

```yaml
# .github/workflows/preview-deploy.yml
name: Deploy Preview Environment

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  detect-stack:
    runs-on: ubuntu-latest
    outputs:
      language: ${{ steps.detect.outputs.language }}
      framework: ${{ steps.detect.outputs.framework }}
      platform: ${{ steps.detect.outputs.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Detect Tech Stack
        id: detect
        run: |
          # Detectar lenguaje
          if [ -f "package.json" ]; then
            if [ -f "tsconfig.json" ]; then
              echo "language=typescript" >> $GITHUB_OUTPUT
            else
              echo "language=javascript" >> $GITHUB_OUTPUT
            fi
          elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
            echo "language=python" >> $GITHUB_OUTPUT
          elif [ -f "go.mod" ]; then
            echo "language=go" >> $GITHUB_OUTPUT
          elif [ -f "Cargo.toml" ]; then
            echo "language=rust" >> $GITHUB_OUTPUT
          elif [ -f "pom.xml" ] || [ -f "build.gradle" ]; then
            echo "language=java" >> $GITHUB_OUTPUT
          elif [ -f "Gemfile" ]; then
            echo "language=ruby" >> $GITHUB_OUTPUT
          elif [ -f "composer.json" ]; then
            echo "language=php" >> $GITHUB_OUTPUT
          else
            echo "language=unknown" >> $GITHUB_OUTPUT
          fi

          # Detectar framework
          if [ -f "next.config.js" ] || [ -f "next.config.mjs" ] || [ -f "next.config.ts" ]; then
            echo "framework=nextjs" >> $GITHUB_OUTPUT
            echo "platform=vercel" >> $GITHUB_OUTPUT
          elif [ -f "nuxt.config.ts" ] || [ -f "nuxt.config.js" ]; then
            echo "framework=nuxt" >> $GITHUB_OUTPUT
            echo "platform=vercel" >> $GITHUB_OUTPUT
          elif [ -f "manage.py" ]; then
            echo "framework=django" >> $GITHUB_OUTPUT
            echo "platform=railway" >> $GITHUB_OUTPUT
          elif grep -q "fastapi" requirements.txt 2>/dev/null || grep -q "fastapi" pyproject.toml 2>/dev/null; then
            echo "framework=fastapi" >> $GITHUB_OUTPUT
            echo "platform=railway" >> $GITHUB_OUTPUT
          elif [ -f "go.mod" ]; then
            echo "framework=go" >> $GITHUB_OUTPUT
            echo "platform=flyio" >> $GITHUB_OUTPUT
          else
            echo "framework=generic" >> $GITHUB_OUTPUT
            echo "platform=flyio" >> $GITHUB_OUTPUT
          fi

  # ==========================================
  # Deploy a Vercel (JS/TS Frameworks)
  # ==========================================
  deploy-vercel:
    needs: detect-stack
    if: needs.detect-stack.outputs.platform == 'vercel'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Vercel
        id: deploy
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          scope: ${{ secrets.VERCEL_ORG_ID }}

      - name: Comment Preview URL
        uses: actions/github-script@v7
        with:
          script: |
            const prNumber = context.issue.number;
            const previewUrl = '${{ steps.deploy.outputs.preview-url }}';

            // Detectar si es parte de un stack
            const branch = context.payload.pull_request.head.ref;
            const stackMatch = branch.match(/^feature\/([^\/]+)\/(\d+)-/);
            const stackInfo = stackMatch
              ? `\n\n📚 **Stack:** \`${stackMatch[1]}\` | **Position:** #${stackMatch[2]}`
              : '';

            const body = `## 🚀 Preview Deployed!

| Environment | URL |
|-------------|-----|
| **Preview** | [${previewUrl}](${previewUrl}) |
${stackInfo}

### 🧪 Test Checklist
- [ ] Funcionalidad principal verificada
- [ ] Responsive design checkeado
- [ ] No hay errores en consola

---
_Deployed with Vercel • Framework: ${{ needs.detect-stack.outputs.framework }}_`;

            github.rest.issues.createComment({
              issue_number: prNumber,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });

  # ==========================================
  # Deploy a Railway (Backend Frameworks)
  # ==========================================
  deploy-railway:
    needs: detect-stack
    if: needs.detect-stack.outputs.platform == 'railway'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install Railway CLI
        run: npm install -g @railway/cli

      - name: Deploy to Railway
        id: deploy
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: |
          # Deploy con nombre basado en PR
          PREVIEW_NAME="pr-${PR_NUMBER}"

          railway up --detach --environment "$PREVIEW_NAME"

          # Obtener URL del deployment
          PREVIEW_URL=$(railway status --json | jq -r '.deploymentUrl')
          echo "url=$PREVIEW_URL" >> $GITHUB_OUTPUT

      - name: Comment Preview URL
        uses: actions/github-script@v7
        with:
          script: |
            const body = `## 🚀 Preview Deployed!

| Environment | URL |
|-------------|-----|
| **Preview** | [${{ steps.deploy.outputs.url }}](${{ steps.deploy.outputs.url }}) |

### 📋 API Endpoints para probar
\`\`\`bash
curl ${{ steps.deploy.outputs.url }}/health
curl ${{ steps.deploy.outputs.url }}/api/v1/
\`\`\`

---
_Deployed with Railway • Framework: ${{ needs.detect-stack.outputs.framework }}_`;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });

  # ==========================================
  # Deploy a Fly.io (Docker/Generic)
  # ==========================================
  deploy-flyio:
    needs: detect-stack
    if: needs.detect-stack.outputs.platform == 'flyio'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Fly.io
        uses: superfly/flyctl-actions/setup-flyctl@master

      - name: Deploy to Fly.io
        id: deploy
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          REPO_NAME: ${{ github.event.repository.name }}
        run: |
          APP_NAME="${REPO_NAME}-pr-${PR_NUMBER}"

          # Crear app si no existe
          flyctl apps create "$APP_NAME" --org personal 2>/dev/null || true

          # Deploy
          flyctl deploy --app "$APP_NAME" --remote-only

          # Obtener URL
          PREVIEW_URL="https://${APP_NAME}.fly.dev"
          echo "url=$PREVIEW_URL" >> $GITHUB_OUTPUT

      - name: Comment Preview URL
        uses: actions/github-script@v7
        with:
          script: |
            const body = `## 🚀 Preview Deployed!

| Environment | URL |
|-------------|-----|
| **Preview** | [${{ steps.deploy.outputs.url }}](${{ steps.deploy.outputs.url }}) |

### 🐳 Docker Build
- Image built and deployed successfully
- Language: ${{ needs.detect-stack.outputs.language }}

---
_Deployed with Fly.io_`;

            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: body
            });

  # ==========================================
  # Cleanup Preview on PR Close
  # ==========================================
  cleanup-preview:
    if: github.event.action == 'closed'
    runs-on: ubuntu-latest
    steps:
      - name: Cleanup Vercel Preview
        if: env.VERCEL_TOKEN != ''
        continue-on-error: true
        run: |
          echo "Vercel previews se limpian automáticamente"

      - name: Cleanup Railway Preview
        if: env.RAILWAY_TOKEN != ''
        continue-on-error: true
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
        run: |
          PREVIEW_NAME="pr-${PR_NUMBER}"
          railway environment delete "$PREVIEW_NAME" --yes || true

      - name: Cleanup Fly.io Preview
        if: env.FLY_API_TOKEN != ''
        continue-on-error: true
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
          PR_NUMBER: ${{ github.event.pull_request.number }}
          REPO_NAME: ${{ github.event.repository.name }}
        run: |
          APP_NAME="${REPO_NAME}-pr-${PR_NUMBER}"
          flyctl apps destroy "$APP_NAME" --yes || true
```

---

## 🔄 Auto-Sync Después de Merge

### Workflow de Auto-Sincronización

```yaml
# .github/workflows/stack-auto-sync.yml
name: Stack Auto-Sync

on:
  pull_request:
    types: [closed]

jobs:
  sync-stack:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Detect Stack and Update Next PR
        id: sync
        env:
          MERGED_BRANCH: ${{ github.event.pull_request.head.ref }}
        run: |
          echo "📚 Branch mergeado: $MERGED_BRANCH"

          # Detectar si es parte de un stack
          if [[ $MERGED_BRANCH =~ ^feature/([^/]+)/([0-9]+)-(.+)$ ]]; then
            FEATURE="${BASH_REMATCH[1]}"
            CURRENT_NUM="${BASH_REMATCH[2]}"

            echo "feature=$FEATURE" >> $GITHUB_OUTPUT
            echo "position=$CURRENT_NUM" >> $GITHUB_OUTPUT
            echo "is_stack=true" >> $GITHUB_OUTPUT

            # Calcular siguiente número
            NEXT_NUM=$(printf "%02d" $((10#$CURRENT_NUM + 1)))
            echo "next_position=$NEXT_NUM" >> $GITHUB_OUTPUT

            # Buscar siguiente rama del stack
            NEXT_BRANCH=$(git branch -r | grep "origin/feature/${FEATURE}/${NEXT_NUM}" | head -1 | xargs | sed 's/origin\///')

            if [ -n "$NEXT_BRANCH" ]; then
              echo "next_branch=$NEXT_BRANCH" >> $GITHUB_OUTPUT
              echo "has_next=true" >> $GITHUB_OUTPUT
              echo "✅ Siguiente rama encontrada: $NEXT_BRANCH"
            else
              echo "has_next=false" >> $GITHUB_OUTPUT
              echo "📌 Este era el último PR del stack"
            fi
          else
            echo "is_stack=false" >> $GITHUB_OUTPUT
            echo "ℹ️ No es parte de un stack"
          fi

      - name: Update Next PR Base
        if: steps.sync.outputs.has_next == 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          NEXT_BRANCH="${{ steps.sync.outputs.next_branch }}"

          # Encontrar el PR de la siguiente rama
          NEXT_PR=$(gh pr list --head "$NEXT_BRANCH" --json number --jq '.[0].number')

          if [ -n "$NEXT_PR" ]; then
            echo "📌 Actualizando PR #$NEXT_PR"

            # Cambiar base a develop
            gh pr edit "$NEXT_PR" --base develop

            # Quitar draft status si lo tiene
            gh pr ready "$NEXT_PR" 2>/dev/null || true

            # Agregar comentario
            gh pr comment "$NEXT_PR" --body "🎉 **PR anterior mergeado!**

Este PR ahora está listo para review.

📊 **Stack Progress:** ${{ steps.sync.outputs.position }}/${{ steps.sync.outputs.next_position }} completado

---
_Auto-sync by Stack Manager_"

            echo "✅ PR #$NEXT_PR actualizado"
          fi

      - name: Update Stack Tracking Issue
        if: steps.sync.outputs.is_stack == 'true'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          FEATURE: ${{ steps.sync.outputs.feature }}
          POSITION: ${{ steps.sync.outputs.position }}
          HEAD_REF: ${{ github.event.pull_request.head.ref }}
          HAS_NEXT: ${{ steps.sync.outputs.has_next }}
        run: |
          # Buscar issue de tracking del stack
          TRACKING_ISSUE=$(gh issue list --search "Stack: $FEATURE in:title" --json number --jq '.[0].number')

          if [ "$HAS_NEXT" = "true" ]; then
            NEXT_MSG="➡️ Siguiente PR listo para review"
          else
            NEXT_MSG="🎉 Stack completado!"
          fi

          if [ -n "$TRACKING_ISSUE" ]; then
            # Agregar comentario de progreso
            gh issue comment "$TRACKING_ISSUE" --body "✅ **PR ${POSITION} mergeado**

Branch: \`${HEAD_REF}\`

${NEXT_MSG}"

            # Si no hay siguiente PR, cerrar el tracking issue
            if [ "$HAS_NEXT" != "true" ]; then
              gh issue close "$TRACKING_ISSUE" --comment "🎉 **Stack completado!**

Todos los PRs han sido mergeados exitosamente."
            fi
          fi

  # Rebase automático de PRs siguientes
  rebase-remaining-stack:
    needs: sync-stack
    if: needs.sync-stack.outputs.is_stack == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Rebase All Remaining PRs in Stack
        run: |
          FEATURE="${{ needs.sync-stack.outputs.feature }}"
          CURRENT_POS="${{ needs.sync-stack.outputs.position }}"

          git fetch origin
          git checkout develop
          git pull origin develop

          # Obtener todas las ramas restantes del stack
          REMAINING_BRANCHES=$(git branch -r | grep "origin/feature/${FEATURE}/" | sort | while read branch; do
            BRANCH_NUM=$(echo "$branch" | grep -oP '\d{2}(?=-)' || echo "00")
            if [ "$BRANCH_NUM" -gt "$CURRENT_POS" ]; then
              echo "${branch#origin/}"
            fi
          done)

          PREV_BRANCH="develop"

          for BRANCH in $REMAINING_BRANCHES; do
            echo "🔄 Rebasing: $BRANCH"

            git checkout "$BRANCH"
            git rebase "$PREV_BRANCH" || {
              echo "⚠️ Conflicto en $BRANCH - requiere resolución manual"
              git rebase --abort
              continue
            }

            git push origin "$BRANCH" --force-with-lease
            PREV_BRANCH="$BRANCH"
          done

          echo "✅ Rebase completado"
```

---

## 📋 Merge Queue Configuration

### Setup de Merge Queue en GitHub

```typescript
class MergeQueueSetup {
  /**
   * Configura merge queue para el repositorio
   * Requiere GitHub Enterprise o repo público
   */
  async setupMergeQueue(repo: Repository): Promise<void> {
    // Habilitar merge queue en branch protection
    await this.githubMCP.updateBranchProtection(repo, 'develop', {
      required_status_checks: {
        strict: true,
        contexts: ['ci/tests', 'ci/lint', 'ci/type-check']
      },
      enforce_admins: false,
      required_pull_request_reviews: {
        required_approving_review_count: 1
      },
      // Merge Queue configuration
      merge_queue: {
        enabled: true,
        merge_method: 'squash',
        // Agrupar hasta 5 PRs para merge
        batch_size: 5,
        // Esperar 5 minutos antes de procesar
        wait_time_minutes: 5,
        // Requerir que CI pase en el batch
        require_branch_update: true
      }
    });
  }
}
```

### Workflow para Merge Queue

```yaml
# .github/workflows/merge-queue.yml
name: Merge Queue CI

on:
  merge_group:
    types: [checks_requested]

jobs:
  # Este job corre cuando un PR entra al merge queue
  merge-queue-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Detect Language and Setup
        id: setup
        run: |
          if [ -f "package.json" ]; then
            echo "runtime=node" >> $GITHUB_OUTPUT
          elif [ -f "requirements.txt" ] || [ -f "pyproject.toml" ]; then
            echo "runtime=python" >> $GITHUB_OUTPUT
          elif [ -f "go.mod" ]; then
            echo "runtime=go" >> $GITHUB_OUTPUT
          elif [ -f "Cargo.toml" ]; then
            echo "runtime=rust" >> $GITHUB_OUTPUT
          fi

      # Node.js
      - name: Setup Node.js
        if: steps.setup.outputs.runtime == 'node'
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Node.js Tests
        if: steps.setup.outputs.runtime == 'node'
        run: |
          npm ci
          npm run lint
          npm run type-check || true
          npm run test
          npm run build

      # Python
      - name: Setup Python
        if: steps.setup.outputs.runtime == 'python'
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'

      - name: Python Tests
        if: steps.setup.outputs.runtime == 'python'
        run: |
          pip install -r requirements.txt
          pip install pytest flake8
          flake8 . --max-line-length=100 || true
          pytest

      # Go
      - name: Setup Go
        if: steps.setup.outputs.runtime == 'go'
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - name: Go Tests
        if: steps.setup.outputs.runtime == 'go'
        run: |
          go mod download
          go vet ./...
          go test -race ./...
          go build ./...

      # Rust
      - name: Setup Rust
        if: steps.setup.outputs.runtime == 'rust'
        uses: dtolnay/rust-toolchain@stable

      - name: Rust Tests
        if: steps.setup.outputs.runtime == 'rust'
        run: |
          cargo clippy -- -D warnings
          cargo test
          cargo build --release
```

---

## 👥 CODEOWNERS Templates (Multi-Lenguaje)

### Generador de CODEOWNERS

```typescript
class CodeownersGenerator {
  /**
   * Genera archivo CODEOWNERS basado en la estructura del proyecto
   */
  async generate(projectPath: string): Promise<string> {
    const structure = await this.analyzeProjectStructure(projectPath);
    const techStack = await this.detectTechStack(projectPath);

    let codeowners = `# ==========================================
# CODEOWNERS - Auto-generated
# ==========================================
# Este archivo asigna reviewers automáticamente
# basado en las áreas del código modificadas.
#
# Formato: <pattern> <@owner1> <@owner2>
# Más específico = mayor prioridad
# ==========================================

# ==========================================
# Default - Todo el repositorio
# ==========================================
* @${structure.defaultOwner || 'tu-usuario'}

`;

    // Agregar secciones según el stack detectado
    codeowners += this.generateSectionsByStack(techStack, structure);

    return codeowners;
  }

  private generateSectionsByStack(stack: TechStack, structure: ProjectStructure): string {
    let sections = '';

    // Sección de infraestructura (común a todos)
    sections += `# ==========================================
# Infrastructure & DevOps
# ==========================================
/.github/                   @${structure.devopsOwner || structure.defaultOwner}
/docker/                    @${structure.devopsOwner || structure.defaultOwner}
/Dockerfile*                @${structure.devopsOwner || structure.defaultOwner}
/docker-compose*            @${structure.devopsOwner || structure.defaultOwner}
/.env*                      @${structure.devopsOwner || structure.defaultOwner}
/Makefile                   @${structure.devopsOwner || structure.defaultOwner}
/scripts/                   @${structure.devopsOwner || structure.defaultOwner}

`;

    // Secciones específicas por lenguaje
    switch (stack.language) {
      case 'javascript':
      case 'typescript':
        sections += this.generateJavaScriptSections(structure);
        break;
      case 'python':
        sections += this.generatePythonSections(structure);
        break;
      case 'go':
        sections += this.generateGoSections(structure);
        break;
      case 'rust':
        sections += this.generateRustSections(structure);
        break;
      case 'java':
        sections += this.generateJavaSections(structure);
        break;
      case 'ruby':
        sections += this.generateRubySections(structure);
        break;
      case 'php':
        sections += this.generatePHPSections(structure);
        break;
      default:
        sections += this.generateGenericSections(structure);
    }

    return sections;
  }

  private generateJavaScriptSections(structure: ProjectStructure): string {
    return `# ==========================================
# JavaScript/TypeScript Project
# ==========================================

# Frontend
/src/components/            @${structure.frontendOwner || structure.defaultOwner}
/src/pages/                 @${structure.frontendOwner || structure.defaultOwner}
/src/app/                   @${structure.frontendOwner || structure.defaultOwner}
/src/views/                 @${structure.frontendOwner || structure.defaultOwner}
/src/hooks/                 @${structure.frontendOwner || structure.defaultOwner}
/src/styles/                @${structure.frontendOwner || structure.defaultOwner}
/public/                    @${structure.frontendOwner || structure.defaultOwner}

# Backend / API
/src/api/                   @${structure.backendOwner || structure.defaultOwner}
/src/server/                @${structure.backendOwner || structure.defaultOwner}
/src/routes/                @${structure.backendOwner || structure.defaultOwner}
/src/controllers/           @${structure.backendOwner || structure.defaultOwner}
/src/services/              @${structure.backendOwner || structure.defaultOwner}
/src/middleware/            @${structure.backendOwner || structure.defaultOwner}

# Database
/src/models/                @${structure.backendOwner || structure.defaultOwner}
/src/db/                    @${structure.backendOwner || structure.defaultOwner}
/prisma/                    @${structure.backendOwner || structure.defaultOwner}
/drizzle/                   @${structure.backendOwner || structure.defaultOwner}
/migrations/                @${structure.backendOwner || structure.defaultOwner}

# Shared / Utils
/src/lib/                   @${structure.defaultOwner}
/src/utils/                 @${structure.defaultOwner}
/src/types/                 @${structure.defaultOwner}

# Tests
/__tests__/                 @${structure.defaultOwner}
/tests/                     @${structure.defaultOwner}
*.test.ts                   @${structure.defaultOwner}
*.test.tsx                  @${structure.defaultOwner}
*.spec.ts                   @${structure.defaultOwner}

# Config
/package.json               @${structure.defaultOwner}
/tsconfig.json              @${structure.defaultOwner}
/*.config.js                @${structure.defaultOwner}
/*.config.ts                @${structure.defaultOwner}
/*.config.mjs               @${structure.defaultOwner}

`;
  }

  private generatePythonSections(structure: ProjectStructure): string {
    return `# ==========================================
# Python Project
# ==========================================

# API / Web
/app/                       @${structure.backendOwner || structure.defaultOwner}
/api/                       @${structure.backendOwner || structure.defaultOwner}
/views/                     @${structure.backendOwner || structure.defaultOwner}
/routes/                    @${structure.backendOwner || structure.defaultOwner}

# Models / Database
/models/                    @${structure.backendOwner || structure.defaultOwner}
/migrations/                @${structure.backendOwner || structure.defaultOwner}
/alembic/                   @${structure.backendOwner || structure.defaultOwner}

# Services / Business Logic
/services/                  @${structure.backendOwner || structure.defaultOwner}
/domain/                    @${structure.backendOwner || structure.defaultOwner}
/core/                      @${structure.backendOwner || structure.defaultOwner}

# Utils
/utils/                     @${structure.defaultOwner}
/lib/                       @${structure.defaultOwner}
/helpers/                   @${structure.defaultOwner}

# Tests
/tests/                     @${structure.defaultOwner}
test_*.py                   @${structure.defaultOwner}
*_test.py                   @${structure.defaultOwner}

# Config
/requirements*.txt          @${structure.defaultOwner}
/pyproject.toml             @${structure.defaultOwner}
/setup.py                   @${structure.defaultOwner}
/Pipfile*                   @${structure.defaultOwner}

# Django specific
/templates/                 @${structure.frontendOwner || structure.defaultOwner}
/static/                    @${structure.frontendOwner || structure.defaultOwner}
/manage.py                  @${structure.backendOwner || structure.defaultOwner}

`;
  }

  private generateGoSections(structure: ProjectStructure): string {
    return `# ==========================================
# Go Project
# ==========================================

# API / Handlers
/api/                       @${structure.backendOwner || structure.defaultOwner}
/handlers/                  @${structure.backendOwner || structure.defaultOwner}
/routes/                    @${structure.backendOwner || structure.defaultOwner}

# Internal packages
/internal/                  @${structure.backendOwner || structure.defaultOwner}
/pkg/                       @${structure.defaultOwner}

# Commands / CLI
/cmd/                       @${structure.backendOwner || structure.defaultOwner}

# Models / Database
/models/                    @${structure.backendOwner || structure.defaultOwner}
/repository/                @${structure.backendOwner || structure.defaultOwner}
/store/                     @${structure.backendOwner || structure.defaultOwner}

# Services
/services/                  @${structure.backendOwner || structure.defaultOwner}
/domain/                    @${structure.backendOwner || structure.defaultOwner}

# Tests
*_test.go                   @${structure.defaultOwner}

# Config
/go.mod                     @${structure.defaultOwner}
/go.sum                     @${structure.defaultOwner}

`;
  }

  private generateRustSections(structure: ProjectStructure): string {
    return `# ==========================================
# Rust Project
# ==========================================

# Source code
/src/                       @${structure.defaultOwner}
/src/bin/                   @${structure.backendOwner || structure.defaultOwner}
/src/lib.rs                 @${structure.defaultOwner}
/src/main.rs                @${structure.backendOwner || structure.defaultOwner}

# API / Web
/src/api/                   @${structure.backendOwner || structure.defaultOwner}
/src/handlers/              @${structure.backendOwner || structure.defaultOwner}
/src/routes/                @${structure.backendOwner || structure.defaultOwner}

# Domain
/src/models/                @${structure.backendOwner || structure.defaultOwner}
/src/domain/                @${structure.backendOwner || structure.defaultOwner}
/src/services/              @${structure.backendOwner || structure.defaultOwner}

# Tests
/tests/                     @${structure.defaultOwner}

# Config
/Cargo.toml                 @${structure.defaultOwner}
/Cargo.lock                 @${structure.defaultOwner}

`;
  }

  private generateJavaSections(structure: ProjectStructure): string {
    return `# ==========================================
# Java Project
# ==========================================

# Controllers / API
**/controller/              @${structure.backendOwner || structure.defaultOwner}
**/controllers/             @${structure.backendOwner || structure.defaultOwner}
**/api/                     @${structure.backendOwner || structure.defaultOwner}

# Services
**/service/                 @${structure.backendOwner || structure.defaultOwner}
**/services/                @${structure.backendOwner || structure.defaultOwner}

# Models / Entities
**/model/                   @${structure.backendOwner || structure.defaultOwner}
**/models/                  @${structure.backendOwner || structure.defaultOwner}
**/entity/                  @${structure.backendOwner || structure.defaultOwner}
**/entities/                @${structure.backendOwner || structure.defaultOwner}

# Repository / DAO
**/repository/              @${structure.backendOwner || structure.defaultOwner}
**/repositories/            @${structure.backendOwner || structure.defaultOwner}
**/dao/                     @${structure.backendOwner || structure.defaultOwner}

# Config
**/config/                  @${structure.devopsOwner || structure.defaultOwner}
**/configuration/           @${structure.devopsOwner || structure.defaultOwner}

# Tests
**/test/                    @${structure.defaultOwner}
*Test.java                  @${structure.defaultOwner}

# Build
/pom.xml                    @${structure.defaultOwner}
/build.gradle               @${structure.defaultOwner}
/settings.gradle            @${structure.defaultOwner}

`;
  }

  private generateRubySections(structure: ProjectStructure): string {
    return `# ==========================================
# Ruby Project
# ==========================================

# Controllers
/app/controllers/           @${structure.backendOwner || structure.defaultOwner}

# Models
/app/models/                @${structure.backendOwner || structure.defaultOwner}

# Views
/app/views/                 @${structure.frontendOwner || structure.defaultOwner}

# Services / Jobs
/app/services/              @${structure.backendOwner || structure.defaultOwner}
/app/jobs/                  @${structure.backendOwner || structure.defaultOwner}

# Database
/db/                        @${structure.backendOwner || structure.defaultOwner}
/db/migrate/                @${structure.backendOwner || structure.defaultOwner}

# Config
/config/                    @${structure.devopsOwner || structure.defaultOwner}

# Tests
/spec/                      @${structure.defaultOwner}
/test/                      @${structure.defaultOwner}

# Gems
/Gemfile                    @${structure.defaultOwner}
/Gemfile.lock               @${structure.defaultOwner}

`;
  }

  private generatePHPSections(structure: ProjectStructure): string {
    return `# ==========================================
# PHP Project
# ==========================================

# Laravel / Symfony Controllers
/app/Http/Controllers/      @${structure.backendOwner || structure.defaultOwner}
/src/Controller/            @${structure.backendOwner || structure.defaultOwner}

# Models
/app/Models/                @${structure.backendOwner || structure.defaultOwner}
/src/Entity/                @${structure.backendOwner || structure.defaultOwner}

# Views / Templates
/resources/views/           @${structure.frontendOwner || structure.defaultOwner}
/templates/                 @${structure.frontendOwner || structure.defaultOwner}

# Services
/app/Services/              @${structure.backendOwner || structure.defaultOwner}
/src/Service/               @${structure.backendOwner || structure.defaultOwner}

# Database
/database/                  @${structure.backendOwner || structure.defaultOwner}
/migrations/                @${structure.backendOwner || structure.defaultOwner}

# Config
/config/                    @${structure.devopsOwner || structure.defaultOwner}

# Tests
/tests/                     @${structure.defaultOwner}

# Composer
/composer.json              @${structure.defaultOwner}
/composer.lock              @${structure.defaultOwner}

`;
  }

  private generateGenericSections(structure: ProjectStructure): string {
    return `# ==========================================
# Generic Project Structure
# ==========================================

# Source code
/src/                       @${structure.defaultOwner}

# API
/api/                       @${structure.backendOwner || structure.defaultOwner}

# Config
/config/                    @${structure.devopsOwner || structure.defaultOwner}

# Tests
/tests/                     @${structure.defaultOwner}
/test/                      @${structure.defaultOwner}

# Documentation
/docs/                      @${structure.defaultOwner}
/*.md                       @${structure.defaultOwner}

`;
  }
}
```

### Template de CODEOWNERS para Freelancers

```bash
# .github/CODEOWNERS
# ==========================================
# CODEOWNERS para Proyecto Freelance
# ==========================================
# Como freelancer, tú eres el owner de todo.
# Este archivo sirve para:
# 1. Auto-asignarte como reviewer
# 2. Documentar la estructura del proyecto
# 3. Facilitar onboarding si agregas colaboradores
# ==========================================

# Default - Todo el repositorio
* @tu-usuario-github

# ==========================================
# Infrastructure
# ==========================================
/.github/                   @tu-usuario-github
/docker/                    @tu-usuario-github
/Dockerfile*                @tu-usuario-github
/docker-compose*            @tu-usuario-github
/scripts/                   @tu-usuario-github

# ==========================================
# Configuración Crítica (requiere atención extra)
# ==========================================
/.env*                      @tu-usuario-github
/**/secrets*                @tu-usuario-github
/**/credentials*            @tu-usuario-github

# ==========================================
# Adapta según tu stack (descomenta lo que aplique)
# ==========================================

# --- JavaScript/TypeScript ---
# /src/components/          @tu-usuario-github
# /src/pages/               @tu-usuario-github
# /src/api/                 @tu-usuario-github
# /prisma/                  @tu-usuario-github

# --- Python ---
# /app/                     @tu-usuario-github
# /api/                     @tu-usuario-github
# /migrations/              @tu-usuario-github

# --- Go ---
# /cmd/                     @tu-usuario-github
# /internal/                @tu-usuario-github
# /pkg/                     @tu-usuario-github

# ==========================================
# Tests (siempre revisar con cuidado)
# ==========================================
/tests/                     @tu-usuario-github
/__tests__/                 @tu-usuario-github
*_test.*                    @tu-usuario-github
*.test.*                    @tu-usuario-github
*.spec.*                    @tu-usuario-github
```

---

## 📝 Changelog Automático por Stack

### Generador de Changelog

```typescript
class StackChangelogGenerator {
  /**
   * Genera changelog automático basado en PRs mergeados del stack
   */
  async generateChangelog(
    repo: Repository,
    stack: PRStack
  ): Promise<string> {
    const mergedPRs = stack.prStack.filter(pr => pr.merged);

    const entries = await Promise.all(
      mergedPRs.map(async pr => ({
        type: this.detectChangeType(pr),
        scope: this.detectScope(pr),
        description: this.cleanTitle(pr.title),
        prNumber: pr.number,
        breaking: this.isBreakingChange(pr),
        commits: await this.getPRCommits(repo, pr.number)
      }))
    );

    return this.formatChangelog(stack, entries);
  }

  private detectChangeType(pr: StackedPR): ChangeType {
    const title = pr.title.toLowerCase();
    const branch = pr.branch.toLowerCase();

    // Detectar por prefijo convencional
    if (title.match(/^(feat|feature)/)) return 'feat';
    if (title.match(/^fix/)) return 'fix';
    if (title.match(/^(refactor|refactoring)/)) return 'refactor';
    if (title.match(/^(docs|documentation)/)) return 'docs';
    if (title.match(/^(test|tests)/)) return 'test';
    if (title.match(/^(chore|build|ci)/)) return 'chore';
    if (title.match(/^(perf|performance)/)) return 'perf';
    if (title.match(/^style/)) return 'style';

    // Detectar por contenido
    if (branch.includes('fix') || branch.includes('bug')) return 'fix';
    if (branch.includes('refactor')) return 'refactor';
    if (branch.includes('test')) return 'test';

    return 'feat'; // Default
  }

  private detectScope(pr: StackedPR): string {
    // Intentar extraer scope del título: "feat(auth): ..."
    const scopeMatch = pr.title.match(/^\w+\(([^)]+)\)/);
    if (scopeMatch) return scopeMatch[1];

    // Detectar por branch
    const branchParts = pr.branch.split('/');
    if (branchParts.length >= 2) {
      return branchParts[1].split('-')[0]; // feature/auth-login -> auth
    }

    // Detectar por archivos cambiados
    if (pr.filesChanged) {
      if (pr.filesChanged.some(f => f.includes('api/'))) return 'api';
      if (pr.filesChanged.some(f => f.includes('component'))) return 'ui';
      if (pr.filesChanged.some(f => f.includes('model'))) return 'db';
      if (pr.filesChanged.some(f => f.includes('test'))) return 'test';
    }

    return 'core';
  }

  private formatChangelog(
    stack: PRStack,
    entries: ChangelogEntry[]
  ): string {
    const version = this.calculateVersion(entries);
    const date = new Date().toISOString().split('T')[0];

    // Agrupar por tipo
    const grouped = this.groupByType(entries);

    let changelog = `# Changelog

## [${version}] - ${date}

### Stack: ${stack.feature}

`;

    // Breaking changes primero
    const breaking = entries.filter(e => e.breaking);
    if (breaking.length > 0) {
      changelog += `### ⚠️ BREAKING CHANGES

${breaking.map(e => `- **${e.scope}**: ${e.description} (#${e.prNumber})`).join('\n')}

`;
    }

    // Features
    if (grouped.feat?.length > 0) {
      changelog += `### ✨ Features

${grouped.feat.map(e => `- **${e.scope}**: ${e.description} (#${e.prNumber})`).join('\n')}

`;
    }

    // Bug fixes
    if (grouped.fix?.length > 0) {
      changelog += `### 🐛 Bug Fixes

${grouped.fix.map(e => `- **${e.scope}**: ${e.description} (#${e.prNumber})`).join('\n')}

`;
    }

    // Performance
    if (grouped.perf?.length > 0) {
      changelog += `### ⚡ Performance

${grouped.perf.map(e => `- **${e.scope}**: ${e.description} (#${e.prNumber})`).join('\n')}

`;
    }

    // Refactor
    if (grouped.refactor?.length > 0) {
      changelog += `### ♻️ Refactoring

${grouped.refactor.map(e => `- **${e.scope}**: ${e.description} (#${e.prNumber})`).join('\n')}

`;
    }

    // Aprendizaje completado (específico de este agente)
    changelog += `### 📚 Learning Completed

${stack.prStack
  .flatMap(pr => pr.learningObjectives || [])
  .filter((obj, i, arr) => arr.indexOf(obj) === i)
  .map(obj => `- ✅ ${obj}`)
  .join('\n')}

`;

    // PRs incluidos
    changelog += `### 📋 PRs Included

| # | Title | Type |
|---|-------|------|
${stack.prStack.map(pr => `| #${pr.number} | ${this.cleanTitle(pr.title)} | ${this.detectChangeType(pr)} |`).join('\n')}

`;

    return changelog;
  }
}
```

### GitHub Action para Changelog Automático

```yaml
# .github/workflows/changelog.yml
name: Generate Changelog

on:
  push:
    branches: [main]
    paths-ignore:
      - 'CHANGELOG.md'

jobs:
  generate-changelog:
    runs-on: ubuntu-latest
    permissions:
      contents: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Generate Changelog
        id: changelog
        run: |
          # Obtener PRs mergeados desde el último tag
          LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")

          if [ -n "$LAST_TAG" ]; then
            COMMITS_SINCE="$LAST_TAG..HEAD"
          else
            COMMITS_SINCE="HEAD~50..HEAD"
          fi

          # Generar changelog
          echo "# Changelog" > CHANGELOG_NEW.md
          echo "" >> CHANGELOG_NEW.md
          echo "## [Unreleased] - $(date +%Y-%m-%d)" >> CHANGELOG_NEW.md
          echo "" >> CHANGELOG_NEW.md

          # Features
          FEATURES=$(git log $COMMITS_SINCE --oneline --grep="^feat" --grep="^feature" --regexp-ignore-case | head -20)
          if [ -n "$FEATURES" ]; then
            echo "### ✨ Features" >> CHANGELOG_NEW.md
            echo "" >> CHANGELOG_NEW.md
            echo "$FEATURES" | while read line; do
              HASH=$(echo "$line" | cut -d' ' -f1)
              MSG=$(echo "$line" | cut -d' ' -f2-)
              PR=$(git log -1 --format=%B $HASH | grep -oP '#\d+' | head -1)
              echo "- $MSG $PR" >> CHANGELOG_NEW.md
            done
            echo "" >> CHANGELOG_NEW.md
          fi

          # Fixes
          FIXES=$(git log $COMMITS_SINCE --oneline --grep="^fix" --regexp-ignore-case | head -20)
          if [ -n "$FIXES" ]; then
            echo "### 🐛 Bug Fixes" >> CHANGELOG_NEW.md
            echo "" >> CHANGELOG_NEW.md
            echo "$FIXES" | while read line; do
              HASH=$(echo "$line" | cut -d' ' -f1)
              MSG=$(echo "$line" | cut -d' ' -f2-)
              PR=$(git log -1 --format=%B $HASH | grep -oP '#\d+' | head -1)
              echo "- $MSG $PR" >> CHANGELOG_NEW.md
            done
            echo "" >> CHANGELOG_NEW.md
          fi

          # Combinar con changelog existente
          if [ -f "CHANGELOG.md" ]; then
            tail -n +2 CHANGELOG.md >> CHANGELOG_NEW.md
          fi

          mv CHANGELOG_NEW.md CHANGELOG.md

      - name: Commit Changelog
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

          git add CHANGELOG.md
          git diff --staged --quiet || git commit -m "docs: update changelog [skip ci]"
          git push
```

---

## 🔔 Notificaciones Slack/Discord

### Configuración de Notificaciones

```typescript
class NotificationManager {
  /**
   * Gestiona notificaciones a Slack y Discord
   */

  async notifyStackProgress(
    stack: PRStack,
    event: StackEvent
  ): Promise<void> {
    const message = this.buildMessage(stack, event);

    // Enviar a todos los canales configurados
    await Promise.all([
      this.sendToSlack(message),
      this.sendToDiscord(message)
    ]);
  }

  private buildMessage(stack: PRStack, event: StackEvent): NotificationMessage {
    const progressBar = this.buildProgressBar(stack);

    switch (event.type) {
      case 'pr_merged':
        return {
          title: `✅ PR Mergeado - Stack: ${stack.feature}`,
          color: '#00C853',
          fields: [
            { name: 'PR', value: `#${event.pr.number}`, inline: true },
            { name: 'Progreso', value: progressBar, inline: true },
            { name: 'Siguiente', value: event.nextPR ? `#${event.nextPR.number}` : 'Stack completado!' }
          ]
        };

      case 'pr_ready':
        return {
          title: `🔔 PR Listo para Review - Stack: ${stack.feature}`,
          color: '#2196F3',
          fields: [
            { name: 'PR', value: `#${event.pr.number}`, inline: true },
            { name: 'Título', value: event.pr.title },
            { name: 'Estimado', value: event.pr.estimatedReviewTime || '30 min' }
          ]
        };

      case 'stack_completed':
        return {
          title: `🎉 Stack Completado: ${stack.feature}`,
          color: '#4CAF50',
          fields: [
            { name: 'PRs Mergeados', value: `${stack.prStack.length}` },
            { name: 'Conceptos Aprendidos', value: stack.learningPath?.length.toString() || 'N/A' }
          ]
        };

      default:
        return {
          title: `📚 Stack Update: ${stack.feature}`,
          color: '#9E9E9E',
          fields: []
        };
    }
  }

  private buildProgressBar(stack: PRStack): string {
    const total = stack.prStack.length;
    const completed = stack.prStack.filter(pr => pr.merged).length;
    const filled = '█'.repeat(completed);
    const empty = '░'.repeat(total - completed);
    return `${filled}${empty} ${completed}/${total}`;
  }
}
```

### GitHub Action para Notificaciones

```yaml
# .github/workflows/notify.yml
name: Stack Notifications

on:
  pull_request:
    types: [closed, ready_for_review]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Detect Stack Info
        id: stack
        env:
          BRANCH: ${{ github.event.pull_request.head.ref }}
        run: |

          if [[ $BRANCH =~ ^feature/([^/]+)/([0-9]+)- ]]; then
            echo "feature=${BASH_REMATCH[1]}" >> $GITHUB_OUTPUT
            echo "position=${BASH_REMATCH[2]}" >> $GITHUB_OUTPUT
            echo "is_stack=true" >> $GITHUB_OUTPUT

            # Contar PRs del stack
            TOTAL=$(gh pr list --search "head:feature/${BASH_REMATCH[1]}/" --json number | jq length)
            MERGED=$(gh pr list --search "head:feature/${BASH_REMATCH[1]}/ is:merged" --json number | jq length)

            echo "total=$TOTAL" >> $GITHUB_OUTPUT
            echo "merged=$MERGED" >> $GITHUB_OUTPUT
          else
            echo "is_stack=false" >> $GITHUB_OUTPUT
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      # Notificación Slack
      - name: Notify Slack
        if: steps.stack.outputs.is_stack == 'true' && env.SLACK_WEBHOOK != ''
        env:
          SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
          FEATURE: ${{ steps.stack.outputs.feature }}
          POSITION: ${{ steps.stack.outputs.position }}
          TOTAL: ${{ steps.stack.outputs.total }}
          MERGED: ${{ steps.stack.outputs.merged }}
          EVENT: ${{ github.event.action }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_URL: ${{ github.event.pull_request.html_url }}
          PR_MERGED: ${{ github.event.pull_request.merged }}
        run: |
          if [ "$EVENT" = "closed" ] && [ "$PR_MERGED" = "true" ]; then
            COLOR="#00C853"
            EMOJI="✅"
            STATUS="mergeado"
          else
            COLOR="#2196F3"
            EMOJI="🔔"
            STATUS="listo para review"
          fi

          # Construir progress bar
          PROGRESS=""
          for i in $(seq 1 $TOTAL); do
            if [ $i -le $MERGED ]; then
              PROGRESS="${PROGRESS}█"
            else
              PROGRESS="${PROGRESS}░"
            fi
          done

          curl -X POST "$SLACK_WEBHOOK" \
            -H 'Content-Type: application/json' \
            -d "{
              \"attachments\": [{
                \"color\": \"$COLOR\",
                \"blocks\": [
                  {
                    \"type\": \"header\",
                    \"text\": {
                      \"type\": \"plain_text\",
                      \"text\": \"$EMOJI Stack: $FEATURE\",
                      \"emoji\": true
                    }
                  },
                  {
                    \"type\": \"section\",
                    \"fields\": [
                      {
                        \"type\": \"mrkdwn\",
                        \"text\": \"*PR #$POSITION $STATUS*\"
                      },
                      {
                        \"type\": \"mrkdwn\",
                        \"text\": \"*Progreso:* \`$PROGRESS\` $MERGED/$TOTAL\"
                      }
                    ]
                  },
                  {
                    \"type\": \"section\",
                    \"text\": {
                      \"type\": \"mrkdwn\",
                      \"text\": \"<$PR_URL|$PR_TITLE>\"
                    }
                  }
                ]
              }]
            }"

      # Notificación Discord
      - name: Notify Discord
        if: steps.stack.outputs.is_stack == 'true' && env.DISCORD_WEBHOOK != ''
        env:
          DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK }}
          FEATURE: ${{ steps.stack.outputs.feature }}
          POSITION: ${{ steps.stack.outputs.position }}
          TOTAL: ${{ steps.stack.outputs.total }}
          MERGED: ${{ steps.stack.outputs.merged }}
          EVENT: ${{ github.event.action }}
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_URL: ${{ github.event.pull_request.html_url }}
          PR_MERGED: ${{ github.event.pull_request.merged }}
        run: |
          if [ "$EVENT" = "closed" ] && [ "$PR_MERGED" = "true" ]; then
            COLOR="65280"  # Green
            EMOJI="✅"
            STATUS="mergeado"
          else
            COLOR="3447003"  # Blue
            EMOJI="🔔"
            STATUS="listo para review"
          fi

          curl -X POST "$DISCORD_WEBHOOK" \
            -H 'Content-Type: application/json' \
            -d "{
              \"embeds\": [{
                \"title\": \"$EMOJI Stack: $FEATURE\",
                \"color\": $COLOR,
                \"fields\": [
                  {
                    \"name\": \"PR\",
                    \"value\": \"#$POSITION $STATUS\",
                    \"inline\": true
                  },
                  {
                    \"name\": \"Progreso\",
                    \"value\": \"$MERGED/$TOTAL\",
                    \"inline\": true
                  },
                  {
                    \"name\": \"Título\",
                    \"value\": \"[$PR_TITLE]($PR_URL)\"
                  }
                ]
              }]
            }"
```

---

## 🔙 Rollback Strategy para Stacks

### Estrategias de Rollback

```typescript
class StackRollbackManager {
  /**
   * Gestiona rollbacks de stacks parcialmente mergeados
   */

  async rollbackStack(
    repo: Repository,
    stack: PRStack,
    options: RollbackOptions
  ): Promise<RollbackResult> {
    const strategy = this.selectStrategy(stack, options);

    switch (strategy) {
      case 'revert':
        return this.revertStrategy(repo, stack, options);

      case 'feature-flag':
        return this.featureFlagStrategy(repo, stack, options);

      case 'branch-reset':
        return this.branchResetStrategy(repo, stack, options);

      default:
        throw new Error(`Unknown rollback strategy: ${strategy}`);
    }
  }

  /**
   * Selecciona la mejor estrategia de rollback
   */
  private selectStrategy(
    stack: PRStack,
    options: RollbackOptions
  ): RollbackStrategy {
    const mergedCount = stack.prStack.filter(pr => pr.merged).length;

    // Si solo un PR fue mergeado, revert es simple
    if (mergedCount === 1) {
      return 'revert';
    }

    // Si hay feature flags configurados, usarlos
    if (options.hasFeatureFlags) {
      return 'feature-flag';
    }

    // Si el stack tiene cambios de DB complejos, preferir feature flag
    const hasDBMigrations = stack.prStack.some(pr =>
      pr.filesChanged?.some(f => f.includes('migration'))
    );
    if (hasDBMigrations && options.hasFeatureFlags) {
      return 'feature-flag';
    }

    // Default: revert commits
    return 'revert';
  }

  /**
   * Estrategia 1: Revert commits
   * Crea PRs de revert para cada PR mergeado
   */
  private async revertStrategy(
    repo: Repository,
    stack: PRStack,
    options: RollbackOptions
  ): Promise<RollbackResult> {
    const mergedPRs = stack.prStack
      .filter(pr => pr.merged)
      .reverse(); // Revertir en orden inverso

    const revertPRs: PullRequest[] = [];

    for (const pr of mergedPRs) {
      // Obtener el merge commit
      const mergeCommit = await this.getMergeCommit(repo, pr);

      // Crear branch de revert
      const revertBranch = `revert/${pr.branch.replace('feature/', '')}`;

      await this.githubMCP.createBranch(repo, revertBranch, 'develop');

      // Ejecutar git revert
      // Esto requiere un workflow o GitHub Action
      const revertPR = await this.createRevertPR(repo, pr, revertBranch);

      revertPRs.push(revertPR);
    }

    return {
      strategy: 'revert',
      revertPRs,
      instructions: `
## 🔙 Rollback del Stack: ${stack.feature}

### PRs de Revert Creados

${revertPRs.map(pr => `- [ ] #${pr.number} - Revert: ${pr.title}`).join('\n')}

### Instrucciones

1. Review y merge los PRs de revert **en orden**
2. Verificar que la funcionalidad fue removida
3. Si hay migraciones de DB, ejecutar rollback manualmente

### Comandos útiles

\`\`\`bash
# Verificar estado después del rollback
git log --oneline develop -10

# Si necesitas hacer rollback manual
git revert <commit-hash>
\`\`\`
      `
    };
  }

  /**
   * Estrategia 2: Feature Flags
   * Desactiva la funcionalidad sin remover código
   */
  private async featureFlagStrategy(
    repo: Repository,
    stack: PRStack,
    options: RollbackOptions
  ): Promise<RollbackResult> {
    const flagName = this.generateFlagName(stack.feature);

    // Crear PR para desactivar feature flag
    const disablePR = await this.createFeatureFlagPR(repo, stack, flagName, false);

    return {
      strategy: 'feature-flag',
      flagName,
      disablePR,
      instructions: `
## 🚩 Rollback via Feature Flag: ${stack.feature}

### Feature Flag

\`\`\`
Flag: ${flagName}
Status: DISABLED
\`\`\`

### PR Creado

- [ ] #${disablePR.number} - Disable feature flag: ${flagName}

### Para servicios de Feature Flags

#### LaunchDarkly
\`\`\`bash
ldcli flags update --flag=${flagName} --on=false
\`\`\`

#### Unleash
\`\`\`bash
curl -X POST "https://unleash.example.com/api/admin/features/${flagName}/toggle/off"
\`\`\`

#### ConfigCat
\`\`\`bash
configcat flag update ${flagName} --value false
\`\`\`

#### Archivo de configuración
\`\`\`json
// config/features.json
{
  "${flagName}": false
}
\`\`\`

### Ventajas de este approach

1. ✅ Rollback instantáneo (sin deploy)
2. ✅ No requiere revert de código
3. ✅ Fácil de re-activar cuando esté listo
4. ✅ No afecta migraciones de DB
      `
    };
  }

  /**
   * Estrategia 3: Branch Reset
   * Reset de develop a un commit anterior (último recurso)
   */
  private async branchResetStrategy(
    repo: Repository,
    stack: PRStack,
    options: RollbackOptions
  ): Promise<RollbackResult> {
    // Encontrar el commit antes del primer PR del stack
    const firstPR = stack.prStack.find(pr => pr.merged);
    const commitBeforeStack = await this.getCommitBefore(repo, firstPR);

    return {
      strategy: 'branch-reset',
      targetCommit: commitBeforeStack,
      instructions: `
## ⚠️ Rollback via Branch Reset: ${stack.feature}

### ⚠️ ADVERTENCIA

Este es un **rollback destructivo**. Úsalo solo como último recurso.

### Commit Target

\`\`\`
${commitBeforeStack}
\`\`\`

### Pasos

1. **Crear backup de develop actual**
   \`\`\`bash
   git checkout develop
   git checkout -b backup/develop-before-rollback
   git push origin backup/develop-before-rollback
   \`\`\`

2. **Deshabilitar branch protection temporalmente**
   - Ve a Settings → Branches → develop
   - Deshabilita protección temporalmente

3. **Ejecutar reset**
   \`\`\`bash
   git checkout develop
   git reset --hard ${commitBeforeStack}
   git push origin develop --force
   \`\`\`

4. **Re-habilitar branch protection**

5. **Notificar al equipo**
   - Todos deben hacer \`git fetch && git reset --hard origin/develop\`

### Riesgos

- ❌ Otros PRs mergeados después del stack también se perderán
- ❌ Historial de git se reescribe
- ❌ Puede causar conflictos en branches activos
      `
    };
  }

  private async createRevertPR(
    repo: Repository,
    originalPR: MergedPR,
    revertBranch: string
  ): Promise<PullRequest> {
    return await this.githubMCP.createPullRequest(repo, {
      title: `🔙 Revert: ${originalPR.title}`,
      body: `
## Revert PR #${originalPR.number}

Este PR revierte los cambios de #${originalPR.number}.

### Razón del Revert

<!-- Describir por qué se está haciendo rollback -->

### Checklist

- [ ] Verificar que el revert no rompe otras funcionalidades
- [ ] Tests pasan
- [ ] No hay errores en logs

### Original PR

- PR: #${originalPR.number}
- Branch: \`${originalPR.branch}\`
- Merged: ${originalPR.mergedAt}

---
_Generado automáticamente por Stack Rollback Manager_
      `,
      head: revertBranch,
      base: 'develop'
    });
  }
}
```

### GitHub Action para Rollback

```yaml
# .github/workflows/stack-rollback.yml
name: Stack Rollback

on:
  workflow_dispatch:
    inputs:
      feature:
        description: 'Feature name del stack (ej: user-auth)'
        required: true
        type: string
      strategy:
        description: 'Estrategia de rollback'
        required: true
        type: choice
        options:
          - revert
          - feature-flag
      rollback_to:
        description: 'Número de PR hasta donde hacer rollback (opcional)'
        required: false
        type: string

jobs:
  rollback:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Get Stack PRs
        id: stack
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          FEATURE="${{ github.event.inputs.feature }}"

          # Obtener PRs mergeados del stack
          MERGED_PRS=$(gh pr list \
            --search "head:feature/${FEATURE}/ is:merged" \
            --json number,title,headRefName,mergeCommit \
            --jq 'sort_by(.headRefName) | reverse')

          echo "merged_prs=$MERGED_PRS" >> $GITHUB_OUTPUT
          echo "📚 PRs mergeados del stack:"
          echo "$MERGED_PRS" | jq -r '.[] | "  #\(.number) - \(.title)"'

      - name: Revert Strategy
        if: github.event.inputs.strategy == 'revert'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          FEATURE="${{ github.event.inputs.feature }}"
          MERGED_PRS='${{ steps.stack.outputs.merged_prs }}'

          echo "$MERGED_PRS" | jq -c '.[]' | while read pr; do
            PR_NUM=$(echo "$pr" | jq -r '.number')
            PR_TITLE=$(echo "$pr" | jq -r '.title')
            MERGE_COMMIT=$(echo "$pr" | jq -r '.mergeCommit.oid')
            BRANCH_NAME=$(echo "$pr" | jq -r '.headRefName')

            echo "🔙 Revirtiendo PR #$PR_NUM"

            # Crear branch de revert
            REVERT_BRANCH="revert/${BRANCH_NAME#feature/}"
            git checkout develop
            git pull origin develop
            git checkout -b "$REVERT_BRANCH"

            # Ejecutar revert
            git revert "$MERGE_COMMIT" --no-edit || {
              echo "⚠️ Conflicto en revert. Requiere resolución manual."
              exit 1
            }

            # Push y crear PR
            git push origin "$REVERT_BRANCH"

            gh pr create \
              --title "🔙 Revert: $PR_TITLE" \
              --body "Reverts #$PR_NUM

## Stack Rollback

Este PR es parte del rollback del stack \`$FEATURE\`.

### Original
- PR: #$PR_NUM
- Commit: $MERGE_COMMIT

---
_Auto-generated by Stack Rollback workflow_" \
              --base develop \
              --head "$REVERT_BRANCH"
          done

      - name: Feature Flag Strategy
        if: github.event.inputs.strategy == 'feature-flag'
        run: |
          FEATURE="${{ github.event.inputs.feature }}"
          FLAG_NAME="feature_${FEATURE//-/_}"

          echo "🚩 Desactivando feature flag: $FLAG_NAME"

          # Crear branch para deshabilitar flag
          git checkout -b "disable-flag/${FEATURE}"

          # Buscar y actualizar archivos de configuración
          # Esto depende de cómo se manejen los feature flags en el proyecto

          # Ejemplo: archivo JSON
          if [ -f "config/features.json" ]; then
            jq ".[\"$FLAG_NAME\"] = false" config/features.json > tmp.json
            mv tmp.json config/features.json
          fi

          # Ejemplo: archivo .env
          if [ -f ".env.example" ]; then
            echo "${FLAG_NAME^^}=false" >> .env.example
          fi

          git add .
          git commit -m "chore: disable feature flag $FLAG_NAME" || echo "No changes"
          git push origin "disable-flag/${FEATURE}"

          gh pr create \
            --title "🚩 Disable feature: $FEATURE" \
            --body "## Feature Flag Rollback

Desactiva el feature flag \`$FLAG_NAME\` para hacer rollback del stack \`$FEATURE\`.

### Acción requerida

Después de mergear este PR, también desactiva el flag en tu servicio de feature flags si usas uno externo.

---
_Auto-generated by Stack Rollback workflow_" \
            --base develop \
            --head "disable-flag/${FEATURE}"

      - name: Create Rollback Issue
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          FEATURE="${{ github.event.inputs.feature }}"
          STRATEGY="${{ github.event.inputs.strategy }}"

          gh issue create \
            --title "🔙 Rollback: Stack $FEATURE" \
            --body "## Stack Rollback en Progreso

### Detalles

- **Stack:** $FEATURE
- **Estrategia:** $STRATEGY
- **Iniciado por:** @${{ github.actor }}
- **Fecha:** $(date -u +%Y-%m-%dT%H:%M:%SZ)

### Status

- [ ] PRs de rollback creados
- [ ] PRs de rollback mergeados
- [ ] Verificación de rollback completado
- [ ] Notificación al equipo

### PRs de Rollback

<!-- Los PRs de rollback se agregarán aquí -->

---
_Auto-generated by Stack Rollback workflow_" \
            --label "rollback"
```

---

## 📊 Detección Automática de Tech Stack

### Detector Multi-Lenguaje

```typescript
class UniversalTechStackDetector {
  /**
   * Detecta el tech stack del proyecto de forma agnóstica
   */
  async detect(projectPath: string): Promise<TechStack> {
    const files = await this.scanDirectory(projectPath);

    return {
      language: this.detectLanguage(files),
      framework: this.detectFramework(files),
      packageManager: this.detectPackageManager(files),
      database: this.detectDatabase(files),
      runtime: this.detectRuntime(files),
      buildTool: this.detectBuildTool(files),
      testFramework: this.detectTestFramework(files),
      cicdPlatform: this.detectCICDPlatform(files),
      containerization: this.detectContainerization(files),
      cloudProvider: this.detectCloudProvider(files)
    };
  }

  private detectLanguage(files: string[]): LanguageInfo {
    const indicators: Record<string, LanguageConfig> = {
      // JavaScript / TypeScript
      'package.json': {
        language: 'javascript',
        checkForTypeScript: (f: string[]) => f.some(x => x.includes('tsconfig'))
      },

      // Python
      'requirements.txt': { language: 'python' },
      'Pipfile': { language: 'python' },
      'pyproject.toml': { language: 'python' },
      'setup.py': { language: 'python' },

      // Go
      'go.mod': { language: 'go' },

      // Rust
      'Cargo.toml': { language: 'rust' },

      // Java
      'pom.xml': { language: 'java', buildTool: 'maven' },
      'build.gradle': { language: 'java', buildTool: 'gradle' },
      'build.gradle.kts': { language: 'kotlin', buildTool: 'gradle' },

      // Ruby
      'Gemfile': { language: 'ruby' },

      // PHP
      'composer.json': { language: 'php' },

      // C# / .NET
      '*.csproj': { language: 'csharp' },
      '*.sln': { language: 'csharp' },

      // Elixir
      'mix.exs': { language: 'elixir' },

      // Swift
      'Package.swift': { language: 'swift' },

      // Dart / Flutter
      'pubspec.yaml': { language: 'dart' },

      // Scala
      'build.sbt': { language: 'scala' },

      // Clojure
      'project.clj': { language: 'clojure' },
      'deps.edn': { language: 'clojure' },
    };

    for (const [indicator, config] of Object.entries(indicators)) {
      if (files.some(f => this.matchPattern(f, indicator))) {
        let language = config.language;

        // Check for TypeScript
        if (config.checkForTypeScript && config.checkForTypeScript(files)) {
          language = 'typescript';
        }

        return {
          name: language,
          version: this.detectLanguageVersion(files, language),
          buildTool: config.buildTool
        };
      }
    }

    return { name: 'unknown' };
  }

  private detectFramework(files: string[]): FrameworkInfo {
    const frameworkIndicators: Record<string, FrameworkConfig> = {
      // JavaScript Frameworks
      'next.config': { name: 'nextjs', type: 'fullstack', language: 'javascript' },
      'nuxt.config': { name: 'nuxt', type: 'fullstack', language: 'javascript' },
      'svelte.config': { name: 'sveltekit', type: 'fullstack', language: 'javascript' },
      'astro.config': { name: 'astro', type: 'frontend', language: 'javascript' },
      'remix.config': { name: 'remix', type: 'fullstack', language: 'javascript' },
      'angular.json': { name: 'angular', type: 'frontend', language: 'typescript' },
      'vite.config': { name: 'vite', type: 'frontend', language: 'javascript' },
      'gatsby-config': { name: 'gatsby', type: 'frontend', language: 'javascript' },
      '.eleventy': { name: 'eleventy', type: 'frontend', language: 'javascript' },
      'vue.config': { name: 'vue', type: 'frontend', language: 'javascript' },

      // Node.js Backend
      'nest-cli.json': { name: 'nestjs', type: 'backend', language: 'typescript' },
      'express': { name: 'express', type: 'backend', language: 'javascript' },
      'fastify': { name: 'fastify', type: 'backend', language: 'javascript' },
      'koa': { name: 'koa', type: 'backend', language: 'javascript' },
      'hono': { name: 'hono', type: 'backend', language: 'javascript' },

      // Python Frameworks
      'manage.py': { name: 'django', type: 'fullstack', language: 'python' },
      'fastapi': { name: 'fastapi', type: 'backend', language: 'python' },
      'flask': { name: 'flask', type: 'backend', language: 'python' },
      'starlette': { name: 'starlette', type: 'backend', language: 'python' },
      'tornado': { name: 'tornado', type: 'backend', language: 'python' },
      'pyramid': { name: 'pyramid', type: 'backend', language: 'python' },

      // Go Frameworks
      'gin': { name: 'gin', type: 'backend', language: 'go' },
      'fiber': { name: 'fiber', type: 'backend', language: 'go' },
      'echo': { name: 'echo', type: 'backend', language: 'go' },
      'chi': { name: 'chi', type: 'backend', language: 'go' },

      // Rust Frameworks
      'actix': { name: 'actix-web', type: 'backend', language: 'rust' },
      'axum': { name: 'axum', type: 'backend', language: 'rust' },
      'rocket': { name: 'rocket', type: 'backend', language: 'rust' },
      'warp': { name: 'warp', type: 'backend', language: 'rust' },

      // Java/Kotlin Frameworks
      'spring': { name: 'spring-boot', type: 'backend', language: 'java' },
      'quarkus': { name: 'quarkus', type: 'backend', language: 'java' },
      'micronaut': { name: 'micronaut', type: 'backend', language: 'java' },
      'ktor': { name: 'ktor', type: 'backend', language: 'kotlin' },

      // Ruby Frameworks
      'config/routes.rb': { name: 'rails', type: 'fullstack', language: 'ruby' },
      'sinatra': { name: 'sinatra', type: 'backend', language: 'ruby' },
      'hanami': { name: 'hanami', type: 'backend', language: 'ruby' },

      // PHP Frameworks
      'artisan': { name: 'laravel', type: 'fullstack', language: 'php' },
      'symfony.lock': { name: 'symfony', type: 'backend', language: 'php' },
      'slim': { name: 'slim', type: 'backend', language: 'php' },

      // Elixir Frameworks
      'phoenix': { name: 'phoenix', type: 'fullstack', language: 'elixir' },

      // .NET Frameworks
      'Startup.cs': { name: 'aspnet-core', type: 'backend', language: 'csharp' },
    };

    for (const [indicator, config] of Object.entries(frameworkIndicators)) {
      if (this.hasIndicator(files, indicator)) {
        return config;
      }
    }

    return { name: 'generic', type: 'unknown' };
  }

  private detectDatabase(files: string[]): DatabaseInfo[] {
    const databases: DatabaseInfo[] = [];

    const dbIndicators: Record<string, DatabaseInfo> = {
      // SQL Databases
      'prisma/schema.prisma': { type: 'sql', name: 'prisma' },
      'drizzle': { type: 'sql', name: 'drizzle' },
      'sequelize': { type: 'sql', name: 'sequelize' },
      'typeorm': { type: 'sql', name: 'typeorm' },
      'knexfile': { type: 'sql', name: 'knex' },
      'alembic': { type: 'sql', name: 'alembic' },
      'sqlalchemy': { type: 'sql', name: 'sqlalchemy' },
      'diesel': { type: 'sql', name: 'diesel' },
      'gorm': { type: 'sql', name: 'gorm' },
      'activerecord': { type: 'sql', name: 'activerecord' },
      'eloquent': { type: 'sql', name: 'eloquent' },
      'ecto': { type: 'sql', name: 'ecto' },

      // NoSQL Databases
      'mongodb': { type: 'nosql', name: 'mongodb' },
      'mongoose': { type: 'nosql', name: 'mongoose' },
      'redis': { type: 'cache', name: 'redis' },
      'dynamodb': { type: 'nosql', name: 'dynamodb' },
      'firebase': { type: 'nosql', name: 'firebase' },
      'supabase': { type: 'sql', name: 'supabase' },
    };

    for (const [indicator, dbInfo] of Object.entries(dbIndicators)) {
      if (this.hasIndicator(files, indicator)) {
        databases.push(dbInfo);
      }
    }

    return databases;
  }

  private detectTestFramework(files: string[]): TestFrameworkInfo[] {
    const testFrameworks: TestFrameworkInfo[] = [];

    const testIndicators: Record<string, TestFrameworkInfo> = {
      // JavaScript Testing
      'jest.config': { name: 'jest', language: 'javascript' },
      'vitest.config': { name: 'vitest', language: 'javascript' },
      'mocha': { name: 'mocha', language: 'javascript' },
      'playwright.config': { name: 'playwright', language: 'javascript', type: 'e2e' },
      'cypress.config': { name: 'cypress', language: 'javascript', type: 'e2e' },

      // Python Testing
      'pytest.ini': { name: 'pytest', language: 'python' },
      'conftest.py': { name: 'pytest', language: 'python' },
      'unittest': { name: 'unittest', language: 'python' },

      // Go Testing
      '_test.go': { name: 'go-test', language: 'go' },

      // Rust Testing
      '#[test]': { name: 'rust-test', language: 'rust' },

      // Java Testing
      'junit': { name: 'junit', language: 'java' },
      'testng': { name: 'testng', language: 'java' },

      // Ruby Testing
      'rspec': { name: 'rspec', language: 'ruby' },
      'minitest': { name: 'minitest', language: 'ruby' },

      // PHP Testing
      'phpunit.xml': { name: 'phpunit', language: 'php' },
    };

    for (const [indicator, info] of Object.entries(testIndicators)) {
      if (this.hasIndicator(files, indicator)) {
        testFrameworks.push(info);
      }
    }

    return testFrameworks;
  }

  private detectContainerization(files: string[]): ContainerInfo {
    if (files.some(f => f.includes('Dockerfile'))) {
      return {
        type: 'docker',
        hasCompose: files.some(f => f.includes('docker-compose')),
        hasKubernetes: files.some(f =>
          f.includes('k8s') ||
          f.includes('kubernetes') ||
          f.includes('helm')
        )
      };
    }

    if (files.some(f => f.includes('Containerfile'))) {
      return { type: 'podman' };
    }

    return { type: 'none' };
  }
}
```

---

## 🎯 Actualización del Workflow Principal

```typescript
class FreelancePlannerV4Enhanced {
  async executeFull(
    projectPath: string,
    options: PlannerOptions
  ): Promise<ExecutionResult> {
    console.log('🚀 Freelance Project Planner v4.1 (Enhanced)');
    console.log('📚 GitFlow + Stacked PRs + Multi-Language Support\n');

    // FASE 0: Detección de Tech Stack
    console.log('🔍 FASE 0: Detección de Tech Stack');
    const techStack = await this.techDetector.detect(projectPath);
    this.printTechStackSummary(techStack);

    // FASE 1: Docker (adaptado al stack detectado)
    console.log('\n🐳 FASE 1: Dockerización');
    const dockerSetup = await this.dockerGenerator.generate(techStack);

    // FASE 2: GitHub Actions (multi-lenguaje)
    console.log('\n⚙️  FASE 2: GitHub Actions');
    const workflows = await this.workflowGenerator.generate(techStack, {
      stackedPRs: true,
      previewEnvironments: options.previewEnvironments,
      notifications: options.notifications
    });

    // FASE 3: GitFlow Setup
    console.log('\n🌳 FASE 3: GitFlow Setup');
    await this.setupGitFlow(options.repo);

    // FASE 4: CODEOWNERS
    console.log('\n👥 FASE 4: CODEOWNERS');
    const codeowners = await this.codeownersGenerator.generate(projectPath);

    // FASE 5: Stacked PR Tooling
    console.log('\n🛠️  FASE 5: Stacked PR Tooling');
    await this.setupStackTooling(projectPath);

    // FASE 6: Planificación como Stacks
    console.log('\n📚 FASE 6: Generación de Stacks');
    const stacks = await this.planIterationsAsStacks(analysis);

    // FASE 7: Notificaciones
    if (options.notifications) {
      console.log('\n🔔 FASE 7: Configuración de Notificaciones');
      await this.setupNotifications(options);
    }

    // FASE 8: Rollback Strategy
    console.log('\n🔙 FASE 8: Documentación de Rollback');
    const rollbackDocs = await this.generateRollbackDocs(stacks);

    this.printFinalSummary({
      techStack,
      dockerSetup,
      workflows,
      codeowners,
      stacks,
      rollbackDocs
    });

    return { /* ... */ };
  }
}
```
