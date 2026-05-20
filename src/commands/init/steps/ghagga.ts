import path from "node:path";
import fs from "fs-extra";
import { FORGE_ROOT, MODULES_DIR } from "../../../constants.js";
import { ensureDirExists } from "../../../lib/common.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 9: Install GHAGGA review system.
 *
 * - When ghagga is false, reports "skipped".
 * - Copies <MODULES_DIR>/ghagga → <project>/.javi-forge/modules/ghagga (no overwrite).
 * - For GitHub provider, also copies the ghagga-review.yml caller workflow into
 *   <project>/.github/workflows/.
 * - If module source dir is missing, reports "error" with "module not found".
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 3 of 6).
 */
export const stepGhagga: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { ghagga, ciProvider } = options;
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

					// Copy ghagga caller workflow to CI provider location
					if (ciProvider === "github") {
						const workflowSrc = path.join(
							FORGE_ROOT,
							"templates",
							"github",
							"ghagga-review.yml",
						);
						if (await fs.pathExists(workflowSrc)) {
							const workflowDest = path.join(
								projectDir,
								".github",
								"workflows",
								"ghagga-review.yml",
							);
							await ensureDirExists(path.dirname(workflowDest));
							await fs.copy(workflowSrc, workflowDest, { overwrite: false });
						}
					}
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
