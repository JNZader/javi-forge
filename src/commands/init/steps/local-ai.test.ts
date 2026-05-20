import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitOptions, InitStep } from "../../../types/index.js";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		copy: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

import fs from "fs-extra";
import { stepLocalAi } from "./local-ai.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.copy.mockResolvedValue(undefined as never);
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
	await stepLocalAi({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepLocalAi", () => {
	it("local-ai step copies docker-compose.yml and .env.local-ai when enabled", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith("docker-compose.yml")) return false as never;
			if (s.endsWith(".env.local-ai")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions({ localAi: true }));
		const aiStep = steps.find(
			(s) => s.id === "local-ai" && s.status === "done",
		);
		expect(aiStep).toBeDefined();
		expect(aiStep!.detail).toContain("docker-compose.yml");

		// Should copy docker-compose.yml
		const copyCalls = mockedFs.copy.mock.calls.map((c: unknown[]) =>
			String(c[1]),
		);
		const composeCopy = copyCalls.find((p: string) =>
			p.includes("docker-compose.yml"),
		);
		expect(composeCopy).toBeDefined();
	});

	it("local-ai step is skipped when localAi is false", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collect(makeOptions({ localAi: false }));
		const aiStep = steps.find(
			(s) => s.id === "local-ai" && s.status === "skipped",
		);
		expect(aiStep).toBeDefined();
		expect(aiStep!.detail).toContain("not selected");
	});

	it("local-ai dry-run writes nothing", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions({ localAi: true, dryRun: true }));
		const aiStep = steps.find(
			(s) => s.id === "local-ai" && s.status === "done",
		);
		expect(aiStep).toBeDefined();
		expect(aiStep!.detail).toContain("dry-run");

		// No copy calls for local-ai in dry-run
		const composeCopies = mockedFs.copy.mock.calls.filter((call: unknown[]) =>
			String(call[1]).includes("docker-compose.yml"),
		);
		expect(composeCopies).toHaveLength(0);
	});
});
