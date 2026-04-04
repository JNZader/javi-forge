import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readJson: vi.fn(),
		readFile: vi.fn(),
		ensureDir: vi.fn(),
		copy: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock stack-detector ─────────────────────────────────────────────────────
vi.mock("./stack-detector.js", () => ({
	detectProjectStack: vi.fn(),
}));

import fs from "fs-extra";
import {
	autoInstallSkills,
	formatAutoInstallSummary,
} from "./auto-skill-install.js";
import type { StackDetectionResult } from "./stack-detector.js";
import { detectProjectStack } from "./stack-detector.js";

const mockFs = vi.mocked(fs);
const mockDetect = vi.mocked(detectProjectStack);

beforeEach(() => {
	vi.resetAllMocks();
	mockFs.pathExists.mockResolvedValue(false as never);
	mockFs.ensureDir.mockResolvedValue(undefined as never);
	mockFs.copy.mockResolvedValue(undefined as never);
});

// ── autoInstallSkills ──────────────────────────────────────────────────────

describe("autoInstallSkills", () => {
	const baseDetection: StackDetectionResult = {
		stack: "node",
		signals: [
			{ signal: "react", source: "package.json", skills: ["react-19"] },
			{ signal: "typescript", source: "package.json", skills: ["typescript"] },
		],
		recommendedSkills: ["react-19", "typescript"],
	};

	it("reports all skills as skipped when source and target are the same", async () => {
		mockDetect.mockResolvedValue(baseDetection);
		mockFs.pathExists.mockResolvedValue(true as never); // All skills exist

		const result = await autoInstallSkills({
			projectDir: "/project",
			skillsSourceDir: "/home/user/.claude/skills",
			skillsTargetDir: "/home/user/.claude/skills",
		});

		expect(result.skipped).toEqual(["react-19", "typescript"]);
		expect(result.installed).toEqual([]);
		expect(result.notFound).toEqual([]);
	});

	it("reports skills as notFound when source does not have them", async () => {
		mockDetect.mockResolvedValue(baseDetection);
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await autoInstallSkills({
			projectDir: "/project",
			skillsSourceDir: "/source/skills",
			skillsTargetDir: "/target/skills",
		});

		expect(result.notFound).toEqual(["react-19", "typescript"]);
		expect(result.installed).toEqual([]);
	});

	it("installs skills from source to different target", async () => {
		mockDetect.mockResolvedValue(baseDetection);

		mockFs.pathExists.mockImplementation(async (p: string) => {
			// Source has both skills
			if (p === "/source/skills/react-19/SKILL.md") return true;
			if (p === "/source/skills/typescript/SKILL.md") return true;
			// Target has neither
			return false;
		});

		const result = await autoInstallSkills({
			projectDir: "/project",
			skillsSourceDir: "/source/skills",
			skillsTargetDir: "/target/skills",
		});

		expect(result.installed).toEqual(["react-19", "typescript"]);
		expect(mockFs.copy).toHaveBeenCalledTimes(2);
	});

	it("skips skills already present in target", async () => {
		mockDetect.mockResolvedValue(baseDetection);

		mockFs.pathExists.mockImplementation(async (p: string) => {
			// Source has both
			if (p === "/source/skills/react-19/SKILL.md") return true;
			if (p === "/source/skills/typescript/SKILL.md") return true;
			// Target already has react-19
			if (p === "/target/skills/react-19/SKILL.md") return true;
			return false;
		});

		const result = await autoInstallSkills({
			projectDir: "/project",
			skillsSourceDir: "/source/skills",
			skillsTargetDir: "/target/skills",
		});

		expect(result.installed).toEqual(["typescript"]);
		expect(result.skipped).toEqual(["react-19"]);
	});

	it("handles no recommended skills gracefully", async () => {
		mockDetect.mockResolvedValue({
			stack: "go",
			signals: [],
			recommendedSkills: [],
		});

		const result = await autoInstallSkills({
			projectDir: "/project",
		});

		expect(result.installed).toEqual([]);
		expect(result.skipped).toEqual([]);
		expect(result.notFound).toEqual([]);
	});

	it("respects dryRun flag", async () => {
		mockDetect.mockResolvedValue(baseDetection);

		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (p === "/source/skills/react-19/SKILL.md") return true;
			if (p === "/source/skills/typescript/SKILL.md") return true;
			return false;
		});

		const result = await autoInstallSkills({
			projectDir: "/project",
			skillsSourceDir: "/source/skills",
			skillsTargetDir: "/target/skills",
			dryRun: true,
		});

		expect(result.installed).toEqual(["react-19", "typescript"]);
		expect(mockFs.copy).not.toHaveBeenCalled();
		expect(mockFs.ensureDir).not.toHaveBeenCalled();
	});
});

// ── formatAutoInstallSummary ───────────────────────────────────────────────

describe("formatAutoInstallSummary", () => {
	it("formats a summary with all categories", () => {
		const summary = formatAutoInstallSummary({
			installed: ["react-19"],
			skipped: ["typescript"],
			notFound: ["zustand-5"],
			detection: {
				stack: "node",
				signals: [
					{ signal: "react", source: "package.json", skills: ["react-19"] },
				],
				recommendedSkills: ["react-19", "typescript", "zustand-5"],
			},
		});

		expect(summary).toContain("Detected stack: node");
		expect(summary).toContain("Installed: react-19");
		expect(summary).toContain("Already present: typescript");
		expect(summary).toContain("Not found: zustand-5");
	});

	it("formats a summary with no stack detected", () => {
		const summary = formatAutoInstallSummary({
			installed: [],
			skipped: [],
			notFound: [],
			detection: { stack: null, signals: [], recommendedSkills: [] },
		});

		expect(summary).toContain("No stack detected");
	});
});
