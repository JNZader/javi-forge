import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PluginManifest, AgentSkillsManifest, InstalledPlugin } from '../types/index.js'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readJson: vi.fn(),
    writeJson: vi.fn(),
    readdir: vi.fn(),
    ensureDir: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    copy: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

import fs from 'fs-extra'
import {
  pluginToAgentSkills,
  agentSkillsToPlugin,
  generateAgentSkillsManifest,
  exportPluginAsAgentSkills,
  importAgentSkillsPackage,
  aggregatePluginsToSkillsJson,
  generateProjectSkillsJson,
  generateGlobalSkillsJson,
} from './agent-skills.js'

const mockFs = vi.mocked(fs)

beforeEach(() => vi.clearAllMocks())

// ── pluginToAgentSkills ─────────────────────────────────────────────────────

describe('pluginToAgentSkills', () => {
  const pluginManifest: PluginManifest = {
    name: 'my-plugin',
    version: '1.0.0',
    description: 'A test plugin for conversion',
    skills: ['react-pro', 'testing-utils'],
    tags: ['frontend'],
  }

  it('converts name, version, description', () => {
    const result = pluginToAgentSkills(pluginManifest)
    expect(result.name).toBe('my-plugin')
    expect(result.version).toBe('1.0.0')
    expect(result.description).toBe('A test plugin for conversion')
  })

  it('maps skills array to AgentSkillEntry objects', () => {
    const result = pluginToAgentSkills(pluginManifest)
    expect(result.skills).toHaveLength(2)
    expect(result.skills[0]).toEqual({
      name: 'react-pro',
      description: 'react-pro skill from my-plugin',
      path: 'skills/react-pro',
    })
    expect(result.skills[1]).toEqual({
      name: 'testing-utils',
      description: 'testing-utils skill from my-plugin',
      path: 'skills/testing-utils',
    })
  })

  it('handles plugin with no skills', () => {
    const noSkills: PluginManifest = { ...pluginManifest, skills: undefined }
    const result = pluginToAgentSkills(noSkills)
    expect(result.skills).toEqual([])
  })

  it('includes forge_source in metadata when source is provided', () => {
    const result = pluginToAgentSkills(pluginManifest, 'org/repo')
    expect(result.metadata).toEqual({ forge_source: 'org/repo' })
  })

  it('omits metadata when no source is provided', () => {
    const result = pluginToAgentSkills(pluginManifest)
    expect(result.metadata).toBeUndefined()
  })
})

// ── agentSkillsToPlugin ─────────────────────────────────────────────────────

describe('agentSkillsToPlugin', () => {
  const agentManifest: AgentSkillsManifest = {
    name: 'cool-skill',
    version: '2.0.0',
    description: 'An agent skills package for testing',
    skills: [
      { name: 'alpha', description: 'Alpha skill', path: 'skills/alpha' },
      { name: 'beta', description: 'Beta skill', path: 'skills/beta' },
    ],
  }

  it('converts name, version, description', () => {
    const result = agentSkillsToPlugin(agentManifest)
    expect(result.name).toBe('cool-skill')
    expect(result.version).toBe('2.0.0')
    expect(result.description).toBe('An agent skills package for testing')
  })

  it('extracts skill names into skills array', () => {
    const result = agentSkillsToPlugin(agentManifest)
    expect(result.skills).toEqual(['alpha', 'beta'])
  })

  it('adds agent-skills-import tag', () => {
    const result = agentSkillsToPlugin(agentManifest)
    expect(result.tags).toEqual(['agent-skills-import'])
  })
})

// ── Round-trip conversion ───────────────────────────────────────────────────

describe('round-trip conversion', () => {
  it('preserves core fields through plugin → agent-skills → plugin', () => {
    const original: PluginManifest = {
      name: 'my-plugin',
      version: '1.0.0',
      description: 'A test plugin for round-trip',
      skills: ['skill-a', 'skill-b'],
    }

    const agentSkills = pluginToAgentSkills(original)
    const backToPlugin = agentSkillsToPlugin(agentSkills)

    expect(backToPlugin.name).toBe(original.name)
    expect(backToPlugin.version).toBe(original.version)
    expect(backToPlugin.description).toBe(original.description)
    expect(backToPlugin.skills).toEqual(original.skills)
  })
})

// ── generateAgentSkillsManifest ─────────────────────────────────────────────

describe('generateAgentSkillsManifest', () => {
  it('returns error when plugin.json not found', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)

    const result = await generateAgentSkillsManifest('/fake/plugin')
    expect(result.success).toBe(false)
    expect(result.error).toBe('plugin.json not found')
  })

  it('returns error when plugin.json is invalid', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockRejectedValue(new Error('parse error') as never)

    const result = await generateAgentSkillsManifest('/fake/plugin')
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid plugin.json')
  })

  it('writes skills.json on success', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockResolvedValue({
      name: 'my-plugin',
      version: '1.0.0',
      description: 'A valid plugin description',
      skills: ['skill-a'],
    } as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const result = await generateAgentSkillsManifest('/fake/plugin', 'org/repo')
    expect(result.success).toBe(true)
    expect(result.path).toContain('skills.json')
    expect(mockFs.writeJson).toHaveBeenCalledWith(
      expect.stringContaining('skills.json'),
      expect.objectContaining({
        name: 'my-plugin',
        version: '1.0.0',
        skills: [{ name: 'skill-a', description: 'skill-a skill from my-plugin', path: 'skills/skill-a' }],
        metadata: { forge_source: 'org/repo' },
      }),
      { spaces: 2 }
    )
  })
})

// ── exportPluginAsAgentSkills ───────────────────────────────────────────────

describe('exportPluginAsAgentSkills', () => {
  it('returns error when plugin is not installed', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)

    const result = await exportPluginAsAgentSkills('ghost')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not installed')
  })

  it('generates skills.json for installed plugin', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockResolvedValue({
      name: 'my-plugin',
      version: '1.0.0',
      description: 'A valid plugin description',
      skills: [],
    } as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const result = await exportPluginAsAgentSkills('my-plugin')
    expect(result.success).toBe(true)
    expect(result.path).toContain('skills.json')
  })
})

// ── importAgentSkillsPackage ────────────────────────────────────────────────

describe('importAgentSkillsPackage', () => {
  it('returns error when skills.json not found', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)

    const result = await importAgentSkillsPackage('/fake/source')
    expect(result.success).toBe(false)
    expect(result.error).toBe('skills.json not found')
  })

  it('returns error when skills.json is invalid JSON', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockRejectedValue(new Error('parse error') as never)

    const result = await importAgentSkillsPackage('/fake/source')
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid skills.json')
  })

  it('returns error when skills.json missing required fields', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockResolvedValue({ name: 'only-name' } as never)

    const result = await importAgentSkillsPackage('/fake/source')
    expect(result.success).toBe(false)
    expect(result.error).toContain('missing required fields')
  })

  it('succeeds with dry-run without writing files', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockResolvedValue({
      name: 'imported-skill',
      version: '1.0.0',
      description: 'An imported agent skills package',
      skills: [{ name: 'alpha', description: 'Alpha', path: 'skills/alpha' }],
    } as never)

    const result = await importAgentSkillsPackage('/fake/source', { dryRun: true })
    expect(result.success).toBe(true)
    expect(result.name).toBe('imported-skill')
    expect(mockFs.copy).not.toHaveBeenCalled()
    expect(mockFs.writeJson).not.toHaveBeenCalled()
  })

  it('copies directory and creates plugin.json + .installed.json', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      // skills.json exists, dest dir does not
      if (typeof p === 'string' && p.includes('skills.json')) return true as never
      return false as never
    })
    mockFs.readJson.mockResolvedValue({
      name: 'imported-skill',
      version: '1.0.0',
      description: 'An imported agent skills package',
      skills: [{ name: 'alpha', description: 'Alpha', path: 'skills/alpha' }],
    } as never)
    mockFs.copy.mockResolvedValue(undefined as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const result = await importAgentSkillsPackage('/fake/source')
    expect(result.success).toBe(true)
    expect(result.name).toBe('imported-skill')
    expect(mockFs.copy).toHaveBeenCalled()
    // Should write plugin.json and .installed.json
    expect(mockFs.writeJson).toHaveBeenCalledTimes(2)
  })

  it('removes existing plugin dir before importing', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockResolvedValue({
      name: 'imported-skill',
      version: '1.0.0',
      description: 'An imported agent skills package',
      skills: [],
    } as never)
    mockFs.remove.mockResolvedValue(undefined as never)
    mockFs.copy.mockResolvedValue(undefined as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const result = await importAgentSkillsPackage('/fake/source')
    expect(result.success).toBe(true)
    expect(mockFs.remove).toHaveBeenCalled()
  })
})

// ── aggregatePluginsToSkillsJson ──────────────────────────────────────────

describe('aggregatePluginsToSkillsJson', () => {
  const makePlugin = (name: string, skills: string[] = [], repo?: string): InstalledPlugin => ({
    name,
    version: '1.0.0',
    installedAt: '2026-01-01T00:00:00.000Z',
    source: `org/${name}`,
    manifest: {
      name,
      version: '1.0.0',
      description: `${name} plugin description`,
      skills,
      ...(repo ? { repository: repo } : {}),
    },
  })

  it('aggregates skills from multiple plugins into a single manifest', () => {
    const plugins = [
      makePlugin('alpha', ['react-pro', 'testing-utils']),
      makePlugin('beta', ['deploy-helper']),
    ]

    const result = aggregatePluginsToSkillsJson(plugins)

    expect(result.name).toBe('javi-forge-registry')
    expect(result.version).toBe('1.0.0')
    expect(result.skills).toHaveLength(3)
    expect(result.sources).toHaveLength(2)
  })

  it('namespaces skills with plugin name', () => {
    const plugins = [makePlugin('alpha', ['my-skill'])]
    const result = aggregatePluginsToSkillsJson(plugins)

    expect(result.skills[0]).toEqual({
      name: 'alpha/my-skill',
      description: 'my-skill skill from alpha plugin',
      path: 'plugins/alpha/skills/my-skill',
    })
  })

  it('uses custom registry name and version', () => {
    const result = aggregatePluginsToSkillsJson([], 'my-project', '2.0.0')
    expect(result.name).toBe('my-project')
    expect(result.version).toBe('2.0.0')
  })

  it('includes repository in sources when available', () => {
    const plugins = [makePlugin('alpha', [], 'https://github.com/org/alpha')]
    const result = aggregatePluginsToSkillsJson(plugins)

    expect(result.sources[0]).toEqual({
      plugin: 'alpha',
      version: '1.0.0',
      repository: 'https://github.com/org/alpha',
    })
  })

  it('omits repository from sources when not available', () => {
    const plugins = [makePlugin('alpha', [])]
    const result = aggregatePluginsToSkillsJson(plugins)

    expect(result.sources[0]).toEqual({
      plugin: 'alpha',
      version: '1.0.0',
    })
  })

  it('handles plugins with no manifest gracefully', () => {
    const plugins: InstalledPlugin[] = [{
      name: 'broken',
      version: '1.0.0',
      installedAt: '',
      source: '',
      manifest: undefined as unknown as PluginManifest,
    }]

    const result = aggregatePluginsToSkillsJson(plugins)
    expect(result.skills).toHaveLength(0)
    expect(result.sources).toHaveLength(0)
  })

  it('handles plugins with no skills array', () => {
    const plugins: InstalledPlugin[] = [{
      name: 'no-skills',
      version: '1.0.0',
      installedAt: '',
      source: '',
      manifest: { name: 'no-skills', version: '1.0.0', description: 'Has no skills defined' },
    }]

    const result = aggregatePluginsToSkillsJson(plugins)
    expect(result.skills).toHaveLength(0)
    expect(result.sources).toHaveLength(1)
  })

  it('returns correct description with plugin count', () => {
    const plugins = [
      makePlugin('a', ['s1']),
      makePlugin('b', ['s2']),
      makePlugin('c', ['s3']),
    ]
    const result = aggregatePluginsToSkillsJson(plugins)
    expect(result.description).toBe('Aggregated skills from 3 javi-forge plugin(s)')
  })
})

// ── generateProjectSkillsJson ─────────────────────────────────────────────

describe('generateProjectSkillsJson', () => {
  it('returns error when plugins directory does not exist', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)

    const result = await generateProjectSkillsJson('/fake/project')
    expect(result.success).toBe(false)
    expect(result.error).toBe('no plugins directory found')
    expect(result.skillCount).toBe(0)
    expect(result.pluginCount).toBe(0)
  })

  it('returns error when no installed plugins found', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('.installed.json')) return false as never
      return true as never
    })
    mockFs.readdir.mockResolvedValue(['empty-dir'] as never)

    const result = await generateProjectSkillsJson('/fake/project')
    expect(result.success).toBe(false)
    expect(result.error).toBe('no installed plugins found')
  })

  it('generates skills.json from installed plugins', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('.installed.json')) return true as never
      return true as never
    })
    mockFs.readdir.mockResolvedValue(['alpha', 'beta'] as never)
    mockFs.readJson.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('alpha')) {
        return { name: 'alpha', version: '1.0.0', manifest: { name: 'alpha', version: '1.0.0', description: 'Alpha test', skills: ['skill-a'] } } as never
      }
      if (typeof p === 'string' && p.includes('beta')) {
        return { name: 'beta', version: '2.0.0', manifest: { name: 'beta', version: '2.0.0', description: 'Beta test', skills: ['skill-b', 'skill-c'] } } as never
      }
      return {} as never
    })
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const result = await generateProjectSkillsJson('/fake/project')
    expect(result.success).toBe(true)
    expect(result.skillCount).toBe(3)
    expect(result.pluginCount).toBe(2)
    expect(result.path).toContain('skills.json')
    expect(mockFs.writeJson).toHaveBeenCalledWith(
      expect.stringContaining('skills.json'),
      expect.objectContaining({
        skills: expect.arrayContaining([
          expect.objectContaining({ name: 'alpha/skill-a' }),
          expect.objectContaining({ name: 'beta/skill-b' }),
          expect.objectContaining({ name: 'beta/skill-c' }),
        ]),
        sources: expect.arrayContaining([
          expect.objectContaining({ plugin: 'alpha' }),
          expect.objectContaining({ plugin: 'beta' }),
        ]),
      }),
      { spaces: 2 }
    )
  })

  it('does not write file in dry-run mode', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('.installed.json')) return true as never
      return true as never
    })
    mockFs.readdir.mockResolvedValue(['alpha'] as never)
    mockFs.readJson.mockResolvedValue({
      name: 'alpha', version: '1.0.0',
      manifest: { name: 'alpha', version: '1.0.0', description: 'Alpha test', skills: ['s1'] },
    } as never)

    const result = await generateProjectSkillsJson('/fake/project', { dryRun: true })
    expect(result.success).toBe(true)
    expect(result.skillCount).toBe(1)
    expect(mockFs.writeJson).not.toHaveBeenCalled()
  })

  it('uses custom registry name', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('.installed.json')) return true as never
      return true as never
    })
    mockFs.readdir.mockResolvedValue(['alpha'] as never)
    mockFs.readJson.mockResolvedValue({
      name: 'alpha', version: '1.0.0',
      manifest: { name: 'alpha', version: '1.0.0', description: 'Alpha test', skills: [] },
    } as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const result = await generateProjectSkillsJson('/fake/project', { registryName: 'my-custom-registry' })
    expect(result.success).toBe(true)
    expect(mockFs.writeJson).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'my-custom-registry' }),
      { spaces: 2 }
    )
  })

  it('skips dot-prefixed directories', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readdir.mockResolvedValue(['.tmp', '.git'] as never)

    const result = await generateProjectSkillsJson('/fake/project')
    expect(result.success).toBe(false)
    expect(result.error).toBe('no installed plugins found')
  })

  it('skips corrupt .installed.json entries', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('.installed.json')) return true as never
      return true as never
    })
    mockFs.readdir.mockResolvedValue(['corrupt'] as never)
    mockFs.readJson.mockRejectedValue(new Error('parse error') as never)

    const result = await generateProjectSkillsJson('/fake/project')
    expect(result.success).toBe(false)
    expect(result.error).toBe('no installed plugins found')
  })
})

// ── generateGlobalSkillsJson ──────────────────────────────────────────────

describe('generateGlobalSkillsJson', () => {
  it('returns error when plugins directory does not exist', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)

    const result = await generateGlobalSkillsJson()
    expect(result.success).toBe(false)
    expect(result.error).toBe('no plugins directory found')
  })

  it('returns error when no plugins found', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('.installed.json')) return false as never
      return true as never
    })
    mockFs.readdir.mockResolvedValue(['empty'] as never)

    const result = await generateGlobalSkillsJson()
    expect(result.success).toBe(false)
    expect(result.error).toBe('no installed plugins found')
  })

  it('generates global skills.json', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('.installed.json')) return true as never
      return true as never
    })
    mockFs.readdir.mockResolvedValue(['my-plugin'] as never)
    mockFs.readJson.mockResolvedValue({
      name: 'my-plugin', version: '1.0.0',
      manifest: { name: 'my-plugin', version: '1.0.0', description: 'My plugin test', skills: ['sk1', 'sk2'] },
    } as never)
    mockFs.writeJson.mockResolvedValue(undefined as never)

    const result = await generateGlobalSkillsJson()
    expect(result.success).toBe(true)
    expect(result.skillCount).toBe(2)
    expect(result.pluginCount).toBe(1)
    expect(result.path).toContain('skills.json')
  })

  it('does not write file in dry-run mode', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('.installed.json')) return true as never
      return true as never
    })
    mockFs.readdir.mockResolvedValue(['my-plugin'] as never)
    mockFs.readJson.mockResolvedValue({
      name: 'my-plugin', version: '1.0.0',
      manifest: { name: 'my-plugin', version: '1.0.0', description: 'My plugin test', skills: ['sk1'] },
    } as never)

    const result = await generateGlobalSkillsJson({ dryRun: true })
    expect(result.success).toBe(true)
    expect(mockFs.writeJson).not.toHaveBeenCalled()
  })
})
