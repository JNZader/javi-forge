import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs-extra'
import path from 'path'
import { validatePlugin } from '../lib/plugin.js'
import { createTempDir, cleanupTempDir } from './helpers.js'

let tmpDir: string

describe('validatePlugin() — integration', () => {
  beforeEach(async () => {
    tmpDir = await createTempDir('plugin-test-')
  })

  afterEach(async () => {
    await cleanupTempDir(tmpDir)
  })

  it('valid plugin with all required fields passes', async () => {
    await fs.writeJson(path.join(tmpDir, 'plugin.json'), {
      name: 'my-plugin',
      version: '1.0.0',
      description: 'A test plugin for validation testing',
    })

    const result = await validatePlugin(tmpDir)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.manifest?.name).toBe('my-plugin')
  })

  it('missing plugin.json fails validation', async () => {
    const result = await validatePlugin(tmpDir)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('plugin.json'))).toBe(true)
  })

  it('invalid JSON in plugin.json fails', async () => {
    await fs.writeFile(path.join(tmpDir, 'plugin.json'), '{ invalid json }')

    const result = await validatePlugin(tmpDir)
    expect(result.valid).toBe(false)
  })

  it('missing required fields fails', async () => {
    await fs.writeJson(path.join(tmpDir, 'plugin.json'), {
      name: 'my-plugin',
      // missing version and description
    })

    const result = await validatePlugin(tmpDir)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('name with invalid format fails (not kebab-case)', async () => {
    await fs.writeJson(path.join(tmpDir, 'plugin.json'), {
      name: 'MyPlugin',
      version: '1.0.0',
      description: 'A test plugin for validation testing',
    })

    const result = await validatePlugin(tmpDir)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.path === 'name')).toBe(true)
  })

  it('declared skills directory must exist', async () => {
    await fs.writeJson(path.join(tmpDir, 'plugin.json'), {
      name: 'skill-plugin',
      version: '1.0.0',
      description: 'A test plugin with declared skills',
      skills: ['my-skill'],
    })
    // skills/ directory NOT created

    const result = await validatePlugin(tmpDir)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.message.includes('skills'))).toBe(true)
  })

  it('declared skills directory and entries exist: passes', async () => {
    await fs.writeJson(path.join(tmpDir, 'plugin.json'), {
      name: 'skill-plugin',
      version: '1.0.0',
      description: 'A test plugin with declared skills',
      skills: ['my-skill'],
    })
    await fs.ensureDir(path.join(tmpDir, 'skills'))
    // Each declared skill entry must also exist
    await fs.ensureDir(path.join(tmpDir, 'skills', 'my-skill'))

    const result = await validatePlugin(tmpDir)
    expect(result.valid).toBe(true)
  })
})
