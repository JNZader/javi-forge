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

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock("../../../lib/common.js", () => ({
	ensureDirExists: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock context module ──────────────────────────────────────────────────────
vi.mock("../../../lib/context.js", () => ({
	generateContextDir: vi.fn().mockResolvedValue({
		index: "# test — Project Index\n",
		summary: "# test\n",
	}),
}));

import fs from "fs-extra";
import { generateContextDir } from "../../../lib/context.js";
import { stepContextDir } from "./context-dir.js";

const mockedFs = vi.mocked(fs);
const mockedGenerateContextDir = vi.mocked(generateContextDir);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.writeFile.mockResolvedValue(undefined as never);
	mockedGenerateContextDir.mockResolvedValue({
		index: "# test — Project Index\n",
		summary: "# test\n",
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
	await stepContextDir({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepContextDir", () => {
	it("context-dir step reports done on success", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith(".context")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions({ contextDir: true }));
		const ctxStep = steps.find(
			(s) => s.id === "context-dir" && s.status === "done",
		);
		expect(ctxStep).toBeDefined();
		expect(ctxStep!.detail).toContain("INDEX.md");
	});

	it("context-dir step is skipped when contextDir is false", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collect(makeOptions({ contextDir: false }));
		const ctxStep = steps.find(
			(s) => s.id === "context-dir" && s.status === "skipped",
		);
		expect(ctxStep).toBeDefined();
		expect(ctxStep!.detail).toContain("not selected");
	});

	it("context-dir step reports already exists when .context/ is present", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collect(makeOptions({ contextDir: true }));
		const ctxStep = steps.find(
			(s) =>
				s.id === "context-dir" &&
				s.status === "done" &&
				s.detail === "already exists",
		);
		expect(ctxStep).toBeDefined();
	});

	it("context-dir dry-run writes nothing", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith(".context")) return false as never;
			return true as never;
		});

		const steps = await collect(
			makeOptions({ contextDir: true, dryRun: true }),
		);
		const ctxStep = steps.find(
			(s) => s.id === "context-dir" && s.status === "done",
		);
		expect(ctxStep).toBeDefined();
		expect(ctxStep!.detail).toContain("dry-run");
	});
});
