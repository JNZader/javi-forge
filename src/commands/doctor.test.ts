import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
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

// ── Mock child_process ───────────────────────────────────────────────────────
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: unknown) => {
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' })
    return undefined as any
  }),
}))

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock('../lib/common.js', () => ({
  detectStack: vi.fn(),
  backupIfExists: vi.fn().mockResolvedValue(false),
  ensureDirExists: vi.fn().mockResolvedValue(undefined),
  STACK_LABELS: {
    'node': 'Node.js / TypeScript',
    'python': 'Python',
    'go': 'Go',
    'rust': 'Rust',
    'java-gradle': 'Java (Gradle)',
    'java-maven': 'Java (Maven)',
    'elixir': 'Elixir',
  },
}))

// ── Mock plugin module ───────────────────────────────────────────────────────
vi.mock('../lib/plugin.js', () => ({
  listInstalledPlugins: vi.fn().mockResolvedValue([]),
}))

import fs from 'fs-extra'
import { execFile } from 'child_process'
import { runDoctor } from './doctor.js'
import { detectStack } from '../lib/common.js'
import { listInstalledPlugins } from '../lib/plugin.js'

const mockedFs = vi.mocked(fs)
const mockedExecFile = vi.mocked(execFile)
const mockedDetectStack = vi.mocked(detectStack)
const mockedListPlugins = vi.mocked(listInstalledPlugins)

beforeEach(() => {
  vi.resetAllMocks()

  // Default: no plugins installed
  mockedListPlugins.mockResolvedValue([])

  // Default: all paths exist, readdir returns items
  mockedFs.pathExists.mockResolvedValue(true as never)
  mockedFs.readdir.mockResolvedValue(['file1', 'file2', '.hidden'] as never)

  // Default: which + version succeed
  mockedExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
    const cmd = String(_cmd)
    if (cmd === 'which') {
      if (typeof cb === 'function') cb(null, { stdout: '/usr/bin/tool', stderr: '' })
    } else {
      if (typeof cb === 'function') cb(null, { stdout: 'v1.0.0', stderr: '' })
    }
    return undefined as any
  })

  // Default: no stack detected
  mockedDetectStack.mockResolvedValue(null)
})

describe('runDoctor', () => {
  it('reports all tools as ok when present', async () => {
    const result = await runDoctor('/test/project')
    const toolSection = result.sections.find(s => s.title === 'System Tools')
    expect(toolSection).toBeDefined()
    const allOk = toolSection!.checks.every(c => c.status === 'ok')
    expect(allOk).toBe(true)
  })

  it('reports fail for missing required tool', async () => {
    mockedExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
      const cmd = String(_cmd)
      const args = _args as string[]
      if (cmd === 'which' && args?.[0] === 'git') {
        if (typeof cb === 'function') cb(new Error('not found'), { stdout: '', stderr: '' })
      } else if (cmd === 'which') {
        if (typeof cb === 'function') cb(null, { stdout: '/usr/bin/tool', stderr: '' })
      } else {
        if (typeof cb === 'function') cb(null, { stdout: 'v1.0.0', stderr: '' })
      }
      return undefined as any
    })

    const result = await runDoctor('/test/project')
    const toolSection = result.sections.find(s => s.title === 'System Tools')!
    const gitCheck = toolSection.checks.find(c => c.label === 'Git')
    expect(gitCheck!.status).toBe('fail')
  })

  it('reports skip for missing optional tool (docker)', async () => {
    mockedExecFile.mockImplementation((_cmd: unknown, _args: unknown, cb: unknown) => {
      const cmd = String(_cmd)
      const args = _args as string[]
      if (cmd === 'which' && args?.[0] === 'docker') {
        if (typeof cb === 'function') cb(new Error('not found'), { stdout: '', stderr: '' })
      } else if (cmd === 'which') {
        if (typeof cb === 'function') cb(null, { stdout: '/usr/bin/tool', stderr: '' })
      } else {
        if (typeof cb === 'function') cb(null, { stdout: 'v1.0.0', stderr: '' })
      }
      return undefined as any
    })

    const result = await runDoctor('/test/project')
    const toolSection = result.sections.find(s => s.title === 'System Tools')!
    const dockerCheck = toolSection.checks.find(c => c.label === 'Docker')
    expect(dockerCheck!.status).toBe('skip')
  })

  it('shows skip when no manifest found', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('manifest.json')) return false as never
      return true as never
    })

    const result = await runDoctor('/test/project')
    const manifestSection = result.sections.find(s => s.title === 'Project Manifest')!
    const manifestCheck = manifestSection.checks.find(c => c.label === 'Forge manifest')
    expect(manifestCheck!.status).toBe('skip')
    expect(manifestCheck!.detail).toContain('not a forge-managed project')
  })

  it('shows manifest details when found', async () => {
    mockedFs.readJson.mockResolvedValue({
      version: '0.1.0',
      projectName: 'test-project',
      stack: 'node',
      ciProvider: 'github',
      memory: 'engram',
      createdAt: '2025-01-15T10:00:00Z',
      updatedAt: '2025-01-15T10:00:00Z',
      modules: ['engram', 'ghagga'],
    } as never)

    const result = await runDoctor('/test/project')
    const manifestSection = result.sections.find(s => s.title === 'Project Manifest')!
    const manifestCheck = manifestSection.checks.find(c => c.label === 'Forge manifest')
    expect(manifestCheck!.status).toBe('ok')
    expect(manifestCheck!.detail).toContain('test-project')

    const modulesCheck = manifestSection.checks.find(c => c.label === 'Modules')
    expect(modulesCheck!.status).toBe('ok')
    expect(modulesCheck!.detail).toContain('engram')
  })

  it('reports ok for existing framework dirs', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readdir.mockResolvedValue(['a', 'b', '.dotfile'] as never)

    const result = await runDoctor('/test/project')
    const structSection = result.sections.find(s => s.title === 'Framework Structure')!
    expect(structSection.checks.every(c => c.status === 'ok')).toBe(true)
    // countDir should filter dotfiles → "2 entries"
    expect(structSection.checks[0].detail).toBe('2 entries')
  })

  it('reports fail for missing framework dirs', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('templates')) return false as never
      if (s.includes('manifest.json')) return false as never
      // Modules directory for installed modules
      if (s.includes('.javi-forge')) return false as never
      return true as never
    })
    mockedFs.readdir.mockResolvedValue(['a'] as never)

    const result = await runDoctor('/test/project')
    const structSection = result.sections.find(s => s.title === 'Framework Structure')!
    const templatesCheck = structSection.checks.find(c => c.label === 'templates/')
    expect(templatesCheck!.status).toBe('fail')
  })

  it('shows stack when detected', async () => {
    mockedDetectStack.mockResolvedValue({
      stackType: 'node',
      buildTool: 'pnpm',
    })

    const result = await runDoctor('/test/project')
    const stackSection = result.sections.find(s => s.title === 'Stack Detection')!
    const stackCheck = stackSection.checks[0]
    expect(stackCheck.status).toBe('ok')
    expect(stackCheck.detail).toContain('node')
    expect(stackCheck.detail).toContain('pnpm')
  })

  it('countDir filters dotfiles', async () => {
    mockedFs.readdir.mockResolvedValue(['.hidden', 'file1', '.git', 'file2'] as never)
    mockedFs.pathExists.mockResolvedValue(true as never)

    const result = await runDoctor('/test/project')
    const structSection = result.sections.find(s => s.title === 'Framework Structure')!
    // Filtered: file1, file2 → 2 entries
    expect(structSection.checks[0].detail).toBe('2 entries')
  })
})
