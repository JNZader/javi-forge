/**
 * git-diff.ts exercised against a REAL git repository.
 *
 * This file does NOT mock `../lib/exec.js`, so `changedFiles` shells out to the
 * real `git` binary. The repo is created on a DETERMINISTIC `main` branch
 * (`git init -b main`) so the test exercises the diff path regardless of the
 * host's `init.defaultBranch` setting (JDB-009): an unset/`master` default must
 * not silently divert the test into the loud-degrade path.
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { changedFiles } from "../lib/git-diff.js";
import { cleanupTempDir, createTempDir } from "./helpers.js";

let tmpDir: string;

function git(...args: string[]): void {
	execFileSync("git", args, { cwd: tmpDir, stdio: "pipe" });
}

beforeEach(async () => {
	tmpDir = await createTempDir("javi-forge-gitdiff-");
	// Deterministic branch — NOT init.defaultBranch dependent (JDB-009).
	git("init", "-b", "main");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	git("config", "commit.gpgsign", "false");
	await fs.writeFile(path.join(tmpDir, "kept.ts"), "export const a = 1;\n");
	await fs.writeFile(path.join(tmpDir, "deleted.ts"), "export const d = 1;\n");
	git("add", ".");
	git("commit", "-m", "base commit");
});

afterEach(async () => {
	await cleanupTempDir(tmpDir);
});

describe("changedFiles — real git (deterministic main branch)", () => {
	it("returns added and modified files and drops deletions (--diff-filter=ACMR)", async () => {
		const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: tmpDir,
			encoding: "utf-8",
		}).trim();

		// Added, Modified, and Deleted between base and a second commit.
		await fs.writeFile(path.join(tmpDir, "added.ts"), "export const n = 2;\n");
		await fs.writeFile(path.join(tmpDir, "kept.ts"), "export const a = 99;\n");
		await fs.remove(path.join(tmpDir, "deleted.ts"));
		git("add", "-A");
		git("commit", "-m", "second commit");

		const files = await changedFiles(baseSha, tmpDir);

		expect([...files].sort()).toEqual(["added.ts", "kept.ts"]);
		// ACMR drops the deletion — it must NOT appear in the set.
		expect(files).not.toContain("deleted.ts");
	});

	it("includes an unstaged working-tree edit in the union", async () => {
		const baseSha = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: tmpDir,
			encoding: "utf-8",
		}).trim();

		// No new commit: edit a tracked file in the working tree (unstaged).
		await fs.writeFile(path.join(tmpDir, "kept.ts"), "export const a = 7;\n");

		const files = await changedFiles(baseSha, tmpDir);

		// The unstaged diff surfaces kept.ts even with no committed delta.
		expect(files).toContain("kept.ts");
	});
});
