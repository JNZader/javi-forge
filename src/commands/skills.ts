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
