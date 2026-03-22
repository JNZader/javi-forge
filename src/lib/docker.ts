import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import crypto from 'crypto'
import fs from 'fs-extra'
import path from 'path'
import type { Stack } from '../types/index.js'

const execFileAsync = promisify(execFile)

// =============================================================================
// Types
// =============================================================================

export interface DockerRunOptions {
  /** Absolute path to mount as /home/runner/work */
  projectDir: string
  /** Command to run inside the container */
  command: string
  /** Timeout in seconds (default: 600) */
  timeout?: number
  /** Stream output to stdout/stderr (default: true) */
  stream?: boolean
  /** Override the user to run as inside the container (default: runner) */
  user?: string
}

export interface DockerRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface DockerImageOptions {
  stack: Stack
  /** Java version override (only for java-* stacks) */
  javaVersion?: string
  /** Directory where Dockerfiles are stored (defaults to package-bundled dir) */
  dockerfilesDir?: string
}

// =============================================================================
// Image name
// =============================================================================

export function getImageName(stack: Stack): string {
  return `javi-forge-ci-${stack}`
}

// =============================================================================
// Dockerfile content per stack
// =============================================================================

export function getDockerfileContent(stack: Stack): string {
  switch (stack) {
    case 'java-gradle':
    case 'java-maven':
      return [
        'ARG JAVA_VERSION=21',
        'FROM eclipse-temurin:${JAVA_VERSION}-jdk-noble',
        'RUN apt-get update && apt-get install -y git curl unzip && rm -rf /var/lib/apt/lists/*',
        'RUN useradd -m -s /bin/bash runner',
        'USER runner',
        'WORKDIR /home/runner/work',
        'ENTRYPOINT ["/bin/bash", "-c"]',
      ].join('\n')

    case 'node':
      return [
        'FROM node:22-slim',
        'RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*',
        'RUN npm install -g pnpm',
        'RUN useradd -m -s /bin/bash runner',
        'USER runner',
        'WORKDIR /home/runner/work',
        'ENTRYPOINT ["/bin/bash", "-c"]',
      ].join('\n')

    case 'python':
      return [
        'FROM python:3.12-slim',
        'RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*',
        'RUN pip install --no-cache-dir pytest ruff pylint poetry',
        'RUN useradd -m -s /bin/bash runner',
        'USER runner',
        'WORKDIR /home/runner/work',
        'ENTRYPOINT ["/bin/bash", "-c"]',
      ].join('\n')

    case 'go':
      return [
        'FROM golang:1.23-bookworm',
        'RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*',
        'RUN go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.62.0 && mv /root/go/bin/golangci-lint /usr/local/bin/',
        'RUN useradd -m -s /bin/bash runner',
        'USER runner',
        'WORKDIR /home/runner/work',
        'ENTRYPOINT ["/bin/bash", "-c"]',
      ].join('\n')

    case 'rust':
      return [
        'FROM rust:1.83-slim',
        'RUN apt-get update && apt-get install -y git pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*',
        'RUN rustup component add clippy rustfmt',
        'RUN useradd -m -s /bin/bash runner',
        'USER runner',
        'WORKDIR /home/runner/work',
        'ENTRYPOINT ["/bin/bash", "-c"]',
      ].join('\n')

    default:
      return [
        'FROM ubuntu:24.04',
        'RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*',
        'RUN useradd -m -s /bin/bash runner',
        'USER runner',
        'WORKDIR /home/runner/work',
        'ENTRYPOINT ["/bin/bash", "-c"]',
      ].join('\n')
  }
}

// =============================================================================
// Docker availability
// =============================================================================

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

// =============================================================================
// Image management
// =============================================================================

/**
 * Ensure a CI Docker image exists and is up-to-date.
 * Rebuilds only if the Dockerfile content has changed (hash-based staleness check).
 * Returns the image name.
 */
export async function ensureImage(options: DockerImageOptions): Promise<string> {
  const { stack, javaVersion, dockerfilesDir } = options
  const imageName = getImageName(stack)

  // Resolve Dockerfile path
  const dockerDir = dockerfilesDir ?? path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '../../ci-local/docker'
  )
  const dockerfilePath = path.join(dockerDir, `${stack}.Dockerfile`)

  // Write Dockerfile if it doesn't exist yet (first run)
  if (!await fs.pathExists(dockerfilePath)) {
    await fs.ensureDir(dockerDir)
    await fs.writeFile(dockerfilePath, getDockerfileContent(stack), 'utf-8')
  }

  // Staleness check: compare Dockerfile hash with the one embedded in the image label
  const content = await fs.readFile(dockerfilePath, 'utf-8')
  const currentHash = crypto.createHash('sha256').update(content).digest('hex')

  let imageHash = ''
  try {
    const { stdout } = await execFileAsync('docker', [
      'inspect', '--format', '{{index .Config.Labels "dockerfile-hash"}}', imageName,
    ])
    imageHash = stdout.trim()
  } catch {
    // Image doesn't exist yet
  }

  if (currentHash === imageHash) {
    return imageName
  }

  // Build image
  const buildArgs = [
    'build',
    '--label', `dockerfile-hash=${currentHash}`,
    '-f', dockerfilePath,
    '-t', imageName,
  ]

  if (javaVersion && (stack === 'java-gradle' || stack === 'java-maven')) {
    buildArgs.push('--build-arg', `JAVA_VERSION=${javaVersion}`)
  }

  buildArgs.push(dockerDir)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('docker', buildArgs, { stdio: 'inherit' })
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`docker build exited with code ${code}`)))
    proc.on('error', reject)
  })

  return imageName
}

// =============================================================================
// Run command in container
// =============================================================================

/**
 * Run a shell command inside the CI Docker container.
 * Mounts projectDir as /home/runner/work.
 * Streams output to process.stdout/stderr by default.
 */
export async function runInContainer(options: DockerRunOptions): Promise<DockerRunResult> {
  const { projectDir, command, timeout = 600, stream = true, user } = options
  const stack = await detectStackFromDir(projectDir)
  const imageName = getImageName(stack)

  const isInteractive = process.stdin.isTTY && stream
  const dockerArgs = [
    'run', '--rm',
    ...(isInteractive ? ['-it'] : []),
    '--stop-timeout', '30',
    '--entrypoint', '',
    ...(user ? ['--user', user] : []),
    '-v', `${projectDir}:/home/runner/work`,
    '-e', 'CI=true',
    imageName,
    'timeout', String(timeout), 'bash', '-c', command,
  ]

  return new Promise<DockerRunResult>((resolve, reject) => {
    const proc = spawn('docker', dockerArgs, {
      stdio: stream ? 'inherit' : 'pipe',
    })

    let stdout = ''
    let stderr = ''

    if (!stream) {
      proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    }

    proc.on('close', code => resolve({ exitCode: code ?? 1, stdout, stderr }))
    proc.on('error', reject)
  })
}

/**
 * Open an interactive shell inside the CI container.
 */
export async function openShell(projectDir: string): Promise<void> {
  const stack = await detectStackFromDir(projectDir)
  const imageName = getImageName(stack)

  await new Promise<void>((resolve, reject) => {
    const proc = spawn('docker', [
      'run', '--rm', '-it',
      '--entrypoint', '',
      '-v', `${projectDir}:/home/runner/work`,
      '-e', 'CI=true',
      imageName,
      'bash', '-c', 'cd /home/runner/work && exec bash',
    ], { stdio: 'inherit' })

    proc.on('close', () => resolve())
    proc.on('error', reject)
  })
}

// =============================================================================
// Internal helpers
// =============================================================================

async function detectStackFromDir(projectDir: string): Promise<Stack> {
  if (await fs.pathExists(path.join(projectDir, 'build.gradle.kts'))) return 'java-gradle'
  if (await fs.pathExists(path.join(projectDir, 'build.gradle'))) return 'java-gradle'
  if (await fs.pathExists(path.join(projectDir, 'pom.xml'))) return 'java-maven'
  if (await fs.pathExists(path.join(projectDir, 'package.json'))) return 'node'
  if (await fs.pathExists(path.join(projectDir, 'go.mod'))) return 'go'
  if (await fs.pathExists(path.join(projectDir, 'Cargo.toml'))) return 'rust'
  if (
    await fs.pathExists(path.join(projectDir, 'pyproject.toml')) ||
    await fs.pathExists(path.join(projectDir, 'requirements.txt')) ||
    await fs.pathExists(path.join(projectDir, 'setup.py'))
  ) return 'python'
  return 'node' // fallback
}
