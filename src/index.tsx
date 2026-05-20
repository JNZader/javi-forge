#!/usr/bin/env node
import { createRequire } from "node:module";
import meow from "meow";
import { handleCi } from "./cli/dispatch/ci.js";
import { handleSecurity } from "./cli/dispatch/security.js";
import {
	handleAnalyze,
	handleDoctor,
	handleInitDefault,
	handleLlmsTxt,
	handlePlugin,
} from "./cli/dispatch/simple-renderers.js";
import { handleSkillPublish } from "./cli/dispatch/skill-publish.js";
import { handleSkillsCmd } from "./cli/dispatch/skills-cmd.js";
import { handleTdd } from "./cli/dispatch/tdd.js";
import { handleWorkflow } from "./cli/dispatch/workflow.js";
import { FLAGS_SCHEMA, HELP_TEXT } from "./cli/help.js";
import {
	createInkStdin,
	detectCI,
	setupUpdateNotifier,
} from "./cli/runtime.js";

// Check for updates in background (non-blocking, cached 24h)
const _require = createRequire(import.meta.url);
const pkg = _require("../package.json") as { name: string; version: string };
setupUpdateNotifier(pkg);

const cli = meow(HELP_TEXT, {
	importMeta: import.meta,
	flags: FLAGS_SCHEMA,
});

const subcommand = cli.input[0] ?? "init";

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

	case "plugin": {
		handlePlugin(cli, { inkStdin, isCI });
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
	default: {
		handleInitDefault(cli, { inkStdin, isCI });
		break;
	}
}
