import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InitStep } from "../types/index.js";

// ── Mock plugin lib ──────────────────────────────────────────────────────────
vi.mock("../lib/plugin.js", () => ({
	installPlugin: vi.fn(),
	removePlugin: vi.fn(),
	listInstalledPlugins: vi.fn(),
	validatePlugin: vi.fn(),
	searchRegistry: vi.fn(),
	syncPlugins: vi.fn(),
}));

vi.mock("../lib/agent-skills.js", () => ({
	exportPluginAsAgentSkills: vi.fn(),
	importAgentSkillsPackage: vi.fn(),
	generateProjectSkillsJson: vi.fn(),
	generateGlobalSkillsJson: vi.fn(),
}));

vi.mock("../lib/codex-export.js", () => ({
	exportPluginAsCodexToml: vi.fn(),
}));

import {
	exportPluginAsAgentSkills,
	generateGlobalSkillsJson,
	generateProjectSkillsJson,
	importAgentSkillsPackage,
} from "../lib/agent-skills.js";
import { exportPluginAsCodexToml } from "../lib/codex-export.js";
import {
	installPlugin,
	listInstalledPlugins,
	removePlugin,
	searchRegistry,
	syncPlugins,
	validatePlugin,
} from "../lib/plugin.js";
import {
	runPluginAdd,
	runPluginCommand,
	runPluginExport,
	runPluginExportCodex,
	runPluginImport,
	runPluginList,
	runPluginRemove,
	runPluginSearch,
	runPluginSync,
	runPluginValidate,
} from "./plugin.js";

const mockInstall = vi.mocked(installPlugin);
const mockRemove = vi.mocked(removePlugin);
const mockList = vi.mocked(listInstalledPlugins);
const mockValidate = vi.mocked(validatePlugin);
const mockSearch = vi.mocked(searchRegistry);
const mockSync = vi.mocked(syncPlugins);
const mockExport = vi.mocked(exportPluginAsAgentSkills);
const mockImport = vi.mocked(importAgentSkillsPackage);
const mockExportCodex = vi.mocked(exportPluginAsCodexToml);

beforeEach(() => vi.clearAllMocks());

function collectSteps(): { steps: InitStep[]; onStep: (s: InitStep) => void } {
	const steps: InitStep[] = [];
	return { steps, onStep: (s: InitStep) => steps.push(s) };
}

// ── runPluginAdd ─────────────────────────────────────────────────────────────

describe("runPluginAdd", () => {
	it("reports success when install succeeds", async () => {
		mockInstall.mockResolvedValue({ success: true, name: "my-plugin" });
		const { steps, onStep } = collectSteps();

		await runPluginAdd("org/repo", false, onStep);

		expect(steps).toHaveLength(2);
		expect(steps[0]!.status).toBe("running");
		expect(steps[1]!.status).toBe("done");
		expect(steps[1]!.detail).toContain("installed my-plugin");
	});

	it("reports dry-run on success", async () => {
		mockInstall.mockResolvedValue({ success: true, name: "my-plugin" });
		const { steps, onStep } = collectSteps();

		await runPluginAdd("org/repo", true, onStep);

		expect(steps[1]!.detail).toContain("dry-run");
	});

	it("reports error when install fails", async () => {
		mockInstall.mockResolvedValue({ success: false, error: "clone failed" });
		const { steps, onStep } = collectSteps();

		expect(await runPluginAdd("org/repo", false, onStep)).toEqual({
			status: "failure",
		});

		expect(steps[1]!.status).toBe("error");
		expect(steps[1]!.detail).toContain("clone failed");
	});

	it("threads force to installPlugin options (defaults false)", async () => {
		mockInstall.mockResolvedValue({ success: true, name: "my-plugin" });
		const { onStep } = collectSteps();

		await runPluginAdd("org/repo", false, onStep);
		expect(mockInstall).toHaveBeenLastCalledWith("org/repo", {
			dryRun: false,
			force: undefined,
		});

		await runPluginAdd("org/repo", false, onStep, { force: true });
		expect(mockInstall).toHaveBeenLastCalledWith("org/repo", {
			dryRun: false,
			force: true,
		});
	});
});

// ── runPluginRemove ──────────────────────────────────────────────────────────

describe("runPluginRemove", () => {
	it("reports success when removal succeeds", async () => {
		mockRemove.mockResolvedValue({ success: true });
		const { steps, onStep } = collectSteps();

		await runPluginRemove("my-plugin", false, onStep);

		expect(steps[1]!.status).toBe("done");
		expect(steps[1]!.detail).toContain("removed my-plugin");
	});

	it("reports dry-run on success", async () => {
		mockRemove.mockResolvedValue({ success: true });
		const { steps, onStep } = collectSteps();

		await runPluginRemove("my-plugin", true, onStep);

		expect(steps[1]!.detail).toContain("dry-run");
	});

	it("reports error when plugin not found", async () => {
		mockRemove.mockResolvedValue({ success: false, error: "not installed" });
		const { steps, onStep } = collectSteps();

		expect(await runPluginRemove("nonexistent", false, onStep)).toEqual({
			status: "failure",
		});

		expect(steps[1]!.status).toBe("error");
	});
});

// ── runPluginList ────────────────────────────────────────────────────────────

describe("runPluginList", () => {
	it("reports no plugins when list is empty", async () => {
		mockList.mockResolvedValue([]);
		const { steps, onStep } = collectSteps();

		await runPluginList(onStep);

		expect(steps[1]!.detail).toContain("no plugins installed");
	});

	it("reports count and names when plugins exist", async () => {
		mockList.mockResolvedValue([
			{
				name: "alpha",
				version: "1.0.0",
				installedAt: "",
				source: "",
				manifest: {
					name: "alpha",
					version: "1.0.0",
					description: "test test test",
				},
			},
			{
				name: "beta",
				version: "2.0.0",
				installedAt: "",
				source: "",
				manifest: {
					name: "beta",
					version: "2.0.0",
					description: "test test test",
				},
			},
		]);
		const { steps, onStep } = collectSteps();

		await runPluginList(onStep);

		expect(steps[1]!.detail).toContain("2 plugins");
		expect(steps[1]!.detail).toContain("alpha@1.0.0");
		expect(steps[1]!.detail).toContain("beta@2.0.0");
	});
});

// ── runPluginSearch ──────────────────────────────────────────────────────────

describe("runPluginSearch", () => {
	it("reports empty results", async () => {
		mockSearch.mockResolvedValue({ status: "success", entries: [] });
		const { steps, onStep } = collectSteps();

		await runPluginSearch("test", onStep);

		expect(steps[1]!.detail).toContain("no plugins matching");
	});

	it("reports search results with count", async () => {
		mockSearch.mockResolvedValue({
			status: "success",
			entries: [
				{
					id: "org/plugin",
					repository: "https://github.com/org/plugin",
					description: "A plugin",
					tags: [],
				},
			],
		});
		const { steps, onStep } = collectSteps();

		await runPluginSearch("plugin", onStep);

		expect(steps[1]!.detail).toContain("1 results");
		expect(steps[1]!.detail).toContain("org/plugin");
	});

	it("reports a genuinely empty registry without implying failure", async () => {
		mockSearch.mockResolvedValue({ status: "success", entries: [] });
		const { steps, onStep } = collectSteps();

		await runPluginSearch(undefined, onStep);

		expect(steps[1]!.detail).toBe("registry has no plugins");
	});
	it.each([
		"unavailable",
		"cancelled",
	] as const)("maps %s to failure without changing process state", async (status) => {
		mockSearch.mockResolvedValue({ status });
		const { steps, onStep } = collectSteps();
		const previous = process.exitCode;
		try {
			process.exitCode = 7;
			expect(await runPluginSearch(undefined, onStep)).toEqual({
				status: "failure",
			});
			expect(steps.at(-1)).toMatchObject({
				status: "error",
				detail:
					status === "cancelled"
						? "registry search cancelled"
						: "registry unavailable; check connectivity and try again",
			});
			expect(process.exitCode).toBe(7);
		} finally {
			process.exitCode = previous;
		}
	});
	it("does not report real registry transport failure as successful empty search", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi
			.fn()
			.mockRejectedValue(new Error("private network detail"));
		try {
			const actual =
				await vi.importActual<typeof import("../lib/plugin.js")>(
					"../lib/plugin.js",
				);
			mockSearch.mockImplementationOnce(actual.searchRegistry);
			const { steps, onStep } = collectSteps();
			expect(await runPluginSearch(undefined, onStep)).toEqual({
				status: "failure",
			});
			expect(steps.at(-1)?.status).toBe("error");
			expect(steps.at(-1)?.detail).not.toContain("private");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});

// ── runPluginValidate ────────────────────────────────────────────────────────

describe("runPluginValidate", () => {
	it("reports valid plugin", async () => {
		mockValidate.mockResolvedValue({
			valid: true,
			errors: [],
			manifest: {
				name: "my-plugin",
				version: "1.0.0",
				description: "A valid plugin desc",
			},
		});
		const { steps, onStep } = collectSteps();

		await runPluginValidate("/path/to/plugin", onStep);

		expect(steps[1]!.status).toBe("done");
		expect(steps[1]!.detail).toContain("valid");
		expect(steps[1]!.detail).toContain("my-plugin@1.0.0");
	});

	it("reports validation errors", async () => {
		mockValidate.mockResolvedValue({
			valid: false,
			errors: [{ path: "name", message: "name is required" }],
			manifest: null,
		});
		const { steps, onStep } = collectSteps();

		expect(await runPluginValidate("/path/to/plugin", onStep)).toEqual({
			status: "failure",
		});

		expect(steps[1]!.status).toBe("error");
		expect(steps[1]!.detail).toContain("1 errors");
		expect(steps[1]!.detail).toContain("name is required");
	});
});

// ── runPluginSync ───────────────────────────────────────────────────────

describe("runPluginSync", () => {
	it("reports added and unchanged plugins", async () => {
		mockSync.mockResolvedValue({
			added: ["alpha"],
			removed: [],
			unchanged: ["beta"],
			wired: [],
			unwired: [],
		});
		const { steps, onStep } = collectSteps();

		await runPluginSync("/fake/project", false, onStep);

		expect(steps).toHaveLength(2);
		expect(steps[0]!.status).toBe("running");
		expect(steps[1]!.status).toBe("done");
		expect(steps[1]!.detail).toContain("added: alpha");
		expect(steps[1]!.detail).toContain("unchanged: beta");
	});

	it("reports removed plugins", async () => {
		mockSync.mockResolvedValue({
			added: [],
			removed: ["old"],
			unchanged: [],
			wired: [],
			unwired: [],
		});
		const { steps, onStep } = collectSteps();

		await runPluginSync("/fake/project", false, onStep);

		expect(steps[1]!.detail).toContain("removed: old");
	});

	it("reports no plugins when none detected", async () => {
		mockSync.mockResolvedValue({
			added: [],
			removed: [],
			unchanged: [],
			wired: [],
			unwired: [],
		});
		const { steps, onStep } = collectSteps();

		await runPluginSync("/fake/project", false, onStep);

		expect(steps[1]!.detail).toContain("no plugins detected");
	});

	it("prefixes dry-run in detail", async () => {
		mockSync.mockResolvedValue({
			added: ["alpha"],
			removed: [],
			unchanged: [],
			wired: [],
			unwired: [],
		});
		const { steps, onStep } = collectSteps();

		await runPluginSync("/fake/project", true, onStep);

		expect(steps[1]!.detail).toContain("dry-run:");
		expect(steps[1]!.detail).toContain("added: alpha");
	});

	it("reports error when sync throws", async () => {
		mockSync.mockRejectedValue(new Error("fs exploded") as never);
		const { steps, onStep } = collectSteps();

		expect(await runPluginSync("/fake/project", false, onStep)).toEqual({
			status: "failure",
		});

		expect(steps[1]!.status).toBe("error");
		expect(steps[1]!.detail).toContain("fs exploded");
	});
});

// ── runPluginExport ─────────────────────────────────────────────────────────

describe("runPluginExport", () => {
	it("reports success when export succeeds", async () => {
		mockExport.mockResolvedValue({
			success: true,
			path: "/plugins/my-plugin/skills.json",
		});
		const { steps, onStep } = collectSteps();

		await runPluginExport("my-plugin", onStep);

		expect(steps).toHaveLength(2);
		expect(steps[0]!.status).toBe("running");
		expect(steps[1]!.status).toBe("done");
		expect(steps[1]!.detail).toContain("exported to");
	});

	it("reports error when plugin not installed", async () => {
		mockExport.mockResolvedValue({
			success: false,
			error: 'plugin "ghost" is not installed',
		});
		const { steps, onStep } = collectSteps();

		expect(await runPluginExport("ghost", onStep)).toEqual({
			status: "failure",
		});

		expect(steps[1]!.status).toBe("error");
		expect(steps[1]!.detail).toContain("not installed");
	});
});

// ── runPluginImport ─────────────────────────────────────────────────────────

describe("runPluginImport", () => {
	it("reports success when import succeeds", async () => {
		mockImport.mockResolvedValue({ success: true, name: "imported-skill" });
		const { steps, onStep } = collectSteps();

		await runPluginImport("/path/to/package", false, onStep);

		expect(steps).toHaveLength(2);
		expect(steps[0]!.status).toBe("running");
		expect(steps[1]!.status).toBe("done");
		expect(steps[1]!.detail).toContain("imported imported-skill");
	});

	it("reports dry-run on success", async () => {
		mockImport.mockResolvedValue({ success: true, name: "imported-skill" });
		const { steps, onStep } = collectSteps();

		await runPluginImport("/path/to/package", true, onStep);

		expect(steps[1]!.detail).toContain("dry-run");
	});

	it("reports error when skills.json not found", async () => {
		mockImport.mockResolvedValue({
			success: false,
			error: "skills.json not found",
		});
		const { steps, onStep } = collectSteps();

		expect(await runPluginImport("/bad/path", false, onStep)).toEqual({
			status: "failure",
		});

		expect(steps[1]!.status).toBe("error");
		expect(steps[1]!.detail).toContain("skills.json not found");
	});

	it("threads force to importAgentSkillsPackage (options object, R2-003)", async () => {
		mockImport.mockResolvedValue({ success: true, name: "imported-skill" });
		const { onStep } = collectSteps();

		await runPluginImport("/path/to/package", false, onStep);
		expect(mockImport).toHaveBeenLastCalledWith("/path/to/package", {
			dryRun: false,
			force: undefined,
		});

		await runPluginImport("/path/to/package", false, onStep, { force: true });
		expect(mockImport).toHaveBeenLastCalledWith("/path/to/package", {
			dryRun: false,
			force: true,
		});
	});
});

// ── runPluginExportCodex ──────────────────────────────────────────────────

describe("runPluginExportCodex", () => {
	it("reports success with file count", async () => {
		mockExportCodex.mockResolvedValue({
			success: true,
			files: ["/plugins/my-plugin/codex/react-pro.toml"],
		});
		const { steps, onStep } = collectSteps();

		await runPluginExportCodex("my-plugin", onStep);

		expect(steps).toHaveLength(2);
		expect(steps[0]!.status).toBe("running");
		expect(steps[1]!.status).toBe("done");
		expect(steps[1]!.detail).toContain("1 TOML file(s)");
	});

	it("reports error when plugin not installed", async () => {
		mockExportCodex.mockResolvedValue({
			success: false,
			error: 'plugin "ghost" is not installed',
		});
		const { steps, onStep } = collectSteps();

		expect(await runPluginExportCodex("ghost", onStep)).toEqual({
			status: "failure",
		});

		expect(steps[1]!.status).toBe("error");
		expect(steps[1]!.detail).toContain("not installed");
	});

	it("reports error when no valid skills found", async () => {
		mockExportCodex.mockResolvedValue({
			success: false,
			error: "no skills with valid frontmatter found",
		});
		const { steps, onStep } = collectSteps();

		await runPluginExportCodex("bad-plugin", onStep);

		expect(steps[1]!.status).toBe("error");
		expect(steps[1]!.detail).toContain(
			"no skills with valid frontmatter found",
		);
	});
});

// ── skillguard refusal exit code (FU-1 / R4-002) ────────────────────────────

describe("skillguard refusal result (FU-1/R4-002)", () => {
	beforeEach(() => {
		process.exitCode = undefined;
	});

	afterEach(() => {
		process.exitCode = undefined;
	});

	it("runPluginAdd: a refused install returns refused without changing process state", async () => {
		mockInstall.mockResolvedValue({
			success: false,
			refused: true,
			error:
				"skillguard: install refused — 1 rejected (1 blocked, 0 unscannable)",
		});
		const { steps, onStep } = collectSteps();

		expect(await runPluginAdd("org/repo", false, onStep)).toEqual({
			status: "refused",
		});

		expect(steps[1]!.status).toBe("error");
		expect(process.exitCode).toBeUndefined();
	});

	it("runPluginAdd: success and non-gate failures return distinct results without changing process state", async () => {
		const { onStep } = collectSteps();

		mockInstall.mockResolvedValue({ success: true, name: "my-plugin" });
		expect(await runPluginAdd("org/repo", false, onStep)).toEqual({
			status: "success",
		});
		expect(process.exitCode).toBeUndefined();

		// Ordinary failures are not guard refusals, but are still failures.
		mockInstall.mockResolvedValue({
			success: false,
			error: "validation failed:\n  name: name is required",
		});
		expect(await runPluginAdd("org/repo", false, onStep)).toEqual({
			status: "failure",
		});
		expect(process.exitCode).toBeUndefined();
	});

	it("runPluginImport: a refused import returns refused without changing process state", async () => {
		mockImport.mockResolvedValue({
			success: false,
			refused: true,
			error:
				"skillguard: install refused — undeclared SKILL.md(s) in tree (every skill-shaped file must be declared; force never lifts)",
		});
		const { steps, onStep } = collectSteps();

		expect(await runPluginImport("/path/to/package", false, onStep)).toEqual({
			status: "refused",
		});

		expect(steps[1]!.status).toBe("error");
		expect(process.exitCode).toBeUndefined();
	});

	it("runPluginImport: success and non-gate failures return distinct results without changing process state", async () => {
		const { onStep } = collectSteps();

		mockImport.mockResolvedValue({ success: true, name: "imported-skill" });
		expect(await runPluginImport("/path/to/package", false, onStep)).toEqual({
			status: "success",
		});
		expect(process.exitCode).toBeUndefined();

		mockImport.mockResolvedValue({
			success: false,
			error: "skills.json not found",
		});
		expect(await runPluginImport("/bad/path", false, onStep)).toEqual({
			status: "failure",
		});
		expect(process.exitCode).toBeUndefined();
	});
});

describe("runPluginCommand", () => {
	const request = { projectDir: "/project", dryRun: true, force: true };
	const projectExport = vi.mocked(generateProjectSkillsJson);
	const globalExport = vi.mocked(generateGlobalSkillsJson);
	const calls = [
		mockInstall,
		mockRemove,
		mockList,
		mockSearch,
		mockValidate,
		mockSync,
		mockExport,
		mockExportCodex,
		mockImport,
		projectExport,
		globalExport,
	];
	beforeEach(() => {
		mockInstall.mockResolvedValue({ success: true });
		mockRemove.mockResolvedValue({ success: true });
		mockList.mockResolvedValue([]);
		mockSearch.mockResolvedValue({ status: "success", entries: [] });
		mockValidate.mockResolvedValue({ valid: true, errors: [], manifest: null });
		mockSync.mockResolvedValue({
			added: [],
			removed: [],
			unchanged: [],
			wired: [],
			unwired: [],
		});
		for (const fn of [
			mockExport,
			mockExportCodex,
			mockImport,
			projectExport,
			globalExport,
		])
			fn.mockResolvedValue({ success: true, skillCount: 0, pluginCount: 0 });
	});
	it.each([
		[
			"add",
			"org/repo",
			false,
			mockInstall,
			["org/repo", { dryRun: true, force: true }],
		],
		["remove", "demo", false, mockRemove, ["demo", { dryRun: true }]],
		[undefined, undefined, false, mockList, []],
		["list", undefined, false, mockList, []],
		["search", undefined, false, mockSearch, [undefined]],
		["validate", "/plugin", false, mockValidate, ["/plugin"]],
		["sync", undefined, false, mockSync, ["/project", { dryRun: true }]],
		["export", "demo", false, mockExport, ["demo"]],
		["export", "demo", true, mockExportCodex, ["demo"]],
		[
			"import",
			"/package",
			false,
			mockImport,
			["/package", { dryRun: true, force: true }],
		],
		[
			"export-skills",
			undefined,
			false,
			projectExport,
			["/project", { dryRun: true }],
		],
		[
			"export-skills",
			"/other",
			false,
			projectExport,
			["/other", { dryRun: true }],
		],
		["export-skills", "global", false, globalExport, [{ dryRun: true }]],
	] as const)("forwards %s/%s (codex=%s) once", async (action, target, codex, called, args) => {
		const { onStep, steps } = collectSteps();
		const previous = process.exitCode;
		process.exitCode = 7;
		try {
			expect(
				await runPluginCommand({ ...request, action, target, codex }, onStep),
			).toEqual({ status: "success" });
			expect(called).toHaveBeenCalledExactlyOnceWith(...args);
			expect(calls.reduce((n, fn) => n + fn.mock.calls.length, 0)).toBe(1);
			expect(steps.at(-1)?.status).toBe("done");
			expect(process.exitCode).toBe(7);
		} finally {
			process.exitCode = previous;
		}
	});
	it.each([
		"unknown",
		"",
		"add",
		"remove",
		"validate",
		"export",
		"import",
	])("rejects invalid usage %j without library calls", async (action) => {
		const { onStep, steps } = collectSteps();
		expect(await runPluginCommand({ ...request, action }, onStep)).toEqual({
			status: "failure",
		});
		expect(calls.every((fn) => fn.mock.calls.length === 0)).toBe(true);
		expect(steps.at(-1)?.status).toBe("error");
	});
	it.each([
		"add",
		"sync",
	])("catches an unexpected %s rejection once", async (action) => {
		mockInstall.mockRejectedValue(new Error("unexpected"));
		mockSync.mockRejectedValue(new Error("unexpected"));
		const { onStep, steps } = collectSteps();
		expect(
			await runPluginCommand({ ...request, action, target: "demo" }, onStep),
		).toEqual({ status: "failure" });
		expect(steps.filter((s) => s.status === "error")).toHaveLength(1);
		expect(calls.reduce((n, fn) => n + fn.mock.calls.length, 0)).toBe(1);
	});
});

describe("plugin replacement cleanup warnings", () => {
	it.each([
		"install",
		"import",
	])("projects %s warning without changing success", async (caller) => {
		const warning = "backup cleanup requires review at /owned/previous";
		const result = { success: true, name: "demo", warning };
		const { steps, onStep } = collectSteps();
		if (caller === "install") mockInstall.mockResolvedValue(result);
		else mockImport.mockResolvedValue(result);
		const outcome =
			caller === "install"
				? await runPluginAdd("org/repo", false, onStep)
				: await runPluginImport("/source", false, onStep);
		expect(outcome).toEqual({ status: "success" });
		expect(steps.at(-1)?.detail).toContain(warning);
	});
});
