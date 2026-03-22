import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs-extra'
import path from 'path'
import yaml from 'yaml'
import { initProject } from '../commands/init.js'
import type { InitOptions } from '../types/index.js'
import { createTempDir, cleanupTempDir, readGenerated, fileExists, getFileMode, collectSteps } from './helpers.js'

// Mock ONLY external commands (git, npx) — NOT filesystem
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process')
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
      // Simulate git init / git config success
      if (cb) cb(null, { stdout: '', stderr: '' })
      return { stdout: '', stderr: '' }
    }),
  }
})

// Make promisify(execFile) work with our mock
vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util')
  return {
    ...actual,
    promisify: (fn: Function) => {
      if (fn.name === 'execFile' || fn.name === 'mockConstructor') {
        return async (...args: unknown[]) => ({ stdout: '', stderr: '' })
      }
      return actual.promisify(fn as any)
    },
  }
})

let tmpDir: string

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  const projectDir = path.join(tmpDir, overrides.projectName ?? 'test-project')
  return {
    projectName: 'test-project',
    projectDir,
    stack: 'node',
    ciProvider: 'github',
    memory: 'engram',
    aiSync: false, // skip javi-ai (external)
    sdd: true,
    ghagga: true,
    mock: false,
    dryRun: false,
    ...overrides,
    // Always override projectDir based on projectName
    ...(overrides.projectDir ? {} : { projectDir }),
  }
}

describe('initProject() — integration', () => {
  beforeEach(async () => {
    tmpDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupTempDir(tmpDir)
  })

  // ── Task 2: Full happy path ─────────────────────────────────────────────

  it('creates all expected files for node+github+engram+ghagga', async () => {
    const opts = makeOptions()
    const { onStep } = collectSteps()

    await initProject(opts, onStep)

    // Core files exist
    expect(await fileExists(opts.projectDir, '.github', 'workflows', 'ci.yml')).toBe(true)
    expect(await fileExists(opts.projectDir, '.github', 'dependabot.yml')).toBe(true)
    expect(await fileExists(opts.projectDir, '.gitignore')).toBe(true)
    expect(await fileExists(opts.projectDir, '.javi-forge', 'manifest.json')).toBe(true)
    expect(await fileExists(opts.projectDir, 'openspec', 'README.md')).toBe(true)

    // ci-local structure
    expect(await fileExists(opts.projectDir, 'ci-local', 'ci-local.sh')).toBe(true)
    expect(await fileExists(opts.projectDir, 'ci-local', 'hooks', 'pre-commit')).toBe(true)
    expect(await fileExists(opts.projectDir, 'ci-local', 'hooks', 'pre-push')).toBe(true)
    expect(await fileExists(opts.projectDir, 'ci-local', 'hooks', 'commit-msg')).toBe(true)

    // Modules
    expect(await fileExists(opts.projectDir, '.javi-forge', 'modules', 'engram', 'README.md')).toBe(true)
    expect(await fileExists(opts.projectDir, '.javi-forge', 'modules', 'ghagga', 'README.md')).toBe(true)

    // Ghagga workflow
    expect(await fileExists(opts.projectDir, '.github', 'workflows', 'ghagga-review.yml')).toBe(true)
  })

  // ── Task 3: Verify content of generated files ───────────────────────────

  it('CI workflow points to javi-forge reusable workflows', async () => {
    const opts = makeOptions()
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    const ciContent = await readGenerated(opts.projectDir, '.github', 'workflows', 'ci.yml')
    expect(ciContent).toContain('JNZader/javi-forge/')
    expect(ciContent).not.toContain('project-starter-framework')
    // Must be valid YAML
    expect(() => yaml.parse(ciContent)).not.toThrow()
  })

  it('dependabot.yml is valid YAML with npm ecosystem for node stack', async () => {
    const opts = makeOptions()
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    const content = await readGenerated(opts.projectDir, '.github', 'dependabot.yml')
    const parsed = yaml.parse(content)
    expect(parsed.version).toBe(2)
    expect(parsed.updates).toBeInstanceOf(Array)

    const ecosystems = parsed.updates.map((u: any) => u['package-ecosystem'])
    expect(ecosystems).toContain('npm')
    expect(ecosystems).toContain('github-actions')
  })

  it('manifest.json has correct structure and values', async () => {
    const opts = makeOptions({ projectName: 'my-app', memory: 'engram' })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    const raw = await readGenerated(opts.projectDir, '.javi-forge', 'manifest.json')
    const manifest = JSON.parse(raw)

    expect(manifest.projectName).toBe('my-app')
    expect(manifest.stack).toBe('node')
    expect(manifest.ciProvider).toBe('github')
    expect(manifest.memory).toBe('engram')
    expect(manifest.version).toBe('0.1.0')
    // Timestamps are valid ISO strings
    expect(new Date(manifest.createdAt).toISOString()).toBe(manifest.createdAt)
    expect(new Date(manifest.updatedAt).toISOString()).toBe(manifest.updatedAt)
    // Modules array
    expect(manifest.modules).toContain('engram')
    expect(manifest.modules).toContain('ghagga')
    expect(manifest.modules).toContain('sdd')
  })

  it('.gitignore is non-empty', async () => {
    const opts = makeOptions()
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    const content = await readGenerated(opts.projectDir, '.gitignore')
    expect(content.trim().length).toBeGreaterThan(10)
  })

  // ── Task 5: ci-local self-contained ─────────────────────────────────────

  it('ci-local has bundled lib/common.sh', async () => {
    const opts = makeOptions()
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    // lib/common.sh must exist inside ci-local
    expect(await fileExists(opts.projectDir, 'ci-local', 'lib', 'common.sh')).toBe(true)

    // ci-local.sh references local lib first
    const ciLocal = await readGenerated(opts.projectDir, 'ci-local', 'ci-local.sh')
    expect(ciLocal).toContain('SCRIPT_DIR/lib/common.sh')
  })

  it('hooks are executable (755)', async () => {
    const opts = makeOptions()
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    const preCommitMode = await getFileMode(opts.projectDir, 'ci-local', 'hooks', 'pre-commit')
    const prePushMode = await getFileMode(opts.projectDir, 'ci-local', 'hooks', 'pre-push')
    const commitMsgMode = await getFileMode(opts.projectDir, 'ci-local', 'hooks', 'commit-msg')

    expect(preCommitMode & 0o111).toBeGreaterThan(0) // at least one execute bit
    expect(prePushMode & 0o111).toBeGreaterThan(0)
    expect(commitMsgMode & 0o111).toBeGreaterThan(0)
  })

  it('pre-commit hook uses --no-docker for quick checks', async () => {
    const opts = makeOptions()
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    const preCommit = await readGenerated(opts.projectDir, 'ci-local', 'hooks', 'pre-commit')
    expect(preCommit).toContain('--no-docker')
  })

  it('semgrep.yml is present in ci-local', async () => {
    const opts = makeOptions()
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    expect(await fileExists(opts.projectDir, 'ci-local', 'semgrep.yml')).toBe(true)
  })

  // ── Task 6: Module installation ─────────────────────────────────────────

  it('engram: MCP snippet has project name replaced (not __PROJECT_NAME__)', async () => {
    const opts = makeOptions({ projectName: 'my-cool-app' })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    expect(await fileExists(opts.projectDir, '.mcp-config-snippet.json')).toBe(true)
    const snippet = await readGenerated(opts.projectDir, '.mcp-config-snippet.json')
    const parsed = JSON.parse(snippet)

    expect(parsed.mcpServers.engram.env.ENGRAM_PROJECT).toBe('my-cool-app')
    expect(snippet).not.toContain('__PROJECT_NAME__')
  })

  it('engram: module has install script and README', async () => {
    const opts = makeOptions({ memory: 'engram' })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    expect(await fileExists(opts.projectDir, '.javi-forge', 'modules', 'engram', 'install-engram.sh')).toBe(true)
    expect(await fileExists(opts.projectDir, '.javi-forge', 'modules', 'engram', 'README.md')).toBe(true)
  })

  it('obsidian-brain: module has .project/Memory structure', async () => {
    const opts = makeOptions({ memory: 'obsidian-brain', ghagga: false })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    expect(await fileExists(opts.projectDir, '.javi-forge', 'modules', 'obsidian-brain', 'README.md')).toBe(true)
    expect(await fileExists(opts.projectDir, '.javi-forge', 'modules', 'obsidian-brain', '.project', 'Memory', 'DECISIONS.md')).toBe(true)
  })

  it('ghagga: workflow is a caller (on: pull_request), not reusable (on: workflow_call)', async () => {
    const opts = makeOptions({ ghagga: true })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    const workflow = await readGenerated(opts.projectDir, '.github', 'workflows', 'ghagga-review.yml')
    expect(workflow).toContain('pull_request')
    expect(workflow).not.toContain('workflow_call')
  })

  it('memory=none: no module installed, no MCP snippet', async () => {
    const opts = makeOptions({ memory: 'none', ghagga: false })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    expect(await fileExists(opts.projectDir, '.javi-forge', 'modules')).toBe(false)
    expect(await fileExists(opts.projectDir, '.mcp-config-snippet.json')).toBe(false)
  })

  // ── Task 10 (partial): Cross-stack CI content ──────────────────────────

  it('python+github: CI workflow references python reusable', async () => {
    const opts = makeOptions({ stack: 'python', projectName: 'py-test' })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    const ci = await readGenerated(opts.projectDir, '.github', 'workflows', 'ci.yml')
    expect(ci).toContain('reusable-build-python')
  })

  it('go+gitlab: generates .gitlab-ci.yml (not .github)', async () => {
    const opts = makeOptions({ stack: 'go', ciProvider: 'gitlab', projectName: 'go-test' })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    expect(await fileExists(opts.projectDir, '.gitlab-ci.yml')).toBe(true)
    expect(await fileExists(opts.projectDir, '.github', 'workflows', 'ci.yml')).toBe(false)

    const ci = await readGenerated(opts.projectDir, '.gitlab-ci.yml')
    expect(ci.toLowerCase()).toContain('golang')
  })

  it('rust+woodpecker: generates .woodpecker.yml', async () => {
    const opts = makeOptions({ stack: 'rust', ciProvider: 'woodpecker', projectName: 'rust-test' })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    expect(await fileExists(opts.projectDir, '.woodpecker.yml')).toBe(true)
    const ci = await readGenerated(opts.projectDir, '.woodpecker.yml')
    expect(ci.toLowerCase()).toContain('rust')
  })

  it('dependabot not generated for gitlab/woodpecker providers', async () => {
    const opts = makeOptions({ ciProvider: 'gitlab', projectName: 'no-dep' })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    expect(await fileExists(opts.projectDir, '.github', 'dependabot.yml')).toBe(false)
  })

  // ── Dry-run mode ────────────────────────────────────────────────────────

  it('dry-run: no files created', async () => {
    const opts = makeOptions({ dryRun: true, projectName: 'dry-test' })
    const { onStep } = collectSteps()
    await initProject(opts, onStep)

    expect(await fileExists(opts.projectDir)).toBe(false)
  })
})
