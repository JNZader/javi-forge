/**
 * Agent Teams parallel dispatch presets — predefined team configurations
 * for common workflows like review, debug, and security scanning.
 *
 * Each preset defines which sub-agents to spawn in parallel, their roles,
 * and how to aggregate results.
 */

// ── Types ──

export interface AgentRole {
	id: string;
	name: string;
	skill: string;
	perspective: string;
	priority: "critical" | "high" | "medium" | "low";
}

export interface TeamPreset {
	name: string;
	description: string;
	roles: AgentRole[];
	aggregation: "all-must-pass" | "majority" | "any-pass";
	maxParallel: number;
}

export interface TeamDispatch {
	preset: string;
	roles: AgentRole[];
	targetFiles: string[];
	context: Record<string, string>;
}

export interface AgentResult {
	roleId: string;
	roleName: string;
	passed: boolean;
	findings: string[];
	severity: "critical" | "high" | "medium" | "low" | "info";
	durationMs: number;
}

export interface TeamResult {
	preset: string;
	passed: boolean;
	agents: AgentResult[];
	totalDurationMs: number;
	summary: string;
}

// ── Built-in presets ──

export const TEAM_PRESETS: Record<string, TeamPreset> = {
	review: {
		name: "review",
		description: "Multi-perspective code review team",
		roles: [
			{
				id: "quality",
				name: "Quality Reviewer",
				skill: "adversarial-review",
				perspective: "code quality, readability, maintainability",
				priority: "high",
			},
			{
				id: "security",
				name: "Security Auditor",
				skill: "adversarial-review",
				perspective: "security vulnerabilities, injection, auth",
				priority: "critical",
			},
			{
				id: "testing",
				name: "Test Reviewer",
				skill: "testing:test-coverage",
				perspective: "test coverage, edge cases, test quality",
				priority: "medium",
			},
		],
		aggregation: "all-must-pass",
		maxParallel: 3,
	},
	debug: {
		name: "debug",
		description: "Parallel debugging team",
		roles: [
			{
				id: "hypothesis",
				name: "Hypothesis Generator",
				skill: "debug-mode",
				perspective: "generate and rank failure hypotheses",
				priority: "high",
			},
			{
				id: "logs",
				name: "Log Analyzer",
				skill: "debug-mode",
				perspective: "parse logs, stack traces, error patterns",
				priority: "high",
			},
			{
				id: "repro",
				name: "Reproducer",
				skill: "testing:e2e",
				perspective: "create minimal reproduction steps",
				priority: "medium",
			},
		],
		aggregation: "any-pass",
		maxParallel: 3,
	},
	security: {
		name: "security",
		description: "Security scanning team",
		roles: [
			{
				id: "sast",
				name: "SAST Scanner",
				skill: "adversarial-review",
				perspective: "static analysis, code patterns, OWASP",
				priority: "critical",
			},
			{
				id: "deps",
				name: "Dependency Auditor",
				skill: "adversarial-review",
				perspective: "supply chain, outdated deps, known CVEs",
				priority: "critical",
			},
			{
				id: "secrets",
				name: "Secret Scanner",
				skill: "adversarial-review",
				perspective: "hardcoded secrets, API keys, credentials",
				priority: "critical",
			},
		],
		aggregation: "all-must-pass",
		maxParallel: 3,
	},
	"tdd-cycle": {
		name: "tdd-cycle",
		description: "TDD pipeline team",
		roles: [
			{
				id: "test-writer",
				name: "Test Writer",
				skill: "testing:tdd",
				perspective: "write failing tests first",
				priority: "high",
			},
			{
				id: "implementer",
				name: "Implementer",
				skill: "sdd-apply",
				perspective: "make tests pass with minimal code",
				priority: "high",
			},
			{
				id: "refactorer",
				name: "Refactorer",
				skill: "refactoring:cleanup",
				perspective: "clean up without breaking tests",
				priority: "medium",
			},
		],
		aggregation: "all-must-pass",
		maxParallel: 1, // sequential for TDD
	},
};

// ── Preset management ──

export function getPreset(name: string): TeamPreset | null {
	return TEAM_PRESETS[name] ?? null;
}

export function listPresets(): Array<{
	name: string;
	description: string;
	roleCount: number;
}> {
	return Object.values(TEAM_PRESETS).map((p) => ({
		name: p.name,
		description: p.description,
		roleCount: p.roles.length,
	}));
}

// ── Dispatch creation ──

export function createDispatch(
	presetName: string,
	targetFiles: string[],
	context: Record<string, string> = {},
): TeamDispatch | null {
	const preset = getPreset(presetName);
	if (!preset) return null;

	return {
		preset: presetName,
		roles: preset.roles,
		targetFiles,
		context,
	};
}

// ── Result aggregation ──

export function aggregateResults(
	preset: TeamPreset,
	results: AgentResult[],
): TeamResult {
	const totalDurationMs = Math.max(...results.map((r) => r.durationMs), 0);

	let passed: boolean;
	switch (preset.aggregation) {
		case "all-must-pass":
			passed = results.every((r) => r.passed);
			break;
		case "majority":
			passed = results.filter((r) => r.passed).length > results.length / 2;
			break;
		case "any-pass":
			passed = results.some((r) => r.passed);
			break;
	}

	const criticalFindings = results
		.filter((r) => r.severity === "critical" && !r.passed)
		.flatMap((r) => r.findings);

	const summary = passed
		? `All ${results.length} agents passed.`
		: `${results.filter((r) => !r.passed).length}/${results.length} agents reported issues.${criticalFindings.length > 0 ? ` ${criticalFindings.length} critical findings.` : ""}`;

	return {
		preset: preset.name,
		passed,
		agents: results,
		totalDurationMs,
		summary,
	};
}

// ── Formatting ──

export function formatTeamResult(result: TeamResult): string {
	const icon = result.passed ? "✅" : "❌";
	const lines: string[] = [
		`${icon} Team: ${result.preset} — ${result.summary}`,
		"",
	];

	for (const agent of result.agents) {
		const aIcon = agent.passed ? "✓" : "✗";
		const dur = `${(agent.durationMs / 1000).toFixed(1)}s`;
		lines.push(`  ${aIcon} ${agent.roleName} [${agent.severity}] ${dur}`);
		if (agent.findings.length > 0) {
			for (const f of agent.findings.slice(0, 3)) {
				lines.push(`    - ${f}`);
			}
			if (agent.findings.length > 3) {
				lines.push(`    ... +${agent.findings.length - 3} more`);
			}
		}
	}

	return lines.join("\n");
}
