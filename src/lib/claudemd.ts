import type { InitOptions, StackClaudeMdEntry } from '../types/index.js'
import { STACK_CLAUDEMD_MAP } from '../constants.js'

// =============================================================================
// Internal helpers
// =============================================================================

function getStackClaudeMd(stack: string): StackClaudeMdEntry {
  return STACK_CLAUDEMD_MAP[stack] ?? STACK_CLAUDEMD_MAP['default']
}

export function buildClaudeMd(
  projectName: string,
  stack: string,
  entry: StackClaudeMdEntry,
  contextDir: boolean,
  modules: string[]
): string {
  const lines: string[] = []

  lines.push(`# ${projectName}`)
  lines.push('')

  // Stack section
  lines.push('## Stack')
  lines.push(`- **Language/Runtime**: ${stack}`)
  lines.push(`- **Conventions**: ${entry.conventions}`)
  lines.push(`- **Testing**: ${entry.testFramework}`)
  lines.push('')

  // Skills section
  if (entry.skills.length > 0) {
    lines.push('## Recommended Skills')
    for (const skill of entry.skills) {
      lines.push(`- Load \`~/.claude/skills/${skill}/SKILL.md\` before writing code`)
    }
    lines.push('')
  }

  // Project Context section (conditional on contextDir)
  if (contextDir) {
    lines.push('## Project Context')
    lines.push('- See `.context/INDEX.md` for file structure and entry points')
    lines.push('- See `.context/summary.md` for project overview')
    lines.push('')
  }

  // Conventions section
  lines.push('## Conventions')
  lines.push(`- ${entry.conventions}`)
  lines.push('- Scaffolded with javi-forge — see `.javi-forge/manifest.json` for config')
  lines.push('')

  // Modules section
  if (modules.length > 0) {
    lines.push('## Modules')
    lines.push(`- ${modules.join(', ')}`)
    lines.push('')
  }

  return lines.join('\n')
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate CLAUDE.md content from InitOptions metadata.
 * Pure function — does NOT perform filesystem I/O.
 */
export function generateClaudeMd(options: InitOptions): string {
  const { projectName, stack, contextDir } = options

  const entry = getStackClaudeMd(stack)

  // Collect enabled modules for listing
  const modules: string[] = []
  if (options.aiSync) modules.push('ai-sync')
  if (options.sdd) modules.push('sdd')
  if (options.ghagga) modules.push('ghagga')
  if (options.mock) modules.push('mock')
  if (options.contextDir) modules.push('context')
  if (options.claudeMd) modules.push('claude-md')

  return buildClaudeMd(projectName, stack, entry, contextDir, modules)
}
