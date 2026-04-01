import fs from 'fs-extra'
import path from 'path'
import type { CodexTomlEntry, CodexExportResult } from '../types/index.js'
import { PLUGINS_DIR, PLUGIN_MANIFEST_FILE } from '../constants.js'
import { parseFrontmatter } from './frontmatter.js'
import type { PluginManifest } from '../types/index.js'

const DEFAULT_MODEL = 'o4-mini'

// ── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert a SKILL.md raw content string into a CodexTomlEntry.
 * Returns null if the file has no valid frontmatter or missing name.
 */
export function skillToCodexToml(raw: string): CodexTomlEntry | null {
  const parsed = parseFrontmatter(raw)
  if (!parsed) return null

  const name = parsed.data['name']
  if (typeof name !== 'string' || !name) return null

  const description = typeof parsed.data['description'] === 'string'
    ? parsed.data['description']
    : ''

  const model = typeof parsed.data['model'] === 'string'
    ? parsed.data['model']
    : DEFAULT_MODEL

  const instructions = description
    ? `${description}\n\n${parsed.content}`.trim()
    : parsed.content.trim()

  return { name, model, instructions }
}

/**
 * Serialize a CodexTomlEntry to a TOML string.
 */
export function serializeToml(entry: CodexTomlEntry): string {
  const escapedName = escapeTomlString(entry.name)
  const escapedModel = escapeTomlString(entry.model)
  const escapedInstructions = escapeTomlMultiline(entry.instructions)

  return [
    `name = "${escapedName}"`,
    `model = "${escapedModel}"`,
    `instructions = """`,
    escapedInstructions,
    `"""`,
    '',
  ].join('\n')
}

// ── File I/O ───────────────────────────────────────────────────────────────

/**
 * Export an installed plugin's SKILL.md files as Codex-compatible TOML subagent files.
 * Writes .toml files to a `codex/` subdirectory inside the plugin directory.
 */
export async function exportPluginAsCodexToml(
  name: string
): Promise<CodexExportResult> {
  const pluginDir = path.join(PLUGINS_DIR, name)

  if (!await fs.pathExists(pluginDir)) {
    return { success: false, error: `plugin "${name}" is not installed` }
  }

  // Read plugin manifest for skill list
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

  const skillNames = manifest.skills ?? []
  if (skillNames.length === 0) {
    return { success: false, error: 'plugin has no skills to export' }
  }

  const codexDir = path.join(pluginDir, 'codex')
  await fs.ensureDir(codexDir)

  const writtenFiles: string[] = []

  for (const skillName of skillNames) {
    const skillPath = path.join(pluginDir, 'skills', skillName, 'SKILL.md')
    if (!await fs.pathExists(skillPath)) continue

    let raw: string
    try {
      raw = await fs.readFile(skillPath, 'utf-8')
    } catch {
      continue
    }

    const entry = skillToCodexToml(raw)
    if (!entry) continue

    const toml = serializeToml(entry)
    const outPath = path.join(codexDir, `${skillName}.toml`)
    await fs.writeFile(outPath, toml, 'utf-8')
    writtenFiles.push(outPath)
  }

  if (writtenFiles.length === 0) {
    return { success: false, error: 'no skills with valid frontmatter found' }
  }

  return { success: true, files: writtenFiles }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
}

function escapeTomlMultiline(value: string): string {
  // In TOML multiline basic strings ("""), only backslashes and triple quotes need escaping
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"""/g, '"\\"\"')
}
