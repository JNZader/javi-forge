import { describe, expect, it } from "vitest";
import { AGENT_ADAPTERS, isAgentId } from "./agent-adapter.js";
import { validateSettingsShape } from "./claude-hook-settings.js";

describe("agent adapter registry", () => {
	it("exposes claude + codex and rejects unknown ids", () => {
		expect(Object.keys(AGENT_ADAPTERS).sort()).toEqual(["claude", "codex"]);
		expect(isAgentId("claude")).toBe(true);
		expect(isAgentId("codex")).toBe(true);
		expect(isAgentId("gemini")).toBe(false);
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
