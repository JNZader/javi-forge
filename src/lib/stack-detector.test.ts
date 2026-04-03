import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readJson: vi.fn(),
    readFile: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

import fs from 'fs-extra'
import { detectProjectStack, SIGNAL_SKILL_MAP, detectDockerPresence, DOCKER_FILES } from './stack-detector.js'

const mockFs = vi.mocked(fs)

beforeEach(() => {
  vi.resetAllMocks()
  // Default: no files exist
  mockFs.pathExists.mockResolvedValue(false as never)
})

// ── SIGNAL_SKILL_MAP ───────────────────────────────────────────────────────

describe('SIGNAL_SKILL_MAP', () => {
  it('maps react to react-19 skill', () => {
    expect(SIGNAL_SKILL_MAP['react']).toContain('react-19')
  })

  it('maps next to nextjs-15 and react-19', () => {
    expect(SIGNAL_SKILL_MAP['next']).toContain('nextjs-15')
    expect(SIGNAL_SKILL_MAP['next']).toContain('react-19')
  })

  it('maps tailwindcss to tailwind-4', () => {
    expect(SIGNAL_SKILL_MAP['tailwindcss']).toContain('tailwind-4')
  })

  it('maps zustand to zustand-5', () => {
    expect(SIGNAL_SKILL_MAP['zustand']).toContain('zustand-5')
  })

  it('maps zod to zod-4', () => {
    expect(SIGNAL_SKILL_MAP['zod']).toContain('zod-4')
  })
})

// ── detectProjectStack ─────────────────────────────────────────────────────

describe('detectProjectStack', () => {
  it('detects Node.js project with React and TypeScript', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('package.json')) return true
      if (p.endsWith('tsconfig.json')) return true
      return false
    })

    mockFs.readJson.mockResolvedValue({
      dependencies: { react: '^19.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    } as never)

    const result = await detectProjectStack('/test/project')

    expect(result.stack).toBe('node')
    expect(result.recommendedSkills).toContain('react-19')
    expect(result.recommendedSkills).toContain('typescript')
  })

  it('detects Next.js project and recommends nextjs-15 + react-19', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('package.json')) return true
      if (p.endsWith('next.config.js')) return true
      if (p.endsWith('tsconfig.json')) return true
      return false
    })

    mockFs.readJson.mockResolvedValue({
      dependencies: { next: '^15.0.0', react: '^19.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    } as never)

    const result = await detectProjectStack('/test/project')

    expect(result.stack).toBe('node')
    expect(result.recommendedSkills).toContain('nextjs-15')
    expect(result.recommendedSkills).toContain('react-19')
    expect(result.recommendedSkills).toContain('typescript')
  })

  it('detects Python project', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('pyproject.toml')) return true
      return false
    })

    mockFs.readFile.mockResolvedValue('django>=4.0\n' as never)

    const result = await detectProjectStack('/test/project')

    expect(result.stack).toBe('python')
    expect(result.recommendedSkills).toContain('pytest')
    expect(result.recommendedSkills).toContain('django-drf')
  })

  it('detects Tailwind from config file', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('package.json')) return true
      if (p.endsWith('tailwind.config.ts')) return true
      if (p.endsWith('tsconfig.json')) return true
      return false
    })

    mockFs.readJson.mockResolvedValue({
      dependencies: { tailwindcss: '^4.0.0' },
      devDependencies: {},
    } as never)

    const result = await detectProjectStack('/test/project')

    expect(result.recommendedSkills).toContain('tailwind-4')
  })

  it('detects Go project with no skills', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('go.mod')) return true
      return false
    })

    const result = await detectProjectStack('/test/project')

    expect(result.stack).toBe('go')
    expect(result.recommendedSkills).toEqual([])
  })

  it('detects Rust project', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('Cargo.toml')) return true
      return false
    })

    const result = await detectProjectStack('/test/project')

    expect(result.stack).toBe('rust')
  })

  it('detects Playwright from config file', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('package.json')) return true
      if (p.endsWith('playwright.config.ts')) return true
      return false
    })

    mockFs.readJson.mockResolvedValue({
      devDependencies: { playwright: '^1.40.0' },
    } as never)

    const result = await detectProjectStack('/test/project')

    expect(result.recommendedSkills).toContain('playwright')
  })

  it('returns null stack and empty skills for empty directory', async () => {
    const result = await detectProjectStack('/empty')

    expect(result.stack).toBeNull()
    expect(result.recommendedSkills).toEqual([])
    expect(result.signals).toEqual([])
  })

  it('handles corrupt package.json gracefully', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('package.json')) return true
      return false
    })

    mockFs.readJson.mockRejectedValue(new Error('invalid JSON') as never)

    const result = await detectProjectStack('/test/project')

    expect(result.stack).toBe('node')
    // Should not crash, just return no signals from deps
  })

  it('deduplicates skills across multiple signals', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('package.json')) return true
      if (p.endsWith('next.config.mjs')) return true
      return false
    })

    mockFs.readJson.mockResolvedValue({
      dependencies: { next: '^15.0.0', react: '^19.0.0' },
    } as never)

    const result = await detectProjectStack('/test/project')

    // react-19 should appear only once despite being in both next and react signals
    const reactCount = result.recommendedSkills.filter(s => s === 'react-19').length
    expect(reactCount).toBe(1)
  })
})

// ── detectDockerPresence ──────────────────────────────────────────────────

describe('detectDockerPresence', () => {
  it('returns true when Dockerfile exists', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('Dockerfile')) return true
      return false
    })

    expect(await detectDockerPresence('/test/project')).toBe(true)
  })

  it('returns true when docker-compose.yml exists', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('docker-compose.yml')) return true
      return false
    })

    expect(await detectDockerPresence('/test/project')).toBe(true)
  })

  it('returns true when compose.yaml exists', async () => {
    mockFs.pathExists.mockImplementation(async (p: string) => {
      if (p.endsWith('compose.yaml')) return true
      return false
    })

    expect(await detectDockerPresence('/test/project')).toBe(true)
  })

  it('returns false when no Docker files exist', async () => {
    mockFs.pathExists.mockResolvedValue(false as never)
    expect(await detectDockerPresence('/test/project')).toBe(false)
  })

  it('DOCKER_FILES contains all expected filenames', () => {
    expect(DOCKER_FILES).toContain('Dockerfile')
    expect(DOCKER_FILES).toContain('docker-compose.yml')
    expect(DOCKER_FILES).toContain('docker-compose.yaml')
    expect(DOCKER_FILES).toContain('compose.yml')
    expect(DOCKER_FILES).toContain('compose.yaml')
  })
})
