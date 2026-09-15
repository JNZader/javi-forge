import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ZERO_COST = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
} as const;

const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS_CAP = 16_384;

const FREE_PROVIDER_SOURCE = {
	KILO: "https://api.kilo.ai/api/gateway/models",
	OPENROUTER: "https://openrouter.ai/api/v1/models",
	BLOCKRUN: "https://blockrun.ai/api/v1/models",
} as const;

export const PROVIDER_BUNDLE_TARGET = {
	PI: "pi",
	OPENCODE: "opencode",
	BOTH: "both",
} as const;

export type ProviderBundleTarget =
	(typeof PROVIDER_BUNDLE_TARGET)[keyof typeof PROVIDER_BUNDLE_TARGET];

export const PROVIDER_BUNDLE_SOURCE = {
	PI: "pi",
	OPENCODE: "opencode",
} as const;

export type ProviderBundleSource =
	(typeof PROVIDER_BUNDLE_SOURCE)[keyof typeof PROVIDER_BUNDLE_SOURCE];

export const FREE_PROVIDER_ID = {
	KILO: "kilo-free",
	OPENROUTER: "openrouter-free",
	BLOCKRUN: "public-noauth-blockrun",
	VIREONIX: "public-noauth-vireonix",
	OLLAMA: "ollama-local",
} as const;

export type FreeProviderId =
	(typeof FREE_PROVIDER_ID)[keyof typeof FREE_PROVIDER_ID];

const PROVIDER_AUTH_MODE = {
	NONE: "none",
	ENV: "env",
	PLACEHOLDER: "placeholder",
} as const;

type ProviderAuthMode =
	(typeof PROVIDER_AUTH_MODE)[keyof typeof PROVIDER_AUTH_MODE];

type FetchLike = typeof fetch;

interface ProviderCost {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

interface ProviderModel {
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	input: string[];
	reasoning: boolean;
	cost: ProviderCost;
}

interface ProviderAuth {
	mode: ProviderAuthMode;
	env?: string;
	value?: string;
}

interface PortableProvider {
	id: string;
	name: string;
	baseUrl: string;
	api: "openai-compatible";
	auth: ProviderAuth;
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
	models: ProviderModel[];
}

export interface PortableProviderBundle {
	providers: PortableProvider[];
}

interface PiProviderCompat {
	supportsDeveloperRole?: boolean;
	supportsReasoningEffort?: boolean;
}

interface PiModel {
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	input: string[];
	reasoning: boolean;
	cost: ProviderCost;
}

interface PiProvider {
	baseUrl: string;
	api: "openai-completions";
	apiKey: string;
	authHeader?: boolean;
	compat?: PiProviderCompat;
	models: PiModel[];
}

export interface PiProvidersConfig {
	providers: Record<string, PiProvider>;
}

interface OpenCodeModelLimit {
	context?: number;
	output?: number;
}

interface OpenCodeModel {
	modelID?: string;
	name?: string;
	limit?: OpenCodeModelLimit;
}

interface OpenCodeProviderOptions {
	baseURL?: string;
	apiKey?: string;
}

interface OpenCodeProviderSettings {
	baseURL?: string;
	apiKey?: string;
}

interface OpenCodeProvider {
	api?: string;
	npm?: string;
	package?: string;
	name?: string;
	options?: OpenCodeProviderOptions;
	settings?: OpenCodeProviderSettings;
	models?: Record<string, OpenCodeModel>;
}

export interface OpenCodeProvidersConfig {
	$schema: "https://opencode.ai/config.json";
	provider: Record<string, OpenCodeProvider>;
}

interface RawPricing {
	prompt?: string | number;
	completion?: string | number;
	input?: string | number;
	output?: string | number;
}

interface RawArchitecture {
	input_modalities?: unknown;
}

interface RawTopProvider {
	max_completion_tokens?: unknown;
}

interface RawModel {
	id?: unknown;
	name?: unknown;
	billing_mode?: unknown;
	pricing?: RawPricing;
	context_length?: unknown;
	contextWindow?: unknown;
	context_window?: unknown;
	max_completion_tokens?: unknown;
	max_output?: unknown;
	maxTokens?: unknown;
	top_provider?: RawTopProvider;
	architecture?: RawArchitecture;
	input_modalities?: unknown;
	categories?: unknown;
	supported_parameters?: unknown;
	reasoning?: unknown;
}

interface RawCatalog {
	data?: unknown;
	models?: unknown;
}

export interface ProviderBundleWriteResult {
	outputDir: string;
	files: string[];
	providerModelCounts: Record<string, number>;
	wrote: boolean;
}

export interface WriteFreeProviderBundleOptions {
	outputDir?: string;
	target?: ProviderBundleTarget;
	dryRun?: boolean;
	fetcher?: FetchLike;
}

export interface ConvertProviderBundleOptions {
	from: ProviderBundleSource;
	to: ProviderBundleSource;
	inputPath?: string;
	outputDir?: string;
	dryRun?: boolean;
}

function asNumber(value: unknown, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function rawString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function rawArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function freePrice(value: unknown): boolean {
	return Number(value) === 0;
}

function hasFreePricing(model: RawModel): boolean {
	if (model.billing_mode === "free") return true;
	const id = rawString(model.id);
	const name = rawString(model.name).toLowerCase();
	if (id.endsWith(":free") || name.includes("(free)")) return true;
	const pricing = model.pricing ?? {};
	return (
		freePrice(pricing.prompt ?? pricing.input) &&
		freePrice(pricing.completion ?? pricing.output)
	);
}

function inputTypes(model: RawModel): string[] {
	const modalities = [
		...rawArray(model.architecture?.input_modalities),
		...rawArray(model.input_modalities),
		...rawArray(model.categories),
	];
	return modalities.includes("image") || modalities.includes("vision")
		? ["text", "image"]
		: ["text"];
}

function contextWindow(
	model: RawModel,
	fallback = DEFAULT_CONTEXT_WINDOW,
): number {
	return asNumber(
		model.context_length ?? model.contextWindow ?? model.context_window,
		fallback,
	);
}

function maxTokens(model: RawModel, context: number): number {
	return asNumber(
		model.top_provider?.max_completion_tokens ??
			model.max_completion_tokens ??
			model.max_output ??
			model.maxTokens,
		Math.min(context, DEFAULT_MAX_TOKENS_CAP),
	);
}

function supportsReasoning(model: RawModel): boolean {
	if (model.reasoning) return true;
	const parameters = rawArray(model.supported_parameters);
	if (
		parameters.includes("reasoning") ||
		parameters.includes("reasoning_effort")
	) {
		return true;
	}
	const categories = rawArray(model.categories);
	if (categories.includes("reasoning")) return true;
	return /reasoning|nemotron|inkling|ling|nex|dots|lyria|step/i.test(
		`${rawString(model.id)} ${rawString(model.name)}`,
	);
}

function toPortableModel(model: RawModel): ProviderModel {
	const id = rawString(model.id);
	const context = contextWindow(model);
	return {
		id,
		name: rawString(model.name) || id,
		contextWindow: context,
		maxTokens: maxTokens(model, context),
		input: inputTypes(model),
		reasoning: supportsReasoning(model),
		cost: { ...ZERO_COST },
	};
}

function toCatalogModels(payload: RawCatalog, source: string): RawModel[] {
	const rawModels = payload.data ?? payload.models;
	if (!Array.isArray(rawModels)) {
		throw new Error(`${source} did not return a model array`);
	}
	return rawModels.filter((model): model is RawModel => {
		return typeof model === "object" && model !== null;
	});
}

async function fetchModels(
	source: string,
	fetcher: FetchLike,
): Promise<RawModel[]> {
	const response = await fetcher(source, {
		headers: { accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(`${source} returned HTTP ${response.status}`);
	}
	return toCatalogModels((await response.json()) as RawCatalog, source);
}

export function defaultPiFreeProvidersBundleDir(home = homedir()): string {
	return join(home, ".pi", "agent", "provider-bundles", "free-providers");
}

export function defaultAiFreeProvidersBundleDir(home = homedir()): string {
	return join(home, ".javi-forge", "provider-bundles", "free-providers");
}

function defaultProviderConfigPath(source: ProviderBundleSource): string {
	if (source === PROVIDER_BUNDLE_SOURCE.PI) {
		return join(homedir(), ".pi", "agent", "models.json");
	}
	return join(homedir(), ".config", "opencode", "opencode.json");
}

export async function generateFreeProviderBundle(
	fetcher: FetchLike = fetch,
): Promise<PortableProviderBundle> {
	const [kiloRaw, openrouterRaw, blockrunRaw] = await Promise.all([
		fetchModels(FREE_PROVIDER_SOURCE.KILO, fetcher),
		fetchModels(FREE_PROVIDER_SOURCE.OPENROUTER, fetcher),
		fetchModels(FREE_PROVIDER_SOURCE.BLOCKRUN, fetcher),
	]);

	return {
		providers: [
			{
				id: FREE_PROVIDER_ID.KILO,
				name: "Kilo Free",
				baseUrl: "https://api.kilo.ai/api/gateway",
				api: "openai-compatible",
				auth: { mode: PROVIDER_AUTH_MODE.NONE },
				supportsDeveloperRole: false,
				models: kiloRaw.filter(hasFreePricing).map(toPortableModel),
			},
			{
				id: FREE_PROVIDER_ID.OPENROUTER,
				name: "OpenRouter Free",
				baseUrl: "https://openrouter.ai/api/v1",
				api: "openai-compatible",
				auth: { mode: PROVIDER_AUTH_MODE.ENV, env: "OPENROUTER_API_KEY" },
				supportsDeveloperRole: false,
				models: openrouterRaw.filter(hasFreePricing).map(toPortableModel),
			},
			{
				id: FREE_PROVIDER_ID.BLOCKRUN,
				name: "BlockRun Public Free",
				baseUrl: "https://blockrun.ai/api/v1",
				api: "openai-compatible",
				auth: { mode: PROVIDER_AUTH_MODE.NONE },
				supportsDeveloperRole: false,
				models: blockrunRaw.filter(hasFreePricing).map(toPortableModel),
			},
			{
				id: FREE_PROVIDER_ID.VIREONIX,
				name: "Vireonix Public No-Auth",
				baseUrl: "https://vireonix.ai/v1",
				api: "openai-compatible",
				auth: { mode: PROVIDER_AUTH_MODE.NONE },
				supportsDeveloperRole: false,
				models: [
					{
						id: "auto",
						name: "Vireonix Auto public no-auth",
						contextWindow: 1_000_000,
						maxTokens: 100_000,
						input: ["text"],
						reasoning: true,
						cost: { ...ZERO_COST },
					},
				],
			},
			{
				id: FREE_PROVIDER_ID.OLLAMA,
				name: "Ollama Local",
				baseUrl: "http://127.0.0.1:11434/v1",
				api: "openai-compatible",
				auth: { mode: PROVIDER_AUTH_MODE.PLACEHOLDER, value: "ollama" },
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
				models: [
					{
						id: "granite3.2:2b",
						name: "Granite 3.2 2B local via Ollama",
						contextWindow: 131_072,
						maxTokens: 8192,
						input: ["text"],
						reasoning: false,
						cost: { ...ZERO_COST },
					},
				],
			},
		],
	};
}

function piApiKey(provider: PortableProvider): string {
	if (provider.auth.mode === PROVIDER_AUTH_MODE.ENV && provider.auth.env) {
		return `$${provider.auth.env}`;
	}
	if (provider.auth.mode === PROVIDER_AUTH_MODE.PLACEHOLDER) {
		return provider.auth.value ?? "placeholder";
	}
	return "anonymous";
}

export function renderPiProvidersConfig(
	bundle: PortableProviderBundle,
): PiProvidersConfig {
	return {
		providers: Object.fromEntries(
			bundle.providers.map((provider) => [
				provider.id,
				{
					baseUrl: provider.baseUrl,
					api: "openai-completions",
					apiKey: piApiKey(provider),
					...(provider.auth.mode === PROVIDER_AUTH_MODE.NONE
						? { authHeader: false }
						: {}),
					compat: {
						supportsDeveloperRole: provider.supportsDeveloperRole,
						supportsReasoningEffort: provider.supportsReasoningEffort,
					},
					models: provider.models,
				},
			]),
		),
	};
}

function openCodeApiKey(provider: PortableProvider): string | undefined {
	if (provider.auth.mode === PROVIDER_AUTH_MODE.ENV && provider.auth.env) {
		return `{env:${provider.auth.env}}`;
	}
	if (provider.auth.mode === PROVIDER_AUTH_MODE.PLACEHOLDER) {
		return provider.auth.value ?? "placeholder";
	}
	return undefined;
}

export function renderOpenCodeProvidersConfig(
	bundle: PortableProviderBundle,
): OpenCodeProvidersConfig {
	return {
		$schema: "https://opencode.ai/config.json",
		provider: Object.fromEntries(
			bundle.providers.map((provider) => {
				const apiKey = openCodeApiKey(provider);
				return [
					provider.id,
					{
						npm: "@ai-sdk/openai-compatible",
						name: provider.name,
						options: {
							baseURL: provider.baseUrl,
							...(apiKey ? { apiKey } : {}),
						},
						models: Object.fromEntries(
							provider.models.map((model) => [
								model.id,
								{
									name: model.name,
									limit: {
										context: model.contextWindow,
										output: model.maxTokens,
									},
								},
							]),
						),
					},
				];
			}),
		),
	};
}

function providerCounts(
	bundle: PortableProviderBundle,
): Record<string, number> {
	return Object.fromEntries(
		bundle.providers.map((provider) => [provider.id, provider.models.length]),
	);
}

function envExampleContent(bundle: PortableProviderBundle): string {
	const names = bundle.providers
		.map((provider) =>
			provider.auth.mode === PROVIDER_AUTH_MODE.ENV ? provider.auth.env : "",
		)
		.filter((env): env is string => typeof env === "string" && env.length > 0);
	return names.map((name) => `${name}=\n`).join("");
}

function readmeContent(target: ProviderBundleTarget): string {
	return `# AI Free Providers Bundle

Portable provider catalog for Pi and OpenCode. It separates shareable model metadata from machine-local secrets.

## Files

- \`models.free.generated.json\` — generated provider catalog for Pi.
- \`opencode.providers.generated.json\` — generated provider block for OpenCode.
- \`env.example\` — optional environment variables for key-backed providers.

Generated target: \`${target}\`.

## Apply manually

Pi:

1. copy \`models.free.generated.json\` to \`~/.pi/agent/models.json\`; or
2. merge only the \`providers\` entries you want into an existing \`~/.pi/agent/models.json\`.

OpenCode:

1. merge \`opencode.providers.generated.json.provider\` into \`~/.config/opencode/opencode.json\`;
2. keep existing agents, permissions, MCP, and plugins intact.

Do not copy Pi \`auth.json\` or OpenCode auth files between machines. Those files are machine/user secret state.

## Optional keys

OpenRouter uses \`OPENROUTER_API_KEY\` when configured. No literal secrets are written.

## Refresh catalog

\`\`\`sh
javi-forge ai providers export-free --target both
\`\`\`

Free hosted catalogs are volatile. Refresh before exporting if the target machine will be long-lived.
`;
}

function targetPaths(
	outputDir: string,
	target: ProviderBundleTarget,
): string[] {
	const paths: string[] = [];
	if (
		target === PROVIDER_BUNDLE_TARGET.PI ||
		target === PROVIDER_BUNDLE_TARGET.BOTH
	) {
		paths.push(join(outputDir, "models.free.generated.json"));
	}
	if (
		target === PROVIDER_BUNDLE_TARGET.OPENCODE ||
		target === PROVIDER_BUNDLE_TARGET.BOTH
	) {
		paths.push(join(outputDir, "opencode.providers.generated.json"));
	}
	paths.push(join(outputDir, "README.md"), join(outputDir, "env.example"));
	return paths;
}

function normalizeTarget(target?: string): ProviderBundleTarget {
	if (
		target === PROVIDER_BUNDLE_TARGET.PI ||
		target === PROVIDER_BUNDLE_TARGET.OPENCODE ||
		target === PROVIDER_BUNDLE_TARGET.BOTH
	) {
		return target;
	}
	if (!target) return PROVIDER_BUNDLE_TARGET.BOTH;
	throw new Error(`unknown provider bundle target: ${target}`);
}

export async function writeFreeProvidersBundle(
	options: WriteFreeProviderBundleOptions = {},
): Promise<ProviderBundleWriteResult> {
	const target = normalizeTarget(options.target);
	const outputDir = resolve(
		options.outputDir ??
			(target === PROVIDER_BUNDLE_TARGET.PI
				? defaultPiFreeProvidersBundleDir()
				: defaultAiFreeProvidersBundleDir()),
	);
	const bundle = await generateFreeProviderBundle(options.fetcher);
	const files = targetPaths(outputDir, target);

	if (!options.dryRun) {
		await mkdir(outputDir, { recursive: true });
		if (
			target === PROVIDER_BUNDLE_TARGET.PI ||
			target === PROVIDER_BUNDLE_TARGET.BOTH
		) {
			await writeFile(
				join(outputDir, "models.free.generated.json"),
				`${JSON.stringify(renderPiProvidersConfig(bundle), null, 2)}\n`,
			);
		}
		if (
			target === PROVIDER_BUNDLE_TARGET.OPENCODE ||
			target === PROVIDER_BUNDLE_TARGET.BOTH
		) {
			await writeFile(
				join(outputDir, "opencode.providers.generated.json"),
				`${JSON.stringify(renderOpenCodeProvidersConfig(bundle), null, 2)}\n`,
			);
		}
		await writeFile(join(outputDir, "README.md"), readmeContent(target));
		await writeFile(join(outputDir, "env.example"), envExampleContent(bundle));
	}

	return {
		outputDir,
		files,
		providerModelCounts: providerCounts(bundle),
		wrote: !options.dryRun,
	};
}

function parseJsonObject(
	text: string,
	source: string,
): Record<string, unknown> {
	const value = JSON.parse(text) as unknown;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${source} must contain a JSON object`);
	}
	return value as Record<string, unknown>;
}

function providerIdToEnvName(providerId: string): string {
	return `${providerId
		.replace(/[^A-Za-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toUpperCase()}_API_KEY`;
}

function literalApiKeyToPortableEnv(providerId: string): ProviderAuth {
	return { mode: PROVIDER_AUTH_MODE.ENV, env: providerIdToEnvName(providerId) };
}

function piProviderToAuth(
	providerId: string,
	provider: PiProvider,
): ProviderAuth {
	if (provider.authHeader === false) {
		return provider.apiKey === "ollama"
			? { mode: PROVIDER_AUTH_MODE.PLACEHOLDER, value: "ollama" }
			: { mode: PROVIDER_AUTH_MODE.NONE };
	}
	if (provider.apiKey.startsWith("$")) {
		return { mode: PROVIDER_AUTH_MODE.ENV, env: provider.apiKey.slice(1) };
	}
	return literalApiKeyToPortableEnv(providerId);
}

export function bundleFromPiProvidersConfig(
	config: PiProvidersConfig,
): PortableProviderBundle {
	return {
		providers: Object.entries(config.providers).map(([id, provider]) => ({
			id,
			name: id,
			baseUrl: provider.baseUrl,
			api: "openai-compatible",
			auth: piProviderToAuth(id, provider),
			supportsDeveloperRole: provider.compat?.supportsDeveloperRole,
			supportsReasoningEffort: provider.compat?.supportsReasoningEffort,
			models: provider.models,
		})),
	};
}

function openCodeProviderApiKey(provider: OpenCodeProvider): string {
	return provider.options?.apiKey ?? provider.settings?.apiKey ?? "";
}

function openCodeProviderBaseUrl(provider: OpenCodeProvider): string {
	return provider.options?.baseURL ?? provider.settings?.baseURL ?? "";
}

function openCodeApiKeyToAuth(
	providerId: string,
	apiKey: string,
): ProviderAuth {
	const envMatch = /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(apiKey);
	if (envMatch?.[1]) {
		return { mode: PROVIDER_AUTH_MODE.ENV, env: envMatch[1] };
	}
	if (!apiKey) return { mode: PROVIDER_AUTH_MODE.NONE };
	return literalApiKeyToPortableEnv(providerId);
}

function requireOpenCodeProviderBaseUrl(
	providerId: string,
	provider: OpenCodeProvider,
): string {
	const baseUrl = openCodeProviderBaseUrl(provider);
	if (baseUrl) return baseUrl;
	throw new Error(
		`OpenCode provider "${providerId}" has no custom baseURL; cannot convert built-in provider metadata to Pi safely`,
	);
}

export function bundleFromOpenCodeConfig(
	config: Record<string, unknown>,
): PortableProviderBundle {
	const providerMap = config.provider ?? config.providers;
	if (
		typeof providerMap !== "object" ||
		providerMap === null ||
		Array.isArray(providerMap)
	) {
		throw new Error("OpenCode config has no provider/providers object");
	}
	return {
		providers: Object.entries(
			providerMap as Record<string, OpenCodeProvider>,
		).map(([id, provider]) => ({
			id,
			name: provider.name ?? id,
			baseUrl: requireOpenCodeProviderBaseUrl(id, provider),
			api: "openai-compatible",
			auth: openCodeApiKeyToAuth(id, openCodeProviderApiKey(provider)),
			models: Object.entries(provider.models ?? {}).map(([modelKey, model]) => {
				const context = model.limit?.context ?? DEFAULT_CONTEXT_WINDOW;
				return {
					id: model.modelID ?? modelKey,
					name: model.name ?? modelKey,
					contextWindow: context,
					maxTokens:
						model.limit?.output ?? Math.min(context, DEFAULT_MAX_TOKENS_CAP),
					input: ["text"],
					reasoning: false,
					cost: { ...ZERO_COST },
				};
			}),
		})),
	};
}

async function readProviderBundleFromSource(
	source: ProviderBundleSource,
	inputPath?: string,
): Promise<PortableProviderBundle> {
	const resolvedPath = resolve(inputPath ?? defaultProviderConfigPath(source));
	const config = parseJsonObject(
		await readFile(resolvedPath, "utf8"),
		resolvedPath,
	);
	if (source === PROVIDER_BUNDLE_SOURCE.PI) {
		if (
			typeof config.providers !== "object" ||
			config.providers === null ||
			Array.isArray(config.providers)
		) {
			throw new Error("Pi config has no providers object");
		}
		return bundleFromPiProvidersConfig(config as unknown as PiProvidersConfig);
	}
	return bundleFromOpenCodeConfig(config);
}

function convertedFileName(to: ProviderBundleSource): string {
	return to === PROVIDER_BUNDLE_SOURCE.PI
		? "models.converted.json"
		: "opencode.providers.converted.json";
}

function renderTargetConfig(
	to: ProviderBundleSource,
	bundle: PortableProviderBundle,
): PiProvidersConfig | OpenCodeProvidersConfig {
	return to === PROVIDER_BUNDLE_SOURCE.PI
		? renderPiProvidersConfig(bundle)
		: renderOpenCodeProvidersConfig(bundle);
}

export async function convertProviderBundle(
	options: ConvertProviderBundleOptions,
): Promise<ProviderBundleWriteResult> {
	if (options.from === options.to) {
		throw new Error("from and to must be different provider formats");
	}
	const outputDir = resolve(
		options.outputDir ??
			join(
				homedir(),
				".javi-forge",
				"provider-bundles",
				`${options.from}-to-${options.to}`,
			),
	);
	const bundle = await readProviderBundleFromSource(
		options.from,
		options.inputPath,
	);
	const outputPath = join(outputDir, convertedFileName(options.to));
	const files = [outputPath, join(outputDir, "README.md")];

	if (!options.dryRun) {
		await mkdir(outputDir, { recursive: true });
		await writeFile(
			outputPath,
			`${JSON.stringify(renderTargetConfig(options.to, bundle), null, 2)}\n`,
		);
		await writeFile(
			join(outputDir, "README.md"),
			`# Converted AI Provider Bundle

Converted from \`${options.from}\` to \`${options.to}\`.

This bundle contains shareable provider metadata only. Review it and merge manually into the target runtime config. Do not copy auth files between runtimes.
`,
		);
	}

	return {
		outputDir,
		files,
		providerModelCounts: providerCounts(bundle),
		wrote: !options.dryRun,
	};
}
