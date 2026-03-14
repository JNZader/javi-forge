# Forge Authority

## Purpose

This document is the canonical authority guide for the migrated forge slices owned by
`javi-forge`.

It records the WI-028 cutover, the `forge-slice-expansion` milestone that promoted stub template and generator IDs to implemented slices, and the `javi-forge-completion` milestone that adds stack-specific API templates, standalone CI bootstrap, self-hosted review mode, and real MkDocs docs wiring.

## Canonical Authority

`javi-forge` is the canonical owner of:

- `docs/contracts/catalog.yaml`
- `docs/contracts/ai-integrations.yaml`
- `docs/quickstart.md`
- `scripts/forge-init.sh`
- `templates/`
- `generators/`
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
| `generator.review.automation` | `generators/review/automation/` | implemented in forge-slice-expansion; self-hosted mode added in javi-forge-completion | ghagga (https://github.com/JNZader/ghagga) is the upstream reference |
| `template.api.go` | `templates/api/go/` | implemented in javi-forge-completion | PSF Go CI patterns are upstream reference only |
| `template.api.java` | `templates/api/java/` | implemented in javi-forge-completion | PSF Java/Gradle CI patterns are upstream reference only |
| `template.api.python` | `templates/api/python/` | implemented in javi-forge-completion | PSF Python/pytest CI patterns are upstream reference only |

## WI-028 Cutover Effect

For the migrated slices above:

- new edits must land in `javi-forge`
- `project-starter-framework` paths remain lineage/reference inputs only
- legacy/template notes no longer define the authoritative usage path
- public consumption stays bounded to `docs/contracts/*.yaml` and `scripts/forge-init.sh`

## Current Implementation State

The `javi-forge-completion` milestone brings all catalog IDs to practical 100%.

Implemented slices:

- 7 templates: web.base, api.base, api.go, api.java, api.python, fullstack.base, docs.base
- 3 generators: project.init, review.automation (github-action + self-hosted), ci.bootstrap (standalone + composable)

Later-scope work includes:

- Rust and Go module template variants
- Additional generator families for database schema, Dockerfile, etc.
- Interactive project wizard UI

## Reader Guidance

Use these files together:

- `docs/FORGE-AUTHORITY.md` for canonical ownership of migrated forge slices
- `docs/contracts/catalog.yaml` for the published template/generator contract space
- `docs/contracts/ai-integrations.yaml` for optional project-facing AI package mappings
- `scripts/forge-init.sh --list-contracts` for the current stable entrypoint surface
