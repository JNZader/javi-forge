import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock('fs-extra', () => {
  const mockFs = {
    pathExists: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    readJson: vi.fn(),
    ensureDir: vi.fn(),
  }
  return { default: mockFs, ...mockFs }
})

// ── Mock frontmatter ────────────────────────────────────────────────────────
vi.mock('../lib/frontmatter.js', () => ({
  parseFrontmatter: vi.fn(),
}))

import fs from 'fs-extra'
import { parseFrontmatter } from '../lib/frontmatter.js'
import {
  estimateTokens,
  extractCriticalRules,
  extractTriggers,
  detectRuleConflict,
  discoverSkills,
  findConflicts,
  calculateBudget,
  findDuplicates,
  runSkillsDoctor,
  parseSkillFile,
  scoreCompleteness,
  scoreClarity,
  scoreTestability,
  scoreTokenEfficiency,
  scoreSkill,
  benchmarkSkill,
} from './skills.js'

const mockedFs = vi.mocked(fs)
const mockedParseFrontmatter = vi.mocked(parseFrontmatter)

beforeEach(() => {
  vi.resetAllMocks()
})

// ── estimateTokens ──────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('estimates tokens from character count', () => {
    expect(estimateTokens('hello world')).toBe(3) // 11 chars / 4 = 2.75 → 3
  })

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('handles long content', () => {
    const content = 'a'.repeat(4000)
    expect(estimateTokens(content)).toBe(1000)
  })
})

// ── extractCriticalRules ────────────────────────────────────────────────────

describe('extractCriticalRules', () => {
  it('extracts numbered rules from Critical Rules section', () => {
    const content = `
## Critical Rules

1. Always use semicolons
2. Prefer named exports over default exports
3. No any types allowed

## Other Section
`
    const rules = extractCriticalRules(content)
    expect(rules).toHaveLength(3)
    expect(rules[0]).toBe('Always use semicolons')
    expect(rules[1]).toBe('Prefer named exports over default exports')
    expect(rules[2]).toBe('No any types allowed')
  })

  it('extracts bullet rules from Critical Rules section', () => {
    const content = `
## Critical Rules

- Use tabs for indentation
- Always write tests first

## Next
`
    const rules = extractCriticalRules(content)
    expect(rules).toHaveLength(2)
    expect(rules[0]).toBe('Use tabs for indentation')
  })

  it('falls back to Rules section if no Critical Rules', () => {
    const content = `
## Rules

1. Use functional components only
2. No class-based patterns

## End
`
    const rules = extractCriticalRules(content)
    expect(rules).toHaveLength(2)
    expect(rules[0]).toBe('Use functional components only')
  })

  it('returns empty array when no rules found', () => {
    const content = `## Some Section\n\nJust text here.\n`
    const rules = extractCriticalRules(content)
    expect(rules).toHaveLength(0)
  })

  it('filters out very short rules', () => {
    const content = `\n## Critical Rules\n\n1. Yes\n2. This is a proper rule statement\n`
    const rules = extractCriticalRules(content)
    expect(rules).toHaveLength(1)
    expect(rules[0]).toBe('This is a proper rule statement')
  })
})

// ── extractTriggers ─────────────────────────────────────────────────────────

describe('extractTriggers', () => {
  it('extracts trigger keywords from description', () => {
    const desc = 'React 19 patterns. Trigger: When writing React components, hooks, or JSX'
    const triggers = extractTriggers(desc)
    expect(triggers.length).toBeGreaterThan(0)
    expect(triggers.some(t => t.includes('react'))).toBe(true)
  })

  it('returns empty for descriptions without Trigger:', () => {
    const desc = 'A general utility skill for stuff'
    const triggers = extractTriggers(desc)
    expect(triggers).toHaveLength(0)
  })

  it('splits on commas and or', () => {
    const desc = 'Trigger: When using Zod, validation, or schema design'
    const triggers = extractTriggers(desc)
    expect(triggers.length).toBeGreaterThanOrEqual(2)
  })
})

// ── detectRuleConflict ──────────────────────────────────────────────────────

describe('detectRuleConflict', () => {
  it('detects semicolon contradiction', () => {
    const result = detectRuleConflict('Always use semicolons', 'No semicolons allowed')
    expect(result).toBeTruthy()
  })

  it('detects quote style contradiction', () => {
    const result = detectRuleConflict('Use single quotes for strings', 'Use double quotes for strings')
    expect(result).toBeTruthy()
  })

  it('detects tabs vs spaces contradiction', () => {
    const result = detectRuleConflict('Use tabs for indentation', 'Use spaces for indentation')
    expect(result).toBeTruthy()
  })

  it('detects functional vs class-based contradiction', () => {
    const result = detectRuleConflict(
      'Always use class-based components',
      'Always use functional components'
    )
    expect(result).toBeTruthy()
  })

  it('returns null for non-conflicting rules', () => {
    const result = detectRuleConflict('Always write tests', 'Use TypeScript strict mode')
    expect(result).toBeNull()
  })

  it('detects default vs named export contradiction', () => {
    const result = detectRuleConflict(
      'Prefer default export for components',
      'Always use named export for modules'
    )
    expect(result).toBeTruthy()
  })
})

// ── discoverSkills ──────────────────────────────────────────────────────────

describe('discoverSkills', () => {
  it('discovers SKILL.md files in subdirectories', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s.endsWith('skills')) return true as never
      if (s.endsWith('SKILL.md')) return true as never
      return false as never
    })
    mockedFs.readdir.mockResolvedValue(['react-19', 'typescript', '.hidden', '_shared'] as never)

    const skills = await discoverSkills('/home/test/.claude/skills')
    expect(skills).toHaveLength(2)
    expect(skills[0]).toContain('react-19')
    expect(skills[1]).toContain('typescript')
  })

  it('returns empty array if dir does not exist', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const skills = await discoverSkills('/nonexistent')
    expect(skills).toHaveLength(0)
  })

  it('skips entries without SKILL.md', async () => {
    mockedFs.pathExists.mockImplementation(async (p: unknown) => {
      const s = String(p)
      if (s === '/home/test/.claude/skills') return true as never
      // Only the "has-skill" directory has a SKILL.md
      if (s.includes('/has-skill/SKILL.md')) return true as never
      return false as never
    })
    mockedFs.readdir.mockResolvedValue(['has-skill', 'no-skill'] as never)

    const skills = await discoverSkills('/home/test/.claude/skills')
    expect(skills).toHaveLength(1)
    expect(skills[0]).toContain('has-skill')
  })
})

// ── parseSkillFile ──────────────────────────────────────────────────────────

describe('parseSkillFile', () => {
  it('parses a skill file with frontmatter', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue('---\nname: test-skill\ndescription: A test. Trigger: When testing\n---\n\n## Critical Rules\n\n1. Always test first before shipping\n' as never)
    mockedParseFrontmatter.mockReturnValue({
      data: { name: 'test-skill', description: 'A test. Trigger: When testing' },
      content: '\n## Critical Rules\n\n1. Always test first before shipping\n',
    })

    const result = await parseSkillFile('/skills/test/SKILL.md')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('test-skill')
    expect(result!.rules).toHaveLength(1)
    expect(result!.triggers.length).toBeGreaterThan(0)
  })

  it('returns null for nonexistent file', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const result = await parseSkillFile('/nonexistent/SKILL.md')
    expect(result).toBeNull()
  })

  it('uses directory name when frontmatter has no name', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue('Just content, no frontmatter' as never)
    mockedParseFrontmatter.mockReturnValue(null)

    const result = await parseSkillFile('/skills/my-skill/SKILL.md')
    expect(result).not.toBeNull()
    expect(result!.name).toBe('my-skill')
  })
})

// ── findConflicts ───────────────────────────────────────────────────────────

describe('findConflicts', () => {
  it('detects conflicts between skills', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readdir.mockResolvedValue(['skill-a', 'skill-b'] as never)

    let callCount = 0
    mockedFs.readFile.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return '---\nname: skill-a\ndescription: test\n---\n## Critical Rules\n1. Always use semicolons\n' as never
      }
      return '---\nname: skill-b\ndescription: test\n---\n## Critical Rules\n1. No semicolons allowed\n' as never
    })

    mockedParseFrontmatter.mockImplementation((raw: string) => {
      if (raw.includes('skill-a')) {
        return {
          data: { name: 'skill-a', description: 'test' },
          content: '\n## Critical Rules\n\n1. Always use semicolons in code\n',
        }
      }
      return {
        data: { name: 'skill-b', description: 'test' },
        content: '\n## Critical Rules\n\n1. No semicolons allowed in code\n',
      }
    })

    const conflicts = await findConflicts('/skills')
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].ruleA.skillName).toBe('skill-a')
    expect(conflicts[0].ruleB.skillName).toBe('skill-b')
  })

  it('does not flag rules from the same skill', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readdir.mockResolvedValue(['skill-a'] as never)
    mockedFs.readFile.mockResolvedValue('---\nname: skill-a\ndescription: test\n---\n## Critical Rules\n1. Use tabs\n2. Use spaces\n' as never)
    mockedParseFrontmatter.mockReturnValue({
      data: { name: 'skill-a', description: 'test' },
      content: '## Critical Rules\n1. Use tabs\n2. Use spaces\n',
    })

    const conflicts = await findConflicts('/skills')
    expect(conflicts).toHaveLength(0)
  })

  it('returns empty when no skills found', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const conflicts = await findConflicts('/nonexistent')
    expect(conflicts).toHaveLength(0)
  })
})

// ── calculateBudget ─────────────────────────────────────────────────────────

describe('calculateBudget', () => {
  it('calculates total tokens for all skills', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readdir.mockResolvedValue(['skill-a', 'skill-b'] as never)

    let callCount = 0
    mockedFs.readFile.mockImplementation(async () => {
      callCount++
      // ~100 chars = 25 tokens, ~200 chars = 50 tokens
      if (callCount === 1) return 'a'.repeat(100) as never
      return 'b'.repeat(200) as never
    })

    mockedParseFrontmatter.mockImplementation((raw: string) => ({
      data: { name: raw.startsWith('a') ? 'skill-a' : 'skill-b', description: 'test' },
      content: raw,
    }))

    const result = await calculateBudget('/skills', 8000)
    expect(result.entries).toHaveLength(2)
    expect(result.totalTokens).toBe(75) // 25 + 50
    expect(result.overBudget).toBe(false)
    expect(result.suggestions).toHaveLength(0)
  })

  it('reports over budget with suggestions', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readdir.mockResolvedValue(['big-skill'] as never)
    mockedFs.readFile.mockResolvedValue('x'.repeat(40000) as never) // 10000 tokens
    mockedParseFrontmatter.mockReturnValue({
      data: { name: 'big-skill', description: 'test' },
      content: 'x'.repeat(40000),
    })

    const result = await calculateBudget('/skills', 5000)
    expect(result.overBudget).toBe(true)
    expect(result.totalTokens).toBe(10000)
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions[0]).toContain('Over budget')
  })

  it('returns empty result for nonexistent dir', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const result = await calculateBudget('/nonexistent')
    expect(result.entries).toHaveLength(0)
    expect(result.totalTokens).toBe(0)
    expect(result.overBudget).toBe(false)
  })

  it('sorts entries by token count descending', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readdir.mockResolvedValue(['small', 'large'] as never)

    let callCount = 0
    mockedFs.readFile.mockImplementation(async () => {
      callCount++
      if (callCount === 1) return 'a'.repeat(40) as never  // 10 tokens
      return 'b'.repeat(400) as never                       // 100 tokens
    })

    mockedParseFrontmatter.mockImplementation((raw: string) => ({
      data: { name: raw.startsWith('a') ? 'small' : 'large', description: 'test' },
      content: raw,
    }))

    const result = await calculateBudget('/skills')
    expect(result.entries[0].skillName).toBe('large')
    expect(result.entries[1].skillName).toBe('small')
  })
})

// ── findDuplicates ──────────────────────────────────────────────────────────

describe('findDuplicates', () => {
  it('detects skills with overlapping triggers', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readdir.mockResolvedValue(['react-skill', 'jsx-skill'] as never)

    let callCount = 0
    mockedFs.readFile.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return '---\nname: react-skill\ndescription: "Trigger: react components, hooks, JSX"\n---\ncontent' as never
      }
      return '---\nname: jsx-skill\ndescription: "Trigger: JSX, react patterns, components"\n---\ncontent' as never
    })

    mockedParseFrontmatter.mockImplementation((raw: string) => {
      if (raw.includes('react-skill')) {
        return {
          data: { name: 'react-skill', description: 'Trigger: react components, hooks, JSX' },
          content: 'content',
        }
      }
      return {
        data: { name: 'jsx-skill', description: 'Trigger: JSX, react patterns, components' },
        content: 'content',
      }
    })

    const duplicates = await findDuplicates('/skills')
    expect(duplicates.length).toBeGreaterThan(0)
    expect(duplicates[0].skillA).toBe('react-skill')
    expect(duplicates[0].skillB).toBe('jsx-skill')
    expect(duplicates[0].similarity).toBeGreaterThanOrEqual(30)
  })

  it('returns empty for skills with no trigger overlap', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readdir.mockResolvedValue(['python-skill', 'rust-skill'] as never)

    let callCount = 0
    mockedFs.readFile.mockImplementation(async () => {
      callCount++
      if (callCount === 1) {
        return '---\nname: python-skill\ndescription: "Trigger: python, django, pip"\n---\nc' as never
      }
      return '---\nname: rust-skill\ndescription: "Trigger: rust, cargo, crate"\n---\nc' as never
    })

    mockedParseFrontmatter.mockImplementation((raw: string) => {
      if (raw.includes('python')) {
        return {
          data: { name: 'python-skill', description: 'Trigger: python, django, pip' },
          content: 'c',
        }
      }
      return {
        data: { name: 'rust-skill', description: 'Trigger: rust, cargo, crate' },
        content: 'c',
      }
    })

    const duplicates = await findDuplicates('/skills')
    expect(duplicates).toHaveLength(0)
  })
})

// ── runSkillsDoctor ─────────────────────────────────────────────────────────

describe('runSkillsDoctor', () => {
  it('runs budget-only mode', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never) // no skills dir

    const result = await runSkillsDoctor({
      mode: 'budget',
      skillsDir: '/nonexistent',
      budget: 5000,
    })

    expect(result.conflicts).toHaveLength(0)
    expect(result.duplicates).toHaveLength(0)
    expect(result.budget.budget).toBe(5000)
  })

  it('runs deep doctor mode', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never) // no skills

    const result = await runSkillsDoctor({
      mode: 'doctor',
      skillsDir: '/nonexistent',
      deep: true,
    })

    expect(result.conflicts).toHaveLength(0)
    expect(result.duplicates).toHaveLength(0)
    expect(result.budget.entries).toHaveLength(0)
  })

  it('skips conflict/duplicate in non-deep mode', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)

    const result = await runSkillsDoctor({
      mode: 'doctor',
      skillsDir: '/nonexistent',
      deep: false,
    })

    expect(result.conflicts).toHaveLength(0)
    expect(result.duplicates).toHaveLength(0)
  })
})

// ── scoreCompleteness ──────────────────────────────────────────────────────

describe('scoreCompleteness', () => {
  it('scores a well-formed skill highly', () => {
    const parsed = {
      name: 'react-19',
      rules: [
        'Always use functional components',
        'Never use class-based components',
        'Prefer named exports over default exports',
        'Use TypeScript strict mode always',
        'Write tests before shipping code',
        'Follow atomic design for component structure',
      ],
      rawContent: 'a'.repeat(1200),
      triggers: ['writing react components', 'hooks', 'JSX'],
    }
    const score = scoreCompleteness(parsed)
    expect(score).toBeGreaterThanOrEqual(70)
  })

  it('scores a minimal skill low', () => {
    const parsed = {
      name: 'x',
      rules: [],
      rawContent: 'short',
      triggers: [],
    }
    const score = scoreCompleteness(parsed)
    expect(score).toBeLessThan(30)
  })

  it('gives partial credit for some fields', () => {
    const parsed = {
      name: 'my-skill',
      rules: ['Always use semicolons'],
      rawContent: 'a'.repeat(300),
      triggers: [],
    }
    const score = scoreCompleteness(parsed)
    expect(score).toBeGreaterThanOrEqual(30)
    expect(score).toBeLessThan(80)
  })
})

// ── scoreClarity ───────────────────────────────────────────────────────────

describe('scoreClarity', () => {
  it('scores actionable rules high', () => {
    const parsed = {
      name: 'typescript',
      rules: [
        'Always use strict mode',
        'Never use any type',
        'Prefer interfaces over type aliases',
        'Must write return types explicitly',
      ],
      rawContent: '## Rules\n\n1. Always use strict mode\n2. Never use any type\n',
      triggers: ['typescript', 'types', 'interfaces'],
    }
    const score = scoreClarity(parsed)
    expect(score).toBeGreaterThanOrEqual(60)
  })

  it('penalizes vague rules', () => {
    const parsed = {
      name: 'vague-skill',
      rules: [
        'Do various things with stuff',
        'Handle some things probably',
        'Maybe use this etc',
      ],
      rawContent: '## Rules\nDo various things\n',
      triggers: ['test'],
    }
    const score = scoreClarity(parsed)
    expect(score).toBeLessThan(60)
  })

  it('returns 0 minimum, never negative', () => {
    const parsed = {
      name: '',
      rules: ['stuff things etc various some maybe probably misc'],
      rawContent: '',
      triggers: [],
    }
    const score = scoreClarity(parsed)
    expect(score).toBeGreaterThanOrEqual(0)
  })
})

// ── scoreTestability ───────────────────────────────────────────────────────

describe('scoreTestability', () => {
  it('scores skills with Given/When/Then highly', () => {
    const parsed = {
      name: 'testable-skill',
      rules: ['Use `vitest` for testing files', 'Write tests in `*.test.ts` path'],
      rawContent: [
        '## Testing',
        '```typescript',
        'test("example", () => {})',
        '```',
        '#### Scenario: Happy path',
        'GIVEN a user is logged in',
        'WHEN they click submit',
        'THEN the form saves',
        '#### Scenario: Error',
        'GIVEN invalid input',
        'WHEN they submit',
        'THEN an error shows',
        '#### Scenario: Edge',
        'GIVEN empty form',
        'WHEN submitted',
        'THEN validation fires',
      ].join('\n'),
      triggers: ['testing'],
    }
    const score = scoreTestability(parsed)
    expect(score).toBeGreaterThanOrEqual(60)
  })

  it('scores skills without scenarios low', () => {
    const parsed = {
      name: 'no-tests',
      rules: ['Do something'],
      rawContent: 'Just a basic skill with no testing guidance',
      triggers: [],
    }
    const score = scoreTestability(parsed)
    expect(score).toBeLessThan(30)
  })
})

// ── scoreTokenEfficiency ───────────────────────────────────────────────────

describe('scoreTokenEfficiency', () => {
  it('scores efficient skills high', () => {
    // 5 rules in ~1000 tokens = 5 rules/kToken → ideal range
    const parsed = {
      name: 'efficient',
      rules: ['Rule 1 always', 'Rule 2 never', 'Rule 3 use this', 'Rule 4 avoid that', 'Rule 5 prefer X'],
      rawContent: 'a'.repeat(4000), // 1000 tokens
      triggers: [],
    }
    const score = scoreTokenEfficiency(parsed)
    expect(score).toBeGreaterThanOrEqual(80)
  })

  it('scores bloated skills low', () => {
    // 1 rule in 6000 tokens = very bloated
    const parsed = {
      name: 'bloated',
      rules: ['Only one rule here'],
      rawContent: 'a'.repeat(24000), // 6000 tokens
      triggers: [],
    }
    const score = scoreTokenEfficiency(parsed)
    expect(score).toBeLessThan(50)
  })

  it('returns 0 for empty content', () => {
    const parsed = {
      name: 'empty',
      rules: [],
      rawContent: '',
      triggers: [],
    }
    const score = scoreTokenEfficiency(parsed)
    expect(score).toBe(0)
  })
})

// ── scoreSkill ─────────────────────────────────────────────────────────────

describe('scoreSkill', () => {
  it('returns null for nonexistent skill', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const result = await scoreSkill('/nonexistent/SKILL.md')
    expect(result).toBeNull()
  })

  it('returns a complete score object for a valid skill', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue(
      '---\nname: test-skill\ndescription: "A skill. Trigger: When testing, debugging"\n---\n\n## Critical Rules\n\n1. Always write tests first\n2. Use strict TypeScript mode\n3. Never skip error handling\n\n## Examples\n\n```ts\ntest("works", () => {})\n```\n' as never
    )
    mockedParseFrontmatter.mockReturnValue({
      data: { name: 'test-skill', description: 'A skill. Trigger: When testing, debugging' },
      content: '\n## Critical Rules\n\n1. Always write tests first\n2. Use strict TypeScript mode\n3. Never skip error handling\n\n## Examples\n\n```ts\ntest("works", () => {})\n```\n',
    })

    const result = await scoreSkill('/skills/test/SKILL.md', 50)
    expect(result).not.toBeNull()
    expect(result!.skillName).toBe('test-skill')
    expect(result!.completeness).toBeGreaterThanOrEqual(0)
    expect(result!.completeness).toBeLessThanOrEqual(100)
    expect(result!.clarity).toBeGreaterThanOrEqual(0)
    expect(result!.clarity).toBeLessThanOrEqual(100)
    expect(result!.testability).toBeGreaterThanOrEqual(0)
    expect(result!.testability).toBeLessThanOrEqual(100)
    expect(result!.tokenEfficiency).toBeGreaterThanOrEqual(0)
    expect(result!.tokenEfficiency).toBeLessThanOrEqual(100)
    expect(result!.overall).toBeGreaterThanOrEqual(0)
    expect(result!.overall).toBeLessThanOrEqual(100)
    expect(result!.threshold).toBe(50)
    expect(typeof result!.passing).toBe('boolean')
  })

  it('marks skill as failing when below threshold', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue('minimal content' as never)
    mockedParseFrontmatter.mockReturnValue(null)

    const result = await scoreSkill('/skills/bad/SKILL.md', 90)
    expect(result).not.toBeNull()
    expect(result!.passing).toBe(false)
    expect(result!.overall).toBeLessThan(90)
  })
})

// ── benchmarkSkill ─────────────────────────────────────────────────────────

describe('benchmarkSkill', () => {
  it('returns null for nonexistent skill', async () => {
    mockedFs.pathExists.mockResolvedValue(false as never)
    const result = await benchmarkSkill('/nonexistent/SKILL.md')
    expect(result).toBeNull()
  })

  it('runs all benchmark checks on a valid skill', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue(
      '---\nname: good-skill\ndescription: "Quality skill. Trigger: When coding, testing"\n---\n\n## Purpose\n\nA good skill.\n\n## Critical Rules\n\n1. Always use strict mode for TypeScript\n2. Never skip error handling in production\n3. Prefer composition over inheritance patterns\n\n## Examples\n\n```ts\nconst x = 1\n```\n' as never
    )
    mockedParseFrontmatter.mockReturnValue({
      data: { name: 'good-skill', description: 'Quality skill. Trigger: When coding, testing' },
      content: '\n## Purpose\n\nA good skill.\n\n## Critical Rules\n\n1. Always use strict mode for TypeScript\n2. Never skip error handling in production\n3. Prefer composition over inheritance patterns\n\n## Examples\n\n```ts\nconst x = 1\n```\n',
    })

    const result = await benchmarkSkill('/skills/good/SKILL.md')
    expect(result).not.toBeNull()
    expect(result!.skillName).toBe('good-skill')
    expect(result!.checks.length).toBe(8)
    expect(result!.passRate).toBeGreaterThanOrEqual(0)
    expect(result!.passRate).toBeLessThanOrEqual(100)

    // Verify specific checks exist
    const checkNames = result!.checks.map(c => c.name)
    expect(checkNames).toContain('has-frontmatter-name')
    expect(checkNames).toContain('has-triggers')
    expect(checkNames).toContain('has-critical-rules')
    expect(checkNames).toContain('rules-actionable')
    expect(checkNames).toContain('has-code-examples')
    expect(checkNames).toContain('has-sections')
    expect(checkNames).toContain('token-budget-ok')
    expect(checkNames).toContain('no-vague-rules')
  })

  it('fails checks for a poor skill', async () => {
    mockedFs.pathExists.mockResolvedValue(true as never)
    mockedFs.readFile.mockResolvedValue('Just some text with no structure' as never)
    mockedParseFrontmatter.mockReturnValue(null)

    const result = await benchmarkSkill('/skills/bad/SKILL.md')
    expect(result).not.toBeNull()
    expect(result!.passRate).toBeLessThan(50)
  })
})
