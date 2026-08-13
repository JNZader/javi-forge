import { describe, expect, it } from "vitest";
import {
	extractTaskId,
	formatRecovery,
	parseCommitPhase,
	parseGitLog,
	recoverFromGit,
} from "../crash-recovery.js";

// ── parseCommitPhase ──

describe("parseCommitPhase", () => {
	it("extracts feat", () => {
		expect(parseCommitPhase("feat: add login")).toBe("feat");
	});

	it("extracts fix with scope", () => {
		expect(parseCommitPhase("fix(auth): token expiry")).toBe("fix");
	});

	it("extracts test", () => {
		expect(parseCommitPhase("test: add unit tests")).toBe("test");
	});

	it("returns null for non-conventional", () => {
		expect(parseCommitPhase("random commit message")).toBeNull();
	});
});

// ── extractTaskId ──

describe("extractTaskId", () => {
	it("extracts #35 format", () => {
		expect(extractTaskId("feat: add feature (#35)")).toBe("35");
	});

	it("extracts task-1.2 format", () => {
		expect(extractTaskId("implement task-1.2")).toBe("1.2");
	});

	it("returns null when no task id", () => {
		expect(extractTaskId("just a commit")).toBeNull();
	});
});

// ── parseGitLog ──

describe("parseGitLog", () => {
	const SAMPLE_LOG = [
		"abc1234|feat: add login (#1)|2026-04-10T00:00:00Z",
		"src/auth.ts",
		"src/auth.test.ts",
		"",
		"def5678|fix(db): connection pool|2026-04-09T23:00:00Z",
		"src/db.ts",
	].join("\n");

	it("parses commits from git log", () => {
		const tasks = parseGitLog(SAMPLE_LOG);
		expect(tasks).toHaveLength(2);
	});

	it("extracts commit hash", () => {
		const tasks = parseGitLog(SAMPLE_LOG);
		expect(tasks[0]!.commitHash).toBe("abc1234");
	});

	it("extracts message", () => {
		const tasks = parseGitLog(SAMPLE_LOG);
		expect(tasks[0]!.message).toBe("feat: add login (#1)");
	});

	it("extracts files changed", () => {
		const tasks = parseGitLog(SAMPLE_LOG);
		expect(tasks[0]!.filesChanged).toContain("src/auth.ts");
		expect(tasks[0]!.filesChanged).toContain("src/auth.test.ts");
	});

	it("extracts phase from conventional commit", () => {
		const tasks = parseGitLog(SAMPLE_LOG);
		expect(tasks[0]!.phase).toBe("feat");
		expect(tasks[1]!.phase).toBe("fix");
	});

	it("extracts task id", () => {
		const tasks = parseGitLog(SAMPLE_LOG);
		expect(tasks[0]!.taskId).toBe("1");
	});

	it("handles empty input", () => {
		expect(parseGitLog("")).toHaveLength(0);
		expect(parseGitLog("  \n  ")).toHaveLength(0);
	});
});

// ── recoverFromGit (integration — hermetic git fixture) ──
// These tests MUST NOT read the host repo's history: in GitHub Actions the
// checkout is a shallow clone (fetch-depth: 1) in detached HEAD, so
// `git branch --show-current` returns "" and the only visible commit is the
// synthetic merge commit (not conventional). They never ran in CI between
// their creation (2026-05-18) and the CI workflow re-enable (2026-08-13).
// Build a throwaway repo with conventional commits instead.

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";

const execFileAsyncLocal = promisify(execFile);

let gitRepoDir: string;

beforeEach(async () => {
	gitRepoDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "javi-forge-crash-rec-"),
	);
	const git = (args: string[]) =>
		execFileAsyncLocal("git", args, { cwd: gitRepoDir });
	await git(["init", "-b", "main"]);
	await git(["config", "user.email", "test@example.com"]);
	await git(["config", "user.name", "Test User"]);
	await fs.writeFile(path.join(gitRepoDir, "auth.ts"), "export {};\n");
	await git(["add", "auth.ts"]);
	await git(["commit", "-m", "feat: add login (#1)"]);
	await fs.writeFile(path.join(gitRepoDir, "db.ts"), "export {};\n");
	await git(["add", "db.ts"]);
	await git(["commit", "-m", "fix(db): connection pool"]);
	await fs.writeFile(path.join(gitRepoDir, "auth.test.ts"), "export {};\n");
	await git(["add", "auth.test.ts"]);
	await git(["commit", "-m", "test: add auth tests"]);
});

afterEach(async () => {
	await fs.remove(gitRepoDir);
});

describe("recoverFromGit", () => {
	it("recovers from a git repository's history", async () => {
		const report = await recoverFromGit(gitRepoDir, { maxCommits: 5 });
		expect(report.branch).toBe("main");
		expect(report.totalCommits).toBe(3);
		expect(report.tasks.length).toBe(3);
		expect(report.tasks[0]!.commitHash).toHaveLength(7);
	});

	it("populates phases from conventional commits", async () => {
		const report = await recoverFromGit(gitRepoDir, { maxCommits: 20 });
		expect(Object.keys(report.phases).length).toBeGreaterThan(0);
		expect(report.phases).toEqual({ feat: 1, fix: 1, test: 1 });
	});
});

// ── formatRecovery ──

describe("formatRecovery", () => {
	it("formats report with commits", async () => {
		const report = await recoverFromGit(gitRepoDir, { maxCommits: 3 });
		const text = formatRecovery(report);
		expect(text).toContain("Crash Recovery Report");
		expect(text).toContain("**Branch**:");
		expect(text).toContain("**Commits**:");
		expect(text).toContain("[feat]");
	});
});
