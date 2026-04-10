/**
 * Atlassian MCP pre-config — generates MCP server configuration
 * for Jira and Confluence integration in scaffolded projects.
 *
 * Produces a config snippet that can be merged into .claude/settings.json
 * or any AI agent's MCP configuration.
 */

import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../../templates");

export interface AtlassianConfig {
	confluenceUrl: string;
	confluenceUsername: string;
	jiraUrl: string;
	jiraUsername: string;
}

export interface McpSnippet {
	mcpServers: Record<
		string,
		{
			command: string;
			args: string[];
			env: Record<string, string>;
		}
	>;
}

/**
 * Generate Atlassian MCP config snippet with user-provided values.
 * Token placeholders remain as env vars for security.
 */
export function generateAtlassianMcpConfig(
	config: AtlassianConfig,
): McpSnippet {
	return {
		mcpServers: {
			atlassian: {
				command: "uvx",
				args: ["mcp-atlassian"],
				env: {
					CONFLUENCE_URL: config.confluenceUrl,
					CONFLUENCE_USERNAME: config.confluenceUsername,
					CONFLUENCE_API_TOKEN: "${CONFLUENCE_API_TOKEN}",
					JIRA_URL: config.jiraUrl,
					JIRA_USERNAME: config.jiraUsername,
					JIRA_API_TOKEN: "${JIRA_API_TOKEN}",
				},
			},
		},
	};
}

/**
 * Generate a template snippet with placeholders (no user input needed).
 */
export function generateTemplateMcpConfig(): McpSnippet {
	return {
		mcpServers: {
			atlassian: {
				command: "uvx",
				args: ["mcp-atlassian"],
				env: {
					CONFLUENCE_URL: "__CONFLUENCE_URL__",
					CONFLUENCE_USERNAME: "__CONFLUENCE_USERNAME__",
					CONFLUENCE_API_TOKEN: "__CONFLUENCE_API_TOKEN__",
					JIRA_URL: "__JIRA_URL__",
					JIRA_USERNAME: "__JIRA_USERNAME__",
					JIRA_API_TOKEN: "__JIRA_API_TOKEN__",
				},
			},
		},
	};
}

/**
 * Write the Atlassian MCP snippet to a project directory.
 */
export async function writeAtlassianMcpSnippet(
	projectDir: string,
	config?: AtlassianConfig,
): Promise<string> {
	const snippet = config
		? generateAtlassianMcpConfig(config)
		: generateTemplateMcpConfig();

	const destDir = path.join(projectDir, ".atlassian");
	await fs.ensureDir(destDir);
	const destFile = path.join(destDir, "mcp-config-snippet.json");
	await fs.writeJson(destFile, snippet, { spaces: 2 });
	return destFile;
}

/**
 * Merge Atlassian MCP config into an existing settings.json or MCP config file.
 */
export async function mergeIntoSettings(
	settingsPath: string,
	config: AtlassianConfig,
): Promise<void> {
	const snippet = generateAtlassianMcpConfig(config);

	let existing: Record<string, unknown> = {};
	if (await fs.pathExists(settingsPath)) {
		existing = await fs.readJson(settingsPath);
	}

	const existingServers =
		(existing.mcpServers as Record<string, unknown>) ?? {};
	existing.mcpServers = {
		...existingServers,
		...snippet.mcpServers,
	};

	await fs.writeJson(settingsPath, existing, { spaces: 2 });
}

/**
 * Copy the template snippet from templates/common/atlassian/.
 */
export async function copyTemplateSnippet(
	projectDir: string,
): Promise<string | null> {
	const srcFile = path.join(
		TEMPLATES_DIR,
		"common",
		"atlassian",
		"mcp-atlassian-snippet.json",
	);
	if (!(await fs.pathExists(srcFile))) return null;

	const destDir = path.join(projectDir, ".atlassian");
	await fs.ensureDir(destDir);
	const destFile = path.join(destDir, "mcp-config-snippet.json");
	await fs.copy(srcFile, destFile, { overwrite: true });
	return destFile;
}
