import fs from "fs-extra";
import path from "path";
import { parseFrontmatter } from "../lib/frontmatter.js";
import type {
	ConflictKind,
	SkillBenchmarkCheck,
	SkillBenchmarkResult,
	SkillBudgetEntry,
	SkillBudgetResult,
	SkillBudgetSuggestion,
	SkillConflict,
	SkillCriticalRule,
	SkillDoctorResult,
	SkillDuplicate,
	SkillGrade,
	SkillRegistryGateResult,
	SkillScore,
} from "../types/index.js";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_SKILLS_DIR = path.join(
	process.env["HOME"] ?? "~",
	".claude",
	"skills",
);

const DEFAULT_BUDGET = 8000;

/** Approximate tokens per character (GPT/Claude rough average) */
const CHARS_PER_TOKEN = 4;

// ── Contradiction keywords (pairs that signal opposite intent) ───────────────

const CONTRADICTION_PAIRS: [RegExp, RegExp][] = [
	[/\buse semicolons\b/i, /\bno semicolons\b/i],
	[/\bsemicolons required\b/i, /\bno semicolons\b/i],
	[/\bsingle quotes\b/i, /\bdouble quotes\b/i],
	[/\btabs\b/i, /\bspaces\b/i],
	[/\b2[- ]?spaces?\b/i, /\b4[- ]?spaces?\b/i],
	[/\bclass[- ]?based\b/i, /\bfunctional\b/i],
	[/\bOOP\b/i, /\bfunctional\b/i],
	[/\bmutable\b/i, /\bimmutable\b/i],
	[/\bany\b.*\ballowed\b/i, /\bno any\b/i],
	[/\bdefault export\b/i, /\bnamed export\b/i],
	[/\bnever use\b/i, /\balways use\b/i],
	[/\bavoid\b/i, /\bprefer\b/i],
	[/\bdo not\b/i, /\bmust\b/i],
];

// ── Directive extraction (semantic conflict detection) ─────────────────────

/** A directive is a sentiment + subject extracted from a rule */
export interface RuleDirective {
	sentiment: "positive" | "negative";
	subject: string;
}

/**
 * Positive and negative signal patterns.
 * Order matters — first match wins, so more specific patterns go first.
 */
const POSITIVE_SIGNALS: RegExp[] = [
	/\balways use\b/i,
	/\bmust use\b/i,
	/\bprefer\b/i,
	/\balways\b/i,
	/\bmust\b/i,
	/\brequire\b/i,
	/\buse\b/i,
	/\benable\b/i,
	/\bshould\b/i,
];

const NEGATIVE_SIGNALS: RegExp[] = [
	/\bnever use\b/i,
	/\bdo not use\b/i,
	/\bdon't use\b/i,
	/\bnever\b/i,
	/\bavoid\b/i,
	/\bdo not\b/i,
	/\bdon't\b/i,
	/\bdisable\b/i,
	/\bno\b/i,
	/\bforbid\b/i,
];

/**
 * Extract a directive (sentiment + subject) from a rule string.
 * Returns null if the rule has no clear directive.
 */
export function extractDirective(rule: string): RuleDirective | null {
	const norm = rule.toLowerCase().trim();

	// Try negative first (more specific: "never use X" before "use X")
	for (const pattern of NEGATIVE_SIGNALS) {
		const match = norm.match(pattern);
		if (match) {
			const subject = norm
				.slice(match.index! + match[0].length)
				.trim()
				.replace(/^(the|a|an)\s+/i, "")
				.replace(/[.;,!]+$/, "")
				.trim();
			if (subject.length >= 3) {
				return { sentiment: "negative", subject };
			}
		}
	}

	for (const pattern of POSITIVE_SIGNALS) {
		const match = norm.match(pattern);
		if (match) {
			const subject = norm
				.slice(match.index! + match[0].length)
				.trim()
				.replace(/^(the|a|an)\s+/i, "")
				.replace(/[.;,!]+$/, "")
				.trim();
			if (subject.length >= 3) {
				return { sentiment: "positive", subject };
			}
		}
	}

	return null;
}

/**
 * Check if two subjects are similar enough to be "about the same thing".
 * Uses simple word-overlap (Jaccard-like) — no external NLP needed.
 */
export function subjectsSimilar(
	a: string,
	b: string,
	threshold = 0.5,
): boolean {
	const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 2));
	const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 2));

	if (wordsA.size === 0 || wordsB.size === 0) return false;

	let intersection = 0;
	for (const w of wordsA) {
		if (wordsB.has(w)) intersection++;
	}

	const union = new Set([...wordsA, ...wordsB]).size;
	return union > 0 && intersection / union >= threshold;
}

/**
 * Detect a directive clash between two rules:
 * opposite sentiments about the same subject.
 */
export function detectDirectiveClash(
	ruleA: string,
	ruleB: string,
): string | null {
	const dA = extractDirective(ruleA);
	const dB = extractDirective(ruleB);

	if (!dA || !dB) return null;
	if (dA.sentiment === dB.sentiment) return null;

	if (subjectsSimilar(dA.subject, dB.subject)) {
		const posRule = dA.sentiment === "positive" ? ruleA : ruleB;
		const negRule = dA.sentiment === "negative" ? ruleA : ruleB;
		return `Directive clash on "${dA.subject}": positive="${posRule.slice(0, 50)}" vs negative="${negRule.slice(0, 50)}"`;
	}

	return null;
}

// ── Budget Optimization ─────────────────────────────────────────────────────

/**
 * Generate minimal disable sets to bring total tokens under budget.
 * Uses a greedy approach: disable largest skills first until under budget.
 * Returns up to 3 alternative optimization suggestions.
 */
export function generateBudgetOptimizations(
	entries: SkillBudgetEntry[],
	totalTokens: number,
	budget: number,
): SkillBudgetSuggestion[] {
	if (totalTokens <= budget) return [];

	const excess = totalTokens - budget;
	const suggestions: SkillBudgetSuggestion[] = [];

	// Strategy 1: Greedy — disable largest skills first
	const greedy = greedyDisableSet(entries, excess);
	suggestions.push(makeSuggestion(greedy, entries, totalTokens, budget));

	// Strategy 2: Minimal count — find smallest number of skills to disable
	// (try single-skill solutions first, then pairs)
	const singles = entries.filter((e) => e.tokens >= excess);
	if (singles.length > 0) {
		// Pick the smallest single that still meets budget
		const sorted = [...singles].sort((a, b) => a.tokens - b.tokens);
		const minimal = sorted[0];
		if (minimal.skillName !== greedy[0]?.skillName) {
			suggestions.push(makeSuggestion([minimal], entries, totalTokens, budget));
		}
	}

	// Strategy 3: If we have many small skills, show a "trim many" approach
	// Disable the bottom 50% by token count (many small skills)
	if (entries.length >= 4) {
		const sortedAsc = [...entries].sort((a, b) => a.tokens - b.tokens);
		const halfCount = Math.ceil(sortedAsc.length / 2);
		const bottomHalf = sortedAsc.slice(0, halfCount);
		const saved = bottomHalf.reduce((s, e) => s + e.tokens, 0);
		if (saved >= excess) {
			const trimSet = greedyDisableSet(
				[...bottomHalf].sort((a, b) => b.tokens - a.tokens),
				excess,
			);
			const names = new Set(trimSet.map((e) => e.skillName));
			const alreadySuggested = suggestions.some(
				(s) =>
					s.disableSkills.length === names.size &&
					s.disableSkills.every((n) => names.has(n)),
			);
			if (!alreadySuggested) {
				suggestions.push(makeSuggestion(trimSet, entries, totalTokens, budget));
			}
		}
	}

	return suggestions;
}

/** Greedy: pick largest entries until saved >= excess */
function greedyDisableSet(
	entries: SkillBudgetEntry[],
	excess: number,
): SkillBudgetEntry[] {
	const sorted = [...entries].sort((a, b) => b.tokens - a.tokens);
	const result: SkillBudgetEntry[] = [];
	let saved = 0;

	for (const entry of sorted) {
		if (saved >= excess) break;
		result.push(entry);
		saved += entry.tokens;
	}

	return result;
}

function makeSuggestion(
	disableSet: SkillBudgetEntry[],
	_allEntries: SkillBudgetEntry[],
	totalTokens: number,
	budget: number,
): SkillBudgetSuggestion {
	const tokensSaved = disableSet.reduce((s, e) => s + e.tokens, 0);
	const remaining = totalTokens - tokensSaved;
	return {
		disableSkills: disableSet.map((e) => e.skillName),
		tokensSaved,
		remainingTokens: remaining,
		meetsbudget: remaining <= budget,
	};
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Estimate token count from a string */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Read a SKILL.md and extract its name + critical rules section */
export async function parseSkillFile(skillPath: string): Promise<{
	name: string;
	rules: string[];
	rawContent: string;
	triggers: string[];
} | null> {
	if (!(await fs.pathExists(skillPath))) return null;

	const raw = await fs.readFile(skillPath, "utf-8");
	const fm = parseFrontmatter(raw);

	const name =
		(fm?.data?.["name"] as string) ?? path.basename(path.dirname(skillPath));

	// Extract critical rules — look for "Critical Rules" or numbered list after it
	const rules = extractCriticalRules(fm?.content ?? raw);

	// Extract trigger keywords from description
	const description = (fm?.data?.["description"] as string) ?? "";
	const triggers = extractTriggers(description);

	return { name, rules, rawContent: raw, triggers };
}

/** Extract critical rules from markdown content */
export function extractCriticalRules(content: string): string[] {
	const rules: string[] = [];

	// Strategy 1: Find "Critical Rules" or "## Critical Rules" section
	const block1 = extractSection(content, /Critical Rules?/i);
	if (block1) {
		extractListItems(block1, rules);
	}

	// Strategy 2: If no critical rules section, look for rules/conventions in any section
	if (rules.length === 0) {
		const block2 = extractSection(content, /Rules?/i);
		if (block2) {
			extractListItems(block2, rules);
		}
	}

	return rules;
}

/** Extract a markdown section body by heading pattern */
function extractSection(
	content: string,
	headingPattern: RegExp,
): string | null {
	const lines = content.split("\n");
	let capturing = false;
	const blockLines: string[] = [];

	for (const line of lines) {
		if (capturing) {
			// Stop at next heading
			if (/^#+\s/.test(line) || /^---/.test(line)) break;
			blockLines.push(line);
		} else if (/^#+\s/.test(line) && headingPattern.test(line)) {
			capturing = true;
		}
	}

	return blockLines.length > 0 ? blockLines.join("\n") : null;
}

/** Extract numbered or bulleted list items from a markdown block */
function extractListItems(block: string, out: string[]): void {
	const lines = block.split("\n");
	for (const line of lines) {
		const match = line.match(/^\s*(?:\d+[.)]\s+|-\s+|\*\s+)(.+)/);
		if (match) {
			const cleaned = match[1].trim();
			if (cleaned.length > 5) out.push(cleaned);
		}
	}
}

/** Extract trigger keywords from a skill description */
export function extractTriggers(description: string): string[] {
	const triggerMatch = description.match(/Trigger:\s*(.+)/i);
	if (!triggerMatch) return [];

	const triggerText = triggerMatch[1];
	// Split on commas, "or", "and", common delimiters
	const keywords = triggerText
		.split(/[,;]|\bor\b/i)
		.map((k) =>
			k
				.trim()
				.toLowerCase()
				.replace(/^when\s+/i, ""),
		)
		.filter((k) => k.length > 2);

	return keywords;
}

// ── Core: Scan installed skills ─────────────────────────────────────────────

/** Discover all SKILL.md files in a skills directory */
export async function discoverSkills(skillsDir: string): Promise<string[]> {
	if (!(await fs.pathExists(skillsDir))) return [];

	const entries = await fs.readdir(skillsDir);
	const skillFiles: string[] = [];

	for (const entry of entries) {
		if (entry.startsWith(".") || entry.startsWith("_")) continue;
		const skillPath = path.join(skillsDir, entry, "SKILL.md");
		if (await fs.pathExists(skillPath)) {
			skillFiles.push(skillPath);
		}
	}

	return skillFiles.sort();
}

// ── Conflict Detection ──────────────────────────────────────────────────────

/** Check if two rules contradict each other (regex pairs + directive clash) */
export function detectRuleConflict(
	ruleA: string,
	ruleB: string,
): { reason: string; kind: ConflictKind } | null {
	const normA = ruleA.toLowerCase().trim();
	const normB = ruleB.toLowerCase().trim();

	// Strategy 1: Hardcoded regex pairs (fast, high confidence)
	for (const [patternA, patternB] of CONTRADICTION_PAIRS) {
		if (
			(patternA.test(normA) && patternB.test(normB)) ||
			(patternB.test(normA) && patternA.test(normB))
		) {
			return {
				reason: `"${ruleA.slice(0, 60)}" vs "${ruleB.slice(0, 60)}"`,
				kind: "regex-pair",
			};
		}
	}

	// Strategy 2: Semantic directive clash (broader, medium confidence)
	const clashReason = detectDirectiveClash(ruleA, ruleB);
	if (clashReason) {
		return { reason: clashReason, kind: "directive-clash" };
	}

	return null;
}

/** Scan all skills for conflicting critical rules */
export async function findConflicts(
	skillsDir: string,
): Promise<SkillConflict[]> {
	const skillPaths = await discoverSkills(skillsDir);
	const allRules: SkillCriticalRule[] = [];

	for (const sp of skillPaths) {
		const parsed = await parseSkillFile(sp);
		if (!parsed) continue;

		for (const rule of parsed.rules) {
			allRules.push({
				skillName: parsed.name,
				skillPath: sp,
				rule,
				normalized: rule.toLowerCase().trim(),
			});
		}
	}

	const conflicts: SkillConflict[] = [];

	// Compare every pair (O(n^2) but skill count is small ~20-50)
	for (let i = 0; i < allRules.length; i++) {
		for (let j = i + 1; j < allRules.length; j++) {
			const a = allRules[i];
			const b = allRules[j];

			// Skip rules from the same skill
			if (a.skillName === b.skillName) continue;

			const result = detectRuleConflict(a.rule, b.rule);
			if (result) {
				conflicts.push({
					ruleA: a,
					ruleB: b,
					reason: result.reason,
					kind: result.kind,
				});
			}
		}
	}

	return conflicts;
}

// ── Context Budget ──────────────────────────────────────────────────────────

/** Calculate token budget for all installed skills */
export async function calculateBudget(
	skillsDir: string,
	budget: number = DEFAULT_BUDGET,
): Promise<SkillBudgetResult> {
	const skillPaths = await discoverSkills(skillsDir);
	const entries: SkillBudgetEntry[] = [];

	for (const sp of skillPaths) {
		const parsed = await parseSkillFile(sp);
		if (!parsed) continue;

		entries.push({
			skillName: parsed.name,
			skillPath: sp,
			tokens: estimateTokens(parsed.rawContent),
		});
	}

	// Sort by token count descending (biggest consumers first)
	entries.sort((a, b) => b.tokens - a.tokens);

	const totalTokens = entries.reduce((sum, e) => sum + e.tokens, 0);
	const overBudget = totalTokens > budget;

	const suggestions: string[] = [];
	if (overBudget) {
		const excess = totalTokens - budget;
		suggestions.push(`Over budget by ~${excess} tokens`);

		// Suggest disabling the largest skills until under budget
		let saved = 0;
		for (const entry of entries) {
			if (saved >= excess) break;
			suggestions.push(
				`Consider disabling "${entry.skillName}" (~${entry.tokens} tokens)`,
			);
			saved += entry.tokens;
		}
	}

	const optimizations = generateBudgetOptimizations(
		entries,
		totalTokens,
		budget,
	);

	return {
		entries,
		totalTokens,
		budget,
		overBudget,
		suggestions,
		optimizations,
	};
}

// ── Duplicate Detection ─────────────────────────────────────────────────────

/** Find skills that overlap in scope/triggers */
export async function findDuplicates(
	skillsDir: string,
): Promise<SkillDuplicate[]> {
	const skillPaths = await discoverSkills(skillsDir);

	const skillData: Array<{ name: string; triggers: string[] }> = [];

	for (const sp of skillPaths) {
		const parsed = await parseSkillFile(sp);
		if (!parsed || parsed.triggers.length === 0) continue;
		skillData.push({ name: parsed.name, triggers: parsed.triggers });
	}

	const duplicates: SkillDuplicate[] = [];

	for (let i = 0; i < skillData.length; i++) {
		for (let j = i + 1; j < skillData.length; j++) {
			const a = skillData[i];
			const b = skillData[j];

			const sharedTriggers = a.triggers.filter((t) =>
				b.triggers.some((bt) => bt.includes(t) || t.includes(bt)),
			);

			if (sharedTriggers.length === 0) continue;

			const maxTriggers = Math.max(a.triggers.length, b.triggers.length);
			const similarity =
				maxTriggers > 0
					? Math.round((sharedTriggers.length / maxTriggers) * 100)
					: 0;

			if (similarity >= 30) {
				duplicates.push({
					skillA: a.name,
					skillB: b.name,
					sharedTriggers,
					similarity,
				});
			}
		}
	}

	// Sort by similarity descending
	duplicates.sort((a, b) => b.similarity - a.similarity);

	return duplicates;
}

// ── Full Doctor ─────────────────────────────────────────────────────────────

export type SkillsDoctorMode = "doctor" | "budget";

export interface SkillsDoctorOptions {
	mode: SkillsDoctorMode;
	skillsDir?: string;
	budget?: number;
	deep?: boolean;
}

/**
 * Run the skills doctor analysis.
 * - `doctor --deep`: full conflict + budget + duplicate analysis
 * - `budget -b N`: budget-only analysis with custom token limit
 */
export async function runSkillsDoctor(
	options: SkillsDoctorOptions,
): Promise<SkillDoctorResult> {
	const skillsDir = options.skillsDir ?? DEFAULT_SKILLS_DIR;
	const budget = options.budget ?? DEFAULT_BUDGET;

	if (options.mode === "budget") {
		const budgetResult = await calculateBudget(skillsDir, budget);
		return { conflicts: [], budget: budgetResult, duplicates: [] };
	}

	// Deep doctor mode
	const [conflicts, budgetResult, duplicates] = await Promise.all([
		options.deep ? findConflicts(skillsDir) : Promise.resolve([]),
		calculateBudget(skillsDir, budget),
		options.deep ? findDuplicates(skillsDir) : Promise.resolve([]),
	]);

	return { conflicts, budget: budgetResult, duplicates };
}

// ── Quality Scoring ────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD = 50;

/** Vague terms that reduce clarity score */
const VAGUE_TERMS = [
	/\bstuff\b/i,
	/\bthings?\b/i,
	/\betc\.?\b/i,
	/\bmisc\b/i,
	/\bvarious\b/i,
	/\bsome\b/i,
	/\bmaybe\b/i,
	/\bprobably\b/i,
];

/** Action verbs that indicate actionable rules */
const ACTION_VERBS = [
	/\buse\b/i,
	/\bavoid\b/i,
	/\bprefer\b/i,
	/\bnever\b/i,
	/\balways\b/i,
	/\bmust\b/i,
	/\bshould\b/i,
	/\bshall\b/i,
	/\bensure\b/i,
	/\bwrite\b/i,
	/\bcreate\b/i,
	/\bfollow\b/i,
	/\bdo not\b/i,
	/\bapply\b/i,
	/\bimplement\b/i,
	/\brun\b/i,
];

/** Dangerous patterns in skill content that indicate safety risks */
const DANGEROUS_PATTERNS: { pattern: RegExp; label: string; weight: number }[] =
	[
		{ pattern: /\beval\s*\(/i, label: "eval() usage", weight: 20 },
		{ pattern: /\bexec\s*\(/i, label: "exec() usage", weight: 15 },
		{
			pattern: /\bchild_process\b/i,
			label: "child_process reference",
			weight: 10,
		},
		{ pattern: /\brm\s+-rf\b/i, label: "rm -rf command", weight: 20 },
		{
			pattern: /\bcurl\b.*\|\s*(?:sh|bash)\b/i,
			label: "curl piped to shell",
			weight: 25,
		},
		{ pattern: /\bsudo\b/i, label: "sudo usage", weight: 15 },
		{ pattern: /\bchmod\s+777\b/i, label: "chmod 777", weight: 15 },
		{
			pattern: /\b(?:password|secret|token|api_key)\s*[:=]\s*['"][^'"]+['"]/i,
			label: "hardcoded secret",
			weight: 25,
		},
		{
			pattern: /\b__proto__\b|\bconstructor\s*\[/i,
			label: "prototype pollution",
			weight: 20,
		},
		{
			pattern: /\binnerHTML\s*=/i,
			label: "innerHTML assignment (XSS risk)",
			weight: 10,
		},
		{
			pattern: /\bdangerouslySetInnerHTML\b/i,
			label: "dangerouslySetInnerHTML",
			weight: 10,
		},
		{
			pattern: /\bno[- ]?verify\b.*\bgit\b|\bgit\b.*\bno[- ]?verify\b/i,
			label: "git --no-verify bypass",
			weight: 10,
		},
		{
			pattern: /\bforce[- ]?push\b|\bpush\s+--force\b/i,
			label: "force push instruction",
			weight: 10,
		},
		{
			pattern: /\bdisable.*(?:eslint|typescript|security)\b/i,
			label: "linter/security disable",
			weight: 10,
		},
	];

/** Default registry quality threshold */
const DEFAULT_REGISTRY_THRESHOLD = 60;

/**
 * Score completeness (0-100): frontmatter fields, critical rules, structure.
 */
export function scoreCompleteness(parsed: {
	name: string;
	rules: string[];
	rawContent: string;
	triggers: string[];
}): number {
	let score = 0;
	const max = 100;

	// Has a name (10 pts)
	if (parsed.name && parsed.name.length > 0) score += 10;

	// Has triggers / description with "Trigger:" (15 pts)
	if (parsed.triggers.length > 0) score += 15;

	// Has critical rules section (20 pts)
	if (parsed.rules.length > 0) score += 20;

	// Number of rules: 1-2 = 10, 3-5 = 20, 6+ = 25
	if (parsed.rules.length >= 6) score += 25;
	else if (parsed.rules.length >= 3) score += 20;
	else if (parsed.rules.length >= 1) score += 10;

	// Has substantial content (>= 200 chars = 10, >= 500 = 20, >= 1000 = 30)
	const len = parsed.rawContent.length;
	if (len >= 1000) score += 30;
	else if (len >= 500) score += 20;
	else if (len >= 200) score += 10;

	return Math.min(score, max);
}

/**
 * Score clarity (0-100): description quality, rule actionability, no vague terms.
 */
export function scoreClarity(parsed: {
	name: string;
	rules: string[];
	rawContent: string;
	triggers: string[];
}): number {
	let score = 0;
	const max = 100;

	// Trigger description exists and is meaningful (>= 50 chars in raw = 20 pts)
	if (parsed.rawContent.length >= 50) score += 20;

	// Rules contain action verbs (up to 40 pts)
	if (parsed.rules.length > 0) {
		const actionableCount = parsed.rules.filter((rule) =>
			ACTION_VERBS.some((verb) => verb.test(rule)),
		).length;
		const ratio = actionableCount / parsed.rules.length;
		score += Math.round(ratio * 40);
	}

	// Penalty for vague terms in rules (-5 each, max -20)
	let penalty = 0;
	for (const rule of parsed.rules) {
		for (const vague of VAGUE_TERMS) {
			if (vague.test(rule)) {
				penalty += 5;
				break;
			}
		}
	}
	score -= Math.min(penalty, 20);

	// Name is descriptive (not single char) (10 pts)
	if (parsed.name.length >= 3) score += 10;

	// Has multiple triggers (10 pts for >= 2, 20 for >= 3)
	if (parsed.triggers.length >= 3) score += 20;
	else if (parsed.triggers.length >= 2) score += 10;

	// Base content score for having structured sections (10 pts)
	if (/^#+\s/m.test(parsed.rawContent)) score += 10;

	return Math.max(0, Math.min(score, max));
}

/**
 * Score testability (0-100): Given/When/Then scenarios, specific rules.
 */
export function scoreTestability(parsed: {
	name: string;
	rules: string[];
	rawContent: string;
	triggers: string[];
}): number {
	let score = 0;
	const max = 100;

	// Has Given/When/Then scenarios (40 pts)
	const gwtMatches = parsed.rawContent.match(
		/\bGIVEN\b.*\bWHEN\b.*\bTHEN\b/gis,
	);
	const gwtCount = gwtMatches?.length ?? 0;
	if (gwtCount >= 3) score += 40;
	else if (gwtCount >= 1) score += 25;

	// Rules are specific enough (contain file paths, code refs, or patterns)
	const specificRules = parsed.rules.filter(
		(rule) =>
			/[`'"]/.test(rule) ||
			/\.\w+/.test(rule) ||
			/\bfile\b/i.test(rule) ||
			/\bpath\b/i.test(rule),
	).length;

	if (parsed.rules.length > 0) {
		const specificity = specificRules / parsed.rules.length;
		score += Math.round(specificity * 30);
	}

	// Has examples or code blocks (20 pts)
	const codeBlocks = (parsed.rawContent.match(/```/g) ?? []).length / 2;
	if (codeBlocks >= 2) score += 20;
	else if (codeBlocks >= 1) score += 10;

	// Has a "Testing" or "Test" section (10 pts)
	if (/^#+\s.*test/im.test(parsed.rawContent)) score += 10;

	return Math.min(score, max);
}

/**
 * Score token efficiency (0-100): information density (rules per 1000 tokens).
 */
export function scoreTokenEfficiency(parsed: {
	name: string;
	rules: string[];
	rawContent: string;
	triggers: string[];
}): number {
	const tokens = estimateTokens(parsed.rawContent);
	if (tokens === 0) return 0;

	// Rules per 1000 tokens — higher is more efficient
	const rulesPerKToken = (parsed.rules.length / tokens) * 1000;

	// Ideal: 3-8 rules per 1000 tokens
	// < 1 = bloated, > 10 = maybe too terse
	let score: number;
	if (rulesPerKToken >= 3 && rulesPerKToken <= 8) {
		score = 100;
	} else if (rulesPerKToken >= 2) {
		score = 80;
	} else if (rulesPerKToken >= 1) {
		score = 60;
	} else if (rulesPerKToken > 0) {
		score = 40;
	} else {
		score = 10;
	}

	// Bonus for small total size (under 2000 tokens = +0, under 1000 = already great)
	// Penalty for huge skills (> 5000 tokens = -20)
	if (tokens > 5000) score -= 20;
	else if (tokens > 3000) score -= 10;

	return Math.max(0, Math.min(score, 100));
}

/**
 * Score safety (0-100): absence of dangerous patterns, injection risks, credential leaks.
 * Starts at 100 and deducts for each dangerous pattern found.
 */
export function scoreSafety(parsed: {
	name: string;
	rules: string[];
	rawContent: string;
	triggers: string[];
}): number {
	let score = 100;

	for (const { pattern, weight } of DANGEROUS_PATTERNS) {
		if (pattern.test(parsed.rawContent)) {
			score -= weight;
		}
	}

	// Bonus: skill explicitly mentions security best practices (+10, capped at 100)
	if (
		/\bsanitiz/i.test(parsed.rawContent) ||
		/\bescap/i.test(parsed.rawContent)
	) {
		score += 10;
	}
	if (/\bvalidat/i.test(parsed.rawContent)) {
		score += 5;
	}

	return Math.max(0, Math.min(score, 100));
}

/**
 * Score agent readiness (0-100): how well-prepared a skill is for AI agent consumption.
 * Checks for triggers, tool restrictions, examples, structured output, and error handling.
 */
export function scoreAgentReadiness(parsed: {
	name: string;
	rules: string[];
	rawContent: string;
	triggers: string[];
}): number {
	let score = 0;

	// Has triggers for auto-activation (25 pts)
	if (parsed.triggers.length >= 3) score += 25;
	else if (parsed.triggers.length >= 1) score += 15;

	// Has tool restrictions or permissions (e.g., "only use", "do not use", "allowed tools") (20 pts)
	if (
		/\b(?:only use|allowed tools?|restricted to|do not use|forbidden|prohibited)\b/i.test(
			parsed.rawContent,
		)
	) {
		score += 20;
	}

	// Has examples with expected input/output or code blocks (20 pts)
	const codeBlocks = (parsed.rawContent.match(/```/g) ?? []).length / 2;
	if (codeBlocks >= 3) score += 20;
	else if (codeBlocks >= 1) score += 10;

	// Has structured output format (JSON, YAML, or explicit format section) (15 pts)
	if (
		/\boutput format\b/i.test(parsed.rawContent) ||
		/\breturn.*(?:json|yaml|structured)\b/i.test(parsed.rawContent)
	) {
		score += 15;
	} else if (/```(?:json|yaml)/i.test(parsed.rawContent)) {
		score += 10;
	}

	// Has error handling guidance ("if error", "when fails", "fallback") (10 pts)
	if (
		/\b(?:if.*(?:error|fail)|fallback|edge case|error handling)\b/i.test(
			parsed.rawContent,
		)
	) {
		score += 10;
	}

	// Has a clear "when NOT to use" or scope boundary (10 pts)
	if (
		/\b(?:do not trigger|not applicable|out of scope|when not to)\b/i.test(
			parsed.rawContent,
		)
	) {
		score += 10;
	}

	return Math.min(score, 100);
}

/**
 * Convert numeric score to letter grade.
 */
export function computeGrade(overall: number): SkillGrade {
	if (overall >= 90) return "A";
	if (overall >= 80) return "B";
	if (overall >= 70) return "C";
	if (overall >= 60) return "D";
	return "F";
}

/**
 * Score a skill on all 6 dimensions and compute overall with letter grade.
 */
export async function scoreSkill(
	skillPath: string,
	threshold: number = DEFAULT_THRESHOLD,
): Promise<SkillScore | null> {
	const parsed = await parseSkillFile(skillPath);
	if (!parsed) return null;

	const completeness = scoreCompleteness(parsed);
	const clarity = scoreClarity(parsed);
	const testability = scoreTestability(parsed);
	const tokenEfficiency = scoreTokenEfficiency(parsed);
	const safety = scoreSafety(parsed);
	const agentReadiness = scoreAgentReadiness(parsed);

	// Weighted average: completeness 20%, clarity 20%, testability 15%,
	// token-efficiency 15%, safety 15%, agent-readiness 15%
	const overall = Math.round(
		completeness * 0.2 +
			clarity * 0.2 +
			testability * 0.15 +
			tokenEfficiency * 0.15 +
			safety * 0.15 +
			agentReadiness * 0.15,
	);

	const grade = computeGrade(overall);

	return {
		skillName: parsed.name,
		completeness,
		clarity,
		testability,
		tokenEfficiency,
		safety,
		agentReadiness,
		overall,
		grade,
		threshold,
		passing: overall >= threshold,
	};
}

/**
 * Gate check for registry inclusion. Rejects skills below the configured threshold.
 */
export async function registryGate(
	skillPath: string,
	threshold: number = DEFAULT_REGISTRY_THRESHOLD,
): Promise<SkillRegistryGateResult | null> {
	const score = await scoreSkill(skillPath, threshold);
	if (!score) return null;

	const accepted = score.passing;
	let reason: string | undefined;

	if (!accepted) {
		const failures: string[] = [];
		if (score.safety < 60) failures.push(`safety=${score.safety}`);
		if (score.completeness < 40)
			failures.push(`completeness=${score.completeness}`);
		if (score.clarity < 40) failures.push(`clarity=${score.clarity}`);
		if (score.agentReadiness < 30)
			failures.push(`agent-readiness=${score.agentReadiness}`);

		reason =
			failures.length > 0
				? `Rejected (${score.grade}, ${score.overall}/100): weak dimensions — ${failures.join(", ")}`
				: `Rejected (${score.grade}, ${score.overall}/100): below threshold ${threshold}`;
	}

	return {
		skillName: score.skillName,
		score,
		accepted,
		reason,
	};
}

// ── Benchmarking ───────────────────────────────────────────────────────────

/**
 * Run structural quality benchmark checks against a skill.
 */
export async function benchmarkSkill(
	skillPath: string,
): Promise<SkillBenchmarkResult | null> {
	const parsed = await parseSkillFile(skillPath);
	if (!parsed) return null;

	const checks: SkillBenchmarkCheck[] = [];

	// Check 1: Has YAML frontmatter with name
	checks.push({
		name: "has-frontmatter-name",
		passed:
			parsed.name.length > 0 &&
			parsed.name !== path.basename(path.dirname(skillPath)),
		detail:
			parsed.name.length > 0
				? `name: ${parsed.name}`
				: "No explicit name in frontmatter",
	});

	// Check 2: Has trigger keywords
	checks.push({
		name: "has-triggers",
		passed: parsed.triggers.length > 0,
		detail:
			parsed.triggers.length > 0
				? `${parsed.triggers.length} trigger(s) found`
				: 'No "Trigger:" in description',
	});

	// Check 3: Has critical rules (>= 3)
	checks.push({
		name: "has-critical-rules",
		passed: parsed.rules.length >= 3,
		detail: `${parsed.rules.length} rule(s) found`,
	});

	// Check 4: Rules are actionable (contain verbs)
	const actionableRules = parsed.rules.filter((rule) =>
		ACTION_VERBS.some((verb) => verb.test(rule)),
	);
	checks.push({
		name: "rules-actionable",
		passed:
			parsed.rules.length > 0 &&
			actionableRules.length / parsed.rules.length >= 0.5,
		detail: `${actionableRules.length}/${parsed.rules.length} rules have action verbs`,
	});

	// Check 5: Has code examples
	const codeBlocks = (parsed.rawContent.match(/```/g) ?? []).length / 2;
	checks.push({
		name: "has-code-examples",
		passed: codeBlocks >= 1,
		detail: `${Math.floor(codeBlocks)} code block(s)`,
	});

	// Check 6: Has structured sections (headings)
	const headings = (parsed.rawContent.match(/^#+\s/gm) ?? []).length;
	checks.push({
		name: "has-sections",
		passed: headings >= 3,
		detail: `${headings} section heading(s)`,
	});

	// Check 7: Token budget reasonable (< 3000 tokens)
	const tokens = estimateTokens(parsed.rawContent);
	checks.push({
		name: "token-budget-ok",
		passed: tokens <= 3000,
		detail: `~${tokens} tokens`,
	});

	// Check 8: No vague terms in rules
	const vagueRules = parsed.rules.filter((rule) =>
		VAGUE_TERMS.some((vague) => vague.test(rule)),
	);
	checks.push({
		name: "no-vague-rules",
		passed: vagueRules.length === 0,
		detail:
			vagueRules.length > 0
				? `${vagueRules.length} rule(s) contain vague terms`
				: "All rules are specific",
	});

	const passedCount = checks.filter((c) => c.passed).length;
	const passRate = Math.round((passedCount / checks.length) * 100);

	return {
		skillName: parsed.name,
		checks,
		passRate,
	};
}
