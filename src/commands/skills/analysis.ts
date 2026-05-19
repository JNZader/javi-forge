import type {
	ConflictKind,
	SkillBudgetEntry,
	SkillBudgetResult,
	SkillBudgetSuggestion,
	SkillConflict,
	SkillCriticalRule,
	SkillDuplicate,
} from "../../types/index.js";
import { CONTRADICTION_PAIRS, DEFAULT_BUDGET } from "./constants.js";
import { detectDirectiveClash } from "./directives.js";
import { discoverSkills, estimateTokens, parseSkillFile } from "./parsing.js";

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
