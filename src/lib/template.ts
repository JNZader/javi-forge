import fs from 'fs-extra'
import path from 'path'
import type { Stack, CIProvider } from '../types/index.js'
import {
  TEMPLATES_DIR,
  DEPENDABOT_FRAGMENTS_DIR,
  STACK_DEPENDABOT_MAP,
  STACK_CI_MAP,
  DEPLOY_TEMPLATE_MAP,
  DEPLOY_DESTINATION_MAP,
} from '../constants.js'

/**
 * Read a template file and replace __VAR_NAME__ placeholders.
 */
export async function renderTemplate(
  templatePath: string,
  vars: Record<string, string>
): Promise<string> {
  let content = await fs.readFile(templatePath, 'utf-8')
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `__${key}__`
    content = content.replaceAll(placeholder, value)
  }
  return content
}

/**
 * Assemble a dependabot.yml from the header + stack-specific fragments.
 * Always includes github-actions fragment when provider is GitHub.
 */
export async function generateDependabotYml(
  stacks: Stack[],
  includeGitHubActions = true
): Promise<string> {
  const headerPath = path.join(DEPENDABOT_FRAGMENTS_DIR, 'header.yml')
  let content = await fs.readFile(headerPath, 'utf-8')

  // Collect unique fragment names
  const fragments = new Set<string>()
  if (includeGitHubActions) fragments.add('github-actions')

  for (const stack of stacks) {
    const stackFragments = STACK_DEPENDABOT_MAP[stack] ?? []
    for (const f of stackFragments) fragments.add(f)
  }

  // Append each fragment
  for (const fragmentName of fragments) {
    const fragmentPath = path.join(DEPENDABOT_FRAGMENTS_DIR, `${fragmentName}.yml`)
    if (await fs.pathExists(fragmentPath)) {
      const fragment = await fs.readFile(fragmentPath, 'utf-8')
      content += '\n' + fragment
    }
  }

  return content
}

/**
 * Get the CI workflow template path for a given stack + provider combination.
 * Returns null if no template exists for that combination.
 */
export function getCITemplatePath(stack: Stack, provider: CIProvider): string | null {
  const providerMap = STACK_CI_MAP[provider]
  if (!providerMap) return null

  const filename = providerMap[stack]
  if (!filename) return null

  return path.join(TEMPLATES_DIR, provider, filename)
}

/**
 * Generate the CI workflow file content for a given stack + provider.
 */
export async function generateCIWorkflow(
  stack: Stack,
  provider: CIProvider
): Promise<string | null> {
  const templatePath = getCITemplatePath(stack, provider)
  if (!templatePath) return null

  if (!await fs.pathExists(templatePath)) return null

  return fs.readFile(templatePath, 'utf-8')
}

/**
 * Get the destination path for a CI workflow file within a project.
 */
export function getCIDestination(provider: CIProvider): string {
  switch (provider) {
    case 'github':
      return '.github/workflows/ci.yml'
    case 'gitlab':
      return '.gitlab-ci.yml'
    case 'woodpecker':
      return '.woodpecker.yml'
  }
}

/**
 * Get the template path for the zero-downtime Docker deploy workflow.
 * Returns null if no template exists for the given provider.
 */
export function getDeployTemplatePath(provider: CIProvider): string | null {
  const filename = DEPLOY_TEMPLATE_MAP[provider]
  if (!filename) return null
  return path.join(TEMPLATES_DIR, provider, filename)
}

/**
 * Get the destination path for the deploy workflow file within a project.
 * Returns null if no mapping exists for the given provider.
 */
export function getDeployDestination(provider: CIProvider): string | null {
  return DEPLOY_DESTINATION_MAP[provider] ?? null
}

/**
 * Generate the zero-downtime Docker deploy workflow content.
 * Replaces __SERVICE_NAME__ with the provided service name.
 */
export async function generateDeployWorkflow(
  provider: CIProvider,
  serviceName: string
): Promise<string | null> {
  const templatePath = getDeployTemplatePath(provider)
  if (!templatePath) return null

  if (!await fs.pathExists(templatePath)) return null

  return renderTemplate(templatePath, { SERVICE_NAME: serviceName })
}
