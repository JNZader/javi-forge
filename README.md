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

## Current State

Skeleton minimo preparado para recibir templates y automatizaciones, sin migrar aun assets de `project-starter-framework` ni `ghagga`.
