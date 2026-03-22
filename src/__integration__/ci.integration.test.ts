import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs-extra'
import path from 'path'
import { runCI } from '../commands/ci.js'
import { createTempDir, cleanupTempDir, collectSteps } from './helpers.js'

let tmpDir: string

describe('runCI() — integration', () => {
  beforeEach(async () => {
    tmpDir = await createTempDir()
    // Create a minimal node project so stack detection works
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      name: 'test-ci',
      version: '1.0.0',
    })
  })

  afterEach(async () => {
    await cleanupTempDir(tmpDir)
  })

  it('noDocker=true: skips Docker check entirely', async () => {
    const { steps, onStep } = collectSteps()

    // This should NOT throw even if Docker is not available
    await runCI({
      projectDir: tmpDir,
      mode: 'quick',
      noDocker: true,
      noGhagga: true,
      noSecurity: true,
    }, onStep)

    // Should detect stack
    const detectStep = steps.find(s => s.id === 'detect')
    expect(detectStep?.status).toBe('done')

    // Should NOT have a docker-check step
    const dockerStep = steps.find(s => s.id === 'docker-check')
    expect(dockerStep).toBeUndefined()
  })

  it('detect mode: returns stack info without running pipeline', async () => {
    const { steps, onStep } = collectSteps()

    await runCI({
      projectDir: tmpDir,
      mode: 'detect',
      noDocker: true,
    }, onStep)

    const detectStep = steps.find(s => s.id === 'detect')
    expect(detectStep?.status).toBe('done')
    // Stack info is in the label, not detail
    expect(detectStep?.label).toContain('node')

    // Only detect step should run in detect mode
    expect(steps.length).toBe(1)
  })

  it('detect mode with python project', async () => {
    // Replace package.json with Python markers
    await fs.remove(path.join(tmpDir, 'package.json'))
    await fs.writeFile(path.join(tmpDir, 'requirements.txt'), 'flask==3.0\n')

    const { steps, onStep } = collectSteps()

    await runCI({
      projectDir: tmpDir,
      mode: 'detect',
      noDocker: true,
    }, onStep)

    const detectStep = steps.find(s => s.id === 'detect')
    expect(detectStep?.label).toContain('python')
  })
})
