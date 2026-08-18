import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOOK_ASSETS_DIR } from "../constants.js";

/**
 * Runs the shipped `commit-msg` regression corpus (`assets/hooks/commit-msg.test.sh`)
 * inside the vitest flow. The `.sh` hardcodes `HOOK="$SCRIPT_DIR/commit-msg"`, so as
 * a sibling of the shipped asset it exercises the REAL body — both the attribution
 * guard and the conventional-commit subject guard. A non-zero exit fails this test
 * and surfaces the corpus output.
 *
 * TIMEOUT: the corpus is inherently spawn-heavy — it runs the hook as a separate
 * `bash` process once per case, serially, for ~130 cases. That is ~8s wall clock
 * on an idle machine, but under a fully parallel suite (pool: "forks") it has been
 * observed near 20s against the 30s global `testTimeout` — a margin thin enough to
 * flake. The generous explicit timeout below buys headroom without weakening any
 * assertion; the corpus itself is a shipped asset and is deliberately not restructured.
 */
describe("commit-msg hook corpus", () => {
	it("passes the shipped regression suite", { timeout: 90_000 }, () => {
		const script = path.join(HOOK_ASSETS_DIR, "commit-msg.test.sh");

		expect(() =>
			execFileSync("bash", [script], { stdio: "pipe" }),
		).not.toThrow();
	});
});
