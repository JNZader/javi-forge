import path from "node:path";
import fs from "fs-extra";
import { backupIfExists, ensureDirExists } from "../../../lib/common.js";
import {
	generateCIWorkflow,
	generateDependabotYml,
	getCIDestination,
} from "../../../lib/template.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 3: Copy CI template.
 *
 * - Generates the CI workflow for the detected stack + provider.
 * - Writes to getCIDestination(ciProvider), backing up any existing file.
 * - Skips with "no template for <stack>" when generateCIWorkflow returns empty.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 2 of 6).
 */
export const stepCITemplate: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { stack, ciProvider } = options;
	const stepId = "ci-template";
	report(onStep, stepId, `Copy ${ciProvider} CI workflow`, "running");
	try {
		const ciContent = await generateCIWorkflow(stack, ciProvider);
		if (ciContent) {
			const dest = path.join(projectDir, getCIDestination(ciProvider));
			if (!dryRun) {
				await backupIfExists(dest);
				await ensureDirExists(path.dirname(dest));
				await fs.writeFile(dest, ciContent, "utf-8");
			}
			report(
				onStep,
				stepId,
				`Copy ${ciProvider} CI workflow`,
				"done",
				getCIDestination(ciProvider),
			);
		} else {
			report(
				onStep,
				stepId,
				`Copy ${ciProvider} CI workflow`,
				"skipped",
				`no template for ${stack}`,
			);
		}
	} catch (e) {
		report(
			onStep,
			stepId,
			`Copy ${ciProvider} CI workflow`,
			"error",
			String(e),
		);
	}
};

/**
 * Step 5: Generate dependabot.yml.
 *
 * - Only runs when ciProvider === "github".
 * - Writes .github/dependabot.yml with backup of any existing file.
 * - Otherwise reports skipped with "not needed for <ciProvider>".
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 2 of 6).
 */
export const stepDependabot: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { stack, ciProvider } = options;
	const stepId = "dependabot";
	report(onStep, stepId, "Generate dependabot.yml", "running");
	try {
		if (ciProvider === "github") {
			const content = await generateDependabotYml([stack], true);
			const dest = path.join(projectDir, ".github", "dependabot.yml");
			if (!dryRun) {
				await backupIfExists(dest);
				await ensureDirExists(path.dirname(dest));
				await fs.writeFile(dest, content, "utf-8");
			}
			report(onStep, stepId, "Generate dependabot.yml", "done");
		} else {
			report(
				onStep,
				stepId,
				"Generate dependabot.yml",
				"skipped",
				`not needed for ${ciProvider}`,
			);
		}
	} catch (e) {
		report(onStep, stepId, "Generate dependabot.yml", "error", String(e));
	}
};
