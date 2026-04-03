import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    readJson: vi.fn(),
    readdir: vi.fn(),
    copy: vi.fn(),
    ensureDir: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

import fs from 'fs-extra'
import { validateWorkflow, getAvailableChecks } from './validator.js'
import type { WorkflowGraph } from '../../types/index.js'

const mockedFs = vi.mocked(fs)

beforeEach(() => {
  vi.resetAllMocks()
  mockedFs.pathExists.mockResolvedValue(false as never)
})

function makeGraph(checks: Record<string, string>): WorkflowGraph {
  const nodes = Object.entries(checks).map(([id, check]) => ({
    id,
    label: id,
    ...(check ? { check } : {}),
  }))
  return {
    name: 'test',
    nodes,
    edges: [],
    format: 'dot',
  }
}

describe('validateWorkflow', () => {
  it('skips nodes without check attribute', async () => {
    const graph = makeGraph({ build: '' })
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('skip')
    expect(results[0]?.detail).toContain('No check defined')
  })

  it('skips unknown check names', async () => {
    const graph = makeGraph({ build: 'has-unicorn' })
    // Force the node to have the check
    graph.nodes[0]!.check = 'has-unicorn'
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('skip')
    expect(results[0]?.detail).toContain('Unknown check')
  })

  it('passes has-linter when eslint config exists', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('eslint.config.js')) return true as never
      return false as never
    })

    const graph = makeGraph({ lint: 'has-linter' })
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('pass')
  })

  it('fails has-linter when no config found', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)

    const graph = makeGraph({ lint: 'has-linter' })
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('fail')
  })

  it('passes has-tests when test directory exists', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('src/')) return true as never
      return false as never
    })

    const graph = makeGraph({ test: 'has-tests' })
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('pass')
  })

  it('passes has-ci when .github/workflows exists', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('.github/workflows')) return true as never
      return false as never
    })

    const graph = makeGraph({ ci: 'has-ci' })
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('pass')
  })

  it('passes has-dockerfile when Dockerfile exists', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('Dockerfile')) return true as never
      return false as never
    })

    const graph = makeGraph({ deploy: 'has-dockerfile' })
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('pass')
  })

  it('passes has-docs when README.md exists', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('README.md')) return true as never
      return false as never
    })

    const graph = makeGraph({ docs: 'has-docs' })
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('pass')
  })

  it('passes has-changelog when CHANGELOG.md exists', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('CHANGELOG.md')) return true as never
      return false as never
    })

    const graph = makeGraph({ changelog: 'has-changelog' })
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('pass')
  })

  it('passes has-license when LICENSE exists', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('LICENSE')) return true as never
      return false as never
    })

    const graph = makeGraph({ license: 'has-license' })
    const results = await validateWorkflow(graph, '/test')
    expect(results[0]?.status).toBe('pass')
  })

  it('validates multiple nodes', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)

    const graph: WorkflowGraph = {
      name: 'test',
      nodes: [
        { id: 'lint', label: 'Lint', check: 'has-linter' },
        { id: 'test', label: 'Test', check: 'has-tests' },
        { id: 'build', label: 'Build' },
      ],
      edges: [],
      format: 'dot',
    }
    const results = await validateWorkflow(graph, '/test')
    expect(results).toHaveLength(3)
    expect(results[0]?.status).toBe('fail')
    expect(results[1]?.status).toBe('fail')
    expect(results[2]?.status).toBe('skip')
  })
})

describe('getAvailableChecks', () => {
  it('returns a non-empty list of check names', () => {
    const checks = getAvailableChecks()
    expect(checks.length).toBeGreaterThan(0)
    expect(checks).toContain('has-linter')
    expect(checks).toContain('has-tests')
    expect(checks).toContain('has-ci')
  })
})
