import fs from 'fs-extra'
import path from 'path'
import { parseFrontmatter } from './frontmatter.js'
import type { PluginManifest } from '../types/index.js'
import { PLUGIN_MANIFEST_FILE } from '../constants.js'

// ── Types ──────────────────────────────────────────────────────────────────

export interface SkillPublishResult {
  success: boolean
  /** Path to the generated plugin.json */
  pluginJsonPath?: string
  /** The generated manifest */
  manifest?: PluginManifest
  error?: string
}

export interface SkillPublishOptions {
  /** Path to the skill directory (contains SKILL.md) */
  skillDir: string
  /** Author name (optional, falls back to frontmatter or git user) */
  author?: string
  /** Repository URL (optional) */
  repository?: string
  /** Tags for marketplace discovery */
  tags?: string[]
  /** If true, skip writing files */
  dryRun?: boolean
}

// ── Core ───────────────────────────────────────────────────────────────────

/**
 * Package a skill directory for marketplace distribution.
 *
 * Reads the SKILL.md, extracts metadata from frontmatter, and generates
 * a plugin.json compatible with both `javi-forge plugin install` and
 * `claude plugin install` (Anthropic's plugin format).
 *
 * Expected input structure:
 *   skill-name/
 *     SKILL.md
 *     (optional other files)
 *
 * Output:
 *   skill-name/
 *     SKILL.md
 *     plugin.json   ← generated
 */
export async function publishSkill(
  options: SkillPublishOptions
): Promise<SkillPublishResult> {
  const { skillDir, author, repository, tags = [], dryRun = false } = options

  // Validate skill directory
  const skillMdPath = path.join(skillDir, 'SKILL.md')
  if (!await fs.pathExists(skillMdPath)) {
    return { success: false, error: `SKILL.md not found in ${skillDir}` }
  }

  // Read and parse SKILL.md
  let raw: string
  try {
    raw = await fs.readFile(skillMdPath, 'utf-8')
  } catch {
    return { success: false, error: 'Failed to read SKILL.md' }
  }

  const parsed = parseFrontmatter(raw)
  const frontmatter = parsed?.data ?? {}

  // Extract metadata
  const name = (frontmatter['name'] as string) ?? path.basename(skillDir)
  const version = (frontmatter['version'] as string) ?? '1.0.0'
  const description = (frontmatter['description'] as string) ?? `${name} AI skill`

  // Validate name format (kebab-case)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
    return {
      success: false,
      error: `Skill name "${name}" must be kebab-case (e.g., "react-19", "tailwind-4")`,
    }
  }

  // Validate description length
  if (description.length < 10) {
    return {
      success: false,
      error: 'Description must be at least 10 characters',
    }
  }

  // Build plugin.json manifest
  const manifest: PluginManifest = {
    name,
    version,
    description: description.length > 200 ? description.slice(0, 197) + '...' : description,
    skills: [name],
    tags: tags.length > 0 ? tags : extractTagsFromDescription(description),
    ...(author ? { author } : {}),
    ...(repository ? { repository } : {}),
  }

  if (!dryRun) {
    const pluginJsonPath = path.join(skillDir, PLUGIN_MANIFEST_FILE)
    await fs.writeJson(pluginJsonPath, manifest, { spaces: 2 })

    // Also create a skills/ subdirectory structure for plugin compatibility
    const skillsSubdir = path.join(skillDir, 'skills', name)
    if (!await fs.pathExists(skillsSubdir)) {
      await fs.ensureDir(skillsSubdir)
      // Symlink or copy SKILL.md into skills/name/
      const targetSkillMd = path.join(skillsSubdir, 'SKILL.md')
      if (!await fs.pathExists(targetSkillMd)) {
        await fs.copy(skillMdPath, targetSkillMd)
      }
    }

    return { success: true, pluginJsonPath, manifest }
  }

  return { success: true, pluginJsonPath: path.join(skillDir, PLUGIN_MANIFEST_FILE), manifest }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract reasonable tags from a skill description.
 * Looks for common tech keywords.
 */
function extractTagsFromDescription(description: string): string[] {
  const keywords = [
    'react', 'next', 'nextjs', 'angular', 'vue', 'svelte',
    'typescript', 'javascript', 'python', 'go', 'rust', 'java', 'elixir',
    'tailwind', 'css', 'styling',
    'testing', 'test', 'e2e', 'unit',
    'api', 'rest', 'graphql',
    'ai', 'llm', 'ml', 'agent',
    'security', 'auth',
    'database', 'sql', 'nosql',
    'docker', 'kubernetes', 'devops', 'ci', 'cd',
    'state', 'management', 'store',
    'validation', 'schema', 'zod',
  ]

  const lower = description.toLowerCase()
  const found = keywords.filter(kw => lower.includes(kw))

  return found.slice(0, 10) // Max 10 tags per plugin spec
}
