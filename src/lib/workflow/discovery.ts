import path from "node:path";
import fs from "fs-extra";
import { TEMPLATES_DIR } from "../../constants.js";
import type {
	WorkflowDiscoveryEntry,
	WorkflowFormat,
} from "../../types/index.js";

const WORKFLOW_EXTENSIONS: Record<string, WorkflowFormat> = {
	".dot": "dot",
	".mermaid": "mermaid",
};

/** Workflow templates directory inside javi-forge package */
export const WORKFLOW_TEMPLATES_DIR = path.join(TEMPLATES_DIR, "workflows");

/**
 * Discover workflow files in a project's `.javi-forge/workflows/` directory.
 */
export async function discoverWorkflows(
	projectDir: string,
): Promise<WorkflowDiscoveryEntry[]> {
	const workflowDir = path.join(projectDir, ".javi-forge", "workflows");

	if (!(await fs.pathExists(workflowDir))) {
		return [];
	}

	const entries = await fs.readdir(workflowDir);
	const workflows: WorkflowDiscoveryEntry[] = [];

	for (const entry of entries) {
		const ext = path.extname(entry);
		const format = WORKFLOW_EXTENSIONS[ext];
		if (format) {
			workflows.push({
				name: path.basename(entry, ext),
				path: path.join(workflowDir, entry),
				format,
			});
		}
	}

	return workflows;
}

/**
 * List available built-in workflow templates.
 */
export async function listBuiltinTemplates(): Promise<
	WorkflowDiscoveryEntry[]
> {
	if (!(await fs.pathExists(WORKFLOW_TEMPLATES_DIR))) {
		return [];
	}

	const entries = await fs.readdir(WORKFLOW_TEMPLATES_DIR);
	const templates: WorkflowDiscoveryEntry[] = [];

	for (const entry of entries) {
		const ext = path.extname(entry);
		const format = WORKFLOW_EXTENSIONS[ext];
		if (format) {
			templates.push({
				name: path.basename(entry, ext),
				path: path.join(WORKFLOW_TEMPLATES_DIR, entry),
				format,
			});
		}
	}

	return templates;
}

/**
 * Load a built-in template by name. Returns the file content or null if not found.
 *
 * The name argument is restricted to a strict kebab-case alphabet — anything
 * with path separators, dots, or characters outside [a-z0-9-] is rejected
 * outright. Without this check, an attacker (or a user with a typo) could
 * pass --template "../../../etc/passwd" and walk out of WORKFLOW_TEMPLATES_DIR.
 * The file would still need to end in .dot or .mermaid, but file-existence
 * probes and arbitrary DOT-parse on attacker-controlled paths is enough to
 * reject up front.
 */
export async function loadBuiltinTemplate(
	name: string,
): Promise<{ content: string; format: WorkflowFormat } | null> {
	if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name)) {
		return null;
	}
	for (const [ext, format] of Object.entries(WORKFLOW_EXTENSIONS)) {
		const templatePath = path.join(WORKFLOW_TEMPLATES_DIR, `${name}${ext}`);
		// Defense in depth: even with the name regex above, ensure the
		// resolved real path stays inside WORKFLOW_TEMPLATES_DIR.
		const resolved = path.resolve(templatePath);
		if (!resolved.startsWith(`${WORKFLOW_TEMPLATES_DIR}${path.sep}`)) {
			continue;
		}
		if (await fs.pathExists(templatePath)) {
			const content = await fs.readFile(templatePath, "utf-8");
			return { content, format };
		}
	}
	return null;
}
