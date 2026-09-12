import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { globSync } from "glob";
import { loadConfigFromFile } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configDefaults, type ViteUserConfig } from "vitest/config";

let fixture: string;

beforeEach(async () => {
	fixture = await fs.mkdtemp(path.join(os.tmpdir(), "forge-vitest-config-"));
	for (const file of [
		"src/lib/unit.test.ts",
		"src/lib/module.spec.mts",
		"src/ui/component.test.tsx",
		"src/__tests__/heredoc-boundary-regression.test.mjs",
		"src/__integration__/plugin.integration.test.ts",
		"src/__integration__/secure-fs-posix.integration.test.ts",
		".worktrees/branch/src/lib/duplicate.test.ts",
		".claude/worktrees/branch/src/lib/duplicate.test.ts",
		".stryker-tmp/sandbox/src/lib/mutant.test.ts",
		"src/.worktrees/branch/duplicate.test.ts",
		"src/.stryker-tmp/sandbox/mutant.test.ts",
	]) {
		// Discovery-only inert fixtures: this test inspects config, not payloads.
		await fs.outputFile(path.join(fixture, file), "");
	}
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await fs.remove(fixture);
});

async function discover(linuxIntegration: string): Promise<string[]> {
	vi.stubEnv("JAVI_FORGE_LINUX_INT", linuxIntegration);
	const loaded = await loadConfigFromFile(
		{ command: "serve", mode: "test" },
		path.resolve("vitest.config.ts"),
	);
	expect(loaded).not.toBeNull();
	const config = loaded!.config as ViteUserConfig;
	const dir = config.test?.dir ?? ".";
	return globSync(config.test?.include ?? configDefaults.include, {
		cwd: path.join(fixture, dir),
		dot: true,
		ignore: config.test?.exclude,
	})
		.map((file) => path.posix.join(dir, file).replace(/^\.\//, ""))
		.sort();
}

describe("canonical Vitest discovery", () => {
	it("collects regular suites without worktree copies or Node-native suites", async () => {
		expect(await discover("")).toEqual([
			"src/__integration__/plugin.integration.test.ts",
			"src/lib/module.spec.mts",
			"src/lib/unit.test.ts",
			"src/ui/component.test.tsx",
		]);
	});

	it("keeps the real POSIX integration suite opt-in", async () => {
		expect(await discover("1")).toEqual([
			"src/__integration__/plugin.integration.test.ts",
			"src/__integration__/secure-fs-posix.integration.test.ts",
			"src/lib/module.spec.mts",
			"src/lib/unit.test.ts",
			"src/ui/component.test.tsx",
		]);
	});
});
