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
 */
describe("commit-msg hook corpus", () => {
	it("passes the shipped regression suite", () => {
		const script = path.join(HOOK_ASSETS_DIR, "commit-msg.test.sh");

		expect(() =>
			execFileSync("bash", [script], { stdio: "pipe" }),
		).not.toThrow();
	});
});
