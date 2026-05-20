import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readFile: vi.fn(),
		readdir: vi.fn(),
		readJson: vi.fn(),
		ensureDir: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock frontmatter ────────────────────────────────────────────────────────
vi.mock("../../lib/frontmatter.js", () => ({
	parseFrontmatter: vi.fn(),
}));

import fs from "fs-extra";
import { parseFrontmatter } from "../../lib/frontmatter.js";
import {
	calculateBudget,
	detectRuleConflict,
	findConflicts,
	findDuplicates,
	generateBudgetOptimizations,
} from "./analysis.js";

const mockedFs = vi.mocked(fs);
const mockedParseFrontmatter = vi.mocked(parseFrontmatter);

beforeEach(() => {
	vi.resetAllMocks();
});

// ── detectRuleConflict ──────────────────────────────────────────────────────

describe("detectRuleConflict", () => {
	it("detects semicolon contradiction via regex-pair", () => {
		const result = detectRuleConflict(
			"Always use semicolons",
			"No semicolons allowed",
		);
		expect(result).toBeTruthy();
		expect(result!.kind).toBe("regex-pair");
	});

	it("detects quote style contradiction", () => {
		const result = detectRuleConflict(
			"Use single quotes for strings",
			"Use double quotes for strings",
		);
		expect(result).toBeTruthy();
		expect(result!.kind).toBe("regex-pair");
	});

	it("detects tabs vs spaces contradiction", () => {
		const result = detectRuleConflict(
			"Use tabs for indentation",
			"Use spaces for indentation",
		);
		expect(result).toBeTruthy();
	});

	it("detects functional vs class-based contradiction", () => {
		const result = detectRuleConflict(
			"Always use class-based components",
			"Always use functional components",
		);
		expect(result).toBeTruthy();
	});

	it("returns null for non-conflicting rules", () => {
		const result = detectRuleConflict(
			"Always write tests",
			"Use TypeScript strict mode",
		);
		expect(result).toBeNull();
	});

	it("detects default vs named export contradiction", () => {
		const result = detectRuleConflict(
			"Prefer default export for components",
			"Always use named export for modules",
		);
		expect(result).toBeTruthy();
	});

	it("detects directive clash for rules not in regex pairs", () => {
		const result = detectRuleConflict(
			"Always use barrel exports for modules",
			"Avoid barrel exports for modules",
		);
		expect(result).toBeTruthy();
		expect(result!.kind).toBe("directive-clash");
	});
});

// ── findConflicts ───────────────────────────────────────────────────────────

describe("findConflicts", () => {
	it("detects conflicts between skills", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue(["skill-a", "skill-b"] as never);

		let callCount = 0;
		mockedFs.readFile.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				return "---\nname: skill-a\ndescription: test\n---\n## Critical Rules\n1. Always use semicolons\n" as never;
			}
			return "---\nname: skill-b\ndescription: test\n---\n## Critical Rules\n1. No semicolons allowed\n" as never;
		});

		mockedParseFrontmatter.mockImplementation((raw: string) => {
			if (raw.includes("skill-a")) {
				return {
					data: { name: "skill-a", description: "test" },
					content: "\n## Critical Rules\n\n1. Always use semicolons in code\n",
				};
			}
			return {
				data: { name: "skill-b", description: "test" },
				content: "\n## Critical Rules\n\n1. No semicolons allowed in code\n",
			};
		});

		const conflicts = await findConflicts("/skills");
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].ruleA.skillName).toBe("skill-a");
		expect(conflicts[0].ruleB.skillName).toBe("skill-b");
		expect(conflicts[0].kind).toBeDefined();
	});

	it("does not flag rules from the same skill", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue(["skill-a"] as never);
		mockedFs.readFile.mockResolvedValue(
			"---\nname: skill-a\ndescription: test\n---\n## Critical Rules\n1. Use tabs\n2. Use spaces\n" as never,
		);
		mockedParseFrontmatter.mockReturnValue({
			data: { name: "skill-a", description: "test" },
			content: "## Critical Rules\n1. Use tabs\n2. Use spaces\n",
		});

		const conflicts = await findConflicts("/skills");
		expect(conflicts).toHaveLength(0);
	});

	it("returns empty when no skills found", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const conflicts = await findConflicts("/nonexistent");
		expect(conflicts).toHaveLength(0);
	});
});

// ── calculateBudget ─────────────────────────────────────────────────────────

describe("calculateBudget", () => {
	it("calculates total tokens for all skills", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue(["skill-a", "skill-b"] as never);

		let callCount = 0;
		mockedFs.readFile.mockImplementation(async () => {
			callCount++;
			// ~100 chars = 25 tokens, ~200 chars = 50 tokens
			if (callCount === 1) return "a".repeat(100) as never;
			return "b".repeat(200) as never;
		});

		mockedParseFrontmatter.mockImplementation((raw: string) => ({
			data: {
				name: raw.startsWith("a") ? "skill-a" : "skill-b",
				description: "test",
			},
			content: raw,
		}));

		const result = await calculateBudget("/skills", 8000);
		expect(result.entries).toHaveLength(2);
		expect(result.totalTokens).toBe(75); // 25 + 50
		expect(result.overBudget).toBe(false);
		expect(result.suggestions).toHaveLength(0);
		expect(result.optimizations).toHaveLength(0);
	});

	it("reports over budget with suggestions", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue(["big-skill"] as never);
		mockedFs.readFile.mockResolvedValue("x".repeat(40000) as never); // 10000 tokens
		mockedParseFrontmatter.mockReturnValue({
			data: { name: "big-skill", description: "test" },
			content: "x".repeat(40000),
		});

		const result = await calculateBudget("/skills", 5000);
		expect(result.overBudget).toBe(true);
		expect(result.totalTokens).toBe(10000);
		expect(result.suggestions.length).toBeGreaterThan(0);
		expect(result.suggestions[0]).toContain("Over budget");
		expect(result.optimizations.length).toBeGreaterThan(0);
		expect(result.optimizations[0].meetsbudget).toBe(true);
	});

	it("returns empty result for nonexistent dir", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const result = await calculateBudget("/nonexistent");
		expect(result.entries).toHaveLength(0);
		expect(result.totalTokens).toBe(0);
		expect(result.overBudget).toBe(false);
		expect(result.optimizations).toHaveLength(0);
	});

	it("sorts entries by token count descending", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue(["small", "large"] as never);

		let callCount = 0;
		mockedFs.readFile.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) return "a".repeat(40) as never; // 10 tokens
			return "b".repeat(400) as never; // 100 tokens
		});

		mockedParseFrontmatter.mockImplementation((raw: string) => ({
			data: {
				name: raw.startsWith("a") ? "small" : "large",
				description: "test",
			},
			content: raw,
		}));

		const result = await calculateBudget("/skills");
		expect(result.entries[0].skillName).toBe("large");
		expect(result.entries[1].skillName).toBe("small");
	});
});

// ── findDuplicates ──────────────────────────────────────────────────────────

describe("findDuplicates", () => {
	it("detects skills with overlapping triggers", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue(["react-skill", "jsx-skill"] as never);

		let callCount = 0;
		mockedFs.readFile.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				return '---\nname: react-skill\ndescription: "Trigger: react components, hooks, JSX"\n---\ncontent' as never;
			}
			return '---\nname: jsx-skill\ndescription: "Trigger: JSX, react patterns, components"\n---\ncontent' as never;
		});

		mockedParseFrontmatter.mockImplementation((raw: string) => {
			if (raw.includes("react-skill")) {
				return {
					data: {
						name: "react-skill",
						description: "Trigger: react components, hooks, JSX",
					},
					content: "content",
				};
			}
			return {
				data: {
					name: "jsx-skill",
					description: "Trigger: JSX, react patterns, components",
				},
				content: "content",
			};
		});

		const duplicates = await findDuplicates("/skills");
		expect(duplicates.length).toBeGreaterThan(0);
		expect(duplicates[0].skillA).toBe("react-skill");
		expect(duplicates[0].skillB).toBe("jsx-skill");
		expect(duplicates[0].similarity).toBeGreaterThanOrEqual(30);
	});

	it("returns empty for skills with no trigger overlap", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue(["python-skill", "rust-skill"] as never);

		let callCount = 0;
		mockedFs.readFile.mockImplementation(async () => {
			callCount++;
			if (callCount === 1) {
				return '---\nname: python-skill\ndescription: "Trigger: python, django, pip"\n---\nc' as never;
			}
			return '---\nname: rust-skill\ndescription: "Trigger: rust, cargo, crate"\n---\nc' as never;
		});

		mockedParseFrontmatter.mockImplementation((raw: string) => {
			if (raw.includes("python")) {
				return {
					data: {
						name: "python-skill",
						description: "Trigger: python, django, pip",
					},
					content: "c",
				};
			}
			return {
				data: {
					name: "rust-skill",
					description: "Trigger: rust, cargo, crate",
				},
				content: "c",
			};
		});

		const duplicates = await findDuplicates("/skills");
		expect(duplicates).toHaveLength(0);
	});
});

// ── generateBudgetOptimizations ──────────────────────────────────────────

describe("generateBudgetOptimizations", () => {
	it("returns empty when under budget", () => {
		const entries = [
			{ skillName: "a", skillPath: "/a", tokens: 100 },
			{ skillName: "b", skillPath: "/b", tokens: 200 },
		];
		const result = generateBudgetOptimizations(entries, 300, 500);
		expect(result).toHaveLength(0);
	});

	it("suggests disabling largest skill first (greedy)", () => {
		const entries = [
			{ skillName: "big", skillPath: "/big", tokens: 3000 },
			{ skillName: "medium", skillPath: "/med", tokens: 2000 },
			{ skillName: "small", skillPath: "/sm", tokens: 500 },
		];
		const result = generateBudgetOptimizations(entries, 5500, 4000);
		expect(result.length).toBeGreaterThan(0);
		expect(result[0].disableSkills).toContain("big");
		expect(result[0].meetsbudget).toBe(true);
	});

	it("suggests single-skill disable when one is enough", () => {
		const entries = [
			{ skillName: "huge", skillPath: "/huge", tokens: 5000 },
			{ skillName: "small", skillPath: "/sm", tokens: 200 },
		];
		const result = generateBudgetOptimizations(entries, 5200, 1000);
		expect(result.length).toBeGreaterThan(0);
		expect(result.some((s) => s.meetsbudget)).toBe(true);
	});

	it("all suggestions have correct structure", () => {
		const entries = [
			{ skillName: "a", skillPath: "/a", tokens: 2000 },
			{ skillName: "b", skillPath: "/b", tokens: 1500 },
			{ skillName: "c", skillPath: "/c", tokens: 1000 },
			{ skillName: "d", skillPath: "/d", tokens: 500 },
		];
		const result = generateBudgetOptimizations(entries, 5000, 3000);
		for (const opt of result) {
			expect(opt.disableSkills.length).toBeGreaterThan(0);
			expect(opt.tokensSaved).toBeGreaterThan(0);
			expect(opt.remainingTokens).toBeLessThan(5000);
			expect(typeof opt.meetsbudget).toBe("boolean");
		}
	});
});
