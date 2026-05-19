import type { SkillDoctorResult } from "../types/index.js";
import {
	calculateBudget,
	findConflicts,
	findDuplicates,
} from "./skills/analysis.js";
import { DEFAULT_BUDGET, DEFAULT_SKILLS_DIR } from "./skills/constants.js";

// ── Re-exports (facade) ──────────────────────────────────────────────────────

export {
	calculateBudget,
	detectRuleConflict,
	findConflicts,
	findDuplicates,
	generateBudgetOptimizations,
} from "./skills/analysis.js";
export { benchmarkSkill } from "./skills/benchmark.js";
export type { RuleDirective } from "./skills/directives.js";
export {
	detectDirectiveClash,
	extractDirective,
	subjectsSimilar,
} from "./skills/directives.js";
export {
	discoverSkills,
	estimateTokens,
	extractCriticalRules,
	extractTriggers,
	parseSkillFile,
} from "./skills/parsing.js";
export {
	computeGrade,
	registryGate,
	scoreAgentReadiness,
	scoreClarity,
	scoreCompleteness,
	scoreSafety,
	scoreSkill,
	scoreTestability,
	scoreTokenEfficiency,
} from "./skills/scoring.js";

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
