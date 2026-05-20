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

// ── Mock template module ─────────────────────────────────────────────────────
vi.mock("../../../lib/template.js", () => ({
	generateDependabotYml: vi.fn().mockResolvedValue("dependabot-content"),
	generateCIWorkflow: vi.fn().mockResolvedValue("ci-workflow-content"),
	getCIDestination: vi.fn().mockReturnValue(".github/workflows/ci.yml"),
}));

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock("../../../lib/common.js", () => ({
	backupIfExists: vi.fn().mockResolvedValue(false),
	ensureDirExists: vi.fn().mockResolvedValue(undefined),
}));

import fs from "fs-extra";
import { generateCIWorkflow, getCIDestination } from "../../../lib/template.js";
import { stepCITemplate, stepDependabot } from "./ci.js";

const mockedFs = vi.mocked(fs);
const mockedGenerateCIWorkflow = vi.mocked(generateCIWorkflow);
const mockedGetCIDestination = vi.mocked(getCIDestination);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.writeFile.mockResolvedValue(undefined as never);
	mockedGenerateCIWorkflow.mockResolvedValue("ci-workflow-content");
	mockedGetCIDestination.mockReturnValue(".github/workflows/ci.yml");
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

async function collectCITemplate(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepCITemplate({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

async function collectDependabot(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepDependabot({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepCITemplate", () => {
	it("skips CI step when no template found", async () => {
		mockedGenerateCIWorkflow.mockResolvedValue(null);
		mockedFs.pathExists.mockResolvedValue(true as never);

		const steps = await collectCITemplate(makeOptions());
		const ciStep = steps.find(
			(s) => s.id === "ci-template" && s.status === "skipped",
		);
		expect(ciStep).toBeDefined();
	});
});

describe("stepDependabot", () => {
	it("skips dependabot for non-github providers", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collectDependabot(
			makeOptions({ ciProvider: "gitlab" }),
		);
		const depStep = steps.find(
			(s) => s.id === "dependabot" && s.status === "skipped",
		);
		expect(depStep).toBeDefined();
	});
});
