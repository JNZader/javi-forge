import {
	PI_COMMAND_STATUS,
	type PiCommandResult,
	runPiCommand,
} from "../../commands/pi.js";
import type { InitStep } from "../../types/index.js";
import type { CLI } from "./types.js";

export function piCommandExitCode(
	result: PiCommandResult,
	previous: typeof process.exitCode = undefined,
): typeof process.exitCode {
	if (previous !== undefined && previous !== 0 && previous !== "0") {
		return previous;
	}
	return result.status === PI_COMMAND_STATUS.SUCCESS ? 0 : 1;
}

function printStep(step: InitStep): void {
	if (step.status === "running") {
		console.log(`→ ${step.label}`);
		return;
	}
	const icon = step.status === "done" ? "✓" : "✗";
	console.log(`${icon} ${step.label}`);
	if (step.detail) console.log(step.detail);
}

export async function handlePi(cli: CLI): Promise<void> {
	const result = await runPiCommand(
		{
			action: cli.input[1],
			providersAction: cli.input[2],
			outputDir: cli.input[3],
			dryRun: cli.flags.dryRun,
		},
		printStep,
	);
	process.exitCode = piCommandExitCode(result, process.exitCode);
}
