import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";

interface Runtime {
	AGENT_CONFIGS: { cursor: unknown };
	evaluateEvent(
		input: unknown,
		config: unknown,
	): {
		allowed: boolean;
		ruleId?: string;
	};
	mapCursorToolName(toolName: string, platform?: NodeJS.Platform): string;
}

const ASSET = path.join(
	CLAUDE_HOOK_ASSETS_DIR,
	"javi-forge-skillguard-pre-tool-use.mjs",
);
const ROOT = path.resolve(CLAUDE_HOOK_ASSETS_DIR, "../..");

async function runtime(): Promise<Runtime> {
	return (await import(
		`${pathToFileURL(ASSET).href}?cursor=${Date.now()}-${Math.random()}`
	)) as Runtime;
}

function runCursorHook(input: unknown) {
	const inputPath = path.join(
		os.tmpdir(),
		`javi-forge-cursor-${process.pid}-${Math.random()}.json`,
	);
	fs.writeFileSync(inputPath, JSON.stringify(input));
	const fd = fs.openSync(inputPath, "r");
	try {
		return spawnSync(process.execPath, [ASSET, "--agent=cursor"], {
			stdio: [fd, "pipe", "pipe"],
			encoding: "utf8",
		});
	} finally {
		fs.closeSync(fd);
		fs.rmSync(inputPath, { force: true });
	}
}

describe("Cursor preToolUse envelope", () => {
	it("normalizes Cursor shell events and denies managed project writes", async () => {
		const guard = await runtime();
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "preToolUse",
					tool_name: "Shell",
					tool_input: { command: "printf x > .cursor/hooks.json" },
					cwd: ROOT,
				},
				guard.AGENT_CONFIGS.cursor,
			),
		).toEqual({ allowed: false, ruleId: "shell.managed-config-tamper" });
	});

	it("maps Cursor tool names to the shared policy tools", async () => {
		const guard = await runtime();
		expect(guard.mapCursorToolName("Shell", "linux")).toBe("Bash");
		expect(guard.mapCursorToolName("Shell", "win32")).toBe("PowerShell");
		expect(guard.mapCursorToolName("Delete", "linux")).toBe("Edit");
		expect(guard.mapCursorToolName("Read", "linux")).toBe("Read");
	});

	it("uses tool working_directory as cwd when the event cwd is missing", async () => {
		const guard = await runtime();
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "preToolUse",
					tool_name: "Shell",
					tool_input: {
						command: "printf x > .cursor/hooks.json",
						working_directory: ROOT,
					},
				},
				guard.AGENT_CONFIGS.cursor,
			),
		).toEqual({ allowed: false, ruleId: "shell.managed-config-tamper" });
	});

	it("normalizes relative path tool inputs through the event cwd", async () => {
		const guard = await runtime();
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "preToolUse",
					tool_name: "Delete",
					tool_input: { path: ".cursor/hooks.json" },
					cwd: ROOT,
				},
				guard.AGENT_CONFIGS.cursor,
			),
		).toEqual({ allowed: false, ruleId: "path.managed-config" });
	});

	it("protects the current user's installed global Cursor hook files", async () => {
		const guard = await runtime();
		const globalHook = path.join(os.homedir(), ".cursor", "hooks.json");
		expect(
			guard.evaluateEvent(
				{
					hook_event_name: "preToolUse",
					tool_name: "Write",
					tool_input: { file_path: globalHook },
					cwd: ROOT,
				},
				guard.AGENT_CONFIGS.cursor,
			),
		).toEqual({ allowed: false, ruleId: "path.managed-config" });
	});

	it("emits Cursor JSON allow on stdout for allowed events", () => {
		const result = runCursorHook({
			hook_event_name: "preToolUse",
			tool_name: "Read",
			tool_input: { file_path: path.join(ROOT, "README.md") },
			cwd: ROOT,
		});
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({ permission: "allow" });
	});

	it("emits Cursor JSON deny and exit 2 for denied events", () => {
		const result = runCursorHook({
			hook_event_name: "preToolUse",
			tool_name: "Shell",
			tool_input: { command: "printf x > .cursor/hooks.json" },
			cwd: ROOT,
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toBe("");
		const body = JSON.parse(result.stdout) as {
			permission: string;
			user_message: string;
			agent_message: string;
		};
		expect(body.permission).toBe("deny");
		expect(body.user_message).toContain("shell.managed-config-tamper");
		expect(body.agent_message).toBe(body.user_message);
	});

	it("fails closed with Cursor JSON denial on malformed input when --agent=cursor is present", () => {
		const inputPath = path.join(
			os.tmpdir(),
			`javi-forge-cursor-bad-${process.pid}.json`,
		);
		fs.writeFileSync(inputPath, "{");
		const fd = fs.openSync(inputPath, "r");
		try {
			const result = spawnSync(process.execPath, [ASSET, "--agent=cursor"], {
				stdio: [fd, "pipe", "pipe"],
				encoding: "utf8",
			});
			expect(result.status).toBe(2);
			expect(result.stderr).toBe("");
			expect(JSON.parse(result.stdout)).toMatchObject({ permission: "deny" });
		} finally {
			fs.closeSync(fd);
			fs.rmSync(inputPath, { force: true });
		}
	});
});
