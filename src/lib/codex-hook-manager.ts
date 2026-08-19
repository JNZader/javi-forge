/**
 * Codex PreToolUse ownership manager (agent-agnostic slice 2). Installs the
 * SAME shipped SkillGuard `.mjs` asset as a Codex `PreToolUse` hook by writing
 * `~/.codex/hooks.json` + setting `[features] hooks = true` in
 * `~/.codex/config.toml`, through the identical secure-fs transaction the Claude
 * installer uses (no weaker path). It NEVER modifies the guard asset, the pure
 * `evaluate*` engine, or Claude's observable behavior.
 *
 * TRUST (highest-risk surface — engram id 15743, codex-cli 0.147.0, verified
 * live 2026-08-18): codex hooks are stable + default-ON, but each hook needs a
 * `trusted_hash` recorded in `config.toml` under
 * `[hooks.state."<abs-hook-path>:pre_tool_use:0:0"]`; an UNTRUSTED hook is
 * SILENTLY SKIPPED unless `--dangerously-bypass-hook-trust`. There is NO
 * `codex hooks trust` subcommand (confirmed: `codex --help` has no `hooks`
 * command). So we DO NOT compute-and-write a trusted_hash we cannot prove
 * reproducible (a wrong-but-present hash would leave the hook skipped while
 * making doctor believe it is trusted — the exact fail-open theater this arc
 * exists to kill). Instead: install writes the files + REPORTS the trust step,
 * and the doctor DETECTS the missing trust entry and reports `blocked`
 * (untrusted = NOT running).
 *
 * STALE-HASH INVALIDATION: the trust key path is STABLE across upgrades, so a
 * rewrite of hooks.json (asset/command/timeout change) leaves the recorded
 * `trusted_hash` stale — Codex silently skips the hook while the header
 * persists (doctor would wrongly stay `trusted`). So whenever install/repair
 * REWRITES the managed hooks.json, it REMOVES our `[hooks.state."<hooksFile>:*"]`
 * table(s) in the same transactional config write (foreign rows untouched),
 * reverting the doctor to `untrusted → blocked` until the user re-approves. An
 * idempotent no-op install (unchanged hook content) never touches the table.
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

/**
 * True when `config.toml` records a trust table for THIS hook path, i.e. a
 * `[hooks.state."<hooksFile>:pre_tool_use:0:0"]` header. Fail-closed: a trust
 * entry for a different path does not count.
 *
 * NOTE (fail-open the arc kills): presence of the header is NOT proof the hook
 * is still trusted — Codex records a `trusted_hash` under it, and a hook whose
 * content was rewritten (e.g. an asset/command/timeout upgrade) has a STALE hash
 * → Codex silently skips it and re-prompts. We cannot recompute Codex's hash to
 * compare here, so instead the installer INVALIDATES this table whenever it
 * rewrites the managed hooks.json (see `removeCodexTrustEntries`), reverting the
 * doctor to `untrusted → blocked` until the user re-approves in codex.
 */
export function hasCodexTrustEntry(text: string, hooksFile: string): boolean {
	const needle = `${hooksFile}:pre_tool_use:0:0`;
	for (const line of text.split(/\r?\n/)) {
		const header = TABLE_HEADER.exec(line);
		if (!header) continue;
		const inner = header[1].trim();
		if (inner.startsWith("hooks.state.") && inner.includes(needle)) return true;
	}
	return false;
}

/**
 * Remove every `[hooks.state."<hooksFile>:*"]` table (header + body lines) keyed
 * on OUR managed hooks.json path, preserving all other content — including
 * FOREIGN `hooks.state` rows for other hooks files. Used to invalidate a now-
 * stale `trusted_hash` when the managed hooks.json content is rewritten: the
 * trust-key path is stable across upgrades, so a rewritten hook keeps its old
 * (now wrong) recorded hash and would be silently skipped by Codex while the
 * header persisted. Dropping the table forces the doctor back to `untrusted`
 * until the user re-approves the hook in codex.
 */
export function removeCodexTrustEntries(
	text: string,
	hooksFile: string,
): string {
	// Match the quoted path prefix so a path that merely has ours as a string
	// prefix (a different file) is never removed.
	const needle = `"${hooksFile}:`;
	const lines = text.split(/\r?\n/);
	const kept: string[] = [];
	let dropping = false;
	for (const line of lines) {
		const header = TABLE_HEADER.exec(line);
		if (header) {
			const inner = header[1].trim();
			dropping = inner.startsWith("hooks.state.") && inner.includes(needle);
			if (dropping) continue;
			kept.push(line);
			continue;
		}
		if (dropping) continue;
		kept.push(line);
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
	/(?:^|\s)node\s+\S*javi-forge-skillguard-pre-tool-use\.mjs\s+--agent=codex(?:\s|$)/;

export interface CodexHooksClassification {
	state: ClaudeHookComponentState;
	detail?: string;
}

/** Every `PreToolUse` handler across all groups, in order. */
function preToolUseHandlers(value: unknown): Record<string, unknown>[] {
	const hooks = isPlainObject(value) ? value.hooks : undefined;
	const groups =
		isPlainObject(hooks) && Array.isArray(hooks.PreToolUse)
			? hooks.PreToolUse
			: [];
	const handlers: Record<string, unknown>[] = [];
	for (const group of groups) {
		const list =
			isPlainObject(group) && Array.isArray(group.hooks) ? group.hooks : [];
		for (const h of list) if (isPlainObject(h)) handlers.push(h);
	}
	return handlers;
}

/**
 * Classify `hooks.json`. Reuses `validateSettingsShape` (the SAME settings-schema
 * validator the Claude classifier uses — the Codex hooks.json schema is
 * identical) and recognizes our managed handler by its exact command string.
 *   - malformed        → not a valid hooks container
 *   - managed-current  → our exact command present
 *   - released-outdated→ our guard present but at a stale asset path
 *   - foreign          → other PreToolUse handlers, none of them ours
 *   - absent           → no PreToolUse handlers at all (installable)
 */
export function classifyCodexHooksJson(
	value: unknown,
	expectedCommand: string,
): CodexHooksClassification {
	if (!validateSettingsShape(value)) return { state: "malformed" };
	const handlers = preToolUseHandlers(value);
	const ours = handlers.filter(
		(h) =>
			h.type === "command" &&
			typeof h.command === "string" &&
			CODEX_CMD_RE.test(h.command),
	);
	if (ours.some((h) => h.command === expectedCommand)) {
		return { state: "managed-current" };
	}
	if (ours.length > 0)
		return { state: "released-outdated", detail: "stale-path" };
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
 * Merge our managed group into an existing container: drop any prior managed
 * groups (ours, by command regex) and append a fresh one, preserving every
 * foreign group. A fresh install (no container) yields the clean container.
 */
function mergeCodexHooks(
	existing: unknown,
	assetPath: string,
): Record<string, unknown> {
	if (!isPlainObject(existing)) return buildCodexHooksContainer(assetPath);
	const container = structuredClone(existing) as Record<string, unknown>;
	if (!isPlainObject(container.hooks)) container.hooks = {};
	const hooks = container.hooks as Record<string, unknown>;
	const groups = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
	const kept = groups.filter((group) => {
		const list =
			isPlainObject(group) && Array.isArray(group.hooks) ? group.hooks : [];
		const isOurs = list.some(
			(h) =>
				isPlainObject(h) &&
				h.type === "command" &&
				typeof h.command === "string" &&
				CODEX_CMD_RE.test(h.command),
		);
		return !isOurs;
	});
	const fresh = buildCodexHooksContainer(assetPath).hooks as {
		PreToolUse: unknown[];
	};
	hooks.PreToolUse = [...kept, ...fresh.PreToolUse];
	return container;
}

// =============================================================================
// Doctor (execution matrix — reuses ExecutionReport runnable|blocked|inconclusive)
// =============================================================================

export type CodexTrustState = "trusted" | "untrusted";

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

const EXECUTION_RESIDUAL: readonly string[] = [
	'the installed hook is command-form (command: "node …"): node is resolved from Codex\'s PATH, which this process cannot observe — the node-on-PATH row is a heuristic proxy, never proof the guard will spawn',
	"an untrusted hook is silently skipped by Codex unless run with --dangerously-bypass-hook-trust; trust is recorded in ~/.codex/config.toml [hooks.state] and is not settable non-interactively",
	"a fresh install OR any upgrade that rewrites hooks.json invalidates the recorded trust hash (it would otherwise go stale and be silently skipped) — you MUST re-approve the hook in codex before it runs again",
];

async function readText(
	target: string,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
	const read = await safeReadFile(target, READ_OPTS);
	if (read.ok) return { ok: true, text: read.content };
	return { ok: false, reason: read.reason };
}

export interface CodexDoctorOptions {
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
	homeDir: string = os.homedir(),
	options: CodexDoctorOptions = {},
): Promise<CodexHookDoctorReport> {
	const manifest = options.manifest ?? (await readManifest());
	const assetPath = options.assetPath ?? SHIPPED_CODEX_ASSET;
	const { hooksFile, configFile } = codexConfigPaths(homeDir);
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
	const trusted = configRead.ok && hasCodexTrustEntry(configText, hooksFile);

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
	// THE fail-open guard: an untrusted hook is silently skipped → NOT running.
	if (!trusted) blockers.push("trust:untrusted (hook is silently skipped)");
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
	if (!trusted) remediation.push(codexTrustGrantCommand(hooksFile));
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
			state: trusted ? "trusted" : "untrusted",
			grantCommand: codexTrustGrantCommand(hooksFile),
		},
		remediation: [...new Set(remediation)],
	};
}

// =============================================================================
// Install / repair (secure-fs transaction — SAME ancestor gate as Claude)
// =============================================================================

export interface CodexHookMutationResult {
	ok: boolean;
	changed: string[];
	backups: string[];
	report: CodexHookDoctorReport;
	errors: string[];
	warnings: string[];
}

export interface CodexHookRunDeps {
	secureFs?: PlatformSecureFs | null;
	clock?: () => Date;
	nonce?: () => string;
	manifest?: Manifest;
	platform?: NodeJS.Platform;
	assetPath?: string;
	nodeProbe?: () => Promise<NodeOnPathProbe>;
	nodeSpawn?: SpawnFn;
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
	const manifest = deps.manifest ?? (await readManifest());
	const platform = deps.platform ?? process.platform;
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
	const doctor = (): Promise<CodexHookDoctorReport> =>
		doctorCodexPreToolUse(homeDir, {
			manifest,
			assetPath,
			nodeProbe: async () => nodeOnPath,
		});

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

	// Build desired bytes (null = no change for that component).
	const hooksDesired =
		hooksState.state === "managed-current"
			? null
			: serialize(
					mergeCodexHooks(
						hooksRead.ok ? JSON.parse(hooksRead.text) : undefined,
						assetPath,
					),
				);
	// When the managed hooks.json content changes, any recorded trust hash for
	// OUR hooks path is now stale — Codex would silently skip the rewritten hook
	// while the header persisted. Invalidate that trust table in the SAME write
	// so the doctor honestly reverts to `untrusted → blocked` until re-approval.
	// An idempotent no-op install (hook content unchanged) leaves trust intact.
	const hookContentChanged = hooksDesired !== null;
	let nextConfig = configText;
	if (hookContentChanged) {
		nextConfig = removeCodexTrustEntries(nextConfig, hooksFile);
	}
	nextConfig = mergeFeaturesHooksTrue(nextConfig);
	const configDesired =
		configExisted && nextConfig === configText
			? null
			: Buffer.from(nextConfig, "utf8");

	// Untrusted-after-install warning (report-the-trust-step).
	const warnings: string[] = [
		`the codex hook is installed but NOT yet trusted — ${codexTrustGrantCommand(hooksFile)}`,
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

export function installCodexPreToolUse(
	homeDir: string = os.homedir(),
): Promise<CodexHookMutationResult> {
	return _runCodex(homeDir, "install", {}, {});
}

export function repairCodexPreToolUse(
	homeDir: string = os.homedir(),
	options?: { force?: boolean },
): Promise<CodexHookMutationResult> {
	return _runCodex(homeDir, "repair", options ?? {}, {});
}
