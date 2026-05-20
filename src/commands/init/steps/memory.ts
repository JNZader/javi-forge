import path from "node:path";
import fs from "fs-extra";
import { MODULES_DIR } from "../../../constants.js";
import { ensureDirExists } from "../../../lib/common.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 6: Install memory module.
 *
 * - If memory === "none", reports "skipped".
 * - Otherwise copies <MODULES_DIR>/<memory>/ → <project>/.javi-forge/modules/<memory>/.
 * - For engram specifically, copies .mcp-config-snippet.json to project root
 *   replacing __PROJECT_NAME__ placeholders.
 * - If the module source dir is missing, reports "error" with "module not found".
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 2 of 6).
 */
export const stepMemory: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { memory, projectName } = options;
	const stepMem = "memory";
	report(onStep, stepMem, `Install memory module: ${memory}`, "running");
	try {
		if (memory !== "none") {
			const moduleSrc = path.join(MODULES_DIR, memory);
			if (await fs.pathExists(moduleSrc)) {
				if (!dryRun) {
					// Copy module files to project
					const moduleDest = path.join(
						projectDir,
						".javi-forge",
						"modules",
						memory,
					);
					await ensureDirExists(moduleDest);
					await fs.copy(moduleSrc, moduleDest, {
						overwrite: false,
						errorOnExist: false,
					});

					// If engram, copy .mcp-config-snippet.json to project with placeholder replacement
					if (memory === "engram") {
						const snippetSrc = path.join(moduleSrc, ".mcp-config-snippet.json");
						if (await fs.pathExists(snippetSrc)) {
							const snippetDest = path.join(
								projectDir,
								".mcp-config-snippet.json",
							);
							let content = await fs.readFile(snippetSrc, "utf-8");
							content = content.replace(/__PROJECT_NAME__/g, projectName);
							await fs.writeFile(snippetDest, content, "utf-8");
						}
					}
				}
				report(onStep, stepMem, `Install memory module: ${memory}`, "done");
			} else {
				report(
					onStep,
					stepMem,
					`Install memory module: ${memory}`,
					"error",
					"module not found",
				);
			}
		} else {
			report(
				onStep,
				stepMem,
				`Install memory module: ${memory}`,
				"skipped",
				"none selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepMem,
			`Install memory module: ${memory}`,
			"error",
			String(e),
		);
	}
};
