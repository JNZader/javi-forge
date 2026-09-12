import {
	exportPluginAsAgentSkills,
	generateGlobalSkillsJson,
	generateProjectSkillsJson,
	importAgentSkillsPackage,
} from "../lib/agent-skills.js";
import { exportPluginAsCodexToml } from "../lib/codex-export.js";
import {
	installPlugin,
	listInstalledPlugins,
	removePlugin,
	searchRegistry,
	syncPlugins,
	validatePlugin,
} from "../lib/plugin.js";
import type { InitStep } from "../types/index.js";

type StepCallback = (step: InitStep) => void;

export const PLUGIN_COMMAND_STATUS = {
	SUCCESS: "success",
	FAILURE: "failure",
	REFUSED: "refused",
} as const;

export type PluginCommandStatus =
	(typeof PLUGIN_COMMAND_STATUS)[keyof typeof PLUGIN_COMMAND_STATUS];

export const PLUGIN_COMMAND_ACTION = {
	ADD: "add",
	REMOVE: "remove",
	LIST: "list",
	SEARCH: "search",
	VALIDATE: "validate",
	SYNC: "sync",
	EXPORT: "export",
	IMPORT: "import",
	EXPORT_SKILLS: "export-skills",
} as const;

export interface PluginCommandResult {
	status: PluginCommandStatus;
}

export interface PluginCommandRequest {
	action?: string;
	target?: string;
	projectDir: string;
	dryRun: boolean;
	codex?: boolean;
	/** Force only unscannable sources; never override a guard block. */
	force?: boolean;
	signal?: AbortSignal;
}

function report(
	onStep: StepCallback,
	id: string,
	label: string,
	status: InitStep["status"],
	detail?: string,
) {
	onStep({ id, label, status, detail });
}

interface PluginSuccessDiagnostics {
	name?: string;
	warning?: string;
	recoveryPaths?: string[];
}

function successDetail(
	action: "install" | "import",
	dryRun: boolean,
	result: PluginSuccessDiagnostics,
): string {
	const verb = action === "install" ? "install" : "import";
	const past = action === "install" ? "installed" : "imported";
	const lines = [
		dryRun ? `dry-run: would ${verb} ${result.name}` : `${past} ${result.name}`,
	];
	if (result.warning) lines.push(`warning: ${result.warning}`);
	if (result.recoveryPaths?.length) {
		lines.push("manual recovery paths:");
		for (const recoveryPath of result.recoveryPaths) {
			lines.push(`  - ${recoveryPath}`);
		}
	}
	return lines.join("\n");
}

/**
 * Add (install) a plugin from a GitHub source.
 */
export async function runPluginAdd(
	source: string,
	dryRun: boolean,
	onStep: StepCallback,
	options: { force?: boolean } = {},
): Promise<PluginCommandResult> {
	const stepId = "plugin-add";
	report(onStep, stepId, `Install plugin: ${source}`, "running");

	const result = await installPlugin(source, { dryRun, force: options.force });

	if (result.success) {
		report(
			onStep,
			stepId,
			`Install plugin: ${source}`,
			"done",
			successDetail("install", dryRun, result),
		);
	} else {
		report(onStep, stepId, `Install plugin: ${source}`, "error", result.error);
	}
	return {
		status: result.success
			? PLUGIN_COMMAND_STATUS.SUCCESS
			: result.refused
				? PLUGIN_COMMAND_STATUS.REFUSED
				: PLUGIN_COMMAND_STATUS.FAILURE,
	};
}

/**
 * Remove an installed plugin by name.
 */
export async function runPluginRemove(
	name: string,
	dryRun: boolean,
	onStep: StepCallback,
): Promise<PluginCommandResult> {
	const stepId = "plugin-remove";
	report(onStep, stepId, `Remove plugin: ${name}`, "running");

	const result = await removePlugin(name, { dryRun });

	if (result.success) {
		report(
			onStep,
			stepId,
			`Remove plugin: ${name}`,
			"done",
			dryRun ? `dry-run: would remove ${name}` : `removed ${name}`,
		);
	} else {
		report(onStep, stepId, `Remove plugin: ${name}`, "error", result.error);
	}
	return {
		status: result.success
			? PLUGIN_COMMAND_STATUS.SUCCESS
			: PLUGIN_COMMAND_STATUS.FAILURE,
	};
}

/**
 * List all installed plugins.
 */
export async function runPluginList(
	onStep: StepCallback,
): Promise<PluginCommandResult> {
	const stepId = "plugin-list";
	report(onStep, stepId, "List installed plugins", "running");

	const plugins = await listInstalledPlugins();

	if (plugins.length === 0) {
		report(
			onStep,
			stepId,
			"List installed plugins",
			"done",
			"no plugins installed",
		);
	} else {
		const summary = plugins.map((p) => `${p.name}@${p.version}`).join(", ");
		report(
			onStep,
			stepId,
			"List installed plugins",
			"done",
			`${plugins.length} plugins: ${summary}`,
		);
	}
	return { status: PLUGIN_COMMAND_STATUS.SUCCESS };
}

/**
 * Search the remote plugin registry.
 */
export async function runPluginSearch(
	query: string | undefined,
	onStep: StepCallback,
	options: { signal?: AbortSignal } = {},
): Promise<PluginCommandResult> {
	const stepId = "plugin-search";
	report(
		onStep,
		stepId,
		`Search plugins${query ? `: ${query}` : ""}`,
		"running",
	);

	const results = await searchRegistry(query, options);

	if (results.status === "cancelled") {
		report(
			onStep,
			stepId,
			`Search plugins${query ? `: ${query}` : ""}`,
			"error",
			"registry search cancelled",
		);
		return { status: PLUGIN_COMMAND_STATUS.FAILURE };
	} else if (results.status === "unavailable") {
		report(
			onStep,
			stepId,
			`Search plugins${query ? `: ${query}` : ""}`,
			"error",
			"registry unavailable",
		);
		return { status: PLUGIN_COMMAND_STATUS.FAILURE };
	} else if (results.entries.length === 0) {
		report(
			onStep,
			stepId,
			`Search plugins${query ? `: ${query}` : ""}`,
			"done",
			query ? `no plugins matching "${query}"` : "registry empty",
		);
	} else {
		const summary = results.entries
			.map((p) => `${p.id} — ${p.description}`)
			.join("\n  ");
		report(
			onStep,
			stepId,
			`Search plugins${query ? `: ${query}` : ""}`,
			"done",
			`${results.entries.length} results:\n  ${summary}`,
		);
	}
	return { status: PLUGIN_COMMAND_STATUS.SUCCESS };
}

/**
 * Validate a local plugin directory.
 */
export async function runPluginValidate(
	pluginDir: string,
	onStep: StepCallback,
): Promise<PluginCommandResult> {
	const stepId = "plugin-validate";
	report(onStep, stepId, `Validate plugin: ${pluginDir}`, "running");

	const result = await validatePlugin(pluginDir);

	if (result.valid) {
		report(
			onStep,
			stepId,
			`Validate plugin: ${pluginDir}`,
			"done",
			`valid — ${result.manifest?.name}@${result.manifest?.version}`,
		);
	} else {
		const msgs = result.errors
			.map((e) => `  ${e.path}: ${e.message}`)
			.join("\n");
		report(
			onStep,
			stepId,
			`Validate plugin: ${pluginDir}`,
			"error",
			`${result.errors.length} errors:\n${msgs}`,
		);
	}
	return {
		status: result.valid
			? PLUGIN_COMMAND_STATUS.SUCCESS
			: PLUGIN_COMMAND_STATUS.FAILURE,
	};
}

/**
 * Sync detected plugins into the project manifest.
 */
export async function runPluginSync(
	projectDir: string,
	dryRun: boolean,
	onStep: StepCallback,
): Promise<PluginCommandResult> {
	const stepId = "plugin-sync";
	report(onStep, stepId, "Sync plugins", "running");

	try {
		const result = await syncPlugins(projectDir, { dryRun });

		const parts: string[] = [];
		if (result.added.length > 0)
			parts.push(`added: ${result.added.join(", ")}`);
		if (result.removed.length > 0)
			parts.push(`removed: ${result.removed.join(", ")}`);
		if (result.unchanged.length > 0)
			parts.push(`unchanged: ${result.unchanged.join(", ")}`);
		if (result.wired.length > 0)
			parts.push(`wired: ${result.wired.length} capabilities`);
		if (result.unwired.length > 0)
			parts.push(`unwired: ${result.unwired.length} capabilities`);
		if (parts.length === 0) parts.push("no plugins detected");

		const prefix = dryRun ? "dry-run: " : "";
		report(
			onStep,
			stepId,
			"Sync plugins",
			"done",
			`${prefix}${parts.join(" | ")}`,
		);
		return { status: PLUGIN_COMMAND_STATUS.SUCCESS };
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		report(onStep, stepId, "Sync plugins", "error", msg);
		return { status: PLUGIN_COMMAND_STATUS.FAILURE };
	}
}

/**
 * Export an installed plugin to Agent Skills spec format.
 */
export async function runPluginExport(
	name: string,
	onStep: StepCallback,
): Promise<PluginCommandResult> {
	const stepId = "plugin-export";
	report(onStep, stepId, `Export plugin: ${name}`, "running");

	const result = await exportPluginAsAgentSkills(name);

	if (result.success) {
		report(
			onStep,
			stepId,
			`Export plugin: ${name}`,
			"done",
			`exported to ${result.path}`,
		);
	} else {
		report(onStep, stepId, `Export plugin: ${name}`, "error", result.error);
	}
	return {
		status: result.success
			? PLUGIN_COMMAND_STATUS.SUCCESS
			: PLUGIN_COMMAND_STATUS.FAILURE,
	};
}

/**
 * Export an installed plugin to Codex-compatible TOML subagent files.
 */
export async function runPluginExportCodex(
	name: string,
	onStep: StepCallback,
): Promise<PluginCommandResult> {
	const stepId = "plugin-export-codex";
	report(onStep, stepId, `Export plugin as Codex TOML: ${name}`, "running");

	const result = await exportPluginAsCodexToml(name);

	if (result.success) {
		report(
			onStep,
			stepId,
			`Export plugin as Codex TOML: ${name}`,
			"done",
			`exported ${result.files?.length} TOML file(s)`,
		);
	} else {
		report(
			onStep,
			stepId,
			`Export plugin as Codex TOML: ${name}`,
			"error",
			result.error,
		);
	}
	return {
		status: result.success
			? PLUGIN_COMMAND_STATUS.SUCCESS
			: PLUGIN_COMMAND_STATUS.FAILURE,
	};
}

/**
 * Import an Agent Skills spec package and convert to javi-forge plugin format.
 */
export async function runPluginImport(
	sourceDir: string,
	dryRun: boolean,
	onStep: StepCallback,
	options: { force?: boolean } = {},
): Promise<PluginCommandResult> {
	const stepId = "plugin-import";
	report(
		onStep,
		stepId,
		`Import agent-skills package: ${sourceDir}`,
		"running",
	);

	const result = await importAgentSkillsPackage(sourceDir, {
		dryRun,
		force: options.force,
	});

	if (result.success) {
		report(
			onStep,
			stepId,
			`Import agent-skills package: ${sourceDir}`,
			"done",
			successDetail("import", dryRun, result),
		);
	} else {
		report(
			onStep,
			stepId,
			`Import agent-skills package: ${sourceDir}`,
			"error",
			result.error,
		);
	}
	return {
		status: result.success
			? PLUGIN_COMMAND_STATUS.SUCCESS
			: result.refused
				? PLUGIN_COMMAND_STATUS.REFUSED
				: PLUGIN_COMMAND_STATUS.FAILURE,
	};
}

/**
 * Generate a project-level skills.json from all installed plugins.
 * Makes the project discoverable by `npx skills add` and 40+ AI agents.
 */
export async function runPluginExportSkillsJson(
	projectDir: string,
	dryRun: boolean,
	onStep: StepCallback,
): Promise<PluginCommandResult> {
	const stepId = "plugin-export-skills-json";
	report(onStep, stepId, "Generate project skills.json", "running");

	const result = await generateProjectSkillsJson(projectDir, { dryRun });

	if (result.success) {
		const prefix = dryRun ? "dry-run: would generate" : "generated";
		report(
			onStep,
			stepId,
			"Generate project skills.json",
			"done",
			`${prefix} ${result.path} (${result.skillCount} skills from ${result.pluginCount} plugins)`,
		);
	} else {
		report(
			onStep,
			stepId,
			"Generate project skills.json",
			"error",
			result.error,
		);
	}
	return {
		status: result.success
			? PLUGIN_COMMAND_STATUS.SUCCESS
			: PLUGIN_COMMAND_STATUS.FAILURE,
	};
}

/**
 * Generate a global skills.json from all globally installed plugins.
 */
export async function runPluginExportGlobalSkillsJson(
	dryRun: boolean,
	onStep: StepCallback,
): Promise<PluginCommandResult> {
	const stepId = "plugin-export-global-skills-json";
	report(onStep, stepId, "Generate global skills.json", "running");

	const result = await generateGlobalSkillsJson({ dryRun });

	if (result.success) {
		const prefix = dryRun ? "dry-run: would generate" : "generated";
		report(
			onStep,
			stepId,
			"Generate global skills.json",
			"done",
			`${prefix} ${result.path} (${result.skillCount} skills from ${result.pluginCount} plugins)`,
		);
	} else {
		report(
			onStep,
			stepId,
			"Generate global skills.json",
			"error",
			result.error,
		);
	}
	return {
		status: result.success
			? PLUGIN_COMMAND_STATUS.SUCCESS
			: PLUGIN_COMMAND_STATUS.FAILURE,
	};
}

function requiredTargetLabel(action: string): string | undefined {
	if (action === PLUGIN_COMMAND_ACTION.ADD) return "source";
	if (
		action === PLUGIN_COMMAND_ACTION.REMOVE ||
		action === PLUGIN_COMMAND_ACTION.EXPORT
	)
		return "name";
	if (
		action === PLUGIN_COMMAND_ACTION.VALIDATE ||
		action === PLUGIN_COMMAND_ACTION.IMPORT
	)
		return "path";
	return undefined;
}

/** Execute one plugin request; the CLI dispatcher owns process exit status. */
export async function runPluginCommand(
	request: PluginCommandRequest,
	onStep: StepCallback,
): Promise<PluginCommandResult> {
	const {
		action = PLUGIN_COMMAND_ACTION.LIST,
		dryRun,
		projectDir,
		codex = false,
		force = false,
	} = request;
	const target = request.target ?? "";
	const requiredLabel = requiredTargetLabel(action);
	if (requiredLabel && !target) {
		report(
			onStep,
			"err",
			"Error",
			"error",
			`${requiredLabel} required: javi-forge plugin ${action} <${requiredLabel}>`,
		);
		return { status: PLUGIN_COMMAND_STATUS.FAILURE };
	}
	try {
		switch (action) {
			case PLUGIN_COMMAND_ACTION.ADD:
				return await runPluginAdd(target, dryRun, onStep, { force });
			case PLUGIN_COMMAND_ACTION.REMOVE:
				return await runPluginRemove(target, dryRun, onStep);
			case PLUGIN_COMMAND_ACTION.LIST:
				return await runPluginList(onStep);
			case PLUGIN_COMMAND_ACTION.SEARCH:
				return await runPluginSearch(request.target, onStep, {
					signal: request.signal,
				});
			case PLUGIN_COMMAND_ACTION.VALIDATE:
				return await runPluginValidate(target, onStep);
			case PLUGIN_COMMAND_ACTION.SYNC:
				return await runPluginSync(projectDir, dryRun, onStep);
			case PLUGIN_COMMAND_ACTION.EXPORT:
				return codex
					? await runPluginExportCodex(target, onStep)
					: await runPluginExport(target, onStep);
			case PLUGIN_COMMAND_ACTION.IMPORT:
				return await runPluginImport(target, dryRun, onStep, { force });
			case PLUGIN_COMMAND_ACTION.EXPORT_SKILLS:
				return target === "global"
					? await runPluginExportGlobalSkillsJson(dryRun, onStep)
					: await runPluginExportSkillsJson(
							request.target ?? projectDir,
							dryRun,
							onStep,
						);
			default:
				report(
					onStep,
					"err",
					"Error",
					"error",
					`unknown plugin action: ${action}`,
				);
				return { status: PLUGIN_COMMAND_STATUS.FAILURE };
		}
	} catch (error: unknown) {
		report(onStep, "fatal", "Fatal error", "error", String(error));
		return { status: PLUGIN_COMMAND_STATUS.FAILURE };
	}
}
