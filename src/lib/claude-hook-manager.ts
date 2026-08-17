/**
 * Read-only Claude PreToolUse ownership manager (Slice 2). Its only filesystem
 * surface is `safeReadFile` plus one isolated no-follow `lstat` helper — it never
 * writes, creates directories, or makes backups. It owns asset byte
 * classification (always recompute the full-file SHA), the settings read+parse
 * wrapper (identity delegated to `claude-hook-settings`), the Node `>=22` check,
 * and the component-level doctor. Install/repair are declared but unimplemented
 * Slice-3 seams — Slice 3 GROWS this file, it does not relocate this code.
 */

import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import {
	ASSET_MANAGED_MARKER,
	ASSET_NAME,
} from "./__fixtures__/claude-hook-ownership.js";
import {
	buildManagedContainer,
	type ClaudeHookComponentState,
	classifySettingsEntry,
	isPlainObject,
	LEGACY_FILE_SHA256,
	type LegacyCohortExcisionPlan,
	MANAGED_ASSET_ARG,
	MANAGED_MATCHER,
	MANAGED_STATUS_PREFIX,
	planForceReplace,
	planLegacyCohortExcision,
	planManagedClaudeHookMerge,
	type SettingsClassification,
	type SettingsIdentityManifest,
} from "./claude-hook-settings.js";
import { safeReadFile } from "./safe-read.js";
import { selectSecureFs } from "./secure-fs-posix.js";
import {
	type PlatformSecureFs,
	runTransaction,
	type TransactionComponent,
} from "./secure-fs-transaction.js";

/** 1 MiB read budget, shared with the runtime's stdin envelope. */
const ASSET_MAX_BYTES = 1024 * 1024;
const NODE_MINIMUM_MAJOR = 22;
const READ_OPTS = {
	maxBytes: ASSET_MAX_BYTES,
	hardRejectOverBytes: ASSET_MAX_BYTES,
	maxLineLength: Number.POSITIVE_INFINITY,
} as const;

const COVERAGE = ["Bash", "PowerShell", "Read", "Write", "Edit"] as const;
const HOST_RESIDUAL =
	"spawn/start/timeout failures continue through Claude permission flow";
const ASSET_SHA_TOKEN = /^[0-9a-f]{64}$/;

export interface AssetManifestEntry {
	name: string;
	version: number;
	sha256: string;
	historical: string[];
}

export interface Manifest {
	asset: AssetManifestEntry;
	settingsEntries: SettingsIdentityManifest;
}

export interface ClaudeHookAssetClassification {
	state: ClaudeHookComponentState;
	version?: number;
	sha256?: string;
	detail?: string;
}

export interface ClaudeHookDoctorReport {
	healthy: boolean;
	settings: {
		state: ClaudeHookComponentState;
		version?: number;
		canonicalSha256?: string;
		detail: string;
	};
	asset: {
		state: ClaudeHookComponentState;
		version?: number;
		sha256?: string;
		detail: string;
	};
	node: { available: boolean; version?: string; satisfiesMinimum: boolean };
	matcherExact: boolean;
	commandShapeExact: boolean;
	assetSettingsConsistent: boolean;
	coverage: typeof COVERAGE;
	hostResidual: string;
	remediation: readonly string[];
	// Slice 4 adds: execution: { status; blockers; unknownSources }.
}

// The single non-`safe-read` fs surface, confined to one helper.
type LstatKind =
	| { kind: "enoent" }
	| { kind: "symlink" }
	| { kind: "non-regular" }
	| { kind: "file" }
	| { kind: "error"; detail: string };

async function lstatNoFollow(target: string): Promise<LstatKind> {
	try {
		const stats = await lstat(target);
		if (stats.isSymbolicLink()) return { kind: "symlink" };
		if (!stats.isFile()) return { kind: "non-regular" };
		return { kind: "file" };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return { kind: "enoent" };
		return { kind: "error", detail: code ?? String(error) };
	}
}

/** Hash the observed bytes as UTF-8, matching the manifest's raw-file hash for the managed asset. */
function sha256Of(content: string): string {
	return createHash("sha256")
		.update(Buffer.from(content, "utf8"))
		.digest("hex");
}

/**
 * Classify the asset into one of nine states from observed bytes only. Never
 * trusts a claimed hash: the full-file SHA is always recomputed and compared to
 * the manifest.
 */
export async function classifyAssetState(
	assetPath: string,
	manifest: Manifest,
): Promise<ClaudeHookAssetClassification> {
	const stat = await lstatNoFollow(assetPath);
	if (stat.kind === "enoent") return { state: "absent" };
	if (stat.kind === "symlink") return { state: "symlink" };
	if (stat.kind === "non-regular") return { state: "non-regular" };
	if (stat.kind === "error")
		return { state: "non-regular", detail: stat.detail };

	const read = await safeReadFile(assetPath, READ_OPTS);
	if (!read.ok) {
		if (read.reason === "not-found") return { state: "absent" };
		if (read.reason === "binary") return { state: "foreign", detail: "binary" };
		if (read.reason === "too-large") {
			return { state: "foreign", detail: "exceeds asset budget" };
		}
		return { state: "non-regular", detail: read.reason };
	}

	if (!read.content.startsWith(`${ASSET_MANAGED_MARKER}\n`)) {
		return { state: "foreign" };
	}
	const sha256 = sha256Of(read.content);
	if (sha256 === manifest.asset.sha256) {
		return {
			state: "managed-current",
			version: manifest.asset.version,
			sha256,
		};
	}
	if (manifest.asset.historical.includes(sha256)) {
		return {
			state: "released-outdated",
			version: manifest.asset.version,
			sha256,
		};
	}
	return { state: "edited-managed", sha256 };
}

/** Read `.claude/settings.json` and classify it (lstat → bounded read → legacy SHA → pure classifier). */
export async function classifySettingsFile(
	settingsPath: string,
	currentAssetSha: string,
	identities: SettingsIdentityManifest,
): Promise<SettingsClassification> {
	const parsed = await readSettings(settingsPath);
	if ("state" in parsed) return parsed.classification;
	return classifySettingsEntry(parsed.value, currentAssetSha, identities);
}

type SettingsRead =
	| { state: true; classification: SettingsClassification }
	| { value: unknown };

const done = (classification: SettingsClassification): SettingsRead => ({
	state: true,
	classification,
});

async function readSettings(settingsPath: string): Promise<SettingsRead> {
	const stat = await lstatNoFollow(settingsPath);
	if (stat.kind === "enoent") return done({ state: "absent" });
	if (stat.kind === "symlink") return done({ state: "symlink" });
	if (stat.kind === "non-regular") return done({ state: "non-regular" });
	if (stat.kind === "error") {
		return done({ state: "non-regular", detail: stat.detail });
	}

	const read = await safeReadFile(settingsPath, READ_OPTS);
	if (!read.ok) {
		if (read.reason === "not-found") return done({ state: "absent" });
		if (read.reason === "binary" || read.reason === "too-large") {
			return done({ state: "malformed", detail: read.reason });
		}
		return done({ state: "non-regular", detail: read.reason });
	}

	if (sha256Of(read.content) === LEGACY_FILE_SHA256) {
		return done({ state: "exact-legacy", detail: "whole-file" });
	}
	try {
		return { value: JSON.parse(read.content) };
	} catch {
		return done({ state: "malformed", detail: "invalid-json" });
	}
}

/** Node availability + `>=22` check from a version string (no spawn). */
export function detectNode(nodeVersion: string | undefined): {
	available: boolean;
	version?: string;
	satisfiesMinimum: boolean;
} {
	if (!nodeVersion) return { available: false, satisfiesMinimum: false };
	const major = Number.parseInt(nodeVersion.split(".")[0] ?? "", 10);
	return {
		available: true,
		version: nodeVersion,
		satisfiesMinimum: Number.isFinite(major) && major >= NODE_MINIMUM_MAJOR,
	};
}

interface SettingsSignals {
	matcherExact: boolean;
	commandShapeExact: boolean;
	assetSettingsConsistent: boolean;
}

const NO_SIGNALS: SettingsSignals = {
	matcherExact: false,
	commandShapeExact: false,
	assetSettingsConsistent: false,
};

/** Derive matcher/command/consistency signals from the marked handler, if any. */
function settingsSignals(
	value: unknown,
	classification: SettingsClassification,
	currentAssetSha: string,
): SettingsSignals {
	if (classification.groupIndex === undefined || !isPlainObject(value)) {
		return NO_SIGNALS;
	}
	const hooks = value.hooks;
	const groups =
		isPlainObject(hooks) && Array.isArray(hooks.PreToolUse)
			? hooks.PreToolUse
			: [];
	const group = groups[classification.groupIndex];
	if (!isPlainObject(group) || !Array.isArray(group.hooks)) return NO_SIGNALS;
	const handler = group.hooks[classification.handlerIndex ?? -1];
	if (!isPlainObject(handler)) return NO_SIGNALS;

	const args = handler.args;
	const commandShapeExact =
		handler.type === "command" &&
		handler.command === "node" &&
		Array.isArray(args) &&
		args.length === 1 &&
		args[0] === MANAGED_ASSET_ARG &&
		handler.timeout === 30;

	let assetSettingsConsistent = false;
	if (
		typeof handler.statusMessage === "string" &&
		handler.statusMessage.startsWith(MANAGED_STATUS_PREFIX)
	) {
		const token = handler.statusMessage.slice(MANAGED_STATUS_PREFIX.length);
		assetSettingsConsistent =
			ASSET_SHA_TOKEN.test(token) && token === currentAssetSha;
	}
	return {
		matcherExact: group.matcher === MANAGED_MATCHER,
		commandShapeExact,
		assetSettingsConsistent,
	};
}

const REMEDIATION: Partial<Record<ClaudeHookComponentState, string>> = {
	absent: "install the managed $ (Slice 3)",
	"released-outdated": "upgrade the managed $ (Slice 3)",
	"exact-legacy": "migrate the legacy $ (Slice 3)",
	"edited-managed": "repair the managed $ with --force (Slice 3)",
	foreign: "manually review the $",
	symlink: "manually review the $",
	"non-regular": "manually review the $",
	malformed: "manually review the $",
};

function remediationFor(
	state: ClaudeHookComponentState,
	component: "asset" | "settings",
): string | undefined {
	return REMEDIATION[state]?.replace("$", component);
}

/**
 * Assemble the read-only component-level doctor report (no writes). `healthy` is
 * exactly: both components `managed-current`, matcher and command shape exact,
 * Node `>=22`. `assetSettingsConsistent` is a reported advisory, NOT part of it.
 */
export async function doctorClaudePreToolUse(
	projectDir: string,
	options?: { manifest?: Manifest; nodeVersion?: string },
): Promise<ClaudeHookDoctorReport> {
	const manifest = options?.manifest ?? (await readManifest());
	const currentAssetSha = manifest.asset.sha256;

	const asset = await classifyAssetState(
		path.join(projectDir, ".claude", "hooks", ASSET_NAME),
		manifest,
	);
	const settingsRead = await readSettings(
		path.join(projectDir, ".claude", "settings.json"),
	);
	const settings =
		"state" in settingsRead
			? settingsRead.classification
			: classifySettingsEntry(
					settingsRead.value,
					currentAssetSha,
					manifest.settingsEntries,
				);
	const signals =
		"value" in settingsRead
			? settingsSignals(settingsRead.value, settings, currentAssetSha)
			: NO_SIGNALS;
	const node = detectNode(options?.nodeVersion ?? process.versions.node);

	const remediation = new Set<string>();
	if (asset.state !== "managed-current") {
		const line = remediationFor(asset.state, "asset");
		if (line) remediation.add(line);
	}
	if (settings.state !== "managed-current") {
		const line = remediationFor(settings.state, "settings");
		if (line) remediation.add(line);
	}
	if (!node.satisfiesMinimum) remediation.add("install Node 22 or newer");
	if (!signals.matcherExact)
		remediation.add("restore the exact managed matcher");
	if (!signals.commandShapeExact) {
		remediation.add("restore the exact managed command shape");
	}

	const healthy =
		settings.state === "managed-current" &&
		asset.state === "managed-current" &&
		signals.matcherExact &&
		signals.commandShapeExact &&
		node.satisfiesMinimum;

	return {
		healthy,
		settings: {
			state: settings.state,
			version: settings.version,
			canonicalSha256: settings.canonicalSha256,
			detail: settings.detail ?? settings.state,
		},
		asset: {
			state: asset.state,
			version: asset.version,
			sha256: asset.sha256,
			detail: asset.detail ?? asset.state,
		},
		node,
		matcherExact: signals.matcherExact,
		commandShapeExact: signals.commandShapeExact,
		assetSettingsConsistent: signals.assetSettingsConsistent,
		coverage: COVERAGE,
		hostResidual: HOST_RESIDUAL,
		remediation: [...remediation].sort(),
	};
}

async function readManifest(): Promise<Manifest> {
	const read = await safeReadFile(
		path.join(CLAUDE_HOOK_ASSETS_DIR, "manifest.json"),
		READ_OPTS,
	);
	if (!read.ok)
		throw new Error(`unreadable claude-hooks manifest: ${read.reason}`);
	return JSON.parse(read.content) as Manifest;
}

// Slice-3a transactional install/repair. The manager stays a thin orchestrator:
// classify (Slice 2) -> plan (Slice-2 planners + Slice-3a helpers) -> serialize
// -> delegate the irreversible I/O to runTransaction (opens no handle itself).

export interface ClaudeHookMutationResult {
	ok: boolean;
	changed: string[]; // absolute paths actually written/renamed
	backups: string[]; // absolute PERSISTENT backup paths — forced ops only
	report: ClaudeHookDoctorReport; // post-mutation doctor snapshot
	errors: string[]; // refusal/failure messages
}

/** Injectable deps so tests drive `_run` with a fake `PlatformSecureFs`. */
export interface ClaudeHookRunDeps {
	secureFs?: PlatformSecureFs | null;
	clock?: () => Date;
	nonce?: () => string; // 8 lowercase hex
	manifest?: Manifest;
	platform?: NodeJS.Platform;
}

type AssetPlan =
	| { kind: "noop" }
	| { kind: "write" }
	| { kind: "refuse"; reason: string };

type SettingsPlan =
	| { kind: "noop" }
	| { kind: "refuse"; reason: string }
	| { kind: "container"; container: unknown }
	| { kind: "install" }
	| { kind: "replace"; groupIndex: number; handlerIndex: number }
	| { kind: "excise"; plan: LegacyCohortExcisionPlan };

function refuseMessage(
	component: "asset" | "settings",
	state: ClaudeHookComponentState,
): string {
	const remedy = remediationFor(state, component);
	return `refuse ${component} in state ${state}${remedy ? ` — ${remedy}` : ""}`;
}

function resolveAssetPlan(
	state: ClaudeHookComponentState,
	forced: boolean,
): AssetPlan {
	switch (state) {
		case "absent":
		case "released-outdated":
			return { kind: "write" };
		case "managed-current":
			return { kind: "noop" };
		case "edited-managed":
			return forced
				? { kind: "write" }
				: { kind: "refuse", reason: refuseMessage("asset", state) };
		default:
			return { kind: "refuse", reason: refuseMessage("asset", state) };
	}
}

function resolveSettingsPlan(
	settingsRead: SettingsRead,
	currentAssetSha: string,
	forced: boolean,
	identities: SettingsIdentityManifest,
): SettingsPlan {
	if ("state" in settingsRead) {
		const state = settingsRead.classification.state;
		if (state === "absent" || state === "exact-legacy") {
			return {
				kind: "container",
				container: buildManagedContainer(currentAssetSha),
			};
		}
		return { kind: "refuse", reason: refuseMessage("settings", state) };
	}

	const value = settingsRead.value;
	const merge = planManagedClaudeHookMerge(value, currentAssetSha, identities);
	if (!merge.refused) {
		if (merge.action === "install") return { kind: "install" };
		if (merge.action === "noop") return { kind: "noop" };
		if (merge.action === "replace") {
			return {
				kind: "replace",
				groupIndex: merge.groupIndex as number,
				handlerIndex: merge.handlerIndex as number,
			};
		}
	}

	const cls = classifySettingsEntry(value, currentAssetSha, identities);
	if (cls.state === "exact-legacy") {
		const plan = planLegacyCohortExcision(value);
		return plan.refused
			? {
					kind: "refuse",
					reason: plan.reason ?? refuseMessage("settings", cls.state),
				}
			: { kind: "excise", plan };
	}
	if (cls.state === "edited-managed") {
		if (!forced)
			return { kind: "refuse", reason: refuseMessage("settings", cls.state) };
		const force = planForceReplace(value, currentAssetSha);
		if (force.refused) {
			return {
				kind: "refuse",
				reason: force.reason ?? refuseMessage("settings", cls.state),
			};
		}
		return {
			kind: "replace",
			groupIndex: force.groupIndex as number,
			handlerIndex: force.handlerIndex as number,
		};
	}
	return { kind: "refuse", reason: refuseMessage("settings", cls.state) };
}

function freshManagedGroup(currentAssetSha: string): Record<string, unknown> {
	return buildManagedContainer(currentAssetSha).hooks
		.PreToolUse[0] as unknown as Record<string, unknown>;
}

function ensureHooks(container: Record<string, unknown>): {
	PreToolUse: unknown[];
	PostToolUse?: unknown[];
} {
	if (!isPlainObject(container.hooks)) container.hooks = {};
	const hooks = container.hooks as Record<string, unknown>;
	if (!Array.isArray(hooks.PreToolUse)) hooks.PreToolUse = [];
	return hooks as { PreToolUse: unknown[]; PostToolUse?: unknown[] };
}

/** Build the desired settings container, preserving unrelated content. */
function applySettingsPlan(
	value: unknown,
	plan: SettingsPlan,
	currentAssetSha: string,
): unknown {
	if (plan.kind === "container") return plan.container;
	const container = structuredClone(value) as Record<string, unknown>;
	const group = freshManagedGroup(currentAssetSha);
	const hooks = ensureHooks(container);
	const pre = hooks.PreToolUse;

	if (plan.kind === "install") {
		pre.push(group);
		return container;
	}
	if (plan.kind === "replace") {
		const g = pre[plan.groupIndex] as Record<string, unknown>;
		g.matcher = MANAGED_MATCHER;
		(g.hooks as unknown[])[plan.handlerIndex] = (group.hooks as unknown[])[0];
		return container;
	}
	if (plan.kind !== "excise") return container;
	// excise: remove the proven cohort by descending index, then insert the group.
	const { removePreIndices, removePostIndices, insertPreAt } = plan.plan;
	for (const index of [...removePreIndices].sort((a, b) => b - a)) {
		pre.splice(index, 1);
	}
	const post = Array.isArray(hooks.PostToolUse) ? hooks.PostToolUse : [];
	for (const index of [...removePostIndices].sort((a, b) => b - a)) {
		post.splice(index, 1);
	}
	pre.splice(insertPreAt, 0, group);
	return container;
}

function serializeSettings(container: unknown): Buffer {
	return Buffer.from(`${JSON.stringify(container, null, 2)}\n`, "utf8");
}

/** Internal deps-taking entry; tests drive it with a fake `PlatformSecureFs`. */
export async function _run(
	projectDir: string,
	mode: "install" | "repair",
	options: { force?: boolean },
	deps: ClaudeHookRunDeps,
): Promise<ClaudeHookMutationResult> {
	const manifest = deps.manifest ?? (await readManifest());
	const platform = deps.platform ?? process.platform;
	const secureFs =
		deps.secureFs !== undefined ? deps.secureFs : selectSecureFs(platform);
	const clock = deps.clock ?? (() => new Date());
	const nonce = deps.nonce ?? (() => randomBytes(4).toString("hex"));
	const currentAssetSha = manifest.asset.sha256;

	const assetDestPath = path.join(projectDir, ".claude", "hooks", ASSET_NAME);
	const settingsPath = path.join(projectDir, ".claude", "settings.json");
	const assetSrcPath = path.join(CLAUDE_HOOK_ASSETS_DIR, ASSET_NAME);
	const doctor = (): Promise<ClaudeHookDoctorReport> =>
		doctorClaudePreToolUse(projectDir, { manifest });

	// Windows (or any platform without an adapter) refuses with zero mutation.
	if (!secureFs) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: ["windows-secure-object-unavailable"],
			report: await doctor(),
		};
	}

	// Classify both components with the Slice-2 read layer.
	const assetCls = await classifyAssetState(assetDestPath, manifest);
	const settingsRead = await readSettings(settingsPath);
	const settingsState = (
		"state" in settingsRead
			? settingsRead.classification
			: classifySettingsEntry(
					settingsRead.value,
					currentAssetSha,
					manifest.settingsEntries,
				)
	).state;

	const forced = mode === "repair" && options.force === true;
	const assetPlan = resolveAssetPlan(assetCls.state, forced);
	const settingsPlan = resolveSettingsPlan(
		settingsRead,
		currentAssetSha,
		forced,
		manifest.settingsEntries,
	);

	// A refusal on either component refuses the whole operation, zero mutation.
	if (assetPlan.kind === "refuse" || settingsPlan.kind === "refuse") {
		const reason =
			assetPlan.kind === "refuse"
				? assetPlan.reason
				: (settingsPlan as { kind: "refuse"; reason: string }).reason;
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: [reason],
			report: await doctor(),
		};
	}

	// Zero-write idempotent no-op: both components already current.
	if (assetPlan.kind === "noop" && settingsPlan.kind === "noop") {
		return {
			ok: true,
			changed: [],
			backups: [],
			errors: [],
			report: await doctor(),
		};
	}

	const assetWasAbsent = assetCls.state === "absent";
	const settingsWasAbsent =
		"state" in settingsRead && settingsRead.classification.state === "absent";
	const assetForced = forced && assetCls.state === "edited-managed";
	const settingsForced = forced && settingsState === "edited-managed";

	const desiredAsset =
		assetPlan.kind === "write" ? await readFile(assetSrcPath) : null;
	const desiredSettings =
		settingsPlan.kind === "noop"
			? null
			: serializeSettings(
					applySettingsPlan(
						"value" in settingsRead ? settingsRead.value : undefined,
						settingsPlan,
						currentAssetSha,
					),
				);

	const asset: TransactionComponent = {
		path: assetDestPath,
		desired: desiredAsset,
		capturePrior: assetPlan.kind === "write" && !assetWasAbsent,
		forceBackup: assetForced,
		wasAbsent: assetWasAbsent,
	};
	const settings: TransactionComponent = {
		path: settingsPath,
		desired: desiredSettings,
		capturePrior: settingsPlan.kind !== "noop" && !settingsWasAbsent,
		forceBackup: settingsForced,
		wasAbsent: settingsWasAbsent,
	};

	const tx = await runTransaction({
		secureFs,
		clock,
		nonce,
		projectDir,
		asset,
		settings,
	});

	return {
		ok: tx.ok,
		changed: tx.committed,
		backups: tx.backups,
		errors: tx.errors,
		report: await doctor(),
	};
}

export function installClaudePreToolUse(
	projectDir: string,
): Promise<ClaudeHookMutationResult> {
	return _run(projectDir, "install", {}, {});
}

export function repairClaudePreToolUse(
	projectDir: string,
	options?: { force?: boolean },
): Promise<ClaudeHookMutationResult> {
	return _run(projectDir, "repair", options ?? {}, {});
}
