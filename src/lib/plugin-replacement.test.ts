import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLUGINS_DIR } from "../constants.js";
import { importAgentSkillsPackage } from "./agent-skills.js";
import { installPlugin, listInstalledPlugins } from "./plugin.js";
import { scanSkillsWithCoverage } from "./skill-scanner.js";

const fixture = vi.hoisted(() => ({ plugins: "", source: "" }));
vi.mock("../constants.js", async (original) => ({
	...(await original<typeof import("../constants.js")>()),
	get PLUGINS_DIR() {
		return fixture.plugins;
	},
}));
vi.mock("./exec.js", () => ({
	execFileAsync: vi.fn(async (_command: string, args: string[]) => {
		await fs.copy(fixture.source, args.at(-1) as string);
		return { stdout: "", stderr: "" };
	}),
}));
vi.mock("./skill-scanner.js", async (original) => ({
	...(await original<typeof import("./skill-scanner.js")>()),
	scanSkillsWithCoverage: vi.fn(),
}));
let root: string;
let destination: string;
const name = "demo-plugin";
const oldMetadata = { name, manifest: { name }, version: "1.0.0" };
beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-replacement-"));
	fixture.plugins = path.join(root, "plugins");
	fixture.source = path.join(root, "source");
	expect(PLUGINS_DIR).toBe(fixture.plugins); // Never call a real home installation.
	destination = path.join(fixture.plugins, name);
	await fs.ensureDir(destination);
	await fs.writeFile(path.join(destination, "payload.txt"), "OLD");
	await fs.writeJson(path.join(destination, ".installed.json"), oldMetadata);
	await fs.ensureDir(path.join(fixture.source, "skills", "alpha"));
	await fs.writeFile(
		path.join(fixture.source, "skills", "alpha", "SKILL.md"),
		"inert fixture",
	);
	await fs.writeFile(path.join(fixture.source, "payload.txt"), "NEW");
	await fs.writeJson(path.join(fixture.source, "plugin.json"), {
		name,
		version: "2.0.0",
		description: "An inert replacement fixture",
		skills: ["alpha"],
	});
	await fs.writeJson(path.join(fixture.source, "skills.json"), {
		name,
		version: "2.0.0",
		description: "An inert replacement fixture",
		skills: [{ name: "alpha", path: "skills/alpha" }],
	});
	vi.mocked(scanSkillsWithCoverage).mockResolvedValue({
		declared: [],
		undeclared: [],
		symlinks: [],
		errors: [],
	});
});
afterEach(async () => {
	vi.restoreAllMocks();
	await fs.remove(root);
});
const invoke = (caller: string, options = {}) =>
	caller === "install"
		? installPlugin("org/repo", options)
		: importAgentSkillsPackage(fixture.source, options);
const priorIntact = async () => {
	expect(await fs.readFile(path.join(destination, "payload.txt"), "utf8")).toBe(
		"OLD",
	);
	expect(await fs.readJson(path.join(destination, ".installed.json"))).toEqual(
		oldMetadata,
	);
};
const prepare = async (stage: string) => {
	await fs.copy(fixture.source, stage);
	await fs.writeJson(path.join(stage, ".installed.json"), {
		...oldMetadata,
		version: "2.0.0",
	});
};
const publish = async (
	io?: import("./plugin-replacement.js").PluginReplacementIO,
) => {
	const { publishPluginReplacement } = await import("./plugin-replacement.js");
	return publishPluginReplacement(fixture.plugins, name, prepare, io);
};

describe.each(["install", "import"])("%s replacement caller", (caller) => {
	it("preserves prior bytes and metadata when required metadata writing fails", async () => {
		vi.spyOn(fs, "writeJson").mockRejectedValueOnce(new Error("metadata EIO"));
		const result = await invoke(caller).catch((error: unknown) => ({
			success: false,
			error: String(error),
		}));
		expect(result.success).toBe(false);
		await priorIntact();
		expect(
			await fs.readFile(path.join(fixture.source, "payload.txt"), "utf8"),
		).toBe("NEW");
	});
	it("publishes a complete discoverable replacement without consuming the source", async () => {
		expect((await invoke(caller)).success).toBe(true);
		expect(
			await fs.readFile(path.join(destination, "payload.txt"), "utf8"),
		).toBe("NEW");
		expect(
			(await listInstalledPlugins()).find((p) => p.name === name)?.version,
		).toBe("2.0.0");
		expect(await fs.pathExists(path.join(destination, "plugin.json"))).toBe(
			true,
		);
		expect(await fs.pathExists(path.join(fixture.source, "skills.json"))).toBe(
			true,
		);
	});
	it.each(["dry-run", "refusal"])("does not publish on %s", async (mode) => {
		if (mode === "refusal")
			vi.mocked(scanSkillsWithCoverage).mockResolvedValue({
				declared: [],
				undeclared: ["unexpected/SKILL.md"],
				symlinks: [],
				errors: [],
			});
		const result = await invoke(caller, { dryRun: mode === "dry-run" });
		expect(result.success).toBe(mode === "dry-run");
		await priorIntact();
		expect(await fs.pathExists(path.join(fixture.source, "payload.txt"))).toBe(
			true,
		);
	});
});

describe("shared plugin publisher recovery", () => {
	it("preserves the prior installation on stage-copy failure", async () => {
		const { publishPluginReplacement } = await import(
			"./plugin-replacement.js"
		);
		const result = await publishPluginReplacement(
			fixture.plugins,
			name,
			async (stage) => {
				await fs.writeFile(path.join(stage, "partial"), "incomplete");
				throw new Error("copy EIO");
			},
		);
		expect(result.success).toBe(false);
		await priorIntact();
	});
	it.each([
		"rejected",
		"applied",
		"uncertain",
	])("accounts honestly for %s promotion", async (fault) => {
		let calls = 0;
		const result = await publish({
			move: async (from, to) => {
				calls++;
				if (calls === 2) {
					if (fault === "applied")
						await fs.move(from, to, { overwrite: false });
					if (fault === "uncertain") await fs.copy(from, to);
					throw new Error("promotion EIO");
				}
				await fs.move(from, to, { overwrite: false });
			},
			remove: (target) => fs.remove(target),
		});
		expect(result.success).toBe(fault === "applied");
		if (fault === "rejected") await priorIntact();
		else
			expect(
				await fs.readFile(path.join(destination, "payload.txt"), "utf8"),
			).toBe("NEW");
		if (fault === "uncertain") {
			expect(calls).toBe(2);
			expect(result.cleanup).toBe("manual-review");
		}
	});
	it("preserves backup and remaining stage when restore fails", async () => {
		let calls = 0;
		const result = await publish({
			move: async (from, to) => {
				if (++calls >= 2) throw new Error("move EIO");
				await fs.move(from, to, { overwrite: false });
			},
			remove: (target) => fs.remove(target),
		});
		expect(result.success).toBe(false);
		expect(result.cleanup).toBe("manual-review");
		expect(result.recoveryPaths).toHaveLength(2);
		expect(
			await fs.readFile(
				path.join(result.recoveryPaths![0]!, "payload.txt"),
				"utf8",
			),
		).toBe("NEW");
		expect(
			await fs.readFile(
				path.join(result.recoveryPaths![1]!, "payload.txt"),
				"utf8",
			),
		).toBe("OLD");
	});
	it("never deletes an unexpected competing destination", async () => {
		let calls = 0;
		const result = await publish({
			move: async (from, to) => {
				if (++calls === 2) {
					await fs.ensureDir(to);
					await fs.writeFile(path.join(to, "competitor"), "KEEP");
					throw new Error("collision");
				}
				await fs.move(from, to, { overwrite: false });
			},
			remove: (target) => fs.remove(target),
		});
		expect(result.success).toBe(false);
		expect(calls).toBe(2);
		expect(
			await fs.readFile(path.join(destination, "competitor"), "utf8"),
		).toBe("KEEP");
		expect(
			await fs.readFile(
				path.join(result.recoveryPaths![1]!, "payload.txt"),
				"utf8",
			),
		).toBe("OLD");
	});
	it.each([
		"file",
		"foreign-directory",
		"symlink",
		"mismatched-marker",
		"symlink-marker",
	])("preserves %s destinations", async (kind) => {
		await fs.remove(destination);
		if (kind === "file") await fs.writeFile(destination, "KEEP");
		else if (kind === "symlink") await fs.symlink(fixture.source, destination);
		else {
			await fs.ensureDir(destination);
			await fs.writeFile(path.join(destination, "keep"), "KEEP");
			if (kind === "mismatched-marker")
				await fs.writeJson(path.join(destination, ".installed.json"), {
					name: "other",
					manifest: { name: "other" },
				});
			if (kind === "symlink-marker")
				await fs.symlink(
					path.join(fixture.source, "skills.json"),
					path.join(destination, ".installed.json"),
				);
		}
		const remove = vi.fn((target: string) => fs.remove(target));
		expect(
			(
				await publish({
					move: (from, to) => fs.move(from, to, { overwrite: false }),
					remove,
				})
			).success,
		).toBe(false);
		expect(remove).not.toHaveBeenCalled();
		expect(await fs.pathExists(destination)).toBe(true);
	});
	it("keeps successful publication observable when backup cleanup fails", async () => {
		const result = await publish({
			move: (from, to) => fs.move(from, to, { overwrite: false }),
			remove: async () => {
				throw new Error("cleanup EIO");
			},
		});
		expect(result.success).toBe(true);
		expect(result.warning).toContain("cleanup");
		expect(result.cleanup).toBe("manual-review");
		expect(
			await fs.readFile(path.join(destination, "payload.txt"), "utf8"),
		).toBe("NEW");
		expect(await fs.pathExists(result.recoveryPaths![1]!)).toBe(true);
	});
	it("allocates unique stages even at the same clock time", async () => {
		vi.spyOn(Date, "now").mockReturnValue(1);
		const first = await publish({
			move: async () => {
				throw new Error("stop");
			},
			remove: (target) => fs.remove(target),
		});
		const second = await publish({
			move: async () => {
				throw new Error("stop");
			},
			remove: (target) => fs.remove(target),
		});
		expect(first.recoveryPaths![0]).not.toBe(second.recoveryPaths![0]);
		await priorIntact();
	});
});

it("refuses importing from the installation it would replace", async () => {
	await fs.copy(fixture.source, destination);
	const before = await fs.readJson(path.join(destination, ".installed.json"));
	const result = await importAgentSkillsPackage(destination);
	expect(result.success).toBe(false);
	expect(result.error).toContain("overlapping");
	expect(await fs.readJson(path.join(destination, ".installed.json"))).toEqual(
		before,
	);
	expect(await fs.readFile(path.join(destination, "payload.txt"), "utf8")).toBe(
		"NEW",
	);
});
