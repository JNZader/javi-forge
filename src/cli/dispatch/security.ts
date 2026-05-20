/**
 * `javi-forge security <baseline|check|update|allowlist>` handler.
 *
 * Console-only (no Ink, no React, no CIContextProvider).
 * Lazy-loads ../../commands/security.js INSIDE the function to preserve
 * cold-start performance — heavy command modules MUST NOT be eager-imported
 * at the top of this file.
 */

import type { SecurityMode } from "../../commands/security.js";
import type { CLI } from "./types.js";

export async function handleSecurity(cli: CLI): Promise<void> {
	const securityAction = cli.input[1] as string | undefined;
	const VALID_SECURITY_ACTIONS = ["baseline", "check", "update", "allowlist"];
	if (!securityAction || !VALID_SECURITY_ACTIONS.includes(securityAction)) {
		console.error(
			"Usage: javi-forge security <baseline|check|update|allowlist>",
		);
		console.error(
			"  baseline   Create security baseline from current audit findings",
		);
		console.error(
			"  check      Check for regressions against baseline (exits non-zero if found)",
		);
		console.error(
			"  update     Re-snapshot baseline (acknowledge current vulns)",
		);
		console.error(
			"  allowlist  Add all current findings to the allowlist (suppress in future checks)",
		);
		console.error("");
		console.error("  Options (check mode):");
		console.error(
			"    --min-severity <level>  Only fail on regressions >= level (critical|high|moderate|low|info)",
		);
		console.error(
			"    --stale-days <N>        Warn if baseline older than N days (default: 30)",
		);
		console.error(
			"    --json                  Output result as JSON (for CI integration)",
		);
		process.exit(1);
	}

	const { runSecurity } = await import("../../commands/security.js");
	const mode = securityAction as SecurityMode;
	const rawMinSev = (cli.flags as Record<string, unknown>).minSeverity as
		| string
		| undefined;
	const validSeverities: string[] = [
		"critical",
		"high",
		"moderate",
		"low",
		"info",
	];
	const checkOptions = {
		minSeverity: (rawMinSev && validSeverities.includes(rawMinSev)
			? rawMinSev
			: "low") as "critical" | "high" | "moderate" | "low" | "info",
		staleDays: (cli.flags as Record<string, unknown>).staleDays as
			| number
			| undefined,
	};
	const jsonOutput = !!(cli.flags as Record<string, unknown>).json;

	try {
		const result = await runSecurity(
			mode,
			process.cwd(),
			(step) => {
				if (jsonOutput) return; // suppress step output in JSON mode
				const icon =
					step.status === "done"
						? "\u2713"
						: step.status === "error"
							? "\u2717"
							: step.status === "skipped"
								? "-"
								: "\u25CB";
				console.log(`${icon} ${step.label}`);
				if (step.detail) console.log(`  ${step.detail}`);
			},
			checkOptions,
		);

		if (jsonOutput && result) {
			console.log(JSON.stringify(result, null, 2));
		}

		if (mode === "check" && result && result.filteredRegressions.length > 0) {
			process.exit(1);
		}
	} catch {
		process.exit(1);
	}
}
