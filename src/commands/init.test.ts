import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InitOptions, InitStep } from "../types/index.js";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readFile: vi.fn(),
		readJson: vi.fn(),
		readdir: vi.fn(),
		writeFile: vi.fn(),
		writeJson: vi.fn(),
		copy: vi.fn(),
		ensureDir: vi.fn(),
		chmod: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock exec helper ────────────────────────────────────────────────────────
vi.mock("../lib/exec.js", () => ({
	execFileAsync: vi.fn().mockResolvedValue({ stdout: "", stderr: "" }),
}));

// ── Mock template module ─────────────────────────────────────────────────────
vi.mock("../lib/template.js", () => ({
	generateDependabotYml: vi.fn().mockResolvedValue("dependabot-content"),
	generateCIWorkflow: vi.fn().mockResolvedValue("ci-workflow-content"),
	getCIDestination: vi.fn().mockReturnValue(".github/workflows/ci.yml"),
	generateDeployWorkflow: vi.fn().mockResolvedValue("deploy-workflow-content"),
	getDeployDestination: vi.fn().mockReturnValue(".github/workflows/deploy.yml"),
}));

// ── Mock context module ──────────────────────────────────────────────────────
vi.mock("../lib/context.js", () => ({
	generateContextDir: vi.fn().mockResolvedValue({
		index: "# test — Project Index\n",
		summary: "# test\n",
	}),
}));

// ── Mock common module ───────────────────────────────────────────────────────
vi.mock("../lib/common.js", () => ({
	backupIfExists: vi.fn().mockResolvedValue(false),
	ensureDirExists: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock claudemd module ────────────────────────────────────────────────────
vi.mock("../lib/claudemd.js", () => ({
	generateSmartClaudeMd: vi
		.fn()
		.mockReturnValue("# test-project\n\n## Stack\n"),
}));

// ── Mock stack-detector module ──────────────────────────────────────────────
vi.mock("../lib/stack-detector.js", () => ({
	detectProjectStack: vi.fn().mockResolvedValue({
		stack: "node",
		signals: [],
		recommendedSkills: ["typescript", "react-19"],
	}),
}));

import fs from "fs-extra";
import { execFileAsync } from "../lib/exec.js";
import { generateCIWorkflow } from "../lib/template.js";
import { initProject } from "./init.js";

const mockedFs = vi.mocked(fs);
const mockedExecFileAsync = vi.mocked(execFileAsync);
const mockedGenerateCIWorkflow = vi.mocked(generateCIWorkflow);

beforeEach(() => {
	vi.resetAllMocks();

	// Default: most things exist
	mockedFs.pathExists.mockResolvedValue(true as never);
	mockedFs.writeFile.mockResolvedValue(undefined as never);
	mockedFs.writeJson.mockResolvedValue(undefined as never);
	mockedFs.copy.mockResolvedValue(undefined as never);
	mockedFs.ensureDir.mockResolvedValue(undefined as never);
	mockedFs.readdir.mockResolvedValue([
		"pre-commit-secrets",
		"pre-push-deps",
		"pre-commit-permissions",
		"pre-push-signing",
		"pre-push-branch-protection",
		"commit-msg-signing",
		"claude-settings-security.json",
	] as never);
	mockedFs.chmod.mockResolvedValue(undefined as never);

	// Default: exec succeeds
	mockedExecFileAsync.mockResolvedValue({ stdout: "", stderr: "" });

	// Default: CI workflow available
	mockedGenerateCIWorkflow.mockResolvedValue("ci-workflow-content");
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

function collectSteps(options: InitOptions): Promise<InitStep[]> {
	const steps: InitStep[] = [];
	return initProject(options, (step) => steps.push(step)).then(() => steps);
}

// ═══════════════════════════════════════════════════════════════════════════════
// initProject — facade orchestration tests
//
// Per-step unit tests live colocated with their step modules under
// src/commands/init/steps/. This file keeps only tests that exercise the
// orchestrator end-to-end:
//   - aggregate happy-path / dry-run / continue-on-error behavior
//   - inter-step ordering invariants (e.g. agent-skills after local-ai)
//   - the 19-step ordering contract (locks the exact canonical order)
// ═══════════════════════════════════════════════════════════════════════════════
describe("initProject", () => {
	it("completes full happy path — all steps report done", async () => {
		// .git doesn't exist yet so it initializes
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collectSteps(makeOptions());
		const doneSteps = steps.filter((s) => s.status === "done");
		// Should have multiple 'done' status steps
		expect(doneSteps.length).toBeGreaterThanOrEqual(8);
	});

	it("dry-run: no filesystem writes are made", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const _steps = await collectSteps(makeOptions({ dryRun: true }));
		// In dry-run, fs.writeFile and fs.writeJson should not be called
		expect(mockedFs.writeFile).not.toHaveBeenCalled();
		expect(mockedFs.writeJson).not.toHaveBeenCalled();
	});

	it("continues other steps when one step errors", async () => {
		// Make CI generation throw
		mockedGenerateCIWorkflow.mockRejectedValue(new Error("CI template error"));
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collectSteps(makeOptions());
		// Should have both error and done steps
		const errorSteps = steps.filter((s) => s.status === "error");
		const doneSteps = steps.filter((s) => s.status === "done");
		expect(errorSteps.length).toBeGreaterThanOrEqual(1);
		expect(doneSteps.length).toBeGreaterThanOrEqual(5);
	});

	it("agent-skills step runs after local-ai and before manifest", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collectSteps(makeOptions());
		const stepIds = steps.map((s) => s.id);
		const localAiIdx = stepIds.lastIndexOf("local-ai");
		const skillsIdx = stepIds.indexOf("agent-skills");
		const manifestIdx = stepIds.indexOf("manifest");

		expect(skillsIdx).toBeGreaterThan(localAiIdx);
		expect(skillsIdx).toBeLessThan(manifestIdx);
	});

	it("hook-profile step runs after security-hooks", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps = await collectSteps(
			makeOptions({ securityHooks: true, hookProfile: "standard" }),
		);
		const stepIds = steps.map((s) => s.id);
		const securityIdx = stepIds.lastIndexOf("security-hooks");
		const profileIdx = stepIds.indexOf("hook-profile");

		expect(profileIdx).toBeGreaterThan(securityIdx);
	});

	// ── Step ordering contract ────────────────────────────────────────────────
	// Locks the EXACT order of all 19 step IDs emitted by initProject. This
	// contract MUST stay green through every PR in the init.ts split refactor
	// (PRs 1-6). If you add/remove/reorder a step, update this test
	// intentionally — never just to "make it pass".
	it("emits steps in exact known order", async () => {
		// .git doesn't exist so git-init reports 'done', not skipped
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".git")) return false as never;
			return true as never;
		});

		const steps: InitStep[] = [];
		await initProject(
			makeOptions({
				// Enable every opt-in flag so every step reaches a terminal status
				memory: "engram",
				aiSync: true,
				sdd: true,
				ghagga: true,
				mock: true,
				contextDir: true,
				claudeMd: true,
				securityHooks: true,
				hookProfile: "standard",
				codeGraph: true,
				dockerDeploy: true,
				localAi: true,
			}),
			(s) => {
				steps.push(s);
			},
		);

		// Filter to terminal status events (one per step) and assert exact order.
		const stepIds = steps
			.filter(
				(s) =>
					s.status === "done" || s.status === "skipped" || s.status === "error",
			)
			.map((s) => s.id);

		expect(stepIds).toEqual([
			"git-init",
			"git-hooks",
			"ci-template",
			"gitignore",
			"dependabot",
			"memory",
			"ai-sync",
			"sdd",
			"ghagga",
			"mock",
			"context-dir",
			"claude-md",
			"docker-deploy",
			"security-hooks",
			"hook-profile",
			"code-graph",
			"local-ai",
			"agent-skills",
			"manifest",
		]);
	});
});
