import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs-extra'
import path from 'path'
import { execFileSync } from 'child_process'
import { installCIHooks } from '../commands/ci.js'
import { createTempDir, cleanupTempDir, readGenerated, fileExists, getFileMode } from './helpers.js'

let tmpDir: string

describe('installCIHooks() — integration', () => {
  beforeEach(async () => {
    tmpDir = await createTempDir('ci-init-test-')
    // Init a real git repo
    execFileSync('git', ['init'], { cwd: tmpDir })
  })

  afterEach(async () => {
    await cleanupTempDir(tmpDir)
  })

  it('creates pre-commit, pre-push, and commit-msg hooks', async () => {
    const { installed, errors } = await installCIHooks(tmpDir)

    expect(errors).toHaveLength(0)
    expect(installed).toContain('pre-commit')
    expect(installed).toContain('pre-push')
    expect(installed).toContain('commit-msg')

    expect(await fileExists(tmpDir, '.git', 'hooks', 'pre-commit')).toBe(true)
    expect(await fileExists(tmpDir, '.git', 'hooks', 'pre-push')).toBe(true)
    expect(await fileExists(tmpDir, '.git', 'hooks', 'commit-msg')).toBe(true)
  })

  it('hooks are executable (755)', async () => {
    await installCIHooks(tmpDir)

    for (const hook of ['pre-commit', 'pre-push', 'commit-msg']) {
      const mode = await getFileMode(tmpDir, '.git', 'hooks', hook)
      expect(mode & 0o111).toBeGreaterThan(0)
    }
  })

  it('hooks have shebang', async () => {
    await installCIHooks(tmpDir)

    for (const hook of ['pre-commit', 'pre-push', 'commit-msg']) {
      const content = await readGenerated(tmpDir, '.git', 'hooks', hook)
      expect(content.startsWith('#!/bin/bash')).toBe(true)
    }
  })

  it('pre-commit uses javi-forge ci with npx fallback', async () => {
    await installCIHooks(tmpDir)

    const content = await readGenerated(tmpDir, '.git', 'hooks', 'pre-commit')
    expect(content).toContain('command -v javi-forge')
    expect(content).toContain('npx javi-forge ci')
    expect(content).toContain('--quick')
    expect(content).toContain('--no-docker')
  })

  it('pre-push checks Docker before running', async () => {
    await installCIHooks(tmpDir)

    const content = await readGenerated(tmpDir, '.git', 'hooks', 'pre-push')
    expect(content).toContain('docker info')
    expect(content).toContain('javi-forge ci')
    expect(content).toContain('npx javi-forge ci')
  })

  it('commit-msg blocks AI attribution patterns', async () => {
    await installCIHooks(tmpDir)

    const content = await readGenerated(tmpDir, '.git', 'hooks', 'commit-msg')
    expect(content).toContain('co-authored-by:.*claude')
    expect(content).toContain('AI Attribution Detected')
    expect(content).toContain('COMMIT_MSG_FILE')
  })

  it('overwrites existing hooks', async () => {
    // Create a pre-existing hook
    const hooksDir = path.join(tmpDir, '.git', 'hooks')
    await fs.ensureDir(hooksDir)
    await fs.writeFile(path.join(hooksDir, 'pre-commit'), '#!/bin/bash\necho old')

    const { installed, errors } = await installCIHooks(tmpDir)
    expect(errors).toHaveLength(0)
    expect(installed).toContain('pre-commit')

    const content = await readGenerated(tmpDir, '.git', 'hooks', 'pre-commit')
    expect(content).not.toContain('echo old')
    expect(content).toContain('javi-forge ci')
  })

  it('fails on non-git directory', async () => {
    const nonGit = await createTempDir('non-git-')

    const { installed, errors } = await installCIHooks(nonGit)
    expect(installed).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Not a git repository')

    await cleanupTempDir(nonGit)
  })

  it('idempotent — second run produces same result', async () => {
    await installCIHooks(tmpDir)
    const first = await readGenerated(tmpDir, '.git', 'hooks', 'pre-commit')

    await installCIHooks(tmpDir)
    const second = await readGenerated(tmpDir, '.git', 'hooks', 'pre-commit')

    expect(first).toBe(second)
  })
})
