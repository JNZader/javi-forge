import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	type ProviderScopeInput,
	type ProviderScopeModel,
	readProviderScopeInput,
} from "./ai-provider-scope.js";

export const MODEL_ASSIGNMENT_PROFILE = {
	SDD_STRONG: "sdd-strong",
	SDD_MID: "sdd-mid",
	SDD_CHEAP: "sdd-cheap",
} as const;

export type ModelAssignmentProfile =
	(typeof MODEL_ASSIGNMENT_PROFILE)[keyof typeof MODEL_ASSIGNMENT_PROFILE];

const DEFAULT_MAX_CANDIDATES_PER_PROFILE = 8;

const PROFILE_ORDER = [
	MODEL_ASSIGNMENT_PROFILE.SDD_STRONG,
	MODEL_ASSIGNMENT_PROFILE.SDD_MID,
	MODEL_ASSIGNMENT_PROFILE.SDD_CHEAP,
] as const;

const PROFILE_PURPOSE: Record<ModelAssignmentProfile, string> = {
	[MODEL_ASSIGNMENT_PROFILE.SDD_STRONG]:
		"Architecture, design, verification, review, and high-ambiguity decisions.",
	[MODEL_ASSIGNMENT_PROFILE.SDD_MID]:
		"Implementation, remediation, and multi-file debugging where coding bias matters.",
	[MODEL_ASSIGNMENT_PROFILE.SDD_CHEAP]:
		"Specs, task slicing, archive summaries, and low-risk continuation work.",
};

const PROFILE_PHASES: Record<ModelAssignmentProfile, string[]> = {
	[MODEL_ASSIGNMENT_PROFILE.SDD_STRONG]: [
		"explore",
		"research",
		"propose",
		"design",
		"verify",
		"judge",
	],
	[MODEL_ASSIGNMENT_PROFILE.SDD_MID]: ["apply", "fix-agent"],
	[MODEL_ASSIGNMENT_PROFILE.SDD_CHEAP]: ["spec", "tasks", "archive", "onboard"],
};

export interface ModelAssignmentCandidate {
	provider: string;
	model: string;
	name?: string;
	ref: string;
	score: number;
	reasons: string[];
}

export interface ModelAssignmentProfilePlan {
	profile: ModelAssignmentProfile;
	purpose: string;
	phases: string[];
	primary: string | null;
	candidates: ModelAssignmentCandidate[];
}

export interface ModelAssignmentRoutingRow {
	phase: string;
	profile: ModelAssignmentProfile;
	primary: string | null;
}

export interface ModelAssignmentPlan {
	generatedAt: string;
	inputPath: string;
	sourceKind: ProviderScopeInput["sourceKind"];
	passModels: number;
	maxCandidatesPerProfile: number;
	profiles: Record<ModelAssignmentProfile, ModelAssignmentProfilePlan>;
	routing: ModelAssignmentRoutingRow[];
	warnings: string[];
}

export interface WriteModelAssignmentProfilesOptions {
	inputPath: string;
	outputDir: string;
	maxCandidatesPerProfile?: number;
	dryRun?: boolean;
	now?: Date;
}

export interface WriteModelAssignmentProfilesResult {
	inputPath: string;
	outputDir: string;
	dryRun: boolean;
	wrote: boolean;
	files: string[];
	passModels: number;
	profileCounts: Record<ModelAssignmentProfile, number>;
	profilePrimaries: Record<ModelAssignmentProfile, string | null>;
	warnings: string[];
}

export const MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET = {
	PI: "pi",
	OPENCODE: "opencode",
	CODEX: "codex",
	BOTH: "both",
} as const;

export type ModelAssignmentProfileExportTarget =
	(typeof MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET)[keyof typeof MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET];

export interface ModelAssignmentProfileExportCandidate {
	provider: string;
	model: string;
	name?: string;
	ref: string;
}

export interface ModelAssignmentProfileExportProfile {
	profile: ModelAssignmentProfile;
	purpose: string;
	phases: string[];
	primaryRef: string | null;
	candidates: ModelAssignmentProfileExportCandidate[];
}

export interface ModelAssignmentProfileOverlay {
	generatedAt: string;
	sourcePlanPath: string;
	target: ModelAssignmentProfileExportRuntimeTarget;
	profiles: Record<ModelAssignmentProfile, ModelAssignmentProfileExportProfile>;
	routing: ModelAssignmentRoutingRow[];
	warnings: string[];
}

export interface WriteModelAssignmentProfileExportOptions {
	inputPath: string;
	outputDir?: string;
	target: ModelAssignmentProfileExportTarget;
	dryRun?: boolean;
	now?: Date;
}

export interface WriteModelAssignmentProfileExportResult {
	inputPath: string;
	outputDir: string;
	target: ModelAssignmentProfileExportTarget;
	dryRun: boolean;
	wrote: boolean;
	files: string[];
	warnings: string[];
}

interface SmokeReportEvidenceRow {
	status?: unknown;
	evidence?: unknown;
}

function resolvePath(path: string): string {
	return path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(path);
}

function modelRef(model: ProviderScopeModel): string {
	return `${model.provider}/${model.model}`;
}

function searchableModelText(model: ProviderScopeModel): string {
	return `${model.provider} ${model.model} ${model.name ?? ""}`.toLowerCase();
}

function hasAny(text: string, tokens: readonly string[]): boolean {
	return tokens.some((token) => text.includes(token));
}

function sizeHint(text: string): number {
	const match = text.match(/\b(\d+(?:\.\d+)?)\s*b\b/);
	return match ? Number(match[1]) : Number.NaN;
}

function pushReason(
	reasons: string[],
	condition: boolean,
	reason: string,
): void {
	if (condition) reasons.push(reason);
}

function scoreStrong(model: ProviderScopeModel): ModelAssignmentCandidate {
	const text = searchableModelText(model);
	const reasons: string[] = [];
	let score = 10;
	const hasReasoning = hasAny(text, ["reason", "thinking", "r1"]);
	const hasTopFamily = hasAny(text, [
		"claude",
		"sonnet",
		"opus",
		"gpt",
		"deepseek",
		"qwen",
		"glm",
		"kimi",
	]);
	const hasCoding = hasAny(text, ["coder", "code"]);
	const small = sizeHint(text);
	if (hasTopFamily) score += 45;
	if (hasReasoning) score += 25;
	if (hasCoding) score += 10;
	if (Number.isFinite(small) && small <= 4) score -= 15;
	pushReason(reasons, hasTopFamily, "strong-family");
	pushReason(reasons, hasReasoning, "reasoning-capable");
	pushReason(reasons, hasCoding, "coding-capable");
	pushReason(
		reasons,
		Number.isFinite(small) && small <= 4,
		"small-model-penalty",
	);
	if (reasons.length === 0) reasons.push("smoke-tested-pass");
	return candidate(model, score, reasons);
}

function scoreMid(model: ProviderScopeModel): ModelAssignmentCandidate {
	const text = searchableModelText(model);
	const reasons: string[] = [];
	let score = 10;
	const hasCoding = hasAny(text, [
		"coder",
		"code",
		"qwen",
		"deepseek",
		"kimi",
		"glm",
	]);
	const hasFast = hasAny(text, ["flash", "fast", "mini", "lite"]);
	if (hasCoding) score += 45;
	if (hasFast) score += 10;
	pushReason(reasons, hasCoding, "coding-capable");
	pushReason(reasons, hasFast, "fast-or-small");
	if (reasons.length === 0) reasons.push("smoke-tested-pass");
	return candidate(model, score, reasons);
}

function scoreCheap(model: ProviderScopeModel): ModelAssignmentCandidate {
	const text = searchableModelText(model);
	const reasons: string[] = [];
	let score = 10;
	const hasCheapHint = hasAny(text, [
		"free",
		"mini",
		"lite",
		"small",
		"flash",
		"fast",
		"haiku",
	]);
	const size = sizeHint(text);
	if (hasCheapHint) score += 40;
	if (Number.isFinite(size) && size <= 9) score += 15;
	pushReason(reasons, hasCheapHint, "cheap-or-fast-hint");
	pushReason(reasons, Number.isFinite(size) && size <= 9, "small-size-hint");
	if (reasons.length === 0) reasons.push("smoke-tested-pass");
	return candidate(model, score, reasons);
}

function candidate(
	model: ProviderScopeModel,
	score: number,
	reasons: string[],
): ModelAssignmentCandidate {
	return {
		provider: model.provider,
		model: model.model,
		name: model.name,
		ref: modelRef(model),
		score,
		reasons,
	};
}

function sortCandidates(
	candidates: ModelAssignmentCandidate[],
): ModelAssignmentCandidate[] {
	return [...candidates].sort((a, b) => {
		const score = b.score - a.score;
		return score === 0 ? a.ref.localeCompare(b.ref) : score;
	});
}

function rankForProfile(
	profile: ModelAssignmentProfile,
	models: ProviderScopeModel[],
): ModelAssignmentCandidate[] {
	const ranker =
		profile === MODEL_ASSIGNMENT_PROFILE.SDD_STRONG
			? scoreStrong
			: profile === MODEL_ASSIGNMENT_PROFILE.SDD_MID
				? scoreMid
				: scoreCheap;
	return sortCandidates(models.map(ranker));
}

function assertReportIsNotDryRun(content: string, inputPath: string): void {
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const row = JSON.parse(trimmed) as SmokeReportEvidenceRow;
		if (row.status === "dry_run" || row.evidence === "dry-run") {
			throw new Error(
				`${inputPath} was generated by smoke-test --dry-run; run real smoke probes before generating model assignment profiles`,
			);
		}
	}
}

async function readVerifiedProviderScopeInput(
	inputPath: string,
): Promise<ProviderScopeInput> {
	const content = await readFile(inputPath, "utf8");
	const firstLine = content
		.split(/\r?\n/)
		.find((line) => line.trim().length > 0)
		?.trim();
	if (firstLine?.startsWith("{")) {
		assertReportIsNotDryRun(content, inputPath);
	}
	return readProviderScopeInput(inputPath);
}

function buildPlan(options: {
	inputPath: string;
	input: ProviderScopeInput;
	maxCandidatesPerProfile: number;
	now: Date;
}): ModelAssignmentPlan {
	const warnings: string[] = [];
	if (options.input.passModels.length === 0) {
		warnings.push("No passing models were found in the input.");
	}

	const profiles = Object.fromEntries(
		PROFILE_ORDER.map((profile) => {
			const candidates = rankForProfile(
				profile,
				options.input.passModels,
			).slice(0, options.maxCandidatesPerProfile);
			const plan: ModelAssignmentProfilePlan = {
				profile,
				purpose: PROFILE_PURPOSE[profile],
				phases: PROFILE_PHASES[profile],
				primary: candidates[0]?.ref ?? null,
				candidates,
			};
			return [profile, plan];
		}),
	) as Record<ModelAssignmentProfile, ModelAssignmentProfilePlan>;

	const routing = PROFILE_ORDER.flatMap((profile) =>
		PROFILE_PHASES[profile].map((phase) => ({
			phase,
			profile,
			primary: profiles[profile].primary,
		})),
	);

	return {
		generatedAt: options.now.toISOString(),
		inputPath: options.inputPath,
		sourceKind: options.input.sourceKind,
		passModels: options.input.passModels.length,
		maxCandidatesPerProfile: options.maxCandidatesPerProfile,
		profiles,
		routing,
		warnings,
	};
}

function renderMarkdown(plan: ModelAssignmentPlan): string {
	const lines = [
		"# AI Model Assignment Profile Plan",
		"",
		"Generated from smoke-tested provider evidence. This file is advisory only:",
		"it does not write runtime config, secrets, credentials, or provider auth state.",
		"",
		`- Input: \`${plan.inputPath}\``,
		`- Source kind: \`${plan.sourceKind}\``,
		`- Passing models: ${plan.passModels}`,
		`- Max candidates per profile: ${plan.maxCandidatesPerProfile}`,
		"",
		"## Routing",
		"",
		"| SDD phase | Profile | Primary model |",
		"| --- | --- | --- |",
		...plan.routing.map(
			(row) => `| ${row.phase} | ${row.profile} | ${row.primary ?? "n/a"} |`,
		),
		"",
		"## Profiles",
		"",
	];

	for (const profile of PROFILE_ORDER) {
		const profilePlan = plan.profiles[profile];
		lines.push(`### ${profile}`, "", profilePlan.purpose, "");
		lines.push("| Rank | Model | Score | Reasons |");
		lines.push("| --- | --- | ---: | --- |");
		if (profilePlan.candidates.length === 0) {
			lines.push("| — | n/a | 0 | no passing models |");
		} else {
			for (const [index, candidate] of profilePlan.candidates.entries()) {
				lines.push(
					`| ${index + 1} | ${candidate.ref} | ${candidate.score} | ${candidate.reasons.join(", ")} |`,
				);
			}
		}
		lines.push("");
	}

	if (plan.warnings.length) {
		lines.push("## Warnings", "");
		for (const warning of plan.warnings) lines.push(`- ${warning}`);
		lines.push("");
	}

	return `${lines.join("\n")}\n`;
}

async function writeGeneratedFile(
	path: string,
	content: string,
): Promise<void> {
	await writeFile(path, content, { flag: "wx" });
}

async function assertGeneratedFilesDoNotExist(paths: string[]): Promise<void> {
	for (const path of paths) {
		try {
			await lstat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
		const error = new Error(`EEXIST: file already exists, open '${path}'`);
		Object.assign(error, { code: "EEXIST", path });
		throw error;
	}
}

export async function writeModelAssignmentProfiles(
	options: WriteModelAssignmentProfilesOptions,
): Promise<WriteModelAssignmentProfilesResult> {
	const inputPath = resolvePath(options.inputPath);
	const outputDir = resolvePath(options.outputDir);
	const maxCandidatesPerProfile = Math.max(
		1,
		Math.floor(
			options.maxCandidatesPerProfile ?? DEFAULT_MAX_CANDIDATES_PER_PROFILE,
		),
	);
	const dryRun = options.dryRun ?? false;
	const input = await readVerifiedProviderScopeInput(inputPath);
	const plan = buildPlan({
		inputPath,
		input,
		maxCandidatesPerProfile,
		now: options.now ?? new Date(),
	});
	const jsonPath = join(outputDir, "model-assignment.profiles.generated.json");
	const markdownPath = join(
		outputDir,
		"model-assignment.profiles.generated.md",
	);
	if (!dryRun) {
		await mkdir(outputDir, { recursive: true });
		await writeGeneratedFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`);
		await writeGeneratedFile(markdownPath, renderMarkdown(plan));
	}
	return {
		inputPath,
		outputDir,
		dryRun,
		wrote: !dryRun,
		files: [jsonPath, markdownPath],
		passModels: plan.passModels,
		profileCounts: Object.fromEntries(
			PROFILE_ORDER.map((profile) => [
				profile,
				plan.profiles[profile].candidates.length,
			]),
		) as Record<ModelAssignmentProfile, number>,
		profilePrimaries: Object.fromEntries(
			PROFILE_ORDER.map((profile) => [profile, plan.profiles[profile].primary]),
		) as Record<ModelAssignmentProfile, string | null>,
		warnings: plan.warnings,
	};
}

type ModelAssignmentProfileExportRuntimeTarget = Exclude<
	ModelAssignmentProfileExportTarget,
	"both"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProfile(value: unknown): value is ModelAssignmentProfile {
	return PROFILE_ORDER.includes(value as ModelAssignmentProfile);
}

function isPlanCandidate(value: unknown): value is ModelAssignmentCandidate {
	if (!isRecord(value)) return false;
	return (
		typeof value.provider === "string" &&
		typeof value.model === "string" &&
		typeof value.ref === "string" &&
		typeof value.score === "number" &&
		Array.isArray(value.reasons) &&
		value.reasons.every((reason) => typeof reason === "string") &&
		(value.name === undefined || typeof value.name === "string")
	);
}

function isPlanProfile(value: unknown): value is ModelAssignmentProfilePlan {
	if (!isRecord(value)) return false;
	return (
		isProfile(value.profile) &&
		typeof value.purpose === "string" &&
		Array.isArray(value.phases) &&
		value.phases.every((phase) => typeof phase === "string") &&
		(value.primary === null || typeof value.primary === "string") &&
		Array.isArray(value.candidates) &&
		value.candidates.every(isPlanCandidate)
	);
}

function isRoutingRow(value: unknown): value is ModelAssignmentRoutingRow {
	if (!isRecord(value)) return false;
	return (
		typeof value.phase === "string" &&
		isProfile(value.profile) &&
		(value.primary === null || typeof value.primary === "string")
	);
}

function parseModelAssignmentPlan(
	content: string,
	inputPath: string,
): ModelAssignmentPlan {
	let value: unknown;
	try {
		value = JSON.parse(content) as unknown;
	} catch {
		throw new Error(`${inputPath} is not valid profile-plan JSON`);
	}
	if (!isRecord(value)) {
		throw new Error(`${inputPath} is not a model assignment profile plan`);
	}
	const profiles = value.profiles;
	if (!isRecord(profiles)) {
		throw new Error(`${inputPath} is not a model assignment profile plan`);
	}
	if (
		typeof value.generatedAt !== "string" ||
		typeof value.inputPath !== "string" ||
		typeof value.sourceKind !== "string" ||
		typeof value.passModels !== "number" ||
		typeof value.maxCandidatesPerProfile !== "number" ||
		!Array.isArray(value.routing) ||
		!value.routing.every(isRoutingRow) ||
		!Array.isArray(value.warnings) ||
		!value.warnings.every((warning) => typeof warning === "string") ||
		!PROFILE_ORDER.every((profile) => isPlanProfile(profiles[profile]))
	) {
		throw new Error(`${inputPath} is not a model assignment profile plan`);
	}
	return value as unknown as ModelAssignmentPlan;
}

function exportWarnings(
	target: ModelAssignmentProfileExportRuntimeTarget,
): string[] {
	const targetLabel = target === "pi" ? "Pi" : "OpenCode";
	return [
		"Advisory preview only: this file is not runtime configuration and is not applied automatically.",
		`Review and manually merge this ${targetLabel} draft only if its provider references are valid for your local setup.`,
		"No secrets, credentials, auth state, provider state, or runtime configuration were read or written.",
	];
}

function exportProfiles(
	plan: ModelAssignmentPlan,
): Record<ModelAssignmentProfile, ModelAssignmentProfileExportProfile> {
	return Object.fromEntries(
		PROFILE_ORDER.map((profile) => {
			const source = plan.profiles[profile];
			const exported: ModelAssignmentProfileExportProfile = {
				profile: source.profile,
				purpose: source.purpose,
				phases: source.phases,
				primaryRef: source.primary,
				candidates: source.candidates.map((candidate) => ({
					provider: candidate.provider,
					model: candidate.model,
					name: candidate.name,
					ref: candidate.ref,
				})),
			};
			return [profile, exported];
		}),
	) as Record<ModelAssignmentProfile, ModelAssignmentProfileExportProfile>;
}

function createOverlay(
	plan: ModelAssignmentPlan,
	sourcePlanPath: string,
	target: ModelAssignmentProfileExportRuntimeTarget,
	now: Date,
): ModelAssignmentProfileOverlay {
	return {
		generatedAt: now.toISOString(),
		sourcePlanPath,
		target,
		profiles: exportProfiles(plan),
		routing: plan.routing,
		warnings: [...plan.warnings, ...exportWarnings(target)],
	};
}

function renderCodexProfileExport(
	plan: ModelAssignmentPlan,
	sourcePlanPath: string,
	now: Date,
): string {
	const warnings = [
		...plan.warnings,
		"Advisory report only: this file is not a Codex configuration and is not applied automatically.",
		"The provider/model references in this plan are not Codex GPT-5.6 model IDs; do not copy them into Codex model settings.",
		"No secrets, credentials, auth state, provider state, or runtime configuration were read or written.",
	];
	const lines = [
		"# Codex Model Profile Export Preview",
		"",
		"## Metadata",
		"",
		`- generatedAt: \`${now.toISOString()}\``,
		`- sourcePlanPath: \`${sourcePlanPath}\``,
		"- target: `codex`",
		"",
		"## Profiles",
		"",
	];
	for (const profile of PROFILE_ORDER) {
		const source = plan.profiles[profile];
		lines.push(
			`### ${profile}`,
			"",
			`Primary ref: \`${source.primary ?? "n/a"}\``,
			"",
		);
		lines.push("| Candidate | Provider | Model |", "| --- | --- | --- |");
		if (source.candidates.length === 0) {
			lines.push("| n/a | n/a | n/a |");
		} else {
			for (const candidate of source.candidates) {
				lines.push(
					`| ${candidate.ref} | ${candidate.provider} | ${candidate.model} |`,
				);
			}
		}
		lines.push("");
	}
	lines.push(
		"## Routing",
		"",
		"| Phase | Profile | Primary ref |",
		"| --- | --- | --- |",
	);
	for (const row of plan.routing) {
		lines.push(`| ${row.phase} | ${row.profile} | ${row.primary ?? "n/a"} |`);
	}
	lines.push(
		"",
		"## Warnings",
		"",
		...warnings.map((warning) => `- ${warning}`),
		"",
	);
	return `${lines.join("\n")}\n`;
}

function targetFiles(
	outputDir: string,
	target: ModelAssignmentProfileExportTarget,
): string[] {
	if (target === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.PI) {
		return [join(outputDir, "pi.model-profiles.generated.json")];
	}
	if (target === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.OPENCODE) {
		return [join(outputDir, "opencode.model-profiles.generated.json")];
	}
	if (target === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.CODEX) {
		return [join(outputDir, "codex.model-profiles.generated.md")];
	}
	return [
		join(outputDir, "pi.model-profiles.generated.json"),
		join(outputDir, "opencode.model-profiles.generated.json"),
	];
}

export async function writeModelAssignmentProfileExport(
	options: WriteModelAssignmentProfileExportOptions,
): Promise<WriteModelAssignmentProfileExportResult> {
	const inputPath = resolvePath(options.inputPath);
	const outputDir = resolvePath(options.outputDir ?? dirname(inputPath));
	const target = options.target;
	const dryRun = options.dryRun ?? false;
	const now = options.now ?? new Date();
	const plan = parseModelAssignmentPlan(
		await readFile(inputPath, "utf8"),
		inputPath,
	);
	const files = targetFiles(outputDir, target);
	const warnings = [
		...plan.warnings,
		...(target === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.CODEX
			? [
					"Codex export is report-only because OpenCode/Pi provider references are not Codex GPT-5.6 model IDs.",
				]
			: target === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.BOTH
				? [...exportWarnings("pi"), ...exportWarnings("opencode")]
				: exportWarnings(target)),
	];

	if (!dryRun) {
		await mkdir(outputDir, { recursive: true });
		await assertGeneratedFilesDoNotExist(files);
		if (target === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.CODEX) {
			await writeGeneratedFile(
				join(outputDir, "codex.model-profiles.generated.md"),
				renderCodexProfileExport(plan, inputPath, now),
			);
		} else {
			const targets: ModelAssignmentProfileExportRuntimeTarget[] =
				target === MODEL_ASSIGNMENT_PROFILE_EXPORT_TARGET.BOTH
					? ["pi", "opencode"]
					: [target];
			for (const runtimeTarget of targets) {
				const path =
					runtimeTarget === "pi"
						? join(outputDir, "pi.model-profiles.generated.json")
						: join(outputDir, "opencode.model-profiles.generated.json");
				const overlay = createOverlay(plan, inputPath, runtimeTarget, now);
				await writeGeneratedFile(path, `${JSON.stringify(overlay, null, 2)}\n`);
			}
		}
	}

	return {
		inputPath,
		outputDir,
		target,
		dryRun,
		wrote: !dryRun,
		files,
		warnings,
	};
}
