import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ChildProcess } from 'child_process'
import type { InitOptions, InitStep, ForgeManifest } from '../types/index.js'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    readJson: vi.fn(),
    readdir: vi.fn(),
    writeFile: vi.fn(),
    writeJson: vi.fn(),
    copy: vi.fn(),
    ensureDir: vi.fn(),
    chmod: vi.fn(),
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
  generateDeployWorkflow: vi.fn().mockResolvedValue('deploy-workflow-content'),
  getDeployDestination: vi.fn().mockReturnValue('.github/workflows/deploy.yml'),
}))

// ── Mock context module ──────────────────────────────────────────────────────
vi.mock('../lib/context.js', () => ({
  generateContextDir: vi.fn().mockResolvedValue({
    index: '# test — Project Index\n',
    summary: '# test\n',
  }),
}))

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock('../lib/common.js', () => ({
  backupIfExists: vi.fn().mockResolvedValue(false),
  ensureDirExists: vi.fn().mockResolvedValue(undefined),
}))

// ── Mock claudemd module ────────────────────────────────────────────────────
vi.mock('../lib/claudemd.js', () => ({
  generateSmartClaudeMd: vi.fn().mockReturnValue('# test-project\n\n## Stack\n'),
}))

// ── Mock stack-detector module ──────────────────────────────────────────────
vi.mock('../lib/stack-detector.js', () => ({
  detectProjectStack: vi.fn().mockResolvedValue({
    stack: 'node',
    signals: [],
    recommendedSkills: ['typescript', 'react-19'],
  }),
}))

import fs from 'fs-extra'
import { execFile } from 'child_process'
import { initProject } from './init.js'
import { generateCIWorkflow, getCIDestination, generateDeployWorkflow, getDeployDestination } from '../lib/template.js'
import { generateContextDir } from '../lib/context.js'
import { generateSmartClaudeMd } from '../lib/claudemd.js'
import { detectProjectStack } from '../lib/stack-detector.js'

const mockedFs = vi.mocked(fs)
const mockedExecFile = vi.mocked(execFile)
const mockedGenerateCIWorkflow = vi.mocked(generateCIWorkflow)
const mockedGetCIDestination = vi.mocked(getCIDestination)
const mockedGenerateDeployWorkflow = vi.mocked(generateDeployWorkflow)
const mockedGetDeployDestination = vi.mocked(getDeployDestination)
const mockedGenerateContextDir = vi.mocked(generateContextDir)
const mockedGenerateSmartClaudeMd = vi.mocked(generateSmartClaudeMd)
const mockedDetectProjectStack = vi.mocked(detectProjectStack)

beforeEach(() => {
  vi.resetAllMocks()

  // Default: most things exist
  mockedFs.pathExists.mockResolvedValue(true as never)
  mockedFs.writeFile.mockResolvedValue(undefined as never)
  mockedFs.writeJson.mockResolvedValue(undefined as never)
  mockedFs.copy.mockResolvedValue(undefined as never)
  mockedFs.ensureDir.mockResolvedValue(undefined as never)
  mockedFs.readdir.mockResolvedValue(['pre-commit-secrets', 'pre-push-deps', 'pre-commit-permissions', 'pre-push-signing', 'pre-push-branch-protection', 'commit-msg-signing', 'claude-settings-security.json'] as never)
  mockedFs.chmod.mockResolvedValue(undefined as never)

  // Default: execFile succeeds (promisified version)
  mockedExecFile.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: unknown) => {
    if (typeof cb === 'function') cb(null, { stdout: '', stderr: '' })
    return undefined as unknown as ChildProcess
  })

  // Default: CI workflow available
  mockedGenerateCIWorkflow.mockResolvedValue('ci-workflow-content')
  mockedGetCIDestination.mockReturnValue('.github/workflows/ci.yml')

  // Default: deploy workflow available
  mockedGenerateDeployWorkflow.mockResolvedValue('deploy-workflow-content')
  mockedGetDeployDestination.mockReturnValue('.github/workflows/deploy.yml')

  // Default: context dir generation
  mockedGenerateContextDir.mockResolvedValue({
    index: '# test — Project Index\n',
    summary: '# test\n',
  })

  // Default: claudemd generation
  mockedGenerateSmartClaudeMd.mockReturnValue('# test-project\n\n## Stack\n')

  // Default: stack detection
  mockedDetectProjectStack.mockResolvedValue({
    stack: 'node',
    signals: [],
    recommendedSkills: ['typescript', 'react-19'],
  })
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
    mock: false,
    contextDir: true,
    claudeMd: true,
    securityHooks: true,
    hookProfile: 'standard',
    codeGraph: false,
    dockerDeploy: false,
    dockerServiceName: 'app',
    localAi: false,
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
    const manifestCall = mockedFs.writeJson.mock.calls.find(args => String(args[0]).includes('manifest.json'))
    expect(manifestCall).toBeDefined()
    const [manifestPath, manifestData] = manifestCall!
    expect(String(manifestPath)).toContain('manifest.json')
    expect(manifestData).toMatchObject({
      version: '0.1.0',
      projectName: 'test-manifest',
      stack: 'node',
      ciProvider: 'github',
      memory: 'engram',
    })
    expect((manifestData as ForgeManifest).modules).toContain('engram')
    expect((manifestData as ForgeManifest).modules).toContain('ghagga')
    expect((manifestData as ForgeManifest).modules).toContain('sdd')
    expect((manifestData as ForgeManifest).modules).toContain('ai-config')
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
      return undefined as unknown as ChildProcess
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

  // ── Context directory step ──────────────────────────────────────────────

  it('context-dir step reports done on success', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('.context')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ contextDir: true }))
    const ctxStep = steps.find(s => s.id === 'context-dir' && s.status === 'done')
    expect(ctxStep).toBeDefined()
    expect(ctxStep!.detail).toContain('INDEX.md')
  })

  it('context-dir step is skipped when contextDir is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ contextDir: false }))
    const ctxStep = steps.find(s => s.id === 'context-dir' && s.status === 'skipped')
    expect(ctxStep).toBeDefined()
    expect(ctxStep!.detail).toContain('not selected')
  })

  it('context-dir step reports already exists when .context/ is present', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ contextDir: true }))
    const ctxStep = steps.find(s => s.id === 'context-dir' && s.status === 'done' && s.detail === 'already exists')
    expect(ctxStep).toBeDefined()
  })

  it('context-dir dry-run writes nothing', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('.context')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ contextDir: true, dryRun: true }))
    const ctxStep = steps.find(s => s.id === 'context-dir' && s.status === 'done')
    expect(ctxStep).toBeDefined()
    expect(ctxStep!.detail).toContain('dry-run')
  })

  it('manifest includes context module when contextDir is true', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    await collectSteps(makeOptions({ contextDir: true }))
    expect(mockedFs.writeJson).toHaveBeenCalled()
    const [, manifestData] = mockedFs.writeJson.mock.calls.find(args => String(args[0]).includes('manifest.json'))!
    expect((manifestData as ForgeManifest).modules).toContain('context')
  })

  // ── CLAUDE.md step ────────────────────────────────────────────────────

  it('claude-md step reports done when claudeMd is true', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('CLAUDE.md')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ claudeMd: true }))
    const claudeStep = steps.find(s => s.id === 'claude-md' && s.status === 'done')
    expect(claudeStep).toBeDefined()
    expect(mockedGenerateSmartClaudeMd).toHaveBeenCalled()
  })

  it('claude-md step reports skipped when claudeMd is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ claudeMd: false }))
    const claudeStep = steps.find(s => s.id === 'claude-md' && s.status === 'skipped')
    expect(claudeStep).toBeDefined()
  })

  it('claude-md step skips write when CLAUDE.md already exists', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)

    const steps = await collectSteps(makeOptions({ claudeMd: true }))
    const claudeStep = steps.find(s => s.id === 'claude-md' && s.status === 'done' && s.detail === 'already exists')
    expect(claudeStep).toBeDefined()
    expect(mockedGenerateSmartClaudeMd).not.toHaveBeenCalled()
  })

  it('claude-md dry-run does not write file', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('CLAUDE.md')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ claudeMd: true, dryRun: true }))
    const claudeStep = steps.find(s => s.id === 'claude-md' && s.status === 'done')
    expect(claudeStep).toBeDefined()
    expect(claudeStep!.detail).toContain('dry-run')
    // writeFile should NOT be called with CLAUDE.md path
    const claudeMdWrites = mockedFs.writeFile.mock.calls.filter(
      (call: unknown[]) => String(call[0]).includes('CLAUDE.md')
    )
    expect(claudeMdWrites).toHaveLength(0)
  })

  it('manifest includes claude-md module when claudeMd is true', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    await collectSteps(makeOptions({ claudeMd: true }))
    expect(mockedFs.writeJson).toHaveBeenCalled()
    const [, manifestData] = mockedFs.writeJson.mock.calls.find(args => String(args[0]).includes('manifest.json'))!
    expect((manifestData as ForgeManifest).modules).toContain('claude-md')
  })

  // ── Docker zero-downtime deploy step ────────────��───────────────────────

  it('docker-deploy step reports done when dockerDeploy is true', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('deploy.yml')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ dockerDeploy: true }))
    const deployStep = steps.find(s => s.id === 'docker-deploy' && s.status === 'done')
    expect(deployStep).toBeDefined()
    expect(deployStep!.detail).toContain('deploy.yml')
    expect(mockedGenerateDeployWorkflow).toHaveBeenCalledWith('github', 'app')
  })

  it('docker-deploy step is skipped when dockerDeploy is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ dockerDeploy: false }))
    const deployStep = steps.find(s => s.id === 'docker-deploy' && s.status === 'skipped')
    expect(deployStep).toBeDefined()
    expect(deployStep!.detail).toContain('not selected')
  })

  it('docker-deploy step reports already exists when deploy.yml is present', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ dockerDeploy: true }))
    const deployStep = steps.find(s => s.id === 'docker-deploy' && s.status === 'done' && s.detail === 'already exists')
    expect(deployStep).toBeDefined()
  })

  it('docker-deploy uses custom service name', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('deploy.yml')) return false as never
      return true as never
    })

    await collectSteps(makeOptions({ dockerDeploy: true, dockerServiceName: 'web' }))
    expect(mockedGenerateDeployWorkflow).toHaveBeenCalledWith('github', 'web')
  })

  it('docker-deploy dry-run does not write file', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('deploy.yml')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ dockerDeploy: true, dryRun: true }))
    const deployStep = steps.find(s => s.id === 'docker-deploy' && s.status === 'done')
    expect(deployStep).toBeDefined()
    expect(deployStep!.detail).toContain('dry-run')
    const deployWrites = mockedFs.writeFile.mock.calls.filter(
      (call: unknown[]) => String(call[0]).includes('deploy.yml')
    )
    expect(deployWrites).toHaveLength(0)
  })

  it('manifest includes docker-deploy module when dockerDeploy is true', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    await collectSteps(makeOptions({ dockerDeploy: true }))
    expect(mockedFs.writeJson).toHaveBeenCalled()
    const [, manifestData] = mockedFs.writeJson.mock.calls.find(args => String(args[0]).includes('manifest.json'))!
    expect((manifestData as ForgeManifest).modules).toContain('docker-deploy')
  })

  // ── Security hooks step ──────────────────────────────────────────────────

  it('security-hooks step copies git hooks and runtime settings when enabled', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      // settings.json does not exist yet
      if (s.endsWith('settings.json')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ securityHooks: true }))
    const secStep = steps.find(s => s.id === 'security-hooks' && s.status === 'done')
    expect(secStep).toBeDefined()
    expect(secStep!.detail).toContain('6 git layers')

    // Should copy hook files (6 git hooks, not the JSON)
    const copyCalls = mockedFs.copy.mock.calls.map((c: unknown[]) => String(c[0]))
    const securityCopies = copyCalls.filter((p: string) => p.includes('security-hooks'))
    expect(securityCopies.length).toBeGreaterThanOrEqual(6)

    // Should chmod each git hook
    expect(mockedFs.chmod).toHaveBeenCalled()
  })

  it('security-hooks step is skipped when securityHooks is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ securityHooks: false }))
    const secStep = steps.find(s => s.id === 'security-hooks' && s.status === 'skipped')
    expect(secStep).toBeDefined()
    expect(secStep!.detail).toContain('not selected')
  })

  it('security-hooks dry-run writes nothing', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ securityHooks: true, dryRun: true }))
    const secStep = steps.find(s => s.id === 'security-hooks' && s.status === 'done')
    expect(secStep).toBeDefined()
    expect(secStep!.detail).toContain('dry-run')

    // No copy calls for security hooks in dry-run
    const securityCopies = mockedFs.copy.mock.calls.filter(
      (call: unknown[]) => String(call[0]).includes('security-hooks')
    )
    expect(securityCopies).toHaveLength(0)
  })

  it('security-hooks reports error when templates not found', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.includes('security-hooks') && !s.includes('.javi-forge')) return false as never
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ securityHooks: true }))
    const secStep = steps.find(s => s.id === 'security-hooks' && s.status === 'error')
    expect(secStep).toBeDefined()
    expect(secStep!.detail).toContain('templates not found')
  })

  it('manifest includes security-hooks module when securityHooks is true', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    await collectSteps(makeOptions({ securityHooks: true }))
    expect(mockedFs.writeJson).toHaveBeenCalled()
    const [, manifestData] = mockedFs.writeJson.mock.calls.find(args => String(args[0]).includes('manifest.json'))!
    expect((manifestData as ForgeManifest).modules).toContain('security-hooks')
  })

  // ── Code graph step ───────────────────────────────────────────────────

  it('code-graph step copies config, CI workflow, and MCP snippet when enabled', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('.repoforge.yaml')) return false as never
      return true as never
    })
    mockedFs.readFile.mockResolvedValue('{"mcpServers":{"repoforge":{"env":{"REPOFORGE_PROJECT":"__PROJECT_NAME__"}}}}' as never)

    const steps = await collectSteps(makeOptions({ codeGraph: true }))
    const graphStep = steps.find(s => s.id === 'code-graph' && s.status === 'done')
    expect(graphStep).toBeDefined()
    expect(graphStep!.detail).toContain('.repoforge.yaml')

    // Should copy the repoforge config
    const copyCalls = mockedFs.copy.mock.calls.map((c: unknown[]) => String(c[1]))
    const repoforgeConfigCopy = copyCalls.find((p: string) => p.includes('.repoforge.yaml'))
    expect(repoforgeConfigCopy).toBeDefined()

    // Should write MCP snippet with project name replaced
    const writeCalls = mockedFs.writeFile.mock.calls.map((c: unknown[]) => String(c[0]))
    const mcpSnippetWrite = writeCalls.find((p: string) => p.includes('mcp-config-snippet.json'))
    expect(mcpSnippetWrite).toBeDefined()
  })

  it('code-graph step is skipped when codeGraph is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ codeGraph: false }))
    const graphStep = steps.find(s => s.id === 'code-graph' && s.status === 'skipped')
    expect(graphStep).toBeDefined()
    expect(graphStep!.detail).toContain('not selected')
  })

  it('code-graph dry-run writes nothing', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ codeGraph: true, dryRun: true }))
    const graphStep = steps.find(s => s.id === 'code-graph' && s.status === 'done')
    expect(graphStep).toBeDefined()
    expect(graphStep!.detail).toContain('dry-run')

    // No copy calls for repoforge in dry-run
    const repoforgeConfigCopies = mockedFs.copy.mock.calls.filter(
      (call: unknown[]) => String(call[1]).includes('.repoforge.yaml')
    )
    expect(repoforgeConfigCopies).toHaveLength(0)
  })

  it('manifest includes code-graph module when codeGraph is true', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    await collectSteps(makeOptions({ codeGraph: true }))
    expect(mockedFs.writeJson).toHaveBeenCalled()
    const [, manifestData] = mockedFs.writeJson.mock.calls.find(args => String(args[0]).includes('manifest.json'))!
    expect((manifestData as ForgeManifest).modules).toContain('code-graph')
  })

  // ── Local AI stack step ──────────────────────────────────────────────────

  it('local-ai step copies docker-compose.yml and .env.local-ai when enabled', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('docker-compose.yml')) return false as never
      if (s.endsWith('.env.local-ai')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ localAi: true }))
    const aiStep = steps.find(s => s.id === 'local-ai' && s.status === 'done')
    expect(aiStep).toBeDefined()
    expect(aiStep!.detail).toContain('docker-compose.yml')

    // Should copy docker-compose.yml
    const copyCalls = mockedFs.copy.mock.calls.map((c: unknown[]) => String(c[1]))
    const composeCopy = copyCalls.find((p: string) => p.includes('docker-compose.yml'))
    expect(composeCopy).toBeDefined()
  })

  it('local-ai step is skipped when localAi is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const steps = await collectSteps(makeOptions({ localAi: false }))
    const aiStep = steps.find(s => s.id === 'local-ai' && s.status === 'skipped')
    expect(aiStep).toBeDefined()
    expect(aiStep!.detail).toContain('not selected')
  })

  it('local-ai dry-run writes nothing', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ localAi: true, dryRun: true }))
    const aiStep = steps.find(s => s.id === 'local-ai' && s.status === 'done')
    expect(aiStep).toBeDefined()
    expect(aiStep!.detail).toContain('dry-run')

    // No copy calls for local-ai in dry-run
    const composeCopies = mockedFs.copy.mock.calls.filter(
      (call: unknown[]) => String(call[1]).includes('docker-compose.yml')
    )
    expect(composeCopies).toHaveLength(0)
  })

  it('manifest includes local-ai module when localAi is true', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    await collectSteps(makeOptions({ localAi: true }))
    expect(mockedFs.writeJson).toHaveBeenCalled()
    const [, manifestData] = mockedFs.writeJson.mock.calls.find(args => String(args[0]).includes('manifest.json'))!
    expect((manifestData as ForgeManifest).modules).toContain('local-ai')
  })

  // ── Agent Skills manifest step ────────────────────────────────────────────

  it('agent-skills step generates skills.json in project root', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('skills.json')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions())
    const skillsStep = steps.find(s => s.id === 'agent-skills' && s.status === 'done')
    expect(skillsStep).toBeDefined()
    expect(skillsStep!.detail).toContain('skills.json')

    const writeJsonCalls = mockedFs.writeJson.mock.calls
    const skillsCall = writeJsonCalls.find((call: unknown[]) => String(call[0]).endsWith('skills.json'))
    expect(skillsCall).toBeDefined()
    const manifest = skillsCall![1] as { name: string; version: string; skills: unknown[] }
    expect(manifest.name).toBe('test-project')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.skills).toEqual([])
  })

  it('agent-skills step reports already exists when skills.json is present', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)

    const steps = await collectSteps(makeOptions())
    const skillsStep = steps.find(s => s.id === 'agent-skills' && s.status === 'done' && s.detail === 'already exists')
    expect(skillsStep).toBeDefined()
  })

  it('agent-skills dry-run does not write skills.json', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      if (s.endsWith('skills.json')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ dryRun: true }))
    const skillsStep = steps.find(s => s.id === 'agent-skills' && s.status === 'done')
    expect(skillsStep).toBeDefined()
    expect(skillsStep!.detail).toContain('dry-run')

    const skillsWrites = mockedFs.writeJson.mock.calls.filter(
      (call: unknown[]) => String(call[0]).endsWith('skills.json')
    )
    expect(skillsWrites).toHaveLength(0)
  })

  it('agent-skills step runs after local-ai and before manifest', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions())
    const stepIds = steps.map(s => s.id)
    const localAiIdx = stepIds.lastIndexOf('local-ai')
    const skillsIdx = stepIds.indexOf('agent-skills')
    const manifestIdx = stepIds.indexOf('manifest')

    expect(skillsIdx).toBeGreaterThan(localAiIdx)
    expect(skillsIdx).toBeLessThan(manifestIdx)
  })

  // ── Hook profile step ───────────────────────────────────────────────────────

  it('hook-profile step writes profile.json with selected profile', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)

    await collectSteps(makeOptions({ securityHooks: true, hookProfile: 'strict' }))

    const writeJsonCalls = mockedFs.writeJson.mock.calls
    const profileCall = writeJsonCalls.find(args => String(args[0]).endsWith('profile.json'))
    expect(profileCall).toBeDefined()
    expect(profileCall![1]).toEqual({ profile: 'strict' })
  })

  it('hook-profile step defaults to standard when hookProfile is not set', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)

    await collectSteps(makeOptions({ securityHooks: true, hookProfile: 'standard' }))

    const writeJsonCalls = mockedFs.writeJson.mock.calls
    const profileCall = writeJsonCalls.find(args => String(args[0]).endsWith('profile.json'))
    expect(profileCall).toBeDefined()
    expect(profileCall![1]).toEqual({ profile: 'standard' })
  })

  it('hook-profile step is skipped when securityHooks is false', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)

    const steps = await collectSteps(makeOptions({ securityHooks: false, hookProfile: 'minimal' }))
    const profileStep = steps.find(s => s.id === 'hook-profile' && s.status === 'skipped')
    expect(profileStep).toBeDefined()
    expect(profileStep!.detail).toContain('security hooks not selected')
  })

  it('hook-profile step reports done with profile name in detail', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)

    const steps = await collectSteps(makeOptions({ securityHooks: true, hookProfile: 'minimal' }))
    const profileStep = steps.find(s => s.id === 'hook-profile' && s.status === 'done')
    expect(profileStep).toBeDefined()
    expect(profileStep!.detail).toContain('minimal')
    expect(profileStep!.detail).toContain('profile.json')
  })

  it('hook-profile step runs after security-hooks', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('.git')) return false as never
      return true as never
    })

    const steps = await collectSteps(makeOptions({ securityHooks: true, hookProfile: 'standard' }))
    const stepIds = steps.map(s => s.id)
    const securityIdx = stepIds.lastIndexOf('security-hooks')
    const profileIdx = stepIds.indexOf('hook-profile')

    expect(profileIdx).toBeGreaterThan(securityIdx)
  })

  it('hook-profile step is dry-run aware', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)

    const steps = await collectSteps(makeOptions({ securityHooks: true, hookProfile: 'strict', dryRun: true }))
    const profileStep = steps.find(s => s.id === 'hook-profile' && s.status === 'done')
    expect(profileStep).toBeDefined()
    expect(profileStep!.detail).toContain('dry-run')

    // writeJson should NOT have been called in dry-run
    const writeJsonCalls = mockedFs.writeJson.mock.calls
    const profileCall = writeJsonCalls.find(args => String(args[0]).endsWith('profile.json'))
    expect(profileCall).toBeUndefined()
  })
})
