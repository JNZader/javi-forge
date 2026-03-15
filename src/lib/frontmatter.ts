import YAML from 'yaml'

export interface FrontmatterResult {
  data: Record<string, unknown>
  content: string
}

/**
 * Extract YAML frontmatter from a markdown string.
 * Frontmatter is delimited by --- at the start of the file.
 */
export function parseFrontmatter(raw: string): FrontmatterResult | null {
  const trimmed = raw.trimStart()
  if (!trimmed.startsWith('---')) return null

  const endIdx = trimmed.indexOf('---', 3)
  if (endIdx === -1) return null

  const yamlBlock = trimmed.slice(3, endIdx).trim()
  const content = trimmed.slice(endIdx + 3).trim()

  try {
    const data = YAML.parse(yamlBlock) as Record<string, unknown>
    if (typeof data !== 'object' || data === null) return null
    return { data, content }
  } catch {
    return null
  }
}

export interface ValidationError {
  field: string
  message: string
}

const KEBAB_CASE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

/**
 * Validate frontmatter against schema rules for agent or skill definitions.
 */
export function validateFrontmatter(
  frontmatter: Record<string, unknown>,
  type: 'agent' | 'skill'
): ValidationError[] {
  const errors: ValidationError[] = []

  // name: required, kebab-case, 2-60 chars
  const name = frontmatter['name']
  if (typeof name !== 'string' || !name) {
    errors.push({ field: 'name', message: 'name is required and must be a string' })
  } else {
    if (name.length < 2 || name.length > 60) {
      errors.push({ field: 'name', message: 'name must be 2-60 characters' })
    }
    if (!KEBAB_CASE_RE.test(name)) {
      errors.push({ field: 'name', message: 'name must be kebab-case (e.g. my-skill-name)' })
    }
  }

  // description: required, non-empty, min 10 chars
  const desc = frontmatter['description']
  if (typeof desc !== 'string' || !desc) {
    errors.push({ field: 'description', message: 'description is required and must be a string' })
  } else if (desc.length < 10) {
    errors.push({ field: 'description', message: 'description must be at least 10 characters' })
  }

  // skill-specific: description should include "Trigger:" hint
  if (type === 'skill' && typeof desc === 'string' && !desc.includes('Trigger:')) {
    errors.push({
      field: 'description',
      message: 'skill description should include a "Trigger:" hint for auto-invoke',
    })
  }

  return errors
}
