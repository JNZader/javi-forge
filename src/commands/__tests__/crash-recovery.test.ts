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

// ── recoverFromGit (integration) ──

describe("recoverFromGit", () => {
	it("recovers from current project git history", async () => {
		const report = await recoverFromGit(".", { maxCommits: 5 });
		expect(report.branch).toBeTruthy();
		expect(report.totalCommits).toBeGreaterThan(0);
		expect(report.tasks.length).toBeGreaterThan(0);
		expect(report.tasks[0]!.commitHash).toHaveLength(7);
	});

	it("populates phases from conventional commits", async () => {
		const report = await recoverFromGit(".", { maxCommits: 20 });
		expect(Object.keys(report.phases).length).toBeGreaterThan(0);
	});
});

// ── formatRecovery ──

describe("formatRecovery", () => {
	it("formats report with commits", async () => {
		const report = await recoverFromGit(".", { maxCommits: 3 });
		const text = formatRecovery(report);
		expect(text).toContain("Crash Recovery Report");
		expect(text).toContain("**Branch**:");
		expect(text).toContain("**Commits**:");
	});
});
