import path from "node:path";
import type {
	SkillBenchmarkCheck,
	SkillBenchmarkResult,
} from "../../types/index.js";
import { estimateTokens, parseSkillFile } from "./parsing.js";
import { ACTION_VERBS, VAGUE_TERMS } from "./scoring.js";

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
