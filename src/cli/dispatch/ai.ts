import {
	AI_PROVIDERS_COMMAND_STATUS,
	type AiProvidersCommandResult,
	runAiProvidersCommand,
} from "../../commands/ai-providers.js";
import type { InitStep } from "../../types/index.js";
import type { CLI } from "./types.js";

export function aiCommandExitCode(
	result: AiProvidersCommandResult,
	previous: typeof process.exitCode = undefined,
): typeof process.exitCode {
	if (previous !== undefined && previous !== 0 && previous !== "0") {
		return previous;
	}
	return result.status === AI_PROVIDERS_COMMAND_STATUS.SUCCESS ? 0 : 1;
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

export async function handleAi(cli: CLI): Promise<void> {
	const providersAction = cli.input[2];
	const outputDir = providersAction === "convert" ? cli.input[5] : cli.input[3];
	const limit = cli.flags.limit > 0 ? cli.flags.limit : undefined;
	const result = await runAiProvidersCommand(
		{
			action: cli.input[1],
			providersAction,
			from: providersAction === "convert" ? cli.input[3] : undefined,
			to: providersAction === "convert" ? cli.input[4] : undefined,
			outputDir,
			target: cli.flags.target,
			inputPath: cli.flags.config,
			reportPath: cli.flags.report,
			provider: cli.flags.provider,
			family: cli.flags.family,
			model: cli.flags.model,
			statusFilter: cli.flags.status,
			limit,
			timeoutSeconds: cli.flags.timeout,
			runtime: cli.flags.runtime,
			includeLocal: cli.flags.includeLocal,
			piCommand: cli.flags.piCommand,
			opencodeCommand: cli.flags.opencodeCommand,
			envFile: cli.flags.envFile,
			prompt: cli.flags.prompt,
			passListPath: cli.flags.passList,
			piSettingsPath: cli.flags.piSettings,
			opencodeConfigPath: cli.flags.opencodeConfig,
			dryRun: cli.flags.dryRun,
		},
		printStep,
	);
	process.exitCode = aiCommandExitCode(result, process.exitCode);
}
