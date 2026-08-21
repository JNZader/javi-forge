import { describe, expect, it, vi } from "vitest";
import type {
	ClaudeHookDoctorReport,
	ClaudeHookMutationResult,
} from "../lib/claude-hook-manager.js";
import { ACL_PACKAGE_REMEDIATION } from "../lib/secure-refusal-remediation.js";
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
		execution: {
			status: "runnable",
			blockers: [],
			unknownSources: [],
			residual: [],
		},
		installCapability: { acl: { status: "available", tool: "getfacl" } },
		nodeOnPath: { status: "resolved", version: "v22.11.0", major: 22 },
		...overrides,
	} as ClaudeHookDoctorReport;
}

interface ClaudeMutationResultOverrides {
	ok?: boolean;
	changed?: string[];
	backups?: string[];
	errors?: string[];
	warnings?: string[];
	report?: ClaudeHookDoctorReport;
}

function mutationResult(
	overrides: ClaudeMutationResultOverrides = {},
): ClaudeHookMutationResult {
	return {
		ok: true,
		changed: [],
		backups: [],
		errors: [],
		warnings: [],
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

	it("doctor: prints the node-on-PATH row as a heuristic, distinct from the node row", async () => {
		const doctor = vi
			.fn()
			.mockResolvedValue(
				doctorReport({ nodeOnPath: { status: "absent" } as never }),
			);
		const { out, deps } = harness({ doctor });

		await runClaudeHookCommand("doctor", "/proj", {}, deps);

		const text = out.join("\n");
		expect(text).toContain("node-on-PATH: absent");
		expect(text).toContain("heuristic");
		// The process' own Node row is still rendered separately.
		expect(text).toContain("node:     22.0.0");
	});

	it("doctor: prints the node-on-PATH row when the capability is satisfied too", async () => {
		const doctor = vi.fn().mockResolvedValue(doctorReport());
		const { out, deps } = harness({ doctor });
		await runClaudeHookCommand("doctor", "/proj", {}, deps);
		expect(out.join("\n")).toContain("node-on-PATH: resolved v22.11.0");
	});

	it("install: a warning is rendered distinctly from errors and does NOT fail", async () => {
		const install = vi.fn().mockResolvedValue(
			mutationResult({
				ok: true,
				changed: ["/proj/.claude/settings.json"],
				warnings: ["node did not resolve on this process' PATH (heuristic)"],
			}),
		);
		const { out, err, deps } = harness({ install });

		const code = await runClaudeHookCommand("install", "/proj", {}, deps);

		// Non-blocking: the install succeeded, so the exit code is unchanged.
		expect(code).toBe(0);
		const text = out.join("\n");
		expect(text).toContain("warnings:");
		expect(text).toContain("node did not resolve");
		// A warning is never rendered as a refusal/error line.
		expect(err.join("\n")).not.toContain("node did not resolve");
		expect(text).not.toContain("refused");
	});

	it("repair: warnings are rendered on a refusal too, without changing the code", async () => {
		const repair = vi.fn().mockResolvedValue(
			mutationResult({
				ok: false,
				errors: ["refuse asset in state edited-managed"],
				warnings: ["node did not resolve on this process' PATH (heuristic)"],
			}),
		);
		const { out, err, deps } = harness({ repair });

		const code = await runClaudeHookCommand("repair", "/proj", {}, deps);

		expect(code).toBe(1);
		expect(err.join("\n")).toContain("refuse asset in state edited-managed");
		expect(out.join("\n")).toContain("node did not resolve");
	});

	it("prints no warnings section when there are none", async () => {
		const install = vi.fn().mockResolvedValue(mutationResult({ ok: true }));
		const { out, deps } = harness({ install });
		await runClaudeHookCommand("install", "/proj", {}, deps);
		expect(out.join("\n")).not.toContain("warnings:");
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

	it("doctor: blocked execution returns 1 and prints the blocking source", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				healthy: false,
				asset: { state: "edited-managed", detail: "edited-managed" },
				remediation: [
					"repair the managed asset with: javi-forge hooks repair claude --force",
				],
				execution: {
					status: "blocked",
					blockers: ["guard:asset=edited-managed"],
					unknownSources: [],
					residual: [],
				},
			}),
		);
		const { out, deps } = harness({ doctor });

		const code = await runClaudeHookCommand("doctor", "/proj", {}, deps);

		expect(code).toBe(1);
		const text = out.join("\n");
		expect(text).toContain("blocked");
		expect(text).toContain("guard:asset=edited-managed");
		expect(text).toContain(
			"repair the managed asset with: javi-forge hooks repair claude --force",
		);
	});

	it("doctor: runnable execution returns 0 and prints runnable", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				healthy: true,
				execution: {
					status: "runnable",
					blockers: [],
					unknownSources: [],
					residual: [],
				},
			}),
		);
		const { out, deps } = harness({ doctor });

		const code = await runClaudeHookCommand("doctor", "/proj", {}, deps);

		expect(code).toBe(0);
		expect(out.join("\n")).toContain("runnable");
	});

	it("doctor: inconclusive execution returns 2 and lists the unknown source", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				healthy: true,
				execution: {
					status: "inconclusive",
					blockers: [],
					unknownSources: [
						"managed:/etc/claude-code/managed-settings.json (EACCES)",
					],
					residual: [],
				},
			}),
		);
		const { out, deps } = harness({ doctor });

		const code = await runClaudeHookCommand("doctor", "/proj", {}, deps);

		expect(code).toBe(2);
		const text = out.join("\n");
		expect(text).toContain("inconclusive");
		expect(text).toContain(
			"managed:/etc/claude-code/managed-settings.json (EACCES)",
		);
		expect(text).not.toContain("runnable");
	});

	it("doctor: renders blockers in stable committed order", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				execution: {
					status: "blocked",
					blockers: [
						"policy:disableAllHooks@project",
						"policy:disableAllHooks@user",
						"guard:asset=edited-managed",
					],
					unknownSources: [],
					residual: [],
				},
			}),
		);
		const { out, deps } = harness({ doctor });

		await runClaudeHookCommand("doctor", "/proj", {}, deps);

		const text = out.join("\n");
		const iProject = text.indexOf("policy:disableAllHooks@project");
		const iUser = text.indexOf("policy:disableAllHooks@user");
		const iGuard = text.indexOf("guard:asset=edited-managed");
		expect(iProject).toBeGreaterThanOrEqual(0);
		expect(iProject).toBeLessThan(iUser);
		expect(iUser).toBeLessThan(iGuard);
	});

	it("doctor: always prints residual caveats regardless of status", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				execution: {
					status: "runnable",
					blockers: [],
					unknownSources: [],
					residual: [
						"server-delivered policy caveat",
						"session safe-mode caveat",
					],
				},
			}),
		);
		const { out, deps } = harness({ doctor });

		const code = await runClaudeHookCommand("doctor", "/proj", {}, deps);

		expect(code).toBe(0);
		const text = out.join("\n");
		expect(text).toContain("server-delivered policy caveat");
		expect(text).toContain("session safe-mode caveat");
	});

	it("doctor: prints the acl capability row when the adapter is available", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				installCapability: { acl: { status: "available", tool: "getfacl" } },
			}),
		);
		const { out, deps } = harness({ doctor });

		const code = await runClaudeHookCommand("doctor", "/proj", {}, deps);

		expect(code).toBe(0);
		const text = out.join("\n");
		expect(text).toContain("acl-capability");
		expect(text).toContain("available");
		expect(text).toContain("getfacl");
	});

	it("doctor: prints the acl capability row + remediation when absent, still exit 0", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				installCapability: {
					acl: { status: "absent", tool: "getfacl" },
					remediation: ACL_PACKAGE_REMEDIATION,
				},
			}),
		);
		const { out, deps } = harness({ doctor });

		const code = await runClaudeHookCommand("doctor", "/proj", {}, deps);

		// The capability section never drives the exit code — execution does.
		expect(code).toBe(0);
		const text = out.join("\n");
		expect(text).toContain("acl-capability");
		expect(text).toContain("absent");
		expect(text).toContain("apt install acl");
		expect(text).toContain("apk add acl");
		expect(text).toContain("dnf install acl");
	});

	it("doctor: prints the unknown capability detail", async () => {
		const doctor = vi.fn().mockResolvedValue(
			doctorReport({
				installCapability: {
					acl: {
						status: "unknown",
						tool: "getfacl",
						detail: "getfacl --version timeout",
					},
				},
			}),
		);
		const { out, deps } = harness({ doctor });

		await runClaudeHookCommand("doctor", "/proj", {}, deps);

		expect(out.join("\n")).toContain("getfacl --version timeout");
	});

	it("install: an adapter-absent refusal prints the acl-package remediation", async () => {
		const install = vi.fn().mockResolvedValue(
			mutationResult({
				ok: false,
				errors: ["acl /home/user: getfacl absent"],
			}),
		);
		const { out, err, deps } = harness({ install });

		const code = await runClaudeHookCommand("install", "/proj", {}, deps);

		expect(code).toBe(1);
		const text = [...out, ...err].join("\n");
		expect(text).toContain("acl /home/user: getfacl absent");
		expect(text).toContain("apt install acl");
		expect(text).toContain("apk add acl");
		expect(text).toContain("dnf install acl");
	});

	it("repair: renders the identical remediation for the same refusal", async () => {
		const repair = vi.fn().mockResolvedValue(
			mutationResult({
				ok: false,
				errors: ["acl /home/user: getfacl absent"],
			}),
		);
		const { out, err, deps } = harness({ repair });

		const code = await runClaudeHookCommand(
			"repair",
			"/proj",
			{ force: false },
			deps,
		);

		expect(code).toBe(1);
		expect([...out, ...err].join("\n")).toContain(ACL_PACKAGE_REMEDIATION);
	});

	it("install: a real extended-ACL refusal gets NO package remediation", async () => {
		const install = vi.fn().mockResolvedValue(
			mutationResult({
				ok: false,
				errors: ["acl /home/user: extended ACL entry"],
			}),
		);
		const { out, err, deps } = harness({ install });

		await runClaudeHookCommand("install", "/proj", {}, deps);

		const text = [...out, ...err].join("\n");
		expect(text).toContain("extended ACL entry");
		expect(text).not.toContain("apt install acl");
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
	it.each([
		"install",
		"repair",
	] as const)("%s renders the Darwin refusal code and guidance with exit 1", async (sub) => {
		const refusal: ClaudeHookMutationResult = {
			ok: false,
			changed: [],
			backups: [],
			errors: ["unsupported-platform"],
			warnings: ["javi-forge supports Linux and Windows only."],
			lifecycleRefusal: {
				state: "unsupported-platform",
				refusalCode: "unsupported-platform",
				guidance: "javi-forge supports Linux and Windows only.",
			},
		};
		const action = vi.fn().mockResolvedValue(refusal);
		const { out, err, deps } = harness(
			sub === "install" ? { install: action } : { repair: action },
		);
		expect(await runClaudeHookCommand(sub, "/proj", {}, deps)).toBe(1);
		expect(err.join("\n")).toContain("unsupported-platform");
		expect(out.join("\n")).toContain(
			"javi-forge supports Linux and Windows only.",
		);
	});

	it("doctor renders the generic unsupported-platform refusal with exit 1", async () => {
		const out: string[] = [];
		const report = {
			state: "unsupported-platform",
			healthy: false,
			platformSupport: {
				state: "unsupported-platform",
				refusalCode: "unsupported-platform",
				guidance: "javi-forge supports Linux and Windows only.",
			},
		};
		const code = await runClaudeHookCommand(
			"doctor",
			"/proj",
			{},
			{
				doctor: vi.fn().mockResolvedValue(report),
				log: (m) => out.push(m),
				logError: () => {},
			},
		);
		expect(code).toBe(1);
		expect(out.join("\n")).toContain(
			"unsupported-platform: javi-forge supports Linux and Windows only.",
		);
	});
});

describe("public platform ingress", () => {
	it.each([
		"install",
		"repair",
		"doctor",
	] as const)("refuses %s before the Claude manager on an unsupported synthetic platform", async (sub) => {
		const action = vi.fn(async () => {
			throw new Error("manager must not run");
		});
		const errors: string[] = [];
		expect(
			await runClaudeHookCommand(sub, "/proj", {}, {
				platform: "darwin-arm64",
				install: action,
				repair: action,
				doctor: action,
				logError: (message: string) => errors.push(message),
			} as never),
		).toBe(1);
		expect(action).not.toHaveBeenCalled();
		expect(errors.join("\\n")).toContain("unsupported-platform");
	});
});
