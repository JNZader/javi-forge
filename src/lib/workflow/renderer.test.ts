import { describe, it, expect } from 'vitest'
import { renderAscii } from './renderer.js'
import type { WorkflowGraph, WorkflowValidationResult } from '../../types/index.js'

function makeGraph(overrides: Partial<WorkflowGraph> = {}): WorkflowGraph {
  return {
    name: 'test-graph',
    nodes: [
      { id: 'lint', label: 'Lint' },
      { id: 'test', label: 'Test' },
      { id: 'build', label: 'Build' },
    ],
    edges: [
      { from: 'lint', to: 'test' },
      { from: 'test', to: 'build' },
    ],
    format: 'dot',
    ...overrides,
  }
}

describe('renderAscii', () => {
  it('renders a linear pipeline', () => {
    const output = renderAscii(makeGraph())
    expect(output).toContain('# test-graph')
    expect(output).toContain('[Lint]')
    expect(output).toContain('[Test]')
    expect(output).toContain('[Build]')
    expect(output).toContain('->')
  })

  it('renders empty graph', () => {
    const graph = makeGraph({ nodes: [], edges: [] })
    expect(renderAscii(graph)).toBe('(empty graph)')
  })

  it('renders with validation results', () => {
    const results: WorkflowValidationResult[] = [
      { node: 'lint', status: 'pass', detail: 'Found eslint' },
      { node: 'test', status: 'fail', detail: 'No tests found' },
      { node: 'build', status: 'skip' },
    ]
    const output = renderAscii(makeGraph(), results)
    expect(output).toContain('\u2713') // pass icon
    expect(output).toContain('\u2717') // fail icon
    expect(output).toContain('Found eslint')
    expect(output).toContain('No tests found')
  })

  it('renders branching graph', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'lint', label: 'Lint' },
        { id: 'test', label: 'Test' },
        { id: 'security', label: 'Security' },
        { id: 'build', label: 'Build' },
      ],
      edges: [
        { from: 'lint', to: 'test' },
        { from: 'lint', to: 'security' },
        { from: 'test', to: 'build' },
        { from: 'security', to: 'build' },
      ],
    })
    const output = renderAscii(graph)
    expect(output).toContain('[Lint]')
    expect(output).toContain('[Test]')
    expect(output).toContain('[Security]')
    expect(output).toContain('[Build]')
  })

  it('renders edge labels', () => {
    const graph = makeGraph({
      edges: [
        { from: 'lint', to: 'test', label: 'success' },
        { from: 'test', to: 'build' },
      ],
    })
    const output = renderAscii(graph)
    expect(output).toContain('success')
  })

  it('includes graph name as header', () => {
    const graph = makeGraph({ name: 'CI Pipeline' })
    const output = renderAscii(graph)
    expect(output).toContain('# CI Pipeline')
  })
})
