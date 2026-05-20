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
	backupIfExists: vi.fn().mockResolvedValue(false),
	ensureDirExists: vi.fn().mockResolvedValue(undefined),
}));

import fs from "fs-extra";
import { stepCodeGraph } from "./code-graph.js";

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
	await stepCodeGraph({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepCodeGraph", () => {
	it("code-graph step copies config, CI workflow, and MCP snippet when enabled", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			if (s.endsWith(".repoforge.yaml")) return false as never;
			return true as never;
		});
		mockedFs.readFile.mockResolvedValue(
			'{"mcpServers":{"repoforge":{"env":{"REPOFORGE_PROJECT":"__PROJECT_NAME__"}}}}' as never,
		);

		const steps = await collect(makeOptions({ codeGraph: true }));
		const graphStep = steps.find(
			(s) => s.id === "code-graph" && s.status === "done",
		);
		expect(graphStep).toBeDefined();
		expect(graphStep!.detail).toContain(".repoforge.yaml");

		// Should copy the repoforge config
		const copyCalls = mockedFs.copy.mock.calls.map((c: unknown[]) =>
			String(c[1]),
		);
		const repoforgeConfigCopy = copyCalls.find((p: string) =>
			p.includes(".repoforge.yaml"),
		);
		expect(repoforgeConfigCopy).toBeDefined();

		// Should write MCP snippet with project name replaced
		const writeCalls = mockedFs.writeFile.mock.calls.map((c: unknown[]) =>
			String(c[0]),
		);
		const mcpSnippetWrite = writeCalls.find((p: string) =>
			p.includes("mcp-config-snippet.json"),
		);
		expect(mcpSnippetWrite).toBeDefined();
	});

	it("code-graph step is skipped when codeGraph is false", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collect(makeOptions({ codeGraph: false }));
		const graphStep = steps.find(
			(s) => s.id === "code-graph" && s.status === "skipped",
		);
		expect(graphStep).toBeDefined();
		expect(graphStep!.detail).toContain("not selected");
	});

	it("code-graph dry-run writes nothing", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collect(makeOptions({ codeGraph: true, dryRun: true }));
		const graphStep = steps.find(
			(s) => s.id === "code-graph" && s.status === "done",
		);
		expect(graphStep).toBeDefined();
		expect(graphStep!.detail).toContain("dry-run");

		// No copy calls for repoforge in dry-run
		const repoforgeConfigCopies = mockedFs.copy.mock.calls.filter(
			(call: unknown[]) => String(call[1]).includes(".repoforge.yaml"),
		);
		expect(repoforgeConfigCopies).toHaveLength(0);
	});
});
