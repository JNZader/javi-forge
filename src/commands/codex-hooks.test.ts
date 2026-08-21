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

interface CodexMutationResultOverrides {
	ok?: boolean;
	changed?: string[];
	backups?: string[];
	errors?: string[];
	warnings?: string[];
	report?: CodexHookDoctorReport;
}

const mutation = (
	over: CodexMutationResultOverrides = {},
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
	it.each([
		"install",
		"repair",
	] as const)("%s renders the Darwin refusal code and guidance with exit 1", async (sub) => {
		const refusal: CodexHookMutationResult = {
			ok: false,
			changed: [],
			backups: [],
			errors: ["macos-lifecycle-unsupported"],
			warnings: ["pin a supported release or migrate"],
			lifecycleRefusal: {
				platform: "darwin",
				state: "macos-deprecated",
				lifecycle: "unsupported",
				refusalCode: "macos-lifecycle-unsupported",
				guidance: "pin a supported release or migrate",
			},
		};
		const action = vi.fn(async () => refusal);
		const out: string[] = [];
		const err: string[] = [];
		expect(
			await runCodexHookCommand(
				sub,
				process.cwd(),
				{},
				sub === "install"
					? {
							install: action,
							log: (m) => out.push(m),
							logError: (m) => err.push(m),
						}
					: {
							repair: action,
							log: (m) => out.push(m),
							logError: (m) => err.push(m),
						},
			),
		).toBe(1);
		expect(err.join("\n")).toContain("macos-lifecycle-unsupported");
		expect(out.join("\n")).toContain("pin a supported release or migrate");
	});

	it("doctor renders Darwin advisory without changing its exit mapping", async () => {
		const out: string[] = [];
		const report = baseReport({
			platformSupport: {
				state: "macos-deprecated",
				lifecycle: "unsupported",
				refusalCode: "macos-lifecycle-unsupported",
				guidance: "pin a supported release or migrate",
				platform: "darwin",
			},
		} as never);
		const code = await runCodexHookCommand(
			"doctor",
			process.cwd(),
			{},
			{
				doctor: vi.fn().mockResolvedValue(report),
				log: (m) => out.push(m),
				logError: () => {},
			},
		);
		expect(code).toBe(0);
		expect(out.join("\n")).toContain("platform-support: macos-deprecated");
	});
});
