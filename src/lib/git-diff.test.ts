import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock exec helper (unit layer) ────────────────────────────────────────────
// The env-var precedence cases need NO git; the local merge-base fallback and
// changedFiles cases mock execFileAsync so the unit tests stay pure.
// The real-git integration test lives in
// src/__integration__/git-diff.integration.test.ts (unmocked exec).
vi.mock("./exec.js", () => ({
	execFileAsync: vi.fn(),
}));

import { execFileAsync } from "./exec.js";
import { changedFiles, resolveBaseRef } from "./git-diff.js";

const mockedExec = vi.mocked(execFileAsync);

const ALL_ZEROS = "0".repeat(40);

/** Build a resolved execFileAsync result (stdout/stderr shape). */
function ok(stdout: string): { stdout: string; stderr: string } {
	return { stdout, stderr: "" };
}

beforeEach(() => {
	vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveBaseRef — pure env-precedence table (NO git for the env-var rows)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveBaseRef — env precedence (no git)", () => {
	it("returns the GitLab MR base sha when set (highest precedence)", async () => {
		const base = await resolveBaseRef(
			{
				CI_MERGE_REQUEST_DIFF_BASE_SHA: "mrsha123",
				CI_COMMIT_BEFORE_SHA: "pushsha456",
				GITHUB_BASE_REF: "main",
			},
			"/repo",
		);

		expect(base).toBe("mrsha123");
		// No git call was needed to resolve an env-provided base.
		expect(mockedExec).not.toHaveBeenCalled();
	});

	it("falls through the empty MR sha to the GitLab push before-sha", async () => {
		const base = await resolveBaseRef(
			{
				CI_MERGE_REQUEST_DIFF_BASE_SHA: "",
				CI_COMMIT_BEFORE_SHA: "pushsha456",
			},
			"/repo",
		);

		expect(base).toBe("pushsha456");
		expect(mockedExec).not.toHaveBeenCalled();
	});

	it("rejects the all-zeros new-branch sentinel push sha and keeps searching", async () => {
		// all-zeros before-sha means a brand-new branch — NOT a usable base.
		// With no GitHub env and a mocked local fallback that resolves origin/main,
		// resolution must skip the sentinel and land on the local merge-base.
		mockedExec.mockResolvedValueOnce(ok("localbase789\n"));

		const base = await resolveBaseRef(
			{ CI_COMMIT_BEFORE_SHA: ALL_ZEROS },
			"/repo",
		);

		expect(base).toBe("localbase789");
		// The sentinel was NOT returned as the base.
		expect(base).not.toBe(ALL_ZEROS);
	});

	it("uses $GITHUB_EVENT_BEFORE (the real push base) before $GITHUB_SHA", async () => {
		// On a GitHub push, github.event.before is the commit the branch pointed at
		// BEFORE the push — the correct diff base. GITHUB_SHA equals HEAD after
		// actions/checkout, so using it would produce an empty diff. When the
		// workflow exposes github.event.before as GITHUB_EVENT_BEFORE it MUST win.
		const base = await resolveBaseRef(
			{ GITHUB_EVENT_BEFORE: "pushbefore123", GITHUB_SHA: "ghpushsha" },
			"/repo",
		);

		expect(base).toBe("pushbefore123");
		// No merge-base needed — the before-sha is used directly.
		expect(mockedExec).not.toHaveBeenCalled();
	});

	it("skips the all-zeros $GITHUB_EVENT_BEFORE sentinel and falls to $GITHUB_SHA", async () => {
		// A brand-new branch push reports an all-zeros github.event.before — not a
		// usable base — so resolution falls through to GITHUB_SHA.
		const base = await resolveBaseRef(
			{ GITHUB_EVENT_BEFORE: ALL_ZEROS, GITHUB_SHA: "ghpushsha" },
			"/repo",
		);

		expect(base).toBe("ghpushsha");
		expect(mockedExec).not.toHaveBeenCalled();
	});

	it("falls back to $GITHUB_SHA on a GitHub push (no base ref, no before-sha)", async () => {
		// A push event sets no GITHUB_BASE_REF; with no github.event.before wired,
		// GITHUB_SHA is used directly as the base per the design precedence chain.
		const base = await resolveBaseRef({ GITHUB_SHA: "ghpushsha" }, "/repo");

		expect(base).toBe("ghpushsha");
		// No merge-base needed — the push sha is used directly.
		expect(mockedExec).not.toHaveBeenCalled();
	});

	it("uses the GitHub base ref (merge-base against it) on a GitHub PR", async () => {
		mockedExec.mockResolvedValueOnce(ok("ghmergebase\n"));

		const base = await resolveBaseRef({ GITHUB_BASE_REF: "main" }, "/repo");

		expect(base).toBe("ghmergebase");
		// merge-base was computed against the GitHub base ref.
		const [cmd, args] = mockedExec.mock.calls[0];
		expect(cmd).toBe("git");
		expect(args).toEqual(["merge-base", "origin/main", "HEAD"]);
	});
});

describe("resolveBaseRef — local merge-base fallback (mocked git)", () => {
	it("tries origin/main first and returns its merge-base", async () => {
		mockedExec.mockResolvedValueOnce(ok("baseFromOriginMain\n"));

		const base = await resolveBaseRef({}, "/repo");

		expect(base).toBe("baseFromOriginMain");
		const [cmd, args, opts] = mockedExec.mock.calls[0];
		expect(cmd).toBe("git");
		expect(args).toEqual(["merge-base", "origin/main", "HEAD"]);
		expect(opts).toMatchObject({ cwd: "/repo" });
	});

	it("falls through candidates in order until one resolves", async () => {
		// origin/main, origin/master, main all fail; master resolves.
		mockedExec
			.mockRejectedValueOnce(new Error("no origin/main"))
			.mockRejectedValueOnce(new Error("no origin/master"))
			.mockRejectedValueOnce(new Error("no main"))
			.mockResolvedValueOnce(ok("baseFromMaster\n"));

		const base = await resolveBaseRef({}, "/repo");

		expect(base).toBe("baseFromMaster");
		expect(mockedExec.mock.calls.map((c) => c[1])).toEqual([
			["merge-base", "origin/main", "HEAD"],
			["merge-base", "origin/master", "HEAD"],
			["merge-base", "main", "HEAD"],
			["merge-base", "master", "HEAD"],
		]);
	});

	it("returns null when nothing resolves", async () => {
		mockedExec.mockRejectedValue(new Error("no such ref"));

		const base = await resolveBaseRef({}, "/repo");

		expect(base).toBeNull();
		// All four local candidates were attempted before giving up.
		expect(mockedExec).toHaveBeenCalledTimes(4);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// changedFiles — union of three git invocations, ACMR filter (mocked git)
// ─────────────────────────────────────────────────────────────────────────────

describe("changedFiles — union and dedupe (mocked git)", () => {
	it("unions committed (ACMR), unstaged and staged sets and dedupes", async () => {
		// 1: git diff --name-only --diff-filter=ACMR <base>...HEAD
		mockedExec.mockResolvedValueOnce(ok("src/a.ts\nsrc/b.ts\n"));
		// 2: git diff --name-only (unstaged)
		mockedExec.mockResolvedValueOnce(ok("src/b.ts\nsrc/c.ts\n"));
		// 3: git diff --name-only --cached (staged)
		mockedExec.mockResolvedValueOnce(ok("src/d.ts\n"));

		const files = await changedFiles("BASE", "/repo");

		expect([...files].sort()).toEqual([
			"src/a.ts",
			"src/b.ts",
			"src/c.ts",
			"src/d.ts",
		]);
		// b.ts appeared in two sets but is present exactly once.
		expect(files.filter((f) => f === "src/b.ts")).toHaveLength(1);
	});

	it("issues the three git invocations with the ACMR three-dot committed diff", async () => {
		mockedExec.mockResolvedValue(ok(""));

		await changedFiles("BASE", "/repo");

		const argvs = mockedExec.mock.calls.map((c) => c[1]);
		expect(argvs).toEqual([
			["diff", "--name-only", "--diff-filter=ACMR", "BASE...HEAD"],
			["diff", "--name-only"],
			["diff", "--name-only", "--cached"],
		]);
		// argv array, cwd threaded through — never a shell string.
		for (const call of mockedExec.mock.calls) {
			expect(call[0]).toBe("git");
			expect(call[2]).toMatchObject({ cwd: "/repo" });
		}
	});

	it("returns an empty set when all three diffs are empty", async () => {
		// Empty because every real git diff produced no paths — not a swallowed error.
		mockedExec.mockResolvedValue(ok("\n"));

		const files = await changedFiles("BASE", "/repo");

		expect(files).toEqual([]);
	});
});

describe("changedFiles — shallow-clone / bad-object loud failure", () => {
	it("propagates the git failure (does NOT swallow to an empty set)", async () => {
		// A base sha absent from local history makes `git diff <base>...HEAD` fail
		// with "bad object" under a CI shallow clone. The failure MUST surface so
		// the caller (slice 4) can skip-with-warning — never look like "no changes".
		mockedExec.mockRejectedValueOnce(
			new Error("fatal: bad object BASE...HEAD"),
		);

		await expect(changedFiles("BASE", "/repo")).rejects.toThrow(/bad object/);
	});
});
