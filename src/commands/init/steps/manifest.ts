import path from "node:path";
import fs from "fs-extra";
import { ensureDirExists } from "../../../lib/common.js";
import type { ForgeManifest } from "../../../types/index.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 18: Write the forge manifest under .javi-forge/manifest.json.
 *
 * - In dry-run mode, reports what would be written without touching disk.
 * - Otherwise materialises .javi-forge/, computes the modules array from
 *   selected options, and writes manifest.json (overwriting any existing).
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 6 of 6).
 */
export const stepManifest: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const {
		stack,
		ciProvider,
		memory,
		aiSync,
		sdd,
		ghagga,
		contextDir,
		claudeMd,
		securityHooks,
		projectName,
		dockerDeploy,
		codeGraph,
		localAi,
	} = options;
	const stepId = "manifest";
	report(onStep, stepId, "Write forge manifest", "running");
	try {
		if (!dryRun) {
			const manifestDir = path.join(projectDir, ".javi-forge");
			await ensureDirExists(manifestDir);
			const manifest: ForgeManifest = {
				version: "0.1.0",
				projectName,
				stack,
				ciProvider,
				memory,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				modules: [
					...(memory !== "none" ? [memory] : []),
					...(ghagga ? ["ghagga"] : []),
					...(sdd ? ["sdd"] : []),
					...(aiSync ? ["ai-config"] : []),
					...(contextDir ? ["context"] : []),
					...(claudeMd ? ["claude-md"] : []),
					...(dockerDeploy ? ["docker-deploy"] : []),
					...(securityHooks ? ["security-hooks"] : []),
					...(codeGraph ? ["code-graph"] : []),
					...(localAi ? ["local-ai"] : []),
				],
			};
			await fs.writeJson(path.join(manifestDir, "manifest.json"), manifest, {
				spaces: 2,
			});
			report(
				onStep,
				stepId,
				"Write forge manifest",
				"done",
				".javi-forge/manifest.json",
			);
		} else {
			report(
				onStep,
				stepId,
				"Write forge manifest",
				"done",
				"dry-run: would write .javi-forge/manifest.json",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Write forge manifest", "error", String(e));
	}
};
