import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InitOptions, InitStep } from '../types/index.js'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    readJson: vi.fn(),
    writeFile: vi.fn(),
    writeJson: vi.fn(),
    copy: vi.fn(),
    ensureDir: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

// ── Mock child_process ───────────────────────────────────────────────────────
vi.mock('child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
    cb(null, { stdout: '', stderr: '' })
  }),
}))

// ── Mock template module ─────────────────────────────────────────────────────
vi.mock('../lib/template.js', () => ({
  generateDependabotYml: vi.fn().mockResolvedValue('dependabot-content'),
  generateCIWorkflow: vi.fn().mockResolvedValue('ci-workflow-content'),
  getCIDestination: vi.fn().mockReturnValue('.github/workflows/ci.yml'),
}))

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock('../lib/common.js', () => ({
  backupIfExists: vi.fn().mockResolvedValue(false),
  ensureDirExists: vi.fn().mockResolvedValue(undefined),
}))

import fs from 'fs-extra'
import { execFile } from 'child_process'
import { initProject } from './init.js'
import { generateCIWorkflow, getCIDestination } from '../lib/template.js'

const mockedFs = vi.mocked(fs)
const mockedExecFile = vi.mocked(execFile)
const mockedGenerateCIWorkflow = vi.mocked(generateCIWorkflow)
const mockedGetCIDestination = vi.mocked(getCIDestination)

beforeEach(() => {
  vi.resetAllMocks()

  // Default: most things exist
  mockedFs.pathExists.mockResolvedValue(true as never)
  mockedFs.writeFile.mockResolvedValue(undefined as never)
  mockedFs.writeJson.mockResolvedValue(undefined as never)
  mockedFs.copy.mockResolvedValue(undefined as never)
  mockedFs.ensureDir.mockResolvedValue(undefined as never)

  // Default: execFile succeeds (promisified version)
  mockedExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' })
    return undefined as any
  })

  // Default: CI workflow available
  mockedGenerateCIWorkflow.mockResolvedValue('ci-workflow-content')
  mockedGetCIDestination.mockReturnValue('.github/workflows/ci.yml')
})

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    projectName: 'test-project',
    projectDir: '/test/project',
    stack: 'node',
    ciProvider: 'github',
    memory: 'engram',
    aiSync: true,
    sdd: true,
    ghagga: true,
    dryRun: false,
    ...overrides,
  }
}

function collectSteps(options: InitOptions): Promise<InitStep[]> {
  const steps: InitStep[] = []
  return initProject(options, (step) => steps.push(step)).then(() => steps)
}

// ═══════════════════════════════════════════════════════════════════════════════
// initProject
// ═══════════════════════════════════════════════════════════════════════════════
describe('initProject', () => {
  it('completes full happy path — all steps report done', async () => {
    // .git doesn't exist yet so it initializes
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions())
    const doneSteps = steps.filter(s => s.status === 'done')
    // Should have multiple 'done' status steps
    expect(doneSteps.length).toBeGreaterThanOrEqual(8)
  })

  it('dry-run: no filesystem writes are made', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ dryRun: true }))
    // In dry-run, fs.writeFile and fs.writeJson should not be called
    expect(mockedFs.writeFile).not.toHaveBeenCalled()
    expect(mockedFs.writeJson).not.toHaveBeenCalled()
  })

  it('continues other steps when one step errors', async () => {
    // Make CI generation throw
    mockedGenerateCIWorkflow.mockRejectedValue(new Error('CI template error'))
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions())
    // Should have both error and done steps
    const errorSteps = steps.filter(s => s.status === 'error')
    const doneSteps = steps.filter(s => s.status === 'done')
    expect(errorSteps.length).toBeGreaterThanOrEqual(1)
    expect(doneSteps.length).toBeGreaterThanOrEqual(5)
  })

  it('skips memory when memory is none', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ memory: 'none' }))
    const memStep = steps.find(s => s.id === 'memory' && s.status === 'skipped')
    expect(memStep).toBeDefined()
  })

  it('skips ghagga when ghagga is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ ghagga: false }))
    const ghStep = steps.find(s => s.id === 'ghagga' && s.status === 'skipped')
    expect(ghStep).toBeDefined()
  })

  it('skips SDD when sdd is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ sdd: false }))
    const sddStep = steps.find(s => s.id === 'sdd' && s.status === 'skipped')
    expect(sddStep).toBeDefined()
  })

  it('skips AI sync when aiSync is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ aiSync: false }))
    const aiStep = steps.find(s => s.id === 'ai-sync' && s.status === 'skipped')
    expect(aiStep).toBeDefined()
  })

  it('reports already exists when .git directory is present', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions())
    const gitStep = steps.find(s => s.id === 'git-init' && s.status === 'done' && s.detail === 'already exists')
    expect(gitStep).toBeDefined()
  })

  it('skips CI step when no template found', async () => {
    mockedGenerateCIWorkflow.mockResolvedValue(null)
    mockedFs.pathExists.mockResolvedValue(true as never)

    const steps = await collectSteps(makeOptions())
    const ciStep = steps.find(s => s.id === 'ci-template' && s.status === 'skipped')
    expect(ciStep).toBeDefined()
  })

  it('writes manifest with correct structure', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    await collectSteps(makeOptions({
      projectName: 'test-manifest',
      stack: 'node',
      ciProvider: 'github',
      memory: 'engram',
      ghagga: true,
      sdd: true,
      aiSync: true,
    }))

    expect(mockedFs.writeJson).toHaveBeenCalled()
    const [manifestPath, manifestData] = mockedFs.writeJson.mock.calls[0]
    expect(String(manifestPath)).toContain('manifest.json')
    expect(manifestData).toMatchObject({
      version: '0.1.0',
      projectName: 'test-manifest',
      stack: 'node',
      ciProvider: 'github',
      memory: 'engram',
    })
    expect((manifestData as any).modules).toContain('engram')
    expect((manifestData as any).modules).toContain('ghagga')
    expect((manifestData as any).modules).toContain('sdd')
    expect((manifestData as any).modules).toContain('ai-config')
  })

  it('reports error with helpful message when javi-ai not found', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return true as never
      return true as never
    })

    // Make javi-ai sync fail with ENOENT
    mockedExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
      const cmdStr = String(_cmd)
      const argsArr = _args as string[]
      if (cmdStr === 'npx' && argsArr?.includes('javi-ai')) {
        if (typeof cb === 'function') cb(new Error('ENOENT: command not found'), { stdout: '', stderr: '' })
      } else {
        if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' })
      }
      return undefined as any
    })

    const steps = await collectSteps(makeOptions({ aiSync: true }))
    const aiStep = steps.find(s => s.id === 'ai-sync' && s.status === 'error')
    expect(aiStep).toBeDefined()
    expect(aiStep!.detail).toContain('javi-ai not found')
  })

  it('reports steps in order via callback', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions())
    const stepIds = steps.map(s => s.id)

    // First step should be git-init
    expect(stepIds[0]).toBe('git-init')

    // Manifest should be among the last
    const manifestIdx = stepIds.lastIndexOf('manifest')
    expect(manifestIdx).toBeGreaterThan(stepIds.indexOf('git-init'))
  })

  it('skips dependabot for non-github providers', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ ciProvider: 'gitlab' }))
    const depStep = steps.find(s => s.id === 'dependabot' && s.status === 'skipped')
    expect(depStep).toBeDefined()
  })

  it('skips gitignore when .gitignore already exists', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions())
    const giStep = steps.find(s => s.id === 'gitignore' && s.detail === 'already exists')
    expect(giStep).toBeDefined()
  })

  it('skips hooks when ci-local dir is missing', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('ci-local')) return false as never
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions())
    const hookStep = steps.find(s => s.id === 'git-hooks' && s.status === 'skipped')
    expect(hookStep).toBeDefined()
  })

  it('reports error when memory module not found', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      // Module source directory doesn't exist
      if (s.includes('modules/engram') && !s.includes('.javi-forge')) return false as never
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ memory: 'engram' }))
    const memStep = steps.find(s => s.id === 'memory' && s.status === 'error')
    expect(memStep).toBeDefined()
    expect(memStep!.detail).toContain('module not found')
  })
})
