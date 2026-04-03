import fs from 'fs-extra'
import type { InitStep, WorkflowGraph } from '../types/index.js'
import {
  parseDot,
  parseMermaid,
  renderAscii,
  validateWorkflow,
  discoverWorkflows,
  listBuiltinTemplates,
  loadBuiltinTemplate,
  getAvailableChecks,
} from '../lib/workflow/index.js'

export type WorkflowAction = 'show' | 'validate' | 'list'

type StepCallback = (step: InitStep) => void

function report(onStep: StepCallback, id: string, label: string, status: InitStep['status'], detail?: string) {
  onStep({ id, label, status, detail })
}

/**
 * Resolve a workflow graph from either a file path or a built-in template name.
 */
async function resolveGraph(
  target: string | undefined,
  projectDir: string,
  template: string | undefined,
  onStep: StepCallback
): Promise<WorkflowGraph | null> {
  // Option 1: Built-in template
  if (template) {
    report(onStep, 'resolve', `Loading template: ${template}`, 'running')
    const tpl = await loadBuiltinTemplate(template)
    if (!tpl) {
      report(onStep, 'resolve', `Loading template: ${template}`, 'error', `Template "${template}" not found`)
      return null
    }
    const parser = tpl.format === 'dot' ? parseDot : parseMermaid
    const graph = parser(tpl.content, template)
    report(onStep, 'resolve', `Loading template: ${template}`, 'done', `${graph.nodes.length} nodes, ${graph.edges.length} edges`)
    return graph
  }

  // Option 2: Explicit file path
  if (target) {
    report(onStep, 'resolve', `Loading workflow: ${target}`, 'running')
    if (!await fs.pathExists(target)) {
      report(onStep, 'resolve', `Loading workflow: ${target}`, 'error', 'File not found')
      return null
    }
    const content = await fs.readFile(target, 'utf-8')
    const isDot = target.endsWith('.dot')
    const parser = isDot ? parseDot : parseMermaid
    const name = target.split('/').pop()?.replace(/\.\w+$/, '') ?? 'workflow'
    const graph = parser(content, name)
    report(onStep, 'resolve', `Loading workflow: ${target}`, 'done', `${graph.nodes.length} nodes, ${graph.edges.length} edges`)
    return graph
  }

  // Option 3: Auto-discover first workflow in project
  report(onStep, 'resolve', 'Discovering workflows', 'running')
  const discovered = await discoverWorkflows(projectDir)
  if (discovered.length === 0) {
    report(onStep, 'resolve', 'Discovering workflows', 'error', 'No workflows found in .javi-forge/workflows/')
    return null
  }
  const first = discovered[0]!
  const content = await fs.readFile(first.path, 'utf-8')
  const parser = first.format === 'dot' ? parseDot : parseMermaid
  const graph = parser(content, first.name)
  report(onStep, 'resolve', 'Discovering workflows', 'done', `Using ${first.name} (${graph.nodes.length} nodes)`)
  return graph
}

/**
 * Show a workflow graph as ASCII art.
 */
export async function runWorkflowShow(
  projectDir: string,
  onStep: StepCallback,
  options: { target?: string; template?: string } = {}
): Promise<string | null> {
  const graph = await resolveGraph(options.target, projectDir, options.template, onStep)
  if (!graph) return null

  report(onStep, 'render', 'Rendering graph', 'running')
  const ascii = renderAscii(graph)
  report(onStep, 'render', 'Rendering graph', 'done')

  return ascii
}

/**
 * Validate a project against a workflow graph.
 */
export async function runWorkflowValidate(
  projectDir: string,
  onStep: StepCallback,
  options: { target?: string; template?: string } = {}
): Promise<string | null> {
  const graph = await resolveGraph(options.target, projectDir, options.template, onStep)
  if (!graph) return null

  report(onStep, 'validate', 'Validating workflow', 'running')
  const results = await validateWorkflow(graph, projectDir)
  report(onStep, 'validate', 'Validating workflow', 'done')

  const ascii = renderAscii(graph, results)
  return ascii
}

/**
 * List available workflows (project + built-in templates).
 */
export async function runWorkflowList(
  projectDir: string,
  onStep: StepCallback
): Promise<string> {
  report(onStep, 'list', 'Listing workflows', 'running')

  const project = await discoverWorkflows(projectDir)
  const builtin = await listBuiltinTemplates()
  const checks = getAvailableChecks()

  const lines: string[] = []

  if (project.length > 0) {
    lines.push('Project workflows (.javi-forge/workflows/):')
    for (const w of project) {
      lines.push(`  - ${w.name} (${w.format})`)
    }
  } else {
    lines.push('No project workflows found.')
    lines.push('  Create .javi-forge/workflows/*.dot or *.mermaid')
  }

  lines.push('')

  if (builtin.length > 0) {
    lines.push('Built-in templates (use --template <name>):')
    for (const t of builtin) {
      lines.push(`  - ${t.name} (${t.format})`)
    }
  }

  lines.push('')
  lines.push('Available validation checks:')
  for (const c of checks) {
    lines.push(`  - ${c}`)
  }

  report(onStep, 'list', 'Listing workflows', 'done')
  return lines.join('\n')
}
