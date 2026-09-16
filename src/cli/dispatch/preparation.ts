import {
	PREPARATION_COMMAND_STATUS,
	type PreparationCommandResult,
	runPreparationCommand,
} from "../../commands/preparation.js";
import type { InitStep } from "../../types/index.js";
import type { CLI } from "./types.js";

export function preparationCommandExitCode(
	result: PreparationCommandResult,
	previous: typeof process.exitCode = undefined,
): typeof process.exitCode {
	if (previous !== undefined && previous !== 0 && previous !== "0") {
		return previous;
	}
	return result.status === PREPARATION_COMMAND_STATUS.SUCCESS ? 0 : 1;
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

export async function handlePreparation(cli: CLI): Promise<void> {
	const json = cli.flags.json;
	const result = await runPreparationCommand(
		{
			action: cli.input[1],
			binding: cli.flags.binding,
			configPath: cli.flags.config,
			expiresAt: cli.flags.expiresAt,
			outputsPath: cli.flags.outputs,
			outputPath: cli.flags.output,
			force: cli.flags.force,
			issuedAt: cli.flags.issuedAt,
			json,
			nonce: cli.flags.nonce,
		},
		json ? () => {} : printStep,
	);
	if (json) {
		console.log(JSON.stringify(result, null, 2));
	}
	process.exitCode = preparationCommandExitCode(result, process.exitCode);
}
