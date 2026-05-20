import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock frontmatter ────────────────────────────────────────────────────────
vi.mock("../lib/frontmatter.js", () => ({
	parseFrontmatter: vi.fn(),
}));

import fs from "fs-extra";
import { runSkillsDoctor } from "./skills.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
	vi.resetAllMocks();
});

// ── runSkillsDoctor (facade orchestration) ──────────────────────────────────
// Per-module unit tests live colocated with their modules in src/commands/skills/.
// This file keeps only the facade-level integration test for runSkillsDoctor,
// which orchestrates calculateBudget + findConflicts + findDuplicates.

describe("runSkillsDoctor", () => {
	it("runs budget-only mode", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never); // no skills dir

		const result = await runSkillsDoctor({
			mode: "budget",
			skillsDir: "/nonexistent",
			budget: 5000,
		});

		expect(result.conflicts).toHaveLength(0);
		expect(result.duplicates).toHaveLength(0);
		expect(result.budget.budget).toBe(5000);
	});

	it("runs deep doctor mode", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never); // no skills

		const result = await runSkillsDoctor({
			mode: "doctor",
			skillsDir: "/nonexistent",
			deep: true,
		});

		expect(result.conflicts).toHaveLength(0);
		expect(result.duplicates).toHaveLength(0);
		expect(result.budget.entries).toHaveLength(0);
	});

	it("skips conflict/duplicate in non-deep mode", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);

		const result = await runSkillsDoctor({
			mode: "doctor",
			skillsDir: "/nonexistent",
			deep: false,
		});

		expect(result.conflicts).toHaveLength(0);
		expect(result.duplicates).toHaveLength(0);
	});
});
