import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";

interface Runtime {
	AGENT_CONFIGS: { grok: unknown };
	evaluateEvent(
		input: unknown,
		config: unknown,
	): {
		allowed: boolean;
		ruleId?: string;
	};
	mapGrokToolName(toolName: string, platform?: NodeJS.Platform): string;
}

const ASSET = path.join(
	CLAUDE_HOOK_ASSETS_DIR,
	"javi-forge-skillguard-pre-tool-use.mjs",
);
const ROOT = path.resolve(CLAUDE_HOOK_ASSETS_DIR, "../..");

async function runtime(): Promise<Runtime> {
	return (await import(
		`${pathToFileURL(ASSET).href}?grok=${Date.now()}-${Math.random()}`
	)) as Runtime;
}

describe("Grok Build PreToolUse envelope", () => {
	it("normalizes Grok camelCase shell events and denies managed project writes", async () => {
		const guard = await runtime();
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "PreToolUse",
					toolName: "run_terminal_command",
					toolInput: { command: "printf x > .grok/config.toml" },
					cwd: ROOT,
				},
				guard.AGENT_CONFIGS.grok,
			),
		).toEqual({ allowed: false, ruleId: "shell.managed-config-tamper" });
	});

	it("fails closed when Grok truncates tool input before the hook sees it", async () => {
		const guard = await runtime();
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "PreToolUse",
					toolName: "run_terminal_command",
					toolInput: { command: "printf safe" },
					toolInputTruncated: true,
					cwd: ROOT,
				},
				guard.AGENT_CONFIGS.grok,
			),
		).toEqual({ allowed: false, ruleId: "tool-input-truncated" });
	});

	it("expands braced HOME literals when protecting Grok global hook files", async () => {
		const guard = await runtime();
		const homeLiteral = "$" + "{HOME}";
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "PreToolUse",
					toolName: "run_terminal_command",
					toolInput: {
						command: `printf '{}' > ${homeLiteral}/.grok/hooks/javi-forge-skillguard-pre-tool-use.json`,
					},
					cwd: ROOT,
				},
				guard.AGENT_CONFIGS.grok,
			),
		).toEqual({ allowed: false, ruleId: "shell.managed-config-tamper" });
	});

	it("maps Grok terminal commands to the platform shell policy", async () => {
		const guard = await runtime();
		expect(guard.mapGrokToolName("run_terminal_command", "linux")).toBe("Bash");
		expect(guard.mapGrokToolName("run_terminal_command", "win32")).toBe(
			"PowerShell",
		);
		expect(guard.mapGrokToolName("read_file", "win32")).toBe("Read");
	});

	it("allows Grok read_file for a managed configuration path", async () => {
		const guard = await runtime();
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "PreToolUse",
					toolName: "read_file",
					toolInput: { filePath: path.join(ROOT, ".grok", "config.toml") },
					cwd: ROOT,
				},
				guard.AGENT_CONFIGS.grok,
			),
		).toEqual({ allowed: true });
	});

	it("normalizes Grok relative `path` tool inputs through the event cwd", async () => {
		const guard = await runtime();
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "PreToolUse",
					toolName: "search_replace",
					toolInput: { path: ".grok/config.toml" },
					cwd: ROOT,
				},
				guard.AGENT_CONFIGS.grok,
			),
		).toEqual({ allowed: false, ruleId: "path.managed-config" });
	});

	it("protects the current user's installed global hook files", async () => {
		const guard = await runtime();
		const globalHook = path.join(
			os.homedir(),
			".grok",
			"hooks",
			"javi-forge-skillguard-pre-tool-use.json",
		);
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "PreToolUse",
					toolName: "search_replace",
					toolInput: { filePath: globalHook },
					cwd: ROOT,
				},
				guard.AGENT_CONFIGS.grok,
			),
		).toEqual({ allowed: false, ruleId: "path.managed-config" });
	});

	it("protects installed global hook files under GROK_HOME", async () => {
		const prior = process.env.GROK_HOME;
		const customHome = path.join(
			os.tmpdir(),
			`javi-forge-grok-home-${process.pid}`,
		);
		process.env.GROK_HOME = customHome;
		try {
			const guard = await runtime();
			expect(
				guard.evaluateEvent(
					{
						hook_event_name: "PreToolUse",
						toolName: "search_replace",
						toolInput: {
							path: path.join(
								customHome,
								"hooks",
								"javi-forge-skillguard-pre-tool-use.json",
							),
						},
						cwd: ROOT,
					},
					guard.AGENT_CONFIGS.grok,
				),
			).toEqual({ allowed: false, ruleId: "path.managed-config" });
		} finally {
			if (prior === undefined) delete process.env.GROK_HOME;
			else process.env.GROK_HOME = prior;
		}
	});

	it("emits stderr and exit 2 for a denied Grok envelope", () => {
		const inputPath = path.join(
			os.tmpdir(),
			`javi-forge-grok-${process.pid}.json`,
		);
		fs.writeFileSync(
			inputPath,
			JSON.stringify({
				hook_event_name: "PreToolUse",
				toolName: "run_terminal_command",
				toolInput: { command: "printf x > .grok/config.toml" },
				cwd: ROOT,
			}),
		);
		const fd = fs.openSync(inputPath, "r");
		const result = spawnSync(process.execPath, [ASSET, "--agent=grok"], {
			stdio: [fd, "pipe", "pipe"],
			encoding: "utf8",
		});
		fs.closeSync(fd);
		fs.rmSync(inputPath, { force: true });
		expect(result.status).toBe(2);
		expect(result.stderr).toContain(
			"denied Bash [shell.managed-config-tamper]",
		);
	});
});
