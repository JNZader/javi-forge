import { describe, expect, it, vi } from "vitest";
import type {
	OpenCodeHookDoctorReport,
	OpenCodeHookMutationResult,
} from "../lib/opencode-hook-manager.js";
import { runOpenCodeHookCommand } from "./opencode-hooks.js";

const report = (healthy = true): OpenCodeHookDoctorReport => ({
	healthy,
	plugin: { state: healthy ? "managed-current" : "absent" },
	policy: { state: healthy ? "managed-current" : "absent" },
	remediation: healthy ? [] : ["install the OpenCode plugin"],
	execution: {
		status: "inconclusive",
		blockers: [],
		unknownSources: ["OpenCode plugin execution is not locally verified"],
		residual: [
			"Installed file bytes do not prove OpenCode discovered, loaded, or invoked the plugin",
		],
	},
});

const mutation = (): OpenCodeHookMutationResult => ({
	ok: true,
	changed: ["/h/.config/opencode/plugins/javi-forge-skillguard-plugin.mjs"],
	backups: [],
	errors: [],
	warnings: [],
	report: report(),
});

describe("runOpenCodeHookCommand", () => {
	it("install renders success", async () => {
		const out: string[] = [];
		expect(
			await runOpenCodeHookCommand(
				"install",
				"/cwd",
				{},
				{
					install: vi.fn(async () => mutation()),
					log: (line) => out.push(line),
					logError: () => {},
				},
			),
		).toBe(0);
		expect(out.join("\n")).toContain("install opencode: ok");
	});

	it("repair forwards force", async () => {
		const repair = vi.fn(async () => mutation());
		await runOpenCodeHookCommand(
			"repair",
			"/cwd",
			{ force: true },
			{ repair, log: () => {}, logError: () => {} },
		);
		expect(repair).toHaveBeenCalledWith(undefined, { force: true });
	});

	it("doctor reports inconclusive execution and exits 2", async () => {
		const out: string[] = [];
		expect(
			await runOpenCodeHookCommand(
				"doctor",
				"/cwd",
				{},
				{
					doctor: vi.fn(async () => report(false)),
					log: (line) => out.push(line),
					logError: () => {},
				},
			),
		).toBe(2);
		expect(out.join("\n")).toContain("execution: inconclusive");
		expect(out.join("\n")).toContain(
			"unknown: OpenCode plugin execution is not locally verified",
		);
		expect(out.join("\n")).toContain(
			"residual: Installed file bytes do not prove OpenCode discovered, loaded, or invoked the plugin",
		);
	});

	it("doctor still exits 2 when installed files are healthy but runtime is unverified", async () => {
		const out: string[] = [];
		expect(
			await runOpenCodeHookCommand(
				"doctor",
				"/cwd",
				{},
				{
					doctor: vi.fn(async () => report(true)),
					log: (line) => out.push(line),
					logError: () => {},
				},
			),
		).toBe(2);
		expect(out.join("\n")).toContain("doctor opencode: healthy");
		expect(out.join("\n")).toContain("execution: inconclusive");
	});

	it("doctor prints blockers and exits 1 when execution is blocked", async () => {
		const out: string[] = [];
		const blocked = report(true);
		blocked.execution = {
			status: "blocked",
			blockers: ["OpenCode plugin module failed to load: boom"],
			unknownSources: [],
			residual: [],
		};
		expect(
			await runOpenCodeHookCommand(
				"doctor",
				"/cwd",
				{},
				{
					doctor: vi.fn(async () => blocked),
					log: (line) => out.push(line),
					logError: () => {},
				},
			),
		).toBe(1);
		expect(out.join("\n")).toContain("execution: blocked");
		expect(out.join("\n")).toContain(
			"blocker: OpenCode plugin module failed to load: boom",
		);
	});
});
