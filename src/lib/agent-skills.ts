import fs from "fs-extra";
import path from "path";
import {
	AGENT_SKILLS_MANIFEST_FILE,
	PLUGIN_MANIFEST_FILE,
	PLUGINS_DIR,
} from "../constants.js";
import type {
	AgentSkillEntry,
	AgentSkillSource,
	AgentSkillsManifest,
	AggregatedSkillsManifest,
	InstalledPlugin,
	PluginManifest,
} from "../types/index.js";

// ── Conversion ─────────────────────────────────────────────────────────────

/**
 * Convert a javi-forge PluginManifest to an Agent Skills spec manifest.
 */
export function pluginToAgentSkills(
	manifest: PluginManifest,
	source?: string,
): AgentSkillsManifest {
	const skills: AgentSkillEntry[] = (manifest.skills ?? []).map((s) => ({
		name: s,
		description: `${s} skill from ${manifest.name}`,
		path: `skills/${s}`,
	}));

	return {
		name: manifest.name,
		version: manifest.version,
		description: manifest.description,
		skills,
		...(source ? { metadata: { forge_source: source } } : {}),
	};
}

/**
 * Convert an Agent Skills spec manifest to a javi-forge PluginManifest.
 */
export function agentSkillsToPlugin(
	agentManifest: AgentSkillsManifest,
): PluginManifest {
	return {
		name: agentManifest.name,
		version: agentManifest.version,
		description: agentManifest.description,
		skills: agentManifest.skills.map((s) => s.name),
		tags: ["agent-skills-import"],
	};
}

// ── File I/O ───────────────────────────────────────────────────────────────

/**
 * Generate a skills.json file in the given plugin directory from its plugin.json.
 */
export async function generateAgentSkillsManifest(
	pluginDir: string,
	source?: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
	const manifestPath = path.join(pluginDir, PLUGIN_MANIFEST_FILE);

	if (!(await fs.pathExists(manifestPath))) {
		return { success: false, error: "plugin.json not found" };
	}

	let manifest: PluginManifest;
	try {
		manifest = (await fs.readJson(manifestPath)) as PluginManifest;
	} catch {
		return { success: false, error: "invalid plugin.json" };
	}

	const agentManifest = pluginToAgentSkills(manifest, source);
	const outPath = path.join(pluginDir, AGENT_SKILLS_MANIFEST_FILE);
	await fs.writeJson(outPath, agentManifest, { spaces: 2 });

	return { success: true, path: outPath };
}

/**
 * Export an installed plugin to Agent Skills format.
 * Looks up the plugin by name in the global plugins directory.
 */
export async function exportPluginAsAgentSkills(
	name: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
	const pluginDir = path.join(PLUGINS_DIR, name);

	if (!(await fs.pathExists(pluginDir))) {
		return { success: false, error: `plugin "${name}" is not installed` };
	}

	return generateAgentSkillsManifest(pluginDir);
}

/**
 * Import an Agent Skills spec package from a directory.
 * Reads skills.json, converts to plugin.json, copies to plugins dir.
 */
export async function importAgentSkillsPackage(
	sourceDir: string,
	options: { dryRun?: boolean } = {},
): Promise<{ success: boolean; name?: string; error?: string }> {
	const { dryRun = false } = options;
	const skillsPath = path.join(sourceDir, AGENT_SKILLS_MANIFEST_FILE);

	if (!(await fs.pathExists(skillsPath))) {
		return { success: false, error: "skills.json not found" };
	}

	let agentManifest: AgentSkillsManifest;
	try {
		agentManifest = (await fs.readJson(skillsPath)) as AgentSkillsManifest;
	} catch {
		return { success: false, error: "invalid skills.json" };
	}

	if (
		!agentManifest.name ||
		!agentManifest.version ||
		!agentManifest.description
	) {
		return {
			success: false,
			error: "skills.json missing required fields (name, version, description)",
		};
	}

	const pluginName = agentManifest.name;

	if (dryRun) {
		return { success: true, name: pluginName };
	}

	const destDir = path.join(PLUGINS_DIR, pluginName);

	// Remove existing version if present
	if (await fs.pathExists(destDir)) {
		await fs.remove(destDir);
	}

	// Copy the source directory
	await fs.copy(sourceDir, destDir);

	// Generate plugin.json from skills.json
	const pluginManifest = agentSkillsToPlugin(agentManifest);
	await fs.writeJson(path.join(destDir, PLUGIN_MANIFEST_FILE), pluginManifest, {
		spaces: 2,
	});

	// Write install metadata
	const installedPlugin: InstalledPlugin = {
		name: pluginName,
		version: agentManifest.version,
		installedAt: new Date().toISOString(),
		source: `agent-skills:${sourceDir}`,
		manifest: pluginManifest,
	};
	await fs.writeJson(path.join(destDir, ".installed.json"), installedPlugin, {
		spaces: 2,
	});

	return { success: true, name: pluginName };
}

// ── Aggregation ──────────────────────────────────────────────────────────

/**
 * Aggregate multiple installed plugins into a single Agent Skills spec manifest.
 * This enables the entire registry (or a project's installed plugins) to be
 * discoverable via `npx skills add` by any of the 40+ compatible AI agents.
 *
 * Pure function — no I/O.
 */
export function aggregatePluginsToSkillsJson(
	plugins: InstalledPlugin[],
	registryName: string = "javi-forge-registry",
	registryVersion: string = "1.0.0",
): AggregatedSkillsManifest {
	const skills: AgentSkillEntry[] = [];
	const sources: AgentSkillSource[] = [];

	for (const plugin of plugins) {
		const { manifest } = plugin;
		if (!manifest) continue;

		sources.push({
			plugin: manifest.name,
			version: manifest.version,
			...(manifest.repository ? { repository: manifest.repository } : {}),
		});

		for (const skillName of manifest.skills ?? []) {
			skills.push({
				name: `${manifest.name}/${skillName}`,
				description: `${skillName} skill from ${manifest.name} plugin`,
				path: `plugins/${manifest.name}/skills/${skillName}`,
			});
		}
	}

	return {
		name: registryName,
		version: registryVersion,
		description: `Aggregated skills from ${plugins.length} javi-forge plugin(s)`,
		skills,
		sources,
	};
}

/**
 * Generate a project-level skills.json from all installed plugins in a project.
 * Writes the aggregated manifest to the project's .javi-forge/ directory.
 */
export async function generateProjectSkillsJson(
	projectDir: string,
	options: { dryRun?: boolean; registryName?: string } = {},
): Promise<{
	success: boolean;
	path?: string;
	skillCount: number;
	pluginCount: number;
	error?: string;
}> {
	const { dryRun = false, registryName } = options;
	const pluginsDir = path.join(projectDir, ".javi-forge", "plugins");

	if (!(await fs.pathExists(pluginsDir))) {
		return {
			success: false,
			skillCount: 0,
			pluginCount: 0,
			error: "no plugins directory found",
		};
	}

	const entries = await fs.readdir(pluginsDir);
	const plugins: InstalledPlugin[] = [];

	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		const metaPath = path.join(pluginsDir, entry, ".installed.json");
		if (await fs.pathExists(metaPath)) {
			try {
				const meta = (await fs.readJson(metaPath)) as InstalledPlugin;
				if (meta.name) plugins.push(meta);
			} catch {
				/* skip corrupt entries */
			}
		}
	}

	if (plugins.length === 0) {
		return {
			success: false,
			skillCount: 0,
			pluginCount: 0,
			error: "no installed plugins found",
		};
	}

	const projectName = registryName ?? path.basename(projectDir);
	const aggregated = aggregatePluginsToSkillsJson(plugins, projectName);
	const outPath = path.join(projectDir, AGENT_SKILLS_MANIFEST_FILE);

	if (!dryRun) {
		await fs.writeJson(outPath, aggregated, { spaces: 2 });
	}

	return {
		success: true,
		path: outPath,
		skillCount: aggregated.skills.length,
		pluginCount: plugins.length,
	};
}

/**
 * Generate a skills.json from all globally installed plugins.
 * Writes to the global plugins directory.
 */
export async function generateGlobalSkillsJson(
	options: { dryRun?: boolean } = {},
): Promise<{
	success: boolean;
	path?: string;
	skillCount: number;
	pluginCount: number;
	error?: string;
}> {
	const { dryRun = false } = options;

	if (!(await fs.pathExists(PLUGINS_DIR))) {
		return {
			success: false,
			skillCount: 0,
			pluginCount: 0,
			error: "no plugins directory found",
		};
	}

	const entries = await fs.readdir(PLUGINS_DIR);
	const plugins: InstalledPlugin[] = [];

	for (const entry of entries) {
		if (entry.startsWith(".")) continue;
		const metaPath = path.join(PLUGINS_DIR, entry, ".installed.json");
		if (await fs.pathExists(metaPath)) {
			try {
				const meta = (await fs.readJson(metaPath)) as InstalledPlugin;
				if (meta.name) plugins.push(meta);
			} catch {
				/* skip corrupt entries */
			}
		}
	}

	if (plugins.length === 0) {
		return {
			success: false,
			skillCount: 0,
			pluginCount: 0,
			error: "no installed plugins found",
		};
	}

	const aggregated = aggregatePluginsToSkillsJson(plugins);
	const outPath = path.join(PLUGINS_DIR, AGENT_SKILLS_MANIFEST_FILE);

	if (!dryRun) {
		await fs.writeJson(outPath, aggregated, { spaces: 2 });
	}

	return {
		success: true,
		path: outPath,
		skillCount: aggregated.skills.length,
		pluginCount: plugins.length,
	};
}
