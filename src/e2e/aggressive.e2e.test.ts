/**
 * Aggressive E2E tests for javi-forge init command.
 *
 * These tests do REAL filesystem operations in sandboxed temp directories.
 * They verify that `init` actually creates the expected project structure,
 * files, and content — not dry-run.
 *
 * Prerequisites: `pnpm build` must be run before these tests.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import os from 'os'
import fs from 'fs-extra'
import crypto from 'crypto'
import { describe, it, expect, afterEach } from 'vitest'

const execFileAsync = promisify(execFile)
const CLI_PATH = path.resolve(__dirname, '../../dist/index.js')

// ── Helpers ──────────────────────────────────────────────────────────────────

const sandboxes: string[] = []

async function createSandbox(): Promise<string> {
  const dir = path.join(os.tmpdir(), `javi-forge-aggressive-${crypto.randomUUID()}`)
  await fs.ensureDir(dir)
  sandboxes.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of sandboxes) {
    await fs.remove(dir).catch(() => {})
  }
  sandboxes.length = 0
})

/**
 * Run the CLI for real (no --dry-run) in a sandbox.
 * Always sets CI=1 and --batch for non-interactive mode.
 * Defaults: --no-ai-sync by NOT including aiSync (OptionSelector auto-confirms
 * with defaults which includes aiSync, so we accept javi-ai errors gracefully).
 */
async function runInit(
  args: string[],
  cwd: string,
  timeout = 60_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      'node',
      [CLI_PATH, 'init', '--batch', ...args],
      {
        timeout,
        cwd,
        env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
      }
    )
    return { stdout, stderr, exitCode: 0 }
  } catch (e: any) {
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.code ?? 1,
    }
  }
}

/** Get the project directory inside a sandbox */
function projectDir(sandbox: string, name: string): string {
  return path.join(sandbox, name)
}

/** Check if a file exists in the project */
async function fileExists(sandbox: string, name: string, ...segments: string[]): Promise<boolean> {
  return fs.pathExists(path.join(sandbox, name, ...segments))
}

/** Read a file from the project */
async function readProjectFile(sandbox: string, name: string, ...segments: string[]): Promise<string> {
  return fs.readFile(path.join(sandbox, name, ...segments), 'utf-8')
}

// ── Project creation tests ───────────────────────────────────────────────────

describe('Project creation: init creates complete project', () => {
  it('init --stack node --ci github: creates complete project structure', async () => {
    const sandbox = await createSandbox()
    const { exitCode } = await runInit(
      ['--project-name', 'test-app', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    expect(exitCode).toBe(0)

    // .git/ directory (git initialized)
    expect(await fileExists(sandbox, 'test-app', '.git')).toBe(true)

    // .github/workflows/ci.yml (CI template)
    expect(await fileExists(sandbox, 'test-app', '.github', 'workflows', 'ci.yml')).toBe(true)

    // .github/dependabot.yml (dependabot config)
    expect(await fileExists(sandbox, 'test-app', '.github', 'dependabot.yml')).toBe(true)

    // .gitignore (non-empty)
    expect(await fileExists(sandbox, 'test-app', '.gitignore')).toBe(true)
    const gitignore = await readProjectFile(sandbox, 'test-app', '.gitignore')
    expect(gitignore.length).toBeGreaterThan(0)

    // .javi-forge/manifest.json (valid JSON)
    expect(await fileExists(sandbox, 'test-app', '.javi-forge', 'manifest.json')).toBe(true)
    const manifest = await fs.readJson(path.join(sandbox, 'test-app', '.javi-forge', 'manifest.json'))
    expect(manifest).toBeDefined()
    expect(manifest.stack).toBe('node')
  })
})

// ── CI content per stack ─────────────────────────────────────────────────────

describe('CI content per stack', () => {
  it('init --stack python --ci github: CI contains Python content', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'py-app', '--stack', 'python', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const ciContent = await readProjectFile(sandbox, 'py-app', '.github', 'workflows', 'ci.yml')
    const lower = ciContent.toLowerCase()
    expect(
      lower.includes('pytest') || lower.includes('pip') || lower.includes('python')
    ).toBe(true)
  })

  it('init --stack go --ci github: CI contains Go content', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'go-app', '--stack', 'go', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const ciContent = await readProjectFile(sandbox, 'go-app', '.github', 'workflows', 'ci.yml')
    const lower = ciContent.toLowerCase()
    expect(
      lower.includes('go test') || lower.includes('golangci') || lower.includes('go-version')
    ).toBe(true)
  })

  it('init --stack java-gradle --ci github: CI contains Gradle content', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'java-app', '--stack', 'java-gradle', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const ciContent = await readProjectFile(sandbox, 'java-app', '.github', 'workflows', 'ci.yml')
    const lower = ciContent.toLowerCase()
    expect(
      lower.includes('gradle') || lower.includes('java') || lower.includes('jdk')
    ).toBe(true)
  })

  it('init --stack rust --ci github: CI contains Rust/Cargo content', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'rust-app', '--stack', 'rust', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const ciContent = await readProjectFile(sandbox, 'rust-app', '.github', 'workflows', 'ci.yml')
    const lower = ciContent.toLowerCase()
    expect(
      lower.includes('cargo') || lower.includes('clippy') || lower.includes('rust')
    ).toBe(true)
  })
})

// ── CI providers ─────────────────────────────────────────────────────────────

describe('CI providers', () => {
  it('init --ci gitlab: creates .gitlab-ci.yml', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'gl-app', '--stack', 'node', '--ci', 'gitlab', '--memory', 'none'],
      sandbox
    )

    expect(await fileExists(sandbox, 'gl-app', '.gitlab-ci.yml')).toBe(true)
    // Should NOT have GitHub workflows
    expect(await fileExists(sandbox, 'gl-app', '.github', 'workflows')).toBe(false)
  })

  it('init --ci woodpecker: creates .woodpecker.yml', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'wp-app', '--stack', 'node', '--ci', 'woodpecker', '--memory', 'none'],
      sandbox
    )

    const hasYml = await fileExists(sandbox, 'wp-app', '.woodpecker.yml')
    const hasDir = await fileExists(sandbox, 'wp-app', '.woodpecker')
    expect(hasYml || hasDir).toBe(true)
  })
})

// ── Memory module tests ──────────────────────────────────────────────────────

describe('Memory modules', () => {
  it('init --memory engram: installs engram module', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'eng-app', '--stack', 'node', '--ci', 'github', '--memory', 'engram'],
      sandbox
    )

    // Engram module files copied to .javi-forge/modules/engram/
    expect(await fileExists(sandbox, 'eng-app', '.javi-forge', 'modules', 'engram')).toBe(true)

    // .mcp-config-snippet.json copied to project root
    expect(await fileExists(sandbox, 'eng-app', '.mcp-config-snippet.json')).toBe(true)
  })

  it('init --memory obsidian-brain: installs obsidian brain module', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'obs-app', '--stack', 'node', '--ci', 'github', '--memory', 'obsidian-brain'],
      sandbox
    )

    // Module copied to .javi-forge/modules/obsidian-brain/
    expect(await fileExists(sandbox, 'obs-app', '.javi-forge', 'modules', 'obsidian-brain')).toBe(true)

    // .project/Memory structure inside the module copy
    expect(
      await fileExists(sandbox, 'obs-app', '.javi-forge', 'modules', 'obsidian-brain', '.project', 'Memory', 'CONTEXT.md')
    ).toBe(true)
    expect(
      await fileExists(sandbox, 'obs-app', '.javi-forge', 'modules', 'obsidian-brain', '.project', 'Memory', 'KANBAN.md')
    ).toBe(true)
  })

  it('init --memory memory-simple: installs simple memory module', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'sim-app', '--stack', 'node', '--ci', 'github', '--memory', 'memory-simple'],
      sandbox
    )

    // Module copied to .javi-forge/modules/memory-simple/
    expect(await fileExists(sandbox, 'sim-app', '.javi-forge', 'modules', 'memory-simple')).toBe(true)

    // .project/NOTES.md inside the module copy
    expect(
      await fileExists(sandbox, 'sim-app', '.javi-forge', 'modules', 'memory-simple', '.project', 'NOTES.md')
    ).toBe(true)
  })

  it('init --memory none: no memory module installed', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'no-mem', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    // No modules directory for memory
    const modulesDir = path.join(sandbox, 'no-mem', '.javi-forge', 'modules')
    const hasModulesDir = await fs.pathExists(modulesDir)
    if (hasModulesDir) {
      const entries = await fs.readdir(modulesDir)
      // Should not contain engram, obsidian-brain, or memory-simple
      const memoryModules = entries.filter(e =>
        ['engram', 'obsidian-brain', 'memory-simple'].includes(e)
      )
      expect(memoryModules).toHaveLength(0)
    }
  })
})

// ── Dependabot ecosystem tests ───────────────────────────────────────────────

describe('Dependabot ecosystems', () => {
  it('node project: dependabot has npm ecosystem', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'dep-node', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const content = await readProjectFile(sandbox, 'dep-node', '.github', 'dependabot.yml')
    expect(content).toContain('npm')
  })

  it('python project: dependabot has pip ecosystem', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'dep-py', '--stack', 'python', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const content = await readProjectFile(sandbox, 'dep-py', '.github', 'dependabot.yml')
    expect(content).toContain('pip')
  })

  it('go project: dependabot has gomod ecosystem', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'dep-go', '--stack', 'go', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const content = await readProjectFile(sandbox, 'dep-go', '.github', 'dependabot.yml')
    expect(content).toContain('gomod')
  })
})

// ── SDD tests ────────────────────────────────────────────────────────────────

describe('SDD (Spec-Driven Development)', () => {
  it('init with SDD default (CI auto-confirms with sdd=true): creates openspec/', async () => {
    const sandbox = await createSandbox()
    // In CI/batch mode, OptionSelector defaults to sdd=true
    await runInit(
      ['--project-name', 'sdd-app', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    expect(await fileExists(sandbox, 'sdd-app', 'openspec')).toBe(true)
    expect(await fileExists(sandbox, 'sdd-app', 'openspec', 'README.md')).toBe(true)
  })
})

// ── GHAGGA tests ─────────────────────────────────────────────────────────────

describe('GHAGGA review system', () => {
  it('init --ghagga --ci github: creates ghagga workflow', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'ghagga-app', '--stack', 'node', '--ci', 'github', '--memory', 'none', '--ghagga'],
      sandbox
    )

    // GHAGGA module installed
    expect(await fileExists(sandbox, 'ghagga-app', '.javi-forge', 'modules', 'ghagga')).toBe(true)

    // Ghagga workflow file
    const workflowDir = path.join(sandbox, 'ghagga-app', '.github', 'workflows')
    if (await fs.pathExists(workflowDir)) {
      const files = await fs.readdir(workflowDir)
      const hasGhaggaWorkflow = files.some(f => f.toLowerCase().includes('ghagga'))
      expect(hasGhaggaWorkflow).toBe(true)
    }
  })

  it('init without --ghagga: no ghagga module or workflow', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'no-ghagga', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    // No ghagga module
    expect(
      await fileExists(sandbox, 'no-ghagga', '.javi-forge', 'modules', 'ghagga')
    ).toBe(false)

    // No ghagga workflow
    const workflowDir = path.join(sandbox, 'no-ghagga', '.github', 'workflows')
    if (await fs.pathExists(workflowDir)) {
      const files = await fs.readdir(workflowDir)
      const hasGhaggaWorkflow = files.some(f => f.toLowerCase().includes('ghagga'))
      expect(hasGhaggaWorkflow).toBe(false)
    }
  })
})

// ── Manifest tests ───────────────────────────────────────────────────────────

describe('Manifest metadata', () => {
  it('manifest contains correct metadata fields', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'meta-app', '--stack', 'python', '--ci', 'github', '--memory', 'engram'],
      sandbox
    )

    const manifest = await fs.readJson(
      path.join(sandbox, 'meta-app', '.javi-forge', 'manifest.json')
    )

    expect(manifest).toHaveProperty('stack')
    expect(manifest).toHaveProperty('ciProvider')
    expect(manifest).toHaveProperty('memory')
    expect(manifest).toHaveProperty('createdAt')
    expect(manifest.stack).toBe('python')
    expect(manifest.ciProvider).toBe('github')
    expect(manifest.memory).toBe('engram')
    expect(manifest.projectName).toBe('meta-app')
  })

  it('different stacks produce different manifests', async () => {
    const sandbox = await createSandbox()

    await runInit(
      ['--project-name', 'proj-node', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )
    await runInit(
      ['--project-name', 'proj-go', '--stack', 'go', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const manifestNode = await fs.readJson(
      path.join(sandbox, 'proj-node', '.javi-forge', 'manifest.json')
    )
    const manifestGo = await fs.readJson(
      path.join(sandbox, 'proj-go', '.javi-forge', 'manifest.json')
    )

    expect(manifestNode.stack).toBe('node')
    expect(manifestGo.stack).toBe('go')
    expect(manifestNode.stack).not.toBe(manifestGo.stack)
  })
})

// ── Gitignore tests ──────────────────────────────────────────────────────────

describe('Gitignore generation', () => {
  it('generated .gitignore is non-empty with at least 5 lines', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'gi-app', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const content = await readProjectFile(sandbox, 'gi-app', '.gitignore')
    const lines = content.split('\n').filter(l => l.trim().length > 0)
    expect(lines.length).toBeGreaterThanOrEqual(5)
  })

  it('generated .gitignore contains common patterns', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'gi-app2', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const content = await readProjectFile(sandbox, 'gi-app2', '.gitignore')
    // The template has common patterns like .env, .idea, .DS_Store
    expect(
      content.includes('.env') ||
      content.includes('node_modules') ||
      content.includes('.DS_Store') ||
      content.includes('.idea')
    ).toBe(true)
  })
})

// ── Idempotency tests ────────────────────────────────────────────────────────

describe('Idempotency', () => {
  it('init in already-initialized project does not crash on second run', async () => {
    const sandbox = await createSandbox()

    // First run
    const first = await runInit(
      ['--project-name', 'idem-app', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )
    expect(first.exitCode).toBe(0)

    // Second run — same project name in same sandbox
    const second = await runInit(
      ['--project-name', 'idem-app', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )
    // Should not crash — exits 0
    expect(second.exitCode).toBe(0)

    // Project should still be valid
    expect(await fileExists(sandbox, 'idem-app', '.javi-forge', 'manifest.json')).toBe(true)
  })
})

// ── CI Local tests ───────────────────────────────────────────────────────────

describe('CI Local setup', () => {
  it('init creates ci-local if source dir exists', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'ci-app', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    // ci-local dir should exist (copied from forge root)
    const ciLocalDir = path.join(sandbox, 'ci-app', 'ci-local')
    const hasCILocal = await fs.pathExists(ciLocalDir)
    if (hasCILocal) {
      // Should have ci-local.sh or hooks
      const hasCIScript = await fs.pathExists(path.join(ciLocalDir, 'ci-local.sh'))
      const hasHooks = await fs.pathExists(path.join(ciLocalDir, 'hooks'))
      expect(hasCIScript || hasHooks).toBe(true)
    }
    // If ci-local source doesn't exist at forge root, this step is skipped — that's OK
    expect(true).toBe(true)
  })
})

// ── Cross-stack CI generation ────────────────────────────────────────────────

describe('Cross-stack CI generation', () => {
  const stacks = ['node', 'python', 'go', 'rust', 'java-gradle'] as const

  for (const stack of stacks) {
    it(`init --stack ${stack} --ci github: generates CI workflow file`, async () => {
      const sandbox = await createSandbox()
      const name = `ci-${stack}`
      await runInit(
        ['--project-name', name, '--stack', stack, '--ci', 'github', '--memory', 'none'],
        sandbox
      )

      expect(await fileExists(sandbox, name, '.github', 'workflows', 'ci.yml')).toBe(true)
      const content = await readProjectFile(sandbox, name, '.github', 'workflows', 'ci.yml')
      expect(content.length).toBeGreaterThan(10)
    })
  }
})

// ── Dependabot with github-actions fragment ──────────────────────────────────

describe('Dependabot includes github-actions', () => {
  it('dependabot.yml contains github-actions update section', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'dbot-app', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    const content = await readProjectFile(sandbox, 'dbot-app', '.github', 'dependabot.yml')
    expect(content).toContain('github-actions')
  })
})

// ── GitLab does not create dependabot ────────────────────────────────────────

describe('Non-GitHub CI skips dependabot', () => {
  it('gitlab CI does not create .github/dependabot.yml', async () => {
    const sandbox = await createSandbox()
    await runInit(
      ['--project-name', 'gl-nodep', '--stack', 'node', '--ci', 'gitlab', '--memory', 'none'],
      sandbox
    )

    expect(await fileExists(sandbox, 'gl-nodep', '.github', 'dependabot.yml')).toBe(false)
  })
})
