import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readJson: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    writeJson: vi.fn(),
    ensureDir: vi.fn(),
    readdir: vi.fn(),
    remove: vi.fn(),
    move: vi.fn(),
    copy: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

import fs from 'fs-extra'
import { skillToCodexToml, serializeToml, exportPluginAsCodexToml } from './codex-export.js'

const mockFs = vi.mocked(fs)

beforeEach(() => vi.clearAllMocks())

// ── skillToCodexToml ──────────────────────────────────────────────────────

describe('skillToCodexToml', () => {
  it('converts valid SKILL.md frontmatter to CodexTomlEntry', () => {
    const raw = `---
name: react-pro
description: React 19 patterns and best practices
---
## Purpose

Build React components following modern patterns.`

    const result = skillToCodexToml(raw)
    expect(result).not.toBeNull()
    expect(result!.name).toBe('react-pro')
    expect(result!.model).toBe('o4-mini')
    expect(result!.instructions).toContain('React 19 patterns')
    expect(result!.instructions).toContain('Build React components')
  })

  it('returns null for content without frontmatter', () => {
    const raw = 'Just some markdown without frontmatter.'
    expect(skillToCodexToml(raw)).toBeNull()
  })

  it('returns null when frontmatter has no name', () => {
    const raw = `---
description: Missing name field
---
Content here.`
    expect(skillToCodexToml(raw)).toBeNull()
  })

  it('uses custom model from frontmatter when provided', () => {
    const raw = `---
name: custom-skill
description: A skill with custom model
model: gpt-4o
---
Body content.`

    const result = skillToCodexToml(raw)
    expect(result).not.toBeNull()
    expect(result!.model).toBe('gpt-4o')
  })

  it('uses default model when not specified', () => {
    const raw = `---
name: default-model
description: No model specified in frontmatter
---
Body.`

    const result = skillToCodexToml(raw)
    expect(result!.model).toBe('o4-mini')
  })

  it('handles SKILL.md with no description', () => {
    const raw = `---
name: no-desc
---
Just body content here.`

    const result = skillToCodexToml(raw)
    expect(result).not.toBeNull()
    expect(result!.instructions).toBe('Just body content here.')
  })

  it('handles SKILL.md with empty body', () => {
    const raw = `---
name: empty-body
description: Only frontmatter
---`

    const result = skillToCodexToml(raw)
    expect(result).not.toBeNull()
    expect(result!.instructions).toBe('Only frontmatter')
  })
})

// ── serializeToml ─────────────────────────────────────────────────────────

describe('serializeToml', () => {
  it('produces valid TOML with name, model, instructions', () => {
    const entry = {
      name: 'react-pro',
      model: 'o4-mini',
      instructions: 'Build React components.',
    }

    const toml = serializeToml(entry)
    expect(toml).toContain('name = "react-pro"')
    expect(toml).toContain('model = "o4-mini"')
    expect(toml).toContain('instructions = """')
    expect(toml).toContain('Build React components.')
    expect(toml).toContain('"""')
  })

  it('escapes double quotes in name', () => {
    const entry = {
      name: 'skill-"quoted"',
      model: 'o4-mini',
      instructions: 'Test.',
    }

    const toml = serializeToml(entry)
    expect(toml).toContain('name = "skill-\\"quoted\\""')
  })

  it('escapes backslashes in instructions', () => {
    const entry = {
      name: 'test',
      model: 'o4-mini',
      instructions: 'Use path\\to\\file for config.',
    }

    const toml = serializeToml(entry)
    expect(toml).toContain('path\\\\to\\\\file')
  })

  it('handles multiline instructions', () => {
    const entry = {
      name: 'multi',
      model: 'o4-mini',
      instructions: 'Line one.\nLine two.\nLine three.',
    }

    const toml = serializeToml(entry)
    expect(toml).toContain('Line one.\nLine two.\nLine three.')
  })
})

// ── exportPluginAsCodexToml ───────────────────────────────────────────────

describe('exportPluginAsCodexToml', () => {
  it('returns error when plugin is not installed', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)

    const result = await exportPluginAsCodexToml('ghost')
    expect(result.success).toBe(false)
    expect(result.error).toContain('not installed')
  })

  it('returns error when plugin.json is missing', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.endsWith('ghost')) return true as never
      return false as never
    })

    const result = await exportPluginAsCodexToml('ghost')
    expect(result.success).toBe(false)
    expect(result.error).toBe('plugin.json not found')
  })

  it('returns error when plugin has no skills', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockResolvedValue({
      name: 'empty-plugin',
      version: '1.0.0',
      description: 'A plugin with no skills at all',
      skills: [],
    } as never)

    const result = await exportPluginAsCodexToml('empty-plugin')
    expect(result.success).toBe(false)
    expect(result.error).toBe('plugin has no skills to export')
  })

  it('writes TOML files for valid skills', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockResolvedValue({
      name: 'my-plugin',
      version: '1.0.0',
      description: 'Plugin with skills for testing',
      skills: ['react-pro'],
    } as never)
    mockFs.readFile.mockResolvedValue(`---
name: react-pro
description: React 19 patterns and best practices
---
## Purpose
Build React components.` as never)
    mockFs.ensureDir.mockResolvedValue(undefined as never)
    mockFs.writeFile.mockResolvedValue(undefined as never)

    const result = await exportPluginAsCodexToml('my-plugin')
    expect(result.success).toBe(true)
    expect(result.files).toHaveLength(1)
    expect(result.files![0]).toContain('react-pro.toml')
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1)
    expect(mockFs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('react-pro.toml'),
      expect.stringContaining('name = "react-pro"'),
      'utf-8'
    )
  })

  it('skips skills without SKILL.md', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (typeof p === 'string' && p.includes('SKILL.md')) return false as never
      return true as never
    })
    mockFs.readJson.mockResolvedValue({
      name: 'my-plugin',
      version: '1.0.0',
      description: 'Plugin with missing skill files',
      skills: ['missing-skill'],
    } as never)
    mockFs.ensureDir.mockResolvedValue(undefined as never)

    const result = await exportPluginAsCodexToml('my-plugin')
    expect(result.success).toBe(false)
    expect(result.error).toBe('no skills with valid frontmatter found')
  })

  it('returns error when plugin.json is invalid JSON', async () => {
    mockFs.pathExists.mockResolvedValue(true as never)
    mockFs.readJson.mockRejectedValue(new Error('parse error') as never)

    const result = await exportPluginAsCodexToml('bad-plugin')
    expect(result.success).toBe(false)
    expect(result.error).toBe('invalid plugin.json')
  })
})
