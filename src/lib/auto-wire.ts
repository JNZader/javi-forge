import fs from "fs-extra";
import path from "path";
import type {
	AutoWireEntry,
	AutoWireResult,
	InstalledPlugin,
} from "../types/index.js";

// ── Markers ────────────────────────────────────────────────────────────────

const WIRE_START = "<!-- javi-forge:auto-wire:start -->";
const WIRE_END = "<!-- javi-forge:auto-wire:end -->";

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Scan installed plugins in a project and wire their capabilities into
 * the project's CLAUDE.md (skill/plugin entries) and .claude/settings.json
 * (hooks). Idempotent — re-running produces the same result.
 */
export async function autoWirePlugins(
	projectDir: string,
	installedPlugins: InstalledPlugin[],
	options: { dryRun?: boolean } = {},
): Promise<AutoWireResult> {
	const { dryRun = false } = options;
	const wired: AutoWireEntry[] = [];
	const unwired: AutoWireEntry[] = [];
	const errors: string[] = [];

	// ── Collect desired entries from plugin manifests ─────────────────────
	const desiredSkills: AutoWireEntry[] = [];
	const desiredHooks: AutoWireEntry[] = [];

	for (const plugin of installedPlugins) {
		const { manifest } = plugin;
		if (!manifest) continue;

		// Skills → CLAUDE.md skill loader lines
		for (const skill of manifest.skills ?? []) {
			desiredSkills.push({
				plugin: manifest.name,
				target: "claude-md",
				capability: "skill",
				value: skill,
			});
		}

		// Hooks → .claude/settings.json
		for (const hook of manifest.hooks ?? []) {
			desiredHooks.push({
				plugin: manifest.name,
				target: "settings-json",
				capability: "hook",
				value: hook,
			});
		}
	}

	// ── Wire skills into CLAUDE.md ───────────────────────────────────────
	try {
		const claudeResult = await wireClaudeMd(
			projectDir,
			desiredSkills,
			installedPlugins,
			dryRun,
		);
		wired.push(...claudeResult.wired);
		unwired.push(...claudeResult.unwired);
	} catch (e: unknown) {
		errors.push(
			`CLAUDE.md wiring failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	// ── Wire hooks into .claude/settings.json ────────────────────────────
	try {
		const hooksResult = await wireSettingsJson(
			projectDir,
			desiredHooks,
			installedPlugins,
			dryRun,
		);
		wired.push(...hooksResult.wired);
		unwired.push(...hooksResult.unwired);
	} catch (e: unknown) {
		errors.push(
			`settings.json wiring failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	return { wired, unwired, errors };
}

// ── CLAUDE.md Wiring ───────────────────────────────────────────────────────

/**
 * Build the auto-wire section content for CLAUDE.md.
 * Pure function — no I/O.
 */
export function buildAutoWireSection(plugins: InstalledPlugin[]): string {
	const lines: string[] = [];

	lines.push(WIRE_START);
	lines.push("");
	lines.push("## Plugins (auto-wired)");
	lines.push("");

	for (const plugin of plugins) {
		const { manifest } = plugin;
		if (!manifest) continue;

		lines.push(`### ${manifest.name} v${manifest.version}`);
		lines.push(`> ${manifest.description}`);
		lines.push("");

		// Skills
		const skills = manifest.skills ?? [];
		if (skills.length > 0) {
			for (const skill of skills) {
				lines.push(
					`- Load \`~/.claude/plugins/${manifest.name}/skills/${skill}/SKILL.md\` when working with ${skill}`,
				);
			}
			lines.push("");
		}

		// Commands
		const commands = manifest.commands ?? [];
		if (commands.length > 0) {
			lines.push("**Commands:**");
			for (const cmd of commands) {
				lines.push(`- \`/${cmd}\``);
			}
			lines.push("");
		}

		// Agents
		const agents = manifest.agents ?? [];
		if (agents.length > 0) {
			lines.push("**Agents:**");
			for (const agent of agents) {
				lines.push(`- ${agent}`);
			}
			lines.push("");
		}
	}

	lines.push(WIRE_END);

	return lines.join("\n");
}

async function wireClaudeMd(
	projectDir: string,
	desiredSkills: AutoWireEntry[],
	plugins: InstalledPlugin[],
	dryRun: boolean,
): Promise<{ wired: AutoWireEntry[]; unwired: AutoWireEntry[] }> {
	const claudeMdPath = path.join(projectDir, "CLAUDE.md");
	const wired: AutoWireEntry[] = [];
	const unwired: AutoWireEntry[] = [];

	// If no plugins have capabilities, remove section if present
	const pluginsWithCapabilities = plugins.filter((p) => {
		const m = p.manifest;
		if (!m) return false;
		return (
			(m.skills?.length ?? 0) > 0 ||
			(m.commands?.length ?? 0) > 0 ||
			(m.agents?.length ?? 0) > 0
		);
	});

	let content = "";
	if (await fs.pathExists(claudeMdPath)) {
		content = await fs.readFile(claudeMdPath, "utf-8");
	}

	// Remove existing auto-wire section (idempotent)
	const cleaned = removeAutoWireSection(content);

	if (pluginsWithCapabilities.length === 0) {
		// Nothing to wire — if we cleaned something, that's an unwire
		if (cleaned !== content && !dryRun) {
			await fs.writeFile(claudeMdPath, cleaned, "utf-8");
		}
		return { wired, unwired };
	}

	// Build new section
	const section = buildAutoWireSection(pluginsWithCapabilities);
	const newContent = cleaned.trimEnd() + "\n\n" + section + "\n";

	if (!dryRun) {
		await fs.ensureDir(path.dirname(claudeMdPath));
		await fs.writeFile(claudeMdPath, newContent, "utf-8");
	}

	// Track what was wired
	for (const entry of desiredSkills) {
		wired.push(entry);
	}
	for (const plugin of pluginsWithCapabilities) {
		for (const cmd of plugin.manifest.commands ?? []) {
			wired.push({
				plugin: plugin.manifest.name,
				target: "claude-md",
				capability: "command",
				value: cmd,
			});
		}
		for (const agent of plugin.manifest.agents ?? []) {
			wired.push({
				plugin: plugin.manifest.name,
				target: "claude-md",
				capability: "agent",
				value: agent,
			});
		}
	}

	return { wired, unwired };
}

// ── Settings.json Wiring ───────────────────────────────────────────────────

async function wireSettingsJson(
	projectDir: string,
	desiredHooks: AutoWireEntry[],
	_plugins: InstalledPlugin[],
	dryRun: boolean,
): Promise<{ wired: AutoWireEntry[]; unwired: AutoWireEntry[] }> {
	const wired: AutoWireEntry[] = [];
	const unwired: AutoWireEntry[] = [];

	if (desiredHooks.length === 0) return { wired, unwired };

	const settingsPath = path.join(projectDir, ".claude", "settings.json");
	let settings: Record<string, unknown> = {};

	if (await fs.pathExists(settingsPath)) {
		try {
			settings = await fs.readJson(settingsPath);
		} catch {
			settings = {};
		}
	}

	// Ensure hooks object
	const hooks = (settings["hooks"] ?? {}) as Record<string, unknown>;
	const pluginHooks = (hooks["plugin-hooks"] ?? []) as string[];
	const existingSet = new Set(pluginHooks);

	for (const entry of desiredHooks) {
		if (existingSet.has(entry.value)) {
			// Already wired — skip (idempotent)
			continue;
		}
		pluginHooks.push(entry.value);
		existingSet.add(entry.value);
		wired.push(entry);
	}

	// Detect hooks that belong to removed plugins
	const activePluginNames = new Set(desiredHooks.map((h) => h.plugin));
	const cleanedHooks = pluginHooks.filter((h) => {
		// Keep hooks that we just wired or that belong to active plugins
		const belongsToActive = desiredHooks.some((d) => d.value === h);
		if (!belongsToActive) {
			unwired.push({
				plugin: "unknown",
				target: "settings-json",
				capability: "hook",
				value: h,
			});
			return false;
		}
		return true;
	});

	hooks["plugin-hooks"] = cleanedHooks;
	settings["hooks"] = hooks;

	if (!dryRun && (wired.length > 0 || unwired.length > 0)) {
		await fs.ensureDir(path.dirname(settingsPath));
		await fs.writeJson(settingsPath, settings, { spaces: 2 });
	}

	return { wired, unwired };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Remove the auto-wire section from CLAUDE.md content.
 * Returns cleaned content.
 */
export function removeAutoWireSection(content: string): string {
	const startIdx = content.indexOf(WIRE_START);
	if (startIdx === -1) return content;

	const endIdx = content.indexOf(WIRE_END);
	if (endIdx === -1) return content;

	const before = content.slice(0, startIdx).trimEnd();
	const after = content.slice(endIdx + WIRE_END.length).trimStart();

	if (after) {
		return before + "\n\n" + after;
	}
	return before + "\n";
}
