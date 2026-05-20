import path from "node:path";
import fs from "fs-extra";
import { LOCAL_AI_TEMPLATE_DIR } from "../../../constants.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 16: Scaffold local AI dev stack.
 *
 * - When options.localAi is false, reports "skipped".
 * - When LOCAL_AI_TEMPLATE_DIR is missing, reports "error".
 * - Otherwise copies docker-compose.yml and .env.example -> .env.local-ai
 *   (both skip if the destination already exists).
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 5 of 6).
 */
export const stepLocalAi: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const stepId = "local-ai";
	report(onStep, stepId, "Scaffold local AI dev stack", "running");
	try {
		if (options.localAi) {
			if (await fs.pathExists(LOCAL_AI_TEMPLATE_DIR)) {
				const composeDest = path.join(projectDir, "docker-compose.yml");
				const envDest = path.join(projectDir, ".env.local-ai");
				if (!dryRun) {
					// Copy docker-compose.yml (skip if exists)
					if (!(await fs.pathExists(composeDest))) {
						await fs.copy(
							path.join(LOCAL_AI_TEMPLATE_DIR, "docker-compose.yml"),
							composeDest,
						);
					}
					// Copy .env.example as .env.local-ai
					const envSrc = path.join(LOCAL_AI_TEMPLATE_DIR, ".env.example");
					if (
						(await fs.pathExists(envSrc)) &&
						!(await fs.pathExists(envDest))
					) {
						await fs.copy(envSrc, envDest);
					}
				}
				report(
					onStep,
					stepId,
					"Scaffold local AI dev stack",
					"done",
					dryRun
						? "dry-run: would create docker-compose.yml + .env.local-ai"
						: "docker-compose.yml + .env.local-ai",
				);
			} else {
				report(
					onStep,
					stepId,
					"Scaffold local AI dev stack",
					"error",
					"local-ai template not found",
				);
			}
		} else {
			report(
				onStep,
				stepId,
				"Scaffold local AI dev stack",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Scaffold local AI dev stack", "error", String(e));
	}
};
