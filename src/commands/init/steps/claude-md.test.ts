import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitOptions, InitStep } from "../../../types/index.js";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		writeFile: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock claudemd module ────────────────────────────────────────────────────
vi.mock("../../../lib/claudemd.js", () => ({
	generateSmartClaudeMd: vi
		.fn()
		.mockReturnValue("# test-project\n\n## Stack\n"),
}));

// ── Mock stack-detector module ──────────────────────────────────────────────
vi.mock("../../../lib/stack-detector.js", () => ({
	detectProjectStack: vi.fn().mockResolvedValue({
		stack: "node",
		signals: [],
		recommendedSkills: ["typescript", "react-19"],
	}),
}));

import fs from "fs-extra";
import { generateSmartClaudeMd } from "../../../lib/claudemd.js";
import { detectProjectStack } from "../../../lib/stack-detector.js";
import { stepClaudeMd } from "./claude-md.js";

const mockedFs = vi.mocked(fs);
const mockedGenerateSmartClaudeMd = vi.mocked(generateSmartClaudeMd);
const mockedDetectProjectStack = vi.mocked(detectProjectStack);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.writeFile.mockResolvedValue(undefined as never);
	mockedGenerateSmartClaudeMd.mockReturnValue("# test-project\n\n## Stack\n");
	mockedDetectProjectStack.mockResolvedValue({
		stack: "node",
		signals: [],
		recommendedSkills: ["typescript", "react-19"],
	});
});

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
	return {
		projectName: "test-project",
		projectDir: "/test/project",
		stack: "node",
		ciProvider: "github",
		memory: "engram",
		aiSync: true,
		sdd: true,
		ghagga: true,
		mock: false,
		contextDir: true,
		claudeMd: true,
		securityHooks: true,
		hookProfile: "standard",
		codeGraph: false,
		dockerDeploy: false,
		dockerServiceName: "app",
		localAi: false,
		dryRun: false,
		...overrides,
	};
}

async function collect(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepClaudeMd({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepClaudeMd", () => {
	it("claude-md step reports done when claudeMd is true", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith("CLAUDE.md")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions({ claudeMd: true }));
		const claudeStep = steps.find(
			(s) => s.id === "claude-md" && s.status === "done",
		);
		expect(claudeStep).toBeDefined();
		expect(mockedGenerateSmartClaudeMd).toHaveBeenCalled();
	});

	it("claude-md step reports skipped when claudeMd is false", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collect(makeOptions({ claudeMd: false }));
		const claudeStep = steps.find(
			(s) => s.id === "claude-md" && s.status === "skipped",
		);
		expect(claudeStep).toBeDefined();
	});

	it("claude-md step skips write when CLAUDE.md already exists", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);

		const steps = await collect(makeOptions({ claudeMd: true }));
		const claudeStep = steps.find(
			(s) =>
				s.id === "claude-md" &&
				s.status === "done" &&
				s.detail === "already exists",
		);
		expect(claudeStep).toBeDefined();
		expect(mockedGenerateSmartClaudeMd).not.toHaveBeenCalled();
	});

	it("claude-md dry-run does not write file", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith("CLAUDE.md")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions({ claudeMd: true, dryRun: true }));
		const claudeStep = steps.find(
			(s) => s.id === "claude-md" && s.status === "done",
		);
		expect(claudeStep).toBeDefined();
		expect(claudeStep!.detail).toContain("dry-run");
		// writeFile should NOT be called with CLAUDE.md path
		const claudeMdWrites = mockedFs.writeFile.mock.calls.filter(
			(call: unknown[]) => String(call[0]).includes("CLAUDE.md"),
		);
		expect(claudeMdWrites).toHaveLength(0);
	});
});
