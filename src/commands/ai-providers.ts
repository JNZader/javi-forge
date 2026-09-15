import {
	convertProviderBundle,
	PROVIDER_BUNDLE_SOURCE,
	PROVIDER_BUNDLE_TARGET,
	type ProviderBundleSource,
	type ProviderBundleTarget,
	writeFreeProvidersBundle,
} from "../lib/ai-provider-bundles.js";
import type { InitStep } from "../types/index.js";

type StepCallback = (step: InitStep) => void;

export const AI_PROVIDERS_COMMAND_STATUS = {
	SUCCESS: "success",
	FAILURE: "failure",
} as const;

export type AiProvidersCommandStatus =
	(typeof AI_PROVIDERS_COMMAND_STATUS)[keyof typeof AI_PROVIDERS_COMMAND_STATUS];

export const AI_PROVIDERS_ACTION = {
	PROVIDERS: "providers",
} as const;

export const AI_PROVIDERS_PROVIDER_ACTION = {
	EXPORT_FREE: "export-free",
	CONVERT: "convert",
} as const;

export interface AiProvidersCommandResult {
	status: AiProvidersCommandStatus;
}

export interface AiProvidersCommandRequest {
	action?: string;
	providersAction?: string;
	outputDir?: string;
	target?: string;
	from?: string;
	to?: string;
	inputPath?: string;
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

function normalizeTarget(value?: string): ProviderBundleTarget {
	if (!value) return PROVIDER_BUNDLE_TARGET.BOTH;
	if (
		value === PROVIDER_BUNDLE_TARGET.PI ||
		value === PROVIDER_BUNDLE_TARGET.OPENCODE ||
		value === PROVIDER_BUNDLE_TARGET.BOTH
	) {
		return value;
	}
	throw new Error(`unknown target: ${value}`);
}

function normalizeSource(
	value: string | undefined,
	label: string,
): ProviderBundleSource {
	if (
		value === PROVIDER_BUNDLE_SOURCE.PI ||
		value === PROVIDER_BUNDLE_SOURCE.OPENCODE
	) {
		return value;
	}
	throw new Error(`unknown ${label}: ${value ?? ""}`);
}

function usage(): string {
	return [
		"Usage:",
		"  javi-forge ai providers export-free [output-dir] --target pi|opencode|both",
		"  javi-forge ai providers convert <pi|opencode> <pi|opencode> [output-dir] --config <input-path>",
	].join("\n");
}

function successDetail(
	prefix: string,
	files: string[],
	counts: Record<string, number>,
): string {
	return [
		`${prefix}:`,
		...files.map((file) => `  - ${file}`),
		"provider models:",
		renderCounts(counts),
		"secrets: none written; merge generated provider metadata manually",
	].join("\n");
}

async function exportFree(
	request: AiProvidersCommandRequest,
	onStep: StepCallback,
): Promise<AiProvidersCommandResult> {
	const target = normalizeTarget(request.target);
	report(
		onStep,
		"ai-providers-export-free",
		"Export AI free providers",
		"running",
	);
	const result = await writeFreeProvidersBundle({
		outputDir: request.outputDir,
		target,
		dryRun: request.dryRun,
	});
	report(
		onStep,
		"ai-providers-export-free",
		"Export AI free providers",
		"done",
		successDetail(
			result.wrote ? "generated" : "dry-run: would generate",
			result.files,
			result.providerModelCounts,
		),
	);
	return { status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS };
}

async function convert(
	request: AiProvidersCommandRequest,
	onStep: StepCallback,
): Promise<AiProvidersCommandResult> {
	const from = normalizeSource(request.from, "source");
	const to = normalizeSource(request.to, "target");
	report(onStep, "ai-providers-convert", "Convert AI providers", "running");
	const result = await convertProviderBundle({
		from,
		to,
		inputPath: request.inputPath,
		outputDir: request.outputDir,
		dryRun: request.dryRun,
	});
	report(
		onStep,
		"ai-providers-convert",
		"Convert AI providers",
		"done",
		successDetail(
			result.wrote ? "generated" : "dry-run: would generate",
			result.files,
			result.providerModelCounts,
		),
	);
	return { status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS };
}

export async function runAiProvidersCommand(
	request: AiProvidersCommandRequest,
	onStep: StepCallback,
): Promise<AiProvidersCommandResult> {
	if (request.action !== AI_PROVIDERS_ACTION.PROVIDERS) {
		report(onStep, "ai-providers-usage", "AI providers", "error", usage());
		return { status: AI_PROVIDERS_COMMAND_STATUS.FAILURE };
	}

	try {
		if (request.providersAction === AI_PROVIDERS_PROVIDER_ACTION.EXPORT_FREE) {
			return await exportFree(request, onStep);
		}
		if (request.providersAction === AI_PROVIDERS_PROVIDER_ACTION.CONVERT) {
			return await convert(request, onStep);
		}
		report(onStep, "ai-providers-usage", "AI providers", "error", usage());
		return { status: AI_PROVIDERS_COMMAND_STATUS.FAILURE };
	} catch (error) {
		report(
			onStep,
			"ai-providers-error",
			"AI providers",
			"error",
			error instanceof Error ? error.message : String(error),
		);
		return { status: AI_PROVIDERS_COMMAND_STATUS.FAILURE };
	}
}
