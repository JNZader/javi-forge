import { describe, expect, it } from "vitest";
import { AGENT_ADAPTERS, isAgentId } from "./agent-adapter.js";
import { validateSettingsShape } from "./claude-hook-settings.js";

describe("agent adapter registry", () => {
	it("exposes claude, codex, opencode, grok, and cursor and rejects unknown ids", () => {
		expect(Object.keys(AGENT_ADAPTERS).sort()).toEqual([
			"claude",
			"codex",
			"cursor",
			"grok",
			"opencode",
		]);
		expect(isAgentId("claude")).toBe(true);
		expect(isAgentId("codex")).toBe(true);
		expect(isAgentId("opencode")).toBe(true);
		expect(isAgentId("grok")).toBe(true);
		expect(isAgentId("cursor")).toBe(true);
		expect(isAgentId("gemini")).toBe(false);
	});

	it("cursor resolves its global hooks.json and adjacent policy under the supplied home root", () => {
		const cursor = AGENT_ADAPTERS.cursor;
		const paths = cursor.configPaths("/home/u");
		expect(paths.hooksFile).toBe("/home/u/.cursor/hooks.json");
		expect(paths.settingsFile).toBe(
			"/home/u/.cursor/hooks/javi-forge-skillguard-pre-tool-use.mjs",
		);
		expect(cursor.projectDir.envVar).toBe("CURSOR_PROJECT_DIR");
		expect(cursor.managedSet).toContain(".cursor/hooks.json");
		expect(cursor.managedSet).toContain(".cursor/rules/");
		expect(cursor.settingsSchema).toBeNull();
		expect(cursor.emitDeny).toBe("json-stdout");
		expect(cursor.trust).toBeNull();
	});

	it("grok resolves the managed global hook pair beneath the supplied home root", () => {
		const grok = AGENT_ADAPTERS.grok;
		const paths = grok.configPaths("/home/u");
		expect(paths.hooksFile).toBe(
			"/home/u/.grok/hooks/javi-forge-skillguard-pre-tool-use.json",
		);
		expect(paths.settingsFile).toBe(
			"/home/u/.grok/hooks/javi-forge-skillguard-pre-tool-use.mjs",
		);
		expect(grok.managedSet).toContain(".grok/config.toml");
		expect(grok.emitDeny).toBe("exit2+stderr");
	});

	it("opencode resolves its global plugin pair under the supplied home root", () => {
		const opencode = AGENT_ADAPTERS.opencode;
		const paths = opencode.configPaths("/home/u");
		expect(paths.hooksFile).toBe(
			"/home/u/.config/opencode/plugins/javi-forge-skillguard-plugin.mjs",
		);
		expect(paths.settingsFile).toBe(
			"/home/u/.config/opencode/plugins/javi-forge-skillguard-pre-tool-use.mjs",
		);
		expect(opencode.managedSet).toContain(
			".config/opencode/plugins/javi-forge-skillguard-plugin.mjs",
		);
		expect(opencode.settingsSchema).toBeNull();
		expect(opencode.emitDeny).toBe("throw-error");
		expect(opencode.trust).toBeNull();
	});

	it("both adapters reuse the SHARED settings-schema validator", () => {
		expect(AGENT_ADAPTERS.claude.settingsSchema).toBe(validateSettingsShape);
		expect(AGENT_ADAPTERS.codex.settingsSchema).toBe(validateSettingsShape);
	});

	it("codex resolves ~/.codex config paths and has a trust model; claude has none", () => {
		const codex = AGENT_ADAPTERS.codex;
		const paths = codex.configPaths("/home/u");
		expect(paths.hooksFile).toBe("/home/u/.codex/hooks.json");
		expect(paths.settingsFile).toBe("/home/u/.codex/config.toml");
		expect(codex.projectDir.envVar).toBeNull();
		expect(codex.managedSet).toContain(".codex/hooks.json");

		const trusted = `[hooks.state."${paths.hooksFile}:pre_tool_use:0:0"]\n`;
		expect(codex.trust?.detect(trusted, paths.hooksFile)).toBe("trusted");
		expect(codex.trust?.detect("", paths.hooksFile)).toBe("untrusted");

		expect(AGENT_ADAPTERS.claude.trust).toBeNull();
		expect(AGENT_ADAPTERS.claude.projectDir.envVar).toBe("CLAUDE_PROJECT_DIR");
	});
});
