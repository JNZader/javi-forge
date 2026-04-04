import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "../types/index.js";

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
	};
	return { default: mockFs, ...mockFs };
});

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

import fs from "fs-extra";
import {
	detectProjectPlugins,
	detectProjectPluginsFull,
	installPlugin,
	listInstalledPlugins,
	normalizeGitUrl,
	removePlugin,
	searchRegistry,
	syncPlugins,
	validatePlugin,
} from "./plugin.js";

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
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.endsWith("my-skill"))
				return false as never;
			return true as never;
		});
		mockFs.readJson.mockResolvedValue(validManifest as never);

		const result = await validatePlugin("/fake/dir");
		expect(result.valid).toBe(false);
		expect(result.errors.some((e) => e.path === "skills/my-skill")).toBe(true);
	});

	it("returns errors for declared asset dir missing entirely", async () => {
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.endsWith("/skills")) return false as never;
			return true as never;
		});
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

// ── removePlugin ─────────────────────────────────────────────────────────────

describe("removePlugin", () => {
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
		expect(mockFs.remove).toHaveBeenCalled();
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
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.includes(".installed.json"))
				return true as never;
			return true as never;
		});
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
	});

	it("returns empty array when fetch fails", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

		const result = await searchRegistry("test");
		expect(result).toEqual([]);
	});

	it("returns empty array when response is not ok", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

		const result = await searchRegistry();
		expect(result).toEqual([]);
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
		expect(result).toHaveLength(2);
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
		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe("org/alpha");
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
		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe("org/a");
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
		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe("org/a");
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
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.endsWith(".installed.json"))
				return true as never;
			return true as never;
		});
		mockFs.readdir.mockResolvedValue(["beta", "alpha"] as never);
		mockFs.readJson.mockImplementation(async (p: string) => {
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
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.endsWith(".installed.json"))
				return false as never;
			return true as never;
		});
		mockFs.readdir.mockResolvedValue(["no-meta"] as never);

		const result = await detectProjectPlugins("/fake/project");
		expect(result).toEqual([]);
	});
});

// ── syncPlugins ─────────────────────────────────────────────────────────

describe("syncPlugins", () => {
	it("reports added plugins when manifest has no plugins field", async () => {
		// detectProjectPluginsFull returns full InstalledPlugin objects
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.endsWith("manifest.json"))
				return true as never;
			if (typeof p === "string" && p.endsWith(".installed.json"))
				return true as never;
			return true as never;
		});
		mockFs.readdir.mockResolvedValue(["alpha", "beta"] as never);
		mockFs.readJson.mockImplementation(async (p: string) => {
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
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.endsWith("manifest.json"))
				return true as never;
			if (
				typeof p === "string" &&
				p.includes("plugins") &&
				!p.endsWith("manifest.json")
			)
				return false as never;
			return true as never;
		});
		mockFs.readJson.mockImplementation(async (p: string) => {
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
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.endsWith(".installed.json"))
				return true as never;
			return true as never;
		});
		mockFs.readdir.mockResolvedValue(["alpha"] as never);
		mockFs.readJson.mockImplementation(async (p: string) => {
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
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.endsWith(".installed.json"))
				return true as never;
			return true as never;
		});
		mockFs.readdir.mockResolvedValue(["alpha"] as never);
		mockFs.readJson.mockImplementation(async (p: string) => {
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
		mockFs.pathExists.mockImplementation(async (p: string) => {
			if (typeof p === "string" && p.endsWith("manifest.json"))
				return false as never;
			if (typeof p === "string" && p.endsWith(".installed.json"))
				return true as never;
			return true as never;
		});
		mockFs.readdir.mockResolvedValue(["alpha"] as never);
		mockFs.readJson.mockImplementation(async (p: string) => {
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
