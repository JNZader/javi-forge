import path from "node:path";
import fs from "fs-extra";
import { SECURITY_HOOKS_DIR } from "../../../constants.js";
import { ensureDirExists } from "../../../lib/common.js";
import type { HookProfile } from "../../../types/index.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 14: Scaffold security hooks.
 *
 * - When options.securityHooks is false, reports "skipped".
 * - When SECURITY_HOOKS_DIR templates are missing, reports "error".
 * - Otherwise copies the 6-layer git security hooks into
 *   ci-local/hooks/security/ (skipping existing files, chmod 0755) and copies
 *   the kiteguard-style runtime settings to .claude/settings.json when absent.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 5 of 6).
 * Grouped with stepHookProfile for cohesion — both manage ci-local/hooks/.
 */
export const stepSecurityHooks: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { securityHooks } = options;
	const stepId = "security-hooks";
	report(onStep, stepId, "Scaffold security hooks", "running");
	try {
		if (securityHooks) {
			if (await fs.pathExists(SECURITY_HOOKS_DIR)) {
				if (!dryRun) {
					// Copy 6-layer git security hooks into ci-local/hooks/security/
					const secHooksDest = path.join(
						projectDir,
						"ci-local",
						"hooks",
						"security",
					);
					await ensureDirExists(secHooksDest);
					const hookFiles = await fs.readdir(SECURITY_HOOKS_DIR);
					const gitHooks = hookFiles.filter((f) => !f.endsWith(".json"));
					for (const hook of gitHooks) {
						const src = path.join(SECURITY_HOOKS_DIR, hook);
						const dest = path.join(secHooksDest, hook);
						await fs.copy(src, dest, { overwrite: false });
						await fs.chmod(dest, 0o755);
					}

					// Copy runtime security settings (kiteguard-style) to .claude/
					const settingsSrc = path.join(
						SECURITY_HOOKS_DIR,
						"claude-settings-security.json",
					);
					if (await fs.pathExists(settingsSrc)) {
						const claudeDir = path.join(projectDir, ".claude");
						await ensureDirExists(claudeDir);
						const settingsDest = path.join(claudeDir, "settings.json");
						if (!(await fs.pathExists(settingsDest))) {
							await fs.copy(settingsSrc, settingsDest);
						}
					}
				}
				report(
					onStep,
					stepId,
					"Scaffold security hooks",
					"done",
					dryRun
						? "dry-run: would scaffold security hooks"
						: "6 git layers + runtime hooks",
				);
			} else {
				report(
					onStep,
					stepId,
					"Scaffold security hooks",
					"error",
					"security-hooks templates not found",
				);
			}
		} else {
			report(
				onStep,
				stepId,
				"Scaffold security hooks",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Scaffold security hooks", "error", String(e));
	}
};

/**
 * Step 14b: Write hook reliability profile.
 *
 * - When options.securityHooks is false, reports "skipped".
 * - Otherwise writes ci-local/hooks/profile.json with the resolved profile
 *   (defaults to "standard" when hookProfile is undefined).
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 5 of 6).
 * Grouped with stepSecurityHooks for cohesion — both manage ci-local/hooks/.
 */
export const stepHookProfile: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { securityHooks, hookProfile } = options;
	const stepId = "hook-profile";
	report(onStep, stepId, "Write hook reliability profile", "running");
	try {
		if (securityHooks) {
			if (!dryRun) {
				const hooksDir = path.join(projectDir, "ci-local", "hooks");
				await ensureDirExists(hooksDir);
				const profilePath = path.join(hooksDir, "profile.json");
				const resolvedProfile: HookProfile = hookProfile ?? "standard";
				await fs.writeJson(
					profilePath,
					{ profile: resolvedProfile },
					{ spaces: 2 },
				);
			}
			report(
				onStep,
				stepId,
				"Write hook reliability profile",
				"done",
				dryRun
					? `dry-run: would write profile.json (${hookProfile ?? "standard"})`
					: `ci-local/hooks/profile.json (${hookProfile ?? "standard"})`,
			);
		} else {
			report(
				onStep,
				stepId,
				"Write hook reliability profile",
				"skipped",
				"security hooks not selected",
			);
		}
	} catch (e) {
		report(
			onStep,
			stepId,
			"Write hook reliability profile",
			"error",
			String(e),
		);
	}
};
