import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFakeSecureFs } from "./__fixtures__/fake-secure-fs.js";
import {
	_runOpenCode,
	classifyOpenCodeAsset,
	doctorOpenCodeSkillGuard,
	OPENCODE_ASSETS_DIR,
	OPENCODE_PLUGIN_MARKER,
	type OpenCodeManifest,
	opencodeConfigPaths,
	SHIPPED_OPENCODE_PLUGIN,
	SHIPPED_OPENCODE_POLICY,
} from "./opencode-hook-manager.js";

const digest = (file: string): string =>
	createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const manifest = (): OpenCodeManifest => ({
	plugin: {
		name: path.basename(SHIPPED_OPENCODE_PLUGIN),
		version: 1,
		sha256: digest(SHIPPED_OPENCODE_PLUGIN),
		historical: [],
	},
	policy: {
		name: path.basename(SHIPPED_OPENCODE_POLICY),
		version: 1,
		sha256: digest(SHIPPED_OPENCODE_POLICY),
		historical: [],
	},
});

let baseDir: string;
const paths = () => opencodeConfigPaths(baseDir);

function mirror(fake: ReturnType<typeof makeFakeSecureFs>): void {
	let current = baseDir;
	while (true) {
		fake.seedDir(current);
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
}

beforeEach(() => {
	baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-mgr-"));
});

afterEach(() => {
	fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("OpenCode SkillGuard manager", () => {
	it("resolves a global plugin pair beneath the supplied base directory", () => {
		expect(paths().pluginsDir).toBe(
			path.join(baseDir, ".config", "opencode", "plugins"),
		);
		expect(paths().pluginFile).toContain("javi-forge-skillguard-plugin.mjs");
		expect(paths().policyFile).toContain(
			"javi-forge-skillguard-pre-tool-use.mjs",
		);
	});

	it("binds the packaged OpenCode plugin manifest to the shipped plugin bytes", () => {
		const raw = fs.readFileSync(
			path.join(OPENCODE_ASSETS_DIR, "manifest.json"),
			"utf8",
		);
		const parsed = JSON.parse(raw) as {
			plugin: { name: string; sha256: string };
		};
		expect(parsed.plugin.name).toBe(path.basename(SHIPPED_OPENCODE_PLUGIN));
		expect(parsed.plugin.sha256).toBe(digest(SHIPPED_OPENCODE_PLUGIN));
	});

	it("installs the plugin and side-by-side policy runtime in one secure transaction", async () => {
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await _runOpenCode(
			baseDir,
			"install",
			{},
			{
				secureFs: fake,
				manifest: manifest(),
				clock: () => new Date("2026-09-13T00:00:00.000Z"),
				nonce: () => "00000001",
			},
		);
		expect(result.ok).toBe(true);
		expect(result.changed).toEqual([paths().pluginFile, paths().policyFile]);
		expect(fake.fileText(paths().pluginFile)).toBe(
			fs.readFileSync(SHIPPED_OPENCODE_PLUGIN, "utf8"),
		);
		expect(fake.fileText(paths().policyFile)).toBe(
			fs.readFileSync(SHIPPED_OPENCODE_POLICY, "utf8"),
		);
	});

	it("classifies current, released-outdated, edited, and absent plugin bytes", async () => {
		const target = paths().pluginFile;
		fs.mkdirSync(path.dirname(target), { recursive: true });
		const current = manifest().plugin;
		fs.writeFileSync(target, fs.readFileSync(SHIPPED_OPENCODE_PLUGIN));
		expect(
			(await classifyOpenCodeAsset(target, OPENCODE_PLUGIN_MARKER, current))
				.state,
		).toBe("managed-current");
		const old = `${OPENCODE_PLUGIN_MARKER}\n// old\n`;
		const oldHash = createHash("sha256").update(old).digest("hex");
		fs.writeFileSync(target, old);
		expect(
			(
				await classifyOpenCodeAsset(target, OPENCODE_PLUGIN_MARKER, {
					...current,
					historical: [oldHash],
				})
			).state,
		).toBe("released-outdated");
		expect(
			(await classifyOpenCodeAsset(target, OPENCODE_PLUGIN_MARKER, current))
				.state,
		).toBe("edited-managed");
		fs.rmSync(target);
		expect(
			(await classifyOpenCodeAsset(target, OPENCODE_PLUGIN_MARKER, current))
				.state,
		).toBe("absent");
	});

	it("refuses foreign and edited targets without repair --force", async () => {
		fs.mkdirSync(paths().pluginsDir, { recursive: true });
		fs.writeFileSync(paths().pluginFile, "export default {};\n");
		const fake = makeFakeSecureFs();
		mirror(fake);
		const foreign = await _runOpenCode(
			baseDir,
			"install",
			{},
			{
				secureFs: fake,
				manifest: manifest(),
			},
		);
		expect(foreign.ok).toBe(false);
		expect(foreign.errors.join(" ")).toContain("foreign");

		fs.writeFileSync(
			paths().pluginFile,
			`${OPENCODE_PLUGIN_MARKER}\n// edited\n`,
		);
		const edited = await _runOpenCode(
			baseDir,
			"repair",
			{},
			{
				secureFs: fake,
				manifest: manifest(),
			},
		);
		expect(edited.ok).toBe(false);
		expect(edited.errors.join(" ")).toContain("--force");
	});

	it("doctor reports file currency and explicitly has no runtime execution evidence", async () => {
		const report = await doctorOpenCodeSkillGuard(baseDir, {
			manifest: manifest(),
		});
		expect(report.healthy).toBe(false);
		expect(report.plugin.state).toBe("absent");
		expect(report.policy.state).toBe("absent");
		expect(report.runtimeEvidence).toBe("not-implemented");
	});
});
