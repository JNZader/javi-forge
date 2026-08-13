import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	AgentSkillsManifest,
	InstalledPlugin,
	PluginManifest,
} from "../types/index.js";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readJson: vi.fn(),
		writeJson: vi.fn(),
		readdir: vi.fn(),
		ensureDir: vi.fn(),
		remove: vi.fn(),
		move: vi.fn(),
		copy: vi.fn(),
		// Gate containment uses realpath; identity default keeps declared
		// `skills/<name>` paths contained unless a test overrides it.
		realpath: vi.fn(async (p: string) => p),
	};
	return { default: mockFs, ...mockFs };
});

// ── Mock skill-scanner (importOriginal: real exports kept, walk doubled) ─────
vi.mock("./skill-scanner.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./skill-scanner.js")>();
	return {
		...actual,
		scanSkillsWithCoverage: vi.fn().mockResolvedValue({
			declared: [],
			undeclared: [],
			symlinks: [],
			errors: [],
		}),
	};
});

import fs from "fs-extra";
import {
	agentSkillsToPlugin,
	aggregatePluginsToSkillsJson,
	exportPluginAsAgentSkills,
	generateAgentSkillsManifest,
	generateGlobalSkillsJson,
	generateProjectSkillsJson,
	importAgentSkillsPackage,
	pluginToAgentSkills,
} from "./agent-skills.js";
import type { SkillScanResult } from "./skill-scanner.js";
import { scanSkillsWithCoverage } from "./skill-scanner.js";

const mockFs = vi.mocked(fs);

beforeEach(() => vi.clearAllMocks());

// ── pluginToAgentSkills ─────────────────────────────────────────────────────

describe("pluginToAgentSkills", () => {
	const pluginManifest: PluginManifest = {
		name: "my-plugin",
		version: "1.0.0",
		description: "A test plugin for conversion",
		skills: ["react-pro", "testing-utils"],
		tags: ["frontend"],
	};

	it("converts name, version, description", () => {
		const result = pluginToAgentSkills(pluginManifest);
		expect(result.name).toBe("my-plugin");
		expect(result.version).toBe("1.0.0");
		expect(result.description).toBe("A test plugin for conversion");
	});

	it("maps skills array to AgentSkillEntry objects", () => {
		const result = pluginToAgentSkills(pluginManifest);
		expect(result.skills).toHaveLength(2);
		expect(result.skills[0]).toEqual({
			name: "react-pro",
			description: "react-pro skill from my-plugin",
			path: "skills/react-pro",
		});
		expect(result.skills[1]).toEqual({
			name: "testing-utils",
			description: "testing-utils skill from my-plugin",
			path: "skills/testing-utils",
		});
	});

	it("handles plugin with no skills", () => {
		const noSkills: PluginManifest = { ...pluginManifest, skills: undefined };
		const result = pluginToAgentSkills(noSkills);
		expect(result.skills).toEqual([]);
	});

	it("includes forge_source in metadata when source is provided", () => {
		const result = pluginToAgentSkills(pluginManifest, "org/repo");
		expect(result.metadata).toEqual({ forge_source: "org/repo" });
	});

	it("omits metadata when no source is provided", () => {
		const result = pluginToAgentSkills(pluginManifest);
		expect(result.metadata).toBeUndefined();
	});
});

// ── agentSkillsToPlugin ─────────────────────────────────────────────────────

describe("agentSkillsToPlugin", () => {
	const agentManifest: AgentSkillsManifest = {
		name: "cool-skill",
		version: "2.0.0",
		description: "An agent skills package for testing",
		skills: [
			{ name: "alpha", description: "Alpha skill", path: "skills/alpha" },
			{ name: "beta", description: "Beta skill", path: "skills/beta" },
		],
	};

	it("converts name, version, description", () => {
		const result = agentSkillsToPlugin(agentManifest);
		expect(result.name).toBe("cool-skill");
		expect(result.version).toBe("2.0.0");
		expect(result.description).toBe("An agent skills package for testing");
	});

	it("extracts skill names into skills array", () => {
		const result = agentSkillsToPlugin(agentManifest);
		expect(result.skills).toEqual(["alpha", "beta"]);
	});

	it("adds agent-skills-import tag", () => {
		const result = agentSkillsToPlugin(agentManifest);
		expect(result.tags).toEqual(["agent-skills-import"]);
	});
});

// ── Round-trip conversion ───────────────────────────────────────────────────

describe("round-trip conversion", () => {
	it("preserves core fields through plugin → agent-skills → plugin", () => {
		const original: PluginManifest = {
			name: "my-plugin",
			version: "1.0.0",
			description: "A test plugin for round-trip",
			skills: ["skill-a", "skill-b"],
		};

		const agentSkills = pluginToAgentSkills(original);
		const backToPlugin = agentSkillsToPlugin(agentSkills);

		expect(backToPlugin.name).toBe(original.name);
		expect(backToPlugin.version).toBe(original.version);
		expect(backToPlugin.description).toBe(original.description);
		expect(backToPlugin.skills).toEqual(original.skills);
	});
});

// ── generateAgentSkillsManifest ─────────────────────────────────────────────

describe("generateAgentSkillsManifest", () => {
	it("returns error when plugin.json not found", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await generateAgentSkillsManifest("/fake/plugin");
		expect(result.success).toBe(false);
		expect(result.error).toBe("plugin.json not found");
	});

	it("returns error when plugin.json is invalid", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockRejectedValue(new Error("parse error") as never);

		const result = await generateAgentSkillsManifest("/fake/plugin");
		expect(result.success).toBe(false);
		expect(result.error).toBe("invalid plugin.json");
	});

	it("writes skills.json on success", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name: "my-plugin",
			version: "1.0.0",
			description: "A valid plugin description",
			skills: ["skill-a"],
		} as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await generateAgentSkillsManifest(
			"/fake/plugin",
			"org/repo",
		);
		expect(result.success).toBe(true);
		expect(result.path).toContain("skills.json");
		expect(mockFs.writeJson).toHaveBeenCalledWith(
			expect.stringContaining("skills.json"),
			expect.objectContaining({
				name: "my-plugin",
				version: "1.0.0",
				skills: [
					{
						name: "skill-a",
						description: "skill-a skill from my-plugin",
						path: "skills/skill-a",
					},
				],
				metadata: { forge_source: "org/repo" },
			}),
			{ spaces: 2 },
		);
	});
});

// ── exportPluginAsAgentSkills ───────────────────────────────────────────────

describe("exportPluginAsAgentSkills", () => {
	it("returns error when plugin is not installed", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await exportPluginAsAgentSkills("ghost");
		expect(result.success).toBe(false);
		expect(result.error).toContain("not installed");
	});

	it("generates skills.json for installed plugin", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name: "my-plugin",
			version: "1.0.0",
			description: "A valid plugin description",
			skills: [],
		} as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await exportPluginAsAgentSkills("my-plugin");
		expect(result.success).toBe(true);
		expect(result.path).toContain("skills.json");
	});
});

// ── importAgentSkillsPackage ────────────────────────────────────────────────

describe("importAgentSkillsPackage", () => {
	it("returns error when skills.json not found", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await importAgentSkillsPackage("/fake/source");
		expect(result.success).toBe(false);
		expect(result.error).toBe("skills.json not found");
	});

	it("returns error when skills.json is invalid JSON", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockRejectedValue(new Error("parse error") as never);

		const result = await importAgentSkillsPackage("/fake/source");
		expect(result.success).toBe(false);
		expect(result.error).toBe("invalid skills.json");
	});

	it("returns error when skills.json missing required fields", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({ name: "only-name" } as never);

		const result = await importAgentSkillsPackage("/fake/source");
		expect(result.success).toBe(false);
		expect(result.error).toContain("missing required fields");
	});

	it("succeeds with dry-run without writing files", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name: "imported-skill",
			version: "1.0.0",
			description: "An imported agent skills package",
			skills: [{ name: "alpha", description: "Alpha", path: "skills/alpha" }],
		} as never);

		const result = await importAgentSkillsPackage("/fake/source", {
			dryRun: true,
		});
		expect(result.success).toBe(true);
		expect(result.name).toBe("imported-skill");
		expect(mockFs.copy).not.toHaveBeenCalled();
		expect(mockFs.writeJson).not.toHaveBeenCalled();
	});

	it("copies directory and creates plugin.json + .installed.json", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				// skills.json exists, dest dir does not
				if (typeof p === "string" && p.includes("skills.json"))
					return true as never;
				return false as never;
			},
		);
		mockFs.readJson.mockResolvedValue({
			name: "imported-skill",
			version: "1.0.0",
			description: "An imported agent skills package",
			skills: [{ name: "alpha", description: "Alpha", path: "skills/alpha" }],
		} as never);
		mockFs.copy.mockResolvedValue(undefined as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await importAgentSkillsPackage("/fake/source");
		expect(result.success).toBe(true);
		expect(result.name).toBe("imported-skill");
		expect(mockFs.copy).toHaveBeenCalled();
		// Should write plugin.json and .installed.json
		expect(mockFs.writeJson).toHaveBeenCalledTimes(2);
	});

	it("refuses empty skills array at validation — nothing removed or copied (JD-006)", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name: "imported-skill",
			version: "1.0.0",
			description: "An imported agent skills package",
			skills: [],
		} as never);
		mockFs.remove.mockResolvedValue(undefined as never);
		mockFs.copy.mockResolvedValue(undefined as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await importAgentSkillsPackage("/fake/source");
		expect(result.success).toBe(false);
		expect(result.error).toContain("skills");
		// existing install preserved — neither remove nor copy ran
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("refuses missing skills array at validation (JD-006)", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name: "imported-skill",
			version: "1.0.0",
			description: "An imported agent skills package",
		} as never);

		const result = await importAgentSkillsPackage("/fake/source");
		expect(result.success).toBe(false);
		expect(result.error).toContain("skills");
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	// ── Manifest `name` validation (R1-002) ────────────────────────────────
	// `name` determines the import destination (`PLUGINS_DIR/<name>`) and feeds
	// `fs.remove` + `fs.copy` — a hostile name (traversal, absolute, separator-
	// bearing, `.`/`..`-shaped) performs arbitrary-path delete/copy outside
	// PLUGINS_DIR. `pathExists` returns true for EVERYTHING below (skills.json
	// AND the would-be destDir), so if the validation ever regressed, `remove`
	// would genuinely fire and the test fails — the refusal is proven to happen
	// BEFORE any destructive step, preserving an existing install.

	it.each([
		["../../escape", "path traversal"],
		["/abs/path", "absolute path"],
		["a/b", "forward-slash separator"],
		["a\\b", "backslash separator"],
		["..", "dot-dot"],
		[".", "dot"],
		["   ", "whitespace-only"],
	])("refuses hostile manifest name %s (%s) BEFORE any remove/copy (R1-002)", async (name) => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name,
			version: "1.0.0",
			description: "An imported agent skills package",
			skills: [{ name: "alpha", description: "Alpha", path: "skills/alpha" }],
		} as never);
		mockFs.remove.mockResolvedValue(undefined as never);
		mockFs.copy.mockResolvedValue(undefined as never);

		const result = await importAgentSkillsPackage("/fake/source");

		expect(result.success).toBe(false);
		// Gate-style manifest-integrity refusal, not a generic error.
		expect(result.error).toContain("invalid manifest name");
		expect(result.error).toContain("manifest-integrity");
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("refuses a non-string manifest name (a number) cleanly — no TypeError, no remove/copy (R1-F2-N2)", async () => {
		// `{"name": 123}` is truthy and passes the required-fields check, then
		// crashed with a TypeError on `.trim()` (surfacing as a UI "Fatal
		// error") instead of the clean manifest-integrity refusal. The typeof
		// guard must refuse with the same `invalid manifest name` message and
		// never reach remove/copy.
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name: 123,
			version: "1.0.0",
			description: "An imported agent skills package",
			skills: [{ name: "alpha", description: "Alpha", path: "skills/alpha" }],
		} as never);
		mockFs.remove.mockResolvedValue(undefined as never);
		mockFs.copy.mockResolvedValue(undefined as never);

		const result = await importAgentSkillsPackage("/fake/source");

		expect(result.success).toBe(false);
		// Gate-style manifest-integrity refusal, not a thrown TypeError.
		expect(result.error).toContain("invalid manifest name");
		expect(result.error).toContain("manifest-integrity");
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});
});

// ── importAgentSkillsPackage — skillguard gate (D8, JD-001/JD-006/JD-007) ────

describe("importAgentSkillsPackage — skillguard gate", () => {
	const mockScanner = vi.mocked(scanSkillsWithCoverage);

	const validManifest = {
		name: "imported-skill",
		version: "1.0.0",
		description: "An imported agent skills package",
		skills: [{ name: "alpha", description: "Alpha", path: "skills/alpha" }],
	};

	function scanResult(
		skillName: string,
		verdict: SkillScanResult["verdict"],
	): SkillScanResult {
		return {
			skillPath: `/fake/source/skills/${skillName}/SKILL.md`,
			skillName,
			verdict,
			threats: [],
			summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0 },
		};
	}

	function mockSuccessfulImport() {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				// skills.json exists; dest dir does not
				if (typeof p === "string" && p.includes("skills.json")) return true;
				return false;
			},
		);
		mockFs.remove.mockResolvedValue(undefined as never);
		mockFs.copy.mockResolvedValue(undefined as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);
	}

	beforeEach(() => {
		mockScanner.mockReset();
	});

	it("refuses a block-scanning source BEFORE fs.remove/fs.copy — existing install preserved", async () => {
		mockSuccessfulImport();
		mockFs.readJson.mockResolvedValue(validManifest as never);
		mockScanner.mockResolvedValue({
			declared: [scanResult("alpha", "block")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});

		const result = await importAgentSkillsPackage("/fake/source");
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard: install refused");
		expect(result.error).toContain("1 rejected");
		expect(result.error).toContain("[BLOCK]");
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("preserves an EXISTING install on refused import — pathExists(destDir) true, remove+copy never called (JD-103)", async () => {
		// Every other refusal test has pathExists(destDir) false, which makes
		// `remove` vacuously uncalled. Here a prior install genuinely EXISTS at
		// PLUGINS_DIR/imported-skill: if the gate ever regressed to run after
		// the remove step, BOTH remove and copy would fire.
		mockFs.pathExists.mockImplementation(async (p: string | URL) => {
			if (
				typeof p === "string" &&
				(p.includes("skills.json") || p.includes("imported-skill"))
			) {
				return true;
			}
			return false;
		});
		mockFs.remove.mockResolvedValue(undefined as never);
		mockFs.copy.mockResolvedValue(undefined as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);
		mockFs.readJson.mockResolvedValue(validManifest as never);
		mockScanner.mockResolvedValue({
			declared: [scanResult("alpha", "block")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});

		const result = await importAgentSkillsPackage("/fake/source");
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard: install refused");
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("refuses undeclared SKILL.md anywhere in the tree — force never lifts (JD-006/JD-007)", async () => {
		mockSuccessfulImport();
		mockFs.readJson.mockResolvedValue(validManifest as never);
		mockScanner.mockResolvedValue({
			declared: [scanResult("alpha", "pass")],
			undeclared: ["/fake/source/node_modules/evil/SKILL.md"],
			symlinks: [],
			errors: [],
		});

		const result = await importAgentSkillsPackage("/fake/source", {
			force: true,
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("undeclared");
		expect(result.error).toContain("node_modules/evil/SKILL.md");
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("refuses ANY symlink — manifest-integrity, force never lifts (JD-007)", async () => {
		mockSuccessfulImport();
		mockFs.readJson.mockResolvedValue(validManifest as never);
		mockScanner.mockResolvedValue({
			declared: [scanResult("alpha", "pass")],
			undeclared: [],
			symlinks: ["/fake/source/skills/alpha/SKILL.md"],
			errors: [],
		});

		const result = await importAgentSkillsPackage("/fake/source", {
			force: true,
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("symlink");
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("refuses when the coverage walk could not read paths — force never lifts (JD-013)", async () => {
		mockSuccessfulImport();
		mockFs.readJson.mockResolvedValue(validManifest as never);
		mockScanner.mockResolvedValue({
			declared: [scanResult("alpha", "pass")],
			undeclared: [],
			symlinks: [],
			errors: ["/fake/source/locked"],
		});

		const result = await importAgentSkillsPackage("/fake/source", {
			force: true,
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard: install refused");
		expect(result.error).toContain("could not be read");
		expect(result.error).toContain("locked");
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("allows unscannable with force, refuses block with force", async () => {
		mockSuccessfulImport();
		mockFs.readJson.mockResolvedValue(validManifest as never);

		// unscannable + force → proceeds
		mockScanner.mockResolvedValue({
			declared: [scanResult("alpha", "unscannable")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});
		const forced = await importAgentSkillsPackage("/fake/source", {
			force: true,
		});
		expect(forced.success).toBe(true);
		expect(mockFs.copy).toHaveBeenCalled();

		// block + force → still refused
		mockFs.copy.mockClear();
		mockScanner.mockResolvedValue({
			declared: [scanResult("alpha", "block")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});
		const refused = await importAgentSkillsPackage("/fake/source", {
			force: true,
		});
		expect(refused.success).toBe(false);
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("denies when the scan throws — even with force (D7)", async () => {
		mockSuccessfulImport();
		mockFs.readJson.mockResolvedValue(validManifest as never);
		mockScanner.mockRejectedValue(new Error("boom"));

		const result = await importAgentSkillsPackage("/fake/source", {
			force: true,
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard scan failed");
		expect(mockFs.remove).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	// ── Import-entrypoint containment (JD-012) ─────────────────────────────
	// skillPathContained's lexical branch has ZERO direct tests at the import
	// entrypoint: a declared `path` that escapes the package root must refuse
	// BEFORE any scan or copy — no read outside the staged clone (JD-003).

	it.each([
		["../../outside"],
		["/absolute/outside"],
	])("refuses a declared path escaping the package root — %s (JD-012)", async (escPath) => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name: "imported-skill",
			version: "1.0.0",
			description: "An imported agent skills package",
			skills: [{ name: "alpha", description: "Alpha", path: escPath }],
		} as never);

		const result = await importAgentSkillsPackage("/fake/source");

		expect(result.success).toBe(false);
		expect(result.error).toContain("escapes");
		// The gate never ran and nothing was copied: refusal happens in
		// validation, before the coverage walk (no read outside the staged
		// clone, JD-003) and before any placement.
		expect(mockScanner).not.toHaveBeenCalled();
		expect(mockFs.copy).not.toHaveBeenCalled();
	});

	it("refuses a declared path whose realpath escapes the package root — realpath branch (JD-012)", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name: "imported-skill",
			version: "1.0.0",
			description: "An imported agent skills package",
			skills: [{ name: "alpha", description: "Alpha", path: "skills/alpha" }],
		} as never);
		// Lexically contained, but the realpath lands OUTSIDE the package root
		// (an in-tree symlink would do this in real life) — the realpath
		// containment branch must catch it. The default realpath mock is
		// identity, which would never exercise this branch.
		mockFs.realpath.mockImplementation((async (p: string) => {
			if (typeof p === "string" && p.includes("skills/alpha"))
				return "/outside/alpha";
			return p;
		}) as never);
		try {
			const result = await importAgentSkillsPackage("/fake/source");

			expect(result.success).toBe(false);
			expect(result.error).toContain("escapes");
			expect(result.error).toContain("realpath");
			expect(mockScanner).not.toHaveBeenCalled();
			expect(mockFs.copy).not.toHaveBeenCalled();
		} finally {
			mockFs.realpath.mockImplementation((async (p: string) => p) as never);
		}
	});

	it("does not run the gate in dry-run — scan not called (D8)", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue(validManifest as never);

		const result = await importAgentSkillsPackage("/fake/source", {
			dryRun: true,
		});
		expect(result.success).toBe(true);
		expect(mockScanner).not.toHaveBeenCalled();
	});

	it("installs byte-identically when declared skills pass and coverage is clean", async () => {
		mockSuccessfulImport();
		mockFs.readJson.mockResolvedValue(validManifest as never);
		mockScanner.mockResolvedValue({
			declared: [scanResult("alpha", "pass")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});

		const result = await importAgentSkillsPackage("/fake/source");
		expect(result.success).toBe(true);
		expect(mockFs.copy).toHaveBeenCalledWith(
			"/fake/source",
			expect.any(String),
		);
	});
});

// ── aggregatePluginsToSkillsJson ──────────────────────────────────────────

describe("aggregatePluginsToSkillsJson", () => {
	const makePlugin = (
		name: string,
		skills: string[] = [],
		repo?: string,
	): InstalledPlugin => ({
		name,
		version: "1.0.0",
		installedAt: "2026-01-01T00:00:00.000Z",
		source: `org/${name}`,
		manifest: {
			name,
			version: "1.0.0",
			description: `${name} plugin description`,
			skills,
			...(repo ? { repository: repo } : {}),
		},
	});

	it("aggregates skills from multiple plugins into a single manifest", () => {
		const plugins = [
			makePlugin("alpha", ["react-pro", "testing-utils"]),
			makePlugin("beta", ["deploy-helper"]),
		];

		const result = aggregatePluginsToSkillsJson(plugins);

		expect(result.name).toBe("javi-forge-registry");
		expect(result.version).toBe("1.0.0");
		expect(result.skills).toHaveLength(3);
		expect(result.sources).toHaveLength(2);
	});

	it("namespaces skills with plugin name", () => {
		const plugins = [makePlugin("alpha", ["my-skill"])];
		const result = aggregatePluginsToSkillsJson(plugins);

		expect(result.skills[0]).toEqual({
			name: "alpha/my-skill",
			description: "my-skill skill from alpha plugin",
			path: "plugins/alpha/skills/my-skill",
		});
	});

	it("uses custom registry name and version", () => {
		const result = aggregatePluginsToSkillsJson([], "my-project", "2.0.0");
		expect(result.name).toBe("my-project");
		expect(result.version).toBe("2.0.0");
	});

	it("includes repository in sources when available", () => {
		const plugins = [makePlugin("alpha", [], "https://github.com/org/alpha")];
		const result = aggregatePluginsToSkillsJson(plugins);

		expect(result.sources[0]).toEqual({
			plugin: "alpha",
			version: "1.0.0",
			repository: "https://github.com/org/alpha",
		});
	});

	it("omits repository from sources when not available", () => {
		const plugins = [makePlugin("alpha", [])];
		const result = aggregatePluginsToSkillsJson(plugins);

		expect(result.sources[0]).toEqual({
			plugin: "alpha",
			version: "1.0.0",
		});
	});

	it("handles plugins with no manifest gracefully", () => {
		const plugins: InstalledPlugin[] = [
			{
				name: "broken",
				version: "1.0.0",
				installedAt: "",
				source: "",
				manifest: undefined as unknown as PluginManifest,
			},
		];

		const result = aggregatePluginsToSkillsJson(plugins);
		expect(result.skills).toHaveLength(0);
		expect(result.sources).toHaveLength(0);
	});

	it("handles plugins with no skills array", () => {
		const plugins: InstalledPlugin[] = [
			{
				name: "no-skills",
				version: "1.0.0",
				installedAt: "",
				source: "",
				manifest: {
					name: "no-skills",
					version: "1.0.0",
					description: "Has no skills defined",
				},
			},
		];

		const result = aggregatePluginsToSkillsJson(plugins);
		expect(result.skills).toHaveLength(0);
		expect(result.sources).toHaveLength(1);
	});

	it("returns correct description with plugin count", () => {
		const plugins = [
			makePlugin("a", ["s1"]),
			makePlugin("b", ["s2"]),
			makePlugin("c", ["s3"]),
		];
		const result = aggregatePluginsToSkillsJson(plugins);
		expect(result.description).toBe(
			"Aggregated skills from 3 javi-forge plugin(s)",
		);
	});
});

// ── generateProjectSkillsJson ─────────────────────────────────────────────

describe("generateProjectSkillsJson", () => {
	it("returns error when plugins directory does not exist", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await generateProjectSkillsJson("/fake/project");
		expect(result.success).toBe(false);
		expect(result.error).toBe("no plugins directory found");
		expect(result.skillCount).toBe(0);
		expect(result.pluginCount).toBe(0);
	});

	it("returns error when no installed plugins found", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.includes(".installed.json"))
					return false as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["empty-dir"] as never);

		const result = await generateProjectSkillsJson("/fake/project");
		expect(result.success).toBe(false);
		expect(result.error).toBe("no installed plugins found");
	});

	it("generates skills.json from installed plugins", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["alpha", "beta"] as never);
		mockFs.readJson.mockImplementation(async (p, _opts) => {
			if (typeof p === "string" && p.includes("alpha")) {
				return {
					name: "alpha",
					version: "1.0.0",
					manifest: {
						name: "alpha",
						version: "1.0.0",
						description: "Alpha test",
						skills: ["skill-a"],
					},
				} as never;
			}
			if (typeof p === "string" && p.includes("beta")) {
				return {
					name: "beta",
					version: "2.0.0",
					manifest: {
						name: "beta",
						version: "2.0.0",
						description: "Beta test",
						skills: ["skill-b", "skill-c"],
					},
				} as never;
			}
			return {} as never;
		});
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await generateProjectSkillsJson("/fake/project");
		expect(result.success).toBe(true);
		expect(result.skillCount).toBe(3);
		expect(result.pluginCount).toBe(2);
		expect(result.path).toContain("skills.json");
		expect(mockFs.writeJson).toHaveBeenCalledWith(
			expect.stringContaining("skills.json"),
			expect.objectContaining({
				skills: expect.arrayContaining([
					expect.objectContaining({ name: "alpha/skill-a" }),
					expect.objectContaining({ name: "beta/skill-b" }),
					expect.objectContaining({ name: "beta/skill-c" }),
				]),
				sources: expect.arrayContaining([
					expect.objectContaining({ plugin: "alpha" }),
					expect.objectContaining({ plugin: "beta" }),
				]),
			}),
			{ spaces: 2 },
		);
	});

	it("does not write file in dry-run mode", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["alpha"] as never);
		mockFs.readJson.mockResolvedValue({
			name: "alpha",
			version: "1.0.0",
			manifest: {
				name: "alpha",
				version: "1.0.0",
				description: "Alpha test",
				skills: ["s1"],
			},
		} as never);

		const result = await generateProjectSkillsJson("/fake/project", {
			dryRun: true,
		});
		expect(result.success).toBe(true);
		expect(result.skillCount).toBe(1);
		expect(mockFs.writeJson).not.toHaveBeenCalled();
	});

	it("uses custom registry name", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["alpha"] as never);
		mockFs.readJson.mockResolvedValue({
			name: "alpha",
			version: "1.0.0",
			manifest: {
				name: "alpha",
				version: "1.0.0",
				description: "Alpha test",
				skills: [],
			},
		} as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await generateProjectSkillsJson("/fake/project", {
			registryName: "my-custom-registry",
		});
		expect(result.success).toBe(true);
		expect(mockFs.writeJson).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ name: "my-custom-registry" }),
			{ spaces: 2 },
		);
	});

	it("skips dot-prefixed directories", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readdir.mockResolvedValue([".tmp", ".git"] as never);

		const result = await generateProjectSkillsJson("/fake/project");
		expect(result.success).toBe(false);
		expect(result.error).toBe("no installed plugins found");
	});

	it("skips corrupt .installed.json entries", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["corrupt"] as never);
		mockFs.readJson.mockRejectedValue(new Error("parse error") as never);

		const result = await generateProjectSkillsJson("/fake/project");
		expect(result.success).toBe(false);
		expect(result.error).toBe("no installed plugins found");
	});
});

// ── generateGlobalSkillsJson ──────────────────────────────────────────────

describe("generateGlobalSkillsJson", () => {
	it("returns error when plugins directory does not exist", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await generateGlobalSkillsJson();
		expect(result.success).toBe(false);
		expect(result.error).toBe("no plugins directory found");
	});

	it("returns error when no plugins found", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return false as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["empty"] as never);

		const result = await generateGlobalSkillsJson();
		expect(result.success).toBe(false);
		expect(result.error).toBe("no installed plugins found");
	});

	it("generates global skills.json", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["my-plugin"] as never);
		mockFs.readJson.mockResolvedValue({
			name: "my-plugin",
			version: "1.0.0",
			manifest: {
				name: "my-plugin",
				version: "1.0.0",
				description: "My plugin test",
				skills: ["sk1", "sk2"],
			},
		} as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await generateGlobalSkillsJson();
		expect(result.success).toBe(true);
		expect(result.skillCount).toBe(2);
		expect(result.pluginCount).toBe(1);
		expect(result.path).toContain("skills.json");
	});

	it("does not write file in dry-run mode", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["my-plugin"] as never);
		mockFs.readJson.mockResolvedValue({
			name: "my-plugin",
			version: "1.0.0",
			manifest: {
				name: "my-plugin",
				version: "1.0.0",
				description: "My plugin test",
				skills: ["sk1"],
			},
		} as never);

		const result = await generateGlobalSkillsJson({ dryRun: true });
		expect(result.success).toBe(true);
		expect(mockFs.writeJson).not.toHaveBeenCalled();
	});
});
