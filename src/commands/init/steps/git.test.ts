import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitOptions, InitStep } from "../../../types/index.js";

// ── Mock the hardened installer (D7 reconciliation) ──────────────────────────
// stepGitHooks no longer copies ci-local/ nor flips core.hooksPath; it delegates
// to installCIHooks, the SINGLE writer of .git/hooks and the choke point for the
// ATOMIC hooksPath guard. The lazy `import("../../ci.js")` inside git.ts resolves
// to src/commands/ci.js, which is exactly what this mock intercepts.
const installCIHooks = vi.fn();
vi.mock("../../ci.js", () => ({ installCIHooks }));

// ── Mock exec helper (stepGitInit still shells out to `git init`) ─────────────
vi.mock("../../../lib/exec.js", () => ({
	execFileAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

// ── Mock fs-extra (stepGitInit probes for .git) ──────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

import fs from "fs-extra";
import { stepGitHooks, stepGitInit } from "./git.js";

const mockedFs = vi.mocked(fs);

const okResult = (
	overrides: Partial<{
		installed: string[];
		upgraded: string[];
		backups: string[];
		errors: string[];
		notes: string[];
		states: { name: string; state: string }[];
	}> = {},
) => ({
	installed: ["pre-commit", "pre-push", "commit-msg"],
	upgraded: [],
	backups: [],
	errors: [],
	notes: [],
	states: [],
	...overrides,
});

beforeEach(() => {
	vi.resetAllMocks();
	mockedFs.pathExists.mockResolvedValue(true as never);
	installCIHooks.mockResolvedValue(okResult());
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
		claudePreToolUseGuard: false,
		codeGraph: false,
		dockerDeploy: false,
		dockerServiceName: "app",
		localAi: false,
		dryRun: false,
		...overrides,
	};
}

async function collectGitInit(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepGitInit({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

async function collectGitHooks(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	await stepGitHooks({
		options,
		projectDir: options.projectDir,
		dryRun: options.dryRun,
		onStep: (s) => steps.push(s),
	});
	return steps;
}

describe("stepGitInit", () => {
	it("reports already exists when .git directory is present", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		const steps = await collectGitInit(makeOptions());
		const gitStep = steps.find(
			(s) =>
				s.id === "git-init" &&
				s.status === "done" &&
				s.detail === "already exists",
		);
		expect(gitStep).toBeDefined();
	});
});

describe("stepGitHooks (reconciled to installCIHooks)", () => {
	it("delegates provisioning to installCIHooks — never copies ci-local nor flips core.hooksPath", async () => {
		await collectGitHooks(makeOptions());

		expect(installCIHooks).toHaveBeenCalledWith("/test/project");
		// The step id contract is preserved across the reconciliation.
	});

	it("reports done and keeps the git-hooks step id on a successful install", async () => {
		installCIHooks.mockResolvedValue(
			okResult({ installed: ["pre-commit", "pre-push", "commit-msg"] }),
		);

		const steps = await collectGitHooks(makeOptions());
		const hookStep = steps.find(
			(s) => s.id === "git-hooks" && s.status === "done",
		);
		expect(hookStep).toBeDefined();
	});

	it("surfaces the migration note in the step detail", async () => {
		installCIHooks.mockResolvedValue(
			okResult({
				installed: ["pre-commit", "pre-push", "commit-msg"],
				notes: [
					"legacy javi-forge hooksPath removed; hooks now live in .git/hooks",
				],
			}),
		);

		const steps = await collectGitHooks(makeOptions());
		const hookStep = steps.findLast((s) => s.id === "git-hooks");
		expect(hookStep?.detail).toContain("hooksPath removed");
	});

	it("reports error (not done) when the guard refuses — a foreign hooksPath is honored", async () => {
		installCIHooks.mockResolvedValue(
			okResult({
				installed: [],
				errors: [
					"core.hooksPath is set to '.husky/_' — another hook manager owns this repo's hooks.",
				],
			}),
		);

		const steps = await collectGitHooks(makeOptions());
		const hookStep = steps.findLast((s) => s.id === "git-hooks");
		expect(hookStep?.status).toBe("error");
		expect(hookStep?.detail).toContain("another hook manager");
	});

	it("dry-run reports would-install and calls NOTHING", async () => {
		const steps = await collectGitHooks(makeOptions({ dryRun: true }));

		expect(installCIHooks).not.toHaveBeenCalled();
		const hookStep = steps.find(
			(s) => s.id === "git-hooks" && s.status === "done",
		);
		expect(hookStep?.detail).toMatch(/would install/i);
	});
});
