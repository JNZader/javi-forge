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
│   ├── web/base/          # template.web.base — web/Node CI baseline
│   ├── api/base/          # template.api.base — API/backend CI (language-agnostic)
│   ├── fullstack/base/    # template.fullstack.base — parallel frontend+backend CI
│   └── docs/base/         # template.docs.base — docs build + GitHub Pages deploy
├── generators/
│   └── review/automation/ # generator.review.automation — ghagga code review
├── docs/
├── scripts/
└── ci/
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

El milestone `forge-slice-expansion` completa el primer ciclo de implementacion de todos los template y generator IDs publicados en el catalogo.

Slices implementados:

- `template.web.base` — web/Node CI baseline (WI-023)
- `template.api.base` — API/backend CI language-agnostic (forge-slice-expansion)
- `template.fullstack.base` — parallel frontend+backend CI (forge-slice-expansion)
- `template.docs.base` — docs build + GitHub Pages deploy (forge-slice-expansion)
- `generator.project.init` — entrypoint de init (WI-023)
- `generator.ci.bootstrap` — familia CI local (WI-023)
- `generator.review.automation` — review automatico via ghagga GitHub Action (forge-slice-expansion)

Las referencias legacy o de `project-starter-framework` siguen solo como background historico y referencia de lineage.
