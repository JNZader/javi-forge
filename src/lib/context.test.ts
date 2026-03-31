import { describe, it, expect } from 'vitest'
import { generateContextDir, buildIndexMd, buildSummaryMd } from './context.js'
import { STACK_CONTEXT_MAP } from '../constants.js'
import type { InitOptions, Stack } from '../types/index.js'

// ═══════════════════════════════════════════════════════════════════════════════
// Test helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    projectName: 'test-project',
    projectDir: '/tmp/test-project',
    stack: 'node',
    ciProvider: 'github',
    memory: 'engram',
    aiSync: true,
    sdd: false,
    ghagga: false,
    mock: false,
    contextDir: true,
    dryRun: false,
    ...overrides,
  }
}

const ALL_STACKS: Stack[] = ['node', 'python', 'go', 'rust', 'java-gradle', 'java-maven', 'elixir']

// ═══════════════════════════════════════════════════════════════════════════════
// generateContextDir — per-stack output
// ═══════════════════════════════════════════════════════════════════════════════
describe('generateContextDir', () => {
  it.each(ALL_STACKS)('returns valid content for %s stack', async (stack) => {
    const options = makeOptions({ stack })
    const { index, summary } = await generateContextDir(options)

    // INDEX.md assertions
    expect(index).toContain('test-project')
    expect(index).toContain('Directory Structure')
    expect(index).toContain('Entry Point')
    expect(index).toContain(STACK_CONTEXT_MAP[stack].entryPoint)
    expect(index).toContain(STACK_CONTEXT_MAP[stack].conventions)

    // summary.md assertions
    expect(summary).toContain('test-project')
    expect(summary).toContain(stack)
    expect(summary).toContain('github')
    expect(summary).toContain('engram')
  })

  it('uses default fallback for unknown stack', async () => {
    const options = makeOptions({ stack: 'haskell' as Stack })
    const { index, summary } = await generateContextDir(options)

    const defaultCtx = STACK_CONTEXT_MAP['default']

    expect(index).toContain(defaultCtx.entryPoint)
    expect(index).toContain(defaultCtx.conventions)
    expect(summary).toContain('haskell')
  })

  it('combined output is under 4000 chars (~1000 tokens)', async () => {
    for (const stack of ALL_STACKS) {
      const options = makeOptions({ stack })
      const { index, summary } = await generateContextDir(options)
      const combined = index.length + summary.length
      expect(combined).toBeLessThan(4000)
    }
  })

  it('includes enabled modules in summary', async () => {
    const options = makeOptions({ aiSync: true, sdd: true, ghagga: true, mock: true, contextDir: true })
    const { summary } = await generateContextDir(options)

    expect(summary).toContain('ai-sync')
    expect(summary).toContain('sdd')
    expect(summary).toContain('ghagga')
    expect(summary).toContain('mock')
    expect(summary).toContain('context')
  })

  it('shows "none" when no modules are enabled', async () => {
    const options = makeOptions({ aiSync: false, sdd: false, ghagga: false, mock: false, contextDir: false })
    const { summary } = await generateContextDir(options)

    expect(summary).toContain('**Modules**: none')
  })

  it('includes ciProvider and memory in index', async () => {
    const options = makeOptions({ ciProvider: 'gitlab', memory: 'obsidian-brain' })
    const { index } = await generateContextDir(options)

    expect(index).toContain('gitlab')
    expect(index).toContain('obsidian-brain')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildIndexMd
// ═══════════════════════════════════════════════════════════════════════════════
describe('buildIndexMd', () => {
  it('includes project name as heading', () => {
    const ctx = STACK_CONTEXT_MAP['node']
    const result = buildIndexMd('my-app', ctx, 'github', 'engram')
    expect(result).toMatch(/^# my-app — File Index/)
  })

  it('includes directory tree in code block', () => {
    const ctx = STACK_CONTEXT_MAP['python']
    const result = buildIndexMd('pyproj', ctx, 'github', 'engram')
    expect(result).toContain('```')
    expect(result).toContain('pyproject.toml')
  })

  it('includes entry point', () => {
    const ctx = STACK_CONTEXT_MAP['go']
    const result = buildIndexMd('goapp', ctx, 'github', 'none')
    expect(result).toContain('`cmd/main.go`')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// buildSummaryMd
// ═══════════════════════════════════════════════════════════════════════════════
describe('buildSummaryMd', () => {
  it('includes project name as heading', () => {
    const result = buildSummaryMd('my-app', 'node', 'github', 'engram', ['ai-sync'])
    expect(result).toMatch(/^# my-app/)
  })

  it('lists all provided modules', () => {
    const result = buildSummaryMd('proj', 'rust', 'gitlab', 'none', ['sdd', 'context'])
    expect(result).toContain('sdd, context')
  })

  it('shows "none" for empty modules list', () => {
    const result = buildSummaryMd('proj', 'node', 'github', 'engram', [])
    expect(result).toContain('**Modules**: none')
  })

  it('mentions javi-forge scaffolding', () => {
    const result = buildSummaryMd('proj', 'elixir', 'woodpecker', 'engram', [])
    expect(result).toContain('javi-forge')
  })
})
