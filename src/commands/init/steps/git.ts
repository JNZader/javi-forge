import path from "node:path";
import fs from "fs-extra";
import { execFileAsync } from "../../../lib/exec.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

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
 * Step 2: Install managed git hooks (D7 reconciliation).
 *
 * Init no longer copies `ci-local/` hook bodies into the project nor flips
 * `core.hooksPath` — both were the pre-consolidation mechanism. It now delegates
 * to `installCIHooks`, the SINGLE writer of `.git/hooks` and the choke point for
 * the ATOMIC `core.hooksPath` guard (D6). A foreign/global hooksPath, or a
 * dormant foreign slot, is REFUSED there with zero mutation and surfaced as an
 * error here — init never overrides the user's hook manager.
 *
 * - dry-run: reports "would install managed hooks", calls nothing.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 */
export const stepGitHooks: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep } = ctx;
	const stepId = "git-hooks";
	const label = "Install git hooks";
	report(onStep, stepId, label, "running");

	if (dryRun) {
		report(onStep, stepId, label, "done", "would install managed hooks");
		return;
	}

	try {
		// Lazy import: installCIHooks pulls in the CI command surface; keep it off
		// the init cold-start path, exactly like the `ci init` dispatch branch.
		const { installCIHooks } = await import("../../ci.js");
		const { installed, upgraded, backups, errors, notes } =
			await installCIHooks(projectDir);

		if (errors.length > 0) {
			report(onStep, stepId, label, "error", errors.join("; "));
			return;
		}

		const detail =
			[
				...installed.map((h) => `installed ${h}`),
				...upgraded.map((h) => `upgraded ${h}`),
				...notes,
				...backups.map((b) => `backup ${b}`),
			].join("; ") || "managed hooks installed";
		report(onStep, stepId, label, "done", detail);
	} catch (e) {
		report(onStep, stepId, label, "error", String(e));
	}
};
