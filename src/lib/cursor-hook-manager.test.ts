import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeFakeSecureFs } from "./__fixtures__/fake-secure-fs.js";
import {
	_runCursor,
	CURSOR_HOOK_MARKER,
	CURSOR_POLICY_MARKER,
	CURSOR_TOOL_MATCHER,
	type CursorHookRunDeps,
	classifyCursorHooksJson,
	cursorConfigPaths,
	doctorCursorSkillGuard,
	expectedCursorHooksJson,
	mergeCursorHooks,
	SHIPPED_CURSOR_POLICY,
} from "./cursor-hook-manager.js";

const digest = (file: string): string =>
	createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const manifest = (): NonNullable<CursorHookRunDeps["manifest"]> => ({
	policy: {
		name: path.basename(SHIPPED_CURSOR_POLICY),
		version: 1,
		sha256: digest(SHIPPED_CURSOR_POLICY),
		historical: [],
	},
});

let baseDir: string;
const paths = () => cursorConfigPaths(baseDir);

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
	baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-mgr-"));
});

afterEach(() => {
	fs.rmSync(baseDir, { recursive: true, force: true });
});

describe("Cursor SkillGuard manager", () => {
	it("generates a fail-closed preToolUse registration for Cursor tool names", () => {
		const parsed = JSON.parse(expectedCursorHooksJson(paths().policyFile)) as {
			hooks: { preToolUse: Array<Record<string, unknown>> };
		};
		expect(parsed.hooks.preToolUse).toHaveLength(1);
		expect(parsed.hooks.preToolUse[0]).toMatchObject({
			command: `${JSON.stringify(process.execPath)} ${JSON.stringify(paths().policyFile)} --agent=cursor`,
			type: "command",
			matcher: CURSOR_TOOL_MATCHER,
			timeout: 30,
			failClosed: true,
		});
	});

	it("installs a global hooks.json registration and adjacent policy in one secure transaction", async () => {
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await _runCursor(
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
		expect(result.changed).toEqual([paths().hooksFile, paths().policyFile]);
		expect(JSON.parse(fake.fileText(paths().hooksFile) ?? "")).toEqual(
			JSON.parse(expectedCursorHooksJson(paths().policyFile)),
		);
		expect(fake.fileText(paths().policyFile)).toBe(
			fs.readFileSync(SHIPPED_CURSOR_POLICY, "utf8"),
		);
	});

	it("preserves foreign Cursor hooks when adding the managed hook", () => {
		const merged = mergeCursorHooks(
			{
				hooks: {
					preToolUse: [
						{ command: "./foreign.sh", type: "command", matcher: "Shell" },
					],
				},
			},
			paths().policyFile,
		);
		const hooks = (merged.hooks as { preToolUse: unknown[] }).preToolUse;
		expect(hooks).toHaveLength(2);
		expect(hooks[0]).toMatchObject({ command: "./foreign.sh" });
		expect(hooks[1]).toMatchObject({ failClosed: true });
	});

	it("classifies current, released-outdated, foreign, malformed, symlink, and non-regular registrations", async () => {
		fs.mkdirSync(paths().cursorDir, { recursive: true });
		fs.writeFileSync(
			paths().hooksFile,
			expectedCursorHooksJson(paths().policyFile),
		);
		expect(
			classifyCursorHooksJson(
				JSON.parse(fs.readFileSync(paths().hooksFile, "utf8")),
				paths().policyFile,
			).state,
		).toBe("managed-current");

		const released = JSON.parse(
			expectedCursorHooksJson(paths().policyFile),
		) as {
			hooks: { preToolUse: Array<{ failClosed?: boolean }> };
		};
		released.hooks.preToolUse[0].failClosed = false;
		expect(classifyCursorHooksJson(released, paths().policyFile).state).toBe(
			"released-outdated",
		);

		expect(
			classifyCursorHooksJson({ hooks: { preToolUse: [] } }, paths().policyFile)
				.state,
		).toBe("absent");
		expect(
			classifyCursorHooksJson(
				{ hooks: { preToolUse: [{ command: "./x" }] } },
				paths().policyFile,
			).state,
		).toBe("foreign");
		expect(
			classifyCursorHooksJson(
				{ hooks: { preToolUse: "bad" } },
				paths().policyFile,
			).state,
		).toBe("malformed");

		fs.rmSync(paths().hooksFile);
		fs.mkdirSync(paths().hooksFile);
		const nonRegular = await doctorCursorSkillGuard(baseDir, {
			manifest: manifest(),
		});
		expect(nonRegular.hooksJson.state).toBe("non-regular");

		fs.rmSync(paths().hooksFile, { recursive: true });
		fs.symlinkSync(paths().policyFile, paths().hooksFile);
		const symlink = await doctorCursorSkillGuard(baseDir, {
			manifest: manifest(),
		});
		expect(symlink.hooksJson.state).toBe("symlink");
	});

	it("refuses malformed targets and requires repair --force for edited managed policy", async () => {
		fs.mkdirSync(paths().cursorDir, { recursive: true });
		fs.writeFileSync(paths().hooksFile, "{");
		const fake = makeFakeSecureFs();
		mirror(fake);
		const malformed = await _runCursor(
			baseDir,
			"install",
			{},
			{ secureFs: fake, manifest: manifest() },
		);
		expect(malformed.ok).toBe(false);
		expect(malformed.errors.join(" ")).toContain("malformed");

		fs.writeFileSync(
			paths().hooksFile,
			expectedCursorHooksJson(paths().policyFile),
		);
		fs.mkdirSync(paths().hooksDir, { recursive: true });
		fs.writeFileSync(paths().policyFile, `${CURSOR_POLICY_MARKER}\nedited`);
		const edited = await _runCursor(
			baseDir,
			"repair",
			{},
			{ secureFs: fake, manifest: manifest() },
		);
		expect(edited.ok).toBe(false);
		expect(edited.errors.join(" ")).toContain("--force");
	});

	it("preserves foreign hooks.json but refuses a foreign adjacent policy runtime", async () => {
		fs.mkdirSync(paths().hooksDir, { recursive: true });
		fs.writeFileSync(
			paths().hooksFile,
			JSON.stringify({ hooks: { preToolUse: [{ command: "./foreign.sh" }] } }),
		);
		fs.writeFileSync(paths().policyFile, "foreign");
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await _runCursor(
			baseDir,
			"install",
			{},
			{ secureFs: fake, manifest: manifest() },
		);
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain("foreign");
		expect(fake.fileText(paths().hooksFile)).toBeUndefined();
	});

	it("doctor reports file currency and an inconclusive runtime execution verdict", async () => {
		const report = await doctorCursorSkillGuard(baseDir, {
			manifest: manifest(),
		});
		expect(report.healthy).toBe(false);
		expect(report.hooksJson.state).toBe("absent");
		expect(report.policy.state).toBe("absent");
		expect(report.execution).toEqual({
			status: "inconclusive",
			blockers: [],
			unknownSources: [
				"Cursor hook discovery is not locally verified",
				"Cursor hook loading is not locally verified",
				"Cursor hook execution is not locally verified",
			],
			residual: [
				"Installed file bytes do not prove Cursor discovered, loaded, or invoked the hook",
			],
		});
	});

	it("doctor keeps managed-current files inconclusive because runtime is unverified", async () => {
		fs.mkdirSync(paths().hooksDir, { recursive: true });
		fs.writeFileSync(
			paths().hooksFile,
			expectedCursorHooksJson(paths().policyFile),
		);
		fs.writeFileSync(
			paths().policyFile,
			fs.readFileSync(SHIPPED_CURSOR_POLICY),
		);

		const report = await doctorCursorSkillGuard(baseDir, {
			manifest: manifest(),
		});

		expect(report.healthy).toBe(true);
		expect(report.hooksJson.state).toBe("managed-current");
		expect(report.policy.state).toBe("managed-current");
		expect(report.execution.status).toBe("inconclusive");
		expect(report.execution.blockers).toEqual([]);
		expect(report.execution.unknownSources).toEqual([
			"Cursor hook discovery is not locally verified",
			"Cursor hook loading is not locally verified",
			"Cursor hook execution is not locally verified",
		]);
		expect(report.execution.residual).toContain(
			"This process seeing the recorded execPath is not proof Cursor spawned the hook",
		);
	});

	it("doctor blocks when the recorded Cursor execPath is not a file", async () => {
		fs.mkdirSync(paths().hooksDir, { recursive: true });
		fs.writeFileSync(
			paths().hooksFile,
			expectedCursorHooksJson(paths().policyFile),
		);
		fs.writeFileSync(
			paths().policyFile,
			fs.readFileSync(SHIPPED_CURSOR_POLICY),
		);

		const report = await doctorCursorSkillGuard(baseDir, {
			manifest: manifest(),
			probeExecPath: async () => false,
		});

		expect(report.healthy).toBe(true);
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers[0]).toMatch(
			/^Cursor recorded execPath is not a file: /,
		);
	});

	it("uses the shared policy marker shipped beside the hook", () => {
		expect(fs.readFileSync(SHIPPED_CURSOR_POLICY, "utf8")).toMatch(
			`${CURSOR_POLICY_MARKER}\n`,
		);
		expect(CURSOR_HOOK_MARKER).toContain("cursor-pretooluse");
	});
});
