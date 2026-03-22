import { describe, it, expect, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs-extra'
import { getImageName, getDockerfileContent, isDockerAvailable } from './docker.js'
import type { Stack } from '../types/index.js'

// =============================================================================
// getImageName
// =============================================================================

describe('getImageName', () => {
  it('returns correct name for each stack', () => {
    const cases: [Stack, string][] = [
      ['node',        'javi-forge-ci-node'],
      ['python',      'javi-forge-ci-python'],
      ['go',          'javi-forge-ci-go'],
      ['rust',        'javi-forge-ci-rust'],
      ['java-gradle', 'javi-forge-ci-java-gradle'],
      ['java-maven',  'javi-forge-ci-java-maven'],
    ]
    for (const [stack, expected] of cases) {
      expect(getImageName(stack)).toBe(expected)
    }
  })
})

// =============================================================================
// getDockerfileContent
// =============================================================================

describe('getDockerfileContent', () => {
  it('node Dockerfile uses node:22-slim and installs pnpm', () => {
    const content = getDockerfileContent('node')
    expect(content).toContain('node:22-slim')
    expect(content).toContain('pnpm')
    expect(content).toContain('runner')
    expect(content).toContain('ENTRYPOINT ["/bin/bash", "-c"]')
  })

  it('java-gradle Dockerfile uses eclipse-temurin with ARG JAVA_VERSION', () => {
    const content = getDockerfileContent('java-gradle')
    expect(content).toContain('ARG JAVA_VERSION')
    expect(content).toContain('eclipse-temurin')
    expect(content).toContain('runner')
  })

  it('java-maven shares Dockerfile with java-gradle', () => {
    expect(getDockerfileContent('java-maven')).toBe(getDockerfileContent('java-gradle'))
  })

  it('python Dockerfile installs pytest ruff pylint', () => {
    const content = getDockerfileContent('python')
    expect(content).toContain('python:3.12-slim')
    expect(content).toContain('pytest')
    expect(content).toContain('ruff')
  })

  it('go Dockerfile installs golangci-lint', () => {
    const content = getDockerfileContent('go')
    expect(content).toContain('golang:')
    expect(content).toContain('golangci-lint')
  })

  it('rust Dockerfile adds clippy rustfmt', () => {
    const content = getDockerfileContent('rust')
    expect(content).toContain('rust:')
    expect(content).toContain('clippy')
    expect(content).toContain('rustfmt')
  })

  it('all Dockerfiles set WORKDIR /home/runner/work', () => {
    const stacks: Stack[] = ['node', 'python', 'go', 'rust', 'java-gradle', 'java-maven']
    for (const stack of stacks) {
      expect(getDockerfileContent(stack)).toContain('WORKDIR /home/runner/work')
    }
  })

  it('all Dockerfiles set ENTRYPOINT to bash -c', () => {
    const stacks: Stack[] = ['node', 'python', 'go', 'rust', 'java-gradle', 'java-maven']
    for (const stack of stacks) {
      expect(getDockerfileContent(stack)).toContain('ENTRYPOINT ["/bin/bash", "-c"]')
    }
  })

  it('elixir (unknown) falls back to ubuntu:24.04', () => {
    const content = getDockerfileContent('elixir' as Stack)
    expect(content).toContain('ubuntu:24.04')
  })
})

// =============================================================================
// isDockerAvailable — integration (skipped if Docker not running)
// =============================================================================

describe('isDockerAvailable', () => {
  it('returns a boolean', async () => {
    const result = await isDockerAvailable()
    expect(typeof result).toBe('boolean')
  })
})
