import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readJson: vi.fn(),
    readFile: vi.fn(),
    copy: vi.fn(),
    ensureDir: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

import fs from 'fs-extra'
import { detectStack, backupIfExists, isGitRepo } from './common.js'

const mockedFs = vi.mocked(fs)

beforeEach(() => {
  vi.resetAllMocks()
})

// ═══════════════════════════════════════════════════════════════════════════════
// detectStack
// ═══════════════════════════════════════════════════════════════════════════════
describe('detectStack', () => {
  function mockFileExists(existingFiles: string[]) {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      return existingFiles.some(f => p.endsWith(f))
    })
  }

  it('detects build.gradle → java-gradle', async () => {
    mockFileExists(['build.gradle'])
    mockedFs.readFile.mockResolvedValue('sourceCompatibility = 21' as never)
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('java-gradle')
    expect(result!.buildTool).toBe('gradle')
    expect(result!.javaVersion).toBe('21')
  })

  it('detects build.gradle.kts → java-gradle', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle')) return false
      if (p.endsWith('build.gradle.kts')) return true
      return false
    })
    mockedFs.readFile.mockResolvedValue('jvmTarget = "17"' as never)
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('java-gradle')
    expect(result!.javaVersion).toBe('17')
  })

  it('detects pom.xml → java-maven', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts')) return false
      if (p.endsWith('pom.xml')) return true
      return false
    })
    mockedFs.readFile.mockResolvedValue('<java.version>21</java.version>' as never)
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('java-maven')
    expect(result!.buildTool).toBe('maven')
  })

  it('detects package.json + pnpm-lock.yaml → node/pnpm', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts') || p.endsWith('pom.xml')) return false
      if (p.endsWith('package.json') || p.endsWith('pnpm-lock.yaml')) return true
      return false
    })
    mockedFs.readJson.mockResolvedValue({} as never)
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('node')
    expect(result!.buildTool).toBe('pnpm')
  })

  it('detects package.json + yarn.lock → node/yarn', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts') || p.endsWith('pom.xml')) return false
      if (p.endsWith('package.json') || p.endsWith('yarn.lock')) return true
      if (p.endsWith('pnpm-lock.yaml')) return false
      return false
    })
    mockedFs.readJson.mockResolvedValue({} as never)
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('node')
    expect(result!.buildTool).toBe('yarn')
  })

  it('detects package.json alone → node/npm', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts') || p.endsWith('pom.xml')) return false
      if (p.endsWith('package.json')) return true
      return false
    })
    mockedFs.readJson.mockResolvedValue({} as never)
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('node')
    expect(result!.buildTool).toBe('npm')
  })

  it('detects pyproject.toml → python/pyproject', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts') || p.endsWith('pom.xml') || p.endsWith('package.json')) return false
      if (p.endsWith('pyproject.toml')) return true
      return false
    })
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('python')
    expect(result!.buildTool).toBe('pyproject')
  })

  it('detects requirements.txt → python/pip', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts') || p.endsWith('pom.xml') || p.endsWith('package.json')) return false
      if (p.endsWith('pyproject.toml')) return false
      if (p.endsWith('requirements.txt')) return true
      if (p.endsWith('Pipfile')) return false
      return false
    })
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('python')
    expect(result!.buildTool).toBe('pip')
  })

  it('detects Pipfile → python/pipenv', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts') || p.endsWith('pom.xml') || p.endsWith('package.json')) return false
      if (p.endsWith('pyproject.toml')) return false
      if (p.endsWith('requirements.txt') || p.endsWith('setup.py')) return true
      if (p.endsWith('Pipfile')) return true
      return false
    })
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('python')
    expect(result!.buildTool).toBe('pipenv')
  })

  it('detects go.mod → go', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('go.mod')) return true
      return false
    })
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('go')
    expect(result!.buildTool).toBe('go')
  })

  it('detects Cargo.toml → rust', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('Cargo.toml')) return true
      return false
    })
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('rust')
    expect(result!.buildTool).toBe('cargo')
  })

  it('detects mix.exs → elixir', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('mix.exs')) return true
      return false
    })
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('elixir')
    expect(result!.buildTool).toBe('mix')
  })

  it('returns null for empty directory', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const result = await detectStack('/empty-project')
    expect(result).toBeNull()
  })

  it('gives java-gradle precedence when both gradle + package.json exist', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('package.json')) return true
      return false
    })
    mockedFs.readFile.mockResolvedValue('sourceCompatibility = 21' as never)
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('java-gradle')
  })

  it('detects JavaVersion.VERSION_21 in build.gradle', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle')) return true
      return false
    })
    mockedFs.readFile.mockResolvedValue('JavaVersion.VERSION_21' as never)
    const result = await detectStack('/project')
    expect(result!.javaVersion).toBe('21')
  })

  it('detects JavaVersion.VERSION_17 in build.gradle.kts', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle')) return false
      if (p.endsWith('build.gradle.kts')) return true
      return false
    })
    mockedFs.readFile.mockResolvedValue('JavaVersion.VERSION_17' as never)
    const result = await detectStack('/project')
    expect(result!.javaVersion).toBe('17')
  })

  it('detects maven.compiler.source in pom.xml', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts')) return false
      if (p.endsWith('pom.xml')) return true
      return false
    })
    mockedFs.readFile.mockResolvedValue('<maven.compiler.source>17</maven.compiler.source>' as never)
    const result = await detectStack('/project')
    expect(result!.javaVersion).toBe('17')
  })

  it('returns undefined javaVersion when no version pattern matches', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle')) return true
      return false
    })
    mockedFs.readFile.mockResolvedValue('apply plugin: java' as never)
    const result = await detectStack('/project')
    expect(result!.javaVersion).toBeUndefined()
  })

  it('handles readJson error for package.json gracefully', async () => {
    mockedFs.pathExists.mockImplementation(async (filePath: unknown) => {
      const p = String(filePath)
      if (p.endsWith('build.gradle') || p.endsWith('build.gradle.kts') || p.endsWith('pom.xml')) return false
      if (p.endsWith('package.json')) return true
      return false
    })
    mockedFs.readJson.mockRejectedValue(new Error('invalid json') as never)
    const result = await detectStack('/project')
    expect(result).not.toBeNull()
    expect(result!.stackType).toBe('node')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// backupIfExists
// ═══════════════════════════════════════════════════════════════════════════════
describe('backupIfExists', () => {
  it('creates .bak and returns true when file exists', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.copy.mockResolvedValue(undefined as never)

    const result = await backupIfExists('/project/ci.yml')
    expect(result).toBe(true)
    expect(mockedFs.copy).toHaveBeenCalledWith(
      '/project/ci.yml',
      '/project/ci.yml.bak',
      { overwrite: true }
    )
  })

  it('returns false when file does not exist', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)

    const result = await backupIfExists('/project/nonexistent.yml')
    expect(result).toBe(false)
    expect(mockedFs.copy).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// isGitRepo
// ═══════════════════════════════════════════════════════════════════════════════
describe('isGitRepo', () => {
  it('returns true when .git exists', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    const result = await isGitRepo('/project')
    expect(result).toBe(true)
    expect(mockedFs.pathExists).toHaveBeenCalledWith(
      path.join('/project', '.git')
    )
  })

  it('returns false when .git does not exist', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const result = await isGitRepo('/project')
    expect(result).toBe(false)
  })
})
