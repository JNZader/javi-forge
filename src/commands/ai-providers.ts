import {
	convertProviderBundle,
	PROVIDER_BUNDLE_SOURCE,
	PROVIDER_BUNDLE_TARGET,
	type ProviderBundleSource,
	type ProviderBundleTarget,
	writeFreeProvidersBundle,
} from "../lib/ai-provider-bundles.js";
import {
	applyProviderScope,
	type ProviderScopeTarget,
} from "../lib/ai-provider-scope.js";
import {
	type ProviderSmokeFilters,
	runProviderSmokeTests,
} from "../lib/ai-provider-smoke.js";
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
	SMOKE_TEST: "smoke-test",
	APPLY_SCOPE: "apply-scope",
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
	reportPath?: string;
	provider?: string;
	family?: string;
	model?: string;
	statusFilter?: string;
	limit?: number;
	timeoutSeconds?: number;
	includeLocal?: boolean;
	piCommand?: string;
	envFile?: string;
	prompt?: string;
	passListPath?: string;
	piSettingsPath?: string;
	opencodeConfigPath?: string;
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
		"  javi-forge ai providers smoke-test [output-dir|report.jsonl] [--provider id] [--family text] [--model text] [--status pass|failed|...] --report <previous.jsonl>",
		"  javi-forge ai providers apply-scope <pass.tsv|report.jsonl> --target pi|opencode|both [--dry-run]",
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

function emptyToUndefined(value?: string): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function smokeFilters(
	request: AiProvidersCommandRequest,
): ProviderSmokeFilters {
	return {
		provider: emptyToUndefined(request.provider),
		family: emptyToUndefined(request.family),
		model: emptyToUndefined(request.model),
		status: emptyToUndefined(request.statusFilter),
		limit: request.limit,
		includeLocal: request.includeLocal,
	};
}

function smokeDetail(
	result: Awaited<ReturnType<typeof runProviderSmokeTests>>,
): string {
	return [
		`${result.dryRun ? "dry-run: selected" : "tested"}: ${result.selected}`,
		`ran: ${result.ran}`,
		"artifacts:",
		`  - ${result.reportPath}`,
		`  - ${result.summaryPath}`,
		`  - ${result.passListPath}`,
		"status counts:",
		renderCounts(result.counts),
	].join("\n");
}

async function smokeTest(
	request: AiProvidersCommandRequest,
	onStep: StepCallback,
): Promise<AiProvidersCommandResult> {
	report(
		onStep,
		"ai-providers-smoke-test",
		"Smoke-test AI providers",
		"running",
	);
	const result = await runProviderSmokeTests({
		modelsPath: request.inputPath,
		previousReportPath: emptyToUndefined(request.reportPath),
		outputPath: request.outputDir,
		timeoutSeconds: request.timeoutSeconds,
		piCommand: emptyToUndefined(request.piCommand),
		envFile: emptyToUndefined(request.envFile),
		prompt: emptyToUndefined(request.prompt),
		dryRun: request.dryRun,
		filters: smokeFilters(request),
	});
	report(
		onStep,
		"ai-providers-smoke-test",
		"Smoke-test AI providers",
		"done",
		smokeDetail(result),
	);
	return { status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS };
}

function normalizeScopeTarget(value?: string): ProviderScopeTarget | undefined {
	if (!value) return undefined;
	if (value === "pi" || value === "opencode" || value === "both") return value;
	throw new Error(`unknown target: ${value}`);
}

function scopeDetail(
	result: Awaited<ReturnType<typeof applyProviderScope>>,
): string {
	return [
		`${result.dryRun ? "dry-run: would update" : "updated"}: ${result.files.length}`,
		`pass models: ${result.passModels}`,
		`scoped providers: ${result.scopedProviders.join(", ") || "(none)"}`,
		"files:",
		...result.files.map((file) => `  - ${file}`),
		...(result.backups.length
			? ["backups:", ...result.backups.map((file) => `  - ${file}`)]
			: []),
		...(result.piEnabledModels !== undefined
			? [`pi enabledModels: ${result.piEnabledModels}`]
			: []),
		...(result.opencodeProviderModelCounts
			? [
					"opencode provider models:",
					renderCounts(result.opencodeProviderModelCounts),
				]
			: []),
		...(result.opencodeMissingProviders?.length
			? [
					`opencode missing providers: ${result.opencodeMissingProviders.join(", ")}`,
				]
			: []),
	].join("\n");
}

async function applyScope(
	request: AiProvidersCommandRequest,
	onStep: StepCallback,
): Promise<AiProvidersCommandResult> {
	report(
		onStep,
		"ai-providers-apply-scope",
		"Apply AI provider scope",
		"running",
	);
	const inputPath =
		emptyToUndefined(request.passListPath) ??
		emptyToUndefined(request.outputDir);
	if (!inputPath)
		throw new Error("apply-scope requires <pass.tsv|report.jsonl>");
	const result = await applyProviderScope({
		inputPath,
		target: normalizeScopeTarget(request.target),
		piSettingsPath: emptyToUndefined(request.piSettingsPath),
		opencodeConfigPath: emptyToUndefined(request.opencodeConfigPath),
		dryRun: request.dryRun,
	});
	report(
		onStep,
		"ai-providers-apply-scope",
		"Apply AI provider scope",
		"done",
		scopeDetail(result),
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
		if (request.providersAction === AI_PROVIDERS_PROVIDER_ACTION.SMOKE_TEST) {
			return await smokeTest(request, onStep);
		}
		if (request.providersAction === AI_PROVIDERS_PROVIDER_ACTION.APPLY_SCOPE) {
			return await applyScope(request, onStep);
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
