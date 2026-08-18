/**
 * `javi-forge hooks <install|doctor|repair> claude` — console-only renderer for
 * the already-tested Claude PreToolUse guard library (Slice 4a). It wires the
 * three lib fns to human output + exit codes; it adds NO new security logic and
 * never touches `runTransaction`/secure-fs directly.
 *
 * Honest-execution constraint (spec Requirement "…never fabricates execution
 * status"): the doctor renderer reports effective execution as `inconclusive`
 * only. It MUST NOT print, imply, or default to `RUNNABLE` — real host-probing
 * is Slice 4b. Exit 2 (INCONCLUSIVE gate semantics) is likewise reserved for 4b
 * and never emitted here.
 */

import {
	type ClaudeHookDoctorReport,
	type ClaudeHookMutationResult,
	doctorClaudePreToolUse,
	installClaudePreToolUse,
	repairClaudePreToolUse,
} from "../lib/claude-hook-manager.js";

export type ClaudeHookSub = "install" | "doctor" | "repair";

/** Injectable seams for tests; each defaults to the real implementation. */
export interface ClaudeHookCmdDeps {
	install?: typeof installClaudePreToolUse;
	doctor?: typeof doctorClaudePreToolUse;
	repair?: typeof repairClaudePreToolUse;
	log?: (msg: string) => void;
	logError?: (msg: string) => void;
}

function renderMutation(
	verb: string,
	result: ClaudeHookMutationResult,
	log: (m: string) => void,
	logError: (m: string) => void,
): number {
	if (result.ok) {
		log(`${verb} claude: ok`);
		if (result.changed.length > 0) {
			log("changed:");
			for (const p of result.changed) log(`  ${p}`);
		} else {
			log("changed: nothing (already up to date)");
		}
		if (result.backups.length > 0) {
			log("backups:");
			for (const p of result.backups) log(`  ${p}`);
		}
		return 0;
	}

	logError(`${verb} claude: refused`);
	for (const e of result.errors) logError(`  ${e}`);
	return 1;
}

function renderDoctor(
	report: ClaudeHookDoctorReport,
	log: (m: string) => void,
): number {
	log(`doctor claude: ${report.healthy ? "healthy" : "unhealthy"}`);
	log(`  settings: ${report.settings.state} — ${report.settings.detail}`);
	log(`  asset:    ${report.asset.state} — ${report.asset.detail}`);
	log(
		`  node:     ${report.node.version ?? "unavailable"} (min-satisfied: ${report.node.satisfiesMinimum})`,
	);
	// Honest stub: 4a cannot confirm the guard is live. Never RUNNABLE.
	log("  execution: inconclusive (effective-execution probe deferred to 4b)");
	log(`  host-residual: ${report.hostResidual}`);
	if (report.remediation.length > 0) {
		log("  remediation:");
		for (const r of report.remediation) log(`    - ${r}`);
	}
	// Doctor is informational, not a gate — always exit 0 (spec Scenario
	// "Doctor reports component health").
	return 0;
}

/**
 * Run one Claude-hook subcommand against `projectDir`. Returns the process exit
 * code (the dispatcher calls `process.exit`, not this fn):
 *   - install/repair: 0 when `ok`, 1 on refusal/failure.
 *   - doctor: always 0 (informational).
 */
export async function runClaudeHookCommand(
	sub: ClaudeHookSub,
	projectDir: string,
	opts: { force?: boolean },
	deps: ClaudeHookCmdDeps = {},
): Promise<number> {
	const log = deps.log ?? ((m: string) => console.log(m));
	const logError = deps.logError ?? ((m: string) => console.error(m));
	const install = deps.install ?? installClaudePreToolUse;
	const doctor = deps.doctor ?? doctorClaudePreToolUse;
	const repair = deps.repair ?? repairClaudePreToolUse;

	if (sub === "install") {
		return renderMutation("install", await install(projectDir), log, logError);
	}
	if (sub === "repair") {
		const result = await repair(projectDir, { force: opts.force === true });
		return renderMutation("repair", result, log, logError);
	}
	return renderDoctor(await doctor(projectDir), log);
}
