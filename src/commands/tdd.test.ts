import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateTddHook, getTddTestCommand, installTddHooks } from "./tdd.js";

// =============================================================================
// getTddTestCommand
// =============================================================================

describe("getTddTestCommand", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-tdd-cmd-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("returns pnpm run test for node + pnpm with test script", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "vitest run" },
		});

		const cmd = await getTddTestCommand("node", "pnpm", tmpDir);
		expect(cmd).toBe("pnpm run test");
	});

	it("returns npm test for node + npm with test script", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "jest" },
		});

		const cmd = await getTddTestCommand("node", "npm", tmpDir);
		expect(cmd).toBe("npm test");
	});

	it("returns yarn run test for node + yarn", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "vitest" },
		});

		const cmd = await getTddTestCommand("node", "yarn", tmpDir);
		expect(cmd).toBe("yarn run test");
	});

	it("returns null for node without test script", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { build: "tsc" },
		});

		const cmd = await getTddTestCommand("node", "npm", tmpDir);
		expect(cmd).toBeNull();
	});

	it("returns null for node without package.json", async () => {
		const cmd = await getTddTestCommand("node", "npm", tmpDir);
		expect(cmd).toBeNull();
	});

	it("returns pytest for python", async () => {
		const cmd = await getTddTestCommand("python", "pip", tmpDir);
		expect(cmd).toBe("pytest");
	});

	it("returns go test ./... for go", async () => {
		const cmd = await getTddTestCommand("go", "go", tmpDir);
		expect(cmd).toBe("go test ./...");
	});

	it("returns null for unsupported stack", async () => {
		const cmd = await getTddTestCommand("rust", "cargo", tmpDir);
		expect(cmd).toBeNull();
	});

	it("returns null for elixir stack", async () => {
		const cmd = await getTddTestCommand("elixir", "mix", tmpDir);
		expect(cmd).toBeNull();
	});
});

// =============================================================================
// generateTddHook
// =============================================================================

describe("generateTddHook", () => {
	it("generates valid bash script with shebang for node", () => {
		const hook = generateTddHook("pnpm run test", "node");
		expect(hook).toContain("#!/bin/bash");
		expect(hook).toContain("set -e");
		expect(hook).toContain("pnpm run test");
		expect(hook).toContain("Stack: node");
	});

	it("generates hook with pytest for python", () => {
		const hook = generateTddHook("pytest", "python");
		expect(hook).toContain("pytest");
		expect(hook).toContain("Stack: python");
	});

	it("generates hook with go test for go", () => {
		const hook = generateTddHook("go test ./...", "go");
		expect(hook).toContain("go test ./...");
		expect(hook).toContain("Stack: go");
	});

	it("generates warning hook when testCmd is null", () => {
		const hook = generateTddHook(null, "rust");
		expect(hook).toContain("#!/bin/bash");
		expect(hook).toContain("No test command");
		expect(hook).toContain("exit 0");
		expect(hook).not.toContain("set -e");
	});

	it("includes skip instruction in test hook", () => {
		const hook = generateTddHook("npm test", "node");
		expect(hook).toContain("git commit --no-verify");
	});

	it("includes TDD FAILED message on test failure", () => {
		const hook = generateTddHook("npm test", "node");
		expect(hook).toContain("TDD FAILED");
	});

	it("includes TDD PASSED message on success", () => {
		const hook = generateTddHook("npm test", "node");
		expect(hook).toContain("TDD PASSED");
	});
});

// =============================================================================
// installTddHooks
// =============================================================================

describe("installTddHooks", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "javi-forge-tdd-install-"),
		);
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("returns error when not a git repository", async () => {
		const result = await installTddHooks(tmpDir);
		expect(result.installed).toEqual([]);
		expect(result.errors).toContain(
			"Not a git repository. Run git init first.",
		);
	});

	it("installs pre-commit hook in git repo with node stack", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "vitest run" },
		});
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");

		const result = await installTddHooks(tmpDir);
		expect(result.installed).toContain("pre-commit");
		expect(result.errors).toEqual([]);

		// Verify hook file exists and is executable
		const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
		expect(await fs.pathExists(hookPath)).toBe(true);

		const stat = await fs.stat(hookPath);
		// Check executable bit (owner execute = 0o100)
		expect(stat.mode & 0o111).toBeGreaterThan(0);

		// Verify content references the right test command
		const content = await fs.readFile(hookPath, "utf-8");
		expect(content).toContain("pnpm run test");
	});

	it("installs warning hook for unknown stack", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		// No package.json, no go.mod, etc. — defaults to node with no test script

		const result = await installTddHooks(tmpDir);
		expect(result.installed).toContain("pre-commit");

		const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
		const content = await fs.readFile(hookPath, "utf-8");
		expect(content).toContain("No test command");
	});

	it("installs hook for python stack", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await fs.writeFile(path.join(tmpDir, "pyproject.toml"), "");

		const result = await installTddHooks(tmpDir);
		expect(result.installed).toContain("pre-commit");

		const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
		const content = await fs.readFile(hookPath, "utf-8");
		expect(content).toContain("pytest");
	});

	it("installs hook for go stack", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await fs.writeFile(path.join(tmpDir, "go.mod"), "module example.com/app");

		const result = await installTddHooks(tmpDir);
		expect(result.installed).toContain("pre-commit");

		const hookPath = path.join(tmpDir, ".git", "hooks", "pre-commit");
		const content = await fs.readFile(hookPath, "utf-8");
		expect(content).toContain("go test ./...");
	});

	it("creates hooks directory if missing", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await fs.writeFile(path.join(tmpDir, "pyproject.toml"), "");

		// .git/hooks does not exist yet
		expect(await fs.pathExists(path.join(tmpDir, ".git", "hooks"))).toBe(false);

		const result = await installTddHooks(tmpDir);
		expect(result.installed).toContain("pre-commit");
		expect(await fs.pathExists(path.join(tmpDir, ".git", "hooks"))).toBe(true);
	});
});
