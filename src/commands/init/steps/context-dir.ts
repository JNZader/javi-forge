import path from "node:path";
import fs from "fs-extra";
import { ensureDirExists } from "../../../lib/common.js";
import { generateContextDir } from "../../../lib/context.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 11: Generate .context/ directory.
 *
 * - When contextDir is false, reports "skipped".
 * - If .context/ already exists, reports "done" with "already exists".
 * - Otherwise generates INDEX.md + summary.md via generateContextDir().
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 4 of 6).
 */
export const stepContextDir: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { contextDir } = options;
	const stepId = "context-dir";
	report(onStep, stepId, "Generate .context/ directory", "running");
	try {
		if (contextDir) {
			const contextDirPath = path.join(projectDir, ".context");
			if (await fs.pathExists(contextDirPath)) {
				report(
					onStep,
					stepId,
					"Generate .context/ directory",
					"done",
					"already exists",
				);
			} else {
				if (!dryRun) {
					const { index, summary } = await generateContextDir(options);
					await ensureDirExists(contextDirPath);
					await fs.writeFile(
						path.join(contextDirPath, "INDEX.md"),
						index,
						"utf-8",
					);
					await fs.writeFile(
						path.join(contextDirPath, "summary.md"),
						summary,
						"utf-8",
					);
				}
				report(
					onStep,
					stepId,
					"Generate .context/ directory",
					"done",
					dryRun
						? "dry-run: would generate .context/"
						: ".context/INDEX.md + summary.md",
				);
			}
		} else {
			report(
				onStep,
				stepId,
				"Generate .context/ directory",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Generate .context/ directory", "error", String(e));
	}
};
