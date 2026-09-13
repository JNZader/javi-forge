/** Console renderer for the OpenCode SkillGuard global plugin manager. */
import {
	doctorOpenCodeSkillGuard,
	installOpenCodeSkillGuard,
	type OpenCodeHookDoctorReport,
	type OpenCodeHookMutationResult,
	repairOpenCodeSkillGuard,
} from "../lib/opencode-hook-manager.js";

export type OpenCodeHookSub = "install" | "doctor" | "repair";

export interface OpenCodeHookCmdDeps {
	install?: typeof installOpenCodeSkillGuard;
	doctor?: typeof doctorOpenCodeSkillGuard;
	repair?: typeof repairOpenCodeSkillGuard;
	homeDir?: string;
	log?: (msg: string) => void;
	logError?: (msg: string) => void;
}

function renderMutation(
	verb: string,
	result: OpenCodeHookMutationResult,
	log: (msg: string) => void,
	logError: (msg: string) => void,
): number {
	if (!result.ok) {
		logError(`${verb} opencode: refused`);
		for (const error of result.errors) logError(`  ${error}`);
		return 1;
	}
	log(`${verb} opencode: ok`);
	if (result.changed.length === 0) log("changed: nothing (already up to date)");
	else for (const changed of result.changed) log(`changed: ${changed}`);
	return 0;
}

function renderDoctor(
	report: OpenCodeHookDoctorReport,
	log: (msg: string) => void,
): number {
	log(`doctor opencode: ${report.healthy ? "healthy" : "unhealthy"}`);
	log(`  plugin: ${report.plugin.state}`);
	log(`  policy: ${report.policy.state}`);
	log("  runtime: not verified (installed files only)");
	for (const remediation of report.remediation)
		log(`  remediation: ${remediation}`);
	// This is intentionally informational: local files cannot prove that OpenCode
	// discovered, loaded, or invoked a plugin in a real session.
	return 0;
}

export async function runOpenCodeHookCommand(
	sub: OpenCodeHookSub,
	_cwd: string,
	opts: { force?: boolean },
	deps: OpenCodeHookCmdDeps = {},
): Promise<number> {
	const log = deps.log ?? ((message: string) => console.log(message));
	const logError =
		deps.logError ?? ((message: string) => console.error(message));
	const home = deps.homeDir;
	if (sub === "install")
		return renderMutation(
			"install",
			await (deps.install ?? installOpenCodeSkillGuard)(home),
			log,
			logError,
		);
	if (sub === "repair")
		return renderMutation(
			"repair",
			await (deps.repair ?? repairOpenCodeSkillGuard)(home, {
				force: opts.force === true,
			}),
			log,
			logError,
		);
	return renderDoctor(
		await (deps.doctor ?? doctorOpenCodeSkillGuard)(home),
		log,
	);
}
