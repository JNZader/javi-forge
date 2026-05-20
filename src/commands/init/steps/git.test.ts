import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitOptions, InitStep } from "../../../types/index.js";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		copy: vi.fn(),
		readdir: vi.fn(),
		chmod: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock exec helper ────────────────────────────────────────────────────────
vi.mock("../../../lib/exec.js", () => ({
	execFileAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

import fs from "fs-extra";
import { stepGitHooks, stepGitInit } from "./git.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.copy.mockResolvedValue(undefined as never);
	mockedFs.chmod.mockResolvedValue(undefined as never);
	mockedFs.readdir.mockResolvedValue([] as never);
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

async function collectGitInit(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepGitInit({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

async function collectGitHooks(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepGitHooks({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepGitInit", () => {
	it("reports already exists when .git directory is present", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collectGitInit(makeOptions());
		const gitStep = steps.find(
			(s) =>
				s.id === "git-init" &&
				s.status === "done" &&
				s.detail === "already exists",
		);
		expect(gitStep).toBeDefined();
	});
});

describe("stepGitHooks", () => {
	it("skips hooks when ci-local dir is missing", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.includes("ci-local")) return false as never;
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collectGitHooks(makeOptions());
		const hookStep = steps.find(
			(s) => s.id === "git-hooks" && s.status === "skipped",
		);
		expect(hookStep).toBeDefined();
	});
});
