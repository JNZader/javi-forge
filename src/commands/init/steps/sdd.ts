import path from "node:path";
import fs from "fs-extra";
import { ensureDirExists } from "../../../lib/common.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 8: Set up SDD (openspec/) scaffolding.
 *
 * - When sdd is false, reports "skipped".
 * - Otherwise ensures openspec/ exists and writes a default README.md if absent.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 3 of 6).
 */
export const stepSDD: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { sdd, projectName } = options;
	const stepId = "sdd";
	report(onStep, stepId, "Set up SDD (openspec/)", "running");
	try {
		if (sdd) {
			if (!dryRun) {
				const openspecDir = path.join(projectDir, "openspec");
				await ensureDirExists(openspecDir);
				// Create a README if none exists
				const readmePath = path.join(openspecDir, "README.md");
				if (!(await fs.pathExists(readmePath))) {
					await fs.writeFile(
						readmePath,
						`# openspec/\n\nSpec-Driven Development artifacts for ${projectName}.\n\nSee: /sdd:new <name> to start a new change.\n`,
						"utf-8",
					);
				}
			}
			report(onStep, stepId, "Set up SDD (openspec/)", "done");
		} else {
			report(
				onStep,
				stepId,
				"Set up SDD (openspec/)",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Set up SDD (openspec/)", "error", String(e));
	}
};
