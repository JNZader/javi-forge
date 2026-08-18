/**
 * `javi-forge hooks <install|doctor|repair> claude` — console-only renderer for
 * the already-tested Claude PreToolUse guard library (Slice 4a). It wires the
 * three lib fns to human output + exit codes; it adds NO new security logic and
 * never touches `runTransaction`/secure-fs directly.
 *
 * Honest-execution gate (Slice 4b): the doctor renderer prints the real
 * `execution` verdict computed by the library — `runnable`, `blocked`, or
 * `inconclusive` — plus its `blockers`, `unknownSources`, and the constant
 * `residual` caveats, in committed stable order. The doctor exit code follows
 * `execution.status` (runnable → 0, blocked → 1, inconclusive → 2), independent
 * of `report.healthy`. The renderer never fabricates `runnable`: the library
 * only reports it when every relevant local source read clear and the guard is
 * current.
 */

import {
	type ClaudeHookDoctorReport,
	type ClaudeHookMutationResult,
	doctorClaudePreToolUse,
	installClaudePreToolUse,
	repairClaudePreToolUse,
} from "../lib/claude-hook-manager.js";
import { remediationForMessage } from "../lib/secure-refusal-remediation.js";

export type ClaudeHookSub = "install" | "doctor" | "repair";

/** Injectable seams for tests; each defaults to the real implementation. */
export interface ClaudeHookCmdDeps {
	install?: typeof installClaudePreToolUse;
	doctor?: typeof doctorClaudePreToolUse;
	repair?: typeof repairClaudePreToolUse;
	log?: (msg: string) => void;
	logError?: (msg: string) => void;
}

/**
 * Warnings are NON-BLOCKING notices, so they go to stdout under their own
 * heading — never to the error stream and never into the exit code.
 */
function renderWarnings(
	warnings: readonly string[],
	log: (m: string) => void,
): void {
	if (warnings.length === 0) return;
	log("warnings:");
	for (const w of warnings) log(`  ${w}`);
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
		renderWarnings(result.warnings, log);
		return 0;
	}

	logError(`${verb} claude: refused`);
	// A refusal whose detail maps to a remediation is never rendered bare: the
	// mapping is a CLI-layer lookup, so the adapter's refusal codes stay stable.
	for (const e of result.errors) {
		logError(`  ${e}`);
		const remediation = remediationForMessage(e);
		if (remediation) logError(`    → ${remediation}`);
	}
	renderWarnings(result.warnings, log);
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

	// The node-on-PATH row is ALWAYS printed (satisfied included) and is always
	// labelled a heuristic: this process' PATH only proxies the PATH Claude Code
	// will use to spawn the exec-form handler.
	const onPath = report.nodeOnPath;
	const onPathDetail =
		onPath.status === "resolved"
			? ` ${onPath.version}`
			: onPath.status === "unknown"
				? ` — ${onPath.detail}`
				: "";
	log(
		`  node-on-PATH: ${onPath.status}${onPathDetail} (heuristic: this process' PATH)`,
	);

	const execution = report.execution;
	log(`  execution: ${execution.status}`);
	if (execution.blockers.length > 0) {
		log("  blockers:");
		for (const b of execution.blockers) log(`    - ${b}`);
	}
	if (execution.unknownSources.length > 0) {
		log("  unknown-sources:");
		for (const u of execution.unknownSources) log(`    - ${u}`);
	}
	if (execution.residual.length > 0) {
		log("  execution-residual:");
		for (const r of execution.residual) log(`    - ${r}`);
	}

	// Install-capability is its OWN section, always printed so an absent adapter
	// is never silent — and it never changes the exit code, which follows
	// `execution.status` alone.
	const acl = report.installCapability.acl;
	const aclDetail = "detail" in acl ? ` — ${acl.detail}` : "";
	log(`  acl-capability: ${acl.status} (${acl.tool})${aclDetail}`);
	if (report.installCapability.remediation) {
		log(`    → ${report.installCapability.remediation}`);
	}

	log(`  host-residual: ${report.hostResidual}`);
	if (report.remediation.length > 0) {
		log("  remediation:");
		for (const r of report.remediation) log(`    - ${r}`);
	}

	// The doctor exit code follows the effective-execution verdict, independent
	// of component health: runnable → 0, blocked → 1, inconclusive → 2.
	if (execution.status === "blocked") return 1;
	if (execution.status === "inconclusive") return 2;
	return 0;
}

/**
 * Run one Claude-hook subcommand against `projectDir`. Returns the process exit
 * code (the dispatcher calls `process.exit`, not this fn):
 *   - install/repair: 0 when `ok`, 1 on refusal/failure.
 *   - doctor: follows `execution.status` — runnable → 0, blocked → 1,
 *     inconclusive → 2.
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
