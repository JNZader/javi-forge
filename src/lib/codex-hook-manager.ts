/**
 * Codex PreToolUse registration manager. Mutations use the same secure-fs
 * transaction as Claude; the guard asset itself is never modified here.
 *
 * Config coordinates and recorded hashes do not establish provider trust.
 * Without an authoritative identity/hash verifier, trust remains unknown.
 * Command-only updates retain every registration coordinate and config byte.
 * The provider must verify any retained hash against the changed command;
 * this manager never establishes trust or enables a disabled existing hook.
 */

import os from "node:os";
import path from "node:path";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import { ASSET_NAME } from "./__fixtures__/claude-hook-ownership.js";
import {
	type AssetManifestEntry,
	type Manifest as ClaudeManifest,
	classifyAssetState,
	detectNode,
	type ExecutionReport,
	type NodeOnPathProbe,
	probeNodeOnPath,
} from "./claude-hook-manager.js";
import {
	type ClaudeHookComponentState,
	isPlainObject,
	validateSettingsShape,
} from "./claude-hook-settings.js";
import {
	type PlatformSupport,
	resolvePlatformSupport,
} from "./platform-support.js";
import { safeReadFile } from "./safe-read.js";
import { type SpawnFn, selectSecureFs } from "./secure-fs-posix.js";
import {
	type PlatformSecureFs,
	runTransaction,
	type TransactionComponent,
} from "./secure-fs-transaction.js";

export type { NodeOnPathProbe };

const NODE_MINIMUM_MAJOR = 22;
const CODEX_TIMEOUT = 30;
/**
 * Matcher covering the two tools the guard must gate under Codex: `Bash`
 * (sensitive-command protection, drop-in) and `apply_patch` (managed-config
 * file-write protection, the S1 shim). PreToolUse fires on all tools; the
 * matcher narrows delivery to what we evaluate. (Confirmed against a real
 * codex-cli 0.147.0 run during S2.8.)
 */
const CODEX_MATCHER = "Bash|apply_patch";
const READ_OPTS = {
	maxBytes: 1024 * 1024,
	hardRejectOverBytes: 1024 * 1024,
	maxLineLength: Number.POSITIVE_INFINITY,
} as const;

/** The shipped, in-package guard asset the Codex hook references by ABSOLUTE path. */
export const SHIPPED_CODEX_ASSET = path.join(
	CLAUDE_HOOK_ASSETS_DIR,
	ASSET_NAME,
);

/** Codex manifest view — only the asset entry is needed for currency. */
export interface Manifest {
	asset: AssetManifestEntry;
}

export interface CodexConfigPaths {
	codexDir: string;
	hooksFile: string;
	configFile: string;
}

/** Resolve `~/.codex/{hooks.json,config.toml}` for a given home directory. */
export function codexConfigPaths(homeDir: string): CodexConfigPaths {
	const codexDir = path.join(homeDir, ".codex");
	return {
		codexDir,
		hooksFile: path.join(codexDir, "hooks.json"),
		configFile: path.join(codexDir, "config.toml"),
	};
}

/** The exact `command` string the managed Codex hook runs (single-string form). */
export function expectedCodexCommand(assetPath: string): string {
	return `node ${assetPath} --agent=codex`;
}

/** The interactive step that establishes hook trust (there is no non-interactive subcommand). */
export function codexTrustGrantCommand(hooksFile: string): string {
	return `run codex once and APPROVE the hook when prompted (records trust for ${hooksFile} in ~/.codex/config.toml), or pass --dangerously-bypass-hook-trust for vetted automation`;
}

// =============================================================================
// Pure config.toml helpers (minimal, targeted, fail-closed) — no TOML dep
// =============================================================================

const TABLE_HEADER = /^\s*\[([^[\]]+)\]\s*(?:#.*)?$/;
const HOOKS_LINE = /^\s*hooks\s*=\s*(true|false)\b/;

/** Read the `[features] hooks` flag: "true" | "false" | "absent". */
export function parseFeaturesHooks(text: string): "true" | "false" | "absent" {
	let inFeatures = false;
	for (const line of text.split(/\r?\n/)) {
		const header = TABLE_HEADER.exec(line);
		if (header) {
			inFeatures = header[1].trim() === "features";
			continue;
		}
		if (inFeatures) {
			const m = HOOKS_LINE.exec(line);
			if (m) return m[1] === "true" ? "true" : "false";
		}
	}
	return "absent";
}

/** Provider identity/hash verification is unavailable; presence is not trust. */
export function detectCodexTrust(): CodexTrustState {
	return "unknown";
}

/** Parse a complete quoted table key, never a substring or provider identity. */
function codexTrustTableKey(header: string): string | null {
	const match = /^hooks\.state\.("(?:[^"\\]|\\.)*"|'[^']*')$/.exec(header);
	if (!match) return null;
	try {
		return match[1].startsWith("'")
			? match[1].slice(1, -1)
			: JSON.parse(match[1]);
	} catch {
		return null;
	}
}

/** Invalidate only exact same-file PreToolUse records, not colliding keys. */
export function removeCodexTrustEntries(
	text: string,
	hooksFile: string,
): string {
	const prefix = `${hooksFile}:`;
	const kept: string[] = [];
	let dropping = false;
	for (const line of text.split(/\r?\n/)) {
		const header = TABLE_HEADER.exec(line);
		if (header) {
			const key = codexTrustTableKey(header[1].trim());
			dropping =
				key?.startsWith(prefix) === true &&
				/^pre_tool_use:\d+:\d+$/.test(key.slice(prefix.length));
		}
		if (!dropping) kept.push(line);
	}
	return kept.join("\n");
}

/**
 * Ensure `[features] hooks = true`, preserving all other content and idempotent
 * when already true. Only ever INSERTS a line or flips a `hooks = false` inside
 * `[features]`, so it can never corrupt unrelated TOML.
 */
export function mergeFeaturesHooksTrue(text: string): string {
	const current = parseFeaturesHooks(text);
	if (current === "true") return text;

	const lines = text.split(/\r?\n/);
	// Flip an existing `hooks = false` inside [features].
	if (current === "false") {
		let inFeatures = false;
		for (let i = 0; i < lines.length; i++) {
			const header = TABLE_HEADER.exec(lines[i]);
			if (header) {
				inFeatures = header[1].trim() === "features";
				continue;
			}
			if (inFeatures && HOOKS_LINE.exec(lines[i])) {
				lines[i] = "hooks = true";
				return lines.join("\n");
			}
		}
	}

	// [features] exists but has no hooks line → insert right after the header.
	for (let i = 0; i < lines.length; i++) {
		const header = TABLE_HEADER.exec(lines[i]);
		if (header && header[1].trim() === "features") {
			lines.splice(i + 1, 0, "hooks = true");
			return lines.join("\n");
		}
	}

	// No [features] table at all → append one.
	const base =
		text.length === 0 ? "" : text.endsWith("\n") ? text : `${text}\n`;
	return `${base}[features]\nhooks = true\n`;
}

// =============================================================================
// hooks.json classification (reuses the settings-schema validators)
// =============================================================================

const CODEX_CMD_RE =
	/^node\s+(?:\S*[/\\])?javi-forge-skillguard-pre-tool-use\.mjs\s+--agent=codex$/;

export interface CodexHooksClassification {
	state: ClaudeHookComponentState;
	detail?: string;
	/** Config locations only, not authoritative Codex trust identities. */
	groupIndex?: number;
	handlerIndex?: number;
}
interface CodexHandlerLocation {
	groupIndex: number;
	handlerIndex: number;
	group: Record<string, unknown>;
	handler: Record<string, unknown>;
}
function isManagedCodexHandler(handler: unknown): boolean {
	return (
		isPlainObject(handler) &&
		handler.type === "command" &&
		typeof handler.command === "string" &&
		CODEX_CMD_RE.test(handler.command)
	);
}

/** Every `PreToolUse` handler across all groups, in order. */
function preToolUseHandlers(value: unknown): CodexHandlerLocation[] {
	const hooks = isPlainObject(value) ? value.hooks : undefined;
	const groups =
		isPlainObject(hooks) && Array.isArray(hooks.PreToolUse)
			? hooks.PreToolUse
			: [];
	const handlers: CodexHandlerLocation[] = [];
	for (const [groupIndex, group] of groups.entries()) {
		const list =
			isPlainObject(group) && Array.isArray(group.hooks) ? group.hooks : [];
		for (const [handlerIndex, handler] of list.entries()) {
			if (isPlainObject(group) && isPlainObject(handler))
				handlers.push({ groupIndex, handlerIndex, group, handler });
		}
	}
	return handlers;
}

/**
 * Classify `hooks.json`. Reuses `validateSettingsShape` (the SAME settings-schema
 * validator the Claude classifier uses — the Codex hooks.json schema is
 * identical) and recognizes our managed handler by its exact command string.
 *   - malformed        → not a valid hooks container
 *   - managed-current  → one exact command + matcher + timeout registration
 *   - released-outdated→ owned registration differs from the canonical contract
 *   - foreign          → other PreToolUse handlers, none of them ours
 *   - absent           → no PreToolUse handlers at all (installable)
 */
export function classifyCodexHooksJson(
	value: unknown,
	expectedCommand: string,
): CodexHooksClassification {
	if (!validateSettingsShape(value)) return { state: "malformed" };
	const handlers = preToolUseHandlers(value);
	const ours = handlers.filter((entry) => isManagedCodexHandler(entry.handler));
	if (ours.length === 1) {
		const { group, handler, groupIndex, handlerIndex } = ours[0];
		if (
			handler.command === expectedCommand &&
			group.matcher === CODEX_MATCHER &&
			handler.timeout === CODEX_TIMEOUT
		) {
			return { state: "managed-current", groupIndex, handlerIndex };
		}
	}
	if (ours.length > 0)
		return { state: "released-outdated", detail: "noncanonical-registration" };
	if (handlers.length > 0)
		return { state: "foreign", detail: "no-managed-hook" };
	return { state: "absent" };
}

/** Build the fresh managed hooks.json container for a given asset path. */
function buildCodexHooksContainer(assetPath: string): Record<string, unknown> {
	return {
		hooks: {
			PreToolUse: [
				{
					matcher: CODEX_MATCHER,
					hooks: [
						{
							type: "command",
							command: expectedCodexCommand(assetPath),
							timeout: CODEX_TIMEOUT,
						},
					],
				},
			],
		},
	};
}

/**
 * Replace only a unique owned command in place; append only on initial install.
 * Callers must reject ambiguous shapes, ownership, matcher and timeout first.
 */
function mergeCodexHooks(
	existing: unknown,
	assetPath: string,
): Record<string, unknown> {
	if (!isPlainObject(existing)) return buildCodexHooksContainer(assetPath);
	const container = structuredClone(existing);
	const owned = preToolUseHandlers(container).find((entry) =>
		isManagedCodexHandler(entry.handler),
	);
	if (owned) {
		owned.handler.command = expectedCodexCommand(assetPath);
		return container;
	}
	if (!isPlainObject(container.hooks)) container.hooks = {};
	const hooks = container.hooks as Record<string, unknown>;
	const groups = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
	const fresh = buildCodexHooksContainer(assetPath).hooks as {
		PreToolUse: unknown[];
	};
	hooks.PreToolUse = [...groups, ...fresh.PreToolUse];
	return container;
}

/** Structural confidence only; foreign metadata remains opaque and untouched. */
function preservesCodexCoordinates(value: unknown): boolean {
	if (!validateSettingsShape(value) || !isPlainObject(value)) return false;
	if (value.hooks === undefined) return true;
	return (
		isPlainObject(value.hooks) &&
		Object.values(value.hooks).every(
			(groups) =>
				Array.isArray(groups) &&
				groups.every(
					(group: unknown) =>
						isPlainObject(group) &&
						(group.matcher === undefined ||
							typeof group.matcher === "string") &&
						Array.isArray(group.hooks) &&
						group.hooks.every(
							(handler: unknown) =>
								isPlainObject(handler) &&
								handler.type === "command" &&
								typeof handler.command === "string",
						),
				),
		)
	);
}

/** Recognize one explicit feature flag, not arbitrary TOML validity. */
function hasUnambiguousFeaturesHooks(text: string): boolean {
	let inFeatures = false;
	let tables = 0;
	let flags = 0;
	for (const line of text.split(/\r?\n/)) {
		const header = TABLE_HEADER.exec(line);
		if (header) {
			inFeatures = header[1].trim() === "features";
			if (inFeatures) tables++;
		} else if (inFeatures && /^\s*["']?hooks["']?\s*=/.test(line)) {
			if (!/^\s*hooks\s*=\s*(true|false)\s*(?:#.*)?$/.test(line)) return false;
			flags++;
		}
	}
	return tables === 1 && flags === 1;
}

// =============================================================================
// Doctor (execution matrix — reuses ExecutionReport runnable|blocked|inconclusive)
// =============================================================================

const CODEX_TRUST_STATE = {
	TRUSTED: "trusted",
	UNTRUSTED: "untrusted",
	UNKNOWN: "unknown",
} as const;
export type CodexTrustState =
	(typeof CODEX_TRUST_STATE)[keyof typeof CODEX_TRUST_STATE];

export interface CodexHookDoctorReport {
	healthy: boolean;
	hooksJson: { state: ClaudeHookComponentState; detail?: string };
	config: {
		featuresHooks: "true" | "false" | "absent";
		readable: boolean;
	};
	asset: { state: ClaudeHookComponentState; sha256?: string };
	node: { available: boolean; version?: string; satisfiesMinimum: boolean };
	nodeOnPath: NodeOnPathProbe;
	execution: ExecutionReport;
	trust: { state: CodexTrustState; grantCommand: string };
	remediation: string[];
}

export interface CodexHookDoctorRefusal {
	state: "unsupported-platform";
	healthy: false;
	platformSupport: PlatformSupport;
}

export type CodexHookDoctorResult =
	| CodexHookDoctorReport
	| CodexHookDoctorRefusal;

const EXECUTION_RESIDUAL: readonly string[] = [
	'the installed hook is command-form (command: "node …"): node is resolved from Codex\'s PATH, which this process cannot observe — the node-on-PATH row is a heuristic proxy, never proof the guard will spawn',
	"an untrusted hook is silently skipped by Codex unless run with --dangerously-bypass-hook-trust; trust is recorded in ~/.codex/config.toml [hooks.state] and is not settable non-interactively",
	"registration coordinates are config locations only; provider trust identity and hash validity cannot be verified here",
];

async function readText(
	target: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
	const read = await safeReadFile(target, READ_OPTS);
	if (read.ok) return { ok: true, text: read.content };
	return { ok: false, reason: read.reason };
}

export interface CodexDoctorOptions {
	platform?: NodeJS.Platform;
	manifest?: Manifest;
	assetPath?: string;
	nodeVersion?: string;
	nodeProbe?: () => Promise<NodeOnPathProbe>;
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

export async function doctorCodexPreToolUse(
	homeDir?: string,
	options: CodexDoctorOptions = {},
): Promise<CodexHookDoctorResult> {
	const platformSupport = resolvePlatformSupport(
		options.platform ?? process.platform,
	);
	if (platformSupport) {
		return {
			state: "unsupported-platform",
			healthy: false,
			platformSupport,
		};
	}
	const resolvedHomeDir = homeDir ?? os.homedir();
	const manifest = options.manifest ?? (await readManifest());
	const assetPath = options.assetPath ?? SHIPPED_CODEX_ASSET;
	const { hooksFile, configFile } = codexConfigPaths(resolvedHomeDir);
	const expectedCommand = expectedCodexCommand(assetPath);

	// hooks.json registration.
	const hooksRead = await readText(hooksFile);
	let hooksJson: CodexHooksClassification;
	if (!hooksRead.ok) {
		hooksJson =
			hooksRead.reason === "not-found"
				? { state: "absent" }
				: { state: "non-regular", detail: hooksRead.reason };
	} else {
		try {
			hooksJson = classifyCodexHooksJson(
				JSON.parse(hooksRead.text),
				expectedCommand,
			);
		} catch {
			hooksJson = { state: "malformed", detail: "invalid-json" };
		}
	}

	// config.toml features + trust.
	const configRead = await readText(configFile);
	const configReadable = configRead.ok || configRead.reason === "not-found";
	const configText = configRead.ok ? configRead.text : "";
	const featuresHooks = configRead.ok
		? parseFeaturesHooks(configText)
		: "absent";
	const trustState = detectCodexTrust();

	// asset currency (SAME shipped asset, hashed against the manifest).
	const claudeManifest: ClaudeManifest = {
		asset: manifest.asset,
		settingsEntries: { current: null, historical: [] },
	};
	const asset = await classifyAssetState(assetPath, claudeManifest);

	const node = detectNode(options.nodeVersion ?? process.versions.node);
	const nodeOnPath = await (options.nodeProbe ?? probeNodeOnPath)();

	const blockers: string[] = [];
	const unknownSources: string[] = [];

	if (!configReadable) blockers.push("config:unreadable");
	if (featuresHooks === "false") blockers.push("policy:features.hooks=false");
	unknownSources.push(
		"trust: provider identity/hash verification unavailable; recorded entries are not proof",
	);
	if (asset.state !== "managed-current")
		blockers.push(`guard:asset=${asset.state}`);
	if (hooksJson.state !== "managed-current") {
		blockers.push(`registration:hooks.json=${hooksJson.state}`);
	}
	if (nodeOnPath.status === "absent") {
		blockers.push("runtime:node-not-on-PATH (heuristic: this process' PATH)");
	} else if (
		nodeOnPath.status === "resolved" &&
		nodeOnPath.major < NODE_MINIMUM_MAJOR
	) {
		blockers.push(
			`runtime:node-on-PATH v${nodeOnPath.major} (<${NODE_MINIMUM_MAJOR}, heuristic)`,
		);
	} else if (nodeOnPath.status === "unknown") {
		unknownSources.push(
			`runtime:node-on-PATH (heuristic: ${nodeOnPath.detail})`,
		);
	}

	const status: ExecutionReport["status"] =
		blockers.length > 0
			? "blocked"
			: unknownSources.length > 0
				? "inconclusive"
				: "runnable";

	const remediation: string[] = [];
	if (hooksJson.state === "absent" || asset.state !== "managed-current") {
		remediation.push(
			"install the codex guard with: javi-forge hooks install codex",
		);
	}
	remediation.push(codexTrustGrantCommand(hooksFile));
	if (featuresHooks === "false") {
		remediation.push(
			"remove `[features] hooks = false` from ~/.codex/config.toml",
		);
	}
	if (!node.satisfiesMinimum) remediation.push("install Node 22 or newer");

	return {
		healthy: status === "runnable",
		hooksJson,
		config: { featuresHooks, readable: configReadable },
		asset: { state: asset.state, sha256: asset.sha256 },
		node,
		nodeOnPath,
		execution: {
			status,
			blockers,
			unknownSources,
			residual: [...EXECUTION_RESIDUAL],
		},
		trust: {
			state: trustState,
			grantCommand: codexTrustGrantCommand(hooksFile),
		},
		remediation: [...new Set(remediation)],
	};
}

// =============================================================================
// Install / repair (secure-fs transaction — SAME ancestor gate as Claude)
// =============================================================================

interface CodexHookMutationResultWithReport {
	ok: boolean;
	changed: string[];
	backups: string[];
	/** Real post-mutation doctor snapshot. */
	report: CodexHookDoctorReport;
	errors: string[];
	warnings: string[];
	lifecycleRefusal?: never;
}

interface CodexHookLifecycleRefusal {
	ok: false;
	changed: string[];
	backups: string[];
	errors: string[];
	warnings: string[];
	/** The lifecycle gate refused before any doctor or installed-state probe. */
	lifecycleRefusal: PlatformSupport;
	report?: never;
}

export type CodexHookMutationResult =
	| CodexHookMutationResultWithReport
	| CodexHookLifecycleRefusal;

export interface CodexHookRunDeps {
	homeDirProvider?: () => string;
	secureFs?: PlatformSecureFs | null;
	clock?: () => Date;
	nonce?: () => string;
	manifest?: Manifest;
	platform?: NodeJS.Platform;
	assetPath?: string;
	nodeProbe?: () => Promise<NodeOnPathProbe>;
	nodeSpawn?: SpawnFn;
	doctor?: typeof doctorCodexPreToolUse;
}

function serialize(container: unknown): Buffer {
	return Buffer.from(`${JSON.stringify(container, null, 2)}\n`, "utf8");
}

export async function _runCodex(
	homeDir: string,
	_mode: "install" | "repair",
	_options: { force?: boolean },
	deps: CodexHookRunDeps,
): Promise<CodexHookMutationResult> {
	const platform = deps.platform ?? process.platform;
	const platformSupport = resolvePlatformSupport(platform);
	if (platformSupport) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: [platformSupport.refusalCode],
			warnings: [platformSupport.guidance],
			lifecycleRefusal: platformSupport,
		};
	}
	const doctorFn = deps.doctor ?? doctorCodexPreToolUse;
	const manifest = deps.manifest ?? (await readManifest());
	const secureFs =
		deps.secureFs !== undefined ? deps.secureFs : selectSecureFs(platform);
	const clock = deps.clock ?? (() => new Date());
	const nonce =
		deps.nonce ??
		(() => Math.random().toString(16).slice(2, 10).padEnd(8, "0"));
	const assetPath = deps.assetPath ?? SHIPPED_CODEX_ASSET;
	const { codexDir, hooksFile, configFile } = codexConfigPaths(homeDir);
	const expectedCommand = expectedCodexCommand(assetPath);

	const nodeOnPath = await (deps.nodeProbe ?? probeNodeOnPath)();
	const doctor = async (): Promise<CodexHookDoctorReport> => {
		const result = await doctorFn(homeDir, {
			manifest,
			assetPath,
			nodeProbe: async () => nodeOnPath,
		});
		if ("state" in result) {
			throw new Error(
				"supported Codex lifecycle received unsupported doctor result",
			);
		}
		return result;
	};

	if (!secureFs) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: ["windows-secure-object-unavailable"],
			warnings: [],
			report: await doctor(),
		};
	}

	// Classify current state.
	const hooksRead = await readText(hooksFile);
	const hooksExisted = hooksRead.ok;
	let hooksState: CodexHooksClassification;
	if (!hooksRead.ok) {
		hooksState =
			hooksRead.reason === "not-found"
				? { state: "absent" }
				: { state: "non-regular", detail: hooksRead.reason };
	} else {
		try {
			hooksState = classifyCodexHooksJson(
				JSON.parse(hooksRead.text),
				expectedCommand,
			);
		} catch {
			hooksState = { state: "malformed", detail: "invalid-json" };
		}
	}
	if (hooksState.state === "malformed" || hooksState.state === "non-regular") {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: [
				`refuse hooks.json in state ${hooksState.state} — manual review`,
			],
			warnings: [],
			report: await doctor(),
		};
	}

	const configRead = await readText(configFile);
	const configExisted = configRead.ok;
	const configText = configRead.ok ? configRead.text : "";

	const existing: unknown = hooksRead.ok ? JSON.parse(hooksRead.text) : {};
	const owned = preToolUseHandlers(existing).filter((entry) =>
		isManagedCodexHandler(entry.handler),
	);
	let refusal: string | undefined;
	if (!preservesCodexCoordinates(existing))
		refusal = "unrecognized hooks.json shape";
	else if (!configRead.ok && configRead.reason !== "not-found")
		refusal = "unreadable config.toml";
	else if (owned.length > 1) refusal = "multiple owned registrations";
	else if (owned.length === 1) {
		if (
			owned[0].group.matcher !== CODEX_MATCHER ||
			owned[0].handler.timeout !== CODEX_TIMEOUT
		)
			refusal =
				"noncanonical matcher or timeout; command-only migration required";
		else if (!configRead.ok || !hasUnambiguousFeaturesHooks(configText))
			refusal = "ambiguous features.hooks configuration";
	} else if (parseFeaturesHooks(configText) === "false") {
		refusal = "features.hooks=false; initial installation must not enable it";
	} else if (
		configText.split(/\r?\n/).some((line) => {
			const header = TABLE_HEADER.exec(line);
			return (
				header !== null &&
				codexTrustTableKey(header[1].trim())?.startsWith(`${hooksFile}:`) ===
					true
			);
		})
	) {
		refusal = "recorded same-file trust without an owned registration";
	}
	if (refusal) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: [`refuse ${refusal} — manual review`],
			warnings: [],
			report: await doctor(),
		};
	}

	// Retain trust hashes/enablement verbatim. A changed command requires provider
	// verification; preserving a recorded hash is NOT approval of the new command.
	const hooksDesired =
		hooksState.state === "managed-current"
			? null
			: serialize(mergeCodexHooks(existing, assetPath));
	const nextConfig =
		owned.length === 1 ? configText : mergeFeaturesHooksTrue(configText);
	const configDesired =
		configExisted && nextConfig === configText
			? null
			: Buffer.from(nextConfig, "utf8");

	// Mutation success does not prove provider trust.
	const warnings: string[] = [
		`codex hook trust is unverified — ${codexTrustGrantCommand(hooksFile)}`,
	];

	if (hooksDesired === null && configDesired === null) {
		return {
			ok: true,
			changed: [],
			backups: [],
			errors: [],
			warnings,
			report: await doctor(),
		};
	}

	// `repair --force` mirrors Claude's force semantics: replace the managed file
	// after capturing a persistent backup of its prior content. It only has teeth
	// on a component that both PRE-EXISTED and is being rewritten this run.
	const forced = _mode === "repair" && _options.force === true;
	const components: TransactionComponent[] = [
		{
			path: hooksFile,
			desired: hooksDesired,
			capturePrior: hooksExisted && hooksDesired !== null,
			forceBackup: forced && hooksExisted && hooksDesired !== null,
			wasAbsent: !hooksExisted,
		},
		{
			path: configFile,
			desired: configDesired,
			capturePrior: configExisted && configDesired !== null,
			forceBackup: forced && configExisted && configDesired !== null,
			wasAbsent: !configExisted,
		},
	];

	const tx = await runTransaction({
		secureFs,
		clock,
		nonce,
		projectDir: homeDir,
		layout: { containers: [codexDir], components },
	});

	return {
		ok: tx.ok,
		changed: tx.committed,
		backups: tx.backups,
		errors: tx.errors,
		warnings,
		report: await doctor(),
	};
}

function unsupportedCodexLifecycle(
	platformSupport: PlatformSupport,
): CodexHookMutationResult {
	return {
		ok: false,
		changed: [],
		backups: [],
		errors: [platformSupport.refusalCode],
		warnings: [platformSupport.guidance],
		lifecycleRefusal: platformSupport,
	};
}

export function installCodexPreToolUse(
	homeDir?: string,
	deps: CodexHookRunDeps = {},
): Promise<CodexHookMutationResult> {
	const platformSupport = resolvePlatformSupport(
		deps.platform ?? process.platform,
	);
	if (platformSupport)
		return Promise.resolve(unsupportedCodexLifecycle(platformSupport));
	const resolvedHomeDir = homeDir ?? (deps.homeDirProvider ?? os.homedir)();
	return _runCodex(resolvedHomeDir, "install", {}, deps);
}

export function repairCodexPreToolUse(
	homeDir?: string,
	options?: { force?: boolean },
	deps: CodexHookRunDeps = {},
): Promise<CodexHookMutationResult> {
	const platformSupport = resolvePlatformSupport(
		deps.platform ?? process.platform,
	);
	if (platformSupport)
		return Promise.resolve(unsupportedCodexLifecycle(platformSupport));
	const resolvedHomeDir = homeDir ?? (deps.homeDirProvider ?? os.homedir)();
	return _runCodex(resolvedHomeDir, "repair", options ?? {}, deps);
}
