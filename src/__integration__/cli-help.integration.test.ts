import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

/**
 * Contract coverage for the two DISTINCT help surfaces created by JF-DOCS-1.
 *
 * The entrypoint disables meow's `autoHelp` and routes `--help` through a manual
 * guard (src/index.tsx) so that `ci --help` can show ci-specific usage while the
 * global `--help` still prints the whole-CLI banner. index.tsx is top-level
 * `await` + `process.exit`, which does not unit-test cleanly, so this drives the
 * real binary through tsx in a subprocess and asserts on exit code + output.
 */

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
const entry = path.join(repoRoot, "src", "index.tsx");

async function runCli(
	args: string[],
): Promise<{ stdout: string; exitCode: number }> {
	try {
		const { stdout } = await execFileAsync(tsxBin, [entry, ...args], {
			cwd: repoRoot,
			// Keep the child lean and deterministic: no background update-notifier
			// subprocess and no interactive assumptions.
			env: { ...process.env, CI: "1", NO_UPDATE_NOTIFIER: "1" },
		});
		return { stdout, exitCode: 0 };
	} catch (e) {
		const err = e as { stdout?: string; code?: number };
		return { stdout: err.stdout ?? "", exitCode: err.code ?? 1 };
	}
}

// Global banner markers unique to HELP_TEXT (not present in CI_HELP_TEXT).
const GLOBAL_MARKER = "Bootstrap a new project";
// Usage line unique to CI_HELP_TEXT.
const CI_MARKER = "javi-forge ci [subcommand]";

describe("cli help surfaces (JF-DOCS-1)", () => {
	it("`--help` prints the global banner and exits 0", async () => {
		const { stdout, exitCode } = await runCli(["--help"]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain(GLOBAL_MARKER);
		// The global banner is NOT the ci-scoped usage.
		expect(stdout).not.toContain(CI_MARKER);
	}, 30000);

	it("`-h` short flag also prints the global banner and exits 0", async () => {
		const { stdout, exitCode } = await runCli(["-h"]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain(GLOBAL_MARKER);
	}, 30000);

	it("`ci --help` prints ci-specific usage (distinct from global) and exits 0", async () => {
		const { stdout, exitCode } = await runCli(["ci", "--help"]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain(CI_MARKER);
		expect(stdout).toContain("validate");
		// The ci help is NOT the global banner.
		expect(stdout).not.toContain(GLOBAL_MARKER);
	}, 30000);
});
