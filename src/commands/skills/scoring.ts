import type {
	SkillGrade,
	SkillRegistryGateResult,
	SkillScore,
} from "../../types/index.js";
import { DEFAULT_REGISTRY_THRESHOLD, DEFAULT_THRESHOLD } from "./constants.js";
import { estimateTokens, parseSkillFile } from "./parsing.js";

// ── Shared scoring lexicons ─────────────────────────────────────────────────

/** Vague terms that reduce clarity score */
export const VAGUE_TERMS = [
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
export const ACTION_VERBS = [
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

// ── Dimension scorers ──────────────────────────────────────────────────────

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
