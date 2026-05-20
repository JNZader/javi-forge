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
	discoverSkills,
	estimateTokens,
	extractCriticalRules,
	extractTriggers,
	parseSkillFile,
} from "./parsing.js";

const mockedFs = vi.mocked(fs);
const mockedParseFrontmatter = vi.mocked(parseFrontmatter);

beforeEach(() => {
	vi.resetAllMocks();
});

// ── estimateTokens ──────────────────────────────────────────────────────────

describe("estimateTokens", () => {
	it("estimates tokens from character count", () => {
		expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 → 3
	});

	it("returns 0 for empty string", () => {
		expect(estimateTokens("")).toBe(0);
	});

	it("handles long content", () => {
		const content = "a".repeat(4000);
		expect(estimateTokens(content)).toBe(1000);
	});
});

// ── extractCriticalRules ────────────────────────────────────────────────────

describe("extractCriticalRules", () => {
	it("extracts numbered rules from Critical Rules section", () => {
		const content = `
## Critical Rules

1. Always use semicolons
2. Prefer named exports over default exports
3. No any types allowed

## Other Section
`;
		const rules = extractCriticalRules(content);
		expect(rules).toHaveLength(3);
		expect(rules[0]).toBe("Always use semicolons");
		expect(rules[1]).toBe("Prefer named exports over default exports");
		expect(rules[2]).toBe("No any types allowed");
	});

	it("extracts bullet rules from Critical Rules section", () => {
		const content = `
## Critical Rules

- Use tabs for indentation
- Always write tests first

## Next
`;
		const rules = extractCriticalRules(content);
		expect(rules).toHaveLength(2);
		expect(rules[0]).toBe("Use tabs for indentation");
	});

	it("falls back to Rules section if no Critical Rules", () => {
		const content = `
## Rules

1. Use functional components only
2. No class-based patterns

## End
`;
		const rules = extractCriticalRules(content);
		expect(rules).toHaveLength(2);
		expect(rules[0]).toBe("Use functional components only");
	});

	it("returns empty array when no rules found", () => {
		const content = `## Some Section\n\nJust text here.\n`;
		const rules = extractCriticalRules(content);
		expect(rules).toHaveLength(0);
	});

	it("filters out very short rules", () => {
		const content = `\n## Critical Rules\n\n1. Yes\n2. This is a proper rule statement\n`;
		const rules = extractCriticalRules(content);
		expect(rules).toHaveLength(1);
		expect(rules[0]).toBe("This is a proper rule statement");
	});
});

// ── extractTriggers ─────────────────────────────────────────────────────────

describe("extractTriggers", () => {
	it("extracts trigger keywords from description", () => {
		const desc =
			"React 19 patterns. Trigger: When writing React components, hooks, or JSX";
		const triggers = extractTriggers(desc);
		expect(triggers.length).toBeGreaterThan(0);
		expect(triggers.some((t) => t.includes("react"))).toBe(true);
	});

	it("returns empty for descriptions without Trigger:", () => {
		const desc = "A general utility skill for stuff";
		const triggers = extractTriggers(desc);
		expect(triggers).toHaveLength(0);
	});

	it("splits on commas and or", () => {
		const desc = "Trigger: When using Zod, validation, or schema design";
		const triggers = extractTriggers(desc);
		expect(triggers.length).toBeGreaterThanOrEqual(2);
	});
});

// ── discoverSkills ──────────────────────────────────────────────────────────

describe("discoverSkills", () => {
	it("discovers SKILL.md files in subdirectories", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith("skills")) return true as never;
			if (s.endsWith("SKILL.md")) return true as never;
			return false as never;
		});
		mockedFs.readdir.mockResolvedValue([
			"react-19",
			"typescript",
			".hidden",
			"_shared",
		] as never);

		const skills = await discoverSkills("/home/test/.claude/skills");
		expect(skills).toHaveLength(2);
		expect(skills[0]).toContain("react-19");
		expect(skills[1]).toContain("typescript");
	});

	it("returns empty array if dir does not exist", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const skills = await discoverSkills("/nonexistent");
		expect(skills).toHaveLength(0);
	});

	it("skips entries without SKILL.md", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s === "/home/test/.claude/skills") return true as never;
			// Only the "has-skill" directory has a SKILL.md
			if (s.includes("/has-skill/SKILL.md")) return true as never;
			return false as never;
		});
		mockedFs.readdir.mockResolvedValue(["has-skill", "no-skill"] as never);

		const skills = await discoverSkills("/home/test/.claude/skills");
		expect(skills).toHaveLength(1);
		expect(skills[0]).toContain("has-skill");
	});
});

// ── parseSkillFile ──────────────────────────────────────────────────────────

describe("parseSkillFile", () => {
	it("parses a skill file with frontmatter", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue(
			"---\nname: test-skill\ndescription: A test. Trigger: When testing\n---\n\n## Critical Rules\n\n1. Always test first before shipping\n" as never,
		);
		mockedParseFrontmatter.mockReturnValue({
			data: {
				name: "test-skill",
				description: "A test. Trigger: When testing",
			},
			content: "\n## Critical Rules\n\n1. Always test first before shipping\n",
		});

		const result = await parseSkillFile("/skills/test/SKILL.md");
		expect(result).not.toBeNull();
		expect(result!.name).toBe("test-skill");
		expect(result!.rules).toHaveLength(1);
		expect(result!.triggers.length).toBeGreaterThan(0);
	});

	it("returns null for nonexistent file", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const result = await parseSkillFile("/nonexistent/SKILL.md");
		expect(result).toBeNull();
	});

	it("uses directory name when frontmatter has no name", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue(
			"Just content, no frontmatter" as never,
		);
		mockedParseFrontmatter.mockReturnValue(null);

		const result = await parseSkillFile("/skills/my-skill/SKILL.md");
		expect(result).not.toBeNull();
		expect(result!.name).toBe("my-skill");
	});
});
