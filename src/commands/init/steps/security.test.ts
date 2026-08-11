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

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock("../../../lib/common.js", () => ({
	ensureDirExists: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock the hooks-config writer (setHookFeature) ─────────────────────────────
// stepSecurityHooks (S4) folds the security git-hook bodies into `hooks:` config
// entries merged via setHookFeature — no more ci-local/hooks/security/ copy.
vi.mock("../../../lib/ci-config.js", () => ({
	setHookFeature: vi
		.fn()
		.mockResolvedValue("/test/project/.javi-forge/ci.yaml"),
}));

import fs from "fs-extra";
import { setHookFeature } from "../../../lib/ci-config.js";
import { stepSecurityHooks } from "./security.js";

const mockedFs = vi.mocked(fs);
const mockedSetHookFeature = vi.mocked(setHookFeature);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.copy.mockResolvedValue(undefined as never);
	mockedSetHookFeature.mockResolvedValue(
		"/test/project/.javi-forge/ci.yaml" as never,
	);
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
	await stepSecurityHooks({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

function mergedFeatures(): string[] {
	return mockedSetHookFeature.mock.calls.map(
		(c) => `${String(c[1])}.${String(c[2])}`,
	);
}

describe("stepSecurityHooks (S4 fold)", () => {
	it("does NOT copy any ci-local/hooks/security/ git hooks", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) =>
			String(p).endsWith("settings.json") ? false : (true as never),
		);
		await collect(makeOptions({ securityHooks: true, hookProfile: "strict" }));

		const securityHookCopies = mockedFs.copy.mock.calls.filter((c: unknown[]) =>
			String(c[0]).includes(`${"hooks"}/security`),
		);
		expect(securityHookCopies).toHaveLength(0);
	});

	it("KEEPS the .claude/settings.json copy when it does not already exist", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) =>
			String(p).endsWith("settings.json") ? false : (true as never),
		);
		await collect(makeOptions({ securityHooks: true }));

		const settingsCopy = mockedFs.copy.mock.calls.find((c: unknown[]) =>
			String(c[1]).endsWith("settings.json"),
		);
		expect(settingsCopy).toBeDefined();
	});

	it("does NOT overwrite an existing .claude/settings.json", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never); // settings.json exists
		await collect(makeOptions({ securityHooks: true }));

		const settingsCopy = mockedFs.copy.mock.calls.find((c: unknown[]) =>
			String(c[1]).endsWith("settings.json"),
		);
		expect(settingsCopy).toBeUndefined();
	});

	it("strict profile merges secrets + permissions + deps", async () => {
		await collect(makeOptions({ securityHooks: true, hookProfile: "strict" }));
		expect(mergedFeatures()).toEqual([
			"pre-commit.secrets",
			"pre-commit.permissions",
			"pre-push.deps",
		]);
		for (const call of mockedSetHookFeature.mock.calls) {
			expect(call[0]).toBe("/test/project");
			expect(call[3]).toBe(true);
		}
	});

	it("standard profile merges secrets + deps (no permissions)", async () => {
		await collect(
			makeOptions({ securityHooks: true, hookProfile: "standard" }),
		);
		expect(mergedFeatures()).toEqual(["pre-commit.secrets", "pre-push.deps"]);
	});

	it("minimal profile merges NO security sections", async () => {
		await collect(makeOptions({ securityHooks: true, hookProfile: "minimal" }));
		expect(mockedSetHookFeature).not.toHaveBeenCalled();
	});

	it("is skipped when securityHooks is false", async () => {
		const steps = await collect(makeOptions({ securityHooks: false }));
		const step = steps.find(
			(s) => s.id === "security-hooks" && s.status === "skipped",
		);
		expect(step).toBeDefined();
		expect(step!.detail).toContain("not selected");
		expect(mockedSetHookFeature).not.toHaveBeenCalled();
	});

	it("dry-run merges nothing and copies nothing", async () => {
		const steps = await collect(
			makeOptions({ securityHooks: true, hookProfile: "strict", dryRun: true }),
		);
		const step = steps.find(
			(s) => s.id === "security-hooks" && s.status === "done",
		);
		expect(step).toBeDefined();
		expect(step!.detail).toContain("dry-run");
		expect(mockedSetHookFeature).not.toHaveBeenCalled();
		expect(mockedFs.copy).not.toHaveBeenCalled();
	});

	it("reports done with the merged features in the detail", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) =>
			String(p).endsWith("settings.json") ? false : (true as never),
		);
		const steps = await collect(
			makeOptions({ securityHooks: true, hookProfile: "strict" }),
		);
		const step = steps.find(
			(s) => s.id === "security-hooks" && s.status === "done",
		);
		expect(step).toBeDefined();
		expect(step!.detail).toContain("pre-commit.secrets");
		expect(step!.detail).toContain("pre-push.deps");
	});
});
