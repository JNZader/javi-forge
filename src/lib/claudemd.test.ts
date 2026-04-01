import { describe, it, expect } from 'vitest'
import { generateClaudeMd, buildClaudeMd } from './claudemd.js'
import { STACK_CLAUDEMD_MAP } from '../constants.js'
import type { InitOptions } from '../types/index.js'

const ALL_STACKS = ['node', 'python', 'go', 'rust', 'java-gradle', 'java-maven', 'elixir'] as const

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    projectName: 'test-project',
    projectDir: '/tmp/test-project',
    stack: 'node',
    ciProvider: 'github',
    memory: 'engram',
    aiSync: true,
    sdd: true,
    ghagga: false,
    mock: false,
    contextDir: true,
    claudeMd: true,
    dryRun: false,
    ...overrides,
  }
}

describe('generateClaudeMd', () => {
  it.each(ALL_STACKS)('generates valid output for stack: %s', (stack) => {
    const result = generateClaudeMd(makeOptions({ stack }))

    expect(result).toContain('# test-project')
    expect(result).toContain('## Stack')
    expect(result).toContain(`**Language/Runtime**: ${stack}`)
    expect(result).toContain('## Conventions')

    const entry = STACK_CLAUDEMD_MAP[stack]
    expect(result).toContain(entry.conventions)
    expect(result).toContain(entry.testFramework)
  })

  it('includes skill references for node stack', () => {
    const result = generateClaudeMd(makeOptions({ stack: 'node' }))

    expect(result).toContain('## Recommended Skills')
    expect(result).toContain('~/.claude/skills/typescript/SKILL.md')
    expect(result).toContain('~/.claude/skills/react-19/SKILL.md')
    expect(result).toContain('~/.claude/skills/tailwind-4/SKILL.md')
  })

  it('includes skill references for python stack', () => {
    const result = generateClaudeMd(makeOptions({ stack: 'python' }))

    expect(result).toContain('## Recommended Skills')
    expect(result).toContain('~/.claude/skills/pytest/SKILL.md')
    expect(result).toContain('~/.claude/skills/django-drf/SKILL.md')
  })

  it('omits skills section for stacks with no skills', () => {
    const result = generateClaudeMd(makeOptions({ stack: 'go' }))

    expect(result).not.toContain('## Recommended Skills')
  })

  it('falls back to default for unknown stack', () => {
    const result = generateClaudeMd(makeOptions({ stack: 'haskell' as any }))

    const defaultEntry = STACK_CLAUDEMD_MAP['default']
    expect(result).toContain(defaultEntry.conventions)
    expect(result).toContain(defaultEntry.testFramework)
    expect(result).toContain('**Language/Runtime**: haskell')
  })

  it('includes .context/ references when contextDir is true', () => {
    const result = generateClaudeMd(makeOptions({ contextDir: true }))

    expect(result).toContain('## Project Context')
    expect(result).toContain('.context/INDEX.md')
    expect(result).toContain('.context/summary.md')
  })

  it('omits .context/ references when contextDir is false', () => {
    const result = generateClaudeMd(makeOptions({ contextDir: false }))

    expect(result).not.toContain('## Project Context')
    expect(result).not.toContain('.context/INDEX.md')
    expect(result).not.toContain('.context/summary.md')
    // Other sections should still be present
    expect(result).toContain('## Stack')
    expect(result).toContain('## Conventions')
  })

  it('includes enabled modules list', () => {
    const result = generateClaudeMd(makeOptions({
      aiSync: true,
      sdd: true,
      ghagga: true,
      mock: true,
      contextDir: true,
      claudeMd: true,
    }))

    expect(result).toContain('## Modules')
    expect(result).toContain('ai-sync')
    expect(result).toContain('sdd')
    expect(result).toContain('ghagga')
    expect(result).toContain('mock')
    expect(result).toContain('context')
    expect(result).toContain('claude-md')
  })

  it('omits modules section when none enabled', () => {
    const result = generateClaudeMd(makeOptions({
      aiSync: false,
      sdd: false,
      ghagga: false,
      mock: false,
      contextDir: false,
      claudeMd: false,
    }))

    expect(result).not.toContain('## Modules')
  })

  it.each(ALL_STACKS)('output is under 8000 chars for stack: %s', (stack) => {
    const result = generateClaudeMd(makeOptions({ stack }))

    expect(result.length).toBeLessThan(8000)
  })
})

describe('buildClaudeMd', () => {
  it('produces correct heading', () => {
    const entry = STACK_CLAUDEMD_MAP['node']
    const result = buildClaudeMd('my-app', 'node', entry, false, [])

    expect(result).toMatch(/^# my-app\n/)
  })

  it('includes stack section with correct values', () => {
    const entry = STACK_CLAUDEMD_MAP['python']
    const result = buildClaudeMd('my-api', 'python', entry, false, [])

    expect(result).toContain('**Language/Runtime**: python')
    expect(result).toContain(`**Conventions**: ${entry.conventions}`)
    expect(result).toContain(`**Testing**: ${entry.testFramework}`)
  })

  it('includes skills section when skills are present', () => {
    const entry = { skills: ['typescript'], conventions: 'test', testFramework: 'vitest' }
    const result = buildClaudeMd('proj', 'node', entry, false, [])

    expect(result).toContain('## Recommended Skills')
    expect(result).toContain('~/.claude/skills/typescript/SKILL.md')
  })

  it('omits skills section when skills are empty', () => {
    const entry = { skills: [], conventions: 'test', testFramework: 'vitest' }
    const result = buildClaudeMd('proj', 'go', entry, false, [])

    expect(result).not.toContain('## Recommended Skills')
  })

  it('conditionally includes project context section', () => {
    const entry = STACK_CLAUDEMD_MAP['default']

    const withContext = buildClaudeMd('proj', 'node', entry, true, [])
    expect(withContext).toContain('## Project Context')

    const withoutContext = buildClaudeMd('proj', 'node', entry, false, [])
    expect(withoutContext).not.toContain('## Project Context')
  })

  it('includes modules when provided', () => {
    const entry = STACK_CLAUDEMD_MAP['default']
    const result = buildClaudeMd('proj', 'node', entry, false, ['ai-sync', 'sdd'])

    expect(result).toContain('## Modules')
    expect(result).toContain('ai-sync, sdd')
  })
})
