import { writePiFreeProvidersBundle } from "../lib/pi-free-providers.js";
import type { InitStep } from "../types/index.js";

type StepCallback = (step: InitStep) => void;

export const PI_COMMAND_STATUS = {
	SUCCESS: "success",
	FAILURE: "failure",
} as const;

export type PiCommandStatus =
	(typeof PI_COMMAND_STATUS)[keyof typeof PI_COMMAND_STATUS];

export const PI_COMMAND_ACTION = {
	PROVIDERS: "providers",
} as const;

export const PI_PROVIDERS_ACTION = {
	EXPORT_FREE: "export-free",
} as const;

export interface PiCommandResult {
	status: PiCommandStatus;
}

export interface PiCommandRequest {
	action?: string;
	providersAction?: string;
	outputDir?: string;
	dryRun: boolean;
}

function report(
	onStep: StepCallback,
	id: string,
	label: string,
	status: InitStep["status"],
	detail?: string,
) {
	onStep({ id, label, status, detail });
}

function renderCounts(counts: Record<string, number>): string {
	return Object.entries(counts)
		.map(([provider, count]) => `${provider}: ${count}`)
		.join("\n");
}

export async function runPiCommand(
	request: PiCommandRequest,
	onStep: StepCallback,
): Promise<PiCommandResult> {
	const action = request.action;
	const providersAction = request.providersAction;
	if (
		action !== PI_COMMAND_ACTION.PROVIDERS ||
		providersAction !== PI_PROVIDERS_ACTION.EXPORT_FREE
	) {
		report(
			onStep,
			"pi-usage",
			"Pi providers",
			"error",
			"Usage: javi-forge pi providers export-free [output-dir]",
		);
		return { status: PI_COMMAND_STATUS.FAILURE };
	}

	report(
		onStep,
		"pi-providers-export-free",
		"Export Pi free providers",
		"running",
	);
	try {
		const result = await writePiFreeProvidersBundle({
			outputDir: request.outputDir,
			dryRun: request.dryRun,
		});
		const prefix = result.wrote ? "generated" : "dry-run: would generate";
		report(
			onStep,
			"pi-providers-export-free",
			"Export Pi free providers",
			"done",
			[
				`${prefix} ${result.configPath}`,
				`README: ${result.readmePath}`,
				`env example: ${result.envExamplePath}`,
				"provider models:",
				renderCounts(result.providerModelCounts),
				"secrets: none written; OpenRouter uses $OPENROUTER_API_KEY if configured",
			].join("\n"),
		);
		return { status: PI_COMMAND_STATUS.SUCCESS };
	} catch (error) {
		report(
			onStep,
			"pi-providers-export-free",
			"Export Pi free providers",
			"error",
			error instanceof Error ? error.message : String(error),
		);
		return { status: PI_COMMAND_STATUS.FAILURE };
	}
}
