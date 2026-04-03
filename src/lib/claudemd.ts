import type { InitOptions, StackClaudeMdEntry } from '../types/index.js'
import type { StackDetectionResult } from './stack-detector.js'
import { STACK_CLAUDEMD_MAP } from '../constants.js'

// =============================================================================
// Architecture pattern mapping (signal → patterns)
// =============================================================================

const ARCHITECTURE_PATTERNS: Record<string, string[]> = {
  'react-19':    ['Container-Presentational pattern', 'Atomic Design for component hierarchy'],
  'nextjs-15':   ['App Router file-based routing', 'Server Components by default, client opt-in'],
  'django-drf':  ['ViewSets + Serializers', 'URL namespace per app'],
  'zustand-5':   ['Slice pattern for store modules', 'Selectors for derived state'],
  'typescript':  ['Strict mode enabled', 'Prefer interfaces for public APIs, types for unions'],
  'tailwind-4':  ['Utility-first CSS', 'Use `cn()` for conditional classes'],
  'zod-4':       ['Schema-first validation', 'Infer types from schemas with `z.infer`'],
  'playwright':  ['Page Object Model for E2E tests', 'Locator-based selectors over CSS'],
  'pytest':      ['Fixtures for setup/teardown', 'Parametrize for data-driven tests'],
  'ai-sdk-5':    ['Streaming responses by default', 'Tool calling with structured schemas'],
}

// =============================================================================
// Plugin instruction mapping (detected skill → plugin hints)
// =============================================================================

const PLUGIN_INSTRUCTIONS: Record<string, string> = {
  'react-19':    'Check `~/.claude/plugins/` for merge-checks and mermaid diagram support',
  'nextjs-15':   'Check `~/.claude/plugins/` for merge-checks and mermaid diagram support',
  'typescript':  'Run `javi-forge skills doctor` to validate skill compatibility',
  'playwright':  'Use `javi-forge tdd` for test-driven development workflow',
}

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

/**
 * Build an enriched CLAUDE.md using detected skills, architecture patterns,
 * and plugin instructions. Pure function — no I/O.
 */
export function buildSmartClaudeMd(
  projectName: string,
  stack: string,
  entry: StackClaudeMdEntry,
  detectedSkills: string[],
  contextDir: boolean,
  modules: string[]
): string {
  const lines: string[] = []

  // Merge: detected skills + static entry skills (deduplicated)
  const allSkills = [...new Set([...detectedSkills, ...entry.skills])].sort()

  lines.push(`# ${projectName}`)
  lines.push('')

  // Stack section
  lines.push('## Stack')
  lines.push(`- **Language/Runtime**: ${stack}`)
  lines.push(`- **Conventions**: ${entry.conventions}`)
  lines.push(`- **Testing**: ${entry.testFramework}`)
  lines.push('')

  // Skills section — auto-detected + static
  if (allSkills.length > 0) {
    lines.push('## Skills (auto-detected)')
    lines.push('')
    lines.push('Load these skill files BEFORE writing code in this project:')
    lines.push('')
    for (const skill of allSkills) {
      lines.push(`- \`~/.claude/skills/${skill}/SKILL.md\``)
    }
    lines.push('')
  }

  // Architecture patterns section — derived from detected skills
  const patterns: string[] = []
  for (const skill of allSkills) {
    const skillPatterns = ARCHITECTURE_PATTERNS[skill]
    if (skillPatterns) {
      patterns.push(...skillPatterns)
    }
  }
  if (patterns.length > 0) {
    lines.push('## Architecture Patterns')
    lines.push('')
    for (const pattern of patterns) {
      lines.push(`- ${pattern}`)
    }
    lines.push('')
  }

  // Project Context section
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

  // Plugin instructions — derived from detected skills
  const pluginHints = new Set<string>()
  for (const skill of allSkills) {
    const hint = PLUGIN_INSTRUCTIONS[skill]
    if (hint) pluginHints.add(hint)
  }
  if (pluginHints.size > 0) {
    lines.push('## Plugins')
    lines.push('')
    for (const hint of pluginHints) {
      lines.push(`- ${hint}`)
    }
    lines.push('')
  }

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

/**
 * Generate a project-aware CLAUDE.md using stack detection results.
 * Falls back to static generation if no detection result provided.
 * Pure function — does NOT perform filesystem I/O.
 */
export function generateSmartClaudeMd(
  options: InitOptions,
  detection: StackDetectionResult | null
): string {
  // Fallback: no detection result, use static generation
  if (!detection || detection.recommendedSkills.length === 0) {
    return generateClaudeMd(options)
  }

  const { projectName, stack, contextDir } = options

  const entry = getStackClaudeMd(stack)

  const modules: string[] = []
  if (options.aiSync) modules.push('ai-sync')
  if (options.sdd) modules.push('sdd')
  if (options.ghagga) modules.push('ghagga')
  if (options.mock) modules.push('mock')
  if (options.contextDir) modules.push('context')
  if (options.claudeMd) modules.push('claude-md')

  return buildSmartClaudeMd(
    projectName,
    stack,
    entry,
    detection.recommendedSkills,
    contextDir,
    modules
  )
}
