import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	generateTddPipelineHook,
	installTddPipelineHook,
} from "./tdd-pipeline.js";

// =============================================================================
// generateTddPipelineHook
// =============================================================================

describe("generateTddPipelineHook", () => {
	// ── Strict mode ───────────────────────────────────────────────────────────

	it("generates strict hook with shebang and set -e for node", () => {
		const hook = generateTddPipelineHook("strict", "pnpm run test", "node");
		expect(hook).toContain("#!/bin/bash");
		expect(hook).toContain("set -e");
		expect(hook).toContain("pnpm run test");
		expect(hook).toContain("Stack: node");
		expect(hook).toContain("STRICT");
	});

	it("strict hook exits 1 on test failure", () => {
		const hook = generateTddPipelineHook("strict", "npm test", "node");
		expect(hook).toContain("exit 1");
	});

	it("strict hook shows success message on pass", () => {
		const hook = generateTddPipelineHook("strict", "pytest", "python");
		expect(hook).toContain("All tests passed");
		expect(hook).toContain("Push allowed");
	});

	it("strict hook includes skip instruction", () => {
		const hook = generateTddPipelineHook("strict", "go test ./...", "go");
		expect(hook).toContain("git push --no-verify");
	});

	// ── Warn mode ─────────────────────────────────────────────────────────────

	it("generates warn hook without set -e", () => {
		const hook = generateTddPipelineHook("warn", "pytest", "python");
		expect(hook).toContain("#!/bin/bash");
		expect(hook).not.toContain("set -e");
		expect(hook).toContain("pytest");
		expect(hook).toContain("WARN");
	});

	it("warn hook never exits 1", () => {
		const hook = generateTddPipelineHook("warn", "pnpm run test", "node");
		expect(hook).not.toContain("exit 1");
		expect(hook).toContain("exit 0");
	});

	it("warn hook shows warning on failure", () => {
		const hook = generateTddPipelineHook("warn", "npm test", "node");
		expect(hook).toContain("push will proceed");
	});

	it("warn hook shows success on pass", () => {
		const hook = generateTddPipelineHook("warn", "go test ./...", "go");
		expect(hook).toContain("All tests passed");
	});

	// ── Null test command ─────────────────────────────────────────────────────

	it("generates skip hook when testCmd is null", () => {
		const hook = generateTddPipelineHook("strict", null, "rust");
		expect(hook).toContain("#!/bin/bash");
		expect(hook).toContain("No test command");
		expect(hook).toContain("exit 0");
		expect(hook).not.toContain("set -e");
	});

	it("skip hook mentions the stack", () => {
		const hook = generateTddPipelineHook("warn", null, "elixir");
		expect(hook).toContain("stack 'elixir'");
	});

	// ── Mode displayed in output ──────────────────────────────────────────────

	it("strict hook displays mode in header", () => {
		const hook = generateTddPipelineHook("strict", "npm test", "node");
		expect(hook).toContain("Mode: strict");
	});

	it("warn hook displays mode in header", () => {
		const hook = generateTddPipelineHook("warn", "npm test", "node");
		expect(hook).toContain("Mode: warn");
	});
});

// =============================================================================
// installTddPipelineHook
// =============================================================================

describe("installTddPipelineHook", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "javi-forge-tdd-pipeline-"),
		);
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("returns error when not a git repository", async () => {
		const result = await installTddPipelineHook(tmpDir, "strict");
		expect(result.installed).toEqual([]);
		expect(result.errors).toContain(
			"Not a git repository. Run git init first.",
		);
		expect(result.mode).toBe("strict");
	});

	it("installs pre-push hook in git repo with node stack (strict)", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "vitest run" },
		});
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");

		const result = await installTddPipelineHook(tmpDir, "strict");
		expect(result.installed).toContain("pre-push");
		expect(result.errors).toEqual([]);
		expect(result.mode).toBe("strict");

		const hookPath = path.join(tmpDir, ".git", "hooks", "pre-push");
		expect(await fs.pathExists(hookPath)).toBe(true);

		const stat = await fs.stat(hookPath);
		expect(stat.mode & 0o111).toBeGreaterThan(0);

		const content = await fs.readFile(hookPath, "utf-8");
		expect(content).toContain("pnpm run test");
		expect(content).toContain("STRICT");
	});

	it("installs warn mode hook", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await fs.writeFile(path.join(tmpDir, "pyproject.toml"), "");

		const result = await installTddPipelineHook(tmpDir, "warn");
		expect(result.installed).toContain("pre-push");
		expect(result.mode).toBe("warn");

		const hookPath = path.join(tmpDir, ".git", "hooks", "pre-push");
		const content = await fs.readFile(hookPath, "utf-8");
		expect(content).toContain("WARN");
		expect(content).toContain("pytest");
	});

	it("backs up existing pre-push hook", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git", "hooks"));
		const existingHook = '#!/bin/bash\necho "original hook"';
		await fs.writeFile(
			path.join(tmpDir, ".git", "hooks", "pre-push"),
			existingHook,
		);
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "jest" },
		});
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");

		const result = await installTddPipelineHook(tmpDir, "strict");
		expect(result.installed).toContain("pre-push");
		expect(result.skipped).toContain("pre-push (backed up to pre-push.bak)");

		// Verify backup exists with original content
		const backupPath = path.join(tmpDir, ".git", "hooks", "pre-push.bak");
		expect(await fs.pathExists(backupPath)).toBe(true);
		const backupContent = await fs.readFile(backupPath, "utf-8");
		expect(backupContent).toBe(existingHook);

		// Verify new hook replaced old
		const newContent = await fs.readFile(
			path.join(tmpDir, ".git", "hooks", "pre-push"),
			"utf-8",
		);
		expect(newContent).toContain("TDD PIPELINE");
	});

	it("creates hooks directory if missing", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await fs.writeFile(path.join(tmpDir, "pyproject.toml"), "");

		expect(await fs.pathExists(path.join(tmpDir, ".git", "hooks"))).toBe(false);

		const result = await installTddPipelineHook(tmpDir, "strict");
		expect(result.installed).toContain("pre-push");
		expect(await fs.pathExists(path.join(tmpDir, ".git", "hooks"))).toBe(true);
	});

	it("installs skip hook for unknown stack", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));

		const result = await installTddPipelineHook(tmpDir, "strict");
		expect(result.installed).toContain("pre-push");

		const hookPath = path.join(tmpDir, ".git", "hooks", "pre-push");
		const content = await fs.readFile(hookPath, "utf-8");
		expect(content).toContain("No test command");
	});

	it("returns mode in result for warn", async () => {
		const result = await installTddPipelineHook(tmpDir, "warn");
		expect(result.mode).toBe("warn");
	});
});
