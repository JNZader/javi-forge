import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InitStep } from '../types/index.js'

// ── Mock plugin lib ──────────────────────────────────────────────────────────
vi.mock('../lib/plugin.js', () => ({
  installPlugin: vi.fn(),
  removePlugin: vi.fn(),
  listInstalledPlugins: vi.fn(),
  validatePlugin: vi.fn(),
  searchRegistry: vi.fn(),
}))

import { installPlugin, removePlugin, listInstalledPlugins, validatePlugin, searchRegistry } from '../lib/plugin.js'
import { runPluginAdd, runPluginRemove, runPluginList, runPluginSearch, runPluginValidate } from './plugin.js'

const mockInstall = vi.mocked(installPlugin)
const mockRemove = vi.mocked(removePlugin)
const mockList = vi.mocked(listInstalledPlugins)
const mockValidate = vi.mocked(validatePlugin)
const mockSearch = vi.mocked(searchRegistry)

beforeEach(() => vi.clearAllMocks())

function collectSteps(): { steps: InitStep[]; onStep: (s: InitStep) => void } {
  const steps: InitStep[] = []
  return { steps, onStep: (s: InitStep) => steps.push(s) }
}

// ── runPluginAdd ─────────────────────────────────────────────────────────────

describe('runPluginAdd', () => {
  it('reports success when install succeeds', async () => {
    mockInstall.mockResolvedValue({ success: true, name: 'my-plugin' })
    const { steps, onStep } = collectSteps()

    await runPluginAdd('org/repo', false, onStep)

    expect(steps).toHaveLength(2)
    expect(steps[0]!.status).toBe('running')
    expect(steps[1]!.status).toBe('done')
    expect(steps[1]!.detail).toContain('installed my-plugin')
  })

  it('reports dry-run on success', async () => {
    mockInstall.mockResolvedValue({ success: true, name: 'my-plugin' })
    const { steps, onStep } = collectSteps()

    await runPluginAdd('org/repo', true, onStep)

    expect(steps[1]!.detail).toContain('dry-run')
  })

  it('reports error when install fails', async () => {
    mockInstall.mockResolvedValue({ success: false, error: 'clone failed' })
    const { steps, onStep } = collectSteps()

    await runPluginAdd('org/repo', false, onStep)

    expect(steps[1]!.status).toBe('error')
    expect(steps[1]!.detail).toContain('clone failed')
  })
})

// ── runPluginRemove ──────────────────────────────────────────────────────────

describe('runPluginRemove', () => {
  it('reports success when removal succeeds', async () => {
    mockRemove.mockResolvedValue({ success: true })
    const { steps, onStep } = collectSteps()

    await runPluginRemove('my-plugin', false, onStep)

    expect(steps[1]!.status).toBe('done')
    expect(steps[1]!.detail).toContain('removed my-plugin')
  })

  it('reports dry-run on success', async () => {
    mockRemove.mockResolvedValue({ success: true })
    const { steps, onStep } = collectSteps()

    await runPluginRemove('my-plugin', true, onStep)

    expect(steps[1]!.detail).toContain('dry-run')
  })

  it('reports error when plugin not found', async () => {
    mockRemove.mockResolvedValue({ success: false, error: 'not installed' })
    const { steps, onStep } = collectSteps()

    await runPluginRemove('nonexistent', false, onStep)

    expect(steps[1]!.status).toBe('error')
  })
})

// ── runPluginList ────────────────────────────────────────────────────────────

describe('runPluginList', () => {
  it('reports no plugins when list is empty', async () => {
    mockList.mockResolvedValue([])
    const { steps, onStep } = collectSteps()

    await runPluginList(onStep)

    expect(steps[1]!.detail).toContain('no plugins installed')
  })

  it('reports count and names when plugins exist', async () => {
    mockList.mockResolvedValue([
      { name: 'alpha', version: '1.0.0', installedAt: '', source: '', manifest: { name: 'alpha', version: '1.0.0', description: 'test test test' } },
      { name: 'beta', version: '2.0.0', installedAt: '', source: '', manifest: { name: 'beta', version: '2.0.0', description: 'test test test' } },
    ])
    const { steps, onStep } = collectSteps()

    await runPluginList(onStep)

    expect(steps[1]!.detail).toContain('2 plugins')
    expect(steps[1]!.detail).toContain('alpha@1.0.0')
    expect(steps[1]!.detail).toContain('beta@2.0.0')
  })
})

// ── runPluginSearch ──────────────────────────────────────────────────────────

describe('runPluginSearch', () => {
  it('reports empty results', async () => {
    mockSearch.mockResolvedValue([])
    const { steps, onStep } = collectSteps()

    await runPluginSearch('test', onStep)

    expect(steps[1]!.detail).toContain('no plugins matching')
  })

  it('reports search results with count', async () => {
    mockSearch.mockResolvedValue([
      { id: 'org/plugin', repository: 'https://github.com/org/plugin', description: 'A plugin', tags: [] },
    ])
    const { steps, onStep } = collectSteps()

    await runPluginSearch('plugin', onStep)

    expect(steps[1]!.detail).toContain('1 results')
    expect(steps[1]!.detail).toContain('org/plugin')
  })

  it('reports registry unreachable when no query and no results', async () => {
    mockSearch.mockResolvedValue([])
    const { steps, onStep } = collectSteps()

    await runPluginSearch(undefined, onStep)

    expect(steps[1]!.detail).toContain('registry empty or unreachable')
  })
})

// ── runPluginValidate ────────────────────────────────────────────────────────

describe('runPluginValidate', () => {
  it('reports valid plugin', async () => {
    mockValidate.mockResolvedValue({
      valid: true,
      errors: [],
      manifest: { name: 'my-plugin', version: '1.0.0', description: 'A valid plugin desc' },
    })
    const { steps, onStep } = collectSteps()

    await runPluginValidate('/path/to/plugin', onStep)

    expect(steps[1]!.status).toBe('done')
    expect(steps[1]!.detail).toContain('valid')
    expect(steps[1]!.detail).toContain('my-plugin@1.0.0')
  })

  it('reports validation errors', async () => {
    mockValidate.mockResolvedValue({
      valid: false,
      errors: [{ path: 'name', message: 'name is required' }],
      manifest: null,
    })
    const { steps, onStep } = collectSteps()

    await runPluginValidate('/path/to/plugin', onStep)

    expect(steps[1]!.status).toBe('error')
    expect(steps[1]!.detail).toContain('1 errors')
    expect(steps[1]!.detail).toContain('name is required')
  })
})
