# javi-forge

Base para templates, scaffolding y estandarizacion de nuevos proyectos.

## Role

`javi-forge` define como nacen los repos nuevos del ecosistema: templates, hooks de scaffolding, CI reusable y helpers de inicializacion.

## Starter Layout

```text
javi-forge/
├── README.md
├── .gitignore
├── templates/
│   ├── web/base/          # template.web.base — web/Node CI
│   ├── api/base/          # template.api.base — generic API CI
│   ├── api/go/            # template.api.go — Go API
│   ├── api/java/          # template.api.java — Java/Spring Boot
│   ├── api/python/        # template.api.python — Python/FastAPI
│   ├── fullstack/base/    # template.fullstack.base — parallel frontend+backend
│   └── docs/base/         # template.docs.base — MkDocs + GitHub Pages
├── generators/
│   └── review/automation/ # generator.review.automation — ghagga (github-action | self-hosted)
├── ci/
│   └── bootstrap/ci-local/ # generator.ci.bootstrap — CI local family
├── docs/
│   ├── quickstart.md      # first-time usage guide
│   ├── FORGE-AUTHORITY.md
│   └── contracts/
├── scripts/
│   └── forge-init.sh      # stable entrypoint
└── lib/
    └── common.sh
```

## Directory Intent

- `templates/`: blueprints y starter repos por stack o modalidad.
- `docs/`: contratos de scaffold, convenciones y notas de uso.
- `scripts/`: entrypoints ligeros para init, sync y validacion local.
- `ci/`: activos reusables de pipeline y automatizacion base para proyectos generados.

## Boundaries

Este repo debe concentrarse en:

- templates y blueprints reutilizables
- generadores de proyectos
- CI base y convenciones de scaffolding por stack
- activos reutilizables para bootstrap de repos y workflows de equipo

Este repo no deberia ser el hogar principal de:

- bootstrap global de la maquina
- configuracion profunda de asistentes de IA del usuario
- dotfiles o perfiles de sistema

## Ecosystem Fit

- `../javi-dots`: deja la maquina lista para usar los templates y generadores.
- `../javi-ai`: aporta tooling de IA que algunos templates podran consumir luego via integraciones explicitas.
- `../vault/Javi.Dots`: referencia legacy.
- `../docs/adr/ADR-0001-repo-boundaries.md`: boundary source of truth.

## Contract Governance

- `docs/contracts/catalog.yaml` y `docs/contracts/ai-integrations.yaml` son el punto de partida publico para el contrato forge de `ecosystem-restructure`.
- `docs/FORGE-AUTHORITY.md` es la guia canonica para los slices de forge ya migrados; las notas legacy o referencias a `project-starter-framework` quedan solo como contexto historico para slices no migrados.
- La gobernanza y el namespace aprobado viven en `../javi-platform/docs/contracts/CONTRACT-INDEX.md` y `../javi-platform/openspec/changes/ecosystem-restructure/contracts.md`.
- Los consumers deben depender de IDs y contratos publicados, nunca del layout interno de `templates/`, `scripts/` o `ci/`.

## Current State

El milestone `javi-forge-completion` trae `javi-forge` a 100% practico.

Templates implementados (7):

- `template.web.base` — web/Node CI baseline
- `template.api.base` — API/backend CI language-agnostic
- `template.api.go` — Go API (golangci-lint + go test)
- `template.api.java` — Java/Spring Boot Gradle (Spotless + test)
- `template.api.python` — Python/FastAPI (ruff + pytest)
- `template.fullstack.base` — parallel frontend+backend CI
- `template.docs.base` — MkDocs build + GitHub Pages deploy

Generators implementados (3):

- `generator.project.init` — entrypoint de init
- `generator.ci.bootstrap` — familia CI local (standalone + composable)
- `generator.review.automation` — review via ghagga (github-action | self-hosted)

Ver `docs/quickstart.md` para la guia de primera vez. Las referencias legacy siguen solo como background historico.
