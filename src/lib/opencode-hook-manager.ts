/**
 * OpenCode SkillGuard plugin ownership manager. OpenCode discovers global
 * plugins from `~/.config/opencode/plugins`, so installation is a two-file
 * transaction: the plugin and its side-by-side policy runtime. No user config
 * is edited and doctor deliberately reports installed bytes only, never proof
 * that an OpenCode runtime loaded or executed the plugin.
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

export const OPENCODE_PLUGIN_NAME = "javi-forge-skillguard-plugin.mjs";
export const OPENCODE_POLICY_NAME = "javi-forge-skillguard-pre-tool-use.mjs";
export const OPENCODE_PLUGIN_MARKER =
	"// javi-forge-managed: opencode-skillguard v1";
export const OPENCODE_POLICY_MARKER =
	"// javi-forge-managed: claude-pretooluse v1";
export const OPENCODE_ASSETS_DIR = path.join(
	FORGE_ROOT,
	"assets",
	"opencode-plugins",
);
export const SHIPPED_OPENCODE_PLUGIN = path.join(
	OPENCODE_ASSETS_DIR,
	OPENCODE_PLUGIN_NAME,
);
export const SHIPPED_OPENCODE_POLICY = path.join(
	CLAUDE_HOOK_ASSETS_DIR,
	OPENCODE_POLICY_NAME,
);

export interface OpenCodeManifest {
	plugin: AssetManifestEntry;
	policy: AssetManifestEntry;
}

export interface OpenCodeConfigPaths {
	configDir: string;
	pluginsDir: string;
	pluginFile: string;
	policyFile: string;
}

export function opencodeConfigPaths(baseDir: string): OpenCodeConfigPaths {
	const configDir = path.join(baseDir, ".config", "opencode");
	const pluginsDir = path.join(configDir, "plugins");
	return {
		configDir,
		pluginsDir,
		pluginFile: path.join(pluginsDir, OPENCODE_PLUGIN_NAME),
		policyFile: path.join(pluginsDir, OPENCODE_POLICY_NAME),
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

function sha256(content: string): string {
	return createHash("sha256")
		.update(Buffer.from(content, "utf8"))
		.digest("hex");
}

export interface OpenCodeAssetClassification {
	state: ClaudeHookComponentState;
	sha256?: string;
	version?: number;
	detail?: string;
}

/** Classify one installed managed module using full-byte manifest hashes. */
export async function classifyOpenCodeAsset(
	target: string,
	marker: string,
	manifest: AssetManifestEntry,
): Promise<OpenCodeAssetClassification> {
	const stat = await fileKind(target);
	if (stat.kind === "absent") return { state: "absent" };
	if (stat.kind === "symlink") return { state: "symlink" };
	if (stat.kind !== "file")
		return { state: "non-regular", detail: stat.detail };
	const read = await safeReadFile(target, READ_OPTS);
	if (!read.ok) {
		if (read.reason === "not-found") return { state: "absent" };
		if (read.reason === "binary" || read.reason === "too-large") {
			return { state: "foreign", detail: read.reason };
		}
		return { state: "non-regular", detail: read.reason };
	}
	if (!read.content.startsWith(`${marker}\n`)) return { state: "foreign" };
	const observed = sha256(read.content);
	if (observed === manifest.sha256) {
		return {
			state: "managed-current",
			sha256: observed,
			version: manifest.version,
		};
	}
	if (manifest.historical.includes(observed)) {
		return {
			state: "released-outdated",
			sha256: observed,
			version: manifest.version,
		};
	}
	return { state: "edited-managed", sha256: observed };
}

async function readManifest(): Promise<OpenCodeManifest> {
	const [pluginRead, policyRead] = await Promise.all([
		safeReadFile(path.join(OPENCODE_ASSETS_DIR, "manifest.json"), READ_OPTS),
		safeReadFile(path.join(CLAUDE_HOOK_ASSETS_DIR, "manifest.json"), READ_OPTS),
	]);
	if (!pluginRead.ok)
		throw new Error(
			`unreadable opencode plugin manifest: ${pluginRead.reason}`,
		);
	if (!policyRead.ok)
		throw new Error(`unreadable claude-hooks manifest: ${policyRead.reason}`);
	const plugin = JSON.parse(pluginRead.content) as {
		plugin: AssetManifestEntry;
	};
	const policy = JSON.parse(policyRead.content) as {
		asset: AssetManifestEntry;
	};
	return { plugin: plugin.plugin, policy: policy.asset };
}

export interface OpenCodeHookDoctorReport {
	healthy: boolean;
	plugin: OpenCodeAssetClassification;
	policy: OpenCodeAssetClassification;
	remediation: string[];
	/** Installed-file inspection only; OpenCode runtime loading is not observed. */
	runtimeEvidence: "not-implemented";
}

export interface OpenCodeDoctorOptions {
	manifest?: OpenCodeManifest;
	pluginSource?: string;
	policySource?: string;
}

export async function doctorOpenCodeSkillGuard(
	baseDir: string = os.homedir(),
	options: OpenCodeDoctorOptions = {},
): Promise<OpenCodeHookDoctorReport> {
	const manifest = options.manifest ?? (await readManifest());
	const paths = opencodeConfigPaths(baseDir);
	const [plugin, policy] = await Promise.all([
		classifyOpenCodeAsset(
			paths.pluginFile,
			OPENCODE_PLUGIN_MARKER,
			manifest.plugin,
		),
		classifyOpenCodeAsset(
			paths.policyFile,
			OPENCODE_POLICY_MARKER,
			manifest.policy,
		),
	]);
	const remediation: string[] = [];
	for (const [name, asset] of [
		["plugin", plugin],
		["policy runtime", policy],
	] as const) {
		if (asset.state === "absent" || asset.state === "released-outdated") {
			remediation.push(
				`install the OpenCode ${name} with: javi-forge hooks install opencode`,
			);
		} else if (asset.state === "edited-managed") {
			remediation.push(
				`repair the edited OpenCode ${name} with: javi-forge hooks repair opencode --force`,
			);
		} else if (asset.state !== "managed-current") {
			remediation.push(
				`manually review the OpenCode ${name} (${asset.state}); it will not be overwritten`,
			);
		}
	}
	return {
		healthy:
			plugin.state === "managed-current" && policy.state === "managed-current",
		plugin,
		policy,
		remediation: [...new Set(remediation)],
		runtimeEvidence: "not-implemented",
	};
}

interface OpenCodeMutationSuccess {
	ok: boolean;
	changed: string[];
	backups: string[];
	errors: string[];
	warnings: string[];
	report: OpenCodeHookDoctorReport;
}

export type OpenCodeHookMutationResult = OpenCodeMutationSuccess;

export interface OpenCodeHookRunDeps extends OpenCodeDoctorOptions {
	secureFs?: PlatformSecureFs | null;
	clock?: () => Date;
	nonce?: () => string;
	doctor?: typeof doctorOpenCodeSkillGuard;
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

export async function _runOpenCode(
	baseDir: string,
	mode: "install" | "repair",
	options: { force?: boolean },
	deps: OpenCodeHookRunDeps = {},
): Promise<OpenCodeHookMutationResult> {
	const manifest = deps.manifest ?? (await readManifest());
	const paths = opencodeConfigPaths(baseDir);
	const doctorFn = deps.doctor ?? doctorOpenCodeSkillGuard;
	const doctor = () =>
		doctorFn(baseDir, {
			manifest,
			pluginSource: deps.pluginSource,
			policySource: deps.policySource,
		});
	const force = mode === "repair" && options.force === true;
	const [plugin, policy] = await Promise.all([
		classifyOpenCodeAsset(
			paths.pluginFile,
			OPENCODE_PLUGIN_MARKER,
			manifest.plugin,
		),
		classifyOpenCodeAsset(
			paths.policyFile,
			OPENCODE_POLICY_MARKER,
			manifest.policy,
		),
	]);
	const pluginPlan = writePlan(plugin.state, force, "OpenCode plugin");
	const policyPlan = writePlan(policy.state, force, "OpenCode policy runtime");
	if (pluginPlan.refusal || policyPlan.refusal) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: [pluginPlan.refusal ?? policyPlan.refusal ?? "refused"],
			warnings: [],
			report: await doctor(),
		};
	}
	if (!pluginPlan.write && !policyPlan.write) {
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
	const pluginSource = deps.pluginSource ?? SHIPPED_OPENCODE_PLUGIN;
	const policySource = deps.policySource ?? SHIPPED_OPENCODE_POLICY;
	const [pluginBytes, policyBytes] = await Promise.all([
		pluginPlan.write
			? readFile(pluginSource)
			: Promise.resolve<Buffer | null>(null),
		policyPlan.write
			? readFile(policySource)
			: Promise.resolve<Buffer | null>(null),
	]);
	if (
		(pluginBytes &&
			createHash("sha256").update(pluginBytes).digest("hex") !==
				manifest.plugin.sha256) ||
		(policyBytes &&
			createHash("sha256").update(policyBytes).digest("hex") !==
				manifest.policy.sha256)
	) {
		return {
			ok: false,
			changed: [],
			backups: [],
			errors: ["refuse packaged OpenCode assets with manifest hash mismatch"],
			warnings: [],
			report: await doctor(),
		};
	}
	const components: TransactionComponent[] = [
		{
			path: paths.pluginFile,
			desired: pluginBytes,
			capturePrior: pluginPlan.write && plugin.state !== "absent",
			forceBackup: force && plugin.state === "edited-managed",
			wasAbsent: plugin.state === "absent",
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
		projectDir: baseDir,
		layout: {
			containers: [
				path.join(baseDir, ".config"),
				paths.configDir,
				paths.pluginsDir,
			],
			components,
		},
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

export function installOpenCodeSkillGuard(
	baseDir?: string,
	deps: OpenCodeHookRunDeps = {},
): Promise<OpenCodeHookMutationResult> {
	return _runOpenCode(baseDir ?? os.homedir(), "install", {}, deps);
}

export function repairOpenCodeSkillGuard(
	baseDir?: string,
	options?: { force?: boolean },
	deps: OpenCodeHookRunDeps = {},
): Promise<OpenCodeHookMutationResult> {
	return _runOpenCode(baseDir ?? os.homedir(), "repair", options ?? {}, deps);
}
