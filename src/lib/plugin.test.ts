import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGINS_DIR } from "../constants.js";
import type { PluginManifest } from "../types/index.js";

// ── Mock fs-extra ────────────────────────────────────────────────────────────
vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readJson: vi.fn(),
		writeJson: vi.fn(),
		readdir: vi.fn(),
		ensureDir: vi.fn(),
		mkdtemp: vi.fn().mockResolvedValue("/tmp/plugins/.tmp/install-exclusive"),
		remove: vi.fn(),
		move: vi.fn(),
		copy: vi.fn(),
		lstat: vi.fn(),
		realpath: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

vi.mock("./plugin-replacement.js", () => ({
	publishPluginReplacement: vi.fn(
		async (
			_root: string,
			_name: string,
			prepare: (stage: string) => Promise<void>,
		) => {
			await prepare("/fake/plugin-stage");
			return { success: true, cleanup: "complete" };
		},
	),
}));

// ── Mock child_process ───────────────────────────────────────────────────────
vi.mock("child_process", () => ({
	execFile: vi.fn(
		(_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
			cb(null, { stdout: "", stderr: "" });
		},
	),
}));

// ── Mock auto-wire ──────────────────────────────────────────────────────────
vi.mock("./auto-wire.js", () => ({
	autoWirePlugins: vi
		.fn()
		.mockResolvedValue({ wired: [], unwired: [], errors: [] }),
}));

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
	detectProjectPlugins,
	installPlugin,
	listInstalledPlugins,
	normalizeGitUrl,
	removePlugin,
	searchRegistry,
	syncPlugins,
	validatePlugin,
} from "./plugin.js";
import { publishPluginReplacement } from "./plugin-replacement.js";
import type { SkillScanResult } from "./skill-scanner.js";
import { scanSkillsWithCoverage } from "./skill-scanner.js";

const mockFs = vi.mocked(fs);

beforeEach(() => vi.clearAllMocks());

// ── normalizeGitUrl ──────────────────────────────────────────────────────────

describe("normalizeGitUrl", () => {
	it("converts org/repo shorthand to full URL", () => {
		expect(normalizeGitUrl("mapbox/agent-skills")).toBe(
			"https://github.com/mapbox/agent-skills.git",
		);
	});

	it("handles full GitHub URL without .git", () => {
		expect(normalizeGitUrl("https://github.com/org/repo")).toBe(
			"https://github.com/org/repo.git",
		);
	});

	it("keeps full GitHub URL with .git", () => {
		expect(normalizeGitUrl("https://github.com/org/repo.git")).toBe(
			"https://github.com/org/repo.git",
		);
	});

	it("handles github.com/org/repo without protocol", () => {
		expect(normalizeGitUrl("github.com/org/repo")).toBe(
			"https://github.com/org/repo.git",
		);
	});

	it("returns null for invalid source with 1 segment", () => {
		expect(normalizeGitUrl("just-a-name")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(normalizeGitUrl("")).toBeNull();
	});

	it("returns null for source with 3 segments", () => {
		expect(normalizeGitUrl("a/b/c")).toBeNull();
	});

	it("returns null for source with empty parts", () => {
		expect(normalizeGitUrl("/repo")).toBeNull();
		expect(normalizeGitUrl("org/")).toBeNull();
	});
});

// ── validatePlugin ───────────────────────────────────────────────────────────

describe("validatePlugin", () => {
	const validManifest: PluginManifest = {
		name: "my-plugin",
		version: "1.0.0",
		description: "A valid plugin description for testing",
		skills: ["my-skill"],
		tags: ["testing"],
	};

	it("returns invalid when plugin.json is missing", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(result.errors[0]!.message).toBe("plugin.json not found");
		expect(result.manifest).toBeNull();
	});

	it("returns invalid for malformed JSON", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockRejectedValue(new Error("parse error") as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(result.errors[0]!.message).toBe("invalid JSON");
	});

	it("validates a complete valid plugin", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue(validManifest as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
		expect(result.manifest?.name).toBe("my-plugin");
	});

	it("returns errors for missing name", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({ ...validManifest, name: "" } as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "name")).toBe(true);
	});

	it("returns errors for non-kebab-case name", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			...validManifest,
			name: "MyPlugin",
		} as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.path === "name" && e.message.includes("kebab-case"),
			),
		).toBe(true);
	});

	it("returns errors for name too short", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({ ...validManifest, name: "a" } as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.path === "name" && e.message.includes("2-60"),
			),
		).toBe(true);
	});

	it("returns errors for missing version", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			...validManifest,
			version: "",
		} as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "version")).toBe(true);
	});

	it("returns errors for non-semver version", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			...validManifest,
			version: "v1",
		} as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.path === "version" && e.message.includes("semver"),
			),
		).toBe(true);
	});

	it("returns errors for missing description", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			...validManifest,
			description: "",
		} as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "description")).toBe(true);
	});

	it("returns errors for description too short", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			...validManifest,
			description: "short",
		} as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.path === "description" && e.message.includes("10"),
			),
		).toBe(true);
	});

	it("returns errors for description too long", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			...validManifest,
			description: "x".repeat(201),
		} as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.path === "description" && e.message.includes("200"),
			),
		).toBe(true);
	});

	it("returns errors for declared skill not found on disk", async () => {
		// pathExists: true for plugin.json, true for skills/, false for skills/my-skill
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith("my-skill"))
					return false as never;
				return true as never;
			},
		);
		mockFs.readJson.mockResolvedValue(validManifest as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "skills/my-skill")).toBe(true);
	});

	it("returns errors for declared asset dir missing entirely", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith("/skills"))
					return false as never;
				return true as never;
			},
		);
		mockFs.readJson.mockResolvedValue(validManifest as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(
			result.errors.some(
				(e) => e.path === "skills" && e.message.includes("not found"),
			),
		).toBe(true);
	});

	it("returns errors for too many tags", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			...validManifest,
			tags: Array(11).fill("tag"),
		} as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(
			result.errors.some((e) => e.path === "tags" && e.message.includes("10")),
		).toBe(true);
	});

	it("returns manifest even when validation fails", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			...validManifest,
			name: "BAD",
		} as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(result.manifest).not.toBeNull();
	});

	it("skips asset dirs with empty arrays", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			...validManifest,
			skills: [],
			commands: [],
		} as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(true);
	});
});

// ── installPlugin ────────────────────────────────────────────────────────────

describe("installPlugin", () => {
	it("returns error for invalid source", async () => {
		const result = await installPlugin("bad-source");
		expect(result.success).toBe(false);
		expect(result.error).toContain("invalid source");
	});

	it("succeeds with dry-run", async () => {
		const result = await installPlugin("org/repo", { dryRun: true });
		expect(result.success).toBe(true);
		expect(result.name).toBe("repo");
	});

	it("returns error when validation fails after clone", async () => {
		// pathExists returns false for plugin.json (validation fails)
		mockFs.pathExists.mockResolvedValue(false as never);
		mockFs.ensureDir.mockResolvedValue(undefined as never);
		mockFs.remove.mockResolvedValue(undefined as never);

		const result = await installPlugin("org/repo");
		expect(result.success).toBe(false);
		expect(result.error).toContain("validation failed");
	});
});

// ── installPlugin — skillguard runtime gate (D1, D3, JD-006/JD-007) ──────────

describe("installPlugin — skillguard gate", () => {
	const mockScanner = vi.mocked(scanSkillsWithCoverage);

	function scanResult(
		skillName: string,
		verdict: SkillScanResult["verdict"],
	): SkillScanResult {
		return {
			skillPath: `/tmp/plugins/.tmp/install-1/skills/${skillName}/SKILL.md`,
			skillName,
			verdict,
			threats: [],
			summary: { total: 0, critical: 0, high: 0, moderate: 0, low: 0 },
		};
	}

	// Default happy path: validation passes, walk clean, install proceeds.
	function mockSuccessfulInstall() {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p !== "string") return false;
				// plugin.json + declared asset dir + declared skill exist →
				// validation passes; destDir (PLUGINS_DIR/my-plugin) does not.
				// tmpDir (PLUGINS_DIR/.tmp/install-*) exists → `finally` cleanup runs.
				return (
					p.includes("plugin.json") ||
					p.includes(".tmp") ||
					p.endsWith("/skills") ||
					p.endsWith("/skills/my-skill")
				);
			},
		);
		mockFs.readJson.mockResolvedValue({
			name: "my-plugin",
			version: "1.0.0",
			description: "A valid plugin description for testing",
			skills: ["my-skill"],
		} as never);
		mockFs.ensureDir.mockResolvedValue(undefined as never);
		mockFs.remove.mockResolvedValue(undefined as never);
		mockFs.move.mockResolvedValue(undefined as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);
	}

	beforeEach(() => {
		mockScanner.mockReset();
	});

	it("refuses when a declared skill blocks — nothing lands, staging removed", async () => {
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "block")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});

		const result = await installPlugin("org/repo");
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard: install refused");
		expect(result.error).toContain("1 rejected");
		expect(result.error).toContain("1 blocked");
		expect(result.error).toContain("[BLOCK]");
		expect(mockFs.move).not.toHaveBeenCalled();
		expect(publishPluginReplacement).not.toHaveBeenCalled();
		// staging cleanup still runs
		expect(mockFs.remove).toHaveBeenCalled();
	});

	it("refuses when the coverage walk could not read paths — force never lifts (JD-013)", async () => {
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "pass")],
			undeclared: [],
			symlinks: [],
			errors: ["/tmp/plugins/.tmp/install-1/locked"],
		});

		const result = await installPlugin("org/repo", { force: true });
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard: install refused");
		expect(result.error).toContain("could not be read");
		expect(result.error).toContain("locked");
		expect(mockFs.move).not.toHaveBeenCalled();
		expect(publishPluginReplacement).not.toHaveBeenCalled();
	});

	it("refuses on unscannable declared skill; force lifts unscannable", async () => {
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "unscannable")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});

		const refused = await installPlugin("org/repo");
		expect(refused.success).toBe(false);
		expect(refused.error).toContain("skillguard: install refused");
		expect(refused.error).toContain("1 unscannable");
		expect(mockFs.move).not.toHaveBeenCalled();
		expect(publishPluginReplacement).not.toHaveBeenCalled();

		mockScanner.mockClear();
		const forced = await installPlugin("org/repo", { force: true });
		expect(forced.success).toBe(true);
		expect(publishPluginReplacement).toHaveBeenCalled();
	});

	it("force does NOT lift a block verdict", async () => {
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "block")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});

		const result = await installPlugin("org/repo", { force: true });
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard: install refused");
		expect(mockFs.move).not.toHaveBeenCalled();
		expect(publishPluginReplacement).not.toHaveBeenCalled();
	});

	it("denies when the scan throws — even with force (D7)", async () => {
		mockSuccessfulInstall();
		mockScanner.mockRejectedValue(new Error("boom"));

		const result = await installPlugin("org/repo", { force: true });
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard scan failed");
		expect(mockFs.move).not.toHaveBeenCalled();
		expect(publishPluginReplacement).not.toHaveBeenCalled();
	});

	it("installs byte-identically when declared skills pass and coverage is clean", async () => {
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "pass")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});

		const result = await installPlugin("org/repo");
		expect(result.success).toBe(true);
		expect(result.name).toBe("my-plugin");
		expect(publishPluginReplacement).toHaveBeenCalled();
	});

	it("refuses an undeclared SKILL.md anywhere in the tree — force never lifts (JD-006/JD-007)", async () => {
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "pass")],
			undeclared: ["/tmp/plugins/.tmp/install-1/evil/SKILL.md"],
			symlinks: [],
			errors: [],
		});

		const result = await installPlugin("org/repo", { force: true });
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard: install refused");
		expect(result.error).toContain("undeclared");
		expect(result.error).toContain("evil/SKILL.md");
		expect(mockFs.move).not.toHaveBeenCalled();
		expect(publishPluginReplacement).not.toHaveBeenCalled();
	});

	it("refuses an ambiguous declared dir (case-colliding on-disk twin) — force never lifts (FU-5)", async () => {
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "pass")],
			undeclared: [],
			symlinks: [],
			errors: [],
			ambiguousDeclaredDirs: [
				"/tmp/plugins/.tmp/install-1/skills/Alpha",
				"/tmp/plugins/.tmp/install-1/skills/alpha",
			],
		});

		const result = await installPlugin("org/repo", { force: true });
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard: install refused");
		expect(result.error).toContain("ambiguous");
		expect(result.error).toContain("manifest-integrity");
		expect(result.error).toContain("skills/Alpha");
		expect(result.refused).toBe(true);
		expect(mockFs.move).not.toHaveBeenCalled();
		expect(publishPluginReplacement).not.toHaveBeenCalled();
	});

	it("refuses ANY symlink in the tree — manifest-integrity, force never lifts (JD-007)", async () => {
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "pass")],
			undeclared: [],
			symlinks: ["/tmp/plugins/.tmp/install-1/linked/SKILL.md"],
			errors: [],
		});

		const result = await installPlugin("org/repo", { force: true });
		expect(result.success).toBe(false);
		expect(result.error).toContain("skillguard: install refused");
		expect(result.error).toContain("symlink");
		expect(result.error).toContain("linked/SKILL.md");
		expect(mockFs.move).not.toHaveBeenCalled();
		expect(publishPluginReplacement).not.toHaveBeenCalled();
	});

	it("declared pass/warn + coverage clean → installs (JD-002 rebind, testing 14/16(e))", async () => {
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [
				scanResult("my-skill", "pass"),
				scanResult("other-skill", "warn"),
			],
			undeclared: [],
			symlinks: [],
			errors: [],
		});

		const result = await installPlugin("org/repo");
		expect(result.success).toBe(true);
		expect(publishPluginReplacement).toHaveBeenCalled();
	});

	it("does not run the gate in dry-run — scan not called (D3)", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);
		mockFs.ensureDir.mockResolvedValue(undefined as never);
		mockFs.remove.mockResolvedValue(undefined as never);

		const result = await installPlugin("org/repo", { dryRun: true });
		expect(result.success).toBe(true);
		expect(mockScanner).not.toHaveBeenCalled();
	});

	it("marks gate refusals with refused: true — the CLI exit-code signal (FU-1/R4-002)", async () => {
		// Verdict refusal (block, even with force) → refused flag set.
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "block")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});
		const verdictRefusal = await installPlugin("org/repo", { force: true });
		expect(verdictRefusal.success).toBe(false);
		expect(verdictRefusal.refused).toBe(true);

		// Manifest-integrity refusal (symlink) → refused flag set.
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "pass")],
			undeclared: [],
			symlinks: ["/tmp/plugins/.tmp/install-1/linked/SKILL.md"],
			errors: [],
		});
		const integrityRefusal = await installPlugin("org/repo", {
			force: true,
		});
		expect(integrityRefusal.success).toBe(false);
		expect(integrityRefusal.refused).toBe(true);

		// Scanner-error deny → refused flag set.
		mockScanner.mockRejectedValue(new Error("boom"));
		const scanDeny = await installPlugin("org/repo");
		expect(scanDeny.success).toBe(false);
		expect(scanDeny.refused).toBe(true);
	});

	it("leaves refused unset on success and on non-gate failures (FU-1/R4-002)", async () => {
		// Clean install → success, no refusal marker.
		mockSuccessfulInstall();
		mockScanner.mockResolvedValue({
			declared: [scanResult("my-skill", "pass")],
			undeclared: [],
			symlinks: [],
			errors: [],
		});
		const ok = await installPlugin("org/repo");
		expect(ok.success).toBe(true);
		expect(ok.refused).toBeUndefined();

		// Plain validation failure (pre-gate) → NOT a skillguard refusal.
		mockFs.readJson.mockResolvedValue({ name: "bad" } as never);
		const invalid = await installPlugin("org/repo");
		expect(invalid.success).toBe(false);
		expect(invalid.error).toContain("validation failed");
		expect(invalid.refused).toBeUndefined();
	});
});

// ── removePlugin ─────────────────────────────────────────────────────────────

describe("removePlugin", () => {
	beforeEach(() => {
		mockFs.lstat.mockReset().mockResolvedValue({
			isDirectory: () => true,
			isFile: () => true,
			isSymbolicLink: () => false,
		} as never);
		mockFs.realpath
			.mockReset()
			.mockImplementation((p) => Promise.resolve(String(p)) as never);
		mockFs.readJson.mockReset().mockResolvedValue({
			name: "my-plugin",
			manifest: { name: "my-plugin" },
		} as never);
	});
	it.each([
		"",
		".",
		"..",
		"../other",
		"my-plugin/..",
		"/tmp/plugin",
		"..\\other",
		"C:\\plugins",
		"a",
		"x".repeat(61),
	])("rejects invalid name %j before filesystem access", async (name) => {
		mockFs.pathExists.mockResolvedValue(true as never);
		const result = await removePlugin(name);
		expect(result.success).toBe(false);
		expect(result.error).toContain("invalid plugin name");
		expect(mockFs.pathExists).not.toHaveBeenCalled();
		expect(mockFs.remove).not.toHaveBeenCalled();
	});
	it.each([
		false,
		true,
	])("rejects conflicting installation identity (dryRun=%s)", async (dryRun) => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue({
			name: "other",
			manifest: { name: "my-plugin" },
		} as never);
		expect((await removePlugin("my-plugin", { dryRun })).success).toBe(false);
		expect(mockFs.remove).not.toHaveBeenCalled();
	});
	it.each([
		null,
		{},
		{ name: "my-plugin", manifest: { name: "other" } },
	])("rejects incomplete identity %j", async (metadata) => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockResolvedValue(metadata as never);
		expect((await removePlugin("my-plugin")).success).toBe(false);
		expect(mockFs.remove).not.toHaveBeenCalled();
	});
	it("rejects missing or unreadable metadata without removal", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readJson.mockRejectedValue(new Error("missing metadata"));
		expect((await removePlugin("my-plugin")).success).toBe(false);
		expect(mockFs.remove).not.toHaveBeenCalled();
	});
	it("rejects a symlinked plugin directory", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.lstat.mockResolvedValueOnce({
			isDirectory: () => false,
			isSymbolicLink: () => true,
		} as never);
		expect((await removePlugin("my-plugin")).success).toBe(false);
		expect(mockFs.remove).not.toHaveBeenCalled();
	});
	it("rejects a symlinked installation marker", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.lstat.mockResolvedValueOnce({
			isDirectory: () => true,
			isSymbolicLink: () => false,
		} as never);
		mockFs.lstat.mockResolvedValueOnce({
			isFile: () => false,
			isSymbolicLink: () => true,
		} as never);
		expect((await removePlugin("my-plugin")).success).toBe(false);
		expect(mockFs.remove).not.toHaveBeenCalled();
	});
	it("rejects a resolved destination outside the plugin root", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.realpath
			.mockResolvedValueOnce(PLUGINS_DIR as never)
			.mockResolvedValueOnce(path.dirname(PLUGINS_DIR) as never);
		expect((await removePlugin("my-plugin")).success).toBe(false);
		expect(mockFs.remove).not.toHaveBeenCalled();
	});

	it("returns error when plugin is not installed", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await removePlugin("nonexistent");
		expect(result.success).toBe(false);
		expect(result.error).toContain("not installed");
	});

	it("removes plugin directory", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.remove.mockResolvedValue(undefined as never);

		const result = await removePlugin("my-plugin");
		expect(result.success).toBe(true);
		expect(mockFs.remove).toHaveBeenCalledExactlyOnceWith(
			path.join(PLUGINS_DIR, "my-plugin"),
		);
	});

	it("skips removal in dry-run", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);

		const result = await removePlugin("my-plugin", { dryRun: true });
		expect(result.success).toBe(true);
		expect(mockFs.remove).not.toHaveBeenCalled();
	});
});

// ── listInstalledPlugins ─────────────────────────────────────────────────────

describe("listInstalledPlugins", () => {
	it("returns empty array when plugins dir does not exist", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await listInstalledPlugins();
		expect(result).toEqual([]);
	});

	it("lists installed plugins from .installed.json files", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.includes(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["my-plugin", ".tmp"] as never);
		mockFs.readJson.mockResolvedValue({
			name: "my-plugin",
			version: "1.0.0",
			installedAt: "2026-01-01T00:00:00.000Z",
			source: "org/repo",
			manifest: {
				name: "my-plugin",
				version: "1.0.0",
				description: "test plugin longer",
			},
		} as never);

		const result = await listInstalledPlugins();
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("my-plugin");
	});

	it("skips dot-prefixed directories", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readdir.mockResolvedValue([".tmp", ".git"] as never);

		const result = await listInstalledPlugins();
		expect(result).toEqual([]);
	});

	it("skips entries with corrupt .installed.json", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readdir.mockResolvedValue(["corrupt-plugin"] as never);
		mockFs.readJson.mockRejectedValue(new Error("parse error") as never);

		const result = await listInstalledPlugins();
		expect(result).toEqual([]);
	});
});

// ── searchRegistry ───────────────────────────────────────────────────────────

describe("searchRegistry", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("reports unavailable when fetch fails", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

		const result = await searchRegistry("test");
		expect(result).toEqual({ status: "unavailable" });
	});

	it("reports unavailable when response is not ok", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

		const result = await searchRegistry();
		expect(result).toEqual({ status: "unavailable" });
	});

	it("returns all plugins when no query provided", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					version: "1",
					updatedAt: "2026-01-01",
					plugins: [
						{
							id: "org/alpha",
							repository: "",
							description: "Alpha plugin",
							tags: ["ai"],
						},
						{
							id: "org/beta",
							repository: "",
							description: "Beta plugin",
							tags: ["tools"],
						},
					],
				}),
		});

		const result = await searchRegistry();
		expect(result).toMatchObject({
			status: "success",
			entries: [{ id: "org/alpha" }, { id: "org/beta" }],
		});
	});

	it("filters plugins by query matching id", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					version: "1",
					updatedAt: "2026-01-01",
					plugins: [
						{ id: "org/alpha", repository: "", description: "First", tags: [] },
						{ id: "org/beta", repository: "", description: "Second", tags: [] },
					],
				}),
		});

		const result = await searchRegistry("alpha");
		expect(result.status).toBe("success");
		if (result.status !== "success") throw new Error("expected success");
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]!.id).toBe("org/alpha");
	});

	it("filters plugins by query matching description", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					version: "1",
					updatedAt: "2026-01-01",
					plugins: [
						{
							id: "org/a",
							repository: "",
							description: "AI tools for coding",
							tags: [],
						},
						{
							id: "org/b",
							repository: "",
							description: "Database helpers",
							tags: [],
						},
					],
				}),
		});

		const result = await searchRegistry("ai tools");
		expect(result.status).toBe("success");
		if (result.status !== "success") throw new Error("expected success");
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]!.id).toBe("org/a");
	});

	it("filters plugins by query matching tags", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: () =>
				Promise.resolve({
					version: "1",
					updatedAt: "2026-01-01",
					plugins: [
						{
							id: "org/a",
							repository: "",
							description: "Something",
							tags: ["security"],
						},
						{
							id: "org/b",
							repository: "",
							description: "Other",
							tags: ["testing"],
						},
					],
				}),
		});

		const result = await searchRegistry("security");
		expect(result.status).toBe("success");
		if (result.status !== "success") throw new Error("expected success");
		expect(result.entries).toHaveLength(1);
		expect(result.entries[0]!.id).toBe("org/a");
	});
	const entry = {
		id: "org/demo",
		repository: "repo",
		description: "Demo",
		tags: ["tools"],
		stars: 3,
		updatedAt: "2026-01-01",
	};
	const registry = (plugins: unknown = [entry]) => ({
		version: "1",
		updatedAt: "2026-01-01",
		plugins,
	});
	const respond = (body: unknown) => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValue({ ok: true, json: async () => body });
	};
	it("preserves entry fields and order; empty and no-match are successful", async () => {
		respond(registry());
		expect(await searchRegistry()).toEqual({
			status: "success",
			entries: [entry],
		});
		expect(await searchRegistry("missing")).toEqual({
			status: "success",
			entries: [],
		});
		respond(registry([]));
		expect(await searchRegistry()).toEqual({ status: "success", entries: [] });
	});
	it.each([
		null,
		{},
		{ plugins: [] },
		registry({}),
		registry([null]),
		registry([{ ...entry, id: 1 }]),
		registry([{ ...entry, repository: null }]),
		registry([{ ...entry, description: 3 }]),
		registry([{ ...entry, tags: [3] }]),
		registry([{ ...entry, stars: "3" }]),
		registry([{ ...entry, updatedAt: 3 }]),
	])("rejects malformed registry shape %j", async (body) => {
		respond(body);
		expect(await searchRegistry()).toEqual({ status: "unavailable" });
	});
	it.each([
		"success",
		"http",
		"network",
		"json",
		"shape",
	])("cleans timer/listener after %s", async (terminal) => {
		vi.useFakeTimers();
		const caller = new AbortController();
		const remove = vi.spyOn(caller.signal, "removeEventListener");
		respond(terminal === "shape" ? {} : registry());
		if (terminal === "http")
			globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });
		if (terminal === "network")
			globalThis.fetch = vi
				.fn()
				.mockRejectedValue(new Error("private transport detail"));
		if (terminal === "json")
			globalThis.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: async () => {
					throw new Error("private JSON detail");
				},
			});
		expect(await searchRegistry(undefined, caller.signal)).toMatchObject({
			status: terminal === "success" ? "success" : "unavailable",
		});
		expect(vi.getTimerCount()).toBe(0);
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	});
	it.each([
		"fetch",
		"body",
	])("bounds a noncooperative %s and handles its late rejection", async (phase) => {
		vi.useFakeTimers();
		let reject!: (reason: Error) => void;
		const stalled = new Promise<never>((_resolve, fail) => {
			reject = fail;
		});
		globalThis.fetch = vi
			.fn()
			.mockImplementation(() =>
				phase === "fetch"
					? stalled
					: Promise.resolve({ ok: true, json: () => stalled }),
			);
		const caller = new AbortController();
		const remove = vi.spyOn(caller.signal, "removeEventListener");
		let settled: unknown = "pending";
		const pending = searchRegistry(undefined, caller.signal).then((result) => {
			settled = result;
		});
		await vi.advanceTimersByTimeAsync(9_999);
		expect(settled).toBe("pending");
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toEqual({ status: "unavailable" });
		expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
		reject(new Error("late private rejection"));
		await pending;
		await vi.advanceTimersByTimeAsync(0);
	});
	it("covers fetch plus body with one overall deadline", async () => {
		vi.useFakeTimers();
		const json = vi.fn(() => new Promise<never>(() => {}));
		globalThis.fetch = vi.fn().mockImplementation(
			() =>
				new Promise((resolve) => {
					setTimeout(() => resolve({ ok: true, json }), 6_000);
				}),
		);
		let settled: unknown = "pending";
		void searchRegistry().then((result) => {
			settled = result;
		});
		await vi.advanceTimersByTimeAsync(6_000);
		expect(json).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(4_000);
		expect(settled).toEqual({ status: "unavailable" });
		expect(vi.getTimerCount()).toBe(0);
	});
	it("does not fetch or allocate a timer on pre-abort", async () => {
		vi.useFakeTimers();
		const caller = new AbortController();
		caller.abort("private caller reason");
		respond(registry());
		expect(await searchRegistry(undefined, caller.signal)).toEqual({
			status: "cancelled",
		});
		expect(fetch).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
	it.each([
		"fetch",
		"body",
	])("settles caller cancellation during %s and removes resources", async (phase) => {
		vi.useFakeTimers();
		const stalled = new Promise<never>(() => {});
		globalThis.fetch = vi
			.fn()
			.mockImplementation(() =>
				phase === "fetch"
					? stalled
					: Promise.resolve({ ok: true, json: () => stalled }),
			);
		const caller = new AbortController();
		const remove = vi.spyOn(caller.signal, "removeEventListener");
		let settled: unknown = "pending";
		void searchRegistry(undefined, caller.signal).then((result) => {
			settled = result;
		});
		await vi.advanceTimersByTimeAsync(0);
		caller.abort("private caller reason");
		await vi.advanceTimersByTimeAsync(0);
		expect(settled).toEqual({ status: "cancelled" });
		expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
		expect(vi.getTimerCount()).toBe(0);
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	});
});

// ── detectProjectPlugins ────────────────────────────────────────────────

describe("detectProjectPlugins", () => {
	it("returns empty array when plugins dir does not exist", async () => {
		mockFs.pathExists.mockResolvedValue(false as never);

		const result = await detectProjectPlugins("/fake/project");
		expect(result).toEqual([]);
	});

	it("detects plugins with valid .installed.json", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["beta", "alpha"] as never);
		mockFs.readJson.mockImplementation(async (p, _opts) => {
			if (typeof p === "string" && p.includes("alpha"))
				return { name: "alpha" } as never;
			if (typeof p === "string" && p.includes("beta"))
				return { name: "beta" } as never;
			return {} as never;
		});

		const result = await detectProjectPlugins("/fake/project");
		expect(result).toEqual(["alpha", "beta"]); // sorted
	});

	it("skips dot-prefixed directories", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readdir.mockResolvedValue([".tmp", ".git"] as never);

		const result = await detectProjectPlugins("/fake/project");
		expect(result).toEqual([]);
	});

	it("skips entries with corrupt .installed.json", async () => {
		mockFs.pathExists.mockResolvedValue(true as never);
		mockFs.readdir.mockResolvedValue(["corrupt"] as never);
		mockFs.readJson.mockRejectedValue(new Error("parse error") as never);

		const result = await detectProjectPlugins("/fake/project");
		expect(result).toEqual([]);
	});

	it("skips entries without .installed.json", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return false as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["no-meta"] as never);

		const result = await detectProjectPlugins("/fake/project");
		expect(result).toEqual([]);
	});
});

// ── syncPlugins ─────────────────────────────────────────────────────────

describe("syncPlugins", () => {
	it("reports added plugins when manifest has no plugins field", async () => {
		// detectProjectPluginsFull returns full InstalledPlugin objects
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith("manifest.json"))
					return true as never;
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["alpha", "beta"] as never);
		mockFs.readJson.mockImplementation(async (p, _opts) => {
			if (typeof p === "string" && p.endsWith("manifest.json")) {
				return {
					version: "0.1.0",
					projectName: "test",
					stack: "node",
					ciProvider: "github",
					memory: "none",
					createdAt: "",
					updatedAt: "",
					modules: [],
				} as never;
			}
			if (typeof p === "string" && p.includes("alpha"))
				return {
					name: "alpha",
					version: "1.0.0",
					manifest: {
						name: "alpha",
						version: "1.0.0",
						description: "Alpha plugin test",
					},
				} as never;
			if (typeof p === "string" && p.includes("beta"))
				return {
					name: "beta",
					version: "1.0.0",
					manifest: {
						name: "beta",
						version: "1.0.0",
						description: "Beta plugin test",
					},
				} as never;
			return {} as never;
		});
		mockFs.ensureDir.mockResolvedValue(undefined as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await syncPlugins("/fake/project");
		expect(result.added).toEqual(["alpha", "beta"]);
		expect(result.removed).toEqual([]);
		expect(result.unchanged).toEqual([]);
		expect(result.wired).toBeDefined();
		expect(result.unwired).toBeDefined();
	});

	it("reports removed plugins", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith("manifest.json"))
					return true as never;
				if (
					typeof p === "string" &&
					p.includes("plugins") &&
					!p.endsWith("manifest.json")
				)
					return false as never;
				return true as never;
			},
		);
		mockFs.readJson.mockImplementation(async (p, _opts) => {
			if (typeof p === "string" && p.endsWith("manifest.json")) {
				return {
					version: "0.1.0",
					projectName: "test",
					stack: "node",
					ciProvider: "github",
					memory: "none",
					createdAt: "",
					updatedAt: "",
					modules: [],
					plugins: ["old-plugin"],
				} as never;
			}
			return {} as never;
		});
		mockFs.ensureDir.mockResolvedValue(undefined as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await syncPlugins("/fake/project");
		expect(result.added).toEqual([]);
		expect(result.removed).toEqual(["old-plugin"]);
		expect(result.unchanged).toEqual([]);
	});

	it("reports unchanged when nothing changed", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["alpha"] as never);
		mockFs.readJson.mockImplementation(async (p, _opts) => {
			if (typeof p === "string" && p.endsWith("manifest.json")) {
				return {
					version: "0.1.0",
					projectName: "test",
					stack: "node",
					ciProvider: "github",
					memory: "none",
					createdAt: "",
					updatedAt: "",
					modules: [],
					plugins: ["alpha"],
				} as never;
			}
			return {
				name: "alpha",
				version: "1.0.0",
				manifest: {
					name: "alpha",
					version: "1.0.0",
					description: "Alpha plugin test",
				},
			} as never;
		});

		const result = await syncPlugins("/fake/project");
		expect(result.added).toEqual([]);
		expect(result.removed).toEqual([]);
		expect(result.unchanged).toEqual(["alpha"]);
	});

	it("does not write manifest in dry-run mode", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["alpha"] as never);
		mockFs.readJson.mockImplementation(async (p, _opts) => {
			if (typeof p === "string" && p.endsWith("manifest.json")) {
				return {
					version: "0.1.0",
					projectName: "test",
					stack: "node",
					ciProvider: "github",
					memory: "none",
					createdAt: "",
					updatedAt: "",
					modules: [],
				} as never;
			}
			return {
				name: "alpha",
				version: "1.0.0",
				manifest: {
					name: "alpha",
					version: "1.0.0",
					description: "Alpha plugin test",
				},
			} as never;
		});

		const result = await syncPlugins("/fake/project", { dryRun: true });
		expect(result.added).toEqual(["alpha"]);
	});

	it("creates manifest when it does not exist", async () => {
		mockFs.pathExists.mockImplementation(
			async (p: string | URL, _opts?: unknown) => {
				if (typeof p === "string" && p.endsWith("manifest.json"))
					return false as never;
				if (typeof p === "string" && p.endsWith(".installed.json"))
					return true as never;
				return true as never;
			},
		);
		mockFs.readdir.mockResolvedValue(["alpha"] as never);
		mockFs.readJson.mockImplementation(async (p, _opts) => {
			if (typeof p === "string" && p.includes("alpha"))
				return {
					name: "alpha",
					version: "1.0.0",
					manifest: {
						name: "alpha",
						version: "1.0.0",
						description: "Alpha plugin test",
					},
				} as never;
			return {} as never;
		});
		mockFs.ensureDir.mockResolvedValue(undefined as never);
		mockFs.writeJson.mockResolvedValue(undefined as never);

		const result = await syncPlugins("/fake/project");
		expect(result.added).toEqual(["alpha"]);
	});
});
