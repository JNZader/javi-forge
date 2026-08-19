/**
 * `javi-forge hooks` handler — console-only (no Ink; a git hook runs in a
 * terminal git owns). Mirrors the `ci init` branch: the command module
 * (`./commands/hooks.js`) is lazy-imported inside the handler to keep cold-start
 * minimal, because hooks are on the commit/push hot path.
 *
 * Subcommands:
 *   - `hooks run <pre-commit|pre-push>` → runHook, exits with its code.
 *   - `hooks <install|doctor|repair> <claude|codex> [--force]` → the matching
 *     agent command, exits with its code (unknown/missing agent → usage + exit 1).
 * Any other subcommand or a missing name → usage + exit 1.
 *
 * The valid agent target set is decided by `isAgentId` (backed by the
 * `AGENT_ADAPTERS` registry — the single source of agent truth). Each id maps to
 * a lazy loader for its console command runner; the map is typed
 * `Record<AgentId, …>`, so a new registry agent cannot be silently dropped
 * (omitting its loader is a compile error). Lazy imports keep cold-start minimal
 * on the commit/push hot path.
 */

import { type AgentId, isAgentId } from "../../lib/agent-adapter.js";
import { HOOKS_HELP_TEXT } from "../help.js";
import type { CLI } from "./types.js";

type HookCommandRunner = (
	sub: "install" | "doctor" | "repair",
	cwd: string,
	opts: { force?: boolean },
) => Promise<number>;

/** Agent registry: id → lazy loader for its console command runner. */
const AGENT_COMMAND_LOADERS: Record<AgentId, () => Promise<HookCommandRunner>> =
	{
		claude: async () =>
			(await import("../../commands/claude-hooks.js")).runClaudeHookCommand,
		codex: async () =>
			(await import("../../commands/codex-hooks.js")).runCodexHookCommand,
	};

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
		const agent = cli.input[2];
		// Validity is decided by the agent registry (isAgentId), the single source
		// of truth; the loader map is exhaustive over AgentId by type.
		if (!isAgentId(agent)) {
			console.error(`Usage: javi-forge hooks ${sub} <claude|codex>`);
			process.exit(1);
		}
		const run = await AGENT_COMMAND_LOADERS[agent]();
		process.exit(
			await run(sub, process.cwd(), { force: cli.flags.force === true }),
		);
	}

	// No subcommand → show usage (exit 0). An unknown subcommand is a typo →
	// show usage but exit 1 rather than run nothing silently.
	console.log(HOOKS_HELP_TEXT);
	process.exit(cli.input[1] === undefined ? 0 : 1);
}
