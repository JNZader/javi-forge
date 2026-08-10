import { execFileAsync } from "./exec.js";

/**
 * Forge-agnostic changed-file diff engine for `scope: changed` gates.
 *
 * Two injectable functions:
 * - {@link resolveBaseRef} — resolve the base commit to diff HEAD against,
 *   following a forge-agnostic precedence chain (GitLab MR / GitLab push /
 *   GitHub PR / local merge-base). Returns `null` when nothing resolves so the
 *   caller can loud-degrade (skip the scope:changed gate with a named warning).
 * - {@link changedFiles} — the union of committed (Added/Copied/Modified/Renamed,
 *   deletions dropped), unstaged, and staged changes. THROWS on a git failure
 *   (e.g. a base sha absent from local history under a CI shallow clone) so the
 *   caller can skip-with-warning; it MUST NOT swallow the failure into an empty
 *   set (that would look like "no changes" and silently pass a scope gate).
 *
 * This module is UNWIRED: nothing in the run path imports it yet. The gate
 * phase consumes it in a later slice.
 */

/** The all-zeros sha git emits for a brand-new branch's "before" ref. */
const NEW_BRANCH_SENTINEL = "0".repeat(40);

/**
 * Local base-ref candidates, tried in order. The first whose `git merge-base
 * <candidate> HEAD` resolves wins.
 */
const LOCAL_BASE_CANDIDATES = [
	"origin/main",
	"origin/master",
	"main",
	"master",
] as const;

function isNonEmpty(value: string | undefined): value is string {
	return typeof value === "string" && value.length > 0;
}

/**
 * Compute `git merge-base <ref> HEAD` in `cwd`, returning the resolved sha or
 * `null` when the ref does not exist / has no common ancestor.
 */
async function tryMergeBase(ref: string, cwd: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["merge-base", ref, "HEAD"], {
			cwd,
		});
		const sha = stdout.trim();
		return sha.length > 0 ? sha : null;
	} catch {
		return null;
	}
}

/**
 * Resolve the base ref to diff HEAD against, forge-agnostic. Precedence:
 * 1. `$CI_MERGE_REQUEST_DIFF_BASE_SHA` (GitLab MR) when non-empty.
 * 2. `$CI_COMMIT_BEFORE_SHA` (GitLab push) when non-empty AND not the
 *    all-zeros new-branch sentinel.
 * 3. `$GITHUB_BASE_REF` (GitHub Actions PR) → `git merge-base origin/<ref> HEAD`;
 *    else on a push, `$GITHUB_EVENT_BEFORE` (github.event.before — the real push
 *    base, unless the all-zeros new-branch sentinel) before falling to
 *    `$GITHUB_SHA` (which equals HEAD after actions/checkout → empty diff).
 * 4. Local fallback: `git merge-base <candidate> HEAD` over
 *    `origin/main`, `origin/master`, `main`, `master` — first that resolves.
 * 5. Nothing resolves → `null` (caller loud-degrades).
 */
export async function resolveBaseRef(
	env: Record<string, string | undefined>,
	cwd: string,
): Promise<string | null> {
	// 1. GitLab merge request — the base sha is provided directly.
	if (isNonEmpty(env.CI_MERGE_REQUEST_DIFF_BASE_SHA)) {
		return env.CI_MERGE_REQUEST_DIFF_BASE_SHA;
	}

	// 2. GitLab push — the previous sha, unless it is the new-branch sentinel.
	if (
		isNonEmpty(env.CI_COMMIT_BEFORE_SHA) &&
		env.CI_COMMIT_BEFORE_SHA !== NEW_BRANCH_SENTINEL
	) {
		return env.CI_COMMIT_BEFORE_SHA;
	}

	// 3. GitHub Actions — a PR sets GITHUB_BASE_REF (merge-base against the
	//    target branch). A push has no base ref: prefer github.event.before
	//    (GITHUB_EVENT_BEFORE — the commit the branch pointed at before the push,
	//    the real diff base), unless it is the all-zeros new-branch sentinel, and
	//    only then fall back to GITHUB_SHA (which equals HEAD after
	//    actions/checkout → an empty diff → scope:changed gates would silently
	//    skip; a visible skip, not a false-green — the before-sha avoids it).
	if (isNonEmpty(env.GITHUB_BASE_REF)) {
		const base = await tryMergeBase(`origin/${env.GITHUB_BASE_REF}`, cwd);
		if (base !== null) return base;
	} else if (
		isNonEmpty(env.GITHUB_EVENT_BEFORE) &&
		env.GITHUB_EVENT_BEFORE !== NEW_BRANCH_SENTINEL
	) {
		return env.GITHUB_EVENT_BEFORE;
	} else if (isNonEmpty(env.GITHUB_SHA)) {
		return env.GITHUB_SHA;
	}

	// 4. Local fallback — first candidate whose merge-base resolves.
	for (const candidate of LOCAL_BASE_CANDIDATES) {
		const base = await tryMergeBase(candidate, cwd);
		if (base !== null) return base;
	}

	// 5. Nothing resolved.
	return null;
}

/**
 * Parse `git diff --name-only` stdout into a list of repo-root-relative paths,
 * dropping blank lines.
 */
function parseNameOnly(stdout: string): string[] {
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * The union (deduped) of files changed relative to `base`:
 * - committed: `git diff --name-only --diff-filter=ACMR <base>...HEAD`
 *   (three-dot; ACMR keeps Added/Copied/Modified/Renamed, drops deletions)
 * - unstaged: `git diff --name-only`
 * - staged:   `git diff --name-only --cached`
 *
 * Invoked as `execFileAsync("git", [...], { cwd })` — an argv array, never a
 * shell string.
 *
 * THROWS if any git invocation fails. A base sha absent from local history
 * (CI shallow clone / bad object) makes the committed diff error; that failure
 * MUST propagate so the caller can skip the scope:changed gate with a named
 * warning. It MUST NOT be swallowed into an empty set — an empty set means
 * "no changed files" and would silently pass a scope:changed gate.
 */
export async function changedFiles(
	base: string,
	cwd: string,
): Promise<string[]> {
	const invocations: string[][] = [
		["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`],
		["diff", "--name-only"],
		["diff", "--name-only", "--cached"],
	];

	const seen = new Set<string>();
	for (const args of invocations) {
		// Deliberately NOT wrapped in try/catch: a git failure here (shallow
		// clone / missing base object) must surface to the caller.
		const { stdout } = await execFileAsync("git", args, { cwd });
		for (const file of parseNameOnly(stdout)) {
			seen.add(file);
		}
	}

	return [...seen];
}
