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

`javi-forge` ya es el hogar canonico del primer slice extraido de forge (`template.web.base`, `generator.project.init`, `generator.ci.bootstrap`).

Las referencias legacy o de `project-starter-framework` ya no son la fuente autoritativa para esos slices migrados; solo siguen como background historico y para familias todavia no extraidas.
