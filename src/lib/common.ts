import fs from 'fs-extra'
import path from 'path'
import type { Stack, StackDetection } from '../types/index.js'

/**
 * Detect the project stack by looking for well-known build/config files.
 * Returns the first match (precedence order matters).
 */
export async function detectStack(projectDir: string): Promise<StackDetection | null> {
  const exists = async (file: string) =>
    fs.pathExists(path.join(projectDir, file))

  // Java — Gradle
  if (await exists('build.gradle') || await exists('build.gradle.kts')) {
    const javaVersion = await detectJavaVersion(projectDir)
    return { stackType: 'java-gradle', buildTool: 'gradle', javaVersion }
  }

  // Java — Maven
  if (await exists('pom.xml')) {
    const javaVersion = await detectJavaVersion(projectDir)
    return { stackType: 'java-maven', buildTool: 'maven', javaVersion }
  }

  // Node.js
  if (await exists('package.json')) {
    const pkg = await fs.readJson(path.join(projectDir, 'package.json')).catch(() => ({}))
    const buildTool = await exists('pnpm-lock.yaml') ? 'pnpm'
      : await exists('yarn.lock') ? 'yarn'
      : 'npm'
    return { stackType: 'node', buildTool }
  }

  // Python
  if (await exists('pyproject.toml') || await exists('requirements.txt') || await exists('setup.py')) {
    const buildTool = await exists('pyproject.toml') ? 'pyproject'
      : await exists('Pipfile') ? 'pipenv'
      : 'pip'
    return { stackType: 'python', buildTool }
  }

  // Go
  if (await exists('go.mod')) {
    return { stackType: 'go', buildTool: 'go' }
  }

  // Rust
  if (await exists('Cargo.toml')) {
    return { stackType: 'rust', buildTool: 'cargo' }
  }

  // Elixir
  if (await exists('mix.exs')) {
    return { stackType: 'elixir', buildTool: 'mix' }
  }

  return null
}

/** Try to detect Java version from gradle or maven config */
async function detectJavaVersion(projectDir: string): Promise<string | undefined> {
  // Try build.gradle
  const gradleFile = path.join(projectDir, 'build.gradle')
  if (await fs.pathExists(gradleFile)) {
    const content = await fs.readFile(gradleFile, 'utf-8')
    const match = content.match(/sourceCompatibility\s*=\s*['"]?(\d+)/)
      || content.match(/JavaVersion\.VERSION_(\d+)/)
    if (match) return match[1]
  }

  // Try build.gradle.kts
  const ktsFile = path.join(projectDir, 'build.gradle.kts')
  if (await fs.pathExists(ktsFile)) {
    const content = await fs.readFile(ktsFile, 'utf-8')
    const match = content.match(/jvmTarget\s*=\s*['"](\d+)['"]/)
      || content.match(/JavaVersion\.VERSION_(\d+)/)
    if (match) return match[1]
  }

  // Try pom.xml
  const pomFile = path.join(projectDir, 'pom.xml')
  if (await fs.pathExists(pomFile)) {
    const content = await fs.readFile(pomFile, 'utf-8')
    const match = content.match(/<java\.version>(\d+)</)
      || content.match(/<maven\.compiler\.source>(\d+)</)
    if (match) return match[1]
  }

  return undefined
}

/** Back up a file by copying to filePath.bak (only if it exists) */
export async function backupIfExists(filePath: string): Promise<boolean> {
  if (await fs.pathExists(filePath)) {
    await fs.copy(filePath, `${filePath}.bak`, { overwrite: true })
    return true
  }
  return false
}

/** Create a directory recursively if it doesn't exist */
export async function ensureDirExists(dirPath: string): Promise<void> {
  await fs.ensureDir(dirPath)
}

/** Check if a directory is a git repository */
export async function isGitRepo(dir: string): Promise<boolean> {
  return fs.pathExists(path.join(dir, '.git'))
}

/** Resolve the forge assets root (the package root directory) */
export function getForgeRoot(): string {
  // When running from dist/, go up one level
  const thisDir = path.dirname(new URL(import.meta.url).pathname)
  return path.resolve(thisDir, '..')
}

/** Stack display names */
export const STACK_LABELS: Record<Stack, string> = {
  'node':        'Node.js / TypeScript',
  'python':      'Python',
  'go':          'Go',
  'rust':        'Rust',
  'java-gradle': 'Java (Gradle)',
  'java-maven':  'Java (Maven)',
  'elixir':      'Elixir',
}
