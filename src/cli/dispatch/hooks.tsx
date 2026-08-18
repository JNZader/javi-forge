/**
 * `javi-forge hooks` handler — console-only (no Ink; a git hook runs in a
 * terminal git owns). Mirrors the `ci init` branch: the command module
 * (`./commands/hooks.js`) is lazy-imported inside the handler to keep cold-start
 * minimal, because hooks are on the commit/push hot path.
 *
 * Subcommands:
 *   - `hooks run <pre-commit|pre-push>` → runHook, exits with its code.
 *   - `hooks <install|doctor|repair> claude [--force]` → runClaudeHookCommand,
 *     exits with its code (wrong/missing target → usage + exit 1).
 * Any other subcommand or a missing name → usage + exit 1.
 */

import { HOOKS_HELP_TEXT } from "../help.js";
import type { CLI } from "./types.js";

export async function handleHooks(cli: CLI): Promise<void> {
	if (cli.flags.help === true) {
		console.log(HOOKS_HELP_TEXT);
		process.exit(0);
	}

	if (cli.input[1] === "run") {
		const name = cli.input[2];
		if (name === undefined) {
			console.error("Usage: javi-forge hooks run <pre-commit|pre-push>");
			process.exit(1);
		}
		const { runHook } = await import("../../commands/hooks.js");
		const code = await runHook(name, process.cwd());
		process.exit(code);
	}

	const sub = cli.input[1];
	if (sub === "install" || sub === "doctor" || sub === "repair") {
		if (cli.input[2] !== "claude") {
			console.error(`Usage: javi-forge hooks ${sub} claude`);
			process.exit(1);
		}
		const { runClaudeHookCommand } = await import(
			"../../commands/claude-hooks.js"
		);
		process.exit(
			await runClaudeHookCommand(sub, process.cwd(), {
				force: cli.flags.force === true,
			}),
		);
	}

	// No subcommand → show usage (exit 0). An unknown subcommand is a typo →
	// show usage but exit 1 rather than run nothing silently.
	console.log(HOOKS_HELP_TEXT);
	process.exit(cli.input[1] === undefined ? 0 : 1);
}
