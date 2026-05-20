import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { CI_LOCAL_DIR } from "../../../constants.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

// Duplicate the promisify setup here so the step file is self-contained.
// A shared lib/exec.ts is deferred to a later cleanup PR.
const execFileAsync = promisify(execFile);

/**
 * Step 1: Initialize git repository.
 *
 * - If .git is missing, runs `git init` in the project dir.
 * - If .git already exists, reports "done" with detail "already exists".
 * - In dry-run, skips the actual `git init` call but still reports.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 1 of 6).
 */
export const stepGitInit: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep } = ctx;
	const stepId = "git-init";
	report(onStep, stepId, "Initialize git repository", "running");
	try {
		const gitDir = path.join(projectDir, ".git");
		if (!(await fs.pathExists(gitDir))) {
			if (!dryRun) {
				await execFileAsync("git", ["init"], { cwd: projectDir });
			}
			report(
				onStep,
				stepId,
				"Initialize git repository",
				"done",
				"initialized",
			);
		} else {
			report(
				onStep,
				stepId,
				"Initialize git repository",
				"done",
				"already exists",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Initialize git repository", "error", String(e));
	}
};

/**
 * Step 2: Configure git hooks path.
 *
 * - Copies templates/ci-local/ → <project>/ci-local/ (no overwrite).
 * - chmod 0755 on hook files.
 * - Sets git config core.hooksPath to ci-local/hooks.
 * - Skips entirely when CI_LOCAL_DIR template is missing.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 1 of 6).
 */
export const stepGitHooks: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep } = ctx;
	const stepId = "git-hooks";
	report(onStep, stepId, "Configure git hooks path", "running");
	try {
		const ciLocalSrc = CI_LOCAL_DIR;
		const ciLocalDest = path.join(projectDir, "ci-local");
		if (await fs.pathExists(ciLocalSrc)) {
			if (!dryRun) {
				await fs.copy(ciLocalSrc, ciLocalDest, {
					overwrite: false,
					errorOnExist: false,
				});
				// Set core.hooksPath to ci-local/hooks
				const hooksDir = path.join(ciLocalDest, "hooks");
				if (await fs.pathExists(hooksDir)) {
					// Ensure hooks are executable
					const hookFiles = await fs.readdir(hooksDir);
					for (const hook of hookFiles) {
						await fs.chmod(path.join(hooksDir, hook), 0o755);
					}
					await execFileAsync(
						"git",
						["config", "core.hooksPath", "ci-local/hooks"],
						{ cwd: projectDir },
					);
				}
			}
			report(
				onStep,
				stepId,
				"Configure git hooks path",
				"done",
				"ci-local/hooks",
			);
		} else {
			report(
				onStep,
				stepId,
				"Configure git hooks path",
				"skipped",
				"no ci-local dir",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Configure git hooks path", "error", String(e));
	}
};
