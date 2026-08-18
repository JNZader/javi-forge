import { describe, expect, it, vi } from "vitest";
import type {
	ClaudeHookDoctorReport,
	ClaudeHookMutationResult,
} from "../lib/claude-hook-manager.js";
import {
	type ClaudeHookCmdDeps,
	runClaudeHookCommand,
} from "./claude-hooks.js";

/**
 * `runClaudeHookCommand` renders the already-tested library results to a human
 * and maps them to exit codes. Tests inject fake lib fns + capture log/logError,
 * mirroring the inject-deps harness in `src/cli/dispatch/hooks.test.ts`.
 */

function doctorReport(
	overrides: Partial<ClaudeHookDoctorReport> = {},
): ClaudeHookDoctorReport {
	return {
		healthy: true,
		settings: { state: "managed-current", detail: "managed-current" },
		asset: { state: "managed-current", detail: "managed-current" },
		node: { available: true, version: "22.0.0", satisfiesMinimum: true },
		matcherExact: true,
		commandShapeExact: true,
		assetSettingsConsistent: true,
		coverage: ["Bash", "PowerShell", "Read", "Write", "Edit"],
		hostResidual: "spawn/start/timeout failures continue through Claude flow",
		remediation: [],
		...overrides,
	} as ClaudeHookDoctorReport;
}

function mutationResult(
	overrides: Partial<ClaudeHookMutationResult> = {},
): ClaudeHookMutationResult {
	return {
		ok: true,
		changed: [],
		backups: [],
		errors: [],
		report: doctorReport(),
		...overrides,
	};
}

function harness(deps: Partial<ClaudeHookCmdDeps> = {}) {
	const out: string[] = [];
	const err: string[] = [];
	const merged: ClaudeHookCmdDeps = {
		log: (m) => out.push(m),
		logError: (m) => err.push(m),
		...deps,
	};
	return { out, err, deps: merged };
}

describe("runClaudeHookCommand", () => {
	it("install: ok result prints changed paths and returns 0", async () => {
		const install = vi.fn().mockResolvedValue(
			mutationResult({
				ok: true,
				changed: [
					"/proj/.claude/settings.json",
					"/proj/.claude/hooks/guard.mjs",
				],
			}),
		);
		const { out, deps } = harness({ install });

		const code = await runClaudeHookCommand("install", "/proj", {}, deps);

		expect(install).toHaveBeenCalledWith("/proj");
		expect(code).toBe(0);
		expect(out.join("\n")).toContain("/proj/.claude/settings.json");
		expect(out.join("\n")).toContain("/proj/.claude/hooks/guard.mjs");
	});

	it("install: ok with no changes reports up-to-date and prints backups", async () => {
		const install = vi.fn().mockResolvedValue(
			mutationResult({
				ok: true,
				changed: [],
				backups: ["/proj/.claude/settings.json.bak"],
			}),
		);
		const { out, deps } = harness({ install });

		const code = await runClaudeHookCommand("install", "/proj", {}, deps);

		expect(code).toBe(0);
		const text = out.join("\n");
		expect(text).toContain("already up to date");
		expect(text).toContain("/proj/.claude/settings.json.bak");
	});

	it("install: !ok result prints errors and returns 1", async () => {
		const install = vi.fn().mockResolvedValue(
			mutationResult({
				ok: false,
				changed: [],
				errors: ["refuse asset in state edited-managed — repair with --force"],
			}),
		);
		const { out, err, deps } = harness({ install });

		const code = await runClaudeHookCommand("install", "/proj", {}, deps);

		expect(code).toBe(1);
		expect([...out, ...err].join("\n")).toContain(
			"refuse asset in state edited-managed",
		);
	});

	it("doctor: healthy report prints per-component state + remediation, returns 0", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				healthy: true,
				remediation: [],
			}),
		);
		const { out, deps } = harness({ doctor });

		const code = await runClaudeHookCommand("doctor", "/proj", {}, deps);

		expect(doctor).toHaveBeenCalledWith("/proj");
		expect(code).toBe(0);
		const text = out.join("\n");
		expect(text).toContain("healthy");
		expect(text).toContain("managed-current");
	});

	it("doctor: unhealthy report still returns 0 and prints remediation", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				healthy: false,
				asset: { state: "edited-managed", detail: "edited-managed" },
				remediation: ["repair the managed asset with --force (Slice 3)"],
			}),
		);
		const { out, deps } = harness({ doctor });

		const code = await runClaudeHookCommand("doctor", "/proj", {}, deps);

		expect(code).toBe(0);
		const text = out.join("\n");
		expect(text).toContain("edited-managed");
		expect(text).toContain("repair the managed asset with --force");
	});

	it("doctor: prints execution inconclusive and NEVER RUNNABLE (healthy fixture)", async () => {
		const doctor = vi.fn().mockResolvedValue(doctorReport({ healthy: true }));
		const { out, deps } = harness({ doctor });

		await runClaudeHookCommand("doctor", "/proj", {}, deps);

		const text = out.join("\n");
		expect(text).toContain("inconclusive");
		expect(text).not.toContain("RUNNABLE");
	});

	it("doctor: NEVER prints RUNNABLE (unhealthy fixture)", async () => {
		const doctor = vi.fn().mockResolvedValue(doctorReport({ healthy: false }));
		const { out, deps } = harness({ doctor });

		await runClaudeHookCommand("doctor", "/proj", {}, deps);

		expect(out.join("\n")).not.toContain("RUNNABLE");
	});

	it("repair: without --force on edited-managed refuses and returns 1", async () => {
		const repair = vi.fn().mockResolvedValue(
			mutationResult({
				ok: false,
				errors: ["refuse asset in state edited-managed"],
			}),
		);
		const { out, err, deps } = harness({ repair });

		const code = await runClaudeHookCommand(
			"repair",
			"/proj",
			{ force: false },
			deps,
		);

		expect(repair).toHaveBeenCalledWith("/proj", { force: false });
		expect(code).toBe(1);
		expect([...out, ...err].join("\n")).toContain(
			"refuse asset in state edited-managed",
		);
	});

	it("repair: with --force forwards force:true and returns 0 on success", async () => {
		const repair = vi
			.fn()
			.mockResolvedValue(
				mutationResult({ ok: true, changed: ["/proj/.claude/settings.json"] }),
			);
		const { deps } = harness({ repair });

		const code = await runClaudeHookCommand(
			"repair",
			"/proj",
			{ force: true },
			deps,
		);

		expect(repair).toHaveBeenCalledWith("/proj", { force: true });
		expect(code).toBe(0);
	});
});
