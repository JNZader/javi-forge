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

// Slice 4a: the legacy copy-if-absent scaffold is replaced by the transactional
// managed installer. Mock it so the step wiring is verified without real I/O.
vi.mock("../../../lib/claude-hook-manager.js", () => ({
	installClaudePreToolUse: vi.fn(),
}));

import fs from "fs-extra";
import { setHookFeature } from "../../../lib/ci-config.js";
import { installClaudePreToolUse } from "../../../lib/claude-hook-manager.js";
import { stepSecurityHooks } from "./security.js";

const mockedFs = vi.mocked(fs);
const mockedSetHookFeature = vi.mocked(setHookFeature);
const mockedInstall = vi.mocked(installClaudePreToolUse);

function okResult(changed: string[] = ["/test/project/.claude/settings.json"]) {
	return {
		ok: true,
		changed,
		backups: [],
		errors: [],
		report: {} as never,
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.copy.mockResolvedValue(undefined as never);
	mockedSetHookFeature.mockResolvedValue(
		"/test/project/.javi-forge/ci.yaml" as never,
	);
	mockedInstall.mockResolvedValue(okResult() as never);
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
		claudePreToolUseGuard: true,
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

	it("never copies the legacy claude-settings-security.json scaffold", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) =>
			String(p).endsWith("settings.json") ? false : (true as never),
		);
		await collect(makeOptions({ securityHooks: true }));

		const settingsCopy = mockedFs.copy.mock.calls.find((c: unknown[]) =>
			String(c[1]).endsWith("settings.json"),
		);
		expect(settingsCopy).toBeUndefined();
	});

	it("installs the managed guard when claudePreToolUseGuard is true", async () => {
		const steps = await collect(
			makeOptions({ securityHooks: true, claudePreToolUseGuard: true }),
		);

		expect(mockedInstall).toHaveBeenCalledWith("/test/project");
		const step = steps.find(
			(s) => s.id === "security-hooks" && s.status === "done",
		);
		expect(step).toBeDefined();
		expect(step!.detail).toContain("Claude guard installed");
	});

	it("installs the guard even for the minimal profile", async () => {
		await collect(
			makeOptions({
				securityHooks: true,
				claudePreToolUseGuard: true,
				hookProfile: "minimal",
			}),
		);

		expect(mockedInstall).toHaveBeenCalledWith("/test/project");
	});

	it("reports error when the guard install refuses", async () => {
		mockedInstall.mockResolvedValue({
			ok: false,
			changed: [],
			backups: [],
			errors: ["refuse asset in state edited-managed"],
			report: {} as never,
		} as never);

		const steps = await collect(
			makeOptions({ securityHooks: true, claudePreToolUseGuard: true }),
		);

		const step = steps.find(
			(s) => s.id === "security-hooks" && s.status === "error",
		);
		expect(step).toBeDefined();
		expect(step!.detail).toContain("refuse asset in state edited-managed");
	});

	it("does NOT install the guard when claudePreToolUseGuard is false", async () => {
		await collect(
			makeOptions({ securityHooks: true, claudePreToolUseGuard: false }),
		);

		expect(mockedInstall).not.toHaveBeenCalled();
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

	it("dry-run merges nothing, copies nothing, and installs no guard", async () => {
		const steps = await collect(
			makeOptions({
				securityHooks: true,
				hookProfile: "strict",
				claudePreToolUseGuard: true,
				dryRun: true,
			}),
		);
		const step = steps.find(
			(s) => s.id === "security-hooks" && s.status === "done",
		);
		expect(step).toBeDefined();
		expect(step!.detail).toContain("dry-run");
		expect(step!.detail).toContain("guard");
		expect(mockedSetHookFeature).not.toHaveBeenCalled();
		expect(mockedFs.copy).not.toHaveBeenCalled();
		expect(mockedInstall).not.toHaveBeenCalled();
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
