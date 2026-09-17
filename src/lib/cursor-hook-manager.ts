/**
 * Cursor SkillGuard hook ownership manager. Cursor reads per-user hooks from
 * ~/.cursor/hooks.json and hook scripts from ~/.cursor/hooks/, so installation is
 * a two-file transaction: a merged preToolUse registration plus the shared
 * policy runtime copied beside it. Doctor reports installed bytes/registration
 * only; it cannot prove Cursor loaded or executed the hook in a live session.
 */

import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import type {
	AssetManifestEntry,
	ExecutionReport,
} from "./claude-hook-manager.js";
import type { ClaudeHookComponentState } from "./claude-hook-settings.js";
import { commandFormExecEvidence } from "./command-hook-exec-path.js";
import { safeReadFile } from "./safe-read.js";
import { selectSecureFs } from "./secure-fs-posix.js";
import {
	type PlatformSecureFs,
	runTransaction,
	type TransactionComponent,
} from "./secure-fs-transaction.js";

const MAX_BYTES = 1024 * 1024;
const READ_OPTS = {
	maxBytes: MAX_BYTES,
	hardRejectOverBytes: MAX_BYTES,
	maxLineLength: Number.POSITIVE_INFINITY,
} as const;

export const CURSOR_HOOKS_NAME = "hooks.json";
export const CURSOR_POLICY_NAME = "javi-forge-skillguard-pre-tool-use.mjs";
export const CURSOR_HOOK_MARKER = "javi-forge-managed: cursor-pretooluse v1";
export const CURSOR_POLICY_MARKER =
	"// javi-forge-managed: claude-pretooluse v1";
export const CURSOR_HOOK_VERSION = 1;
export const CURSOR_TIMEOUT = 30;
export const CURSOR_TOOL_MATCHER = "Shell|Read|Write|Delete";
export const SHIPPED_CURSOR_POLICY = path.join(
	CLAUDE_HOOK_ASSETS_DIR,
	CURSOR_POLICY_NAME,
);

export interface CursorConfigPaths {
	cursorDir: string;
	hooksDir: string;
	hooksFile: string;
	policyFile: string;
}

export function cursorConfigPaths(homeDir: string): CursorConfigPaths {
	const cursorDir = path.join(homeDir, ".cursor");
	const hooksDir = path.join(cursorDir, "hooks");
	return {
		cursorDir,
		hooksDir,
		hooksFile: path.join(cursorDir, CURSOR_HOOKS_NAME),
		policyFile: path.join(hooksDir, CURSOR_POLICY_NAME),
	};
}

type FileKind = "absent" | "symlink" | "non-regular" | "file" | "error";

async function fileKind(
	target: string,
): Promise<{ kind: FileKind; detail?: string }> {
	try {
		const stat = await lstat(target);
		if (stat.isSymbolicLink()) return { kind: "symlink" };
		return stat.isFile() ? { kind: "file" } : { kind: "non-regular" };
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ENOENT" || code === "ENOTDIR") return { kind: "absent" };
		return { kind: "error", detail: code ?? String(error) };
	}
}

function sha256(content: string | Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface CursorAssetClassification {
	state: ClaudeHookComponentState;
	sha256?: string;
	version?: number;
	detail?: string;
}

export async function classifyCursorAsset(
	target: string,
	marker: string,
	manifest: AssetManifestEntry,
): Promise<CursorAssetClassification> {
	const stat = await fileKind(target);
	if (stat.kind === "absent") return { state: "absent" };
	if (stat.kind === "symlink") return { state: "symlink" };
	if (stat.kind !== "file")
		return { state: "non-regular", detail: stat.detail };
	const read = await safeReadFile(target, READ_OPTS);
	if (!read.ok) {
		if (read.reason === "not-found") return { state: "absent" };
		if (read.reason === "binary" || read.reason === "too-large")
			return { state: "foreign", detail: read.reason };
		return { state: "non-regular", detail: read.reason };
	}
	if (!read.content.startsWith(`${marker}\n`)) return { state: "foreign" };
	const observed = sha256(read.content);
	if (observed === manifest.sha256)
		return {
			state: "managed-current",
			sha256: observed,
			version: manifest.version,
		};
	if (manifest.historical.includes(observed))
		return {
			state: "released-outdated",
			sha256: observed,
			version: manifest.version,
		};
	return { state: "edited-managed", sha256: observed };
}

function expectedCursorCommand(policyFile: string): string {
	return `${JSON.stringify(process.execPath)} ${JSON.stringify(policyFile)} --agent=cursor`;
}

function buildCursorHook(policyFile: string): Record<string, unknown> {
	return {
		command: expectedCursorCommand(policyFile),
		type: "command",
		matcher: CURSOR_TOOL_MATCHER,
		timeout: CURSOR_TIMEOUT,
		failClosed: true,
	};
}

export function expectedCursorHooksJson(policyFile: string): string {
	return `${JSON.stringify(
		{
			"javi-forge-managed": CURSOR_HOOK_MARKER,
			version: CURSOR_HOOK_VERSION,
			hooks: { preToolUse: [buildCursorHook(policyFile)] },
		},
		null,
		2,
	)}\n`;
}

const CURSOR_CMD_RE =
	/(?:^|\s)(?:"[^"]*node[^"]*"|node)\s+(?:"[^"]*javi-forge-skillguard-pre-tool-use\.mjs"|\S*javi-forge-skillguard-pre-tool-use\.mjs)\s+--agent=cursor(?:\s|$)/;

function preToolUseHandlers(value: unknown): Record<string, unknown>[] | null {
	if (!isObject(value)) return null;
	const hooks = value.hooks;
	if (hooks === undefined) return [];
	if (!isObject(hooks)) return null;
	const groups = hooks.preToolUse;
	if (groups === undefined) return [];
	if (!Array.isArray(groups)) return null;
	const handlers: Record<string, unknown>[] = [];
	for (const group of groups) {
		if (!isObject(group)) return null;
		handlers.push(group);
	}
	return handlers;
}

export function mergeCursorHooks(
	existing: unknown,
	policyFile: string,
): Record<string, unknown> {
	const container = isObject(existing)
		? (structuredClone(existing) as Record<string, unknown>)
		: {};
	if (!isObject(container.hooks)) container.hooks = {};
	const hooks = container.hooks as Record<string, unknown>;
	const groups = Array.isArray(hooks.preToolUse) ? hooks.preToolUse : [];
	hooks.preToolUse = [
		...groups.filter(
			(group) =>
				!(
					isObject(group) &&
					typeof group.command === "string" &&
					CURSOR_CMD_RE.test(group.command)
				),
		),
		buildCursorHook(policyFile),
	];
	container["javi-forge-managed"] = CURSOR_HOOK_MARKER;
	container.version = CURSOR_HOOK_VERSION;
	return container;
}

export function classifyCursorHooksJson(
	value: unknown,
	policyFile: string,
): CursorAssetClassification {
	const handlers = preToolUseHandlers(value);
	if (handlers === null) return { state: "malformed" };
	const expected = buildCursorHook(policyFile);
	const ours = handlers.filter(
		(handler) =>
			typeof handler.command === "string" &&
			CURSOR_CMD_RE.test(handler.command),
	);
	if (
		ours.some(
			(handler) =>
				JSON.stringify(handler) === JSON.stringify(expected) &&
				isObject(value) &&
				value["javi-forge-managed"] === CURSOR_HOOK_MARKER &&
				value.version === CURSOR_HOOK_VERSION,
		)
	) {
		return { state: "managed-current", version: CURSOR_HOOK_VERSION };
	}
	if (ours.length > 0) return { state: "released-outdated" };
	if (handlers.length > 0) return { state: "foreign" };
	return { state: "absent" };
}

interface CursorManifest {
	policy: AssetManifestEntry;
}

async function readManifest(): Promise<CursorManifest> {
	const read = await safeReadFile(
		path.join(CLAUDE_HOOK_ASSETS_DIR, "manifest.json"),
		READ_OPTS,
	);
	if (!read.ok)
		throw new Error(`unreadable claude-hooks manifest: ${read.reason}`);
	const manifest = JSON.parse(read.content) as { asset: AssetManifestEntry };
	return { policy: manifest.asset };
}

export interface CursorHookDoctorReport {
	healthy: boolean;
	hooksJson: CursorAssetClassification;
	policy: CursorAssetClassification;
	remediation: string[];
	/** Installed-file inspection only; Cursor runtime loading is not observed. */
	execution: ExecutionReport;
}

export interface CursorDoctorOptions {
	manifest?: CursorManifest;
	policySource?: string;
	probeExecPath?: (execPath: string) => Promise<boolean>;
}

async function readJsonFile(
	target: string,
): Promise<
	| { ok: true; value: unknown }
	| { ok: false; state: ClaudeHookComponentState; detail?: string }
> {
	const stat = await fileKind(target);
	if (stat.kind === "absent") return { ok: false, state: "absent" };
	if (stat.kind === "symlink") return { ok: false, state: "symlink" };
	if (stat.kind !== "file")
		return { ok: false, state: "non-regular", detail: stat.detail };
	const read = await safeReadFile(target, READ_OPTS);
	if (!read.ok) {
		if (read.reason === "not-found") return { ok: false, state: "absent" };
		if (read.reason === "binary" || read.reason === "too-large")
			return { ok: false, state: "foreign", detail: read.reason };
		return { ok: false, state: "non-regular", detail: read.reason };
	}
	try {
		return { ok: true, value: JSON.parse(read.content) };
	} catch {
		return { ok: false, state: "malformed", detail: "invalid-json" };
	}
}

export async function doctorCursorSkillGuard(
	homeDir: string = os.homedir(),
	options: CursorDoctorOptions = {},
): Promise<CursorHookDoctorReport> {
	const manifest = options.manifest ?? (await readManifest());
	const paths = cursorConfigPaths(homeDir);
	const hooksRead = await readJsonFile(paths.hooksFile);
	const hooksJson = hooksRead.ok
		? classifyCursorHooksJson(hooksRead.value, paths.policyFile)
		: { state: hooksRead.state, detail: hooksRead.detail };
	const policy = await classifyCursorAsset(
		paths.policyFile,
		CURSOR_POLICY_MARKER,
		manifest.policy,
	);
	const remediation: string[] = [];
	for (const [name, asset] of [
		["hook registration", hooksJson],
		["policy runtime", policy],
	] as const) {
		if (
			asset.state === "absent" ||
			asset.state === "released-outdated" ||
			asset.state === "foreign"
		) {
			remediation.push(
				`install the Cursor ${name} with: javi-forge hooks install cursor`,
			);
		} else if (asset.state === "edited-managed") {
			remediation.push(
				`repair the edited Cursor ${name} with: javi-forge hooks repair cursor --force`,
			);
		} else if (asset.state !== "managed-current") {
			remediation.push(
				`manually review the Cursor ${name} (${asset.state}); it will not be overwritten`,
			);
		}
	}
	const unknownSources = [
		"Cursor hook discovery is not locally verified",
		"Cursor hook loading is not locally verified",
		"Cursor hook execution is not locally verified",
	];
	const residual = [
		"Installed file bytes do not prove Cursor discovered, loaded, or invoked the hook",
	];
	let blockers: string[] = [];
	if (
		hooksJson.state === "managed-current" &&
		policy.state === "managed-current"
	) {
		const evidence = await commandFormExecEvidence({
			host: "Cursor",
			command: cursorRecordedCommand(
				hooksRead.ok ? hooksRead.value : undefined,
			),
			probeExecPath: options.probeExecPath,
		});
		blockers = evidence.blockers;
		residual.push(...evidence.residual);
	}
	return {
		healthy:
			hooksJson.state === "managed-current" &&
			policy.state === "managed-current",
		hooksJson,
		policy,
		remediation: [...new Set(remediation)],
		execution: {
			status: blockers.length > 0 ? "blocked" : "inconclusive",
			blockers,
			unknownSources,
			residual,
		},
	};
}

function cursorRecordedCommand(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const hooks = (
		value as { hooks?: { preToolUse?: Array<{ command?: unknown }> } }
	).hooks;
	const command = hooks?.preToolUse?.[0]?.command;
	return typeof command === "string" ? command : undefined;
}

interface CursorMutationSuccess {
	ok: boolean;
	changed: string[];
	backups: string[];
	errors: string[];
	warnings: string[];
	report: CursorHookDoctorReport;
}

export type CursorHookMutationResult = CursorMutationSuccess;

export interface CursorHookRunDeps extends CursorDoctorOptions {
	secureFs?: PlatformSecureFs | null;
	clock?: () => Date;
	nonce?: () => string;
	doctor?: typeof doctorCursorSkillGuard;
}

function hookWritePlan(
	state: ClaudeHookComponentState,
	force: boolean,
	name: string,
): { write: boolean; refusal?: string } {
	if (
		state === "absent" ||
		state === "released-outdated" ||
		state === "foreign"
	)
		return { write: true };
	if (state === "managed-current") return { write: false };
	if (state === "edited-managed" && force) return { write: true };
	if (state === "edited-managed")
		return {
			write: false,
			refusal: `refuse edited ${name}; rerun repair with --force`,
		};
	return {
		write: false,
		refusal: `refuse ${name} in state ${state} — manual review`,
	};
}

function policyWritePlan(
	state: ClaudeHookComponentState,
	force: boolean,
	name: string,
): { write: boolean; refusal?: string } {
	if (state === "absent" || state === "released-outdated")
		return { write: true };
	if (state === "managed-current") return { write: false };
	if (state === "edited-managed" && force) return { write: true };
	if (state === "edited-managed")
		return {
			write: false,
			refusal: `refuse edited ${name}; rerun repair with --force`,
		};
	return {
		write: false,
		refusal: `refuse ${name} in state ${state} — manual review`,
	};
}

function serialize(container: unknown): Buffer {
	return Buffer.from(`${JSON.stringify(container, null, 2)}\n`, "utf8");
}

export async function _runCursor(
	homeDir: string,
	mode: "install" | "repair",
	options: { force?: boolean },
	deps: CursorHookRunDeps = {},
): Promise<CursorHookMutationResult> {
	const manifest = deps.manifest ?? (await readManifest());
	const paths = cursorConfigPaths(homeDir);
	const doctorFn = deps.doctor ?? doctorCursorSkillGuard;
	const doctor = () =>
		doctorFn(homeDir, {
			manifest,
			policySource: deps.policySource,
		});
	const force = mode === "repair" && options.force === true;
	const hooksRead = await readJsonFile(paths.hooksFile);
	const hooksState = hooksRead.ok
		? classifyCursorHooksJson(hooksRead.value, paths.policyFile)
		: { state: hooksRead.state, detail: hooksRead.detail };
	const policyState = await classifyCursorAsset(
		paths.policyFile,
		CURSOR_POLICY_MARKER,
		manifest.policy,
	);
	const hookPlan = hookWritePlan(
		hooksState.state,
		force,
		"Cursor hook registration",
	);
	const policyPlan = policyWritePlan(
		policyState.state,
		force,
		"Cursor policy runtime",
	);
	if (hookPlan.refusal || policyPlan.refusal) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: [hookPlan.refusal ?? policyPlan.refusal ?? "refused"],
			warnings: [],
			report: await doctor(),
		};
	}
	if (!hookPlan.write && !policyPlan.write) {
		return {
			ok: true,
			changed: [],
			backups: [],
			errors: [],
			warnings: [],
			report: await doctor(),
		};
	}
	const secureFs =
		deps.secureFs !== undefined
			? deps.secureFs
			: selectSecureFs(process.platform);
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
	const policySource = deps.policySource ?? SHIPPED_CURSOR_POLICY;
	const policyBytes = policyPlan.write ? await readFile(policySource) : null;
	if (policyBytes && sha256(policyBytes) !== manifest.policy.sha256) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: [
				"refuse packaged Cursor policy asset with manifest hash mismatch",
			],
			warnings: [],
			report: await doctor(),
		};
	}
	const existing = hooksRead.ok ? hooksRead.value : undefined;
	const hookBytes = hookPlan.write
		? serialize(mergeCursorHooks(existing, paths.policyFile))
		: null;
	const components: TransactionComponent[] = [
		{
			path: paths.hooksFile,
			desired: hookBytes,
			capturePrior: hookPlan.write && hooksState.state !== "absent",
			forceBackup: force && hooksState.state === "edited-managed",
			wasAbsent: hooksState.state === "absent",
		},
		{
			path: paths.policyFile,
			desired: policyBytes,
			capturePrior: policyPlan.write && policyState.state !== "absent",
			forceBackup: force && policyState.state === "edited-managed",
			wasAbsent: policyState.state === "absent",
		},
	];
	const tx = await runTransaction({
		secureFs,
		clock: deps.clock ?? (() => new Date()),
		nonce: deps.nonce ?? (() => randomBytes(4).toString("hex")),
		projectDir: homeDir,
		layout: { containers: [paths.cursorDir, paths.hooksDir], components },
	});
	return {
		ok: tx.ok,
		changed: tx.committed,
		backups: tx.backups,
		errors: tx.errors,
		warnings: [],
		report: await doctor(),
	};
}

export function installCursorSkillGuard(
	homeDir?: string,
	deps: CursorHookRunDeps = {},
): Promise<CursorHookMutationResult> {
	return _runCursor(homeDir ?? os.homedir(), "install", {}, deps);
}

export function repairCursorSkillGuard(
	homeDir?: string,
	options?: { force?: boolean },
	deps: CursorHookRunDeps = {},
): Promise<CursorHookMutationResult> {
	return _runCursor(homeDir ?? os.homedir(), "repair", options ?? {}, deps);
}
