import {
	convertProviderBundle,
	PROVIDER_BUNDLE_SOURCE,
	PROVIDER_BUNDLE_TARGET,
	type ProviderBundleSource,
	type ProviderBundleTarget,
	writeFreeProvidersBundle,
} from "../lib/ai-provider-bundles.js";
import {
	applyModelAssignmentProfileOverlay,
	rollbackModelAssignmentProfileOverlay,
} from "../lib/ai-provider-profile-apply.js";
import {
	MODEL_ASSIGNMENT_PRESET,
	MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET,
	type ModelAssignmentProfileExportTarget,
	writeModelAssignmentProfileExport,
	writeModelAssignmentProfiles,
} from "../lib/ai-provider-profiles.js";
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
	PROFILE_PLAN: "profile-plan",
	PROFILE_EXPORT: "profile-export",
	PROFILE_APPLY: "profile-apply",
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
	runtime?: string;
	includeLocal?: boolean;
	piCommand?: string;
	opencodeCommand?: string;
	opencodeAgent?: string;
	smokeCwd?: string;
	envFile?: string;
	prompt?: string;
	passListPath?: string;
	profilePlanPath?: string;
	overlayPath?: string;
	rollbackPath?: string;
	preset?: string;
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
		"  javi-forge ai providers smoke-test [output-dir|report.jsonl] [--runtime pi|opencode] [--provider id] [--family text] [--model text] [--status pass|failed|...] [--report <previous.jsonl>]",
		"  javi-forge ai providers apply-scope <pass.tsv|report.jsonl> --target pi|opencode|both [--dry-run]",
		`  javi-forge ai providers profile-plan <output-dir> --pass-list <pass.tsv|report.jsonl> [--preset ${MODEL_ASSIGNMENT_PRESET.COMMUNITY_BACKEND_OPENCODE_GO}] [--limit candidates-per-profile] [--dry-run]`,
		"  javi-forge ai providers profile-export <profile-plan.json> [output-dir] --target pi|opencode|codex|both [--dry-run]",
		"  javi-forge ai providers profile-apply <overlay.json> --pass-list <pass.tsv|report.jsonl> --target pi|opencode --pi-settings|--opencode-config <path> [--dry-run]",
		"  javi-forge ai providers profile-apply --rollback <backup-path> --target pi|opencode --pi-settings|--opencode-config <path>",
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

function normalizeSmokeRuntime(value?: string): "opencode" | "pi" | undefined {
	if (!value) return undefined;
	if (value === "pi" || value === "opencode") return value;
	throw new Error(`unknown runtime: ${value}`);
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
		runtime: normalizeSmokeRuntime(request.runtime),
		piCommand: emptyToUndefined(request.piCommand),
		opencodeCommand: emptyToUndefined(request.opencodeCommand),
		opencodeAgent: emptyToUndefined(request.opencodeAgent),
		smokeCwd: emptyToUndefined(request.smokeCwd),
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

function profilePlanDetail(
	result: Awaited<ReturnType<typeof writeModelAssignmentProfiles>>,
): string {
	return [
		`${result.dryRun ? "dry-run: would generate" : "generated"}:`,
		...result.files.map((file) => `  - ${file}`),
		`pass models: ${result.passModels}`,
		"profile candidates:",
		renderCounts(result.profileCounts),
		"profile primaries:",
		...Object.entries(result.profilePrimaries).map(
			([profile, primary]) => `  - ${profile}: ${primary ?? "n/a"}`,
		),
		...(result.warnings.length
			? ["warnings:", ...result.warnings.map((warning) => `  - ${warning}`)]
			: []),
		"secrets: none written; runtime configs unchanged",
	].join("\n");
}

async function profilePlan(
	request: AiProvidersCommandRequest,
	onStep: StepCallback,
): Promise<AiProvidersCommandResult> {
	report(
		onStep,
		"ai-providers-profile-plan",
		"Plan AI model profiles",
		"running",
	);
	const outputDir = emptyToUndefined(request.outputDir);
	if (!outputDir) throw new Error("profile-plan requires <output-dir>");
	const inputPath =
		emptyToUndefined(request.passListPath) ??
		emptyToUndefined(request.reportPath);
	if (!inputPath)
		throw new Error(
			"profile-plan requires --pass-list <pass.tsv|report.jsonl>",
		);
	const result = await writeModelAssignmentProfiles({
		inputPath,
		outputDir,
		maxCandidatesPerProfile: request.limit,
		preset: emptyToUndefined(request.preset),
		dryRun: request.dryRun,
	});
	report(
		onStep,
		"ai-providers-profile-plan",
		"Plan AI model profiles",
		"done",
		profilePlanDetail(result),
	);
	return { status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS };
}

function normalizeProfileExportTarget(
	value?: string,
): ModelAssignmentProfileExportTarget {
	if (!value)
		throw new Error("profile-export requires --target pi|opencode|codex|both");
	if (
		value === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.PI ||
		value === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.OPENCODE ||
		value === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.CODEX ||
		value === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.BOTH
	) {
		return value;
	}
	throw new Error(`unknown target: ${value}`);
}

function profileExportDetail(
	result: Awaited<ReturnType<typeof writeModelAssignmentProfileExport>>,
): string {
	return [
		`${result.dryRun ? "dry-run: would generate" : "generated"}: ${result.files.length}`,
		"files:",
		...result.files.map((file) => `  - ${file}`),
		...(result.warnings.length
			? ["warnings:", ...result.warnings.map((warning) => `  - ${warning}`)]
			: []),
		"advisory previews only; runtime configs, secrets, auth, and provider state unchanged",
	].join("\n");
}

async function profileExport(
	request: AiProvidersCommandRequest,
	onStep: StepCallback,
): Promise<AiProvidersCommandResult> {
	report(
		onStep,
		"ai-providers-profile-export",
		"Export AI model profile previews",
		"running",
	);
	const inputPath = emptyToUndefined(request.profilePlanPath);
	if (!inputPath)
		throw new Error("profile-export requires <profile-plan.json>");
	const result = await writeModelAssignmentProfileExport({
		inputPath,
		outputDir: emptyToUndefined(request.outputDir),
		target: normalizeProfileExportTarget(emptyToUndefined(request.target)),
		dryRun: request.dryRun,
	});
	report(
		onStep,
		"ai-providers-profile-export",
		"Export AI model profile previews",
		"done",
		profileExportDetail(result),
	);
	return { status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS };
}

function normalizeProfileApplyTarget(value?: string): "pi" | "opencode" {
	if (!value) throw new Error("profile-apply requires --target pi|opencode");
	if (value === "both") {
		throw new Error("profile-apply refuses --target both");
	}
	if (value === "codex") {
		throw new Error("profile-apply refuses --target codex");
	}
	if (value === "pi" || value === "opencode") return value;
	throw new Error(`unknown target: ${value}`);
}

function profileApplyDetail(
	result: Awaited<ReturnType<typeof applyModelAssignmentProfileOverlay>>,
): string {
	return [
		`${result.dryRun ? "dry-run: would update" : "updated"}: ${result.files.length}`,
		...(result.passModels !== undefined
			? [`pass models: ${result.passModels}`]
			: []),
		"files:",
		...result.files.map((file) => `  - ${file}`),
		...(result.backups.length
			? ["backups:", ...result.backups.map((file) => `  - ${file}`)]
			: []),
		"secrets: none written; provider auth unchanged",
	].join("\n");
}

function requireExplicitRuntimePath(
	target: "pi" | "opencode",
	request: AiProvidersCommandRequest,
): { piSettingsPath?: string; opencodeConfigPath?: string } {
	const piSettingsPath = emptyToUndefined(request.piSettingsPath);
	const opencodeConfigPath = emptyToUndefined(request.opencodeConfigPath);
	if (target === "pi" && !piSettingsPath) {
		throw new Error("profile-apply requires --pi-settings <path>");
	}
	if (target === "opencode" && !opencodeConfigPath) {
		throw new Error("profile-apply requires --opencode-config <path>");
	}
	return { piSettingsPath, opencodeConfigPath };
}

async function profileApply(
	request: AiProvidersCommandRequest,
	onStep: StepCallback,
): Promise<AiProvidersCommandResult> {
	report(
		onStep,
		"ai-providers-profile-apply",
		"Apply AI model profile overlay",
		"running",
	);
	const target = normalizeProfileApplyTarget(emptyToUndefined(request.target));
	const rollbackPath = emptyToUndefined(request.rollbackPath);
	const runtimePaths = requireExplicitRuntimePath(target, request);
	const result = rollbackPath
		? await rollbackModelAssignmentProfileOverlay({
				backupPath: rollbackPath,
				target,
				...runtimePaths,
				dryRun: request.dryRun,
			})
		: await applyModelAssignmentProfileOverlay({
				overlayPath:
					emptyToUndefined(request.overlayPath) ??
					emptyToUndefined(request.outputDir),
				passListPath:
					emptyToUndefined(request.passListPath) ??
					emptyToUndefined(request.reportPath),
				target,
				...runtimePaths,
				dryRun: request.dryRun,
			});
	report(
		onStep,
		"ai-providers-profile-apply",
		"Apply AI model profile overlay",
		"done",
		profileApplyDetail(result),
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
		if (request.providersAction === AI_PROVIDERS_PROVIDER_ACTION.PROFILE_PLAN) {
			return await profilePlan(request, onStep);
		}
		if (
			request.providersAction === AI_PROVIDERS_PROVIDER_ACTION.PROFILE_EXPORT
		) {
			return await profileExport(request, onStep);
		}
		if (
			request.providersAction === AI_PROVIDERS_PROVIDER_ACTION.PROFILE_APPLY
		) {
			return await profileApply(request, onStep);
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
