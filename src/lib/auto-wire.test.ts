import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { InstalledPlugin, PluginManifest } from '../types/index.js'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
    ensureDir: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

import fs from 'fs-extra'
import { autoWirePlugins, buildAutoWireSection, removeAutoWireSection } from './auto-wire.js'

const mockFs = vi.mocked(fs)

beforeEach(() => vi.clearAllMocks())

// ── Helpers ─────────────────────────────────────────────────────────────────

function makePlugin(overrides: Partial<PluginManifest> = {}): InstalledPlugin {
  const manifest: PluginManifest = {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin for testing purposes',
    skills: [],
    commands: [],
    hooks: [],
    agents: [],
    ...overrides,
  }
  return {
    name: manifest.name,
    version: manifest.version,
    installedAt: '2026-01-01T00:00:00.000Z',
    source: 'org/repo',
    manifest,
  }
}

// ── removeAutoWireSection ───────────────────────────────────────────────────

describe('removeAutoWireSection', () => {
  it('returns content unchanged when no auto-wire section exists', () => {
    const content = '# My Project\n\n## Stack\n- node\n'
    expect(removeAutoWireSection(content)).toBe(content)
  })

  it('removes auto-wire section between markers', () => {
    const content = [
      '# My Project',
      '',
      '## Stack',
      '',
      '<!-- javi-forge:auto-wire:start -->',
      '',
      '## Plugins (auto-wired)',
      '',
      '### test-plugin v1.0.0',
      '',
      '<!-- javi-forge:auto-wire:end -->',
      '',
      '## Conventions',
    ].join('\n')

    const result = removeAutoWireSection(content)
    expect(result).toContain('# My Project')
    expect(result).toContain('## Conventions')
    expect(result).not.toContain('auto-wire')
    expect(result).not.toContain('test-plugin')
  })

  it('handles section at end of file', () => {
    const content = [
      '# My Project',
      '',
      '<!-- javi-forge:auto-wire:start -->',
      '## Plugins',
      '<!-- javi-forge:auto-wire:end -->',
    ].join('\n')

    const result = removeAutoWireSection(content)
    expect(result).toBe('# My Project\n')
    expect(result).not.toContain('auto-wire')
  })

  it('returns content unchanged when only start marker exists (malformed)', () => {
    const content = '# Project\n<!-- javi-forge:auto-wire:start -->\nstuff'
    expect(removeAutoWireSection(content)).toBe(content)
  })
})

// ── buildAutoWireSection ────────────────────────────────────────────────────

describe('buildAutoWireSection', () => {
  it('produces section with start/end markers', () => {
    const plugins = [makePlugin({ name: 'my-plugin', version: '2.0.0', description: 'Does cool things for devs' })]
    const result = buildAutoWireSection(plugins)

    expect(result).toContain('<!-- javi-forge:auto-wire:start -->')
    expect(result).toContain('<!-- javi-forge:auto-wire:end -->')
  })

  it('includes plugin name, version, and description', () => {
    const plugins = [makePlugin({ name: 'security-scanner', version: '3.1.0', description: 'Scans for vulnerabilities in code' })]
    const result = buildAutoWireSection(plugins)

    expect(result).toContain('### security-scanner v3.1.0')
    expect(result).toContain('> Scans for vulnerabilities in code')
  })

  it('includes skill loader lines', () => {
    const plugins = [makePlugin({ name: 'react-tools', skills: ['react-pro', 'hooks-linter'] })]
    const result = buildAutoWireSection(plugins)

    expect(result).toContain('~/.claude/plugins/react-tools/skills/react-pro/SKILL.md')
    expect(result).toContain('~/.claude/plugins/react-tools/skills/hooks-linter/SKILL.md')
  })

  it('includes command entries', () => {
    const plugins = [makePlugin({ name: 'my-tools', commands: ['lint', 'format'] })]
    const result = buildAutoWireSection(plugins)

    expect(result).toContain('**Commands:**')
    expect(result).toContain('`/lint`')
    expect(result).toContain('`/format`')
  })

  it('includes agent entries', () => {
    const plugins = [makePlugin({ name: 'ai-helpers', agents: ['code-reviewer', 'test-writer'] })]
    const result = buildAutoWireSection(plugins)

    expect(result).toContain('**Agents:**')
    expect(result).toContain('- code-reviewer')
    expect(result).toContain('- test-writer')
  })

  it('handles plugin with no capabilities', () => {
    const plugins = [makePlugin({ name: 'empty-plugin' })]
    const result = buildAutoWireSection(plugins)

    expect(result).toContain('### empty-plugin v1.0.0')
    expect(result).not.toContain('**Commands:**')
    expect(result).not.toContain('**Agents:**')
  })

  it('handles multiple plugins', () => {
    const plugins = [
      makePlugin({ name: 'alpha', skills: ['skill-a'] }),
      makePlugin({ name: 'beta', commands: ['cmd-b'] }),
    ]
    const result = buildAutoWireSection(plugins)

    expect(result).toContain('### alpha v1.0.0')
    expect(result).toContain('### beta v1.0.0')
  })
})

// ── autoWirePlugins ─────────────────────────────────────────────────────────

describe('autoWirePlugins', () => {
  it('wires skills into CLAUDE.md', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)
    mockFs.ensureDir.mockResolvedValue(undefined as never)
    mockFs.writeFile.mockResolvedValue(undefined as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const plugins = [makePlugin({ name: 'react-tools', skills: ['react-pro'] })]
    const result = await autoWirePlugins('/fake/project', plugins)

    expect(result.wired.length).toBeGreaterThan(0)
    expect(result.wired.some(w => w.capability === 'skill' && w.value === 'react-pro')).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(mockFs.writeFile).toHaveBeenCalled()
  })

  it('wires hooks into settings.json', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)
    mockFs.ensureDir.mockResolvedValue(undefined as never)
    mockFs.writeFile.mockResolvedValue(undefined as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const plugins = [makePlugin({ name: 'hooks-plugin', hooks: ['pre-commit-check'] })]
    const result = await autoWirePlugins('/fake/project', plugins)

    expect(result.wired.some(w => w.capability === 'hook' && w.value === 'pre-commit-check')).toBe(true)
    expect(mockFs.writeJson).toHaveBeenCalled()
  })

  it('is idempotent — replaces existing auto-wire section in CLAUDE.md', async () => {
    const existingContent = [
      '# My Project',
      '',
      '<!-- javi-forge:auto-wire:start -->',
      '## Plugins (auto-wired)',
      '### old-plugin v0.1.0',
      '<!-- javi-forge:auto-wire:end -->',
    ].join('\n')

    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('CLAUDE.md')) return true as never
      return false as never
    })
    mockFs.readFile.mockResolvedValue(existingContent as never)
    mockFs.ensureDir.mockResolvedValue(undefined as never)
    mockFs.writeFile.mockResolvedValue(undefined as never)

    const plugins = [makePlugin({ name: 'new-plugin', skills: ['new-skill'] })]
    const result = await autoWirePlugins('/fake/project', plugins)

    expect(result.wired.some(w => w.value === 'new-skill')).toBe(true)

    // Verify the written content doesn't have old plugin
    const writtenContent = mockFs.writeFile.mock.calls[0]?.[1] as string
    expect(writtenContent).not.toContain('old-plugin')
    expect(writtenContent).toContain('new-plugin')
    expect(writtenContent).toContain('# My Project')
  })

  it('does not write in dry-run mode', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)

    const plugins = [makePlugin({ name: 'react-tools', skills: ['react-pro'] })]
    const result = await autoWirePlugins('/fake/project', plugins, { dryRun: true })

    expect(result.wired.length).toBeGreaterThan(0)
    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(mockFs.writeJson).not.toHaveBeenCalled()
  })

  it('returns empty wired/unwired when no plugins have capabilities', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)

    const plugins = [makePlugin({ name: 'bare-plugin', skills: [], commands: [], hooks: [], agents: [] })]
    const result = await autoWirePlugins('/fake/project', plugins)

    expect(result.wired).toHaveLength(0)
    expect(result.unwired).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it('returns empty results for empty plugin list', async () => {
    const result = await autoWirePlugins('/fake/project', [])

    expect(result.wired).toHaveLength(0)
    expect(result.unwired).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it('captures errors without crashing', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('CLAUDE.md')) throw new Error('disk exploded')
      return false as never
    })
    mockFs.ensureDir.mockResolvedValue(undefined as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const plugins = [makePlugin({ name: 'test-plugin', skills: ['skill-a'] })]
    const result = await autoWirePlugins('/fake/project', plugins)

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0]).toContain('CLAUDE.md wiring failed')
  })

  it('wires commands and agents into CLAUDE.md', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)
    mockFs.ensureDir.mockResolvedValue(undefined as never)
    mockFs.writeFile.mockResolvedValue(undefined as never)

    const plugins = [makePlugin({
      name: 'full-plugin',
      skills: ['skill-x'],
      commands: ['cmd-y'],
      agents: ['agent-z'],
    })]
    const result = await autoWirePlugins('/fake/project', plugins)

    expect(result.wired.some(w => w.capability === 'skill' && w.value === 'skill-x')).toBe(true)
    expect(result.wired.some(w => w.capability === 'command' && w.value === 'cmd-y')).toBe(true)
    expect(result.wired.some(w => w.capability === 'agent' && w.value === 'agent-z')).toBe(true)
  })

  it('skips already-wired hooks in settings.json (idempotent)', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('settings.json')) return true as never
      return false as never
    })
    mockFs.readJson.mockResolvedValue({
      hooks: { 'plugin-hooks': ['existing-hook'] },
    } as never)
    mockFs.ensureDir.mockResolvedValue(undefined as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const plugins = [makePlugin({ name: 'hook-plugin', hooks: ['existing-hook'] })]
    const result = await autoWirePlugins('/fake/project', plugins)

    // Hook already existed — should NOT appear in wired
    expect(result.wired.filter(w => w.capability === 'hook')).toHaveLength(0)
  })
})
