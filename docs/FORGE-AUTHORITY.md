# Forge Authority

## Purpose

This document is the canonical authority guide for the migrated forge slices owned by
`javi-forge`.

It records the WI-028 cutover that stops treating legacy/template notes and
`project-starter-framework` references as the authoritative home for the slices already
extracted in WI-023.

## Canonical Authority

For the migrated forge slice, `javi-forge` is now the canonical owner of:

- `docs/contracts/catalog.yaml`
- `docs/contracts/ai-integrations.yaml`
- `scripts/forge-init.sh`
- `templates/web/base/`
- `ci/bootstrap/ci-local/`

Consumers must use the published template IDs, generator IDs, and stable forge
entrypoint instead of reading template notes or external source layout.

## Migrated Slice Matrix

| Surface | Canonical home | WI status | Legacy/reference status |
|---|---|---|---|
| `template.web.base` | `templates/web/base/` | extracted in WI-023, cut over in WI-028 | external template notes are historical background only |
| `generator.project.init` | `scripts/forge-init.sh` | implemented in WI-023, cut over in WI-028 | consumers must use the stable entrypoint, not template-internal scripts |
| `generator.ci.bootstrap` | `ci/bootstrap/ci-local/` | extracted in WI-023, cut over in WI-028 | external CI/bootstrap notes are historical background only |

## WI-028 Cutover Effect

For the migrated slices above:

- new edits must land in `javi-forge`
- `project-starter-framework` paths remain lineage/reference inputs only
- legacy/template notes no longer define the authoritative usage path
- public consumption stays bounded to `docs/contracts/*.yaml` and `scripts/forge-init.sh`

## Remaining Non-Migrated Forge Scope

WI-028 does not claim that every planned forge family is already extracted.

These items remain contract-only or later-scope work:

- `template.api.base`
- `template.fullstack.base`
- `template.docs.base`
- `generator.review.automation`

Historical notes or external references may still help discovery for those non-migrated
families, but they are not authoritative for the migrated WI-023 slice.

## Reader Guidance

Use these files together:

- `docs/FORGE-AUTHORITY.md` for canonical ownership of migrated forge slices
- `docs/contracts/catalog.yaml` for the published template/generator contract space
- `docs/contracts/ai-integrations.yaml` for optional project-facing AI package mappings
- `scripts/forge-init.sh --list-contracts` for the current stable entrypoint surface
