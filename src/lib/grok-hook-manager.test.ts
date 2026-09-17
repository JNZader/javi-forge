import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFakeSecureFs } from "./__fixtures__/fake-secure-fs.js";
import {
	_runGrok,
	classifyGrokHookJson,
	doctorGrokSkillGuard,
	expectedGrokHookJson,
	GROK_ASSETS_DIR,
	GROK_HOOK_MARKER,
	GROK_POLICY_MARKER,
	type GrokManifest,
	grokConfigPaths,
	resolveGrokHomeRoot,
	SHIPPED_GROK_POLICY,
} from "./grok-hook-manager.js";

const digest = (file: string): string =>
	createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const manifest = (): GrokManifest => ({
	hook: {
		name: "javi-forge-skillguard-pre-tool-use.json",
		version: 1,
		matcher: "run_terminal_command|read_file|search_replace",
		historicalVersions: [0],
	},
	policy: {
		name: path.basename(SHIPPED_GROK_POLICY),
		version: 1,
		sha256: digest(SHIPPED_GROK_POLICY),
		historical: [],
	},
});

let baseDir: string;
const paths = () => grokConfigPaths(baseDir);

function mirror(fake: ReturnType<typeof makeFakeSecureFs>): void {
	let current = baseDir;
	while (true) {
		fake.seedDir(current);
		const parent = path.dirname(current);
		if (parent === current) return;
		current = parent;
	}
}

beforeEach(() => {
	baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "grok-mgr-"));
});

afterEach(() => {
	fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("Grok Build SkillGuard manager", () => {
	it("binds the packaged hook manifest to the restricted tool matcher", () => {
		const parsed = JSON.parse(
			fs.readFileSync(path.join(GROK_ASSETS_DIR, "manifest.json"), "utf8"),
		) as { hook: { name: string; matcher: string } };
		expect(parsed.hook).toMatchObject({
			name: "javi-forge-skillguard-pre-tool-use.json",
			matcher: "run_terminal_command|read_file|search_replace",
		});
	});

	it("installs a global hook registration and adjacent policy in one secure transaction", async () => {
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await _runGrok(
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
		expect(result.changed).toEqual([paths().hookFile, paths().policyFile]);
		expect(fake.fileText(paths().hookFile)).toBe(
			expectedGrokHookJson(paths().policyFile),
		);
		expect(fake.fileText(paths().policyFile)).toBe(
			fs.readFileSync(SHIPPED_GROK_POLICY, "utf8"),
		);
	});

	it("honors GROK_HOME as the global hook root", async () => {
		const customRoot = path.join(baseDir, "custom-grok-home");
		expect(resolveGrokHomeRoot(baseDir, { GROK_HOME: customRoot })).toBe(
			customRoot,
		);
		expect(grokConfigPaths(baseDir, { GROK_HOME: customRoot })).toMatchObject({
			grokDir: customRoot,
			hooksDir: path.join(customRoot, "hooks"),
			hookFile: path.join(
				customRoot,
				"hooks",
				"javi-forge-skillguard-pre-tool-use.json",
			),
			policyFile: path.join(
				customRoot,
				"hooks",
				"javi-forge-skillguard-pre-tool-use.mjs",
			),
		});
	});

	it("installs through the secure transaction when GROK_HOME is relocated", async () => {
		const customRoot = path.join(baseDir, "config", "grok-home");
		const fake = makeFakeSecureFs();
		mirror(fake);
		fake.seedDir(path.join(baseDir, "config"));
		const result = await _runGrok(
			baseDir,
			"install",
			{},
			{
				env: { GROK_HOME: customRoot },
				secureFs: fake,
				manifest: manifest(),
				clock: () => new Date("2026-09-13T00:00:00.000Z"),
				nonce: () => "00000002",
			},
		);
		const customPaths = grokConfigPaths(baseDir, { GROK_HOME: customRoot });
		expect(result.ok).toBe(true);
		expect(result.changed).toEqual([
			customPaths.hookFile,
			customPaths.policyFile,
		]);
		expect(fake.fileText(customPaths.hookFile)).toBe(
			expectedGrokHookJson(customPaths.policyFile),
		);
	});

	it("classifies current, released-outdated, edited, foreign, symlink, and non-regular registrations", async () => {
		fs.mkdirSync(paths().hooksDir, { recursive: true });
		fs.writeFileSync(
			paths().hookFile,
			expectedGrokHookJson(paths().policyFile),
		);
		expect(
			(
				await classifyGrokHookJson(
					paths().hookFile,
					paths().policyFile,
					manifest().hook,
				)
			).state,
		).toBe("managed-current");

		const released = JSON.parse(expectedGrokHookJson(paths().policyFile)) as {
			version: number;
		};
		released.version = 0;
		fs.writeFileSync(paths().hookFile, JSON.stringify(released));
		expect(
			(
				await classifyGrokHookJson(
					paths().hookFile,
					paths().policyFile,
					manifest().hook,
				)
			).state,
		).toBe("released-outdated");

		fs.writeFileSync(paths().hookFile, `${GROK_HOOK_MARKER}\n`);
		expect(
			(
				await classifyGrokHookJson(
					paths().hookFile,
					paths().policyFile,
					manifest().hook,
				)
			).state,
		).toBe("malformed");
		fs.writeFileSync(
			paths().hookFile,
			JSON.stringify({ "javi-forge-managed": GROK_HOOK_MARKER, version: 1 }),
		);
		expect(
			(
				await classifyGrokHookJson(
					paths().hookFile,
					paths().policyFile,
					manifest().hook,
				)
			).state,
		).toBe("edited-managed");
		fs.writeFileSync(paths().hookFile, "{}");
		expect(
			(
				await classifyGrokHookJson(
					paths().hookFile,
					paths().policyFile,
					manifest().hook,
				)
			).state,
		).toBe("foreign");
		fs.rmSync(paths().hookFile);
		fs.mkdirSync(paths().hookFile);
		expect(
			(
				await classifyGrokHookJson(
					paths().hookFile,
					paths().policyFile,
					manifest().hook,
				)
			).state,
		).toBe("non-regular");
		fs.rmSync(paths().hookFile, { recursive: true });
		fs.symlinkSync(paths().policyFile, paths().hookFile);
		expect(
			(
				await classifyGrokHookJson(
					paths().hookFile,
					paths().policyFile,
					manifest().hook,
				)
			).state,
		).toBe("symlink");
	});

	it("refuses foreign targets and requires repair --force for edited managed files", async () => {
		fs.mkdirSync(paths().hooksDir, { recursive: true });
		fs.writeFileSync(paths().hookFile, "{}");
		const fake = makeFakeSecureFs();
		mirror(fake);
		const foreign = await _runGrok(
			baseDir,
			"install",
			{},
			{ secureFs: fake, manifest: manifest() },
		);
		expect(foreign.ok).toBe(false);
		expect(foreign.errors.join(" ")).toContain("foreign");

		fs.writeFileSync(
			paths().hookFile,
			JSON.stringify({ "javi-forge-managed": GROK_HOOK_MARKER, version: 1 }),
		);
		const edited = await _runGrok(
			baseDir,
			"repair",
			{},
			{ secureFs: fake, manifest: manifest() },
		);
		expect(edited.ok).toBe(false);
		expect(edited.errors.join(" ")).toContain("--force");
	});

	it("doctor reports file currency and an inconclusive runtime execution verdict", async () => {
		const report = await doctorGrokSkillGuard(baseDir, {
			manifest: manifest(),
		});
		expect(report.healthy).toBe(false);
		expect(report.hook.state).toBe("absent");
		expect(report.policy.state).toBe("absent");
		expect(report.execution).toEqual({
			status: "inconclusive",
			blockers: [],
			unknownSources: [
				"Grok hook discovery is not locally verified",
				"Grok hook loading is not locally verified",
				"Grok hook execution is not locally verified",
			],
			residual: [
				"Installed file bytes do not prove Grok discovered, loaded, or invoked the hook",
			],
		});
	});

	it("doctor keeps managed-current files inconclusive because runtime is unverified", async () => {
		fs.mkdirSync(paths().hooksDir, { recursive: true });
		fs.writeFileSync(
			paths().hookFile,
			expectedGrokHookJson(paths().policyFile),
		);
		fs.writeFileSync(paths().policyFile, fs.readFileSync(SHIPPED_GROK_POLICY));

		const report = await doctorGrokSkillGuard(baseDir, {
			manifest: manifest(),
		});

		expect(report.healthy).toBe(true);
		expect(report.hook.state).toBe("managed-current");
		expect(report.policy.state).toBe("managed-current");
		expect(report.execution.status).toBe("inconclusive");
		expect(report.execution.blockers).toEqual([]);
		expect(report.execution.unknownSources).toEqual([
			"Grok hook discovery is not locally verified",
			"Grok hook loading is not locally verified",
			"Grok hook execution is not locally verified",
		]);
		expect(report.execution.residual).toContain(
			"This process seeing the recorded execPath is not proof Grok spawned the hook",
		);
	});

	it("doctor blocks when the recorded Grok execPath is not a file", async () => {
		fs.mkdirSync(paths().hooksDir, { recursive: true });
		fs.writeFileSync(
			paths().hookFile,
			expectedGrokHookJson(paths().policyFile),
		);
		fs.writeFileSync(paths().policyFile, fs.readFileSync(SHIPPED_GROK_POLICY));

		const report = await doctorGrokSkillGuard(baseDir, {
			manifest: manifest(),
			probeExecPath: async () => false,
		});

		expect(report.healthy).toBe(true);
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers[0]).toMatch(
			/^Grok recorded execPath is not a file: /,
		);
	});

	it("uses the policy marker shipped beside the hook", () => {
		expect(fs.readFileSync(SHIPPED_GROK_POLICY, "utf8")).toMatch(
			`${GROK_POLICY_MARKER}\n`,
		);
	});
});
