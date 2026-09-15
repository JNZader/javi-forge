import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

export const PROVIDER_SMOKE_STATUS = {
	PASS: "pass",
	AUTH_OR_POLICY: "auth_or_policy",
	BILLING_REQUIRED: "billing_required",
	RATE_LIMITED: "rate_limited",
	MODEL_NOT_FOUND: "model_not_found",
	BAD_REQUEST: "bad_request",
	TEMPORARY_UNAVAILABLE: "temporary_unavailable",
	TIMEOUT: "timeout",
	FAILED: "failed",
} as const;

export type ProviderSmokeStatus =
	(typeof PROVIDER_SMOKE_STATUS)[keyof typeof PROVIDER_SMOKE_STATUS];

export const PROVIDER_SMOKE_RUNTIME = {
	PI: "pi",
	OPENCODE: "opencode",
} as const;

export type ProviderSmokeRuntime =
	(typeof PROVIDER_SMOKE_RUNTIME)[keyof typeof PROVIDER_SMOKE_RUNTIME];

export interface ProviderSmokeModel {
	provider: string;
	model: string;
	name: string;
	local: boolean;
	source: string;
}

export interface ProviderSmokeFilters {
	provider?: string;
	family?: string;
	model?: string;
	status?: string;
	limit?: number;
	includeLocal?: boolean;
}

export interface ProviderSmokeOptions {
	modelsPath?: string;
	modelsStorePath?: string;
	previousReportPath?: string;
	outputPath?: string;
	timeoutSeconds?: number;
	runtime?: ProviderSmokeRuntime;
	piCommand?: string;
	opencodeCommand?: string;
	opencodeAgent?: string;
	smokeCwd?: string;
	envFile?: string;
	prompt?: string;
	dryRun?: boolean;
	filters?: ProviderSmokeFilters;
	runner?: ProviderSmokeRunner;
}

export interface ProviderSmokeRunOutput {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	timedOut?: boolean;
}

export interface ProviderSmokeRunner {
	run(
		model: ProviderSmokeModel,
		options: ProviderSmokeRunContext,
	): Promise<ProviderSmokeRunOutput>;
}

interface ProviderSmokeRunContext
	extends Required<
		Pick<
			ProviderSmokeOptions,
			| "opencodeAgent"
			| "opencodeCommand"
			| "piCommand"
			| "prompt"
			| "timeoutSeconds"
		>
	> {
	env: NodeJS.ProcessEnv;
	runtime: ProviderSmokeRuntime;
	smokeCwd?: string;
}

export interface ProviderSmokeReportRow {
	provider: string;
	model: string;
	name: string;
	status: ProviderSmokeStatus;
	exitCode: number | null;
	durationMs: number;
	evidence: string;
	testedAt: string;
}

export interface ProviderSmokeResult {
	selected: number;
	ran: number;
	dryRun: boolean;
	reportPath: string;
	summaryPath: string;
	passListPath: string;
	counts: Record<string, number>;
	providerStatusCounts: Record<string, Record<string, number>>;
}

const DEFAULT_PROMPT =
	"Reply with exactly: pong. Do not call tools. Do not include markdown.";
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_OPENCODE_AGENT = "title";
const TIMEOUT_SIGKILL_GRACE_MS = 1500;
const SENSITIVE_LINE =
	/(api[-_ ]?key|token|secret|credential|authorization|bearer)/i;
const LOCAL_PROVIDER = /(ollama|localhost|local)/i;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizePath(path: string): string {
	if (path.startsWith("~/")) {
		return join(process.env.HOME ?? "", path.slice(2));
	}
	return isAbsolute(path) ? path : resolve(path);
}

function uniqueModelKey(model: ProviderSmokeModel): string {
	return `${model.provider}\u0000${model.model}`;
}

function isLocalProvider(provider: string): boolean {
	return LOCAL_PROVIDER.test(provider);
}

function parseJson(content: string, path: string): JsonRecord {
	const parsed: unknown = JSON.parse(content);
	if (!isRecord(parsed)) throw new Error(`expected object JSON in ${path}`);
	return parsed;
}

function extractPiModels(
	root: JsonRecord,
	source: string,
	includeLocal: boolean,
): ProviderSmokeModel[] {
	const providers = isRecord(root.providers) ? root.providers : root;
	if (!isRecord(providers)) return [];
	const models: ProviderSmokeModel[] = [];
	for (const [providerId, providerConfig] of Object.entries(providers)) {
		if (!includeLocal && isLocalProvider(providerId)) continue;
		if (!isRecord(providerConfig)) continue;
		const providerModels = providerConfig.models;
		if (Array.isArray(providerModels)) {
			for (const entry of providerModels) {
				if (!isRecord(entry)) continue;
				const id = asString(entry.id);
				if (!id) continue;
				models.push({
					provider: providerId,
					model: id,
					name: asString(entry.name) ?? id,
					local: isLocalProvider(providerId),
					source,
				});
			}
			continue;
		}
		if (isRecord(providerModels)) {
			for (const [modelId, entry] of Object.entries(providerModels)) {
				const name = isRecord(entry) ? asString(entry.name) : undefined;
				models.push({
					provider: providerId,
					model: modelId,
					name: name ?? modelId,
					local: isLocalProvider(providerId),
					source,
				});
			}
		}
	}
	return models;
}

function extractOpenCodeModels(
	root: JsonRecord,
	source: string,
	includeLocal: boolean,
): ProviderSmokeModel[] {
	const providers = isRecord(root.provider)
		? root.provider
		: isRecord(root.providers)
			? root.providers
			: {};
	const models: ProviderSmokeModel[] = [];
	for (const [providerId, providerConfig] of Object.entries(providers)) {
		if (!includeLocal && isLocalProvider(providerId)) continue;
		if (!isRecord(providerConfig) || !isRecord(providerConfig.models)) continue;
		for (const [modelId, entry] of Object.entries(providerConfig.models)) {
			const name = isRecord(entry) ? asString(entry.name) : undefined;
			models.push({
				provider: providerId,
				model: modelId,
				name: name ?? modelId,
				local: isLocalProvider(providerId),
				source,
			});
		}
	}
	return models;
}

export async function loadProviderSmokeModels(options: {
	modelsPath?: string;
	modelsStorePath?: string;
	includeLocal?: boolean;
	runtime?: ProviderSmokeRuntime;
	opencodeCommand?: string;
	env?: NodeJS.ProcessEnv;
	timeoutSeconds?: number;
	smokeCwd?: string;
}): Promise<ProviderSmokeModel[]> {
	const includeLocal = options.includeLocal ?? false;
	if (options.runtime === PROVIDER_SMOKE_RUNTIME.OPENCODE) {
		if (!options.modelsPath) {
			return await loadOpenCodeRuntimeModels({
				command: options.opencodeCommand ?? "opencode",
				env: options.env ?? process.env,
				includeLocal,
				timeoutSeconds: options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS,
				smokeCwd: options.smokeCwd ?? tmpdir(),
			});
		}
		const path = options.modelsPath;
		const resolved = normalizePath(path);
		const json = parseJson(await readFile(resolved, "utf8"), resolved);
		return extractOpenCodeModels(json, resolved, includeLocal).sort((a, b) =>
			`${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`),
		);
	}
	const paths = [
		options.modelsPath ?? "~/.pi/agent/models.json",
		options.modelsStorePath ?? "~/.pi/agent/models-store.json",
	];
	const byKey = new Map<string, ProviderSmokeModel>();
	for (const path of paths) {
		const resolved = normalizePath(path);
		try {
			const json = parseJson(await readFile(resolved, "utf8"), resolved);
			for (const model of extractPiModels(json, resolved, includeLocal)) {
				byKey.set(uniqueModelKey(model), model);
			}
		} catch (error) {
			if (path === options.modelsPath || path === options.modelsStorePath) {
				throw error;
			}
		}
	}
	return [...byKey.values()].sort((a, b) =>
		`${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`),
	);
}

function stripAnsi(value: string): string {
	const ansiEscape = String.fromCharCode(27);
	return value.replace(
		new RegExp(`${ansiEscape}\\[[0-?]*[ -/]*[@-~]`, "g"),
		"",
	);
}

async function loadOpenCodeRuntimeModels(options: {
	command: string;
	env: NodeJS.ProcessEnv;
	includeLocal: boolean;
	timeoutSeconds: number;
	smokeCwd: string;
}): Promise<ProviderSmokeModel[]> {
	const output = await runSmokeCommandWithTimeout(options.command, ["models"], {
		env: options.env,
		timeoutSeconds: options.timeoutSeconds,
		cwd: options.smokeCwd,
	});
	if (output.exitCode !== 0 || output.timedOut) {
		const status = output.timedOut ? "timed out" : `exited ${output.exitCode}`;
		const evidence = sanitizeEvidence(output);
		throw new Error(
			`opencode models ${status}${evidence ? `:\n${evidence}` : ""}`,
		);
	}
	const models = new Map<string, ProviderSmokeModel>();
	for (const rawLine of output.stdout.split(/\r?\n/)) {
		const line = stripAnsi(rawLine).trim();
		if (!line || line.startsWith("[skill-registry]")) continue;
		const slash = line.indexOf("/");
		if (slash <= 0 || slash === line.length - 1) continue;
		const provider = line.slice(0, slash);
		const model = line.slice(slash + 1);
		if (!options.includeLocal && isLocalProvider(provider)) continue;
		models.set(`${provider}\u0000${model}`, {
			provider,
			model,
			name: model,
			local: isLocalProvider(provider),
			source: `${options.command} models`,
		});
	}
	return [...models.values()].sort((a, b) =>
		`${a.provider}/${a.model}`.localeCompare(`${b.provider}/${b.model}`),
	);
}

function normalizeFilter(value?: string): string | undefined {
	const trimmed = value?.trim().toLowerCase();
	return trimmed ? trimmed : undefined;
}

function matchesText(model: ProviderSmokeModel, needle: string): boolean {
	const haystack =
		`${model.provider} ${model.model} ${model.name}`.toLowerCase();
	return haystack.includes(needle);
}

async function loadPreviousStatuses(
	path?: string,
): Promise<Map<string, ProviderSmokeStatus>> {
	const statuses = new Map<string, ProviderSmokeStatus>();
	if (!path) return statuses;
	const content = await readFile(normalizePath(path), "utf8");
	for (const line of content.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const parsed: unknown = JSON.parse(line);
		if (!isRecord(parsed)) continue;
		const provider = asString(parsed.provider);
		const model = asString(parsed.model);
		const status = normalizeSmokeStatus(asString(parsed.status));
		if (provider && model && status)
			statuses.set(`${provider}\u0000${model}`, status);
	}
	return statuses;
}

export async function filterProviderSmokeModels(
	models: ProviderSmokeModel[],
	filters: ProviderSmokeFilters,
	previousReportPath?: string,
): Promise<ProviderSmokeModel[]> {
	const provider = normalizeFilter(filters.provider);
	const family = normalizeFilter(filters.family);
	const modelFilter = normalizeFilter(filters.model);
	const previousStatuses = await loadPreviousStatuses(previousReportPath);
	if (filters.status && !previousReportPath) {
		throw new Error("--status requires --report with a previous JSONL report");
	}
	let selected = models.filter((model) => {
		if (provider && model.provider.toLowerCase() !== provider) return false;
		if (family && !matchesText(model, family)) return false;
		if (
			modelFilter &&
			!`${model.provider}/${model.model} ${model.model}`
				.toLowerCase()
				.includes(modelFilter)
		) {
			return false;
		}
		if (filters.status) {
			return previousStatuses.get(uniqueModelKey(model)) === filters.status;
		}
		return true;
	});
	if (filters.limit !== undefined && filters.limit > 0) {
		selected = selected.slice(0, filters.limit);
	}
	return selected;
}

export function normalizeSmokeStatus(
	value?: string,
): ProviderSmokeStatus | undefined {
	if (!value) return undefined;
	return Object.values(PROVIDER_SMOKE_STATUS).find(
		(status) => status === value,
	);
}

export function classifySmokeOutput(
	output: ProviderSmokeRunOutput,
): ProviderSmokeStatus {
	const combined = `${output.stdout}\n${output.stderr}`.toLowerCase();
	if (output.timedOut) return PROVIDER_SMOKE_STATUS.TIMEOUT;
	if (output.exitCode === 0) return PROVIDER_SMOKE_STATUS.PASS;
	if (/rate limit|too many requests|429/.test(combined)) {
		return PROVIDER_SMOKE_STATUS.RATE_LIMITED;
	}
	if (
		/billing|payment|required credits|quota exceeded|insufficient credits/.test(
			combined,
		)
	) {
		return PROVIDER_SMOKE_STATUS.BILLING_REQUIRED;
	}
	if (
		/model .*not found|not found.*model|unknown model|invalid model|does not exist/.test(
			combined,
		)
	) {
		return PROVIDER_SMOKE_STATUS.MODEL_NOT_FOUND;
	}
	if (
		/401|403|unauthorized|forbidden|permission|policy|not allowed|terms|data policy|api key/.test(
			combined,
		)
	) {
		return PROVIDER_SMOKE_STATUS.AUTH_OR_POLICY;
	}
	if (/400|bad request|invalid request|unsupported/.test(combined)) {
		return PROVIDER_SMOKE_STATUS.BAD_REQUEST;
	}
	if (/503|502|504|temporar|unavailable|overloaded|try again/.test(combined)) {
		return PROVIDER_SMOKE_STATUS.TEMPORARY_UNAVAILABLE;
	}
	return PROVIDER_SMOKE_STATUS.FAILED;
}

function sanitizeEvidence(output: ProviderSmokeRunOutput): string {
	const raw = `${output.stdout}\n${output.stderr}`
		.split(/\r?\n/)
		.filter((line) => line.trim() && !SENSITIVE_LINE.test(line))
		.slice(0, 12)
		.join("\n");
	return raw.slice(0, 1200);
}

class PiProviderSmokeRunner implements ProviderSmokeRunner {
	run(
		model: ProviderSmokeModel,
		options: ProviderSmokeRunContext,
	): Promise<ProviderSmokeRunOutput> {
		return runSmokeCommandWithTimeout(
			options.piCommand,
			[
				"-p",
				"--no-tools",
				"--no-skills",
				"--no-context-files",
				"--no-prompt-templates",
				"--no-extensions",
				"--provider",
				model.provider,
				"--model",
				model.model,
				options.prompt,
			],
			options,
		);
	}
}

function runSmokeCommandWithTimeout(
	command: string,
	args: string[],
	options: {
		env: NodeJS.ProcessEnv;
		timeoutSeconds: number;
		cwd?: string;
	},
): Promise<ProviderSmokeRunOutput> {
	return new Promise((resolveRun) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: options.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let sigkillTimer: NodeJS.Timeout | undefined;
		const clearTimers = () => {
			clearTimeout(timer);
			if (sigkillTimer) clearTimeout(sigkillTimer);
		};
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			sigkillTimer = setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) {
					child.kill("SIGKILL");
				}
			}, TIMEOUT_SIGKILL_GRACE_MS);
		}, options.timeoutSeconds * 1000);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			clearTimers();
			resolveRun({
				exitCode: null,
				stdout,
				stderr: `${stderr}\n${error.message}`,
				timedOut,
			});
		});
		child.on("close", (exitCode) => {
			clearTimers();
			resolveRun({ exitCode, stdout, stderr, timedOut });
		});
	});
}

class OpenCodeProviderSmokeRunner implements ProviderSmokeRunner {
	run(
		model: ProviderSmokeModel,
		options: ProviderSmokeRunContext,
	): Promise<ProviderSmokeRunOutput> {
		return runSmokeCommandWithTimeout(
			options.opencodeCommand,
			[
				"run",
				"--pure",
				"--agent",
				options.opencodeAgent,
				"--model",
				`${model.provider}/${model.model}`,
				"--format",
				"json",
				options.prompt,
			],
			{
				env: options.env,
				timeoutSeconds: options.timeoutSeconds,
				cwd: options.smokeCwd,
			},
		);
	}
}

async function loadEnvFile(path?: string): Promise<NodeJS.ProcessEnv> {
	const env: NodeJS.ProcessEnv = { ...process.env };
	if (!path) return env;
	const content = await readFile(normalizePath(path), "utf8");
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
		if (!match) continue;
		const [, key, rawValue] = match;
		const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
		env[key] = value;
	}
	return env;
}

function timestamp(): string {
	return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
}

function resolveReportPath(outputPath?: string): string {
	if (!outputPath) {
		return join(tmpdir(), `javi-forge-provider-smoke-${timestamp()}.jsonl`);
	}
	const normalized = normalizePath(outputPath);
	if (normalized.endsWith(".jsonl")) return normalized;
	return join(normalized, `javi-forge-provider-smoke-${timestamp()}.jsonl`);
}

function artifactPaths(reportPath: string): {
	reportPath: string;
	summaryPath: string;
	passListPath: string;
} {
	const base = reportPath.replace(/\.jsonl$/, "");
	return {
		reportPath,
		summaryPath: `${base}.summary.md`,
		passListPath: `${base}.pass.tsv`,
	};
}

function incrementCount(record: Record<string, number>, key: string): void {
	record[key] = (record[key] ?? 0) + 1;
}

function incrementProviderStatus(
	record: Record<string, Record<string, number>>,
	provider: string,
	status: string,
): void {
	record[provider] ??= {};
	incrementCount(record[provider], status);
}

function renderSummary(result: {
	rows: ProviderSmokeReportRow[];
	selected: number;
	ran: number;
	dryRun: boolean;
	counts: Record<string, number>;
	providerStatusCounts: Record<string, Record<string, number>>;
}): string {
	return [
		"# Provider smoke-test summary",
		"",
		`- dryRun: ${String(result.dryRun)}`,
		`- selected: ${result.selected}`,
		`- ran: ${result.ran}`,
		"",
		"## Status counts",
		...Object.entries(result.counts).map(
			([status, count]) => `- ${status}: ${count}`,
		),
		"",
		"## Provider/status counts",
		...Object.entries(result.providerStatusCounts).flatMap(
			([provider, counts]) => [
				`- ${provider}`,
				...Object.entries(counts).map(
					([status, count]) => `  - ${status}: ${count}`,
				),
			],
		),
		"",
		"## Passing models",
		...result.rows
			.filter((row) => row.status === PROVIDER_SMOKE_STATUS.PASS)
			.map((row) => `- ${row.provider}\t${row.model}\t${row.name}`),
		"",
	].join("\n");
}

export async function runProviderSmokeTests(
	options: ProviderSmokeOptions,
): Promise<ProviderSmokeResult> {
	const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
	const runtime = options.runtime ?? PROVIDER_SMOKE_RUNTIME.PI;
	const env = await loadEnvFile(options.envFile);
	if (timeoutSeconds <= 0)
		throw new Error("--timeout must be greater than zero");
	const normalizedStatus = normalizeSmokeStatus(options.filters?.status);
	if (options.filters?.status && !normalizedStatus) {
		throw new Error(`unknown smoke status: ${options.filters.status}`);
	}
	const filters = {
		...options.filters,
		status: normalizedStatus,
	};
	const models = await loadProviderSmokeModels({
		modelsPath: options.modelsPath,
		modelsStorePath: options.modelsStorePath,
		includeLocal: filters.includeLocal,
		runtime,
		opencodeCommand: options.opencodeCommand ?? "opencode",
		env,
		timeoutSeconds,
		smokeCwd: options.smokeCwd,
	});
	const selected = await filterProviderSmokeModels(
		models,
		filters,
		options.previousReportPath,
	);
	const paths = artifactPaths(resolveReportPath(options.outputPath));
	await mkdir(dirname(paths.reportPath), { recursive: true });
	const runner =
		options.runner ??
		(runtime === PROVIDER_SMOKE_RUNTIME.OPENCODE
			? new OpenCodeProviderSmokeRunner()
			: new PiProviderSmokeRunner());
	const rows: ProviderSmokeReportRow[] = [];
	const counts: Record<string, number> = {};
	const providerStatusCounts: Record<string, Record<string, number>> = {};
	const testedAt = new Date().toISOString();
	for (const model of selected) {
		const started = Date.now();
		const output = options.dryRun
			? { exitCode: 0, stdout: "dry-run", stderr: "" }
			: await runner.run(model, {
					piCommand: options.piCommand ?? "pi",
					opencodeCommand: options.opencodeCommand ?? "opencode",
					opencodeAgent: options.opencodeAgent ?? DEFAULT_OPENCODE_AGENT,
					prompt: options.prompt ?? DEFAULT_PROMPT,
					timeoutSeconds,
					env,
					runtime,
					smokeCwd:
						runtime === PROVIDER_SMOKE_RUNTIME.OPENCODE
							? (options.smokeCwd ?? tmpdir())
							: options.smokeCwd,
				});
		const status = options.dryRun
			? PROVIDER_SMOKE_STATUS.PASS
			: classifySmokeOutput(output);
		const row: ProviderSmokeReportRow = {
			provider: model.provider,
			model: model.model,
			name: model.name,
			status,
			exitCode: output.exitCode,
			durationMs: Date.now() - started,
			evidence: sanitizeEvidence(output),
			testedAt,
		};
		rows.push(row);
		incrementCount(counts, status);
		incrementProviderStatus(providerStatusCounts, model.provider, status);
	}
	await writeFile(
		paths.reportPath,
		rows.map((row) => JSON.stringify(row)).join("\n") +
			(rows.length ? "\n" : ""),
	);
	await writeFile(
		paths.passListPath,
		`${rows
			.filter((row) => row.status === PROVIDER_SMOKE_STATUS.PASS)
			.map((row) => `${row.provider}\t${row.model}\t${row.name}`)
			.join("\n")}\n`,
	);
	await writeFile(
		paths.summaryPath,
		renderSummary({
			rows,
			selected: selected.length,
			ran: options.dryRun ? 0 : selected.length,
			dryRun: options.dryRun ?? false,
			counts,
			providerStatusCounts,
		}),
	);
	return {
		selected: selected.length,
		ran: options.dryRun ? 0 : selected.length,
		dryRun: options.dryRun ?? false,
		...paths,
		counts,
		providerStatusCounts,
	};
}
