import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installCIHooks } from "../commands/ci.js";
import {
	cleanupTempDir,
	createTempDir,
	fileExists,
	getFileMode,
	readGenerated,
} from "./helpers.js";

let tmpDir: string;

describe("installCIHooks() — integration", () => {
	beforeEach(async () => {
		tmpDir = await createTempDir("ci-init-test-");
		// Init a real git repo
		execFileSync("git", ["init"], { cwd: tmpDir });
	});

	afterEach(async () => {
		await cleanupTempDir(tmpDir);
	});

	it("creates pre-commit, pre-push, and commit-msg hooks", async () => {
		const { installed, errors } = await installCIHooks(tmpDir);

		expect(errors).toHaveLength(0);
		expect(installed).toContain("pre-commit");
		expect(installed).toContain("pre-push");
		expect(installed).toContain("commit-msg");

		expect(await fileExists(tmpDir, ".git", "hooks", "pre-commit")).toBe(true);
		expect(await fileExists(tmpDir, ".git", "hooks", "pre-push")).toBe(true);
		expect(await fileExists(tmpDir, ".git", "hooks", "commit-msg")).toBe(true);
	});

	it("hooks are executable (755)", async () => {
		await installCIHooks(tmpDir);

		for (const hook of ["pre-commit", "pre-push", "commit-msg"]) {
			const mode = await getFileMode(tmpDir, ".git", "hooks", hook);
			expect(mode & 0o111).toBeGreaterThan(0);
		}
	});

	it("hooks have shebang", async () => {
		await installCIHooks(tmpDir);

		for (const hook of ["pre-commit", "pre-push", "commit-msg"]) {
			const content = await readGenerated(tmpDir, ".git", "hooks", hook);
			expect(content.startsWith("#!/bin/bash")).toBe(true);
		}
	});

	it("pre-commit execs the dispatcher with npx fallback (S1b shim)", async () => {
		await installCIHooks(tmpDir);

		const content = await readGenerated(tmpDir, ".git", "hooks", "pre-commit");
		expect(content).toContain("command -v javi-forge");
		expect(content).toContain("javi-forge hooks run pre-commit");
		expect(content).toContain("npx javi-forge hooks run pre-commit");
		expect(content).not.toContain("ci --quick");
	});

	it("pre-push execs the dispatcher with npx fallback (S1b shim)", async () => {
		await installCIHooks(tmpDir);

		const content = await readGenerated(tmpDir, ".git", "hooks", "pre-push");
		expect(content).toContain("command -v javi-forge");
		expect(content).toContain("javi-forge hooks run pre-push");
		expect(content).toContain("npx javi-forge hooks run pre-push");
		expect(content).not.toContain("ci --quick");
	});

	it("commit-msg blocks AI attribution patterns", async () => {
		await installCIHooks(tmpDir);

		const content = await readGenerated(tmpDir, ".git", "hooks", "commit-msg");
		expect(content).toContain("co-authored-by");
		expect(content).toContain("claude");
		expect(content).toContain("AI Attribution Detected");
		expect(content).toContain("COMMIT_MSG_FILE");
	});

	// REPLACES the pre-change "overwrites existing hooks" case. That assertion
	// encoded the clobber behavior the `ci-hook-install` spec deletes outright
	// ("No-clobber policy for foreign and edited hooks" → "Foreign hook is
	// preserved": the file is unchanged and a reason is reported). It is not a
	// weakened assertion — it is the inverted contract, asserted end to end.
	it("preserves a foreign existing hook instead of overwriting it", async () => {
		const hooksDir = path.join(tmpDir, ".git", "hooks");
		await fs.ensureDir(hooksDir);
		await fs.writeFile(
			path.join(hooksDir, "pre-commit"),
			"#!/bin/bash\necho old",
		);

		const { installed, errors } = await installCIHooks(tmpDir);
		expect(installed).not.toContain("pre-commit");
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("is not a javi-forge hook");

		const content = await readGenerated(tmpDir, ".git", "hooks", "pre-commit");
		expect(content).toContain("echo old");
	});

	it("fails on non-git directory", async () => {
		const nonGit = await createTempDir("non-git-");

		const { installed, errors } = await installCIHooks(nonGit);
		expect(installed).toHaveLength(0);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain("Not a git repository");

		await cleanupTempDir(nonGit);
	});

	it("idempotent — second run produces same result", async () => {
		await installCIHooks(tmpDir);
		const first = await readGenerated(tmpDir, ".git", "hooks", "pre-commit");

		await installCIHooks(tmpDir);
		const second = await readGenerated(tmpDir, ".git", "hooks", "pre-commit");

		expect(first).toBe(second);
	});
});
