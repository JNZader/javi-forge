import fs from 'fs-extra'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { detectStack } from '../lib/common.js'
import { listInstalledPlugins } from '../lib/plugin.js'
import { FORGE_ROOT, TEMPLATES_DIR, MODULES_DIR, AI_CONFIG_DIR, PLUGINS_DIR } from '../constants.js'
import type { DoctorResult, DoctorSection, DoctorCheck, ForgeManifest } from '../types/index.js'

const execFileAsync = promisify(execFile)

export type CheckStatus = 'ok' | 'fail' | 'skip'

/** Resolve a binary name to its full path, returns null if not found */
async function which(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [bin])
    return stdout.trim() || null
  } catch {
    return null
  }
}

/** Read the forge manifest from a project directory */
async function readManifest(projectDir: string): Promise<ForgeManifest | null> {
  const manifestPath = path.join(projectDir, '.javi-forge', 'manifest.json')
  if (!await fs.pathExists(manifestPath)) return null
  try {
    return await fs.readJson(manifestPath) as ForgeManifest
  } catch {
    return null
  }
}

/** Count entries in a directory */
async function countDir(dir: string): Promise<number> {
  if (!await fs.pathExists(dir)) return 0
  const entries = await fs.readdir(dir)
  return entries.filter(e => !e.startsWith('.')).length
}

/**
 * Run comprehensive health checks for the project and framework.
 */
export async function runDoctor(projectDir?: string): Promise<DoctorResult> {
  const cwd = projectDir ?? process.cwd()
  const sections: DoctorSection[] = []

  // ── 1. System Tools ────────────────────────────────────────────────────────
  const toolChecks: DoctorCheck[] = []
  const tools = [
    { name: 'git', label: 'Git' },
    { name: 'docker', label: 'Docker' },
    { name: 'semgrep', label: 'Semgrep' },
    { name: 'node', label: 'Node.js' },
    { name: 'pnpm', label: 'pnpm' },
  ]

  for (const tool of tools) {
    const bin = await which(tool.name)
    if (bin) {
      // Try to get version
      let version = ''
      try {
        const { stdout } = await execFileAsync(tool.name, ['--version'])
        version = stdout.trim().split('\n')[0] ?? ''
      } catch { /* ignore */ }
      toolChecks.push({
        label: tool.label,
        status: 'ok',
        detail: version ? `${version}` : `found at ${bin}`,
      })
    } else {
      toolChecks.push({
        label: tool.label,
        status: tool.name === 'docker' || tool.name === 'semgrep' ? 'skip' : 'fail',
        detail: 'not found in PATH',
      })
    }
  }
  sections.push({ title: 'System Tools', checks: toolChecks })

  // ── 2. Framework Structure ─────────────────────────────────────────────────
  const structureChecks: DoctorCheck[] = []
  const expectedDirs = [
    { path: TEMPLATES_DIR, label: 'templates/' },
    { path: MODULES_DIR, label: 'modules/' },
    { path: AI_CONFIG_DIR, label: 'ai-config/' },
    { path: path.join(FORGE_ROOT, 'workflows'), label: 'workflows/' },
    { path: path.join(FORGE_ROOT, 'schemas'), label: 'schemas/' },
    { path: path.join(FORGE_ROOT, 'ci-local'), label: 'ci-local/' },
  ]

  for (const dir of expectedDirs) {
    if (await fs.pathExists(dir.path)) {
      const count = await countDir(dir.path)
      structureChecks.push({ label: dir.label, status: 'ok', detail: `${count} entries` })
    } else {
      structureChecks.push({ label: dir.label, status: 'fail', detail: 'missing' })
    }
  }
  sections.push({ title: 'Framework Structure', checks: structureChecks })

  // ── 3. Stack Detection ─────────────────────────────────────────────────────
  const stackChecks: DoctorCheck[] = []
  const detection = await detectStack(cwd)
  if (detection) {
    stackChecks.push({
      label: 'Detected stack',
      status: 'ok',
      detail: `${detection.stackType} (${detection.buildTool})${detection.javaVersion ? ` Java ${detection.javaVersion}` : ''}`,
    })
  } else {
    stackChecks.push({
      label: 'Detected stack',
      status: 'skip',
      detail: 'no recognizable project files in current directory',
    })
  }
  sections.push({ title: 'Stack Detection', checks: stackChecks })

  // ── 4. Project Manifest ────────────────────────────────────────────────────
  const manifestChecks: DoctorCheck[] = []
  const manifest = await readManifest(cwd)
  if (manifest) {
    manifestChecks.push({
      label: 'Forge manifest',
      status: 'ok',
      detail: `project: ${manifest.projectName}, stack: ${manifest.stack}`,
    })
    manifestChecks.push({
      label: 'Created',
      status: 'ok',
      detail: manifest.createdAt.split('T')[0],
    })
    manifestChecks.push({
      label: 'Modules',
      status: manifest.modules.length > 0 ? 'ok' : 'skip',
      detail: manifest.modules.length > 0 ? manifest.modules.join(', ') : 'none installed',
    })
  } else {
    manifestChecks.push({
      label: 'Forge manifest',
      status: 'skip',
      detail: 'not a forge-managed project (run javi-forge init)',
    })
  }
  sections.push({ title: 'Project Manifest', checks: manifestChecks })

  // ── 5. Installed Modules ───────────────────────────────────────────────────
  const moduleChecks: DoctorCheck[] = []
  const moduleNames = ['engram', 'obsidian-brain', 'memory-simple', 'ghagga']
  for (const mod of moduleNames) {
    const modPath = path.join(cwd, '.javi-forge', 'modules', mod)
    if (await fs.pathExists(modPath)) {
      moduleChecks.push({ label: mod, status: 'ok', detail: 'installed' })
    } else {
      moduleChecks.push({ label: mod, status: 'skip', detail: 'not installed' })
    }
  }
  sections.push({ title: 'Installed Modules', checks: moduleChecks })

  // ── 6. Plugins ─────────────────────────────────────────────────────────────
  const pluginChecks: DoctorCheck[] = []
  const pluginsDirExists = await fs.pathExists(PLUGINS_DIR)
  if (pluginsDirExists) {
    const plugins = await listInstalledPlugins()
    if (plugins.length > 0) {
      for (const plugin of plugins) {
        pluginChecks.push({
          label: plugin.name,
          status: 'ok',
          detail: `v${plugin.version} from ${plugin.source}`,
        })
      }
    } else {
      pluginChecks.push({ label: 'Plugins', status: 'skip', detail: 'none installed' })
    }
  } else {
    pluginChecks.push({ label: 'Plugins directory', status: 'skip', detail: 'not created yet' })
  }
  sections.push({ title: 'Plugins', checks: pluginChecks })

  return { sections }
}
