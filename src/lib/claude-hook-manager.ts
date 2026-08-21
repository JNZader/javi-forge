/**
 * Read-only Claude PreToolUse ownership manager (Slice 2). Its only filesystem
 * surface is `safeReadFile` plus one isolated no-follow `lstat` helper — it never
 * writes, creates directories, or makes backups. It owns asset byte
 * classification (always recompute the full-file SHA), the settings read+parse
 * wrapper (identity delegated to `claude-hook-settings`), the Node `>=22` check,
 * and the component-level doctor. Install/repair are declared but unimplemented
 * Slice-3 seams — Slice 3 GROWS this file, it does not relocate this code.
 */

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import os from "node:os";
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
	type FlagVerdict,
	isPlainObject,
	LEGACY_FILE_SHA256,
	type LegacyCohortExcisionPlan,
	MANAGED_AGENT_ARG,
	MANAGED_ASSET_ARG,
	MANAGED_MATCHER,
	MANAGED_STATUS_PREFIX,
	planForceReplace,
	planLegacyCohortExcision,
	planManagedClaudeHookMerge,
	type SettingsClassification,
	type SettingsIdentityManifest,
	scanExecutionFlags,
} from "./claude-hook-settings.js";
import {
	type PlatformSupport,
	resolvePlatformSupport,
} from "./platform-support.js";
import { safeReadFile } from "./safe-read.js";
import {
	ACL_DETAIL,
	type AclCapability,
	probeAclCapability,
	type SpawnFn,
	selectSecureFs,
} from "./secure-fs-posix.js";
import {
	type PlatformSecureFs,
	runTransaction,
	type TransactionComponent,
} from "./secure-fs-transaction.js";
import { remediationForRefusal } from "./secure-refusal-remediation.js";

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
	platformSupport?: PlatformSupport;
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
	execution: ExecutionReport;
	/**
	 * Host INSTALL-capability, reported as its own section. It answers "could
	 * install/repair run here?", NOT "will the installed guard fire?" — so it
	 * never feeds `execution`, `healthy`, or the exit code. A current, firing
	 * guard on an image without `getfacl` stays `runnable`.
	 */
	installCapability: { acl: AclCapability; remediation?: string };
	/**
	 * The node-on-PATH HEURISTIC row, always present so an absence is never
	 * silent. It is DISTINCT from `node` (which measures this process'
	 * `process.versions.node`) and it never inflates confidence: a `resolved`
	 * row clears no blocker and no unknown source.
	 */
	nodeOnPath: NodeOnPathProbe;
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
		args.length === 2 &&
		args[0] === MANAGED_ASSET_ARG &&
		args[1] === MANAGED_AGENT_ARG &&
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
	// User-facing remediation: name the exact command to run, never an internal
	// SDD slice number (which means nothing outside this repo's planning docs).
	absent: "install the managed $ with: javi-forge hooks install claude",
	"released-outdated":
		"upgrade the managed $ with: javi-forge hooks install claude",
	"exact-legacy": "migrate the legacy $ with: javi-forge hooks install claude",
	"edited-managed":
		"repair the managed $ with: javi-forge hooks repair claude --force",
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

// =============================================================================
// Effective-execution verdict (Slice 4b) — fail-closed
// =============================================================================

/**
 * The honest effective-execution verdict. `status` is derived by precedence
 * (blocked > inconclusive > runnable); `runnable` is reached only when every
 * relevant local source read clear AND the managed guard is current. `residual`
 * carries CONSTANT honest caveats (server-delivered policy, session safe-mode)
 * that are always shown but never gate the status — otherwise `runnable` would
 * be unreachable.
 */
export interface ExecutionReport {
	status: "runnable" | "blocked" | "inconclusive";
	blockers: string[];
	unknownSources: string[];
	residual: string[];
}

/**
 * Whether a `node` executable resolves on THIS process' PATH, independently of
 * `process.versions.node`. It is a HEURISTIC proxy for the PATH Claude Code will
 * use to spawn the exec-form handler — never proof of it.
 */
export type NodeOnPathProbe =
	| { status: "resolved"; version: string; major: number }
	| { status: "absent" }
	| { status: "unknown"; detail: string };

const NODE_PROBE_TIMEOUT_MS = 2000;
const NODE_PROBE_MAX_BUFFER = 64 * 1024;
const NODE_VERSION_LINE = /^v(\d+)\.\d+\.\d+/;

/**
 * Bounded `node --version` spawn. argv only (never a shell string), `LC_ALL=C`,
 * and a hard timeout — mirroring the ACL adapter's spawn discipline. It is
 * read-only: it starts a process and reads its stdout, and touches no path.
 */
const defaultNodeSpawn: SpawnFn = (cmd, args) =>
	new Promise((resolve) => {
		execFile(
			cmd,
			args,
			{
				timeout: NODE_PROBE_TIMEOUT_MS,
				maxBuffer: NODE_PROBE_MAX_BUFFER,
				encoding: "utf8",
				env: { ...process.env, LC_ALL: "C", LANG: "C" },
			},
			(error, stdout) => {
				if (!error) return resolve({ code: 0, stdout: stdout ?? "" });
				const e = error as NodeJS.ErrnoException & {
					killed?: boolean;
					signal?: NodeJS.Signals | null;
				};
				if (e.code === "ENOENT") {
					return resolve({ spawnError: true, code: null, stdout: "" });
				}
				if (e.killed || e.signal === "SIGTERM") {
					return resolve({ timedOut: true, code: null, stdout: stdout ?? "" });
				}
				const code = typeof e.code === "number" ? e.code : 1;
				return resolve({ code, stdout: stdout ?? "" });
			},
		);
	});

/**
 * Resolve and run `node --version` from this process' PATH. A spawn ENOENT is
 * `absent` (near-certainly a dead exec-form guard); a timeout, non-zero exit, or
 * unparseable banner is honest ignorance (`unknown`) and NEVER a fabricated
 * version.
 */
export async function probeNodeOnPath(
	spawn: SpawnFn = defaultNodeSpawn,
): Promise<NodeOnPathProbe> {
	const res = await spawn("node", ["--version"]);
	if (res.spawnError) return { status: "absent" };
	if (res.timedOut) {
		return { status: "unknown", detail: "node --version timeout" };
	}
	if (res.code !== 0) {
		return { status: "unknown", detail: `node --version exit ${res.code}` };
	}
	const banner = res.stdout.trim();
	const match = NODE_VERSION_LINE.exec(banner);
	if (!match) {
		return { status: "unknown", detail: "node --version output unparseable" };
	}
	return { status: "resolved", version: banner, major: Number(match[1]) };
}

/** Injectable seams so units never hard-read real `/etc` or `/Library`. */
export interface ExecutionProbeEnv {
	platform?: NodeJS.Platform;
	homeDir?: string;
	env?: NodeJS.ProcessEnv;
	/** Override the managed OS file (null → no managed file at all). */
	managedFile?: string | null;
	/** Override the managed drop-in dir (null → no drop-ins). */
	managedDropInDir?: string | null;
	/** Override the drop-in directory listing (defaults to a confined readdir). */
	listDir?: (dir: string) => Promise<string[]>;
	/** Injectable node-on-PATH heuristic (defaults to the real bounded probe). */
	nodeProbe?: () => Promise<NodeOnPathProbe>;
}

/** Per-source read outcome; never promotes an unobservable source to clear. */
export type ExecutionSourceProbe =
	| { kind: "clear" }
	| {
			kind: "blocking";
			flag: "disableAllHooks" | "allowManagedHooksOnly";
			/** Present only for a PRESENT-but-INVALID value; names the observed shape. */
			detail?: string;
	  }
	| { kind: "unknown"; reason: string };

/** The already-computed component states the guard-currency check consumes. */
export interface ExecutionComponentStates {
	asset: ClaudeHookComponentState;
	settings: ClaudeHookComponentState;
}

export interface ManagedSettingsPaths {
	file: string;
	dropInDir: string;
}

/** Static managed-settings locations per OS (no fs). WSL reports `linux`. */
export function resolveManagedSettingsPaths(
	platform: NodeJS.Platform,
): ManagedSettingsPaths {
	if (platform === "darwin") {
		const base = "/Library/Application Support/ClaudeCode";
		return {
			file: `${base}/managed-settings.json`,
			dropInDir: `${base}/managed-settings.d`,
		};
	}
	if (platform === "win32") {
		const base = "C:\\Program Files\\ClaudeCode";
		return {
			file: `${base}\\managed-settings.json`,
			dropInDir: `${base}\\managed-settings.d`,
		};
	}
	const base = "/etc/claude-code";
	return {
		file: `${base}/managed-settings.json`,
		dropInDir: `${base}/managed-settings.d`,
	};
}

/**
 * Probe one settings source path for the two documented hook-neutralizing
 * flags. Fail-closed: only a genuinely-absent path or a cleanly-parsed source
 * with no flag is `clear`; a symlink, non-regular path, permission/io error,
 * oversized/binary content, or malformed JSON is `unknown` (unreadable ≠
 * absent), never `clear`. `disableAllHooks` is preferred over
 * `allowManagedHooksOnly` when both are set (the former blocks at any source).
 */
export async function probeExecutionSource(
	target: string,
): Promise<ExecutionSourceProbe> {
	const stat = await lstatNoFollow(target);
	if (stat.kind === "enoent") return { kind: "clear" };
	if (stat.kind === "symlink") return { kind: "unknown", reason: "symlink" };
	if (stat.kind === "non-regular") {
		return { kind: "unknown", reason: "non-regular" };
	}
	if (stat.kind === "error") return { kind: "unknown", reason: stat.detail };

	const read = await safeReadFile(target, READ_OPTS);
	if (!read.ok) {
		if (read.reason === "not-found") return { kind: "clear" };
		return { kind: "unknown", reason: read.reason };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(read.content);
	} catch {
		return { kind: "unknown", reason: "invalid-json" };
	}

	const flags = scanExecutionFlags(parsed);
	const blocking = (
		flag: "disableAllHooks" | "allowManagedHooksOnly",
		verdict: FlagVerdict,
	): ExecutionSourceProbe => ({
		kind: "blocking",
		flag,
		// An INVALID value is blocking per the documented "invalid ⇒ true"
		// semantics; the shape is surfaced so an operator can see why (say) the
		// string "false" did not clear the flag.
		...(verdict.set && verdict.reason === "invalid"
			? { detail: `invalid value: ${verdict.shape} → treated as true` }
			: {}),
	});
	if (flags.disableAllHooks.set) {
		return blocking("disableAllHooks", flags.disableAllHooks);
	}
	if (flags.allowManagedHooksOnly.set) {
		return blocking("allowManagedHooksOnly", flags.allowManagedHooksOnly);
	}
	return { kind: "clear" };
}

/**
 * Confined readdir result of the managed drop-in dir, fail-closed and mirroring
 * `probeExecutionSource`'s errno classification: a genuinely-absent directory
 * (ENOENT/ENOTDIR) is the ONLY empty/clear case, so it yields `{ entries: [] }`
 * (no drop-ins). ANY other readdir failure (EACCES/EIO/ELOOP/…) means the
 * directory is present-but-unenumerable and MUST NOT be treated as empty — it
 * yields `{ unreadable: true }` so the caller can degrade the verdict, never
 * silently report "no drop-ins" (a false `runnable`).
 */
export type ManagedDropInListing =
	| { unreadable?: false; entries: string[] }
	| { unreadable: true; reason: string };

export async function listManagedDropIns(
	dir: string,
	listDir?: (dir: string) => Promise<string[]>,
): Promise<ManagedDropInListing> {
	let entries: string[];
	try {
		entries = listDir ? await listDir(dir) : await readdir(dir);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		// Only a genuinely-absent directory is "no drop-ins"; every other error
		// (permission/io/loop/etc.) is an unreadable managed source.
		if (code === "ENOENT" || code === "ENOTDIR") return { entries: [] };
		return { unreadable: true, reason: code ?? String(error) };
	}
	return {
		entries: entries
			.filter((name) => name.endsWith(".json"))
			.sort()
			.map((name) => path.join(dir, name)),
	};
}

/** CONSTANT honest limits — always rendered, never gate the status. */
const EXECUTION_RESIDUAL: readonly string[] = [
	"server-delivered managed policy can disable hooks and is not observable from local files",
	"session safe-mode (--safe-mode / CLAUDE_CODE_SAFE_MODE) in the diagnosed session is not observable from this process",
	'the installed hook is exec-form (command: "node"): node is resolved from Claude Code\'s PATH, which this process cannot observe — the node-on-PATH row is a heuristic proxy, never proof the guard will spawn',
];

function isSafeModeTruthy(env: NodeJS.ProcessEnv): boolean {
	const value = env.CLAUDE_CODE_SAFE_MODE;
	if (value === undefined) return false;
	const normalized = value.trim().toLowerCase();
	return normalized !== "" && normalized !== "0" && normalized !== "false";
}

interface ExecutionSourceSpec {
	label: string;
	target: string;
	managed: boolean;
}

/**
 * The fail-closed effective-execution verdict. Gathers all sources in stable
 * order (project, local, user, managed OS file, drop-ins sorted), classifies
 * each with `probeExecutionSource`, applies the managed-only inertness of
 * `allowManagedHooksOnly` (blocks only from a managed source — hooks MERGE
 * elsewhere), folds in the guard-currency blocker and the doctor-process
 * safe-mode observation, then resolves by precedence
 * (`blockers` first, then `unknownSources`, else `runnable`). An `unknown` is
 * NEVER promoted to `runnable`.
 */
export async function probeExecution(
	projectDir: string,
	componentStates: ExecutionComponentStates,
	env: ExecutionProbeEnv = {},
): Promise<ExecutionReport> {
	const platform = env.platform ?? process.platform;
	const homeDir = env.homeDir ?? os.homedir();
	const processEnv = env.env ?? process.env;
	const resolved = resolveManagedSettingsPaths(platform);
	const managedFile =
		env.managedFile !== undefined ? env.managedFile : resolved.file;
	const dropInDir =
		env.managedDropInDir !== undefined
			? env.managedDropInDir
			: resolved.dropInDir;

	const specs: ExecutionSourceSpec[] = [
		{
			label: "project",
			target: path.join(projectDir, ".claude", "settings.json"),
			managed: false,
		},
		{
			label: "local",
			target: path.join(projectDir, ".claude", "settings.local.json"),
			managed: false,
		},
		{
			label: "user",
			target: path.join(homeDir, ".claude", "settings.json"),
			managed: false,
		},
	];
	if (managedFile) {
		specs.push({ label: "managed", target: managedFile, managed: true });
	}
	// A present-but-unenumerable drop-in dir is an `unknown` managed source, NOT
	// "no drop-ins" — fold it into unknownSources so a blocking drop-in policy we
	// cannot read can never be mistaken for a clear (false `runnable`) verdict.
	let dropInDirUnknown: string | undefined;
	if (dropInDir) {
		const listing = await listManagedDropIns(dropInDir, env.listDir);
		if (listing.unreadable) {
			dropInDirUnknown = `managed:${dropInDir} (${listing.reason})`;
		} else {
			for (const target of listing.entries) {
				specs.push({ label: "managed", target, managed: true });
			}
		}
	}

	const blockers: string[] = [];
	const unknownSources: string[] = [];

	for (const spec of specs) {
		const probe = await probeExecutionSource(spec.target);
		if (probe.kind === "clear") continue;
		if (probe.kind === "unknown") {
			unknownSources.push(`${spec.label}:${spec.target} (${probe.reason})`);
			continue;
		}
		// `allowManagedHooksOnly` is inert outside a managed source (hooks merge).
		// An INVALID value there is inert for the same reason: the flag has no
		// authority outside a managed source, so it gains none by being malformed.
		if (probe.flag === "allowManagedHooksOnly" && !spec.managed) continue;
		blockers.push(
			`policy:${probe.flag}@${spec.label}${probe.detail ? ` (${probe.detail})` : ""}`,
		);
	}
	if (dropInDirUnknown) unknownSources.push(dropInDirUnknown);

	// Guard-currency: a not-installed / drifted guard cannot fire, so it blocks.
	if (componentStates.asset !== "managed-current") {
		blockers.push(`guard:asset=${componentStates.asset}`);
	}
	if (componentStates.settings !== "managed-current") {
		blockers.push(`guard:settings=${componentStates.settings}`);
	}

	// node-on-PATH heuristic (design Decision 2). The installed handler is
	// exec-form (`command: "node"`), so a `node` that does not resolve means the
	// guard NEVER fires — fail-closed, with the heuristic labelled in the entry.
	// A SUCCESSFUL probe contributes NOTHING: it clears no blocker, removes no
	// unknown source, and adds no confidence, because this process' PATH only
	// proxies the PATH Claude Code will use.
	const nodeOnPath = await (env.nodeProbe ?? probeNodeOnPath)();
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

	// Safe-mode observed in THIS doctor process is a real per-run unknown (the
	// diagnosed session's own safe-mode remains a constant residual).
	if (isSafeModeTruthy(processEnv)) {
		unknownSources.push(
			"safe-mode:CLAUDE_CODE_SAFE_MODE (observed in doctor process only)",
		);
	}

	const status: ExecutionReport["status"] =
		blockers.length > 0
			? "blocked"
			: unknownSources.length > 0
				? "inconclusive"
				: "runnable";

	return {
		status,
		blockers,
		unknownSources,
		residual: [...EXECUTION_RESIDUAL],
	};
}

/**
 * Assemble the read-only component-level doctor report (no writes). `healthy` is
 * exactly: both components `managed-current`, matcher and command shape exact,
 * Node `>=22`. `assetSettingsConsistent` is a reported advisory, NOT part of it.
 * The `execution` verdict is INDEPENDENT of `healthy`.
 */
export async function doctorClaudePreToolUse(
	projectDir: string,
	options?: {
		manifest?: Manifest;
		nodeVersion?: string;
		execution?: ExecutionProbeEnv;
		/** Injectable read-only ACL capability probe (defaults to the real one). */
		aclProbe?: () => Promise<AclCapability>;
		platform?: NodeJS.Platform;
	},
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

	// Probe node ONCE and share the outcome between the always-present report row
	// and the execution matrix, so the doctor never spawns `node` twice per run.
	const executionEnv = options?.execution ?? {};
	const nodeOnPath = await (executionEnv.nodeProbe ?? probeNodeOnPath)();
	const execution = await probeExecution(
		projectDir,
		{ asset: asset.state, settings: settings.state },
		{ ...executionEnv, nodeProbe: async () => nodeOnPath },
	);

	// Install-capability section. Read-only, and deliberately OUTSIDE the
	// execution matrix (design Decision 1): the installed `.mjs` guard never
	// spawns `getfacl`, so an absent adapter cannot stop a current guard from
	// firing. Only when a guard-currency blocker ALREADY exists does the
	// remediation join `report.remediation` — there the user must install and
	// cannot.
	const aclCapability = await (options?.aclProbe ?? probeAclCapability)();
	const aclRemediation =
		aclCapability.status === "absent" && aclCapability.tool === "getfacl"
			? remediationForRefusal("unsupported-posix-acl", ACL_DETAIL.getfaclAbsent)
			: undefined;
	if (
		aclRemediation &&
		execution.blockers.some((blocker) => blocker.startsWith("guard:"))
	) {
		remediation.add(aclRemediation);
	}

	const platformSupport = resolvePlatformSupport(
		options?.platform ?? process.platform,
	);
	return {
		...(platformSupport ? { platformSupport } : {}),
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
		execution,
		nodeOnPath,
		installCapability: {
			acl: aclCapability,
			...(aclRemediation ? { remediation: aclRemediation } : {}),
		},
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

interface ClaudeHookMutationResultWithReport {
	ok: boolean;
	changed: string[]; // absolute paths actually written/renamed
	backups: string[]; // absolute PERSISTENT backup paths — forced ops only
	report: ClaudeHookDoctorReport; // real post-mutation doctor snapshot
	errors: string[]; // refusal/failure messages
	/**
	 * NON-BLOCKING operator notices. A warning never changes `ok`: refusing to
	 * install because `node` may not resolve would leave the host with NO guard,
	 * which is strictly worse than an exec-form guard that may not resolve.
	 */
	warnings: string[];
	lifecycleRefusal?: never;
}

interface ClaudeHookLifecycleRefusal {
	ok: false;
	changed: string[];
	backups: string[];
	errors: string[];
	warnings: string[];
	/** The lifecycle gate refused before any doctor or installed-state probe. */
	lifecycleRefusal: PlatformSupport;
	report?: never;
}

export type ClaudeHookMutationResult =
	| ClaudeHookMutationResultWithReport
	| ClaudeHookLifecycleRefusal;

/** Injectable deps so tests drive `_run` with a fake `PlatformSecureFs`. */
export interface ClaudeHookRunDeps {
	secureFs?: PlatformSecureFs | null;
	clock?: () => Date;
	nonce?: () => string; // 8 lowercase hex
	manifest?: Manifest;
	platform?: NodeJS.Platform;
	/**
	 * Injectable read-only ACL capability probe, forwarded to the doctor report
	 * this run embeds. Same seam as `secureFs`/`clock`: it keeps unit tests from
	 * spawning the real `getfacl` (defaults to the real probe in production).
	 */
	aclProbe?: () => Promise<AclCapability>;
	/** Injectable node-on-PATH heuristic, shared by the warning and the report. */
	nodeProbe?: () => Promise<NodeOnPathProbe>;
	doctor?: typeof doctorClaudePreToolUse;
}

/**
 * The non-blocking install/repair warning for the exec-form guard's runtime.
 * Mirrors the doctor's heuristic wording: this process' PATH only PROXIES the
 * PATH Claude Code will use to spawn the handler.
 */
function nodeOnPathWarnings(probe: NodeOnPathProbe): string[] {
	if (probe.status === "absent") {
		return [
			`node did not resolve on this process' PATH (heuristic): the installed guard is exec-form (command: "node") and will not fire if Claude Code's PATH also lacks it — install Node ${NODE_MINIMUM_MAJOR}+ on PATH`,
		];
	}
	if (probe.status === "resolved" && probe.major < NODE_MINIMUM_MAJOR) {
		return [
			`node on PATH is ${probe.version} (<${NODE_MINIMUM_MAJOR}, heuristic): the installed guard may fail to run — install Node ${NODE_MINIMUM_MAJOR}+ on PATH`,
		];
	}
	return [];
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
	const doctorFn = deps.doctor ?? doctorClaudePreToolUse;
	const manifest = deps.manifest ?? (await readManifest());
	const secureFs =
		deps.secureFs !== undefined ? deps.secureFs : selectSecureFs(platform);
	const clock = deps.clock ?? (() => new Date());
	const nonce = deps.nonce ?? (() => randomBytes(4).toString("hex"));
	const currentAssetSha = manifest.asset.sha256;

	const assetDestPath = path.join(projectDir, ".claude", "hooks", ASSET_NAME);
	const settingsPath = path.join(projectDir, ".claude", "settings.json");
	const assetSrcPath = path.join(CLAUDE_HOOK_ASSETS_DIR, ASSET_NAME);
	// Probe node ONCE per `_run` and share the sample with the embedded doctor
	// report, so the run never spawns `node --version` twice and the warning, the
	// report row and the verdict can never disagree about the same PATH.
	const nodeOnPath = await (deps.nodeProbe ?? probeNodeOnPath)();
	const doctor = (): Promise<ClaudeHookDoctorReport> =>
		doctorFn(projectDir, {
			manifest,
			aclProbe: deps.aclProbe,
			execution: { nodeProbe: async () => nodeOnPath },
		});

	// Non-blocking runtime notice, computed once and carried by EVERY outcome
	// (success, no-op and refusal alike) — it never gates the mutation.
	const warnings = nodeOnPathWarnings(nodeOnPath);

	// Windows (or any platform without an adapter) refuses with zero mutation.
	if (!secureFs) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: ["windows-secure-object-unavailable"],
			warnings,
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
			warnings,
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
			warnings,
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
		warnings,
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
