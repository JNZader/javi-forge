import fs from 'fs-extra'
import path from 'path'
import type {
  PluginManifest,
  AgentSkillsManifest,
  AgentSkillEntry,
  InstalledPlugin,
} from '../types/index.js'
import { AGENT_SKILLS_MANIFEST_FILE, PLUGIN_MANIFEST_FILE, PLUGINS_DIR } from '../constants.js'

// ── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert a javi-forge PluginManifest to an Agent Skills spec manifest.
 */
export function pluginToAgentSkills(manifest: PluginManifest, source?: string): AgentSkillsManifest {
  const skills: AgentSkillEntry[] = (manifest.skills ?? []).map(s => ({
    name: s,
    description: `${s} skill from ${manifest.name}`,
    path: `skills/${s}`,
  }))

  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    skills,
    ...(source ? { metadata: { forge_source: source } } : {}),
  }
}

/**
 * Convert an Agent Skills spec manifest to a javi-forge PluginManifest.
 */
export function agentSkillsToPlugin(agentManifest: AgentSkillsManifest): PluginManifest {
  return {
    name: agentManifest.name,
    version: agentManifest.version,
    description: agentManifest.description,
    skills: agentManifest.skills.map(s => s.name),
    tags: ['agent-skills-import'],
  }
}

// ── File I/O ───────────────────────────────────────────────────────────────

/**
 * Generate a skills.json file in the given plugin directory from its plugin.json.
 */
export async function generateAgentSkillsManifest(
  pluginDir: string,
  source?: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  const manifestPath = path.join(pluginDir, PLUGIN_MANIFEST_FILE)

  if (!await fs.pathExists(manifestPath)) {
    return { success: false, error: 'plugin.json not found' }
  }

  let manifest: PluginManifest
  try {
    manifest = await fs.readJson(manifestPath) as PluginManifest
  } catch {
    return { success: false, error: 'invalid plugin.json' }
  }

  const agentManifest = pluginToAgentSkills(manifest, source)
  const outPath = path.join(pluginDir, AGENT_SKILLS_MANIFEST_FILE)
  await fs.writeJson(outPath, agentManifest, { spaces: 2 })

  return { success: true, path: outPath }
}

/**
 * Export an installed plugin to Agent Skills format.
 * Looks up the plugin by name in the global plugins directory.
 */
export async function exportPluginAsAgentSkills(
  name: string
): Promise<{ success: boolean; path?: string; error?: string }> {
  const pluginDir = path.join(PLUGINS_DIR, name)

  if (!await fs.pathExists(pluginDir)) {
    return { success: false, error: `plugin "${name}" is not installed` }
  }

  return generateAgentSkillsManifest(pluginDir)
}

/**
 * Import an Agent Skills spec package from a directory.
 * Reads skills.json, converts to plugin.json, copies to plugins dir.
 */
export async function importAgentSkillsPackage(
  sourceDir: string,
  options: { dryRun?: boolean } = {}
): Promise<{ success: boolean; name?: string; error?: string }> {
  const { dryRun = false } = options
  const skillsPath = path.join(sourceDir, AGENT_SKILLS_MANIFEST_FILE)

  if (!await fs.pathExists(skillsPath)) {
    return { success: false, error: 'skills.json not found' }
  }

  let agentManifest: AgentSkillsManifest
  try {
    agentManifest = await fs.readJson(skillsPath) as AgentSkillsManifest
  } catch {
    return { success: false, error: 'invalid skills.json' }
  }

  if (!agentManifest.name || !agentManifest.version || !agentManifest.description) {
    return { success: false, error: 'skills.json missing required fields (name, version, description)' }
  }

  const pluginName = agentManifest.name

  if (dryRun) {
    return { success: true, name: pluginName }
  }

  const destDir = path.join(PLUGINS_DIR, pluginName)

  // Remove existing version if present
  if (await fs.pathExists(destDir)) {
    await fs.remove(destDir)
  }

  // Copy the source directory
  await fs.copy(sourceDir, destDir)

  // Generate plugin.json from skills.json
  const pluginManifest = agentSkillsToPlugin(agentManifest)
  await fs.writeJson(path.join(destDir, PLUGIN_MANIFEST_FILE), pluginManifest, { spaces: 2 })

  // Write install metadata
  const installedPlugin: InstalledPlugin = {
    name: pluginName,
    version: agentManifest.version,
    installedAt: new Date().toISOString(),
    source: `agent-skills:${sourceDir}`,
    manifest: pluginManifest,
  }
  await fs.writeJson(path.join(destDir, '.installed.json'), installedPlugin, { spaces: 2 })

  return { success: true, name: pluginName }
}
