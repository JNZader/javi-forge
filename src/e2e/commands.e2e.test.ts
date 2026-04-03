/**
 * E2E tests for javi-forge CLI commands.
 *
 * These tests execute the REAL compiled CLI as a subprocess but ONLY test
 * dry-run behavior — no real filesystem modifications are made.
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
  const dir = path.join(os.tmpdir(), `javi-forge-e2e-${crypto.randomUUID()}`)
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

async function runCLI(
  args: string[],
  cwd?: string,
  timeout = 30_000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI_PATH, ...args], {
      timeout,
      cwd: cwd ?? process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0', CI: '1' },
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (e: unknown) {
    const err = e as Record<string, unknown>
    return {
      stdout: (err.stdout as string) ?? '',
      stderr: (err.stderr as string) ?? '',
      exitCode: (err.code as number) ?? 1,
    }
  }
}

// ── --help ──────────────────────────────────────────────────────────────────

describe('javi-forge --help', () => {
  it('shows usage with all commands listed', async () => {
    const { stdout, exitCode } = await runCLI(['--help'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('javi-forge')
    expect(stdout).toContain('init')
    expect(stdout).toContain('analyze')
    expect(stdout).toContain('doctor')
  })

  it('shows all option flags', async () => {
    const { stdout } = await runCLI(['--help'])

    expect(stdout).toContain('--dry-run')
    expect(stdout).toContain('--stack')
    expect(stdout).toContain('--ci')
    expect(stdout).toContain('--memory')
    expect(stdout).toContain('--project-name')
    expect(stdout).toContain('--ghagga')
    expect(stdout).toContain('--batch')
  })
})

// ── init --dry-run ──────────────────────────────────────────────────────────

describe('javi-forge init --dry-run', () => {
  it('shows plan with all required flags (node + github)', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(
      ['init', '--dry-run', '--project-name', 'test-app', '--stack', 'node', '--ci', 'github', '--memory', 'engram'],
      sandbox
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('DRY RUN')
    expect(stdout).toContain('Dry run complete')
    expect(stdout).toContain('test-app')
    expect(stdout).toContain('No changes were made')
    expect(stdout).toContain('steps completed')
  })

  it('does not create files in cwd during dry-run', async () => {
    const sandbox = await createSandbox()
    await runCLI(
      ['init', '--dry-run', '--project-name', 'test-app', '--stack', 'node', '--ci', 'github', '--memory', 'engram'],
      sandbox
    )

    // Sandbox should still be empty — dry-run writes nothing
    const entries = await fs.readdir(sandbox)
    expect(entries).toHaveLength(0)
  })

  it('shows Python stack in output', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(
      ['init', '--dry-run', '--project-name', 'pyapp', '--stack', 'python', '--ci', 'github', '--memory', 'engram'],
      sandbox
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('python')
  })

  it('selects GitLab CI templates', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(
      ['init', '--dry-run', '--project-name', 'app', '--stack', 'node', '--ci', 'gitlab', '--memory', 'engram'],
      sandbox
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('gitlab')
  })

  it('selects Woodpecker CI templates', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(
      ['init', '--dry-run', '--project-name', 'app', '--stack', 'node', '--ci', 'woodpecker', '--memory', 'engram'],
      sandbox
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('woodpecker')
  })

  it('references obsidian-brain when selected as memory module', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(
      ['init', '--dry-run', '--project-name', 'app', '--stack', 'node', '--ci', 'github', '--memory', 'obsidian-brain'],
      sandbox
    )

    expect(exitCode).toBe(0)
    expect(stdout).toContain('obsidian-brain')
  })

  it('skips memory step when --memory none is used', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(
      ['init', '--dry-run', '--project-name', 'app', '--stack', 'node', '--ci', 'github', '--memory', 'none'],
      sandbox
    )

    expect(exitCode).toBe(0)
    // With memory=none, one more step is skipped (memory module install)
    expect(stdout).toContain('skipped')
  })

  it('shows ghagga step as done when --ghagga flag is used', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(
      ['init', '--dry-run', '--project-name', 'app', '--stack', 'node', '--ci', 'github', '--memory', 'engram', '--ghagga'],
      sandbox
    )

    expect(exitCode).toBe(0)
    // GHAGGA step should be completed (not skipped)
    expect(stdout).toContain('Install GHAGGA review system')
    expect(stdout).not.toContain('GHAGGA review system  not selected')
  })

  it('shows ghagga step as skipped without --ghagga flag', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(
      ['init', '--dry-run', '--project-name', 'app', '--stack', 'node', '--ci', 'github', '--memory', 'engram'],
      sandbox
    )

    expect(exitCode).toBe(0)
    // GHAGGA step should be skipped
    expect(stdout).toContain('GHAGGA review system')
    expect(stdout).toContain('not selected')
  })

  it('exits with code 0 even with all options', async () => {
    const sandbox = await createSandbox()
    const { exitCode } = await runCLI(
      ['init', '--dry-run', '--project-name', 'full-app', '--stack', 'go', '--ci', 'github', '--memory', 'engram', '--ghagga'],
      sandbox
    )

    expect(exitCode).toBe(0)
  })
})

// ── analyze ─────────────────────────────────────────────────────────────────

describe('javi-forge analyze', () => {
  it('analyze --dry-run completes', async () => {
    const { stdout, exitCode } = await runCLI(['analyze', '--dry-run'])

    expect(exitCode).toBe(0)
    // Should mention either analysis results or that repoforge is not found
    expect(stdout.length).toBeGreaterThan(0)
  })

  it('analyze --dry-run in empty dir shows appropriate message', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(['analyze', '--dry-run'], sandbox)

    expect(exitCode).toBe(0)
    // Output should contain something about analysis — either results or repoforge status
    const combined = stdout.toLowerCase()
    expect(
      combined.includes('analysis') ||
      combined.includes('analyze') ||
      combined.includes('repoforge') ||
      combined.includes('complete') ||
      combined.includes('dry run')
    ).toBe(true)
  })
})

// ── doctor ──────────────────────────────────────────────────────────────────

describe('javi-forge doctor', () => {
  it('runs without crashing and shows check results', async () => {
    const { stdout, exitCode } = await runCLI(['doctor'])

    expect(exitCode).toBe(0)
    // Doctor output contains status icons (✓ ok, ✗ fail, – skip)
    const hasStatusIndicators =
      stdout.includes('\u2713') || // ✓
      stdout.includes('\u2717') || // ✗
      stdout.includes('\u2013') || // –
      stdout.includes('ok') ||
      stdout.includes('fail') ||
      stdout.includes('skip')
    expect(hasStatusIndicators).toBe(true)
  })

  it('shows health score', async () => {
    const { stdout, exitCode } = await runCLI(['doctor'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Health:')
    expect(stdout).toMatch(/\d+\/\d+ checks passed/)
  })

  it('checks system tools (git, node)', async () => {
    const { stdout, exitCode } = await runCLI(['doctor'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('System Tools')
    expect(stdout).toContain('Git')
    expect(stdout).toContain('Node.js')
  })

  it('shows framework structure section', async () => {
    const { stdout, exitCode } = await runCLI(['doctor'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Framework Structure')
    expect(stdout).toContain('templates/')
    expect(stdout).toContain('modules/')
  })

  it('in empty dir shows no stack detected', async () => {
    const sandbox = await createSandbox()
    const { stdout, exitCode } = await runCLI(['doctor'], sandbox)

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Stack Detection')
    // In empty dir, no stack is recognizable
    expect(stdout).toContain('no recognizable project files')
  })

  it('shows installed modules section', async () => {
    const { stdout, exitCode } = await runCLI(['doctor'])

    expect(exitCode).toBe(0)
    expect(stdout).toContain('Installed Modules')
    expect(stdout).toContain('engram')
    expect(stdout).toContain('ghagga')
  })
})
