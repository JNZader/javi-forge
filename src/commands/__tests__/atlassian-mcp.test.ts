import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	copyTemplateSnippet,
	generateAtlassianMcpConfig,
	generateTemplateMcpConfig,
	mergeIntoSettings,
	writeAtlassianMcpSnippet,
} from "../atlassian-mcp.js";
import type { AtlassianConfig } from "../atlassian-mcp.js";

let tmpDir: string;

const testConfig: AtlassianConfig = {
	confluenceUrl: "https://mycompany.atlassian.net/wiki",
	confluenceUsername: "dev@mycompany.com",
	jiraUrl: "https://mycompany.atlassian.net",
	jiraUsername: "dev@mycompany.com",
};

beforeEach(async () => {
	tmpDir = path.join(os.tmpdir(), `atlassian-mcp-test-${Date.now()}`);
	await fs.ensureDir(tmpDir);
});

afterEach(async () => {
	await fs.remove(tmpDir);
});

describe("generateAtlassianMcpConfig", () => {
	it("generates valid MCP config with user values", () => {
		const config = generateAtlassianMcpConfig(testConfig);
		expect(config.mcpServers.atlassian).toBeDefined();
		expect(config.mcpServers.atlassian.command).toBe("uvx");
		expect(config.mcpServers.atlassian.args).toEqual(["mcp-atlassian"]);
	});

	it("uses provided URLs", () => {
		const config = generateAtlassianMcpConfig(testConfig);
		const env = config.mcpServers.atlassian.env;
		expect(env.CONFLUENCE_URL).toBe(
			"https://mycompany.atlassian.net/wiki",
		);
		expect(env.JIRA_URL).toBe("https://mycompany.atlassian.net");
	});

	it("uses provided usernames", () => {
		const config = generateAtlassianMcpConfig(testConfig);
		const env = config.mcpServers.atlassian.env;
		expect(env.CONFLUENCE_USERNAME).toBe("dev@mycompany.com");
		expect(env.JIRA_USERNAME).toBe("dev@mycompany.com");
	});

	it("keeps API tokens as env var references", () => {
		const config = generateAtlassianMcpConfig(testConfig);
		const env = config.mcpServers.atlassian.env;
		expect(env.CONFLUENCE_API_TOKEN).toBe("${CONFLUENCE_API_TOKEN}");
		expect(env.JIRA_API_TOKEN).toBe("${JIRA_API_TOKEN}");
	});
});

describe("generateTemplateMcpConfig", () => {
	it("generates config with placeholder values", () => {
		const config = generateTemplateMcpConfig();
		const env = config.mcpServers.atlassian.env;
		expect(env.CONFLUENCE_URL).toBe("__CONFLUENCE_URL__");
		expect(env.JIRA_URL).toBe("__JIRA_URL__");
		expect(env.CONFLUENCE_USERNAME).toBe("__CONFLUENCE_USERNAME__");
		expect(env.CONFLUENCE_API_TOKEN).toBe("__CONFLUENCE_API_TOKEN__");
	});
});

describe("writeAtlassianMcpSnippet", () => {
	it("writes snippet with user config", async () => {
		const dest = await writeAtlassianMcpSnippet(tmpDir, testConfig);
		expect(dest).toContain(".atlassian");
		expect(dest).toContain("mcp-config-snippet.json");
		expect(await fs.pathExists(dest)).toBe(true);

		const content = await fs.readJson(dest);
		expect(content.mcpServers.atlassian.env.CONFLUENCE_URL).toBe(
			testConfig.confluenceUrl,
		);
	});

	it("writes template snippet when no config provided", async () => {
		const dest = await writeAtlassianMcpSnippet(tmpDir);
		const content = await fs.readJson(dest);
		expect(content.mcpServers.atlassian.env.CONFLUENCE_URL).toBe(
			"__CONFLUENCE_URL__",
		);
	});

	it("creates .atlassian directory", async () => {
		await writeAtlassianMcpSnippet(tmpDir);
		expect(await fs.pathExists(path.join(tmpDir, ".atlassian"))).toBe(true);
	});
});

describe("mergeIntoSettings", () => {
	it("creates settings file if not exists", async () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		await mergeIntoSettings(settingsPath, testConfig);

		expect(await fs.pathExists(settingsPath)).toBe(true);
		const settings = await fs.readJson(settingsPath);
		expect(settings.mcpServers.atlassian).toBeDefined();
	});

	it("merges with existing mcpServers", async () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		await fs.writeJson(settingsPath, {
			mcpServers: {
				engram: { command: "engram", args: [] },
			},
		});

		await mergeIntoSettings(settingsPath, testConfig);
		const settings = await fs.readJson(settingsPath);
		expect(settings.mcpServers.engram).toBeDefined();
		expect(settings.mcpServers.atlassian).toBeDefined();
	});

	it("preserves existing non-MCP settings", async () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		await fs.writeJson(settingsPath, {
			theme: "dark",
			mcpServers: {},
		});

		await mergeIntoSettings(settingsPath, testConfig);
		const settings = await fs.readJson(settingsPath);
		expect(settings.theme).toBe("dark");
		expect(settings.mcpServers.atlassian).toBeDefined();
	});

	it("overwrites existing atlassian config", async () => {
		const settingsPath = path.join(tmpDir, "settings.json");
		await fs.writeJson(settingsPath, {
			mcpServers: {
				atlassian: { command: "old", args: [] },
			},
		});

		await mergeIntoSettings(settingsPath, testConfig);
		const settings = await fs.readJson(settingsPath);
		expect(settings.mcpServers.atlassian.command).toBe("uvx");
	});
});

describe("copyTemplateSnippet", () => {
	it("copies template to project dir", async () => {
		const dest = await copyTemplateSnippet(tmpDir);
		if (dest) {
			expect(await fs.pathExists(dest)).toBe(true);
			const content = await fs.readJson(dest);
			expect(content.mcpServers.atlassian).toBeDefined();
		}
	});
});
