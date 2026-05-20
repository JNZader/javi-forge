import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitOptions, InitStep } from "../../../types/index.js";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readdir: vi.fn(),
		writeJson: vi.fn(),
		copy: vi.fn(),
		chmod: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock("../../../lib/common.js", () => ({
	ensureDirExists: vi.fn().mockResolvedValue(undefined),
}));

import fs from "fs-extra";
import { stepHookProfile, stepSecurityHooks } from "./security.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.writeJson.mockResolvedValue(undefined as never);
	mockedFs.copy.mockResolvedValue(undefined as never);
	mockedFs.chmod.mockResolvedValue(undefined as never);
	mockedFs.readdir.mockResolvedValue([
		"pre-commit-secrets",
		"pre-push-deps",
		"pre-commit-permissions",
		"pre-push-signing",
		"pre-push-branch-protection",
		"commit-msg-signing",
		"claude-settings-security.json",
	] as never);
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

async function collectSecurity(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepSecurityHooks({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

async function collectProfile(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepHookProfile({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepSecurityHooks", () => {
	it("security-hooks step copies git hooks and runtime settings when enabled", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			// settings.json does not exist yet
			if (s.endsWith("settings.json")) return false as never;
			return true as never;
		});

		const steps = await collectSecurity(makeOptions({ securityHooks: true }));
		const secStep = steps.find(
			(s) => s.id === "security-hooks" && s.status === "done",
		);
		expect(secStep).toBeDefined();
		expect(secStep!.detail).toContain("6 git layers");

		// Should copy hook files (6 git hooks, not the JSON)
		const copyCalls = mockedFs.copy.mock.calls.map((c: unknown[]) =>
			String(c[0]),
		);
		const securityCopies = copyCalls.filter((p: string) =>
			p.includes("security-hooks"),
		);
		expect(securityCopies.length).toBeGreaterThanOrEqual(6);

		// Should chmod each git hook
		expect(mockedFs.chmod).toHaveBeenCalled();
	});

	it("security-hooks step is skipped when securityHooks is false", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collectSecurity(makeOptions({ securityHooks: false }));
		const secStep = steps.find(
			(s) => s.id === "security-hooks" && s.status === "skipped",
		);
		expect(secStep).toBeDefined();
		expect(secStep!.detail).toContain("not selected");
	});

	it("security-hooks dry-run writes nothing", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collectSecurity(
			makeOptions({ securityHooks: true, dryRun: true }),
		);
		const secStep = steps.find(
			(s) => s.id === "security-hooks" && s.status === "done",
		);
		expect(secStep).toBeDefined();
		expect(secStep!.detail).toContain("dry-run");

		// No copy calls for security hooks in dry-run
		const securityCopies = mockedFs.copy.mock.calls.filter((call: unknown[]) =>
			String(call[0]).includes("security-hooks"),
		);
		expect(securityCopies).toHaveLength(0);
	});

	it("security-hooks reports error when templates not found", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.includes("security-hooks") && !s.includes(".javi-forge"))
				return false as never;
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collectSecurity(makeOptions({ securityHooks: true }));
		const secStep = steps.find(
			(s) => s.id === "security-hooks" && s.status === "error",
		);
		expect(secStep).toBeDefined();
		expect(secStep!.detail).toContain("templates not found");
	});
});

describe("stepHookProfile", () => {
	it("hook-profile step writes profile.json with selected profile", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);

		await collectProfile(
			makeOptions({ securityHooks: true, hookProfile: "strict" }),
		);

		const writeJsonCalls = mockedFs.writeJson.mock.calls;
		const profileCall = writeJsonCalls.find((args) =>
			String(args[0]).endsWith("profile.json"),
		);
		expect(profileCall).toBeDefined();
		expect(profileCall![1]).toEqual({ profile: "strict" });
	});

	it("hook-profile step defaults to standard when hookProfile is not set", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);

		await collectProfile(
			makeOptions({ securityHooks: true, hookProfile: "standard" }),
		);

		const writeJsonCalls = mockedFs.writeJson.mock.calls;
		const profileCall = writeJsonCalls.find((args) =>
			String(args[0]).endsWith("profile.json"),
		);
		expect(profileCall).toBeDefined();
		expect(profileCall![1]).toEqual({ profile: "standard" });
	});

	it("hook-profile step is skipped when securityHooks is false", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);

		const steps = await collectProfile(
			makeOptions({ securityHooks: false, hookProfile: "minimal" }),
		);
		const profileStep = steps.find(
			(s) => s.id === "hook-profile" && s.status === "skipped",
		);
		expect(profileStep).toBeDefined();
		expect(profileStep!.detail).toContain("security hooks not selected");
	});

	it("hook-profile step reports done with profile name in detail", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);

		const steps = await collectProfile(
			makeOptions({ securityHooks: true, hookProfile: "minimal" }),
		);
		const profileStep = steps.find(
			(s) => s.id === "hook-profile" && s.status === "done",
		);
		expect(profileStep).toBeDefined();
		expect(profileStep!.detail).toContain("minimal");
		expect(profileStep!.detail).toContain("profile.json");
	});

	it("hook-profile step is dry-run aware", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);

		const steps = await collectProfile(
			makeOptions({ securityHooks: true, hookProfile: "strict", dryRun: true }),
		);
		const profileStep = steps.find(
			(s) => s.id === "hook-profile" && s.status === "done",
		);
		expect(profileStep).toBeDefined();
		expect(profileStep!.detail).toContain("dry-run");

		// writeJson should NOT have been called in dry-run
		const writeJsonCalls = mockedFs.writeJson.mock.calls;
		const profileCall = writeJsonCalls.find((args) =>
			String(args[0]).endsWith("profile.json"),
		);
		expect(profileCall).toBeUndefined();
	});
});
