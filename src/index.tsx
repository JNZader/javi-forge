#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { render } from "ink";
import meow from "meow";
import React from "react";
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
import { handleTdd } from "./cli/dispatch/tdd.js";
import { handleWorkflow } from "./cli/dispatch/workflow.js";
import { FLAGS_SCHEMA, HELP_TEXT } from "./cli/help.js";
import {
	createInkStdin,
	detectCI,
	setupUpdateNotifier,
} from "./cli/runtime.js";
import AutoSkills from "./ui/AutoSkills.js";
import { CIProvider as CIContextProvider } from "./ui/CIContext.js";
import Skills from "./ui/Skills.js";

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
		const skillsAction = cli.input[1] as string | undefined;
		const VALID_SKILLS_ACTIONS = [
			"doctor",
			"budget",
			"score",
			"benchmark",
			"auto",
			"auto-install",
		];
		if (!skillsAction || !VALID_SKILLS_ACTIONS.includes(skillsAction)) {
			console.error(
				"Usage: javi-forge skills <doctor|budget|score|benchmark|auto>",
			);
			console.error(
				"  doctor        Show skills health report (add --deep for conflict detection)",
			);
			console.error(
				"  budget        Show token cost of loaded skills (add -b N for custom budget)",
			);
			console.error(
				"  score         Score a skill on quality dimensions (0-100)",
			);
			console.error(
				"  benchmark     Benchmark a skill with structural quality checks",
			);
			console.error(
				"  auto          Auto-detect project stack and suggest/install matching AI skills",
			);
			console.error("  auto-install  Alias for auto");
			process.exit(1);
			break;
		}

		// Auto / auto-install: render interactive Ink UI
		if (skillsAction === "auto" || skillsAction === "auto-install") {
			render(
				<CIContextProvider isCI={isCI}>
					<AutoSkills
						projectDir={process.cwd()}
						skillsDir={cli.flags.skillsDir || undefined}
						dryRun={cli.flags.dryRun}
					/>
				</CIContextProvider>,
				{ stdin: inkStdin },
			);
			break;
		}

		// Score and benchmark are non-interactive CLI commands
		if (skillsAction === "score" || skillsAction === "benchmark") {
			const targetSkill = cli.input[2];
			if (!targetSkill) {
				console.error(`Usage: javi-forge skills ${skillsAction} <skill-name>`);
				process.exit(1);
				break;
			}

			const skillsDir =
				cli.flags.skillsDir ||
				path.join(process.env.HOME ?? "~", ".claude", "skills");
			const skillPath = path.join(skillsDir, targetSkill, "SKILL.md");

			if (skillsAction === "score") {
				const { scoreSkill } = await import("./commands/skills.js");
				const result = await scoreSkill(skillPath, cli.flags.budget);
				if (!result) {
					console.error(`\u2717 Skill not found: ${skillPath}`);
					process.exit(1);
					break;
				}
				console.log(`\nSkill: ${result.skillName}`);
				console.log(`  Completeness:      ${result.completeness}/100`);
				console.log(`  Clarity:           ${result.clarity}/100`);
				console.log(`  Testability:       ${result.testability}/100`);
				console.log(`  Token Efficiency:  ${result.tokenEfficiency}/100`);
				console.log(`  Safety:            ${result.safety}/100`);
				console.log(`  Agent Readiness:   ${result.agentReadiness}/100`);
				console.log(`  ─────────────────────────`);
				console.log(`  Overall:           ${result.overall}/100`);
				console.log(`  Grade:             ${result.grade}`);
				console.log(`  Threshold:         ${result.threshold}`);
				console.log(
					`  Status:            ${result.passing ? "\u2713 PASSING" : "\u2717 FAILING"}`,
				);
				process.exit(result.passing ? 0 : 1);
			} else {
				const { benchmarkSkill } = await import("./commands/skills.js");
				const result = await benchmarkSkill(skillPath);
				if (!result) {
					console.error(`\u2717 Skill not found: ${skillPath}`);
					process.exit(1);
					break;
				}
				console.log(`\nBenchmark: ${result.skillName}`);
				for (const check of result.checks) {
					const icon = check.passed ? "\u2713" : "\u2717";
					console.log(
						`  ${icon} ${check.name}${check.detail ? ` — ${check.detail}` : ""}`,
					);
				}
				console.log(`\n  Pass rate: ${result.passRate}%`);
				process.exit(result.passRate >= 50 ? 0 : 1);
			}
			break;
		}

		const skillsMode = skillsAction as "doctor" | "budget";
		render(
			<CIContextProvider isCI={isCI}>
				<Skills
					mode={skillsMode}
					budget={cli.flags.budget}
					deep={cli.flags.deep}
					skillsDir={cli.flags.skillsDir || undefined}
				/>
			</CIContextProvider>,
			{ stdin: inkStdin },
		);
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
