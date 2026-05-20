import path from "node:path";
import fs from "fs-extra";
import { generateSmartClaudeMd } from "../../../lib/claudemd.js";
import { detectProjectStack } from "../../../lib/stack-detector.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 12: Generate CLAUDE.md (smart: project-aware).
 *
 * - When claudeMd is false, reports "skipped".
 * - If CLAUDE.md already exists at the project root, reports "done" with "already exists".
 * - Otherwise detects the project stack and writes a smart CLAUDE.md;
 *   the detail mentions the number of recommended skills detected.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 4 of 6).
 */
export const stepClaudeMd: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { claudeMd } = options;
	const stepId = "claude-md";
	report(onStep, stepId, "Generate CLAUDE.md", "running");
	try {
		if (claudeMd) {
			const claudeMdPath = path.join(projectDir, "CLAUDE.md");
			if (await fs.pathExists(claudeMdPath)) {
				report(onStep, stepId, "Generate CLAUDE.md", "done", "already exists");
			} else {
				if (!dryRun) {
					// Detect project stack for smart CLAUDE.md generation
					const detection = await detectProjectStack(projectDir).catch(
						() => null,
					);
					const content = generateSmartClaudeMd(options, detection);
					await fs.writeFile(claudeMdPath, content, "utf-8");
					// detection itself can be null from .catch(() => null) above;
					// recommendedSkills is always an array if detection succeeds.
					const skillCount = detection?.recommendedSkills.length ?? 0;
					report(
						onStep,
						stepId,
						"Generate CLAUDE.md",
						"done",
						skillCount > 0
							? `CLAUDE.md (${skillCount} skills detected)`
							: "CLAUDE.md",
					);
				} else {
					report(
						onStep,
						stepId,
						"Generate CLAUDE.md",
						"done",
						"dry-run: would generate CLAUDE.md",
					);
				}
			}
		} else {
			report(onStep, stepId, "Generate CLAUDE.md", "skipped", "not selected");
		}
	} catch (e) {
		report(onStep, stepId, "Generate CLAUDE.md", "error", String(e));
	}
};
