import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

// Duplicate the promisify setup here so the step file is self-contained.
// A shared lib/exec.ts is deferred to a later cleanup PR.
const execFileAsync = promisify(execFile);

/**
 * Step 7: AI config sync (delegated to javi-ai).
 *
 * - When aiSync is false, reports "skipped".
 * - When dryRun, reports a done message without invoking javi-ai.
 * - Otherwise shells out to `npx javi-ai sync --project-dir <projectDir> --target all`.
 * - Detects soft failures via stderr (e.g. "Raw mode is not supported", "ERROR").
 * - Hard failures (ENOENT, not found, ERR_MODULE_NOT_FOUND) report a helpful install hint.
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 3 of 6).
 */
export const stepAISync: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { aiSync } = options;
	const stepId = "ai-sync";
	report(onStep, stepId, "Sync AI config via javi-ai", "running");
	try {
		if (aiSync) {
			if (!dryRun) {
				try {
					const { stderr } = await execFileAsync(
						"npx",
						["javi-ai", "sync", "--project-dir", projectDir, "--target", "all"],
						{
							cwd: projectDir,
							timeout: 120_000,
						},
					);
					// javi-ai may exit 0 but crash (e.g. Ink raw mode error) — detect via stderr
					if (
						stderr &&
						(stderr.includes("Raw mode is not supported") ||
							stderr.includes("ERROR"))
					) {
						report(
							onStep,
							stepId,
							"Sync AI config via javi-ai",
							"error",
							"javi-ai crashed. Run manually: npx javi-ai sync --project-dir . --target all",
						);
					} else {
						report(
							onStep,
							stepId,
							"Sync AI config via javi-ai",
							"done",
							"javi-ai sync --target all",
						);
					}
				} catch (syncErr: unknown) {
					const msg =
						syncErr instanceof Error ? syncErr.message : String(syncErr);
					if (
						msg.includes("ENOENT") ||
						msg.includes("not found") ||
						msg.includes("ERR_MODULE_NOT_FOUND")
					) {
						report(
							onStep,
							stepId,
							"Sync AI config via javi-ai",
							"error",
							"javi-ai not found. Install with: npm install -g javi-ai (or run npx javi-ai sync manually)",
						);
					} else {
						report(onStep, stepId, "Sync AI config via javi-ai", "error", msg);
					}
				}
			} else {
				report(
					onStep,
					stepId,
					"Sync AI config via javi-ai",
					"done",
					"dry-run: would run javi-ai sync --target all",
				);
			}
		} else {
			report(
				onStep,
				stepId,
				"Sync AI config via javi-ai",
				"skipped",
				"not selected",
			);
		}
	} catch (e) {
		report(onStep, stepId, "Sync AI config via javi-ai", "error", String(e));
	}
};
