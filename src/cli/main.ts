import { createRequire } from "node:module";
import meow from "meow";
import { handleAi } from "./dispatch/ai.js";
import { handleCi } from "./dispatch/ci.js";
import { handleHooks } from "./dispatch/hooks.js";
import { handlePi } from "./dispatch/pi.js";
import { handleSecurity } from "./dispatch/security.js";
import {
	handleAnalyze,
	handleDoctor,
	handleInitDefault,
	handleLlmsTxt,
	handlePlugin,
} from "./dispatch/simple-renderers.js";
import { handleSkillPublish } from "./dispatch/skill-publish.js";
import { handleSkillsCmd } from "./dispatch/skills-cmd.js";
import { handleTdd } from "./dispatch/tdd.js";
import { handleWorkflow } from "./dispatch/workflow.js";
import { FLAGS_SCHEMA, HELP_TEXT } from "./help.js";
import { createInkStdin, detectCI, setupUpdateNotifier } from "./runtime.js";

const KNOWN_COMMANDS = new Set([
	"init",
	"tdd",
	"ci",
	"hooks",
	"doctor",
	"analyze",
	"workflow",
	"llms-txt",
	"ai",
	"plugin",
	"pi",
	"skills",
	"skill",
	"security",
]);

export async function runCli(): Promise<void> {
	const cli = meow(HELP_TEXT, {
		importMeta: import.meta,
		flags: FLAGS_SCHEMA,
		// Handle --help manually so `ci --help` can show ci-specific usage instead
		// of the global banner (meow's autoHelp would print + exit before dispatch).
		autoHelp: false,
	});

	const subcommand = cli.input[0] ?? "init";
	if (!KNOWN_COMMANDS.has(subcommand)) {
		console.error(
			`Unknown command "${subcommand}". Run javi-forge --help for usage.`,
		);
		process.exit(1);
	}

	// Global --help: every command except `ci` and `hooks` shows the global banner
	// here. Those two own their per-command help inside their handlers.
	if (cli.flags.help && subcommand !== "ci" && subcommand !== "hooks") {
		console.log(HELP_TEXT);
		process.exit(0);
	}

	// Check for updates in background (non-blocking, cached 24h). Diagnostics and
	// dry-runs must not create notifier cache/state before doing their actual work.
	if (subcommand !== "doctor" && !cli.flags.dryRun) {
		const _require = createRequire(import.meta.url);
		const pkg = _require("../../package.json") as {
			name: string;
			version: string;
		};
		setupUpdateNotifier(pkg);
	}

	const isCI = detectCI(cli.flags);
	const inkStdin = createInkStdin();

	switch (subcommand) {
		case "tdd": {
			await handleTdd(cli);
			break;
		}

		case "ci": {
			await handleCi(cli, { inkStdin, isCI });
			break;
		}

		case "hooks": {
			await handleHooks(cli);
			break;
		}

		case "doctor": {
			handleDoctor(cli, { inkStdin, isCI });
			break;
		}

		case "analyze": {
			handleAnalyze(cli, { inkStdin, isCI });
			break;
		}

		case "workflow": {
			await handleWorkflow(cli);
			break;
		}

		case "llms-txt": {
			handleLlmsTxt(cli, { inkStdin, isCI });
			break;
		}

		case "ai": {
			await handleAi(cli);
			break;
		}

		case "plugin": {
			handlePlugin(cli, { inkStdin, isCI });
			break;
		}

		case "pi": {
			await handlePi(cli);
			break;
		}

		case "skills": {
			await handleSkillsCmd(cli, { inkStdin, isCI });
			break;
		}

		case "skill": {
			await handleSkillPublish(cli);
			break;
		}

		case "security": {
			await handleSecurity(cli);
			break;
		}

		case "init": {
			handleInitDefault(cli, { inkStdin, isCI });
			break;
		}
	}
}
