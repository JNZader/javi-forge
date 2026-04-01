import fs from 'fs-extra'
import path from 'path'
import { parseFrontmatter } from '../lib/frontmatter.js'
import type {
  SkillCriticalRule,
  SkillConflict,
  SkillBudgetEntry,
  SkillBudgetResult,
  SkillDuplicate,
  SkillDoctorResult,
  SkillScore,
  SkillBenchmarkCheck,
  SkillBenchmarkResult,
} from '../types/index.js'

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SKILLS_DIR = path.join(
  process.env['HOME'] ?? '~',
  '.claude',
  'skills'
)

const DEFAULT_BUDGET = 8000

/** Approximate tokens per character (GPT/Claude rough average) */
const CHARS_PER_TOKEN = 4

// ── Contradiction keywords (pairs that signal opposite intent) ───────────────

const CONTRADICTION_PAIRS: [RegExp, RegExp][] = [
  [/\buse semicolons\b/i,        /\bno semicolons\b/i],
  [/\bsemicolons required\b/i,   /\bno semicolons\b/i],
  [/\bsingle quotes\b/i,         /\bdouble quotes\b/i],
  [/\btabs\b/i,                   /\bspaces\b/i],
  [/\b2[- ]?spaces?\b/i,         /\b4[- ]?spaces?\b/i],
  [/\bclass[- ]?based\b/i,       /\bfunctional\b/i],
  [/\bOOP\b/i,                    /\bfunctional\b/i],
  [/\bmutable\b/i,                /\bimmutable\b/i],
  [/\bany\b.*\ballowed\b/i,      /\bno any\b/i],
  [/\bdefault export\b/i,        /\bnamed export\b/i],
  [/\bnever use\b/i,             /\balways use\b/i],
  [/\bavoid\b/i,                  /\bprefer\b/i],
  [/\bdo not\b/i,                 /\bmust\b/i],
]

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Estimate token count from a string */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Read a SKILL.md and extract its name + critical rules section */
export async function parseSkillFile(
  skillPath: string
): Promise<{ name: string; rules: string[]; rawContent: string; triggers: string[] } | null> {
  if (!await fs.pathExists(skillPath)) return null

  const raw = await fs.readFile(skillPath, 'utf-8')
  const fm = parseFrontmatter(raw)

  const name = (fm?.data?.['name'] as string) ?? path.basename(path.dirname(skillPath))

  // Extract critical rules — look for "Critical Rules" or numbered list after it
  const rules = extractCriticalRules(fm?.content ?? raw)

  // Extract trigger keywords from description
  const description = (fm?.data?.['description'] as string) ?? ''
  const triggers = extractTriggers(description)

  return { name, rules, rawContent: raw, triggers }
}

/** Extract critical rules from markdown content */
export function extractCriticalRules(content: string): string[] {
  const rules: string[] = []

  // Strategy 1: Find "Critical Rules" or "## Critical Rules" section
  const block1 = extractSection(content, /Critical Rules?/i)
  if (block1) {
    extractListItems(block1, rules)
  }

  // Strategy 2: If no critical rules section, look for rules/conventions in any section
  if (rules.length === 0) {
    const block2 = extractSection(content, /Rules?/i)
    if (block2) {
      extractListItems(block2, rules)
    }
  }

  return rules
}

/** Extract a markdown section body by heading pattern */
function extractSection(content: string, headingPattern: RegExp): string | null {
  const lines = content.split('\n')
  let capturing = false
  const blockLines: string[] = []

  for (const line of lines) {
    if (capturing) {
      // Stop at next heading
      if (/^#+\s/.test(line) || /^---/.test(line)) break
      blockLines.push(line)
    } else if (/^#+\s/.test(line) && headingPattern.test(line)) {
      capturing = true
    }
  }

  return blockLines.length > 0 ? blockLines.join('\n') : null
}

/** Extract numbered or bulleted list items from a markdown block */
function extractListItems(block: string, out: string[]): void {
  const lines = block.split('\n')
  for (const line of lines) {
    const match = line.match(/^\s*(?:\d+[\.\)]\s+|-\s+|\*\s+)(.+)/)
    if (match) {
      const cleaned = match[1].trim()
      if (cleaned.length > 5) out.push(cleaned)
    }
  }
}

/** Extract trigger keywords from a skill description */
export function extractTriggers(description: string): string[] {
  const triggerMatch = description.match(/Trigger:\s*(.+)/i)
  if (!triggerMatch) return []

  const triggerText = triggerMatch[1]
  // Split on commas, "or", "and", common delimiters
  const keywords = triggerText
    .split(/[,;]|\bor\b/i)
    .map(k => k.trim().toLowerCase().replace(/^when\s+/i, ''))
    .filter(k => k.length > 2)

  return keywords
}

// ── Core: Scan installed skills ─────────────────────────────────────────────

/** Discover all SKILL.md files in a skills directory */
export async function discoverSkills(skillsDir: string): Promise<string[]> {
  if (!await fs.pathExists(skillsDir)) return []

  const entries = await fs.readdir(skillsDir)
  const skillFiles: string[] = []

  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue
    const skillPath = path.join(skillsDir, entry, 'SKILL.md')
    if (await fs.pathExists(skillPath)) {
      skillFiles.push(skillPath)
    }
  }

  return skillFiles.sort()
}

// ── Conflict Detection ──────────────────────────────────────────────────────

/** Check if two rules contradict each other */
export function detectRuleConflict(ruleA: string, ruleB: string): string | null {
  const normA = ruleA.toLowerCase().trim()
  const normB = ruleB.toLowerCase().trim()

  for (const [patternA, patternB] of CONTRADICTION_PAIRS) {
    if (
      (patternA.test(normA) && patternB.test(normB)) ||
      (patternB.test(normA) && patternA.test(normB))
    ) {
      return `"${ruleA.slice(0, 60)}" vs "${ruleB.slice(0, 60)}"`
    }
  }

  return null
}

/** Scan all skills for conflicting critical rules */
export async function findConflicts(skillsDir: string): Promise<SkillConflict[]> {
  const skillPaths = await discoverSkills(skillsDir)
  const allRules: SkillCriticalRule[] = []

  for (const sp of skillPaths) {
    const parsed = await parseSkillFile(sp)
    if (!parsed) continue

    for (const rule of parsed.rules) {
      allRules.push({
        skillName: parsed.name,
        skillPath: sp,
        rule,
        normalized: rule.toLowerCase().trim(),
      })
    }
  }

  const conflicts: SkillConflict[] = []

  // Compare every pair (O(n^2) but skill count is small ~20-50)
  for (let i = 0; i < allRules.length; i++) {
    for (let j = i + 1; j < allRules.length; j++) {
      const a = allRules[i]
      const b = allRules[j]

      // Skip rules from the same skill
      if (a.skillName === b.skillName) continue

      const reason = detectRuleConflict(a.rule, b.rule)
      if (reason) {
        conflicts.push({ ruleA: a, ruleB: b, reason })
      }
    }
  }

  return conflicts
}

// ── Context Budget ──────────────────────────────────────────────────────────

/** Calculate token budget for all installed skills */
export async function calculateBudget(
  skillsDir: string,
  budget: number = DEFAULT_BUDGET
): Promise<SkillBudgetResult> {
  const skillPaths = await discoverSkills(skillsDir)
  const entries: SkillBudgetEntry[] = []

  for (const sp of skillPaths) {
    const parsed = await parseSkillFile(sp)
    if (!parsed) continue

    entries.push({
      skillName: parsed.name,
      skillPath: sp,
      tokens: estimateTokens(parsed.rawContent),
    })
  }

  // Sort by token count descending (biggest consumers first)
  entries.sort((a, b) => b.tokens - a.tokens)

  const totalTokens = entries.reduce((sum, e) => sum + e.tokens, 0)
  const overBudget = totalTokens > budget

  const suggestions: string[] = []
  if (overBudget) {
    const excess = totalTokens - budget
    suggestions.push(`Over budget by ~${excess} tokens`)

    // Suggest disabling the largest skills until under budget
    let saved = 0
    for (const entry of entries) {
      if (saved >= excess) break
      suggestions.push(
        `Consider disabling "${entry.skillName}" (~${entry.tokens} tokens)`
      )
      saved += entry.tokens
    }
  }

  return { entries, totalTokens, budget, overBudget, suggestions }
}

// ── Duplicate Detection ─────────────────────────────────────────────────────

/** Find skills that overlap in scope/triggers */
export async function findDuplicates(skillsDir: string): Promise<SkillDuplicate[]> {
  const skillPaths = await discoverSkills(skillsDir)

  const skillData: Array<{ name: string; triggers: string[] }> = []

  for (const sp of skillPaths) {
    const parsed = await parseSkillFile(sp)
    if (!parsed || parsed.triggers.length === 0) continue
    skillData.push({ name: parsed.name, triggers: parsed.triggers })
  }

  const duplicates: SkillDuplicate[] = []

  for (let i = 0; i < skillData.length; i++) {
    for (let j = i + 1; j < skillData.length; j++) {
      const a = skillData[i]
      const b = skillData[j]

      const sharedTriggers = a.triggers.filter(t =>
        b.triggers.some(bt => bt.includes(t) || t.includes(bt))
      )

      if (sharedTriggers.length === 0) continue

      const maxTriggers = Math.max(a.triggers.length, b.triggers.length)
      const similarity = maxTriggers > 0
        ? Math.round((sharedTriggers.length / maxTriggers) * 100)
        : 0

      if (similarity >= 30) {
        duplicates.push({
          skillA: a.name,
          skillB: b.name,
          sharedTriggers,
          similarity,
        })
      }
    }
  }

  // Sort by similarity descending
  duplicates.sort((a, b) => b.similarity - a.similarity)

  return duplicates
}

// ── Full Doctor ─────────────────────────────────────────────────────────────

export type SkillsDoctorMode = 'doctor' | 'budget'

export interface SkillsDoctorOptions {
  mode: SkillsDoctorMode
  skillsDir?: string
  budget?: number
  deep?: boolean
}

/**
 * Run the skills doctor analysis.
 * - `doctor --deep`: full conflict + budget + duplicate analysis
 * - `budget -b N`: budget-only analysis with custom token limit
 */
export async function runSkillsDoctor(
  options: SkillsDoctorOptions
): Promise<SkillDoctorResult> {
  const skillsDir = options.skillsDir ?? DEFAULT_SKILLS_DIR
  const budget = options.budget ?? DEFAULT_BUDGET

  if (options.mode === 'budget') {
    const budgetResult = await calculateBudget(skillsDir, budget)
    return { conflicts: [], budget: budgetResult, duplicates: [] }
  }

  // Deep doctor mode
  const [conflicts, budgetResult, duplicates] = await Promise.all([
    options.deep ? findConflicts(skillsDir) : Promise.resolve([]),
    calculateBudget(skillsDir, budget),
    options.deep ? findDuplicates(skillsDir) : Promise.resolve([]),
  ])

  return { conflicts, budget: budgetResult, duplicates }
}

// ── Quality Scoring ────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 50

/** Vague terms that reduce clarity score */
const VAGUE_TERMS = [
  /\bstuff\b/i, /\bthings?\b/i, /\betc\.?\b/i, /\bmisc\b/i,
  /\bvarious\b/i, /\bsome\b/i, /\bmaybe\b/i, /\bprobably\b/i,
]

/** Action verbs that indicate actionable rules */
const ACTION_VERBS = [
  /\buse\b/i, /\bavoid\b/i, /\bprefer\b/i, /\bnever\b/i,
  /\balways\b/i, /\bmust\b/i, /\bshould\b/i, /\bshall\b/i,
  /\bensure\b/i, /\bwrite\b/i, /\bcreate\b/i, /\bfollow\b/i,
  /\bdo not\b/i, /\bapply\b/i, /\bimplement\b/i, /\brun\b/i,
]

/**
 * Score completeness (0-100): frontmatter fields, critical rules, structure.
 */
export function scoreCompleteness(parsed: {
  name: string
  rules: string[]
  rawContent: string
  triggers: string[]
}): number {
  let score = 0
  const max = 100

  // Has a name (10 pts)
  if (parsed.name && parsed.name.length > 0) score += 10

  // Has triggers / description with "Trigger:" (15 pts)
  if (parsed.triggers.length > 0) score += 15

  // Has critical rules section (20 pts)
  if (parsed.rules.length > 0) score += 20

  // Number of rules: 1-2 = 10, 3-5 = 20, 6+ = 25
  if (parsed.rules.length >= 6) score += 25
  else if (parsed.rules.length >= 3) score += 20
  else if (parsed.rules.length >= 1) score += 10

  // Has substantial content (>= 200 chars = 10, >= 500 = 20, >= 1000 = 30)
  const len = parsed.rawContent.length
  if (len >= 1000) score += 30
  else if (len >= 500) score += 20
  else if (len >= 200) score += 10

  return Math.min(score, max)
}

/**
 * Score clarity (0-100): description quality, rule actionability, no vague terms.
 */
export function scoreClarity(parsed: {
  name: string
  rules: string[]
  rawContent: string
  triggers: string[]
}): number {
  let score = 0
  const max = 100

  // Trigger description exists and is meaningful (>= 50 chars in raw = 20 pts)
  if (parsed.rawContent.length >= 50) score += 20

  // Rules contain action verbs (up to 40 pts)
  if (parsed.rules.length > 0) {
    const actionableCount = parsed.rules.filter(rule =>
      ACTION_VERBS.some(verb => verb.test(rule))
    ).length
    const ratio = actionableCount / parsed.rules.length
    score += Math.round(ratio * 40)
  }

  // Penalty for vague terms in rules (-5 each, max -20)
  let penalty = 0
  for (const rule of parsed.rules) {
    for (const vague of VAGUE_TERMS) {
      if (vague.test(rule)) { penalty += 5; break }
    }
  }
  score -= Math.min(penalty, 20)

  // Name is descriptive (not single char) (10 pts)
  if (parsed.name.length >= 3) score += 10

  // Has multiple triggers (10 pts for >= 2, 20 for >= 3)
  if (parsed.triggers.length >= 3) score += 20
  else if (parsed.triggers.length >= 2) score += 10

  // Base content score for having structured sections (10 pts)
  if (/^#+\s/m.test(parsed.rawContent)) score += 10

  return Math.max(0, Math.min(score, max))
}

/**
 * Score testability (0-100): Given/When/Then scenarios, specific rules.
 */
export function scoreTestability(parsed: {
  name: string
  rules: string[]
  rawContent: string
  triggers: string[]
}): number {
  let score = 0
  const max = 100

  // Has Given/When/Then scenarios (40 pts)
  const gwtMatches = parsed.rawContent.match(/\bGIVEN\b.*\bWHEN\b.*\bTHEN\b/gis)
  const gwtCount = gwtMatches?.length ?? 0
  if (gwtCount >= 3) score += 40
  else if (gwtCount >= 1) score += 25

  // Rules are specific enough (contain file paths, code refs, or patterns)
  const specificRules = parsed.rules.filter(rule =>
    /[`'"]/.test(rule) || /\.\w+/.test(rule) || /\bfile\b/i.test(rule) || /\bpath\b/i.test(rule)
  ).length

  if (parsed.rules.length > 0) {
    const specificity = specificRules / parsed.rules.length
    score += Math.round(specificity * 30)
  }

  // Has examples or code blocks (20 pts)
  const codeBlocks = (parsed.rawContent.match(/```/g) ?? []).length / 2
  if (codeBlocks >= 2) score += 20
  else if (codeBlocks >= 1) score += 10

  // Has a "Testing" or "Test" section (10 pts)
  if (/^#+\s.*test/im.test(parsed.rawContent)) score += 10

  return Math.min(score, max)
}

/**
 * Score token efficiency (0-100): information density (rules per 1000 tokens).
 */
export function scoreTokenEfficiency(parsed: {
  name: string
  rules: string[]
  rawContent: string
  triggers: string[]
}): number {
  const tokens = estimateTokens(parsed.rawContent)
  if (tokens === 0) return 0

  // Rules per 1000 tokens — higher is more efficient
  const rulesPerKToken = (parsed.rules.length / tokens) * 1000

  // Ideal: 3-8 rules per 1000 tokens
  // < 1 = bloated, > 10 = maybe too terse
  let score: number
  if (rulesPerKToken >= 3 && rulesPerKToken <= 8) {
    score = 100
  } else if (rulesPerKToken >= 2) {
    score = 80
  } else if (rulesPerKToken >= 1) {
    score = 60
  } else if (rulesPerKToken > 0) {
    score = 40
  } else {
    score = 10
  }

  // Bonus for small total size (under 2000 tokens = +0, under 1000 = already great)
  // Penalty for huge skills (> 5000 tokens = -20)
  if (tokens > 5000) score -= 20
  else if (tokens > 3000) score -= 10

  return Math.max(0, Math.min(score, 100))
}

/**
 * Score a skill on all 4 dimensions and compute overall.
 */
export async function scoreSkill(
  skillPath: string,
  threshold: number = DEFAULT_THRESHOLD
): Promise<SkillScore | null> {
  const parsed = await parseSkillFile(skillPath)
  if (!parsed) return null

  const completeness = scoreCompleteness(parsed)
  const clarity = scoreClarity(parsed)
  const testability = scoreTestability(parsed)
  const tokenEfficiency = scoreTokenEfficiency(parsed)

  // Weighted average: completeness 30%, clarity 25%, testability 25%, token-efficiency 20%
  const overall = Math.round(
    completeness * 0.30 +
    clarity * 0.25 +
    testability * 0.25 +
    tokenEfficiency * 0.20
  )

  return {
    skillName: parsed.name,
    completeness,
    clarity,
    testability,
    tokenEfficiency,
    overall,
    threshold,
    passing: overall >= threshold,
  }
}

// ── Benchmarking ───────────────────────────────────────────────────────────

/**
 * Run structural quality benchmark checks against a skill.
 */
export async function benchmarkSkill(
  skillPath: string
): Promise<SkillBenchmarkResult | null> {
  const parsed = await parseSkillFile(skillPath)
  if (!parsed) return null

  const checks: SkillBenchmarkCheck[] = []

  // Check 1: Has YAML frontmatter with name
  checks.push({
    name: 'has-frontmatter-name',
    passed: parsed.name.length > 0 && parsed.name !== path.basename(path.dirname(skillPath)),
    detail: parsed.name.length > 0 ? `name: ${parsed.name}` : 'No explicit name in frontmatter',
  })

  // Check 2: Has trigger keywords
  checks.push({
    name: 'has-triggers',
    passed: parsed.triggers.length > 0,
    detail: parsed.triggers.length > 0
      ? `${parsed.triggers.length} trigger(s) found`
      : 'No "Trigger:" in description',
  })

  // Check 3: Has critical rules (>= 3)
  checks.push({
    name: 'has-critical-rules',
    passed: parsed.rules.length >= 3,
    detail: `${parsed.rules.length} rule(s) found`,
  })

  // Check 4: Rules are actionable (contain verbs)
  const actionableRules = parsed.rules.filter(rule =>
    ACTION_VERBS.some(verb => verb.test(rule))
  )
  checks.push({
    name: 'rules-actionable',
    passed: parsed.rules.length > 0 && actionableRules.length / parsed.rules.length >= 0.5,
    detail: `${actionableRules.length}/${parsed.rules.length} rules have action verbs`,
  })

  // Check 5: Has code examples
  const codeBlocks = (parsed.rawContent.match(/```/g) ?? []).length / 2
  checks.push({
    name: 'has-code-examples',
    passed: codeBlocks >= 1,
    detail: `${Math.floor(codeBlocks)} code block(s)`,
  })

  // Check 6: Has structured sections (headings)
  const headings = (parsed.rawContent.match(/^#+\s/gm) ?? []).length
  checks.push({
    name: 'has-sections',
    passed: headings >= 3,
    detail: `${headings} section heading(s)`,
  })

  // Check 7: Token budget reasonable (< 3000 tokens)
  const tokens = estimateTokens(parsed.rawContent)
  checks.push({
    name: 'token-budget-ok',
    passed: tokens <= 3000,
    detail: `~${tokens} tokens`,
  })

  // Check 8: No vague terms in rules
  const vagueRules = parsed.rules.filter(rule =>
    VAGUE_TERMS.some(vague => vague.test(rule))
  )
  checks.push({
    name: 'no-vague-rules',
    passed: vagueRules.length === 0,
    detail: vagueRules.length > 0
      ? `${vagueRules.length} rule(s) contain vague terms`
      : 'All rules are specific',
  })

  const passedCount = checks.filter(c => c.passed).length
  const passRate = Math.round((passedCount / checks.length) * 100)

  return {
    skillName: parsed.name,
    checks,
    passRate,
  }
}
