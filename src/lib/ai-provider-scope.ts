import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

export const PROVIDER_SCOPE_TARGET = {
	PI: "pi",
	OPENCODE: "opencode",
	BOTH: "both",
} as const;

export type ProviderScopeTarget =
	(typeof PROVIDER_SCOPE_TARGET)[keyof typeof PROVIDER_SCOPE_TARGET];

export interface ProviderScopeModel {
	provider: string;
	model: string;
	name?: string;
}

export interface ProviderScopeInput {
	passModels: ProviderScopeModel[];
	scopedProviders: string[];
	sourceKind: "pass-list" | "report";
}

export interface ApplyProviderScopeOptions {
	inputPath: string;
	target?: ProviderScopeTarget;
	piSettingsPath?: string;
	opencodeConfigPath?: string;
	dryRun?: boolean;
	now?: Date;
}

export interface ApplyProviderScopeResult {
	inputPath: string;
	target: ProviderScopeTarget;
	dryRun: boolean;
	wrote: boolean;
	passModels: number;
	scopedProviders: string[];
	files: string[];
	backups: string[];
	piEnabledModels?: number;
	opencodeProviderModelCounts?: Record<string, number>;
	opencodeMissingProviders?: string[];
}

interface SmokeReportRow {
	provider?: unknown;
	model?: unknown;
	name?: unknown;
	status?: unknown;
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePath(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return isAbsolute(path) ? path : resolve(path);
}

function parseJsonObject(content: string, path: string): JsonRecord {
	const parsed: unknown = JSON.parse(content);
	if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`);
	return parsed;
}

function routeKey(provider: string, model: string): string {
	return `${provider}\u0000${model}`;
}

function modelRef(model: ProviderScopeModel): string {
	return `${model.provider}/${model.model}`;
}

function uniqueModels(models: ProviderScopeModel[]): ProviderScopeModel[] {
	const byKey = new Map<string, ProviderScopeModel>();
	for (const model of models) {
		byKey.set(routeKey(model.provider, model.model), model);
	}
	return [...byKey.values()].sort((a, b) =>
		modelRef(a).localeCompare(modelRef(b)),
	);
}

function uniqueProviders(providers: Iterable<string>): string[] {
	return [...new Set(providers)].sort();
}

function parseTsvPassList(content: string): ProviderScopeInput {
	const passModels: ProviderScopeModel[] = [];
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const [provider, model, name] = line.split("\t");
		if (provider === "provider" && model === "model") continue;
		if (!provider?.trim() || !model?.trim()) {
			throw new Error(
				"provider pass-list rows must be TSV: provider<TAB>model",
			);
		}
		passModels.push({
			provider: provider.trim(),
			model: model.trim(),
			name: name?.trim() || undefined,
		});
	}
	const unique = uniqueModels(passModels);
	return {
		passModels: unique,
		scopedProviders: uniqueProviders(unique.map((model) => model.provider)),
		sourceKind: "pass-list",
	};
}

function parseJsonlReport(content: string): ProviderScopeInput {
	const passModels: ProviderScopeModel[] = [];
	const testedProviders = new Set<string>();
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const row = JSON.parse(trimmed) as SmokeReportRow;
		const provider = asString(row.provider);
		const model = asString(row.model);
		if (!provider || !model) continue;
		testedProviders.add(provider);
		if (row.status === "pass") {
			passModels.push({
				provider,
				model,
				name: asString(row.name),
			});
		}
	}
	return {
		passModels: uniqueModels(passModels),
		scopedProviders: uniqueProviders(testedProviders),
		sourceKind: "report",
	};
}

export async function readProviderScopeInput(
	inputPath: string,
): Promise<ProviderScopeInput> {
	const resolved = normalizePath(inputPath);
	const content = await readFile(resolved, "utf8");
	const firstLine = content
		.split(/\r?\n/)
		.find((line) => line.trim().length > 0)
		?.trim();
	if (!firstLine) {
		return { passModels: [], scopedProviders: [], sourceKind: "pass-list" };
	}
	return firstLine.startsWith("{")
		? parseJsonlReport(content)
		: parseTsvPassList(content);
}

function timestamp(now: Date): string {
	return now.toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

async function writeJsonWithBackup(
	path: string,
	value: JsonRecord,
	dryRun: boolean,
	now: Date,
): Promise<string | undefined> {
	if (dryRun) return undefined;
	await mkdir(dirname(path), { recursive: true });
	const backupPath = `${path}.bak-${timestamp(now)}`;
	await copyFile(path, backupPath);
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
	return backupPath;
}

async function applyPiScope(options: {
	path: string;
	models: ProviderScopeModel[];
	dryRun: boolean;
	now: Date;
}): Promise<{ file: string; backup?: string; enabledModels: number }> {
	const resolved = normalizePath(options.path);
	const settings = parseJsonObject(await readFile(resolved, "utf8"), resolved);
	const enabledModels = options.models.map(modelRef).sort();
	const nextSettings: JsonRecord = { ...settings, enabledModels };
	const backup = await writeJsonWithBackup(
		resolved,
		nextSettings,
		options.dryRun,
		options.now,
	);
	return { file: resolved, backup, enabledModels: enabledModels.length };
}

function shouldKeepOpenCodeModel(
	provider: string,
	modelKey: string,
	modelConfig: unknown,
	passKeys: Set<string>,
): boolean {
	if (passKeys.has(routeKey(provider, modelKey))) return true;
	if (isRecord(modelConfig)) {
		const modelId = asString(modelConfig.modelID);
		return modelId ? passKeys.has(routeKey(provider, modelId)) : false;
	}
	return false;
}

async function applyOpenCodeScope(options: {
	path: string;
	input: ProviderScopeInput;
	dryRun: boolean;
	now: Date;
}): Promise<{
	file: string;
	backup?: string;
	providerModelCounts: Record<string, number>;
	missingProviders: string[];
}> {
	const resolved = normalizePath(options.path);
	const config = parseJsonObject(await readFile(resolved, "utf8"), resolved);
	const providerMap = config.provider;
	if (!isRecord(providerMap)) {
		throw new Error(`${resolved} has no provider object`);
	}

	const passKeys = new Set(
		options.input.passModels.map((model) =>
			routeKey(model.provider, model.model),
		),
	);
	const nextProviderMap: JsonRecord = { ...providerMap };
	const providerModelCounts: Record<string, number> = {};
	const missingProviders: string[] = [];

	for (const provider of options.input.scopedProviders) {
		const providerConfig = providerMap[provider];
		if (!isRecord(providerConfig)) {
			missingProviders.push(provider);
			continue;
		}
		const models = providerConfig.models;
		if (!isRecord(models)) {
			providerModelCounts[provider] = 0;
			nextProviderMap[provider] = { ...providerConfig, models: {} };
			continue;
		}
		const scopedModels = Object.fromEntries(
			Object.entries(models).filter(([modelKey, modelConfig]) =>
				shouldKeepOpenCodeModel(provider, modelKey, modelConfig, passKeys),
			),
		);
		providerModelCounts[provider] = Object.keys(scopedModels).length;
		nextProviderMap[provider] = { ...providerConfig, models: scopedModels };
	}

	const nextConfig: JsonRecord = { ...config, provider: nextProviderMap };
	const backup = await writeJsonWithBackup(
		resolved,
		nextConfig,
		options.dryRun,
		options.now,
	);
	return {
		file: resolved,
		backup,
		providerModelCounts,
		missingProviders: missingProviders.sort(),
	};
}

function normalizeTarget(target?: ProviderScopeTarget): ProviderScopeTarget {
	if (
		target === PROVIDER_SCOPE_TARGET.PI ||
		target === PROVIDER_SCOPE_TARGET.OPENCODE ||
		target === PROVIDER_SCOPE_TARGET.BOTH
	) {
		return target;
	}
	return PROVIDER_SCOPE_TARGET.BOTH;
}

export async function applyProviderScope(
	options: ApplyProviderScopeOptions,
): Promise<ApplyProviderScopeResult> {
	const target = normalizeTarget(options.target);
	const dryRun = options.dryRun ?? false;
	const inputPath = normalizePath(options.inputPath);
	const input = await readProviderScopeInput(inputPath);
	const now = options.now ?? new Date();
	const files: string[] = [];
	const backups: string[] = [];
	const result: ApplyProviderScopeResult = {
		inputPath,
		target,
		dryRun,
		wrote: !dryRun,
		passModels: input.passModels.length,
		scopedProviders: input.scopedProviders,
		files,
		backups,
	};

	if (
		target === PROVIDER_SCOPE_TARGET.PI ||
		target === PROVIDER_SCOPE_TARGET.BOTH
	) {
		const pi = await applyPiScope({
			path: options.piSettingsPath ?? "~/.pi/agent/settings.json",
			models: input.passModels,
			dryRun,
			now,
		});
		files.push(pi.file);
		if (pi.backup) backups.push(pi.backup);
		result.piEnabledModels = pi.enabledModels;
	}

	if (
		target === PROVIDER_SCOPE_TARGET.OPENCODE ||
		target === PROVIDER_SCOPE_TARGET.BOTH
	) {
		const opencode = await applyOpenCodeScope({
			path: options.opencodeConfigPath ?? "~/.config/opencode/opencode.json",
			input,
			dryRun,
			now,
		});
		files.push(opencode.file);
		if (opencode.backup) backups.push(opencode.backup);
		result.opencodeProviderModelCounts = opencode.providerModelCounts;
		result.opencodeMissingProviders = opencode.missingProviders;
	}

	return result;
}
