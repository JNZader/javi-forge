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

// ── Mock safe-read ──────────────────────────────────────────────────────────
// parseSkillFile reads through the guarded reader; the suite still drives file
// content through the fs-extra mock above.
vi.mock("../../lib/safe-read.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../lib/safe-read.js")>();
	return { ...actual, safeReadFile: vi.fn() };
});

import fs from "fs-extra";
import { parseFrontmatter } from "../../lib/frontmatter.js";
import { safeReadFile } from "../../lib/safe-read.js";
import { benchmarkSkill } from "./benchmark.js";

const mockedFs = vi.mocked(fs);
const mockedParseFrontmatter = vi.mocked(parseFrontmatter);

const mockedSafeReadFile = vi.mocked(safeReadFile);

/** Route safeReadFile through the fs-extra readFile mock. */
function wireSafeReadToMockedFs(): void {
	mockedSafeReadFile.mockImplementation(async (filePath) => {
		const content = await (
			mockedFs.readFile as unknown as (
				p: string,
				enc: string,
			) => Promise<unknown>
		)(filePath, "utf-8");
		if (typeof content !== "string") {
			return { ok: false, reason: "not-found" };
		}
		const bytes = Buffer.byteLength(content, "utf-8");
		return {
			ok: true,
			content,
			truncated: false,
			bytesRead: bytes,
			totalBytes: bytes,
			longLinesClamped: false,
		};
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	wireSafeReadToMockedFs();
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

	it("represents an unreadable skill as unread, not a run of failed checks", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedSafeReadFile.mockResolvedValue({
			ok: false,
			reason: "too-large",
			detail: "3000000 bytes exceeds limit of 1048576",
		});

		const result = await benchmarkSkill("/skills/huge/SKILL.md");
		expect(result).not.toBeNull();
		expect(result!.unread).toBeTruthy();
		expect(result!.checks).toHaveLength(0);
		expect(result!.passRate).toBe(0);
	});
});
