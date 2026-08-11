import path from "node:path";
import fs from "fs-extra";
import { MODULES_DIR } from "../../../constants.js";
import { ensureDirExists } from "../../../lib/common.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 9: Install the local GHAGGA review module.
 *
 * - When ghagga is false, reports "skipped".
 * - Copies <MODULES_DIR>/ghagga → <project>/.javi-forge/modules/ghagga (no overwrite).
 * - If module source dir is missing, reports "error" with "module not found".
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * The GitHub Action review workflow is intentionally NOT scaffolded — ghagga
 * runs locally/self-hosted, not as a GitHub Action.
 */
export const stepGhagga: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { ghagga } = options;
	const stepId = "ghagga";
	report(onStep, stepId, "Install GHAGGA review system", "running");
	try {
		if (ghagga) {
			const ghaggaSrc = path.join(MODULES_DIR, "ghagga");
			if (await fs.pathExists(ghaggaSrc)) {
				if (!dryRun) {
					const ghaggaDest = path.join(
						projectDir,
						".javi-forge",
						"modules",
						"ghagga",
					);
					await ensureDirExists(ghaggaDest);
					await fs.copy(ghaggaSrc, ghaggaDest, {
						overwrite: false,
						errorOnExist: false,
					});
				}
				report(onStep, stepId, "Install GHAGGA review system", "done");
			} else {
				report(
					onStep,
					stepId,
					"Install GHAGGA review system",
					"error",
					"module not found",
				);
			}
		} else {
			report(
				onStep,
				stepId,
				"Install GHAGGA review system",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Install GHAGGA review system", "error", String(e));
	}
};
