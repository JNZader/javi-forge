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
import { benchmarkSkill } from "./benchmark.js";

const mockedFs = vi.mocked(fs);
const mockedParseFrontmatter = vi.mocked(parseFrontmatter);

beforeEach(() => {
	vi.resetAllMocks();
});

// ── benchmarkSkill ─────────────────────────────────────────────────────────

describe("benchmarkSkill", () => {
	it("returns null for nonexistent skill", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const result = await benchmarkSkill("/nonexistent/SKILL.md");
		expect(result).toBeNull();
	});

	it("runs all benchmark checks on a valid skill", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue(
			'---\nname: good-skill\ndescription: "Quality skill. Trigger: When coding, testing"\n---\n\n## Purpose\n\nA good skill.\n\n## Critical Rules\n\n1. Always use strict mode for TypeScript\n2. Never skip error handling in production\n3. Prefer composition over inheritance patterns\n\n## Examples\n\n```ts\nconst x = 1\n```\n' as never,
		);
		mockedParseFrontmatter.mockReturnValue({
			data: {
				name: "good-skill",
				description: "Quality skill. Trigger: When coding, testing",
			},
			content:
				"\n## Purpose\n\nA good skill.\n\n## Critical Rules\n\n1. Always use strict mode for TypeScript\n2. Never skip error handling in production\n3. Prefer composition over inheritance patterns\n\n## Examples\n\n```ts\nconst x = 1\n```\n",
		});

		const result = await benchmarkSkill("/skills/good/SKILL.md");
		expect(result).not.toBeNull();
		expect(result!.skillName).toBe("good-skill");
		expect(result!.checks.length).toBe(8);
		expect(result!.passRate).toBeGreaterThanOrEqual(0);
		expect(result!.passRate).toBeLessThanOrEqual(100);

		// Verify specific checks exist
		const checkNames = result!.checks.map((c) => c.name);
		expect(checkNames).toContain("has-frontmatter-name");
		expect(checkNames).toContain("has-triggers");
		expect(checkNames).toContain("has-critical-rules");
		expect(checkNames).toContain("rules-actionable");
		expect(checkNames).toContain("has-code-examples");
		expect(checkNames).toContain("has-sections");
		expect(checkNames).toContain("token-budget-ok");
		expect(checkNames).toContain("no-vague-rules");
	});

	it("fails checks for a poor skill", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue(
			"Just some text with no structure" as never,
		);
		mockedParseFrontmatter.mockReturnValue(null);

		const result = await benchmarkSkill("/skills/bad/SKILL.md");
		expect(result).not.toBeNull();
		expect(result!.passRate).toBeLessThan(50);
	});
});
