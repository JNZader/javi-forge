import { describe, expect, it, vi } from "vitest";
import type {
	CursorHookDoctorReport,
	CursorHookMutationResult,
} from "../lib/cursor-hook-manager.js";
import { runCursorHookCommand } from "./cursor-hooks.js";

const report = (healthy = true): CursorHookDoctorReport => ({
	healthy,
	hooksJson: { state: healthy ? "managed-current" : "absent" },
	policy: { state: healthy ? "managed-current" : "absent" },
	remediation: healthy ? [] : ["install the Cursor hook"],
	execution: {
		status: "inconclusive",
		blockers: [],
		unknownSources: ["Cursor hook execution is not locally verified"],
		residual: [
			"Installed file bytes do not prove Cursor discovered, loaded, or invoked the hook",
		],
	},
});

const mutation = (): CursorHookMutationResult => ({
	ok: true,
	changed: ["/h/.cursor/hooks.json"],
	backups: ["/h/.cursor/hooks.json.bak"],
	errors: [],
	warnings: [],
	report: report(),
});

describe("runCursorHookCommand", () => {
	it("install renders success", async () => {
		const out: string[] = [];
		expect(
			await runCursorHookCommand(
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
		expect(out.join("\n")).toContain("install cursor: ok");
		expect(out.join("\n")).toContain("backup: /h/.cursor/hooks.json.bak");
	});

	it("repair forwards force", async () => {
		const repair = vi.fn(async () => mutation());
		await runCursorHookCommand(
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
			await runCursorHookCommand(
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
		expect(err.join("\n")).toContain("backup: /h/.cursor/hooks.json.bak");
	});

	it("doctor reports inconclusive execution and exits 2", async () => {
		const out: string[] = [];
		expect(
			await runCursorHookCommand(
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
			"unknown: Cursor hook execution is not locally verified",
		);
		expect(out.join("\n")).toContain(
			"residual: Installed file bytes do not prove Cursor discovered, loaded, or invoked the hook",
		);
	});

	it("doctor still exits 2 when installed files are healthy but runtime is unverified", async () => {
		const out: string[] = [];
		expect(
			await runCursorHookCommand(
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
		expect(out.join("\n")).toContain("doctor cursor: healthy");
		expect(out.join("\n")).toContain("execution: inconclusive");
	});
});
