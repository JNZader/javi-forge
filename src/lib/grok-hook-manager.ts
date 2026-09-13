/**
 * Grok Build SkillGuard hook ownership manager. Grok reads trusted global hook
 * definitions from ~/.grok/hooks, so installation is a two-file transaction:
 * the PreToolUse JSON registration and the adjacent policy runtime. Doctor
 * deliberately reports installed bytes/registration only, not runtime loading.
 */

import { createHash, randomBytes } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CLAUDE_HOOK_ASSETS_DIR, FORGE_ROOT } from "../constants.js";
import type { AssetManifestEntry } from "./claude-hook-manager.js";
import type { ClaudeHookComponentState } from "./claude-hook-settings.js";
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

export const GROK_HOOK_NAME = "javi-forge-skillguard-pre-tool-use.json";
export const GROK_POLICY_NAME = "javi-forge-skillguard-pre-tool-use.mjs";
export const GROK_HOOK_MARKER = "javi-forge-managed: grok-pretooluse v1";
export const GROK_POLICY_MARKER = "// javi-forge-managed: claude-pretooluse v1";
export const GROK_HOOK_VERSION = 1;
export const GROK_TOOL_MATCHER =
	"run_terminal_command|read_file|search_replace";
export const GROK_ASSETS_DIR = path.join(FORGE_ROOT, "assets", "grok-hooks");
export const SHIPPED_GROK_POLICY = path.join(
	CLAUDE_HOOK_ASSETS_DIR,
	GROK_POLICY_NAME,
);

export interface GrokHookManifestEntry {
	name: string;
	version: number;
	matcher: string;
	historicalVersions: number[];
}

export interface GrokManifest {
	hook: GrokHookManifestEntry;
	policy: AssetManifestEntry;
}

export interface GrokConfigPaths {
	grokDir: string;
	hooksDir: string;
	hookFile: string;
	policyFile: string;
}

export function resolveGrokHomeRoot(
	baseDir: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const override = env.GROK_HOME;
	return override && override.length > 0
		? path.resolve(override)
		: path.join(baseDir, ".grok");
}

export function grokConfigPaths(
	baseDir: string,
	env: NodeJS.ProcessEnv = process.env,
): GrokConfigPaths {
	const grokDir = resolveGrokHomeRoot(baseDir, env);
	const hooksDir = path.join(grokDir, "hooks");
	return {
		grokDir,
		hooksDir,
		hookFile: path.join(hooksDir, GROK_HOOK_NAME),
		policyFile: path.join(hooksDir, GROK_POLICY_NAME),
	};
}

interface GrokHookDefinition {
	"javi-forge-managed": string;
	version: number;
	hooks: GrokHookDefinitions;
}

interface GrokHookDefinitions {
	PreToolUse: GrokPreToolUseGroup[];
}

interface GrokPreToolUseGroup {
	matcher: string;
	hooks: GrokCommandHook[];
}

interface GrokCommandHook {
	type: "command";
	command: string;
}

/** Generate the complete standalone Grok hook registration for an adjacent asset. */
export function expectedGrokHookJson(policyFile: string): string {
	const definition: GrokHookDefinition = {
		"javi-forge-managed": GROK_HOOK_MARKER,
		version: GROK_HOOK_VERSION,
		hooks: {
			PreToolUse: [
				{
					matcher: GROK_TOOL_MATCHER,
					hooks: [
						{
							type: "command",
							command: `${JSON.stringify(process.execPath)} ${JSON.stringify(policyFile)} --agent=grok`,
						},
					],
				},
			],
		},
	};
	return `${JSON.stringify(definition, null, 2)}\n`;
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

function sha256(content: string): string {
	return createHash("sha256")
		.update(Buffer.from(content, "utf8"))
		.digest("hex");
}

export interface GrokAssetClassification {
	state: ClaudeHookComponentState;
	sha256?: string;
	version?: number;
	detail?: string;
}

/** Classify an installed policy runtime with the packaged manifest identity. */
export async function classifyGrokAsset(
	target: string,
	marker: string,
	manifest: AssetManifestEntry,
): Promise<GrokAssetClassification> {
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

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Classify a generated hook registration semantically. JSON whitespace does not
 * matter; the command is compared against the supplied baseDir's adjacent asset.
 */
export async function classifyGrokHookJson(
	target: string,
	policyFile: string,
	manifest: GrokHookManifestEntry,
): Promise<GrokAssetClassification> {
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
	let parsed: unknown;
	try {
		parsed = JSON.parse(read.content);
	} catch {
		return { state: "malformed" };
	}
	if (!isObject(parsed)) return { state: "malformed" };
	if (parsed["javi-forge-managed"] !== GROK_HOOK_MARKER)
		return { state: "foreign" };
	if (typeof parsed.version !== "number") return { state: "edited-managed" };
	if (manifest.historicalVersions.includes(parsed.version))
		return { state: "released-outdated", version: parsed.version };
	const expected = JSON.parse(expectedGrokHookJson(policyFile));
	if (
		parsed.version === manifest.version &&
		JSON.stringify(parsed) === JSON.stringify(expected)
	)
		return { state: "managed-current", version: parsed.version };
	return { state: "edited-managed", version: parsed.version };
}

async function readManifest(): Promise<GrokManifest> {
	const [hookRead, policyRead] = await Promise.all([
		safeReadFile(path.join(GROK_ASSETS_DIR, "manifest.json"), READ_OPTS),
		safeReadFile(path.join(CLAUDE_HOOK_ASSETS_DIR, "manifest.json"), READ_OPTS),
	]);
	if (!hookRead.ok)
		throw new Error(`unreadable grok hook manifest: ${hookRead.reason}`);
	if (!policyRead.ok)
		throw new Error(`unreadable claude-hooks manifest: ${policyRead.reason}`);
	const hookManifest = JSON.parse(hookRead.content) as {
		hook: GrokHookManifestEntry;
	};
	const policyManifest = JSON.parse(policyRead.content) as {
		asset: AssetManifestEntry;
	};
	return { hook: hookManifest.hook, policy: policyManifest.asset };
}

export interface GrokHookDoctorReport {
	healthy: boolean;
	hook: GrokAssetClassification;
	policy: GrokAssetClassification;
	remediation: string[];
	/** Installed files and registration only; no Grok execution is observed. */
	runtimeEvidence: "not-implemented";
}

export interface GrokDoctorOptions {
	manifest?: GrokManifest;
	policySource?: string;
	env?: NodeJS.ProcessEnv;
}

export async function doctorGrokSkillGuard(
	baseDir: string = os.homedir(),
	options: GrokDoctorOptions = {},
): Promise<GrokHookDoctorReport> {
	const manifest = options.manifest ?? (await readManifest());
	const paths = grokConfigPaths(baseDir, options.env);
	const [hook, policy] = await Promise.all([
		classifyGrokHookJson(paths.hookFile, paths.policyFile, manifest.hook),
		classifyGrokAsset(paths.policyFile, GROK_POLICY_MARKER, manifest.policy),
	]);
	const remediation: string[] = [];
	for (const [name, asset] of [
		["hook registration", hook],
		["policy runtime", policy],
	] as const) {
		if (asset.state === "absent" || asset.state === "released-outdated") {
			remediation.push(
				`install the Grok ${name} with: javi-forge hooks install grok`,
			);
		} else if (asset.state === "edited-managed") {
			remediation.push(
				`repair the edited Grok ${name} with: javi-forge hooks repair grok --force`,
			);
		} else if (asset.state !== "managed-current") {
			remediation.push(
				`manually review the Grok ${name} (${asset.state}); it will not be overwritten`,
			);
		}
	}
	return {
		healthy:
			hook.state === "managed-current" && policy.state === "managed-current",
		hook,
		policy,
		remediation: [...new Set(remediation)],
		runtimeEvidence: "not-implemented",
	};
}

interface GrokMutationSuccess {
	ok: boolean;
	changed: string[];
	backups: string[];
	errors: string[];
	warnings: string[];
	report: GrokHookDoctorReport;
}

export type GrokHookMutationResult = GrokMutationSuccess;

export interface GrokHookRunDeps extends GrokDoctorOptions {
	secureFs?: PlatformSecureFs | null;
	clock?: () => Date;
	nonce?: () => string;
	doctor?: typeof doctorGrokSkillGuard;
}

function writePlan(
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

export async function _runGrok(
	baseDir: string,
	mode: "install" | "repair",
	options: { force?: boolean },
	deps: GrokHookRunDeps = {},
): Promise<GrokHookMutationResult> {
	const manifest = deps.manifest ?? (await readManifest());
	const paths = grokConfigPaths(baseDir, deps.env);
	const doctorFn = deps.doctor ?? doctorGrokSkillGuard;
	const doctor = () =>
		doctorFn(baseDir, {
			env: deps.env,
			manifest,
			policySource: deps.policySource,
		});
	const force = mode === "repair" && options.force === true;
	const [hook, policy] = await Promise.all([
		classifyGrokHookJson(paths.hookFile, paths.policyFile, manifest.hook),
		classifyGrokAsset(paths.policyFile, GROK_POLICY_MARKER, manifest.policy),
	]);
	const hookPlan = writePlan(hook.state, force, "Grok hook registration");
	const policyPlan = writePlan(policy.state, force, "Grok policy runtime");
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
	const policySource = deps.policySource ?? SHIPPED_GROK_POLICY;
	const policyBytes = policyPlan.write ? await readFile(policySource) : null;
	if (
		policyBytes &&
		createHash("sha256").update(policyBytes).digest("hex") !==
			manifest.policy.sha256
	) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: ["refuse packaged Grok policy asset with manifest hash mismatch"],
			warnings: [],
			report: await doctor(),
		};
	}
	const hookBytes = hookPlan.write
		? Buffer.from(expectedGrokHookJson(paths.policyFile), "utf8")
		: null;
	const components: TransactionComponent[] = [
		{
			path: paths.hookFile,
			desired: hookBytes,
			capturePrior: hookPlan.write && hook.state !== "absent",
			forceBackup: force && hook.state === "edited-managed",
			wasAbsent: hook.state === "absent",
		},
		{
			path: paths.policyFile,
			desired: policyBytes,
			capturePrior: policyPlan.write && policy.state !== "absent",
			forceBackup: force && policy.state === "edited-managed",
			wasAbsent: policy.state === "absent",
		},
	];
	const tx = await runTransaction({
		secureFs,
		clock: deps.clock ?? (() => new Date()),
		nonce: deps.nonce ?? (() => randomBytes(4).toString("hex")),
		projectDir: path.dirname(paths.grokDir),
		layout: { containers: [paths.grokDir, paths.hooksDir], components },
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

export function installGrokSkillGuard(
	baseDir?: string,
	deps: GrokHookRunDeps = {},
): Promise<GrokHookMutationResult> {
	return _runGrok(baseDir ?? os.homedir(), "install", {}, deps);
}

export function repairGrokSkillGuard(
	baseDir?: string,
	options?: { force?: boolean },
	deps: GrokHookRunDeps = {},
): Promise<GrokHookMutationResult> {
	return _runGrok(baseDir ?? os.homedir(), "repair", options ?? {}, deps);
}
