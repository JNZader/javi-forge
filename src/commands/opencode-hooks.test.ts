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
	runtimeEvidence: "not-implemented",
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

	it("doctor is informational and says runtime execution is unverified", async () => {
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
		).toBe(0);
		expect(out.join("\n")).toContain("runtime: not verified");
	});
});
