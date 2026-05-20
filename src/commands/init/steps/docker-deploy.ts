import path from "node:path";
import fs from "fs-extra";
import { backupIfExists, ensureDirExists } from "../../../lib/common.js";
import {
	generateDeployWorkflow,
	getDeployDestination,
} from "../../../lib/template.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 13: Scaffold Docker zero-downtime deploy.
 *
 * - When options.dockerDeploy is false, reports "skipped".
 * - Resolves the deploy destination for the configured CI provider; reports
 *   "error" when no destination/template exists for that provider.
 * - If the destination file already exists, reports "done" with "already exists".
 * - Otherwise renders the deploy workflow with options.dockerServiceName ?? "app"
 *   and writes it (backing up any existing file).
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 4 of 6).
 */
export const stepDockerDeploy: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { ciProvider } = options;
	const stepId = "docker-deploy";
	report(onStep, stepId, "Scaffold Docker zero-downtime deploy", "running");
	try {
		if (options.dockerDeploy) {
			const deployDest = getDeployDestination(ciProvider);
			if (deployDest) {
				const fullDest = path.join(projectDir, deployDest);
				if (await fs.pathExists(fullDest)) {
					report(
						onStep,
						stepId,
						"Scaffold Docker zero-downtime deploy",
						"done",
						"already exists",
					);
				} else {
					const serviceName = options.dockerServiceName || "app";
					const content = await generateDeployWorkflow(ciProvider, serviceName);
					if (content) {
						if (!dryRun) {
							await backupIfExists(fullDest);
							await ensureDirExists(path.dirname(fullDest));
							await fs.writeFile(fullDest, content, "utf-8");
						}
						report(
							onStep,
							stepId,
							"Scaffold Docker zero-downtime deploy",
							"done",
							dryRun ? `dry-run: would create ${deployDest}` : deployDest,
						);
					} else {
						report(
							onStep,
							stepId,
							"Scaffold Docker zero-downtime deploy",
							"error",
							`no deploy template for ${ciProvider}`,
						);
					}
				}
			} else {
				report(
					onStep,
					stepId,
					"Scaffold Docker zero-downtime deploy",
					"error",
					`no deploy destination for ${ciProvider}`,
				);
			}
		} else {
			report(
				onStep,
				stepId,
				"Scaffold Docker zero-downtime deploy",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepId,
			"Scaffold Docker zero-downtime deploy",
			"error",
			String(e),
		);
	}
};
