# Forge Authority

## Purpose

This document is the canonical authority guide for the migrated forge slices owned by
`javi-forge`.

It records the WI-028 cutover that stops treating legacy/template notes and
`project-starter-framework` references as the authoritative home for the slices already
extracted in WI-023, and the `forge-slice-expansion` milestone that promotes the remaining
published-but-stub template and generator IDs to implemented slices.

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

| Surface | Canonical home | Status | Legacy/reference status |
|---|---|---|---|
| `template.web.base` | `templates/web/base/` | extracted in WI-023, cut over in WI-028 | external template notes are historical background only |
| `generator.project.init` | `scripts/forge-init.sh` | implemented in WI-023, cut over in WI-028 | consumers must use the stable entrypoint, not template-internal scripts |
| `generator.ci.bootstrap` | `ci/bootstrap/ci-local/` | extracted in WI-023, cut over in WI-028 | external CI/bootstrap notes are historical background only |
| `template.api.base` | `templates/api/base/` | implemented in forge-slice-expansion | PSF multi-stack CI patterns are upstream reference only |
| `template.fullstack.base` | `templates/fullstack/base/` | implemented in forge-slice-expansion | PSF monorepo/fullstack CI patterns are upstream reference only |
| `template.docs.base` | `templates/docs/base/` | implemented in forge-slice-expansion | PSF and docs tool patterns are upstream reference only |
| `generator.review.automation` | `generators/review/automation/` | implemented in forge-slice-expansion | ghagga (https://github.com/JNZader/ghagga) is the upstream reference |

## WI-028 Cutover Effect

For the migrated slices above:

- new edits must land in `javi-forge`
- `project-starter-framework` paths remain lineage/reference inputs only
- legacy/template notes no longer define the authoritative usage path
- public consumption stays bounded to `docs/contracts/*.yaml` and `scripts/forge-init.sh`

## Remaining Non-Migrated Forge Scope

The `forge-slice-expansion` milestone closes the gap on all currently published template and generator IDs.

All four previously-stub IDs are now implemented slices. Later-scope work includes:

- adding stack-specific variant templates (e.g. `template.api.java`, `template.api.go`)
- expanding `generator.review.automation` to support self-hosted ghagga server mode
- implementing additional generator families not yet in the catalog

## Reader Guidance

Use these files together:

- `docs/FORGE-AUTHORITY.md` for canonical ownership of migrated forge slices
- `docs/contracts/catalog.yaml` for the published template/generator contract space
- `docs/contracts/ai-integrations.yaml` for optional project-facing AI package mappings
- `scripts/forge-init.sh --list-contracts` for the current stable entrypoint surface
