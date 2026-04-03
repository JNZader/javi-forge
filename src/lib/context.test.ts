import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    readJson: vi.fn(),
    writeFile: vi.fn(),
    writeJson: vi.fn(),
    ensureDir: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

import fs from 'fs-extra'
import {
  generateContextDir,
  buildIndexMd,
  buildSummaryMd,
  detectDependencies,
  refreshContextDir,
} from './context.js'
import { STACK_CONTEXT_MAP } from '../constants.js'
import type { InitOptions, Stack } from '../types/index.js'

const mockedFs = vi.mocked(fs)

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
    claudeMd: false,
    dryRun: false,
    ...overrides,
  }
}

const ALL_STACKS: Stack[] = ['node', 'python', 'go', 'rust', 'java-gradle', 'java-maven', 'elixir']

beforeEach(() => {
  vi.resetAllMocks()
  mockedFs.pathExists.mockResolvedValue(false as never)
  mockedFs.writeFile.mockResolvedValue(undefined as never)
  mockedFs.writeJson.mockResolvedValue(undefined as never)
})

// ═══════════════════════════════════════════════════════════════════════════════
// generateContextDir — per-stack output
// ═══════════════════════════════════════════════════════════════════════════════
describe('generateContextDir', () => {
  it.each(ALL_STACKS)('returns valid content for %s stack', async (stack) => {
    const options = makeOptions({ stack })
    const { index, summary } = await generateContextDir(options)

    // INDEX.md assertions
    expect(index).toContain('test-project')
    expect(index).toContain('Structure')
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
    expect(result).toMatch(/^# my-app — Project Index/)
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

  it('includes dependencies when provided', () => {
    const result = buildSummaryMd('proj', 'node', 'github', 'engram', [], ['react', 'next', 'zod'])
    expect(result).toContain('react, next, zod')
  })

  it('shows "none detected" when no dependencies', () => {
    const result = buildSummaryMd('proj', 'node', 'github', 'engram', [], [])
    expect(result).toContain('**Dependencies**: none detected')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// detectDependencies
// ═══════════════════════════════════════════════════════════════════════════════
describe('detectDependencies', () => {
  it('reads node dependencies from package.json', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readJson.mockResolvedValue({
      dependencies: { react: '^18.0.0', next: '^14.0.0', zod: '^3.0.0' },
      devDependencies: { vitest: '^1.0.0' },
    } as never)

    const deps = await detectDependencies('/project', 'node')
    expect(deps).toEqual(['react', 'next', 'zod'])
  })

  it('returns empty for missing package.json', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const deps = await detectDependencies('/project', 'node')
    expect(deps).toEqual([])
  })

  it('limits to 10 dependencies', async () => {
    const manyDeps: Record<string, string> = {}
    for (let i = 0; i < 15; i++) manyDeps[`dep-${i}`] = '1.0.0'
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readJson.mockResolvedValue({ dependencies: manyDeps } as never)

    const deps = await detectDependencies('/project', 'node')
    expect(deps).toHaveLength(10)
  })

  it('reads python dependencies from pyproject.toml', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue(`
[project]
dependencies = [
  "django>=4.2",
  "djangorestframework",
  "celery~=5.3",
]
` as never)

    const deps = await detectDependencies('/project', 'python')
    expect(deps).toEqual(['django', 'djangorestframework', 'celery'])
  })

  it('reads python dependencies from requirements.txt when no pyproject.toml', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('pyproject.toml')) return false as never
      if (s.includes('requirements.txt')) return true as never
      return false as never
    })
    mockedFs.readFile.mockResolvedValue('flask>=2.0\nrequests\ncelery~=5.3\n' as never)

    const deps = await detectDependencies('/project', 'python')
    expect(deps).toEqual(['flask', 'requests', 'celery'])
  })

  it('reads go dependencies from go.mod', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue(`module github.com/user/project

go 1.21

require (
\tgithub.com/gin-gonic/gin v1.9.1
\tgithub.com/jmoiron/sqlx v1.3.5
)
` as never)

    const deps = await detectDependencies('/project', 'go')
    expect(deps).toEqual(['gin', 'sqlx'])
  })

  it('reads rust dependencies from Cargo.toml', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue(`[package]
name = "my-app"

[dependencies]
tokio = { version = "1", features = ["full"] }
serde = "1.0"
axum = "0.7"
` as never)

    const deps = await detectDependencies('/project', 'rust')
    expect(deps).toEqual(['tokio', 'serde', 'axum'])
  })

  it('returns empty for unknown stack', async () => {
    const deps = await detectDependencies('/project', 'unknown')
    expect(deps).toEqual([])
  })

  it('returns empty on read error', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readJson.mockRejectedValue(new Error('parse error') as never)

    const deps = await detectDependencies('/project', 'node')
    expect(deps).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// refreshContextDir
// ═══════════════════════════════════════════════════════════════════════════════
describe('refreshContextDir', () => {
  const MANIFEST = {
    version: '0.1.0',
    projectName: 'test-project',
    stack: 'node' as const,
    ciProvider: 'github' as const,
    memory: 'engram' as const,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    modules: ['engram', 'context'],
  }

  it('returns null when no manifest exists', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const result = await refreshContextDir('/project')
    expect(result).toBeNull()
  })

  it('returns null when .context/ does not exist', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('manifest.json')) return true as never
      return false as never
    })
    const result = await refreshContextDir('/project')
    expect(result).toBeNull()
  })

  it('regenerates files when both manifest and .context/ exist', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readJson.mockResolvedValue({ ...MANIFEST } as never)
    // Node deps
    mockedFs.readJson
      .mockResolvedValueOnce({ ...MANIFEST } as never) // manifest read
      .mockResolvedValueOnce({ dependencies: { react: '18' } } as never) // package.json

    const result = await refreshContextDir('/project')
    expect(result).not.toBeNull()
    expect(result!.updated).toBe(true)
    expect(result!.index).toContain('test-project')
    expect(result!.summary).toContain('test-project')

    // Should write INDEX.md and summary.md
    expect(mockedFs.writeFile).toHaveBeenCalledTimes(2)
    // Should update manifest
    expect(mockedFs.writeJson).toHaveBeenCalledTimes(1)
  })

  it('combined refresh output stays under 4000 chars', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readJson.mockResolvedValue({ ...MANIFEST } as never)

    const result = await refreshContextDir('/project')
    expect(result).not.toBeNull()
    const combined = result!.index.length + result!.summary.length
    expect(combined).toBeLessThan(4000)
  })

  it('returns null when manifest parse fails', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readJson.mockRejectedValue(new Error('bad json') as never)

    const result = await refreshContextDir('/project')
    expect(result).toBeNull()
  })
})
