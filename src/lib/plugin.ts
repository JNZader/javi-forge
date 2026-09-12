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
const REGISTRY_REQUEST_TIMEOUT_MS = 10_000;

export type RegistrySearchResult =
	| { status: "success"; entries: PluginRegistryEntry[] }
	| { status: "unavailable" }
	| { status: "cancelled" };

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

					// Preserve the established best-effort skills manifest behavior.
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
 * Remove an installed plugin by name.
 */
export async function removePlugin(
	name: string,
	options: { dryRun?: boolean } = {},
): Promise<{ success: boolean; error?: string }> {
	const pluginDir = path.join(PLUGINS_DIR, name);

	if (!(await fs.pathExists(pluginDir))) {
		return { success: false, error: `plugin "${name}" is not installed` };
	}

	if (!options.dryRun) {
		await fs.remove(pluginDir);
	}

	return { success: true };
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

/**
 * Fetch the remote plugin registry and optionally filter by query.
 *
 * A registry that cannot be read or validated is deliberately distinct from a
 * valid registry with no matches. Callers need that distinction to avoid
 * presenting a network failure as a successful empty search.
 */
export async function searchRegistry(
	query?: string,
	options: { signal?: AbortSignal } = {},
): Promise<RegistrySearchResult> {
	const { signal: callerSignal } = options;
	if (callerSignal?.aborted) return { status: "cancelled" };

	const controller = new AbortController();
	let timedOut = false;
	let callerCancelled = false;
	let resolveDeadline!: () => void;
	const deadline = new Promise<void>((resolve) => {
		resolveDeadline = resolve;
	});

	const timeout = setTimeout(() => {
		timedOut = true;
		controller.abort();
		resolveDeadline();
	}, REGISTRY_REQUEST_TIMEOUT_MS);

	const cancelFromCaller = () => {
		callerCancelled = true;
		controller.abort();
		resolveDeadline();
	};
	callerSignal?.addEventListener("abort", cancelFromCaller, { once: true });

	try {
		const response = await Promise.race([
			Promise.resolve().then(() =>
				fetch(PLUGIN_REGISTRY_URL, { signal: controller.signal }),
			),
			deadline,
		]);

		if (callerCancelled || callerSignal?.aborted)
			return { status: "cancelled" };
		if (timedOut || !response || !response.ok) return { status: "unavailable" };

		const body = await Promise.race([response.json(), deadline]);
		if (callerCancelled || callerSignal?.aborted)
			return { status: "cancelled" };
		if (timedOut || !isPluginRegistry(body)) return { status: "unavailable" };

		const entries = query
			? filterRegistryEntries(body.plugins, query)
			: body.plugins;
		return { status: "success", entries };
	} catch {
		return callerCancelled || callerSignal?.aborted
			? { status: "cancelled" }
			: { status: "unavailable" };
	} finally {
		clearTimeout(timeout);
		callerSignal?.removeEventListener("abort", cancelFromCaller);
	}
}

function filterRegistryEntries(
	plugins: PluginRegistryEntry[],
	query: string,
): PluginRegistryEntry[] {
	const normalizedQuery = query.toLowerCase();
	return plugins.filter(
		(plugin) =>
			plugin.id.toLowerCase().includes(normalizedQuery) ||
			plugin.description.toLowerCase().includes(normalizedQuery) ||
			plugin.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery)),
	);
}

function isPluginRegistry(value: unknown): value is PluginRegistry {
	if (!isRecord(value)) return false;
	return (
		typeof value.version === "string" &&
		typeof value.updatedAt === "string" &&
		Array.isArray(value.plugins) &&
		value.plugins.every(isPluginRegistryEntry)
	);
}

function isPluginRegistryEntry(value: unknown): value is PluginRegistryEntry {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === "string" &&
		typeof value.repository === "string" &&
		typeof value.description === "string" &&
		Array.isArray(value.tags) &&
		value.tags.every((tag) => typeof tag === "string") &&
		(value.stars === undefined ||
			(typeof value.stars === "number" && Number.isFinite(value.stars))) &&
		(value.updatedAt === undefined || typeof value.updatedAt === "string")
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
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
