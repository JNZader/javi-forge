/** Console renderer for the Cursor global SkillGuard hook manager. */
import {
	type CursorHookDoctorReport,
	type CursorHookMutationResult,
	doctorCursorSkillGuard,
	installCursorSkillGuard,
	repairCursorSkillGuard,
} from "../lib/cursor-hook-manager.js";

export type CursorHookSub = "install" | "doctor" | "repair";

export interface CursorHookCmdDeps {
	install?: typeof installCursorSkillGuard;
	doctor?: typeof doctorCursorSkillGuard;
	repair?: typeof repairCursorSkillGuard;
	homeDir?: string;
	log?: (msg: string) => void;
	logError?: (msg: string) => void;
}

function renderMutation(
	verb: string,
	result: CursorHookMutationResult,
	log: (msg: string) => void,
	logError: (msg: string) => void,
): number {
	if (!result.ok) {
		logError(`${verb} cursor: refused`);
		for (const error of result.errors) logError(`  ${error}`);
		for (const backup of result.backups) logError(`  backup: ${backup}`);
		return 1;
	}
	log(`${verb} cursor: ok`);
	if (result.changed.length === 0) log("changed: nothing (already up to date)");
	else for (const changed of result.changed) log(`changed: ${changed}`);
	for (const backup of result.backups) log(`backup: ${backup}`);
	return 0;
}

function renderDoctor(
	report: CursorHookDoctorReport,
	log: (msg: string) => void,
): number {
	log(`doctor cursor: ${report.healthy ? "healthy" : "unhealthy"}`);
	log(`  hooks.json: ${report.hooksJson.state}`);
	log(`  policy: ${report.policy.state}`);
	log(`  execution: ${report.execution.status}`);
	for (const unknown of report.execution.unknownSources) {
		log(`  unknown: ${unknown}`);
	}
	for (const residual of report.execution.residual) {
		log(`  residual: ${residual}`);
	}
	for (const remediation of report.remediation)
		log(`  remediation: ${remediation}`);
	if (report.execution.status === "blocked") return 1;
	if (report.execution.status === "inconclusive") return 2;
	return 0;
}

export async function runCursorHookCommand(
	sub: CursorHookSub,
	_cwd: string,
	opts: { force?: boolean },
	deps: CursorHookCmdDeps = {},
): Promise<number> {
	const log = deps.log ?? ((message: string) => console.log(message));
	const logError =
		deps.logError ?? ((message: string) => console.error(message));
	const home = deps.homeDir;
	if (sub === "install")
		return renderMutation(
			"install",
			await (deps.install ?? installCursorSkillGuard)(home),
			log,
			logError,
		);
	if (sub === "repair")
		return renderMutation(
			"repair",
			await (deps.repair ?? repairCursorSkillGuard)(home, {
				force: opts.force === true,
			}),
			log,
			logError,
		);
	return renderDoctor(await (deps.doctor ?? doctorCursorSkillGuard)(home), log);
}
