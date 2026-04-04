import { beforeEach, describe, expect, it, vi } from "vitest";
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
}));

vi.mock("../lib/codex-export.js", () => ({
	exportPluginAsCodexToml: vi.fn(),
}));

import {
	exportPluginAsAgentSkills,
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

		await runPluginAdd("org/repo", false, onStep);

		expect(steps[1]!.status).toBe("error");
		expect(steps[1]!.detail).toContain("clone failed");
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

		await runPluginRemove("nonexistent", false, onStep);

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
		mockSearch.mockResolvedValue([]);
		const { steps, onStep } = collectSteps();

		await runPluginSearch("test", onStep);

		expect(steps[1]!.detail).toContain("no plugins matching");
	});

	it("reports search results with count", async () => {
		mockSearch.mockResolvedValue([
			{
				id: "org/plugin",
				repository: "https://github.com/org/plugin",
				description: "A plugin",
				tags: [],
			},
		]);
		const { steps, onStep } = collectSteps();

		await runPluginSearch("plugin", onStep);

		expect(steps[1]!.detail).toContain("1 results");
		expect(steps[1]!.detail).toContain("org/plugin");
	});

	it("reports registry unreachable when no query and no results", async () => {
		mockSearch.mockResolvedValue([]);
		const { steps, onStep } = collectSteps();

		await runPluginSearch(undefined, onStep);

		expect(steps[1]!.detail).toContain("registry empty or unreachable");
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

		await runPluginValidate("/path/to/plugin", onStep);

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

		await runPluginSync("/fake/project", false, onStep);

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

		await runPluginExport("ghost", onStep);

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

		await runPluginImport("/bad/path", false, onStep);

		expect(steps[1]!.status).toBe("error");
		expect(steps[1]!.detail).toContain("skills.json not found");
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

		await runPluginExportCodex("ghost", onStep);

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
