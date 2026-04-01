import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PluginManifest, AgentSkillsManifest } from '../types/index.js'

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
