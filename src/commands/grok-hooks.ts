/** Console renderer for the Grok Build global SkillGuard hook manager. */
import {
	doctorGrokSkillGuard,
	type GrokHookDoctorReport,
	type GrokHookMutationResult,
	installGrokSkillGuard,
	repairGrokSkillGuard,
} from "../lib/grok-hook-manager.js";

export type GrokHookSub = "install" | "doctor" | "repair";

export interface GrokHookCmdDeps {
	install?: typeof installGrokSkillGuard;
	doctor?: typeof doctorGrokSkillGuard;
	repair?: typeof repairGrokSkillGuard;
	homeDir?: string;
	log?: (msg: string) => void;
	logError?: (msg: string) => void;
}

function renderMutation(
	verb: string,
	result: GrokHookMutationResult,
	log: (msg: string) => void,
	logError: (msg: string) => void,
): number {
	if (!result.ok) {
		logError(`${verb} grok: refused`);
		for (const error of result.errors) logError(`  ${error}`);
		for (const backup of result.backups) logError(`  backup: ${backup}`);
		return 1;
	}
	log(`${verb} grok: ok`);
	if (result.changed.length === 0) log("changed: nothing (already up to date)");
	else for (const changed of result.changed) log(`changed: ${changed}`);
	for (const backup of result.backups) log(`backup: ${backup}`);
	return 0;
}

function renderDoctor(
	report: GrokHookDoctorReport,
	log: (msg: string) => void,
): number {
	log(`doctor grok: ${report.healthy ? "healthy" : "unhealthy"}`);
	log(`  hook: ${report.hook.state}`);
	log(`  policy: ${report.policy.state}`);
	log("  runtime: not verified (installed files only)");
	for (const remediation of report.remediation)
		log(`  remediation: ${remediation}`);
	// This is intentionally informational: local files cannot prove that Grok
	// discovered, loaded, or invoked a plugin in a real session.
	return 0;
}

export async function runGrokHookCommand(
	sub: GrokHookSub,
	_cwd: string,
	opts: { force?: boolean },
	deps: GrokHookCmdDeps = {},
): Promise<number> {
	const log = deps.log ?? ((message: string) => console.log(message));
	const logError =
		deps.logError ?? ((message: string) => console.error(message));
	const home = deps.homeDir;
	if (sub === "install")
		return renderMutation(
			"install",
			await (deps.install ?? installGrokSkillGuard)(home),
			log,
			logError,
		);
	if (sub === "repair")
		return renderMutation(
			"repair",
			await (deps.repair ?? repairGrokSkillGuard)(home, {
				force: opts.force === true,
			}),
			log,
			logError,
		);
	return renderDoctor(await (deps.doctor ?? doctorGrokSkillGuard)(home), log);
}
