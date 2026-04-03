import fs from 'fs-extra'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type {
  PluginManifest,
  PluginValidationResult,
  PluginValidationError,
  InstalledPlugin,
  PluginRegistry,
  PluginRegistryEntry,
  PluginSyncResult,
  ForgeManifest,
} from '../types/index.js'
import { PLUGINS_DIR, PLUGIN_MANIFEST_FILE, PLUGIN_ASSET_DIRS, PLUGIN_REGISTRY_URL } from '../constants.js'
import { generateAgentSkillsManifest } from './agent-skills.js'
import { autoWirePlugins } from './auto-wire.js'

const execFileAsync = promisify(execFile)

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const SEMVER_RE = /^\d+\.\d+\.\d+$/

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a plugin directory structure and manifest.
 */
export async function validatePlugin(pluginDir: string): Promise<PluginValidationResult> {
  const errors: PluginValidationError[] = []

  // Check plugin.json exists
  const manifestPath = path.join(pluginDir, PLUGIN_MANIFEST_FILE)
  if (!await fs.pathExists(manifestPath)) {
    return {
      valid: false,
      errors: [{ path: PLUGIN_MANIFEST_FILE, message: 'plugin.json not found' }],
      manifest: null,
    }
  }

  // Parse manifest
  let manifest: PluginManifest
  try {
    manifest = await fs.readJson(manifestPath) as PluginManifest
  } catch {
    return {
      valid: false,
      errors: [{ path: PLUGIN_MANIFEST_FILE, message: 'invalid JSON' }],
      manifest: null,
    }
  }

  // Validate required fields
  if (typeof manifest.name !== 'string' || !manifest.name) {
    errors.push({ path: 'name', message: 'name is required' })
  } else if (!KEBAB_RE.test(manifest.name)) {
    errors.push({ path: 'name', message: 'name must be kebab-case' })
  } else if (manifest.name.length < 2 || manifest.name.length > 60) {
    errors.push({ path: 'name', message: 'name must be 2-60 characters' })
  }

  if (typeof manifest.version !== 'string' || !manifest.version) {
    errors.push({ path: 'version', message: 'version is required' })
  } else if (!SEMVER_RE.test(manifest.version)) {
    errors.push({ path: 'version', message: 'version must be semver (e.g. 1.0.0)' })
  }

  if (typeof manifest.description !== 'string' || !manifest.description) {
    errors.push({ path: 'description', message: 'description is required' })
  } else if (manifest.description.length < 10) {
    errors.push({ path: 'description', message: 'description must be at least 10 characters' })
  } else if (manifest.description.length > 200) {
    errors.push({ path: 'description', message: 'description must be at most 200 characters' })
  }

  // Validate asset directories actually exist when declared
  for (const assetType of PLUGIN_ASSET_DIRS) {
    const declared = manifest[assetType]
    if (!Array.isArray(declared) || declared.length === 0) continue

    const assetDir = path.join(pluginDir, assetType)
    if (!await fs.pathExists(assetDir)) {
      errors.push({ path: assetType, message: `declared ${assetType}/ directory not found` })
      continue
    }

    // Check each declared asset exists
    for (const entry of declared) {
      const entryPath = path.join(assetDir, entry)
      if (!await fs.pathExists(entryPath)) {
        errors.push({ path: `${assetType}/${entry}`, message: `declared entry not found` })
      }
    }
  }

  // Validate tags
  if (manifest.tags && !Array.isArray(manifest.tags)) {
    errors.push({ path: 'tags', message: 'tags must be an array' })
  } else if (manifest.tags && manifest.tags.length > 10) {
    errors.push({ path: 'tags', message: 'max 10 tags allowed' })
  }

  return { valid: errors.length === 0, errors, manifest: errors.length === 0 ? manifest : manifest }
}

// ── Installation ────────────────────────────────────────────────────────────

/**
 * Install a plugin from a GitHub repository.
 * Clones the repo to a temp dir, validates, then copies to plugins dir.
 */
export async function installPlugin(
  source: string,
  options: { dryRun?: boolean } = {}
): Promise<{ success: boolean; name?: string; error?: string }> {
  const { dryRun = false } = options

  // Normalize source to a git URL
  const gitUrl = normalizeGitUrl(source)
  if (!gitUrl) {
    return { success: false, error: `invalid source: ${source}. Use org/repo or a GitHub URL` }
  }

  // Clone to temp
  const tmpDir = path.join(PLUGINS_DIR, '.tmp', `install-${Date.now()}`)

  try {
    if (!dryRun) {
      await fs.ensureDir(tmpDir)
      await execFileAsync('git', ['clone', '--depth', '1', gitUrl, tmpDir], {
        timeout: 60_000,
      })
    }

    // Validate
    const validation = dryRun
      ? { valid: true, errors: [], manifest: { name: source.split('/').pop() ?? 'unknown', version: '0.0.0', description: 'dry-run placeholder' } as PluginManifest }
      : await validatePlugin(tmpDir)

    if (!validation.valid || !validation.manifest) {
      const msgs = validation.errors.map(e => `  ${e.path}: ${e.message}`).join('\n')
      return { success: false, error: `validation failed:\n${msgs}` }
    }

    const pluginName = validation.manifest.name
    const destDir = path.join(PLUGINS_DIR, pluginName)

    if (!dryRun) {
      // Remove existing version if present
      if (await fs.pathExists(destDir)) {
        await fs.remove(destDir)
      }
      await fs.move(tmpDir, destDir)

      // Write install metadata
      const installedPlugin: InstalledPlugin = {
        name: pluginName,
        version: validation.manifest.version,
        installedAt: new Date().toISOString(),
        source,
        manifest: validation.manifest,
      }
      await fs.writeJson(path.join(destDir, '.installed.json'), installedPlugin, { spaces: 2 })

      // Generate Agent Skills spec manifest for cross-agent compatibility
      await generateAgentSkillsManifest(destDir, source).catch(() => {})
    }

    return { success: true, name: pluginName }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { success: false, error: msg }
  } finally {
    // Clean up tmp if it still exists (error path)
    if (!dryRun && await fs.pathExists(tmpDir)) {
      await fs.remove(tmpDir).catch(() => {})
    }
  }
}

/**
 * Remove an installed plugin by name.
 */
export async function removePlugin(
  name: string,
  options: { dryRun?: boolean } = {}
): Promise<{ success: boolean; error?: string }> {
  const pluginDir = path.join(PLUGINS_DIR, name)

  if (!await fs.pathExists(pluginDir)) {
    return { success: false, error: `plugin "${name}" is not installed` }
  }

  if (!options.dryRun) {
    await fs.remove(pluginDir)
  }

  return { success: true }
}

// ── Listing & Search ────────────────────────────────────────────────────────

/**
 * List all installed plugins.
 */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  if (!await fs.pathExists(PLUGINS_DIR)) return []

  const entries = await fs.readdir(PLUGINS_DIR)
  const plugins: InstalledPlugin[] = []

  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const metaPath = path.join(PLUGINS_DIR, entry, '.installed.json')
    if (await fs.pathExists(metaPath)) {
      try {
        const meta = await fs.readJson(metaPath) as InstalledPlugin
        plugins.push(meta)
      } catch { /* skip corrupt entries */ }
    }
  }

  return plugins
}

/**
 * Fetch the remote plugin registry and optionally filter by query.
 */
export async function searchRegistry(query?: string): Promise<PluginRegistryEntry[]> {
  try {
    const response = await fetch(PLUGIN_REGISTRY_URL)
    if (!response.ok) {
      return []
    }

    const registry = await response.json() as PluginRegistry
    let plugins = registry.plugins ?? []

    if (query) {
      const q = query.toLowerCase()
      plugins = plugins.filter(p =>
        p.id.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some(t => t.toLowerCase().includes(q))
      )
    }

    return plugins
  } catch {
    return []
  }
}

// ── Sync ───────────────────────────────────────────────────────────────

/**
 * Detect installed plugins in a project's .javi-forge/plugins/ directory.
 * Returns an array of plugin names (sorted alphabetically).
 */
export async function detectProjectPlugins(projectDir: string): Promise<string[]> {
  const full = await detectProjectPluginsFull(projectDir)
  return full.map(p => p.name).sort()
}

/**
 * Detect installed plugins with full metadata (including manifest).
 * Used by auto-wiring to read plugin capabilities.
 */
export async function detectProjectPluginsFull(projectDir: string): Promise<InstalledPlugin[]> {
  const pluginsDir = path.join(projectDir, '.javi-forge', 'plugins')

  if (!await fs.pathExists(pluginsDir)) return []

  const entries = await fs.readdir(pluginsDir)
  const plugins: InstalledPlugin[] = []

  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const metaPath = path.join(pluginsDir, entry, '.installed.json')
    if (await fs.pathExists(metaPath)) {
      try {
        const meta = await fs.readJson(metaPath) as InstalledPlugin
        if (meta.name) {
          plugins.push(meta)
        }
      } catch { /* skip corrupt entries */ }
    }
  }

  return plugins.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Sync detected plugins into the project manifest and auto-wire
 * their capabilities into CLAUDE.md and .claude/settings.json.
 * Returns a report of added, removed, unchanged, wired, and unwired plugins.
 */
export async function syncPlugins(
  projectDir: string,
  options: { dryRun?: boolean } = {}
): Promise<PluginSyncResult> {
  const { dryRun = false } = options
  const detectedFull = await detectProjectPluginsFull(projectDir)
  const detected = detectedFull.map(p => p.name).sort()

  const manifestPath = path.join(projectDir, '.javi-forge', 'manifest.json')
  let manifest: ForgeManifest & { plugins?: string[] }

  if (await fs.pathExists(manifestPath)) {
    manifest = await fs.readJson(manifestPath) as ForgeManifest & { plugins?: string[] }
  } else {
    // No manifest yet — treat current plugins as empty
    manifest = {
      version: '0.1.0',
      projectName: path.basename(projectDir),
      stack: 'node',
      ciProvider: 'github',
      memory: 'none',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      modules: [],
    }
  }

  const previous = new Set(manifest.plugins ?? [])
  const current = new Set(detected)

  const added = detected.filter(p => !previous.has(p))
  const removed = [...previous].filter(p => !current.has(p))
  const unchanged = detected.filter(p => previous.has(p))

  if (!dryRun && (added.length > 0 || removed.length > 0)) {
    manifest.plugins = detected
    manifest.updatedAt = new Date().toISOString()
    await fs.ensureDir(path.dirname(manifestPath))
    await fs.writeJson(manifestPath, manifest, { spaces: 2 })
  }

  // ── Auto-wire plugin capabilities ──────────────────────────────────
  const wireResult = await autoWirePlugins(projectDir, detectedFull, { dryRun })

  return {
    added,
    removed,
    unchanged,
    wired: wireResult.wired,
    unwired: wireResult.unwired,
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize a GitHub source to a git clone URL.
 * Accepts: "org/repo", "https://github.com/org/repo", "github.com/org/repo"
 */
export function normalizeGitUrl(source: string): string | null {
  // Already a full URL
  if (source.startsWith('https://github.com/')) {
    return source.endsWith('.git') ? source : `${source}.git`
  }

  // github.com/org/repo
  if (source.startsWith('github.com/')) {
    return `https://${source}.git`
  }

  // org/repo shorthand
  const parts = source.split('/')
  if (parts.length === 2 && parts[0] && parts[1]) {
    return `https://github.com/${parts[0]}/${parts[1]}.git`
  }

  return null
}
