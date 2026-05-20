import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitOptions, InitStep } from "../../../types/index.js";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readFile: vi.fn(),
		writeFile: vi.fn(),
		copy: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock("../../../lib/common.js", () => ({
	ensureDirExists: vi.fn().mockResolvedValue(undefined),
}));

import fs from "fs-extra";
import { stepMemory } from "./memory.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.writeFile.mockResolvedValue(undefined as never);
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
	await stepMemory({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepMemory", () => {
	it("skips memory when memory is none", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collect(makeOptions({ memory: "none" }));
		const memStep = steps.find(
			(s) => s.id === "memory" && s.status === "skipped",
		);
		expect(memStep).toBeDefined();
	});

	it("reports error when memory module not found", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			// Module source directory doesn't exist
			if (s.includes("modules/engram") && !s.includes(".javi-forge"))
				return false as never;
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions({ memory: "engram" }));
		const memStep = steps.find(
			(s) => s.id === "memory" && s.status === "error",
		);
		expect(memStep).toBeDefined();
		expect(memStep!.detail).toContain("module not found");
	});
});
