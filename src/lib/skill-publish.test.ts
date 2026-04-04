import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readFile: vi.fn(),
		writeJson: vi.fn(),
		ensureDir: vi.fn(),
		copy: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock frontmatter ────────────────────────────────────────────────────────
vi.mock("./frontmatter.js", () => ({
	parseFrontmatter: vi.fn(),
}));

import fs from "fs-extra";
import { parseFrontmatter } from "./frontmatter.js";
import { publishSkill } from "./skill-publish.js";

const mockFs = vi.mocked(fs);
const mockParseFrontmatter = vi.mocked(parseFrontmatter);

beforeEach(() => {
	vi.resetAllMocks();
	mockFs.pathExists.mockResolvedValue(false as never);
	mockFs.writeJson.mockResolvedValue(undefined as never);
	mockFs.ensureDir.mockResolvedValue(undefined as never);
	mockFs.copy.mockResolvedValue(undefined as never);
});

// ── publishSkill ───────────────────────────────────────────────────────────

describe("publishSkill", () => {
	it("fails when SKILL.md does not exist", async () => {
		const result = await publishSkill({ skillDir: "/skills/react-19" });

		expect(result.success).toBe(false);
		expect(result.error).toContain("SKILL.md not found");
	});

	it("generates plugin.json from SKILL.md frontmatter", async () => {
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (p.endsWith("SKILL.md")) return true;
			return false;
		});

		mockFs.readFile.mockResolvedValue(
			"---\nname: react-19\nversion: 2.0.0\ndescription: React 19 patterns and best practices for modern components\n---\n# React 19\n" as never,
		);

		mockParseFrontmatter.mockReturnValue({
			data: {
				name: "react-19",
				version: "2.0.0",
				description:
					"React 19 patterns and best practices for modern components",
			},
			content: "# React 19\n",
		});

		const result = await publishSkill({ skillDir: "/skills/react-19" });

		expect(result.success).toBe(true);
		expect(result.manifest?.name).toBe("react-19");
		expect(result.manifest?.version).toBe("2.0.0");
		expect(result.manifest?.skills).toEqual(["react-19"]);
		expect(mockFs.writeJson).toHaveBeenCalled();
	});

	it("falls back to directory name when frontmatter has no name", async () => {
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (p.endsWith("SKILL.md")) return true;
			return false;
		});

		mockFs.readFile.mockResolvedValue("# Some Skill\nContent here" as never);

		mockParseFrontmatter.mockReturnValue({
			data: {},
			content: "# Some Skill\nContent here",
		});

		const result = await publishSkill({ skillDir: "/skills/my-skill" });

		expect(result.success).toBe(true);
		expect(result.manifest?.name).toBe("my-skill");
	});

	it("rejects non-kebab-case names", async () => {
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (p.endsWith("SKILL.md")) return true;
			return false;
		});

		mockFs.readFile.mockResolvedValue("content" as never);
		mockParseFrontmatter.mockReturnValue({
			data: { name: "MySkill" },
			content: "content",
		});

		const result = await publishSkill({ skillDir: "/skills/MySkill" });

		expect(result.success).toBe(false);
		expect(result.error).toContain("kebab-case");
	});

	it("rejects too-short descriptions", async () => {
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (p.endsWith("SKILL.md")) return true;
			return false;
		});

		mockFs.readFile.mockResolvedValue("content" as never);
		mockParseFrontmatter.mockReturnValue({
			data: { name: "test-skill", description: "short" },
			content: "content",
		});

		const result = await publishSkill({ skillDir: "/skills/test-skill" });

		expect(result.success).toBe(false);
		expect(result.error).toContain("at least 10 characters");
	});

	it("includes author and repository when provided", async () => {
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (p.endsWith("SKILL.md")) return true;
			return false;
		});

		mockFs.readFile.mockResolvedValue("content" as never);
		mockParseFrontmatter.mockReturnValue({
			data: {
				name: "test-skill",
				description: "A test skill with enough description length",
			},
			content: "content",
		});

		const result = await publishSkill({
			skillDir: "/skills/test-skill",
			author: "JNZader",
			repository: "https://github.com/JNZader/test-skill",
			tags: ["testing", "typescript"],
		});

		expect(result.success).toBe(true);
		expect(result.manifest?.author).toBe("JNZader");
		expect(result.manifest?.repository).toBe(
			"https://github.com/JNZader/test-skill",
		);
		expect(result.manifest?.tags).toEqual(["testing", "typescript"]);
	});

	it("extracts tags from description when none provided", async () => {
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (p.endsWith("SKILL.md")) return true;
			return false;
		});

		mockFs.readFile.mockResolvedValue("content" as never);
		mockParseFrontmatter.mockReturnValue({
			data: {
				name: "react-patterns",
				description: "React and TypeScript patterns for testing components",
			},
			content: "content",
		});

		const result = await publishSkill({ skillDir: "/skills/react-patterns" });

		expect(result.success).toBe(true);
		expect(result.manifest?.tags).toContain("react");
		expect(result.manifest?.tags).toContain("typescript");
		expect(result.manifest?.tags).toContain("testing");
	});

	it("respects dryRun flag", async () => {
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (p.endsWith("SKILL.md")) return true;
			return false;
		});

		mockFs.readFile.mockResolvedValue("content" as never);
		mockParseFrontmatter.mockReturnValue({
			data: {
				name: "dry-skill",
				description: "A dry run test skill for validation",
			},
			content: "content",
		});

		const result = await publishSkill({
			skillDir: "/skills/dry-skill",
			dryRun: true,
		});

		expect(result.success).toBe(true);
		expect(mockFs.writeJson).not.toHaveBeenCalled();
		expect(mockFs.ensureDir).not.toHaveBeenCalled();
	});

	it("truncates description over 200 chars", async () => {
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (p.endsWith("SKILL.md")) return true;
			return false;
		});

		const longDesc = "A".repeat(250);
		mockFs.readFile.mockResolvedValue("content" as never);
		mockParseFrontmatter.mockReturnValue({
			data: { name: "long-desc", description: longDesc },
			content: "content",
		});

		const result = await publishSkill({
			skillDir: "/skills/long-desc",
			dryRun: true,
		});

		expect(result.success).toBe(true);
		expect(result.manifest?.description.length).toBeLessThanOrEqual(200);
		expect(result.manifest?.description).toContain("...");
	});
});
