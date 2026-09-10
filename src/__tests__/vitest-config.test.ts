import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { globSync } from "glob";
import { loadConfigFromFile } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configDefaults, type ViteUserConfig } from "vitest/config";

let fixture: string;

beforeEach(async () => {
	fixture = await fs.mkdtemp(path.join(os.tmpdir(), "forge-test-discovery-"));
	for (const file of [
		"src/lib/unit.test.ts",
		"src/ui/component.test.tsx",
		"src/lib/module.spec.mts",
		"src/lib/preparation-supervisor.test.ts",
		"src/__integration__/plugin.integration.test.ts",
		"src/lib/secure-fs-posix.integration.test.ts",
		".worktrees/branch/src/lib/duplicate.test.ts",
		".claude/worktrees/branch/src/lib/duplicate.test.ts",
		".stryker-tmp/sandbox/src/lib/mutant.test.ts",
		"src/.worktrees/branch/duplicate.test.ts",
		"src/.stryker-tmp/sandbox/mutant.test.ts",
	]) {
		// Empty inert fixtures: discovery only, never import or execute them.
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
		ignore: config.test?.exclude,
		dot: true,
	})
		.map((file) => path.posix.join(dir, file))
		.sort();
}

describe("canonical Vitest discovery", () => {
	it("collects canonical tests without duplicate worktrees or mutation sandboxes", async () => {
		expect(await discover("")).toEqual([
			"src/__integration__/plugin.integration.test.ts",
			"src/lib/module.spec.mts",
			"src/lib/preparation-supervisor.test.ts",
			"src/lib/unit.test.ts",
			"src/ui/component.test.tsx",
		]);
	});

	it("retains explicit opt-in discovery of the POSIX integration suite", async () => {
		const files = await discover("1");
		expect(files).toContain("src/lib/secure-fs-posix.integration.test.ts");
		expect(files).toHaveLength(6);
	});
});
