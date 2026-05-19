#!/usr/bin/env node
import { createRequire } from "node:module";
import path from "node:path";
import { render } from "ink";
import meow from "meow";
import React from "react";
import { FLAGS_SCHEMA, HELP_TEXT } from "./cli/help.js";
import {
	createInkStdin,
	detectCI,
	setupUpdateNotifier,
	VALID_CI,
	VALID_MEMORY,
	VALID_STACKS,
} from "./cli/runtime.js";
import type { CIMode } from "./commands/ci.js";
import type { SecurityMode } from "./commands/security.js";
import type { CIProvider, MemoryOption, Stack } from "./types/index.js";
import AnalyzeUI from "./ui/AnalyzeUI.js";
import App from "./ui/App.js";
import AutoSkills from "./ui/AutoSkills.js";
import CI from "./ui/CI.js";
import { CIProvider as CIContextProvider } from "./ui/CIContext.js";
import Doctor from "./ui/Doctor.js";
import LlmsTxt from "./ui/LlmsTxt.js";
import Plugin from "./ui/Plugin.js";
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
		if (cli.input[1] === "init") {
			const { installTddHooks } = await import("./commands/tdd.js");
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
				"./commands/tdd-pipeline.js"
			);
			const mode =
				(cli.flags as Record<string, unknown>).mode === "warn"
					? ("warn" as const)
					: ("strict" as const);
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
		break;
	}

	case "ci": {
		// Sub-command: javi-forge ci init → install git hooks
		if (cli.input[1] === "init") {
			const { installCIHooks } = await import("./commands/ci.js");
			const { installed, errors } = await installCIHooks(process.cwd());
			if (installed.length > 0) {
				console.log(`✓ Installed git hooks: ${installed.join(", ")}`);
				console.log("  Hooks call javi-forge ci (with npx fallback)");
			}
			for (const err of errors) {
				console.error(`✗ ${err}`);
			}
			process.exit(errors.length > 0 ? 1 : 0);
			break;
		}

		const ciMode: CIMode = cli.flags.detect
			? "detect"
			: cli.flags.shell
				? "shell"
				: cli.flags.quick
					? "quick"
					: "full";

		render(
			<CIContextProvider isCI={true}>
				<CI
					projectDir={process.cwd()}
					mode={ciMode}
					noDocker={!cli.flags.docker}
					noGhagga={!cli.flags.ciGhagga}
					noSecurity={!cli.flags.security}
					timeout={cli.flags.timeout}
				/>
			</CIContextProvider>,
			{ stdin: inkStdin },
		);
		break;
	}

	case "doctor": {
		render(
			<CIContextProvider isCI={isCI}>
				<Doctor />
			</CIContextProvider>,
			{ stdin: inkStdin },
		);
		break;
	}

	case "analyze": {
		render(
			<CIContextProvider isCI={isCI}>
				<AnalyzeUI dryRun={cli.flags.dryRun} />
			</CIContextProvider>,
			{ stdin: inkStdin },
		);
		break;
	}

	case "workflow": {
		const workflowAction = cli.input[1] as string | undefined;
		const VALID_WORKFLOW_ACTIONS = ["show", "validate", "list"];
		if (!workflowAction || !VALID_WORKFLOW_ACTIONS.includes(workflowAction)) {
			console.error("Usage: javi-forge workflow <show|validate|list>");
			console.error("  show      Render a workflow graph as ASCII");
			console.error(
				"  validate  Validate project state against a workflow graph",
			);
			console.error(
				"  list      List available workflows and built-in templates",
			);
			console.error("");
			console.error("  Options:");
			console.error(
				"    --template <name>  Use a built-in template (ci-pipeline, release, feature-flow)",
			);
			console.error("    <file>             Path to a .dot or .mermaid file");
			process.exit(1);
			break;
		}

		const { runWorkflowShow, runWorkflowValidate, runWorkflowList } =
			await import("./commands/workflow.js");
		const workflowTarget = cli.input[2];
		const workflowTemplate = cli.flags.template || undefined;
		const onStep = (step: {
			id: string;
			label: string;
			status: string;
			detail?: string;
		}) => {
			const icon =
				step.status === "done"
					? "\u2713"
					: step.status === "error"
						? "\u2717"
						: "\u25CB";
			console.log(`${icon} ${step.label}`);
			if (step.detail) console.log(`  ${step.detail}`);
		};

		try {
			if (workflowAction === "show") {
				const output = await runWorkflowShow(process.cwd(), onStep, {
					target: workflowTarget,
					template: workflowTemplate,
				});
				if (output) console.log(`\n${output}`);
				else process.exit(1);
			} else if (workflowAction === "validate") {
				const output = await runWorkflowValidate(process.cwd(), onStep, {
					target: workflowTarget,
					template: workflowTemplate,
				});
				if (output) console.log(`\n${output}`);
				else process.exit(1);
			} else {
				const output = await runWorkflowList(process.cwd(), onStep);
				console.log(`\n${output}`);
			}
		} catch (e) {
			console.error(`\u2717 ${e instanceof Error ? e.message : String(e)}`);
			process.exit(1);
		}
		break;
	}

	case "llms-txt": {
		render(
			<CIContextProvider isCI={isCI}>
				<LlmsTxt projectDir={process.cwd()} dryRun={cli.flags.dryRun} />
			</CIContextProvider>,
			{ stdin: inkStdin },
		);
		break;
	}

	case "plugin": {
		const pluginAction = cli.input[1] as
			| "add"
			| "remove"
			| "list"
			| "search"
			| "validate"
			| "sync"
			| "export"
			| "import"
			| "export-skills"
			| undefined;
		const VALID_PLUGIN_ACTIONS = [
			"add",
			"remove",
			"list",
			"search",
			"validate",
			"sync",
			"export",
			"import",
			"export-skills",
		];
		const action =
			pluginAction && VALID_PLUGIN_ACTIONS.includes(pluginAction)
				? pluginAction
				: "list";
		const target = cli.input[2];

		render(
			<CIContextProvider isCI={isCI}>
				<Plugin
					action={action}
					target={target}
					dryRun={cli.flags.dryRun}
					codex={cli.flags.codex}
				/>
			</CIContextProvider>,
			{ stdin: inkStdin },
		);
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
		const skillAction = cli.input[1] as string | undefined;

		if (skillAction !== "publish") {
			console.error("Usage: javi-forge skill <publish>");
			console.error(
				"  publish  Package a skill directory for marketplace distribution",
			);
			process.exit(1);
			break;
		}

		const targetDir = cli.input[2] ?? process.cwd();
		const { publishSkill } = await import("./lib/skill-publish.js");
		const result = await publishSkill({
			skillDir: path.resolve(targetDir),
			author: cli.flags.author || undefined,
			repository: cli.flags.repo || undefined,
			dryRun: cli.flags.dryRun,
		});

		if (result.success) {
			console.log(
				`\u2713 Published: ${result.manifest?.name}@${result.manifest?.version}`,
			);
			console.log(`  plugin.json: ${result.pluginJsonPath}`);
			if (result.manifest?.tags?.length) {
				console.log(`  tags: ${result.manifest.tags.join(", ")}`);
			}
			if (cli.flags.dryRun) {
				console.log("  (dry-run: no files written)");
			}
		} else {
			console.error(`\u2717 ${result.error}`);
			process.exit(1);
		}
		break;
	}

	case "security": {
		const securityAction = cli.input[1] as string | undefined;
		const VALID_SECURITY_ACTIONS = ["baseline", "check", "update", "allowlist"];
		if (!securityAction || !VALID_SECURITY_ACTIONS.includes(securityAction)) {
			console.error(
				"Usage: javi-forge security <baseline|check|update|allowlist>",
			);
			console.error(
				"  baseline   Create security baseline from current audit findings",
			);
			console.error(
				"  check      Check for regressions against baseline (exits non-zero if found)",
			);
			console.error(
				"  update     Re-snapshot baseline (acknowledge current vulns)",
			);
			console.error(
				"  allowlist  Add all current findings to the allowlist (suppress in future checks)",
			);
			console.error("");
			console.error("  Options (check mode):");
			console.error(
				"    --min-severity <level>  Only fail on regressions >= level (critical|high|moderate|low|info)",
			);
			console.error(
				"    --stale-days <N>        Warn if baseline older than N days (default: 30)",
			);
			console.error(
				"    --json                  Output result as JSON (for CI integration)",
			);
			process.exit(1);
			break;
		}

		const { runSecurity } = await import("./commands/security.js");
		const mode = securityAction as SecurityMode;
		const rawMinSev = (cli.flags as Record<string, unknown>).minSeverity as
			| string
			| undefined;
		const validSeverities: string[] = [
			"critical",
			"high",
			"moderate",
			"low",
			"info",
		];
		const checkOptions = {
			minSeverity: (rawMinSev && validSeverities.includes(rawMinSev)
				? rawMinSev
				: "low") as "critical" | "high" | "moderate" | "low" | "info",
			staleDays: (cli.flags as Record<string, unknown>).staleDays as
				| number
				| undefined,
		};
		const jsonOutput = !!(cli.flags as Record<string, unknown>).json;

		try {
			const result = await runSecurity(
				mode,
				process.cwd(),
				(step) => {
					if (jsonOutput) return; // suppress step output in JSON mode
					const icon =
						step.status === "done"
							? "\u2713"
							: step.status === "error"
								? "\u2717"
								: step.status === "skipped"
									? "-"
									: "\u25CB";
					console.log(`${icon} ${step.label}`);
					if (step.detail) console.log(`  ${step.detail}`);
				},
				checkOptions,
			);

			if (jsonOutput && result) {
				console.log(JSON.stringify(result, null, 2));
			}

			if (mode === "check" && result && result.filteredRegressions.length > 0) {
				process.exit(1);
			}
		} catch {
			process.exit(1);
		}
		break;
	}
	default: {
		const presetStack = VALID_STACKS.includes(cli.flags.stack)
			? (cli.flags.stack as Stack)
			: undefined;
		const presetCI = VALID_CI.includes(cli.flags.ci)
			? (cli.flags.ci as CIProvider)
			: undefined;
		const presetMemory = VALID_MEMORY.includes(cli.flags.memory)
			? (cli.flags.memory as MemoryOption)
			: undefined;
		const presetName = cli.flags.projectName || undefined;

		render(
			<CIContextProvider isCI={isCI}>
				<App
					dryRun={cli.flags.dryRun}
					presetStack={presetStack}
					presetCI={presetCI}
					presetMemory={presetMemory}
					presetName={presetName}
					presetGhagga={cli.flags.ghagga}
					presetMock={cli.flags.mock ?? false}
					presetLocalAi={cli.flags.localAi ?? false}
				/>
			</CIContextProvider>,
			{ stdin: inkStdin },
		);
		break;
	}
}
