import path from "node:path";
import fs from "fs-extra";
import { FORGE_ROOT } from "../../../constants.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 4: Generate .gitignore.
 *
 * - Copies <FORGE_ROOT>/.gitignore.template → <project>/.gitignore if absent.
 * - If destination already exists, reports "done" with detail "already exists".
 * - If template is missing, reports "skipped" with detail "no template".
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 2 of 6).
 */
export const stepGitignore: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep } = ctx;
	const stepId = "gitignore";
	report(onStep, stepId, "Generate .gitignore", "running");
	try {
		const templatePath = path.join(FORGE_ROOT, ".gitignore.template");
		const dest = path.join(projectDir, ".gitignore");
		if ((await fs.pathExists(templatePath)) && !(await fs.pathExists(dest))) {
			if (!dryRun) {
				await fs.copy(templatePath, dest);
			}
			report(onStep, stepId, "Generate .gitignore", "done", "from template");
		} else if (await fs.pathExists(dest)) {
			report(onStep, stepId, "Generate .gitignore", "done", "already exists");
		} else {
			report(onStep, stepId, "Generate .gitignore", "skipped", "no template");
		}
	} catch (e) {
		report(onStep, stepId, "Generate .gitignore", "error", String(e));
	}
};
