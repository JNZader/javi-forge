import type { InitStep } from '../types/index.js'
import {
  installPlugin,
  removePlugin,
  listInstalledPlugins,
  validatePlugin,
  searchRegistry,
  syncPlugins,
} from '../lib/plugin.js'
import { exportPluginAsAgentSkills, importAgentSkillsPackage } from '../lib/agent-skills.js'
import { exportPluginAsCodexToml } from '../lib/codex-export.js'

type StepCallback = (step: InitStep) => void

function report(onStep: StepCallback, id: string, label: string, status: InitStep['status'], detail?: string) {
  onStep({ id, label, status, detail })
}

/**
 * Add (install) a plugin from a GitHub source.
 */
export async function runPluginAdd(
  source: string,
  dryRun: boolean,
  onStep: StepCallback
): Promise<void> {
  const stepId = 'plugin-add'
  report(onStep, stepId, `Install plugin: ${source}`, 'running')

  const result = await installPlugin(source, { dryRun })

  if (result.success) {
    report(onStep, stepId, `Install plugin: ${source}`, 'done',
      dryRun ? `dry-run: would install ${result.name}` : `installed ${result.name}`)
  } else {
    report(onStep, stepId, `Install plugin: ${source}`, 'error', result.error)
  }
}

/**
 * Remove an installed plugin by name.
 */
export async function runPluginRemove(
  name: string,
  dryRun: boolean,
  onStep: StepCallback
): Promise<void> {
  const stepId = 'plugin-remove'
  report(onStep, stepId, `Remove plugin: ${name}`, 'running')

  const result = await removePlugin(name, { dryRun })

  if (result.success) {
    report(onStep, stepId, `Remove plugin: ${name}`, 'done',
      dryRun ? `dry-run: would remove ${name}` : `removed ${name}`)
  } else {
    report(onStep, stepId, `Remove plugin: ${name}`, 'error', result.error)
  }
}

/**
 * List all installed plugins.
 */
export async function runPluginList(
  onStep: StepCallback
): Promise<void> {
  const stepId = 'plugin-list'
  report(onStep, stepId, 'List installed plugins', 'running')

  const plugins = await listInstalledPlugins()

  if (plugins.length === 0) {
    report(onStep, stepId, 'List installed plugins', 'done', 'no plugins installed')
  } else {
    const summary = plugins.map(p => `${p.name}@${p.version}`).join(', ')
    report(onStep, stepId, 'List installed plugins', 'done', `${plugins.length} plugins: ${summary}`)
  }
}

/**
 * Search the remote plugin registry.
 */
export async function runPluginSearch(
  query: string | undefined,
  onStep: StepCallback
): Promise<void> {
  const stepId = 'plugin-search'
  report(onStep, stepId, `Search plugins${query ? `: ${query}` : ''}`, 'running')

  const results = await searchRegistry(query)

  if (results.length === 0) {
    report(onStep, stepId, `Search plugins${query ? `: ${query}` : ''}`, 'done',
      query ? `no plugins matching "${query}"` : 'registry empty or unreachable')
  } else {
    const summary = results.map(p => `${p.id} — ${p.description}`).join('\n  ')
    report(onStep, stepId, `Search plugins${query ? `: ${query}` : ''}`, 'done',
      `${results.length} results:\n  ${summary}`)
  }
}

/**
 * Validate a local plugin directory.
 */
export async function runPluginValidate(
  pluginDir: string,
  onStep: StepCallback
): Promise<void> {
  const stepId = 'plugin-validate'
  report(onStep, stepId, `Validate plugin: ${pluginDir}`, 'running')

  const result = await validatePlugin(pluginDir)

  if (result.valid) {
    report(onStep, stepId, `Validate plugin: ${pluginDir}`, 'done',
      `valid — ${result.manifest?.name}@${result.manifest?.version}`)
  } else {
    const msgs = result.errors.map(e => `  ${e.path}: ${e.message}`).join('\n')
    report(onStep, stepId, `Validate plugin: ${pluginDir}`, 'error', `${result.errors.length} errors:\n${msgs}`)
  }
}

/**
 * Sync detected plugins into the project manifest.
 */
export async function runPluginSync(
  projectDir: string,
  dryRun: boolean,
  onStep: StepCallback
): Promise<void> {
  const stepId = 'plugin-sync'
  report(onStep, stepId, 'Sync plugins', 'running')

  try {
    const result = await syncPlugins(projectDir, { dryRun })

    const parts: string[] = []
    if (result.added.length > 0)     parts.push(`added: ${result.added.join(', ')}`)
    if (result.removed.length > 0)   parts.push(`removed: ${result.removed.join(', ')}`)
    if (result.unchanged.length > 0) parts.push(`unchanged: ${result.unchanged.join(', ')}`)
    if (result.wired.length > 0)     parts.push(`wired: ${result.wired.length} capabilities`)
    if (result.unwired.length > 0)   parts.push(`unwired: ${result.unwired.length} capabilities`)
    if (parts.length === 0)          parts.push('no plugins detected')

    const prefix = dryRun ? 'dry-run: ' : ''
    report(onStep, stepId, 'Sync plugins', 'done', `${prefix}${parts.join(' | ')}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    report(onStep, stepId, 'Sync plugins', 'error', msg)
  }
}

/**
 * Export an installed plugin to Agent Skills spec format.
 */
export async function runPluginExport(
  name: string,
  onStep: StepCallback
): Promise<void> {
  const stepId = 'plugin-export'
  report(onStep, stepId, `Export plugin: ${name}`, 'running')

  const result = await exportPluginAsAgentSkills(name)

  if (result.success) {
    report(onStep, stepId, `Export plugin: ${name}`, 'done',
      `exported to ${result.path}`)
  } else {
    report(onStep, stepId, `Export plugin: ${name}`, 'error', result.error)
  }
}

/**
 * Export an installed plugin to Codex-compatible TOML subagent files.
 */
export async function runPluginExportCodex(
  name: string,
  onStep: StepCallback
): Promise<void> {
  const stepId = 'plugin-export-codex'
  report(onStep, stepId, `Export plugin as Codex TOML: ${name}`, 'running')

  const result = await exportPluginAsCodexToml(name)

  if (result.success) {
    report(onStep, stepId, `Export plugin as Codex TOML: ${name}`, 'done',
      `exported ${result.files!.length} TOML file(s)`)
  } else {
    report(onStep, stepId, `Export plugin as Codex TOML: ${name}`, 'error', result.error)
  }
}

/**
 * Import an Agent Skills spec package and convert to javi-forge plugin format.
 */
export async function runPluginImport(
  sourceDir: string,
  dryRun: boolean,
  onStep: StepCallback
): Promise<void> {
  const stepId = 'plugin-import'
  report(onStep, stepId, `Import agent-skills package: ${sourceDir}`, 'running')

  const result = await importAgentSkillsPackage(sourceDir, { dryRun })

  if (result.success) {
    report(onStep, stepId, `Import agent-skills package: ${sourceDir}`, 'done',
      dryRun ? `dry-run: would import ${result.name}` : `imported ${result.name}`)
  } else {
    report(onStep, stepId, `Import agent-skills package: ${sourceDir}`, 'error', result.error)
  }
}
