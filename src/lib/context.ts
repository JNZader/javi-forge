import type { InitOptions, StackContextEntry } from '../types/index.js'
import { STACK_CONTEXT_MAP } from '../constants.js'

// =============================================================================
// Internal helpers
// =============================================================================

function getStackContext(stack: string): StackContextEntry {
  return STACK_CONTEXT_MAP[stack] ?? STACK_CONTEXT_MAP['default']
}

export function buildIndexMd(
  projectName: string,
  stackCtx: StackContextEntry,
  ciProvider: string,
  memory: string
): string {
  return `# ${projectName} — File Index

## Directory Structure

\`\`\`
${stackCtx.tree}
\`\`\`

## Entry Point

\`${stackCtx.entryPoint}\`

## Conventions

- **Stack conventions**: ${stackCtx.conventions}
- **CI**: ${ciProvider}
- **Memory**: ${memory}
`
}

export function buildSummaryMd(
  projectName: string,
  stack: string,
  ciProvider: string,
  memory: string,
  modules: string[]
): string {
  const modulesList = modules.length > 0 ? modules.join(', ') : 'none'

  return `# ${projectName}

## Overview

${stack}-based project scaffolded with javi-forge.

## Stack

- **Language/Runtime**: ${stack}
- **CI**: ${ciProvider}
- **Memory**: ${memory}
- **Modules**: ${modulesList}

## Key Decisions

- Scaffolded with javi-forge
- AI-ready project structure with .context/ directory
`
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generate .context/ directory content from InitOptions metadata.
 * Pure function — does NOT perform filesystem I/O.
 */
export async function generateContextDir(
  options: InitOptions
): Promise<{ index: string; summary: string }> {
  const { projectName, stack, ciProvider, memory } = options

  const stackCtx = getStackContext(stack)

  // Collect enabled modules for summary
  const modules: string[] = []
  if (options.aiSync) modules.push('ai-sync')
  if (options.sdd) modules.push('sdd')
  if (options.ghagga) modules.push('ghagga')
  if (options.mock) modules.push('mock')
  if (options.contextDir) modules.push('context')

  const index = buildIndexMd(projectName, stackCtx, ciProvider, memory)
  const summary = buildSummaryMd(projectName, stack, ciProvider, memory, modules)

  return { index, summary }
}
