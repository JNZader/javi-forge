import fs from 'fs-extra'
import path from 'path'
import type { Stack } from '../types/index.js'

// ── Stack-to-Skills Mapping ────────────────────────────────────────────────

/**
 * Maps detected project signals to recommended AI skills.
 * Each key is a detection signal (file/dependency/pattern),
 * and the value is the list of skills it implies.
 */
export const SIGNAL_SKILL_MAP: Record<string, string[]> = {
  // Frameworks
  'react':        ['react-19'],
  'next':         ['nextjs-15', 'react-19'],
  'angular':      [],
  'vue':          [],
  'django':       ['django-drf', 'pytest'],
  'flask':        ['pytest'],
  'fastapi':      ['pytest'],

  // Languages / runtimes
  'typescript':   ['typescript'],
  'python':       ['pytest'],
  'go':           [],
  'rust':         [],
  'elixir':       [],

  // Styling
  'tailwindcss':  ['tailwind-4'],

  // State management
  'zustand':      ['zustand-5'],

  // Validation
  'zod':          ['zod-4'],

  // AI SDKs
  'ai':           ['ai-sdk-5'],
  '@ai-sdk':      ['ai-sdk-5'],

  // Testing
  'vitest':       [],
  'jest':         [],
  'pytest':       ['pytest'],
  'playwright':   ['playwright'],
}

/**
 * Additional file-based signals that don't come from package.json dependencies.
 */
const FILE_SIGNALS: Array<{ files: string[]; skills: string[] }> = [
  { files: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs'], skills: ['tailwind-4'] },
  { files: ['playwright.config.ts', 'playwright.config.js'],                     skills: ['playwright'] },
  { files: ['tsconfig.json'],                                                     skills: ['typescript'] },
  { files: ['pyproject.toml', 'setup.py', 'requirements.txt'],                   skills: ['pytest'] },
  { files: ['next.config.js', 'next.config.mjs', 'next.config.ts'],              skills: ['nextjs-15', 'react-19'] },
]

/**
 * Docker-related files that indicate a containerized project.
 * Used by the init command to suggest Docker zero-downtime deploy scaffolding.
 */
export const DOCKER_FILES = [
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
]

/**
 * Detect whether the project uses Docker (Dockerfile or compose file present).
 */
export async function detectDockerPresence(projectDir: string): Promise<boolean> {
  for (const file of DOCKER_FILES) {
    if (await fs.pathExists(path.join(projectDir, file))) {
      return true
    }
  }
  return false
}

// ── Detection Result ───────────────────────────────────────────────────────

export interface StackDetectionResult {
  /** Primary stack type (node, python, etc.) */
  stack: Stack | null
  /** All detected signals with their source */
  signals: DetectedSignal[]
  /** De-duplicated list of recommended skill names */
  recommendedSkills: string[]
}

export interface DetectedSignal {
  /** What was detected (e.g., "react", "tailwindcss", "tsconfig.json") */
  signal: string
  /** Where it was found (e.g., "package.json dependencies", "file exists") */
  source: string
  /** Skills this signal maps to */
  skills: string[]
}

// ── Core Detection ─────────────────────────────────────────────────────────

/**
 * Scan a project directory and detect its tech stack + recommended skills.
 * Reads package.json deps, pyproject.toml, and well-known config files.
 */
export async function detectProjectStack(projectDir: string): Promise<StackDetectionResult> {
  const signals: DetectedSignal[] = []
  let stack: Stack | null = null

  // 1. Check Node.js (package.json)
  const pkgPath = path.join(projectDir, 'package.json')
  if (await fs.pathExists(pkgPath)) {
    stack = 'node'
    try {
      const pkg = await fs.readJson(pkgPath) as Record<string, unknown>
      const allDeps = {
        ...(pkg['dependencies'] as Record<string, string> ?? {}),
        ...(pkg['devDependencies'] as Record<string, string> ?? {}),
      }

      for (const depName of Object.keys(allDeps)) {
        const normalizedDep = depName.replace(/^@/, '').split('/')[0]
        for (const [signal, skills] of Object.entries(SIGNAL_SKILL_MAP)) {
          if (normalizedDep === signal || depName === signal || depName.startsWith(`@${signal}/`)) {
            if (skills.length > 0) {
              signals.push({ signal: depName, source: 'package.json', skills })
            }
          }
        }
      }
    } catch { /* corrupt package.json — skip deps detection */ }
  }

  // 2. Check Python
  const pythonFiles = ['pyproject.toml', 'requirements.txt', 'setup.py']
  for (const pyFile of pythonFiles) {
    if (await fs.pathExists(path.join(projectDir, pyFile))) {
      if (!stack) stack = 'python'
      signals.push({ signal: pyFile, source: 'file exists', skills: ['pytest'] })
      break
    }
  }

  // 3. Check Python deps from pyproject.toml
  const pyprojectPath = path.join(projectDir, 'pyproject.toml')
  if (await fs.pathExists(pyprojectPath)) {
    try {
      const content = await fs.readFile(pyprojectPath, 'utf-8')
      if (/django/i.test(content)) {
        signals.push({ signal: 'django', source: 'pyproject.toml', skills: ['django-drf', 'pytest'] })
      }
      if (/fastapi/i.test(content)) {
        signals.push({ signal: 'fastapi', source: 'pyproject.toml', skills: ['pytest'] })
      }
      if (/playwright/i.test(content)) {
        signals.push({ signal: 'playwright', source: 'pyproject.toml', skills: ['playwright'] })
      }
    } catch { /* skip */ }
  }

  // 4. Check Go
  if (await fs.pathExists(path.join(projectDir, 'go.mod'))) {
    if (!stack) stack = 'go'
  }

  // 5. Check Rust
  if (await fs.pathExists(path.join(projectDir, 'Cargo.toml'))) {
    if (!stack) stack = 'rust'
  }

  // 6. Check Elixir
  if (await fs.pathExists(path.join(projectDir, 'mix.exs'))) {
    if (!stack) stack = 'elixir'
  }

  // 7. Check Java
  if (await fs.pathExists(path.join(projectDir, 'build.gradle')) ||
      await fs.pathExists(path.join(projectDir, 'build.gradle.kts'))) {
    if (!stack) stack = 'java-gradle'
  }
  if (await fs.pathExists(path.join(projectDir, 'pom.xml'))) {
    if (!stack) stack = 'java-maven'
  }

  // 8. File-based signals
  for (const { files, skills } of FILE_SIGNALS) {
    for (const file of files) {
      if (await fs.pathExists(path.join(projectDir, file))) {
        signals.push({ signal: file, source: 'file exists', skills })
        break // Only need one file per signal group
      }
    }
  }

  // De-duplicate recommended skills
  const skillSet = new Set<string>()
  for (const s of signals) {
    for (const skill of s.skills) {
      skillSet.add(skill)
    }
  }

  const recommendedSkills = [...skillSet].sort()

  return { stack, signals, recommendedSkills }
}
