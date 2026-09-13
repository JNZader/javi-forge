import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const checker = fileURLToPath(
	new URL("../../scripts/verify-package-contents.mjs", import.meta.url),
);
const seamRunner = `
const module = await import(process.argv[2]);
try {
  const result = module.verifyArchive({
    archivePath: process.argv[3],
    packument: JSON.parse(process.argv[4]),
  });
  console.log(result.summary);
} catch (error) {
  console.error(JSON.stringify(error.messages ?? [error.message]));
  process.exitCode = 1;
}`;
// Independent packlist contract, not derived from the checker or actual assets.
// Only these path strings are supplied; no referenced asset is loaded/executed.
const required = [
	"dist/index.js",
	"dist/index.d.ts",
	"dist/commands/init.js",
	"dist/commands/init.d.ts",
	"dist/commands/skills.js",
	"dist/commands/skills.d.ts",
	"dist/lib/template.js",
	"dist/lib/template.d.ts",
	"dist/tasks/task-tracker.js",
	"dist/tasks/task-tracker.d.ts",
	"dist/ui/App.js",
	"dist/ui/App.d.ts",
	"dist/types/index.js",
	"dist/types/index.d.ts",
	"assets/hooks/pre-commit",
	"assets/hooks/pre-push",
	"assets/hooks/commit-msg",
	"assets/hooks/manifest.json",
	"assets/claude-hooks/javi-forge-windows-secure-object.ps1",
	"assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs",
	"assets/claude-hooks/manifest.json",
	"assets/opencode-plugins/javi-forge-skillguard-plugin.mjs",
	"assets/opencode-plugins/manifest.json",
	"assets/grok-hooks/manifest.json",
	"templates/github/ci-node.yml",
	"modules/engram/install-engram.sh",
	"workflows/reusable-build-node.yml",
	"ci-local/ci-local.sh",
	"ci-local/docker/node.Dockerfile",
	"ci-local/docker/python.Dockerfile",
	"ci-local/docker/go.Dockerfile",
	"ci-local/docker/rust.Dockerfile",
	"ci-local/docker/java-gradle.Dockerfile",
	"ci-local/docker/java-maven.Dockerfile",
	"ci-local/docker/java.Dockerfile",
	"ci-local/docker/elixir.Dockerfile",
	"lib/common.sh",
	".gitignore.template",
	"README.md",
	"package.json",
];
let directory: string;
let archivePath: string;
beforeEach(() => {
	directory = mkdtempSync(path.join(os.tmpdir(), "forge-packlist-"));
	const packageRoot = path.join(directory, "package");
	mkdirSync(path.join(packageRoot, "ci-local/lib"), { recursive: true });
	mkdirSync(path.join(packageRoot, "lib"), { recursive: true });
	writeFileSync(
		path.join(packageRoot, "package.json"),
		JSON.stringify({
			name: "javi-forge",
			version: "2.0.0",
			os: ["linux", "win32"],
		}),
	);
	writeFileSync(path.join(packageRoot, "lib/common.sh"), "#!/bin/sh\n");
	writeFileSync(
		path.join(packageRoot, "ci-local/lib/common.sh"),
		"#!/bin/sh\n",
	);
	archivePath = path.join(directory, "javi-forge-2.0.0.tgz");
	const tar = spawnSync(
		"tar",
		["-czf", archivePath, "-C", directory, "package"],
		{
			encoding: "utf8",
		},
	);
	expect(tar.status).toBe(0);
});
afterEach(() => {
	rmSync(directory, { recursive: true, force: true });
});

function check(raw: string) {
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			seamRunner,
			"test-seam",
			checker,
			archivePath,
			raw,
		],
		{
			encoding: "utf8",
			shell: false,
			timeout: 5_000,
			maxBuffer: 256 * 1024,
		},
	);
	expect(result.error).toBeUndefined();
	expect(result.signal).toBeNull();
	return result;
}
const manifest = (files: string[]) =>
	JSON.stringify({
		filename: path.basename(archivePath),
		files: files.map((file) => ({ path: file })),
		name: "javi-forge",
		version: "2.0.0",
	});
const failureMessages = (stderr: string): string[] =>
	JSON.parse(stderr) as string[];

describe("package contents validator", () => {
	it("accepts a complete independent packlist and permitted sensitive examples", () => {
		const result = check(
			manifest([
				...required,
				"modules/ghagga/.env.example",
				"templates/local-ai/.env.example",
			]),
		);
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("Package content verification passed:");
	});

	it.each(required)("rejects omission of required file %s", (missing) => {
		const result = check(manifest(required.filter((file) => file !== missing)));
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(failureMessages(result.stderr)).toContain(
			`missing required file: ${missing}`,
		);
	});

	it.each([
		"src/index.ts",
		"coverage/result.json",
		"node_modules/demo/index.js",
		".github/workflows/ci.yml",
		"dist/__integration__/fixture.js",
		"tsconfig.json",
		".releaserc",
		"nested/.env",
		"nested/credentials.json",
		"nested/secrets/token",
		"nested/oauth.json",
		"dist/demo.test.js",
		"dist/demo.spec.ts",
		"nested/test.test.sh",
		"dist/index.js.map",
		"npm-debug.log",
		"nested/trace.jsonl",
		"nested/cache.sqlite",
	])("rejects forbidden entry %s", (forbidden) => {
		const result = check(manifest([...required, forbidden]));
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(failureMessages(result.stderr).join("\n")).toContain(forbidden);
	});

	it.each([
		"",
		"[]",
		"[{}]",
		"not JSON",
	])("rejects malformed pack output %j", (raw) => {
		const result = check(raw);
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(failureMessages(result.stderr)).not.toEqual([]);
	});

	it("retains required-tree validation", () => {
		const result = check(
			manifest(required.filter((file) => !file.startsWith("modules/"))),
		);
		expect(result.status).toBe(1);
		expect(result.stdout).toBe("");
		expect(failureMessages(result.stderr)).toContain(
			"missing required asset tree: modules/",
		);
	});
});
