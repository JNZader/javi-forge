/**
 * `javi-forge hooks <install|doctor|repair> codex` — console-only renderer for
 * the Codex PreToolUse guard library (agent-agnostic slice 2). It wires the
 * install/doctor/repair lib fns to human output + exit codes; it adds NO new
 * security logic and never touches `runTransaction`/secure-fs directly.
 *
 * Doctor exit code follows the effective-execution verdict (runnable → 0,
 * blocked → 1, inconclusive → 2), independent of any component health — the same
 * honest-execution contract as the Claude renderer. The UNTRUSTED state is a
 * `blocked` verdict (an untrusted Codex hook is silently skipped), so a fresh
 * install correctly reports blocked until the user grants trust.
 */

import {
	type CodexHookDoctorReport,
	type CodexHookMutationResult,
	doctorCodexPreToolUse,
	installCodexPreToolUse,
	repairCodexPreToolUse,
} from "../lib/codex-hook-manager.js";

export type CodexHookSub = "install" | "doctor" | "repair";

export interface CodexHookCmdDeps {
	install?: typeof installCodexPreToolUse;
	doctor?: typeof doctorCodexPreToolUse;
	repair?: typeof repairCodexPreToolUse;
	homeDir?: string;
	log?: (msg: string) => void;
	logError?: (msg: string) => void;
}

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
	result: CodexHookMutationResult,
	log: (m: string) => void,
	logError: (m: string) => void,
): number {
	if (result.ok) {
		log(`${verb} codex: ok`);
		if (result.changed.length > 0) {
			log("changed:");
			for (const p of result.changed) log(`  ${p}`);
		} else {
			log("changed: nothing (already up to date)");
		}
		log(`trust: ${result.report.trust.state}`);
		if (result.report.trust.state === "untrusted") {
			log(`  → ${result.report.trust.grantCommand}`);
		}
		renderWarnings(result.warnings, log);
		return 0;
	}

	logError(`${verb} codex: refused`);
	for (const e of result.errors) logError(`  ${e}`);
	renderWarnings(result.warnings, log);
	return 1;
}

function renderDoctor(
	report: CodexHookDoctorReport,
	log: (m: string) => void,
): number {
	log(`doctor codex: ${report.healthy ? "healthy" : "unhealthy"}`);
	log(`  hooks.json: ${report.hooksJson.state}`);
	log(
		`  config:    [features] hooks=${report.config.featuresHooks} (readable: ${report.config.readable})`,
	);
	log(`  trust:     ${report.trust.state}`);
	log(`  asset:     ${report.asset.state}`);
	log(
		`  node:      ${report.node.version ?? "unavailable"} (min-satisfied: ${report.node.satisfiesMinimum})`,
	);
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

	log(`  execution: ${report.execution.status}`);
	if (report.execution.blockers.length > 0) {
		log("  blockers:");
		for (const b of report.execution.blockers) log(`    - ${b}`);
	}
	if (report.execution.unknownSources.length > 0) {
		log("  unknown-sources:");
		for (const u of report.execution.unknownSources) log(`    - ${u}`);
	}
	if (report.execution.residual.length > 0) {
		log("  execution-residual:");
		for (const r of report.execution.residual) log(`    - ${r}`);
	}
	if (report.remediation.length > 0) {
		log("  remediation:");
		for (const r of report.remediation) log(`    - ${r}`);
	}

	if (report.execution.status === "blocked") return 1;
	if (report.execution.status === "inconclusive") return 2;
	return 0;
}

export async function runCodexHookCommand(
	sub: CodexHookSub,
	_cwd: string,
	opts: { force?: boolean },
	deps: CodexHookCmdDeps = {},
): Promise<number> {
	const log = deps.log ?? ((m: string) => console.log(m));
	const logError = deps.logError ?? ((m: string) => console.error(m));
	const install = deps.install ?? installCodexPreToolUse;
	const doctor = deps.doctor ?? doctorCodexPreToolUse;
	const repair = deps.repair ?? repairCodexPreToolUse;
	// Codex config is user-global (~/.codex). `cwd` is accepted for CLI symmetry
	// with the Claude command; the home dir is what the manager operates on.
	const home = deps.homeDir;

	if (sub === "install") {
		return renderMutation("install", await install(home), log, logError);
	}
	if (sub === "repair") {
		const result = await repair(home, { force: opts.force === true });
		return renderMutation("repair", result, log, logError);
	}
	return renderDoctor(await doctor(home), log);
}
