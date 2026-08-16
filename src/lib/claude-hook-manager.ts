/**
 * Read-only Claude PreToolUse ownership manager (Slice 2). Its only filesystem
 * surface is `safeReadFile` plus one isolated no-follow `lstat` helper — it never
 * writes, creates directories, or makes backups. It owns asset byte
 * classification (always recompute the full-file SHA), the settings read+parse
 * wrapper (identity delegated to `claude-hook-settings`), the Node `>=22` check,
 * and the component-level doctor. Install/repair are declared but unimplemented
 * Slice-3 seams — Slice 3 GROWS this file, it does not relocate this code.
 */

import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import {
	ASSET_MANAGED_MARKER,
	ASSET_NAME,
} from "./__fixtures__/claude-hook-ownership.js";
import {
	type ClaudeHookComponentState,
	classifySettingsEntry,
	isPlainObject,
	LEGACY_FILE_SHA256,
	MANAGED_ASSET_ARG,
	MANAGED_MATCHER,
	MANAGED_STATUS_PREFIX,
	type SettingsClassification,
	type SettingsIdentityManifest,
} from "./claude-hook-settings.js";
import { safeReadFile } from "./safe-read.js";

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

// ---------------------------------------------------------------------------
// Slice-3 transaction seams (declared, unimplemented). Slice 3 grows this file
// with parent-chain gating, backups, temp/fsync/ACL/rename, and rollback.
// ---------------------------------------------------------------------------

export interface ClaudeHookMutationResult {
	ok: boolean;
	changed: string[];
	backups: string[];
	errors: string[];
}

export function installClaudePreToolUse(
	_projectDir: string,
): Promise<ClaudeHookMutationResult> {
	throw new Error("unimplemented: Slice 3 transaction");
}

export function repairClaudePreToolUse(
	_projectDir: string,
	_options?: { force?: boolean },
): Promise<ClaudeHookMutationResult> {
	throw new Error("unimplemented: Slice 3 transaction");
}
