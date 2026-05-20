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
	generateDeployWorkflow: vi.fn().mockResolvedValue("deploy-workflow-content"),
	getDeployDestination: vi.fn().mockReturnValue(".github/workflows/deploy.yml"),
}));

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock("../../../lib/common.js", () => ({
	backupIfExists: vi.fn().mockResolvedValue(false),
	ensureDirExists: vi.fn().mockResolvedValue(undefined),
}));

import fs from "fs-extra";
import {
	generateDeployWorkflow,
	getDeployDestination,
} from "../../../lib/template.js";
import { stepDockerDeploy } from "./docker-deploy.js";

const mockedFs = vi.mocked(fs);
const mockedGenerateDeployWorkflow = vi.mocked(generateDeployWorkflow);
const mockedGetDeployDestination = vi.mocked(getDeployDestination);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.writeFile.mockResolvedValue(undefined as never);
	mockedGenerateDeployWorkflow.mockResolvedValue("deploy-workflow-content");
	mockedGetDeployDestination.mockReturnValue(".github/workflows/deploy.yml");
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
	await stepDockerDeploy({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepDockerDeploy", () => {
	it("docker-deploy step reports done when dockerDeploy is true", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith("deploy.yml")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions({ dockerDeploy: true }));
		const deployStep = steps.find(
			(s) => s.id === "docker-deploy" && s.status === "done",
		);
		expect(deployStep).toBeDefined();
		expect(deployStep!.detail).toContain("deploy.yml");
		expect(mockedGenerateDeployWorkflow).toHaveBeenCalledWith("github", "app");
	});

	it("docker-deploy step is skipped when dockerDeploy is false", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collect(makeOptions({ dockerDeploy: false }));
		const deployStep = steps.find(
			(s) => s.id === "docker-deploy" && s.status === "skipped",
		);
		expect(deployStep).toBeDefined();
		expect(deployStep!.detail).toContain("not selected");
	});

	it("docker-deploy step reports already exists when deploy.yml is present", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collect(makeOptions({ dockerDeploy: true }));
		const deployStep = steps.find(
			(s) =>
				s.id === "docker-deploy" &&
				s.status === "done" &&
				s.detail === "already exists",
		);
		expect(deployStep).toBeDefined();
	});

	it("docker-deploy uses custom service name", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith("deploy.yml")) return false as never;
			return true as never;
		});

		await collect(
			makeOptions({ dockerDeploy: true, dockerServiceName: "web" }),
		);
		expect(mockedGenerateDeployWorkflow).toHaveBeenCalledWith("github", "web");
	});

	it("docker-deploy dry-run does not write file", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith("deploy.yml")) return false as never;
			return true as never;
		});

		const steps = await collect(
			makeOptions({ dockerDeploy: true, dryRun: true }),
		);
		const deployStep = steps.find(
			(s) => s.id === "docker-deploy" && s.status === "done",
		);
		expect(deployStep).toBeDefined();
		expect(deployStep!.detail).toContain("dry-run");
		const deployWrites = mockedFs.writeFile.mock.calls.filter(
			(call: unknown[]) => String(call[0]).includes("deploy.yml"),
		);
		expect(deployWrites).toHaveLength(0);
	});
});
