import { describe, it, expect } from 'vitest'
import { generateClaudeMd, buildClaudeMd, generateSmartClaudeMd, buildSmartClaudeMd } from './claudemd.js'
import { STACK_CLAUDEMD_MAP } from '../constants.js'
import type { InitOptions } from '../types/index.js'
import type { StackDetectionResult } from './stack-detector.js'

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
    securityHooks: false,
    dockerDeploy: false,
    dockerServiceName: 'app',
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

// ═══════════════════════════════════════════════════════════════════════════════
// buildSmartClaudeMd
// ═══════════════════════════════════════════════════════════════════════════════
describe('buildSmartClaudeMd', () => {
  it('includes detected skills in Skills section', () => {
    const entry = STACK_CLAUDEMD_MAP['node']
    const result = buildSmartClaudeMd('my-app', 'node', entry, ['react-19', 'zustand-5'], false, [])

    expect(result).toContain('## Skills (auto-detected)')
    expect(result).toContain('~/.claude/skills/react-19/SKILL.md')
    expect(result).toContain('~/.claude/skills/zustand-5/SKILL.md')
  })

  it('merges detected skills with static entry skills (deduped)', () => {
    const entry = { skills: ['typescript', 'react-19'], conventions: 'test', testFramework: 'vitest' }
    const result = buildSmartClaudeMd('proj', 'node', entry, ['react-19', 'tailwind-4'], false, [])

    // react-19 should appear only once
    const matches = result.match(/react-19\/SKILL\.md/g)
    expect(matches).toHaveLength(1)

    // All three skills should be present
    expect(result).toContain('typescript/SKILL.md')
    expect(result).toContain('react-19/SKILL.md')
    expect(result).toContain('tailwind-4/SKILL.md')
  })

  it('includes Architecture Patterns section for detected skills', () => {
    const entry = STACK_CLAUDEMD_MAP['node']
    const result = buildSmartClaudeMd('proj', 'node', entry, ['react-19', 'zustand-5'], false, [])

    expect(result).toContain('## Architecture Patterns')
    expect(result).toContain('Container-Presentational pattern')
    expect(result).toContain('Slice pattern for store modules')
  })

  it('omits Architecture Patterns when no patterns match', () => {
    const entry = STACK_CLAUDEMD_MAP['go']
    const result = buildSmartClaudeMd('proj', 'go', entry, [], false, [])

    expect(result).not.toContain('## Architecture Patterns')
  })

  it('includes Plugin instructions for matching skills', () => {
    const entry = STACK_CLAUDEMD_MAP['node']
    const result = buildSmartClaudeMd('proj', 'node', entry, ['react-19', 'typescript'], false, [])

    expect(result).toContain('## Plugins')
    expect(result).toContain('merge-checks')
    expect(result).toContain('javi-forge skills doctor')
  })

  it('omits Plugins section when no hints match', () => {
    const entry = STACK_CLAUDEMD_MAP['go']
    const result = buildSmartClaudeMd('proj', 'go', entry, [], false, [])

    expect(result).not.toContain('## Plugins')
  })

  it('deduplicates plugin hints across skills', () => {
    const entry = STACK_CLAUDEMD_MAP['node']
    // react-19 and nextjs-15 both map to the same merge-checks hint
    const result = buildSmartClaudeMd('proj', 'node', entry, ['react-19', 'nextjs-15'], false, [])

    const matches = result.match(/merge-checks/g)
    expect(matches).toHaveLength(1)
  })

  it('includes Project Context when contextDir is true', () => {
    const entry = STACK_CLAUDEMD_MAP['node']
    const result = buildSmartClaudeMd('proj', 'node', entry, ['typescript'], true, [])

    expect(result).toContain('## Project Context')
    expect(result).toContain('.context/INDEX.md')
  })

  it('includes Modules section when modules are provided', () => {
    const entry = STACK_CLAUDEMD_MAP['node']
    const result = buildSmartClaudeMd('proj', 'node', entry, [], false, ['sdd', 'engram'])

    expect(result).toContain('## Modules')
    expect(result).toContain('sdd, engram')
  })

  it('output is under 8000 chars for a fully-loaded project', () => {
    const entry = STACK_CLAUDEMD_MAP['node']
    const allSkills = ['react-19', 'nextjs-15', 'typescript', 'tailwind-4', 'zustand-5', 'zod-4', 'playwright']
    const result = buildSmartClaudeMd('mega-proj', 'node', entry, allSkills, true, ['sdd', 'engram', 'ghagga'])

    expect(result.length).toBeLessThan(8000)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// generateSmartClaudeMd
// ═══════════════════════════════════════════════════════════════════════════════
describe('generateSmartClaudeMd', () => {
  const detection: StackDetectionResult = {
    stack: 'node',
    signals: [
      { signal: 'react', source: 'package.json', skills: ['react-19'] },
      { signal: 'tailwindcss', source: 'package.json', skills: ['tailwind-4'] },
      { signal: 'tsconfig.json', source: 'file exists', skills: ['typescript'] },
    ],
    recommendedSkills: ['react-19', 'tailwind-4', 'typescript'],
  }

  it('uses detected skills when detection result is provided', () => {
    const result = generateSmartClaudeMd(makeOptions({ stack: 'node' }), detection)

    expect(result).toContain('## Skills (auto-detected)')
    expect(result).toContain('react-19/SKILL.md')
    expect(result).toContain('tailwind-4/SKILL.md')
    expect(result).toContain('typescript/SKILL.md')
  })

  it('falls back to static generation when detection is null', () => {
    const result = generateSmartClaudeMd(makeOptions({ stack: 'node' }), null)

    // Should use the old-style section name
    expect(result).toContain('## Recommended Skills')
    expect(result).not.toContain('## Skills (auto-detected)')
  })

  it('falls back to static generation when no skills detected', () => {
    const emptyDetection: StackDetectionResult = {
      stack: 'go',
      signals: [],
      recommendedSkills: [],
    }

    const result = generateSmartClaudeMd(makeOptions({ stack: 'go' }), emptyDetection)

    // Should use static generation (go has no skills, so no section)
    expect(result).not.toContain('## Skills (auto-detected)')
  })

  it('includes architecture patterns from detected skills', () => {
    const result = generateSmartClaudeMd(makeOptions({ stack: 'node' }), detection)

    expect(result).toContain('## Architecture Patterns')
    expect(result).toContain('Container-Presentational pattern')
    expect(result).toContain('Utility-first CSS')
  })

  it('includes modules from options', () => {
    const result = generateSmartClaudeMd(
      makeOptions({ stack: 'node', aiSync: true, sdd: true }),
      detection
    )

    expect(result).toContain('## Modules')
    expect(result).toContain('ai-sync')
    expect(result).toContain('sdd')
  })
})
