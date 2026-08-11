/**
 * `javi-forge tdd <init|pipeline>` handler.
 *
 * Console-only (no Ink, no React, no CIContextProvider).
 *
 * hook-consolidation S3: the handlers no longer WRITE `.git/hooks` themselves.
 * They flip the `hooks.*.tdd` flag in `.javi-forge/ci.yaml` and delegate the
 * hook install to the hardened `installCIHooks` — the single writer of
 * `.git/hooks`. Heavy modules are lazy-imported INSIDE the function to preserve
 * cold-start performance.
 */

import type { InstallHooksResult } from "../../commands/ci.js";
import type { CLI } from "./types.js";

/** Surface an installCIHooks result to the console (notes → backups → installed
 * → upgraded → errors), matching the `ci init` output contract. */
function reportInstall(result: InstallHooksResult): void {
	for (const note of result.notes) {
		console.log(`ℹ ${note}`);
	}
	for (const backup of result.backups) {
		console.log(`⚠ Backed up the previous hook → ${backup}`);
	}
	if (result.installed.length > 0) {
		console.log(`✓ Installed git hooks: ${result.installed.join(", ")}`);
	}
	for (const hook of result.upgraded) {
		const was = result.states.find((entry) => entry.name === hook)?.state;
		console.log(
			`↑ Upgraded ${hook}${was === undefined ? "" : ` (was ${was})`}`,
		);
	}
	for (const err of result.errors) {
		console.error(`✗ ${err}`);
	}
}

export async function handleTdd(cli: CLI): Promise<void> {
	const sub = cli.input[1];
	const force = cli.flags.force === true;

	if (sub === "init") {
		const { setHookFeature } = await import("../../lib/ci-config.js");
		const { installCIHooks } = await import("../../commands/ci.js");

		const configPath = await setHookFeature(
			process.cwd(),
			"pre-commit",
			"tdd",
			true,
		);
		console.log(`✓ Enabled TDD in ${configPath} (hooks.pre-commit.tdd: true)`);
		console.log(
			"  The pre-commit hook now runs the stack test command via the dispatcher.",
		);

		const result = await installCIHooks(process.cwd(), { force });
		reportInstall(result);
		process.exit(result.errors.length > 0 ? 1 : 0);
	} else if (sub === "pipeline") {
		const mode = cli.flags.mode === "warn" ? "warn" : "strict";
		const { setHookFeature } = await import("../../lib/ci-config.js");
		const { installCIHooks } = await import("../../commands/ci.js");

		const configPath = await setHookFeature(
			process.cwd(),
			"pre-push",
			"tdd",
			mode,
		);
		console.log(
			`✓ Enabled TDD pipeline in ${configPath} (hooks.pre-push.tdd: ${mode})`,
		);
		console.log(
			mode === "warn"
				? "  The pre-push hook runs tests as an ADVISORY section (never blocks)."
				: "  The pre-push hook BLOCKS the push when tests fail.",
		);

		const result = await installCIHooks(process.cwd(), { force });
		reportInstall(result);
		process.exit(result.errors.length > 0 ? 1 : 0);
	} else {
		console.error("Usage: javi-forge tdd <command>");
		console.error(
			"  init      Enable the TDD pre-commit section and install the managed hooks",
		);
		console.error(
			"  pipeline  Enable the TDD pre-push section (--mode strict|warn)",
		);
		process.exit(1);
	}
}
