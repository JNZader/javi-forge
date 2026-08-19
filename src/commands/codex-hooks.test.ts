import { describe, expect, it, vi } from "vitest";
import type {
	CodexHookDoctorReport,
	CodexHookMutationResult,
} from "../lib/codex-hook-manager.js";
import { runCodexHookCommand } from "./codex-hooks.js";

const baseReport = (
	over: Partial<CodexHookDoctorReport> = {},
): CodexHookDoctorReport => ({
	healthy: false,
	hooksJson: { state: "managed-current" },
	config: { featuresHooks: "true", readable: true },
	asset: { state: "managed-current" },
	node: { available: true, version: "v22.11.0", satisfiesMinimum: true },
	nodeOnPath: { status: "resolved", version: "v22.11.0", major: 22 },
	execution: {
		status: "runnable",
		blockers: [],
		unknownSources: [],
		residual: [],
	},
	trust: { state: "trusted", grantCommand: "run codex …" },
	remediation: [],
	...over,
});

const mutation = (
	over: Partial<CodexHookMutationResult> = {},
): CodexHookMutationResult => ({
	ok: true,
	changed: ["/h/.codex/hooks.json", "/h/.codex/config.toml"],
	backups: [],
	errors: [],
	warnings: ["the codex hook is installed but NOT yet trusted — run codex …"],
	report: baseReport({
		trust: { state: "untrusted", grantCommand: "run codex …" },
	}),
	...over,
});

describe("runCodexHookCommand", () => {
	it("install: renders ok + untrusted trust step and exits 0", async () => {
		const out: string[] = [];
		const install = vi.fn(async () => mutation());
		const code = await runCodexHookCommand(
			"install",
			process.cwd(),
			{},
			{ install, log: (m) => out.push(m), logError: () => {} },
		);
		expect(code).toBe(0);
		expect(out.join("\n")).toContain("install codex: ok");
		expect(out.join("\n")).toMatch(/trust: untrusted/);
	});

	it("doctor: untrusted → blocked → exit 1", async () => {
		const doctor = vi.fn(async () =>
			baseReport({
				execution: {
					status: "blocked",
					blockers: ["trust:untrusted (hook is silently skipped)"],
					unknownSources: [],
					residual: [],
				},
				trust: { state: "untrusted", grantCommand: "run codex …" },
			}),
		);
		const out: string[] = [];
		const code = await runCodexHookCommand(
			"doctor",
			process.cwd(),
			{},
			{ doctor, log: (m) => out.push(m), logError: () => {} },
		);
		expect(code).toBe(1);
		expect(out.join("\n")).toMatch(/execution: blocked/);
	});

	it("repair: forwards force:true", async () => {
		const repair = vi.fn(async () => mutation());
		await runCodexHookCommand(
			"repair",
			process.cwd(),
			{ force: true },
			{ repair, log: () => {}, logError: () => {} },
		);
		expect(repair).toHaveBeenCalledWith(undefined, { force: true });
	});

	it("doctor: runnable → exit 0 with blockers/unknown/residual rendered", async () => {
		const doctor = vi.fn(async () =>
			baseReport({
				healthy: true,
				execution: {
					status: "runnable",
					blockers: [],
					unknownSources: ["x"],
					residual: ["r"],
				},
				remediation: ["do a thing"],
			}),
		);
		const out: string[] = [];
		const code = await runCodexHookCommand(
			"doctor",
			process.cwd(),
			{},
			{ doctor, log: (m) => out.push(m), logError: () => {} },
		);
		expect(code).toBe(0);
		expect(out.join("\n")).toContain("doctor codex: healthy");
	});

	it("install: refusal → exit 1 renders errors", async () => {
		const install = vi.fn(async () =>
			mutation({ ok: false, changed: [], errors: ["refuse hooks.json …"] }),
		);
		const err: string[] = [];
		const code = await runCodexHookCommand(
			"install",
			process.cwd(),
			{},
			{ install, log: () => {}, logError: (m) => err.push(m) },
		);
		expect(code).toBe(1);
		expect(err.join("\n")).toContain("install codex: refused");
	});
});
