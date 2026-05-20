/**
 * `javi-forge skills` handler — three branches:
 *   1. `skills auto` / `skills auto-install` — Ink render of <AutoSkills /> (eager)
 *   2. `skills score` / `skills benchmark` — console-only, lazy-loads ./commands/skills.js
 *   3. `skills doctor` / `skills budget` — Ink render of <Skills mode=... /> (eager)
 *
 * The command module (`./commands/skills.js`) is lazy-loaded inside the function
 * to preserve cold-start performance for the Ink branches. Ink + React are
 * already eagerly loaded by the entrypoint, so the UI components stay eager.
 */

import path from "node:path";
import { render } from "ink";
import React from "react";
import AutoSkills from "../../ui/AutoSkills.js";
import { CIProvider as CIContextProvider } from "../../ui/CIContext.js";
import Skills from "../../ui/Skills.js";
import type { CLI, RendererCtx } from "./types.js";

const VALID_SKILLS_ACTIONS = [
	"doctor",
	"budget",
	"score",
	"benchmark",
	"auto",
	"auto-install",
];

export async function handleSkillsCmd(
	cli: CLI,
	ctx: RendererCtx,
): Promise<void> {
	const skillsAction = cli.input[1] as string | undefined;
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
	}

	// Auto / auto-install: render interactive Ink UI
	if (skillsAction === "auto" || skillsAction === "auto-install") {
		render(
			<CIContextProvider isCI={ctx.isCI}>
				<AutoSkills
					projectDir={process.cwd()}
					skillsDir={cli.flags.skillsDir || undefined}
					dryRun={cli.flags.dryRun}
				/>
			</CIContextProvider>,
			{ stdin: ctx.inkStdin },
		);
		return;
	}

	// Score and benchmark are non-interactive CLI commands
	if (skillsAction === "score" || skillsAction === "benchmark") {
		const targetSkill = cli.input[2];
		if (!targetSkill) {
			console.error(`Usage: javi-forge skills ${skillsAction} <skill-name>`);
			process.exit(1);
		}

		const skillsDir =
			cli.flags.skillsDir ||
			path.join(process.env.HOME ?? "~", ".claude", "skills");
		const skillPath = path.join(skillsDir, targetSkill, "SKILL.md");

		if (skillsAction === "score") {
			const { scoreSkill } = await import("../../commands/skills.js");
			const result = await scoreSkill(skillPath, cli.flags.budget);
			if (!result) {
				console.error(`\u2717 Skill not found: ${skillPath}`);
				process.exit(1);
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
		}

		const { benchmarkSkill } = await import("../../commands/skills.js");
		const result = await benchmarkSkill(skillPath);
		if (!result) {
			console.error(`\u2717 Skill not found: ${skillPath}`);
			process.exit(1);
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

	// Doctor / budget: render Ink UI with mode prop
	const skillsMode = skillsAction as "doctor" | "budget";
	render(
		<CIContextProvider isCI={ctx.isCI}>
			<Skills
				mode={skillsMode}
				budget={cli.flags.budget}
				deep={cli.flags.deep}
				skillsDir={cli.flags.skillsDir || undefined}
			/>
		</CIContextProvider>,
		{ stdin: ctx.inkStdin },
	);
}
