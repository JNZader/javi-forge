import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    readJson: vi.fn(),
    copy: vi.fn(),
    ensureDir: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

import fs from 'fs-extra'
import { renderTemplate, generateDependabotYml, getCITemplatePath, getCIDestination, generateCIWorkflow } from './template.js'
import type { Stack, CIProvider } from '../types/index.js'

const mockedFs = vi.mocked(fs)

beforeEach(() => {
  vi.resetAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════════
// getCITemplatePath (pure function)
// ═══════════════════════════════════════════════════════════════════════════════
describe('getCITemplatePath', () => {
  it('returns correct path for node + github', () => {
    const result = getCITemplatePath('node', 'github')
    expect(result).not.toBeNull()
    expect(result).toContain('github')
    expect(result).toContain('ci-node.yml')
  })

  it('returns correct path for python + gitlab', () => {
    const result = getCITemplatePath('python', 'gitlab')
    expect(result).not.toBeNull()
    expect(result).toContain('gitlab')
    expect(result).toContain('gitlab-ci-python.yml')
  })

  it('returns null for unknown stack', () => {
    const result = getCITemplatePath('haskell' as Stack, 'github')
    expect(result).toBeNull()
  })

  it('returns null for unknown provider', () => {
    const result = getCITemplatePath('node', 'bitbucket' as CIProvider)
    expect(result).toBeNull()
  })

  it('returns non-null for all valid stack+provider combinations', () => {
    const stacks: Stack[] = ['node', 'python', 'go', 'rust', 'java-gradle', 'java-maven']
    const providers: CIProvider[] = ['github', 'gitlab', 'woodpecker']

    for (const stack of stacks) {
      for (const provider of providers) {
        const result = getCITemplatePath(stack, provider)
        expect(result).not.toBeNull()
      }
    }
  })

  it('returns null for elixir (no CI template)', () => {
    // Elixir is not in the STACK_CI_MAP entries
    const result = getCITemplatePath('elixir', 'github')
    expect(result).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// getCIDestination (pure function)
// ═══════════════════════════════════════════════════════════════════════════════
describe('getCIDestination', () => {
  it('returns .github/workflows for github', () => {
    expect(getCIDestination('github')).toBe('.github/workflows/ci.yml')
  })

  it('returns .gitlab-ci.yml for gitlab', () => {
    expect(getCIDestination('gitlab')).toBe('.gitlab-ci.yml')
  })

  it('returns .woodpecker.yml for woodpecker', () => {
    expect(getCIDestination('woodpecker')).toBe('.woodpecker.yml')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// renderTemplate
// ═══════════════════════════════════════════════════════════════════════════════
describe('renderTemplate', () => {
  it('replaces a single placeholder', async () => {
    mockedFs.readFile.mockResolvedValue('Hello __NAME__!' as never)
    const result = await renderTemplate('/tpl/test.yml', { NAME: 'World' })
    expect(result).toBe('Hello World!')
  })

  it('replaces multiple different placeholders', async () => {
    mockedFs.readFile.mockResolvedValue('__GREETING__ __NAME__, age __AGE__' as never)
    const result = await renderTemplate('/tpl/test.yml', {
      GREETING: 'Hi',
      NAME: 'Alice',
      AGE: '30',
    })
    expect(result).toBe('Hi Alice, age 30')
  })

  it('returns content unchanged when no placeholders', async () => {
    mockedFs.readFile.mockResolvedValue('No placeholders here.' as never)
    const result = await renderTemplate('/tpl/test.yml', { NAME: 'World' })
    expect(result).toBe('No placeholders here.')
  })

  it('replaces placeholder appearing multiple times', async () => {
    mockedFs.readFile.mockResolvedValue('__X__ and __X__ again' as never)
    const result = await renderTemplate('/tpl/test.yml', { X: 'val' })
    expect(result).toBe('val and val again')
  })

  it('handles empty variable value', async () => {
    mockedFs.readFile.mockResolvedValue('prefix__EMPTY__suffix' as never)
    const result = await renderTemplate('/tpl/test.yml', { EMPTY: '' })
    expect(result).toBe('prefixsuffix')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// generateDependabotYml
// ═══════════════════════════════════════════════════════════════════════════════
describe('generateDependabotYml', () => {
  it('generates for a single stack', async () => {
    mockedFs.readFile.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('header.yml')) return 'version: 2\nupdates:\n' as never
      if (p.includes('github-actions.yml')) return '  - package-ecosystem: github-actions\n' as never
      if (p.includes('npm.yml')) return '  - package-ecosystem: npm\n' as never
      return '' as never
    })
    mockedFs.pathExists.mockResolvedValue(true as never)

    const result = await generateDependabotYml(['node'], true)
    expect(result).toContain('version: 2')
    expect(result).toContain('github-actions')
    expect(result).toContain('npm')
  })

  it('deduplicates fragments for multiple stacks', async () => {
    let npmCallCount = 0
    mockedFs.readFile.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('header.yml')) return 'header\n' as never
      if (p.includes('github-actions.yml')) return 'gh-actions\n' as never
      if (p.includes('npm.yml')) {
        npmCallCount++
        return 'npm-fragment\n' as never
      }
      return '' as never
    })
    mockedFs.pathExists.mockResolvedValue(true as never)

    // Two node stacks — 'npm' fragment should only appear once
    const result = await generateDependabotYml(['node', 'node'], true)
    expect(npmCallCount).toBe(1)
  })

  it('includes github-actions fragment when includeGitHubActions is true', async () => {
    let githubActionsRead = false
    mockedFs.readFile.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('header.yml')) return 'header\n' as never
      if (p.includes('github-actions.yml')) {
        githubActionsRead = true
        return 'gh-actions\n' as never
      }
      return '' as never
    })
    mockedFs.pathExists.mockResolvedValue(true as never)

    await generateDependabotYml([], true)
    expect(githubActionsRead).toBe(true)
  })

  it('excludes github-actions fragment when includeGitHubActions is false', async () => {
    let githubActionsRead = false
    mockedFs.readFile.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.includes('header.yml')) return 'header\n' as never
      if (p.includes('github-actions.yml')) {
        githubActionsRead = true
        return 'gh-actions\n' as never
      }
      return '' as never
    })
    mockedFs.pathExists.mockResolvedValue(true as never)

    await generateDependabotYml([], false)
    expect(githubActionsRead).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// generateCIWorkflow
// ═══════════════════════════════════════════════════════════════════════════════
describe('generateCIWorkflow', () => {
  it('returns file content for valid stack+provider', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue('name: CI\non: push' as never)

    const result = await generateCIWorkflow('node', 'github')
    expect(result).not.toBeNull()
    expect(result).toContain('name: CI')
  })

  it('returns null when no template mapping exists', async () => {
    const result = await generateCIWorkflow('elixir', 'github')
    expect(result).toBeNull()
  })

  it('returns null when template file does not exist on disk', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const result = await generateCIWorkflow('node', 'github')
    expect(result).toBeNull()
  })
})
