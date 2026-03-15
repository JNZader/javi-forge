import { describe, it, expect } from 'vitest'
import { parseFrontmatter, validateFrontmatter } from './frontmatter.js'

// ═══════════════════════════════════════════════════════════════════════════════
// parseFrontmatter
// ═══════════════════════════════════════════════════════════════════════════════
describe('parseFrontmatter', () => {
  it('parses valid frontmatter with content', () => {
    const raw = `---
name: my-skill
description: A test skill
---
Some body content here.`
    const result = parseFrontmatter(raw)
    expect(result).not.toBeNull()
    expect(result!.data).toEqual({ name: 'my-skill', description: 'A test skill' })
    expect(result!.content).toBe('Some body content here.')
  })

  it('returns null when no closing ---', () => {
    const raw = `---
name: broken
description: missing close`
    expect(parseFrontmatter(raw)).toBeNull()
  })

  it('returns null for non-frontmatter text', () => {
    const raw = 'Just some regular markdown text.'
    expect(parseFrontmatter(raw)).toBeNull()
  })

  it('returns null for empty YAML block', () => {
    const raw = `---
---
Body content`
    // An empty YAML block parses to null, which triggers the null check
    expect(parseFrontmatter(raw)).toBeNull()
  })

  it('returns null for invalid YAML', () => {
    const raw = `---
: : : invalid: [yaml
---
Body`
    expect(parseFrontmatter(raw)).toBeNull()
  })

  it('returns null when YAML parses to a non-object (string)', () => {
    const raw = `---
just a string
---
Body`
    expect(parseFrontmatter(raw)).toBeNull()
  })

  it('returns null when YAML parses to null', () => {
    const raw = `---
null
---
Body`
    expect(parseFrontmatter(raw)).toBeNull()
  })

  it('handles frontmatter with empty content body', () => {
    const raw = `---
name: test
---`
    const result = parseFrontmatter(raw)
    expect(result).not.toBeNull()
    expect(result!.data).toEqual({ name: 'test' })
    expect(result!.content).toBe('')
  })

  it('only uses first pair of --- delimiters', () => {
    const raw = `---
name: first
---
Some content
---
name: second
---`
    const result = parseFrontmatter(raw)
    expect(result).not.toBeNull()
    expect(result!.data).toEqual({ name: 'first' })
    expect(result!.content).toContain('name: second')
  })

  it('handles complex nested YAML', () => {
    const raw = `---
name: complex-skill
metadata:
  version: 1.2.3
  tags:
    - typescript
    - react
  config:
    nested: true
    count: 42
---
Body content`
    const result = parseFrontmatter(raw)
    expect(result).not.toBeNull()
    expect(result!.data['name']).toBe('complex-skill')
    expect(result!.data['metadata']).toEqual({
      version: '1.2.3',
      tags: ['typescript', 'react'],
      config: { nested: true, count: 42 },
    })
  })

  it('handles leading whitespace before frontmatter', () => {
    const raw = `  
---
name: trimmed
---
Body`
    const result = parseFrontmatter(raw)
    expect(result).not.toBeNull()
    expect(result!.data['name']).toBe('trimmed')
  })

  it('verifies slice indices — content excludes closing delimiter', () => {
    const raw = `---
key: value
---
Exact content`
    const result = parseFrontmatter(raw)
    expect(result).not.toBeNull()
    // Verify yamlBlock is trimmed correctly (no leading/trailing whitespace artifacts)
    expect(result!.data).toEqual({ key: 'value' })
    // Content should be exactly what follows after the closing ---
    expect(result!.content).toBe('Exact content')
  })

  it('trims whitespace from yaml block', () => {
    const raw = `---
  spaced: true  
---
Body`
    const result = parseFrontmatter(raw)
    expect(result).not.toBeNull()
    expect(result!.data).toEqual({ spaced: true })
  })

  it('rejects input starting with text then ---', () => {
    // This should NOT match — the --- must be at the very start (after trimStart)
    const raw = `text before
---
name: test
---`
    expect(parseFrontmatter(raw)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// validateFrontmatter
// ═══════════════════════════════════════════════════════════════════════════════
describe('validateFrontmatter', () => {
  it('returns no errors for valid agent frontmatter', () => {
    const fm = { name: 'my-agent', description: 'A valid agent description' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors).toEqual([])
  })

  it('returns no errors for valid skill with Trigger:', () => {
    const fm = { name: 'my-skill', description: 'A valid skill. Trigger: when testing' }
    const errors = validateFrontmatter(fm, 'skill')
    expect(errors).toEqual([])
  })

  it('returns error for missing name', () => {
    const fm = { description: 'Valid description here' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors).toHaveLength(1)
    expect(errors[0].field).toBe('name')
    expect(errors[0].message).toContain('required')
  })

  it('returns error for non-string name', () => {
    const fm = { name: 42, description: 'Valid description here' }
    const errors = validateFrontmatter(fm as any, 'agent')
    expect(errors.some(e => e.field === 'name')).toBe(true)
  })

  it('returns error for name too short (1 char)', () => {
    const fm = { name: 'a', description: 'Valid description here' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'name' && e.message.includes('2-60'))).toBe(true)
  })

  it('accepts name exactly 2 chars', () => {
    const fm = { name: 'ab', description: 'Valid description here' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors).toEqual([])
  })

  it('accepts name exactly 60 chars', () => {
    const name = 'a'.repeat(60)
    const fm = { name, description: 'Valid description here' }
    const errors = validateFrontmatter(fm, 'agent')
    // Name is 60 'a's — valid length but fails kebab-case (no hyphens needed for single segment of lowercase)
    // Actually 'a' repeated 60 times IS valid kebab-case: /^[a-z0-9]+(-[a-z0-9]+)*$/
    expect(errors.filter(e => e.message.includes('2-60'))).toEqual([])
  })

  it('returns error for name 61 chars', () => {
    const name = 'a'.repeat(61)
    const fm = { name, description: 'Valid description here' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'name' && e.message.includes('2-60'))).toBe(true)
  })

  it('returns error for uppercase name', () => {
    const fm = { name: 'MyAgent', description: 'Valid description here' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'name' && e.message.includes('kebab-case'))).toBe(true)
  })

  it('returns error for name with spaces', () => {
    const fm = { name: 'my agent', description: 'Valid description here' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'name' && e.message.includes('kebab-case'))).toBe(true)
  })

  it('returns error for missing description', () => {
    const fm = { name: 'my-agent' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'description')).toBe(true)
  })

  it('returns error for description too short (9 chars)', () => {
    const fm = { name: 'my-agent', description: '123456789' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'description' && e.message.includes('10'))).toBe(true)
  })

  it('accepts description exactly 10 chars', () => {
    const fm = { name: 'my-agent', description: '1234567890' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.filter(e => e.field === 'description')).toEqual([])
  })

  it('returns error for skill without Trigger:', () => {
    const fm = { name: 'my-skill', description: 'A valid skill description' }
    const errors = validateFrontmatter(fm, 'skill')
    expect(errors.some(e => e.field === 'description' && e.message.includes('Trigger:'))).toBe(true)
  })

  it('returns no Trigger: error for agent type', () => {
    const fm = { name: 'my-agent', description: 'A valid agent description' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.message.includes('Trigger:'))).toBe(false)
  })

  it('returns error for empty string name', () => {
    const fm = { name: '', description: 'Valid description here' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'name')).toBe(true)
  })

  it('returns error for empty string description', () => {
    const fm = { name: 'my-agent', description: '' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'description')).toBe(true)
  })

  it('returns multiple errors for multiple violations', () => {
    const fm = { name: 'AB', description: 'short' }
    const errors = validateFrontmatter(fm, 'skill')
    // Name is uppercase → kebab error, description < 10 → length error, no Trigger: → skill error
    expect(errors.length).toBeGreaterThanOrEqual(2)
  })

  it('validates name with numbers in kebab-case', () => {
    const fm = { name: 'my-skill-v2', description: 'A valid description for testing' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors).toEqual([])
  })

  it('rejects name starting with hyphen', () => {
    const fm = { name: '-invalid', description: 'A valid description for testing' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'name' && e.message.includes('kebab-case'))).toBe(true)
  })

  it('rejects name ending with hyphen', () => {
    const fm = { name: 'invalid-', description: 'A valid description for testing' }
    const errors = validateFrontmatter(fm, 'agent')
    expect(errors.some(e => e.field === 'name' && e.message.includes('kebab-case'))).toBe(true)
  })
})
