import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installCIHooks } from "./ci.js";
import { getTddTestCommand } from "./tdd.js";

// =============================================================================
// getTddTestCommand — the ONLY survivor of the TDD fold (S3). The generated-hook
// writers (generateTddHook / installTddHooks) are deleted; the dispatcher's tdd
// section resolves the command at hook-run time instead.
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
// Migration matrix row e — a legacy generated TDD pre-commit hook (interpolated
// body, NO javi-forge marker) classifies FOREIGN, so installCIHooks refuses it
// naming --force; with --force it is backed up (COPYFILE_EXCL ladder) and the
// managed shim overwrites it. That existing refusal+backup path IS the whole
// migration — no bespoke TDD-hook migration code exists.
// =============================================================================

/** A representative body written by the DELETED generateTddHook (no marker). */
const LEGACY_TDD_HOOK = `#!/bin/bash
# =============================================================================
# TDD PRE-COMMIT: Enforced test-driven development
# =============================================================================
# Stack: node | Command: pnpm run test
# To skip: git commit --no-verify
# =============================================================================

set -e

echo "TDD PRE-COMMIT: Running tests..."
pnpm run test || {
    echo "TDD FAILED — Tests did not pass."
    exit 1
}
`;

describe("legacy generated TDD hook migrates via the foreign path (matrix e)", () => {
	let tmpDir: string;
	const preCommit = (dir: string): string =>
		path.join(dir, ".git", "hooks", "pre-commit");

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "javi-forge-tdd-migrate-"),
		);
		execFileSync("git", ["init", "-q"], { cwd: tmpDir });
		await fs.ensureDir(path.join(tmpDir, ".git", "hooks"));
		await fs.writeFile(preCommit(tmpDir), LEGACY_TDD_HOOK, { mode: 0o755 });
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("classifies FOREIGN and refuses without --force, leaving the body untouched", async () => {
		const result = await installCIHooks(tmpDir);

		expect(result.states.find((s) => s.name === "pre-commit")?.state).toBe(
			"foreign",
		);
		const error = result.errors.find((e) => e.startsWith("pre-commit"));
		expect(error).toBeDefined();
		expect(error).toContain("--force");
		// Zero mutation: the legacy body is still exactly what we wrote.
		expect(await fs.readFile(preCommit(tmpDir), "utf8")).toBe(LEGACY_TDD_HOOK);
	});

	it("with --force backs the legacy body up and overwrites it with the managed shim", async () => {
		const result = await installCIHooks(tmpDir, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.backups.length).toBeGreaterThan(0);

		// The backup preserves the original legacy body byte-for-byte.
		const backup = result.backups.find((b) => b.includes("pre-commit"));
		expect(backup).toBeDefined();
		expect(await fs.readFile(backup as string, "utf8")).toBe(LEGACY_TDD_HOOK);

		// The live hook is now the managed shim (marker present, not the old body).
		const live = await fs.readFile(preCommit(tmpDir), "utf8");
		expect(live).toContain("# javi-forge-hook: pre-commit");
		expect(live).not.toContain("TDD PRE-COMMIT");
	});
});
