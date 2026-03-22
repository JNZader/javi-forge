# Plan: integration-tests

## Goal

Reemplazar los unit tests sobre-mockeados con integration tests que usen filesystem real. Los unit tests actuales mockean fs-extra, child_process, y todos los módulos internos — testean que los callbacks se llamen en orden pero NO que los archivos se creen correctamente. Esto permitió que bugs como `__PROJECT_NAME__` sin reemplazar, `lib/common.sh` faltante en ci-local, y `--no-docker` ignorado pasaran todos los tests en verde.

La estrategia: mantener los unit tests puros (frontmatter, docker content) y agregar una capa de **integration tests con filesystem real** que ejecuten funciones reales contra temp dirs.

## Acceptance Criteria

- [ ] `initProject()` integration test: verifica que TODOS los archivos generados existan y tengan contenido correcto (CI workflow, manifest, hooks, modules, gitignore, dependabot)
- [ ] Template integration test: renderiza templates REALES y verifica que los placeholders se reemplacen y el YAML sea válido
- [ ] ci-local integration test: verifica que ci-local copiado sea autocontenido (lib/common.sh presente, hooks ejecutables)
- [ ] Plugin validation integration test: crea plugin fixtures reales en disco y valida contra el schema
- [ ] `--no-docker` integration test: verifica que runCI con noDocker=true NO chequee Docker
- [ ] Module installation test: verifica archivos críticos de cada módulo después de copy (engram, obsidian-brain, ghagga)
- [ ] Dependabot YAML test: genera dependabot.yml real y valida que sea YAML parseable con los ecosistemas correctos por stack
- [ ] MCP config snippet test: verifica que `__PROJECT_NAME__` se reemplace en `.mcp-config-snippet.json`
- [ ] Ghagga workflow test: verifica que el workflow generado sea un caller (on: pull_request) y no el reusable (on: workflow_call)
- [ ] Manifest test: verifica estructura JSON completa con timestamps válidos y módulos correctos
- [ ] Los integration tests corren en < 10 segundos
- [ ] Coverage se mantiene >= 85% lines, 80% branches

## Task List

| # | Task | Estimate | Depends On | Status |
|---|------|----------|------------|--------|
| 1 | Crear test helper: `createTempDir()` + `cleanupTempDir()` + `readGenerated()` | 15m | — | done ✅ |
| 2 | Integration test: `initProject()` — full happy path con fs real (node+github+engram+ghagga) | 30m | 1 | done ✅ |
| 3 | Integration test: `initProject()` — verifica contenido de cada archivo generado | 30m | 2 | done ✅ |
| 4 | Integration test: template rendering — lee templates reales, verifica YAML válido | 20m | 1 | done ✅ |
| 5 | Integration test: ci-local self-contained — verifica lib/common.sh, hooks +x, semgrep.yml | 15m | 1 | done ✅ |
| 6 | Integration test: module installation — engram (MCP snippet con project name), obsidian-brain (estructura), ghagga (caller workflow) | 25m | 2 | done ✅ |
| 7 | Integration test: `runCI()` con noDocker=true — no crashea, no chequea Docker | 15m | 1 | done ✅ |
| 8 | Integration test: plugin validation — fixture con plugin.json real en disco | 15m | 1 | done ✅ |
| 9 | Integration test: dependabot YAML — genera para cada stack, parsea con yaml lib | 15m | 1 | done ✅ |
| 10 | Integration test: cross-stack — genera proyecto para cada stack+CI provider combo | 20m | 2 | done ✅ |
| 11 | Actualizar vitest.config.ts para incluir integration tests sin excluirlos | 5m | 1 | done ✅ (config already includes src/**) |
| 12 | Verificar que todos los tests pasen y coverage se mantenga | 10m | 2-10 | done ✅ (299 tests pass) |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Integration tests lentos por fs real | Med | Low | Usar `fs.mkdtemp` en tmpfs, paralelizar con `describe.concurrent` |
| Tests frágiles si templates cambian | Med | Med | Testear estructura (YAML parseable, keys existen) no contenido exacto |
| `git init` en tests contamina estado | Low | Med | Cada test usa su propio tmpdir, cleanup en afterEach |
| `execFile` calls a git/npx fallan en CI | Med | Med | Mock solo external tools (git, npx), no fs |

## Dependencies

- `yaml` package (ya es dependency del proyecto) para validar YAML generado
- Temp dir del OS (`/tmp` o `os.tmpdir()`)
- Templates y modules reales del repo (se leen en runtime)

## Notes

- NO mockeamos fs-extra en integration tests — ese es el punto
- SÍ mockeamos `execFile` para git y npx (no queremos git init real ni npx javi-ai real)
- Los unit tests existentes se mantienen como están — agregan velocidad y coverage de branches
- Los integration tests van en `src/__integration__/` para separarlos claramente
- Cada test crea su propio tmpdir y lo limpia — sin estado compartido entre tests
