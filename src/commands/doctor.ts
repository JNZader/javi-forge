import path from "node:path";
import fs from "fs-extra";
import {
	FORGE_ROOT,
	MODULES_DIR,
	PLUGINS_DIR,
	TEMPLATES_DIR,
} from "../constants.js";
import { detectStack } from "../lib/common.js";
import { refreshContextDir } from "../lib/context.js";
import { execFileAsync } from "../lib/exec.js";
import { resolvePlatformSupport } from "../lib/platform-support.js";
import { listInstalledPlugins } from "../lib/plugin.js";
import type {
	DoctorCheck,
	DoctorResult,
	DoctorSection,
	ForgeManifest,
} from "../types/index.js";

export type CheckStatus = "ok" | "fail" | "skip";

type DoctorFilesystem = Pick<typeof fs, "pathExists" | "readJson" | "readdir">;

export interface DoctorDeps {
	platform?: string;
	cwd?: () => string;
	filesystem?: DoctorFilesystem;
	exec?: typeof execFileAsync;
	stackDetector?: typeof detectStack;
	pluginLister?: typeof listInstalledPlugins;
	contextRefresher?: typeof refreshContextDir;
}

/** Resolve a binary name to its full path, returns null if not found */
async function which(
	bin: string,
	exec: typeof execFileAsync,
): Promise<string | null> {
	try {
		const { stdout } = await exec("which", [bin]);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/** Read the forge manifest from a project directory */
async function readManifest(
	projectDir: string,
	filesystem: DoctorFilesystem,
): Promise<ForgeManifest | null> {
	const manifestPath = path.join(projectDir, ".javi-forge", "manifest.json");
	if (!(await filesystem.pathExists(manifestPath))) return null;
	try {
		return (await filesystem.readJson(manifestPath)) as ForgeManifest;
	} catch {
		return null;
	}
}

/** Count entries in a directory */
async function countDir(
	dir: string,
	filesystem: DoctorFilesystem,
): Promise<number> {
	if (!(await filesystem.pathExists(dir))) return 0;
	const entries = await filesystem.readdir(dir);
	return entries.filter((e) => !e.startsWith(".")).length;
}

/** Read a single git config value, "" when unset or on any error. */
async function gitConfigValue(
	cwd: string,
	key: string,
	exec: typeof execFileAsync,
): Promise<string> {
	try {
		const { stdout } = await exec("git", ["config", "--get", key], {
			cwd,
		});
		return stdout.trim();
	} catch {
		return "";
	}
}

interface RemoteInfo {
	host: "github" | "gitlab" | "other";
	owner: string;
	repo: string;
}

/** Parse an origin remote URL (ssh or https) into host/owner/repo. */
export function parseRemote(url: string): RemoteInfo | null {
	const trimmed = url.trim();
	if (!trimmed) return null;
	// git@host:owner/repo(.git) | ssh://git@host/owner/repo | https://host/owner/repo(.git)
	const m = trimmed.match(
		/(?:git@|https?:\/\/|ssh:\/\/(?:git@)?)([^/:]+)[/:]([^/]+)\/(.+?)(?:\.git)?$/,
	);
	if (!m) return null;
	const [, hostRaw, owner, repo] = m;
	const host = hostRaw.includes("github")
		? "github"
		: hostRaw.includes("gitlab")
			? "gitlab"
			: "other";
	return { host, owner, repo };
}

/**
 * L4+L6 advisory (merged — signing is one check): report `ok` when commit
 * signing is fully configured (`commit.gpgsign=true` AND `user.signingkey`
 * set), otherwise `skip` with the enable snippet. Doctor is read-only — this is
 * a recommendation, never a gate (a hook enforcing it was trivially bypassed
 * with `--no-verify`).
 */
async function commitSigningCheck(
	cwd: string,
	exec: typeof execFileAsync,
): Promise<DoctorCheck> {
	const gpgSign = await gitConfigValue(cwd, "commit.gpgsign", exec);
	const signingKey = await gitConfigValue(cwd, "user.signingkey", exec);
	if (gpgSign === "true" && signingKey) {
		return {
			label: "Commit signing",
			status: "ok",
			detail: "signing enabled (commit.gpgsign=true)",
		};
	}
	return {
		label: "Commit signing",
		status: "skip",
		detail:
			"not configured — enable with: git config commit.gpgsign true && git config user.signingkey <KEY>",
	};
}

/**
 * L5 advisory: server-side branch protection is the real control (the old local
 * push-blocking hook was CI-exempt and `--no-verify`-bypassable). When `gh` is
 * on PATH and origin is GitHub, probe the branch protection API; a missing
 * probe or protection is a non-alarming `skip` (advisory, not a failure).
 * GitLab or no `gh` → `skip` with a note to verify in the forge UI.
 */
async function branchProtectionCheck(
	cwd: string,
	exec: typeof execFileAsync,
): Promise<DoctorCheck> {
	const remote = parseRemote(
		await gitConfigValue(cwd, "remote.origin.url", exec),
	);
	const label = "Branch protection";

	if (!remote || remote.host === "other") {
		return {
			label,
			status: "skip",
			detail:
				"no GitHub/GitLab origin — verify branch protection in the forge UI",
		};
	}
	if (remote.host === "gitlab" || !(await which("gh", exec))) {
		return {
			label,
			status: "skip",
			detail: "verify branch protection in the forge UI",
		};
	}

	// gh + GitHub: resolve the default branch, then probe protection.
	let branch = "main";
	try {
		const { stdout } = await exec(
			"git",
			["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
			{ cwd },
		);
		branch = stdout.trim().replace(/^origin\//, "") || "main";
	} catch {
		/* fall back to main */
	}

	try {
		await exec("gh", [
			"api",
			`repos/${remote.owner}/${remote.repo}/branches/${branch}/protection`,
		]);
		return {
			label,
			status: "ok",
			detail: `server-side protection enabled on ${branch}`,
		};
	} catch {
		return {
			label,
			status: "skip",
			detail: `no server-side branch protection detected on ${branch}`,
		};
	}
}

/**
 * Run comprehensive health checks for the project and framework.
 */
export async function runDoctor(
	projectDir?: string,
	deps: DoctorDeps = {},
): Promise<DoctorResult> {
	const platformSupport = resolvePlatformSupport(
		deps.platform ?? process.platform,
	);
	if (platformSupport) {
		return {
			state: "unsupported-platform",
			guidance: platformSupport.guidance,
			sections: [],
		};
	}

	const cwd = projectDir ?? (deps.cwd ?? process.cwd)();
	const filesystem = deps.filesystem ?? fs;
	const exec = deps.exec ?? execFileAsync;
	const stackDetector = deps.stackDetector ?? detectStack;
	const pluginLister = deps.pluginLister ?? listInstalledPlugins;
	const contextRefresher = deps.contextRefresher ?? refreshContextDir;
	const sections: DoctorSection[] = [];

	// ── 1. System Tools ────────────────────────────────────────────────────────
	const toolChecks: DoctorCheck[] = [];
	const tools = [
		{ name: "git", label: "Git" },
		{ name: "docker", label: "Docker" },
		{ name: "semgrep", label: "Semgrep" },
		{ name: "node", label: "Node.js" },
		{ name: "pnpm", label: "pnpm" },
	];

	for (const tool of tools) {
		const bin = await which(tool.name, exec);
		if (bin) {
			// Try to get version
			let version = "";
			try {
				const { stdout } = await exec(tool.name, ["--version"]);
				version = stdout.trim().split("\n")[0] ?? "";
			} catch {
				/* ignore */
			}
			toolChecks.push({
				label: tool.label,
				status: "ok",
				detail: version ? `${version}` : `found at ${bin}`,
			});
		} else {
			toolChecks.push({
				label: tool.label,
				status:
					tool.name === "docker" || tool.name === "semgrep" ? "skip" : "fail",
				detail: "not found in PATH",
			});
		}
	}
	sections.push({ title: "System Tools", checks: toolChecks });

	// ── 1b. Security (advisories, read-only) ────────────────────────────────────
	// L4/L6 (commit signing) and L5 (branch protection) are advisories, NOT hooks
	// (hook-consolidation D9): doctor reports, nothing blocks.
	const securityChecks: DoctorCheck[] = [
		await commitSigningCheck(cwd, exec),
		await branchProtectionCheck(cwd, exec),
	];
	sections.push({ title: "Security", checks: securityChecks });

	// ── 2. Framework Structure ─────────────────────────────────────────────────
	const structureChecks: DoctorCheck[] = [];
	const expectedDirs = [
		{ path: TEMPLATES_DIR, label: "templates/" },
		{ path: MODULES_DIR, label: "modules/" },
		{ path: path.join(FORGE_ROOT, "workflows"), label: "workflows/" },
		{ path: path.join(FORGE_ROOT, "ci-local"), label: "ci-local/" },
	];

	for (const dir of expectedDirs) {
		if (await filesystem.pathExists(dir.path)) {
			const count = await countDir(dir.path, filesystem);
			structureChecks.push({
				label: dir.label,
				status: "ok",
				detail: `${count} entries`,
			});
		} else {
			structureChecks.push({
				label: dir.label,
				status: "fail",
				detail: "missing",
			});
		}
	}
	sections.push({ title: "Framework Structure", checks: structureChecks });

	// ── 3. Stack Detection ─────────────────────────────────────────────────────
	const stackChecks: DoctorCheck[] = [];
	const detection = await stackDetector(cwd);
	if (detection) {
		stackChecks.push({
			label: "Detected stack",
			status: "ok",
			detail: `${detection.stackType} (${detection.buildTool})${detection.javaVersion ? ` Java ${detection.javaVersion}` : ""}`,
		});
	} else {
		stackChecks.push({
			label: "Detected stack",
			status: "skip",
			detail: "no recognizable project files in current directory",
		});
	}
	sections.push({ title: "Stack Detection", checks: stackChecks });

	// ── 4. Project Manifest ────────────────────────────────────────────────────
	const manifestChecks: DoctorCheck[] = [];
	const manifest = await readManifest(cwd, filesystem);
	if (manifest) {
		manifestChecks.push({
			label: "Forge manifest",
			status: "ok",
			detail: `project: ${manifest.projectName}, stack: ${manifest.stack}`,
		});
		manifestChecks.push({
			label: "Created",
			status: "ok",
			detail: manifest.createdAt.split("T")[0],
		});
		manifestChecks.push({
			label: "Modules",
			status: manifest.modules.length > 0 ? "ok" : "skip",
			detail:
				manifest.modules.length > 0
					? manifest.modules.join(", ")
					: "none installed",
		});
	} else {
		manifestChecks.push({
			label: "Forge manifest",
			status: "skip",
			detail: "not a forge-managed project (run javi-forge init)",
		});
	}
	sections.push({ title: "Project Manifest", checks: manifestChecks });

	// ── 5. Installed Modules ───────────────────────────────────────────────────
	const moduleChecks: DoctorCheck[] = [];
	const moduleNames = ["engram", "obsidian-brain", "memory-simple", "ghagga"];
	for (const mod of moduleNames) {
		const modPath = path.join(cwd, ".javi-forge", "modules", mod);
		if (await filesystem.pathExists(modPath)) {
			moduleChecks.push({ label: mod, status: "ok", detail: "installed" });
		} else {
			moduleChecks.push({
				label: mod,
				status: "skip",
				detail: "not installed",
			});
		}
	}
	sections.push({ title: "Installed Modules", checks: moduleChecks });

	// ── 6. Plugins ─────────────────────────────────────────────────────────────
	const pluginChecks: DoctorCheck[] = [];
	const pluginsDirExists = await filesystem.pathExists(PLUGINS_DIR);
	if (pluginsDirExists) {
		const plugins = await pluginLister();
		if (plugins.length > 0) {
			for (const plugin of plugins) {
				pluginChecks.push({
					label: plugin.name,
					status: "ok",
					detail: `v${plugin.version} from ${plugin.source}`,
				});
			}
		} else {
			pluginChecks.push({
				label: "Plugins",
				status: "skip",
				detail: "none installed",
			});
		}
	} else {
		pluginChecks.push({
			label: "Plugins directory",
			status: "skip",
			detail: "not created yet",
		});
	}
	sections.push({ title: "Plugins", checks: pluginChecks });

	// ── 7. Context Directory Refresh ───────────────────────────────────────────
	const contextChecks: DoctorCheck[] = [];
	try {
		const result = await contextRefresher(cwd);
		if (result) {
			contextChecks.push({
				label: ".context/ refresh",
				status: "ok",
				detail: "INDEX.md + summary.md updated",
			});
			// A manifest that could not be read is not "no dependencies" — surface
			// each warning so an unreadable/oversized/invalid manifest is visible.
			for (const warning of result.warnings) {
				contextChecks.push({
					label: "dependency manifest",
					status: "fail",
					detail: warning,
				});
			}
		} else {
			contextChecks.push({
				label: ".context/ refresh",
				status: "skip",
				detail: "no .context/ or no manifest found",
			});
		}
	} catch (e) {
		contextChecks.push({
			label: ".context/ refresh",
			status: "fail",
			detail: `refresh failed: ${String(e)}`,
		});
	}
	sections.push({ title: "Context Directory", checks: contextChecks });

	return { state: "supported", sections };
}
