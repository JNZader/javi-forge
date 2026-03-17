import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InitStep } from '../types/index.js'

vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readJson: vi.fn(),
    writeFile: vi.fn(),
    ensureDir: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

vi.mock('glob', () => ({
  glob: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/common.js', () => ({
  detectStack: vi.fn().mockResolvedValue({ stackType: 'node', buildTool: 'pnpm' }),
  backupIfExists: vi.fn(),
  ensureDirExists: vi.fn(),
}))

import fs from 'fs-extra'
import { glob } from 'glob'
import { generateLlmsTxt } from './llmstxt.js'

const mockFs = vi.mocked(fs)
const mockGlob = vi.mocked(glob)

function collectSteps(): { steps: InitStep[]; onStep: (s: InitStep) => void } {
  const steps: InitStep[] = []
  return { steps, onStep: (s: InitStep) => steps.push(s) }
}

beforeEach(() => vi.clearAllMocks())

describe('generateLlmsTxt', () => {
  it('scans project and generates llms.txt', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockResolvedValue({ name: 'my-app', description: 'A test app', version: '1.0.0', dependencies: { express: '4.18' } } as never)
    mockGlob.mockResolvedValue(['src/index.ts', 'src/lib/utils.ts'] as never)

    const { steps, onStep } = collectSteps()
    await generateLlmsTxt('/test/project', false, onStep)

    expect(steps.some(s => s.id === 'generate' && s.status === 'done')).toBe(true)
    expect(mockFs.writeFile).toHaveBeenCalled()
  })

  it('works in dry-run mode', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)
    mockGlob.mockResolvedValue([] as never)

    const { steps, onStep } = collectSteps()
    await generateLlmsTxt('/test/project', true, onStep)

    expect(steps.some(s => s.detail?.includes('dry-run'))).toBe(true)
    expect(mockFs.writeFile).not.toHaveBeenCalled()
  })

  it('handles project with no package.json', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)
    mockGlob.mockResolvedValue(['main.go', 'handler.go'] as never)

    const { steps, onStep } = collectSteps()
    await generateLlmsTxt('/test/project', false, onStep)

    expect(steps.some(s => s.id === 'generate' && s.status === 'done')).toBe(true)
  })
})
