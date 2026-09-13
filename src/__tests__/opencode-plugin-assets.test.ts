import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { FORGE_ROOT } from "../constants.js";

interface Decision {
	allowed: boolean;
	ruleId?: string;
}

interface OpenCodeSkillGuardPlugin {
	default: {
		id: string;
		server(ctx?: unknown): Promise<Record<string, unknown>>;
		setup(ctx: unknown): Promise<void>;
	};
	evaluateOpenCodeToolEvent(
		input: unknown,
		output?: unknown,
		fallbackCwd?: string,
	): Decision;
	guardOpenCodeTool(
		input: unknown,
		output?: unknown,
		fallbackCwd?: string,
	): Promise<void>;
}

type OpenCodeBeforeHook = (event: {
	tool: string;
	input: Record<string, unknown>;
}) => Promise<void>;

const ROOT = FORGE_ROOT;
const PLUGIN = path.join(
	FORGE_ROOT,
	"assets",
	"opencode-plugins",
	"javi-forge-skillguard-plugin.mjs",
);
const POLICY = path.join(
	FORGE_ROOT,
	"assets",
	"claude-hooks",
	"javi-forge-skillguard-pre-tool-use.mjs",
);

async function loadPlugin(): Promise<OpenCodeSkillGuardPlugin> {
	return (await import(pathToFileURL(PLUGIN).href)) as OpenCodeSkillGuardPlugin;
}

describe("OpenCode SkillGuard plugin asset", () => {
	it("reuses the packaged policy engine for shell writes to OpenCode config", async () => {
		const plugin = await loadPlugin();
		expect(
			plugin.evaluateOpenCodeToolEvent(
				{
					tool: "bash",
					input: {
						command:
							"printf x > .opencode/plugins/javi-forge-skillguard-plugin.mjs",
					},
					cwd: ROOT,
				},
				undefined,
				ROOT,
			),
		).toEqual({
			allowed: false,
			ruleId: "shell.managed-config-tamper",
		});
	});

	it("maps V2 tool events and throws a deny error before protected edits run", async () => {
		const plugin = await loadPlugin();
		await expect(
			plugin.guardOpenCodeTool(
				{ tool: "edit", input: { filePath: path.join(ROOT, "AGENTS.md") } },
				undefined,
				ROOT,
			),
		).rejects.toThrow("javi-forge OpenCode denied edit [path.managed-config]");
	});

	it("loads from an installed OpenCode plugin layout with the policy beside it", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-opencode-"));
		try {
			const installedPlugin = path.join(
				dir,
				"javi-forge-skillguard-plugin.mjs",
			);
			fs.copyFileSync(PLUGIN, installedPlugin);
			fs.copyFileSync(
				POLICY,
				path.join(dir, "javi-forge-skillguard-pre-tool-use.mjs"),
			);
			const plugin = (await import(
				pathToFileURL(installedPlugin).href
			)) as OpenCodeSkillGuardPlugin;
			expect(
				plugin.evaluateOpenCodeToolEvent(
					{
						tool: "bash",
						input: { command: "printf x > opencode.json" },
						cwd: ROOT,
					},
					undefined,
					ROOT,
				),
			).toEqual({
				allowed: false,
				ruleId: "shell.managed-config-tamper",
			});
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("maps V1 server hook events without blocking unrelated tools", async () => {
		const plugin = await loadPlugin();
		const hooks = await plugin.default.server({ directory: ROOT });
		const before = hooks["tool.execute.before"];
		expect(typeof before).toBe("function");

		await expect(
			(before as (input: unknown, output: unknown) => Promise<void>)(
				{ tool: "read" },
				{ args: { filePath: path.join(ROOT, "AGENTS.md") } },
			),
		).resolves.toBeUndefined();
		await expect(
			(before as (input: unknown, output: unknown) => Promise<void>)(
				{ tool: "websearch" },
				{ args: { query: "javi-forge" } },
			),
		).resolves.toBeUndefined();
	});

	it("registers the V2 execute.before hook and preserves fail-closed behavior", async () => {
		const plugin = await loadPlugin();
		let callback: OpenCodeBeforeHook | undefined;
		await plugin.default.setup({
			location: { project: { canonical: ROOT } },
			tool: {
				hook: async (name: string, fn: typeof callback) => {
					expect(name).toBe("execute.before");
					callback = fn;
				},
			},
		});
		expect(callback).toBeDefined();
		await expect(
			callback?.({
				tool: "write",
				input: { filePath: path.join(ROOT, ".opencode", "opencode.json") },
			}),
		).rejects.toThrow("javi-forge OpenCode denied write [path.managed-config]");
	});
});
