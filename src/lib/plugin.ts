import path from "node:path";
import fs from "fs-extra";
import {
	PLUGIN_ASSET_DIRS,
	PLUGIN_MANIFEST_FILE,
	PLUGIN_REGISTRY_URL,
	PLUGINS_DIR,
} from "../constants.js";
import type {
	ForgeManifest,
	InstalledPlugin,
	PluginManifest,
	PluginRegistry,
	PluginRegistryEntry,
	PluginSyncResult,
	PluginValidationError,
	PluginValidationResult,
} from "../types/index.js";
import { generateAgentSkillsManifest } from "./agent-skills.js";
import { autoWirePlugins } from "./auto-wire.js";
import { execFileAsync } from "./exec.js";
import {
	type PluginReplacementDiagnostics,
	publishPluginReplacement,
} from "./plugin-replacement.js";
import {
	evaluateCoverageGate,
	scanFailureMessage,
} from "./skill-install-gate.js";
import type { SkillCoverageScan } from "./skill-scanner.js";
import { scanSkillsWithCoverage } from "./skill-scanner.js";

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a plugin directory structure and manifest.
 */
export async function validatePlugin(
	pluginDir: string,
): Promise<PluginValidationResult> {
	const errors: PluginValidationError[] = [];

	// Check plugin.json exists
	const manifestPath = path.join(pluginDir, PLUGIN_MANIFEST_FILE);
	if (!(await fs.pathExists(manifestPath))) {
		return {
			valid: false,
			errors: [
				{ path: PLUGIN_MANIFEST_FILE, message: "plugin.json not found" },
			],
			manifest: null,
		};
	}

	// Parse manifest
	let manifest: PluginManifest;
	try {
		manifest = (await fs.readJson(manifestPath)) as PluginManifest;
	} catch {
		return {
			valid: false,
			errors: [{ path: PLUGIN_MANIFEST_FILE, message: "invalid JSON" }],
			manifest: null,
		};
	}

	// Validate required fields
	if (typeof manifest.name !== "string" || !manifest.name) {
		errors.push({ path: "name", message: "name is required" });
	} else if (!KEBAB_RE.test(manifest.name)) {
		errors.push({ path: "name", message: "name must be kebab-case" });
	} else if (manifest.name.length < 2 || manifest.name.length > 60) {
		errors.push({ path: "name", message: "name must be 2-60 characters" });
	}

	if (typeof manifest.version !== "string" || !manifest.version) {
		errors.push({ path: "version", message: "version is required" });
	} else if (!SEMVER_RE.test(manifest.version)) {
		errors.push({
			path: "version",
			message: "version must be semver (e.g. 1.0.0)",
		});
	}

	if (typeof manifest.description !== "string" || !manifest.description) {
		errors.push({ path: "description", message: "description is required" });
	} else if (manifest.description.length < 10) {
		errors.push({
			path: "description",
			message: "description must be at least 10 characters",
		});
	} else if (manifest.description.length > 200) {
		errors.push({
			path: "description",
			message: "description must be at most 200 characters",
		});
	}

	// Validate asset directories actually exist when declared
	for (const assetType of PLUGIN_ASSET_DIRS) {
		const declared = manifest[assetType];
		if (!Array.isArray(declared) || declared.length === 0) continue;

		const assetDir = path.join(pluginDir, assetType);
		if (!(await fs.pathExists(assetDir))) {
			errors.push({
				path: assetType,
				message: `declared ${assetType}/ directory not found`,
			});
			continue;
		}

		// Check each declared asset exists
		for (const entry of declared) {
			const entryPath = path.join(assetDir, entry);
			if (!(await fs.pathExists(entryPath))) {
				errors.push({
					path: `${assetType}/${entry}`,
					message: `declared entry not found`,
				});
			}
		}
	}

	// Validate tags
	if (manifest.tags && !Array.isArray(manifest.tags)) {
		errors.push({ path: "tags", message: "tags must be an array" });
	} else if (manifest.tags && manifest.tags.length > 10) {
		errors.push({ path: "tags", message: "max 10 tags allowed" });
	}

	return {
		valid: errors.length === 0,
		errors,
		manifest: errors.length === 0 ? manifest : manifest,
	};
}

// ── Installation ────────────────────────────────────────────────────────────

/**
 * Install a plugin from a GitHub repository.
 * Clones the repo to a temp dir, validates, then copies to plugins dir.
 */
export async function installPlugin(
	source: string,
	options: { dryRun?: boolean; force?: boolean } = {},
): Promise<
	PluginReplacementDiagnostics & {
		success: boolean;
		name?: string;
		error?: string;
		/**
		 * FU-1 (R4-002): true when the failure is a skillguard gate refusal
		 * (manifest-integrity or verdict refusal, incl. a scanner-error deny).
		 * The CLI layer turns this into a non-zero exit code so scripted
		 * consumers can tell a refusal apart from success. Plain usage errors
		 * (invalid source, validation failed) leave it unset.
		 */
		refused?: boolean;
	}
> {
	const { dryRun = false, force = false } = options;

	// Normalize source to a git URL
	const gitUrl = normalizeGitUrl(source);
	if (!gitUrl) {
		return {
			success: false,
			error: `invalid source: ${source}. Use org/repo or a GitHub URL`,
		};
	}

	// Clone to temp
	let tmpDir = "";

	try {
		if (!dryRun) {
			await fs.ensureDir(path.join(PLUGINS_DIR, ".tmp"));
			tmpDir = await fs.mkdtemp(path.join(PLUGINS_DIR, ".tmp", "install-"));
			await execFileAsync("git", ["clone", "--depth", "1", gitUrl, tmpDir], {
				timeout: 60_000,
			});
		}

		// Validate
		const validation = dryRun
			? {
					valid: true,
					errors: [],
					manifest: {
						name: source.split("/").pop() ?? "unknown",
						version: "0.0.0",
						description: "dry-run placeholder",
					} as PluginManifest,
				}
			: await validatePlugin(tmpDir);

		if (!validation.valid || !validation.manifest) {
			const msgs = validation.errors
				.map((e) => `  ${e.path}: ${e.message}`)
				.join("\n");
			return { success: false, error: `validation failed:\n${msgs}` };
		}

		const pluginManifest = validation.manifest;
		const pluginName = pluginManifest.name;

		if (!dryRun) {
			// ── SkillGuard runtime gate (D1/D3, JD-006/JD-007) ────────────
			// Runs BEFORE the existing-install remove and fs.move: a refusal
			// leaves staging intact (removed by `finally`) and never destroys a
			// prior install. dryRun skips the gate entirely (no staged clone).
			// Scanner/eval errors deny unconditionally (D7 — a throw is not a
			// verdict, so no force branch consults it). The refusal policy +
			// message-building is shared with plugin import via
			// evaluateCoverageGate (R2-001).
			let coverage: SkillCoverageScan;
			try {
				const declaredPaths = (validation.manifest.skills ?? []).map((skill) =>
					path.join("skills", skill),
				);
				coverage = await scanSkillsWithCoverage(tmpDir, declaredPaths);
			} catch (scanError) {
				return {
					success: false,
					refused: true,
					error: scanFailureMessage(scanError),
				};
			}

			const decision = evaluateCoverageGate(coverage, { force });
			if (decision.refusalError) {
				return {
					success: false,
					refused: true,
					error: decision.refusalError,
				};
			}

			const publication = await publishPluginReplacement(
				PLUGINS_DIR,
				pluginName,
				async (stage) => {
					await fs.copy(tmpDir, stage, {
						filter: (file) =>
							![
								path.join(tmpDir, ".installed.json"),
								path.join(tmpDir, "skills.json"),
							].includes(file),
					});
					const installedPlugin: InstalledPlugin = {
						name: pluginName,
						version: pluginManifest.version,
						installedAt: new Date().toISOString(),
						source,
						manifest: pluginManifest,
					};
					await fs.writeJson(
						path.join(stage, ".installed.json"),
						installedPlugin,
						{ spaces: 2 },
					);

					// Generate Agent Skills spec manifest for cross-agent compatibility
					await generateAgentSkillsManifest(stage, source).catch(() => {});
				},
			);
			return { ...publication, name: pluginName };
		}

		return { success: true, name: pluginName };
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		return { success: false, error: msg };
	} finally {
		// Clean up tmp if it still exists (error path)
		if (tmpDir && (await fs.pathExists(tmpDir))) {
			await fs.remove(tmpDir).catch(() => {});
		}
	}
}

/**
 * Remove only a directly contained directory with matching install metadata.
 * This is an identity/containment check, not a revalidation of plugin assets:
 * an installed plugin with broken assets must still be removable.
 */
export async function removePlugin(
	name: string,
	options: { dryRun?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
	if (!KEBAB_RE.test(name) || name.length < 2 || name.length > 60) {
		return {
			success: false,
			error:
				"invalid plugin name: expected 2-60 lowercase kebab-case characters",
		};
	}
	const root = path.resolve(PLUGINS_DIR);
	const pluginDir = path.resolve(root, name);
	if (path.dirname(pluginDir) !== root) {
		return {
			success: false,
			error:
				"plugin destination must be a direct child of the plugins directory",
		};
	}
	if (!(await fs.pathExists(pluginDir))) {
		return { success: false, error: `plugin "${name}" is not installed` };
	}

	try {
		const directory = await fs.lstat(pluginDir);
		if (!directory.isDirectory() || directory.isSymbolicLink()) {
			return {
				success: false,
				error: "plugin destination must be a non-symlink directory",
			};
		}
		const rootReal = await fs.realpath(root);
		const pluginReal = await fs.realpath(pluginDir);
		if (pluginReal !== path.join(rootReal, name)) {
			return {
				success: false,
				error: "plugin destination resolves outside its expected directory",
			};
		}
		const metadataPath = path.join(pluginDir, ".installed.json");
		const marker = await fs.lstat(metadataPath);
		if (!marker.isFile() || marker.isSymbolicLink()) {
			return {
				success: false,
				error: "plugin installation metadata must be a non-symlink file",
			};
		}
		const metadata: unknown = await fs.readJson(metadataPath);
		if (
			typeof metadata !== "object" ||
			metadata === null ||
			!("name" in metadata) ||
			metadata.name !== name ||
			!("manifest" in metadata) ||
			typeof metadata.manifest !== "object" ||
			metadata.manifest === null ||
			!("name" in metadata.manifest) ||
			metadata.manifest.name !== name
		) {
			return {
				success: false,
				error: "plugin installation identity does not match the requested name",
			};
		}
		if (!options.dryRun) await fs.remove(pluginDir);
		return { success: true };
	} catch (error: unknown) {
		return {
			success: false,
			error: `cannot remove plugin "${name}": ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

// ── Listing & Search ────────────────────────────────────────────────────────

/**
 * List all installed plugins.
 */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
	if (!(await fs.pathExists(PLUGINS_DIR))) return [];

	const entries = await fs.readdir(PLUGINS_DIR);
	const plugins: InstalledPlugin[] = [];

	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		const metaPath = path.join(PLUGINS_DIR, entry, ".installed.json");
		if (await fs.pathExists(metaPath)) {
			try {
				const meta = (await fs.readJson(metaPath)) as InstalledPlugin;
				plugins.push(meta);
			} catch {
				/* skip corrupt entries */
			}
		}
	}

	return plugins;
}

export const REGISTRY_SEARCH_STATUS = {
	SUCCESS: "success",
	UNAVAILABLE: "unavailable",
	CANCELLED: "cancelled",
} as const;

export type RegistrySearchResult =
	| {
			status: typeof REGISTRY_SEARCH_STATUS.SUCCESS;
			entries: PluginRegistryEntry[];
	  }
	| { status: typeof REGISTRY_SEARCH_STATUS.UNAVAILABLE }
	| { status: typeof REGISTRY_SEARCH_STATUS.CANCELLED };

function isRegistryEntry(value: unknown): value is PluginRegistryEntry {
	return (
		typeof value === "object" &&
		value !== null &&
		"id" in value &&
		typeof value.id === "string" &&
		"repository" in value &&
		typeof value.repository === "string" &&
		"description" in value &&
		typeof value.description === "string" &&
		"tags" in value &&
		Array.isArray(value.tags) &&
		value.tags.every((tag: unknown) => typeof tag === "string") &&
		(!("stars" in value) ||
			(typeof value.stars === "number" && Number.isFinite(value.stars))) &&
		(!("updatedAt" in value) || typeof value.updatedAt === "string")
	);
}

function isRegistry(value: unknown): value is PluginRegistry {
	return (
		typeof value === "object" &&
		value !== null &&
		"version" in value &&
		typeof value.version === "string" &&
		"updatedAt" in value &&
		typeof value.updatedAt === "string" &&
		"plugins" in value &&
		Array.isArray(value.plugins) &&
		value.plugins.every(isRegistryEntry)
	);
}

/**
 * Fetch and validate the registry within one 10-second fetch/body deadline.
 * Cancellation settles this API even when a transport ignores abort; it cannot
 * forcibly terminate that transport. Late completion/rejection remains handled.
 */
export async function searchRegistry(
	query?: string,
	signal?: AbortSignal,
): Promise<RegistrySearchResult> {
	if (signal?.aborted) return { status: REGISTRY_SEARCH_STATUS.CANCELLED };

	return new Promise((resolve) => {
		const controller = new AbortController();
		let settled = false;
		const finish = (result: RegistrySearchResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", cancel);
			resolve(result);
		};
		const cancel = () => {
			finish({ status: REGISTRY_SEARCH_STATUS.CANCELLED });
			controller.abort();
		};
		const timer = setTimeout(() => {
			finish({ status: REGISTRY_SEARCH_STATUS.UNAVAILABLE });
			controller.abort();
		}, 10_000);
		signal?.addEventListener("abort", cancel, { once: true });

		const request = async (): Promise<RegistrySearchResult> => {
			const response = await fetch(PLUGIN_REGISTRY_URL, {
				signal: controller.signal,
			});
			if (settled || !response.ok)
				return { status: REGISTRY_SEARCH_STATUS.UNAVAILABLE };
			const registry: unknown = await response.json();
			if (!isRegistry(registry))
				return { status: REGISTRY_SEARCH_STATUS.UNAVAILABLE };
			const q = query?.toLowerCase();
			const entries = q
				? registry.plugins.filter(
						(p) =>
							p.id.toLowerCase().includes(q) ||
							p.description.toLowerCase().includes(q) ||
							p.tags.some((t) => t.toLowerCase().includes(q)),
					)
				: registry.plugins;
			return { status: REGISTRY_SEARCH_STATUS.SUCCESS, entries };
		};
		void request().then(finish, () =>
			finish({ status: REGISTRY_SEARCH_STATUS.UNAVAILABLE }),
		);
	});
}

// ── Sync ───────────────────────────────────────────────────────────────

/**
 * Detect installed plugins in a project's .javi-forge/plugins/ directory.
 * Returns an array of plugin names (sorted alphabetically).
 */
export async function detectProjectPlugins(
	projectDir: string,
): Promise<string[]> {
	const full = await detectProjectPluginsFull(projectDir);
	return full.map((p) => p.name).sort();
}

/**
 * Detect installed plugins with full metadata (including manifest).
 * Used by auto-wiring to read plugin capabilities.
 */
export async function detectProjectPluginsFull(
	projectDir: string,
): Promise<InstalledPlugin[]> {
	const pluginsDir = path.join(projectDir, ".javi-forge", "plugins");

	if (!(await fs.pathExists(pluginsDir))) return [];

	const entries = await fs.readdir(pluginsDir);
	const plugins: InstalledPlugin[] = [];

	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		const metaPath = path.join(pluginsDir, entry, ".installed.json");
		if (await fs.pathExists(metaPath)) {
			try {
				const meta = (await fs.readJson(metaPath)) as InstalledPlugin;
				if (meta.name) {
					plugins.push(meta);
				}
			} catch {
				/* skip corrupt entries */
			}
		}
	}

	return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Sync detected plugins into the project manifest and auto-wire
 * their capabilities into CLAUDE.md and .claude/settings.json.
 * Returns a report of added, removed, unchanged, wired, and unwired plugins.
 */
export async function syncPlugins(
	projectDir: string,
	options: { dryRun?: boolean } = {},
): Promise<PluginSyncResult> {
	const { dryRun = false } = options;
	const detectedFull = await detectProjectPluginsFull(projectDir);
	const detected = detectedFull.map((p) => p.name).sort();

	const manifestPath = path.join(projectDir, ".javi-forge", "manifest.json");
	let manifest: ForgeManifest & { plugins?: string[] };

	if (await fs.pathExists(manifestPath)) {
		manifest = (await fs.readJson(manifestPath)) as ForgeManifest & {
			plugins?: string[];
		};
	} else {
		// No manifest yet — treat current plugins as empty
		manifest = {
			version: "0.1.0",
			projectName: path.basename(projectDir),
			stack: "node",
			ciProvider: "github",
			memory: "none",
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			modules: [],
		};
	}

	const previous = new Set(manifest.plugins ?? []);
	const current = new Set(detected);

	const added = detected.filter((p) => !previous.has(p));
	const removed = [...previous].filter((p) => !current.has(p));
	const unchanged = detected.filter((p) => previous.has(p));

	if (!dryRun && (added.length > 0 || removed.length > 0)) {
		manifest.plugins = detected;
		manifest.updatedAt = new Date().toISOString();
		await fs.ensureDir(path.dirname(manifestPath));
		await fs.writeJson(manifestPath, manifest, { spaces: 2 });
	}

	// ── Auto-wire plugin capabilities ──────────────────────────────────
	const wireResult = await autoWirePlugins(projectDir, detectedFull, {
		dryRun,
	});

	return {
		added,
		removed,
		unchanged,
		wired: wireResult.wired,
		unwired: wireResult.unwired,
	};
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize a GitHub source to a git clone URL.
 * Accepts: "org/repo", "https://github.com/org/repo", "github.com/org/repo"
 */
export function normalizeGitUrl(source: string): string | null {
	// Already a full URL
	if (source.startsWith("https://github.com/")) {
		return source.endsWith(".git") ? source : `${source}.git`;
	}

	// github.com/org/repo
	if (source.startsWith("github.com/")) {
		return `https://${source}.git`;
	}

	// org/repo shorthand
	const parts = source.split("/");
	if (parts.length === 2 && parts[0] && parts[1]) {
		return `https://github.com/${parts[0]}/${parts[1]}.git`;
	}

	return null;
}
