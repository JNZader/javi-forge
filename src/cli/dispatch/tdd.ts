/**
 * `javi-forge tdd <init|pipeline>` handler.
 *
 * Console-only (no Ink, no React, no CIContextProvider).
 * Lazy-loads ./commands/tdd.js or ./commands/tdd-pipeline.js INSIDE the function
 * to preserve cold-start performance — heavy command modules MUST NOT be
 * eager-imported at the top of this file.
 */

import type { Result } from "meow";
import type { FLAGS_SCHEMA } from "../help.js";

type CLI = Result<typeof FLAGS_SCHEMA>;

export async function handleTdd(cli: CLI): Promise<void> {
	if (cli.input[1] === "init") {
		const { installTddHooks } = await import("../../commands/tdd.js");
		const { installed, errors } = await installTddHooks(process.cwd());
		if (installed.length > 0) {
			console.log(`\u2713 Installed TDD hooks: ${installed.join(", ")}`);
			console.log("  Pre-commit hook enforces tests must pass before commit");
		}
		for (const err of errors) {
			console.error(`\u2717 ${err}`);
		}
		process.exit(errors.length > 0 ? 1 : 0);
	} else if (cli.input[1] === "pipeline") {
		const { installTddPipelineHook } = await import(
			"../../commands/tdd-pipeline.js"
		);
		const mode =
			cli.flags.mode === "warn" ? ("warn" as const) : ("strict" as const);
		const result = await installTddPipelineHook(process.cwd(), mode);
		if (result.installed.length > 0) {
			console.log(
				`\u2713 Installed TDD pipeline hook: ${result.installed.join(", ")} [${result.mode}]`,
			);
			console.log(
				`  Pre-push hook enforces TDD pipeline (${result.mode} mode)`,
			);
		}
		for (const skip of result.skipped) {
			console.log(`\u26A0 ${skip}`);
		}
		for (const err of result.errors) {
			console.error(`\u2717 ${err}`);
		}
		process.exit(result.errors.length > 0 ? 1 : 0);
	} else {
		console.error("Usage: javi-forge tdd <command>");
		console.error("  init      Install TDD-enforcing pre-commit hook");
		console.error(
			"  pipeline  Install TDD pipeline pre-push hook (--mode strict|warn)",
		);
		process.exit(1);
	}
}
