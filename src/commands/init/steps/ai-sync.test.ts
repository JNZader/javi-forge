import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitOptions, InitStep } from "../../../types/index.js";

// ── Mock exec helper ────────────────────────────────────────────────────────
vi.mock("../../../lib/exec.js", () => ({
	execFileAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

import { execFileAsync } from "../../../lib/exec.js";
import { stepAISync } from "./ai-sync.js";

const mockedExecFileAsync = vi.mocked(execFileAsync);

beforeEach(() => {
	vi.resetAllMocks();
	mockedExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });
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
	await stepAISync({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepAISync", () => {
	it("skips AI sync when aiSync is false", async () => {
		const steps = await collect(makeOptions({ aiSync: false }));
		const aiStep = steps.find(
			(s) => s.id === "ai-sync" && s.status === "skipped",
		);
		expect(aiStep).toBeDefined();
	});

	it("reports error with helpful message when javi-ai not found", async () => {
		// Make javi-ai sync fail with ENOENT
		mockedExecFileAsync.mockRejectedValue(
			new Error("ENOENT: command not found"),
		);

		const steps = await collect(makeOptions({ aiSync: true }));
		const aiStep = steps.find(
			(s) => s.id === "ai-sync" && s.status === "error",
		);
		expect(aiStep).toBeDefined();
		expect(aiStep!.detail).toContain("javi-ai not found");
	});
});
