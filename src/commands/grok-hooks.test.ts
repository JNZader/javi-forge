import { describe, expect, it, vi } from "vitest";
import type {
	GrokHookDoctorReport,
	GrokHookMutationResult,
} from "../lib/grok-hook-manager.js";
import { runGrokHookCommand } from "./grok-hooks.js";

const report = (healthy = true): GrokHookDoctorReport => ({
	healthy,
	hook: { state: healthy ? "managed-current" : "absent" },
	policy: { state: healthy ? "managed-current" : "absent" },
	remediation: healthy ? [] : ["install the Grok hook"],
	runtimeEvidence: "not-implemented",
});

const mutation = (): GrokHookMutationResult => ({
	ok: true,
	changed: ["/h/.grok/hooks/javi-forge-skillguard-pre-tool-use.json"],
	backups: ["/h/.grok/hooks/javi-forge-skillguard-pre-tool-use.json.bak"],
	errors: [],
	warnings: [],
	report: report(),
});

describe("runGrokHookCommand", () => {
	it("install renders success", async () => {
		const out: string[] = [];
		expect(
			await runGrokHookCommand(
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
		expect(out.join("\n")).toContain("install grok: ok");
		expect(out.join("\n")).toContain(
			"backup: /h/.grok/hooks/javi-forge-skillguard-pre-tool-use.json.bak",
		);
	});

	it("repair forwards force", async () => {
		const repair = vi.fn(async () => mutation());
		await runGrokHookCommand(
			"repair",
			"/cwd",
			{ force: true },
			{ repair, log: () => {}, logError: () => {} },
		);
		expect(repair).toHaveBeenCalledWith(undefined, { force: true });
	});

	it("renders backup paths on refusal", async () => {
		const err: string[] = [];
		expect(
			await runGrokHookCommand(
				"install",
				"/cwd",
				{},
				{
					install: vi.fn(async () => ({
						...mutation(),
						ok: false,
						errors: ["manual recovery required"],
					})),
					log: () => {},
					logError: (line) => err.push(line),
				},
			),
		).toBe(1);
		expect(err.join("\n")).toContain(
			"backup: /h/.grok/hooks/javi-forge-skillguard-pre-tool-use.json.bak",
		);
	});

	it("doctor is informational and says runtime execution is unverified", async () => {
		const out: string[] = [];
		expect(
			await runGrokHookCommand(
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
