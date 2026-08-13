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

// ── Mock skill-scanner (only scanSkillFile; shared gate stays REAL) ─────────
vi.mock("./skill-scanner.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./skill-scanner.js")>();
	return { ...actual, scanSkillFile: vi.fn() };
});

import fs from "fs-extra";
import {
	autoInstallSkills,
	formatAutoInstallSummary,
} from "./auto-skill-install.js";
import type { SkillScanResult } from "./skill-scanner.js";
import { scanSkillFile } from "./skill-scanner.js";
import type { StackDetectionResult } from "./stack-detector.js";
import { detectProjectStack } from "./stack-detector.js";

const mockFs = vi.mocked(fs);
const mockDetect = vi.mocked(detectProjectStack);
const mockScanSkillFile = vi.mocked(scanSkillFile);

const baseDetection: StackDetectionResult = {
	stack: "node",
	signals: [
		{ signal: "react", source: "package.json", skills: ["react-19"] },
		{ signal: "typescript", source: "package.json", skills: ["typescript"] },
	],
	recommendedSkills: ["react-19", "typescript"],
};

function scanResult(
	skillName: string,
	verdict: SkillScanResult["verdict"],
): SkillScanResult {
	return {
		skillPath: `/source/skills/${skillName}/SKILL.md`,
		skillName,
		verdict,
		threats: [],
		summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0 },
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	mockFs.pathExists.mockResolvedValue(false as never);
	mockFs.ensureDir.mockResolvedValue(undefined as never);
	mockFs.copy.mockResolvedValue(undefined as never);
	mockScanSkillFile.mockResolvedValue(scanResult("any", "pass") as never);
});

// ── autoInstallSkills ──────────────────────────────────────────────────────

describe("autoInstallSkills", () => {
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

// ── autoInstallSkills — skillguard gate (D4, JD-009) ───────────────────────

describe("autoInstallSkills — skillguard gate", () => {
	function copyableSource(mockPathExists: ReturnType<typeof vi.fn>) {
		mockPathExists.mockImplementation(async (p: string) => {
			// source has every candidate, target has none
			if (p.startsWith("/source/skills/")) return true;
			return false;
		});
	}

	it("refuses to install ANYTHING when a copyable skill blocks — nothing copied (D4)", async () => {
		mockDetect.mockResolvedValue(baseDetection);
		copyableSource(mockFs.pathExists);
		mockScanSkillFile.mockImplementation(async (p: string) => {
			if (p.includes("react-19")) return scanResult("react-19", "block");
			return scanResult("typescript", "pass");
		});

		const result = await autoInstallSkills({
			projectDir: "/project",
			skillsSourceDir: "/source/skills",
			skillsTargetDir: "/target/skills",
		});

		expect(result.installed).toEqual([]);
		expect(result.blocked.map((b) => b.skillName)).toEqual(["react-19"]);
		expect(result.blocked[0].verdict).toBe("block");
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("refuses unscannable copyable sources WITHOUT force — nothing copied", async () => {
		mockDetect.mockResolvedValue(baseDetection);
		copyableSource(mockFs.pathExists);
		mockScanSkillFile.mockResolvedValue(
			scanResult("react-19", "unscannable") as never,
		);

		const result = await autoInstallSkills({
			projectDir: "/project",
			skillsSourceDir: "/source/skills",
			skillsTargetDir: "/target/skills",
		});

		expect(result.installed).toEqual([]);
		expect(result.blocked.map((b) => b.verdict)).toEqual([
			"unscannable",
			"unscannable",
		]);
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("allows unscannable copyable sources WITH force — scanned through the gate", async () => {
		mockDetect.mockResolvedValue(baseDetection);
		copyableSource(mockFs.pathExists);
		mockScanSkillFile.mockResolvedValue(
			scanResult("react-19", "unscannable") as never,
		);

		const result = await autoInstallSkills({
			projectDir: "/project",
			skillsSourceDir: "/source/skills",
			skillsTargetDir: "/target/skills",
			force: true,
		});

		expect(result.installed).toEqual(["react-19", "typescript"]);
		expect(result.blocked).toEqual([]);
		expect(mockScanSkillFile).toHaveBeenCalled();
		expect(mockFs.copy).toHaveBeenCalledTimes(2);
	});

	it("rejects when the gate scan throws — nothing copied (D4)", async () => {
		mockDetect.mockResolvedValue(baseDetection);
		copyableSource(mockFs.pathExists);
		mockScanSkillFile.mockRejectedValue(new Error("scan exploded"));

		await expect(
			autoInstallSkills({
				projectDir: "/project",
				skillsSourceDir: "/source/skills",
				skillsTargetDir: "/target/skills",
			}),
		).rejects.toThrow("scan exploded");
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("dryRun still runs the gate scan (read-only) but copies nothing", async () => {
		mockDetect.mockResolvedValue(baseDetection);
		copyableSource(mockFs.pathExists);

		const result = await autoInstallSkills({
			projectDir: "/project",
			skillsSourceDir: "/source/skills",
			skillsTargetDir: "/target/skills",
			dryRun: true,
		});

		expect(mockScanSkillFile).toHaveBeenCalled(); // scan still happens
		expect(result.installed).toEqual(["react-19", "typescript"]);
		expect(result.blocked).toEqual([]);
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
			blocked: [],
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
			blocked: [],
			detection: { stack: null, signals: [], recommendedSkills: [] },
		});

		expect(summary).toContain("No stack detected");
	});

	it("lists blocked skills and their verdicts", () => {
		const summary = formatAutoInstallSummary({
			installed: [],
			skipped: [],
			notFound: [],
			blocked: [scanResult("react-19", "block")],
			detection: {
				stack: "node",
				signals: [],
				recommendedSkills: ["react-19"],
			},
		});

		expect(summary).toContain("Blocked: react-19 [BLOCK]");
	});
});
