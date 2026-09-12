// biome-ignore-all format: compact table-driven archive corpus keeps the chained PR within its hard review budget.
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const verifierPath = path.join(repoRoot, "scripts/verify-package-contents.mjs");
const packageJsonPath = path.join(repoRoot, "package.json");
const tempDirs: string[] = [];
const packedFiles = [
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
	"assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs",
	"assets/claude-hooks/manifest.json",
	"assets/claude-hooks/javi-forge-windows-secure-object.ps1",
	"templates/github/ci-node.yml",
	"modules/engram/install-engram.sh",
	"workflows/reusable-build-node.yml",
	"ci-local/ci-local.sh",
	"ci-local/lib/common.sh",
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
] as const;

interface ArchiveOptions {
	ciHelper?: string | Buffer;
	entries?: readonly string[];
	libHelper?: string | Buffer;
	metadata?: unknown;
	mutate?: (packageRoot: string) => void;
}

interface Packument {
	filename: string;
	files: Array<{ path: string }>;
	name: string;
	version: string;
}

interface ArchiveFixture {
	archivePath: string;
	packument: Packument;
}

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

function tempDir(prefix: string): string {
	const directory = mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(directory);
	return directory;
}

function createArchive(options: ArchiveOptions = {}): ArchiveFixture {
	const directory = tempDir("javi-forge-archive-test-");
	const packageRoot = path.join(directory, "package");
	mkdirSync(path.join(packageRoot, "lib"), { recursive: true });
	mkdirSync(path.join(packageRoot, "ci-local/lib"), { recursive: true });
	const metadata =
		options.metadata ??
		({ name: "javi-forge", version: "2.0.0", os: ["linux", "win32"] } as const);
	writeFileSync(
		path.join(packageRoot, "package.json"),
		typeof metadata === "string" || Buffer.isBuffer(metadata)
			? metadata
			: JSON.stringify(metadata),
	);
	writeFileSync(path.join(packageRoot, "lib/common.sh"), options.libHelper ?? "#!/bin/sh\n");
	writeFileSync(
		path.join(packageRoot, "ci-local/lib/common.sh"),
		options.ciHelper ?? "#!/bin/sh\n",
	);
	options.mutate?.(packageRoot);
	const archivePath = path.join(directory, "javi-forge-2.0.0.tgz");
	const tar = spawnSync(
		"tar",
		["-czf", archivePath, "-C", directory, ...(options.entries ?? ["package"])],
		{ encoding: "utf8" },
	);
	if (tar.status !== 0) {
		throw new Error(`tar fixture failed: ${tar.stderr}`);
	}
	return {
		archivePath,
		packument: {
			filename: path.basename(archivePath),
			files: packedFiles.map((filePath) => ({ path: filePath })),
			name: "javi-forge",
			version: "2.0.0",
		},
	};
}

function runSeam(
	fixture: ArchiveFixture,
	overrides: Partial<ArchiveFixture> = {},
	env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof spawnSync> {
	const archivePath = overrides.archivePath ?? fixture.archivePath;
	const packument = overrides.packument ?? fixture.packument;
	return spawnSync(
		process.execPath,
		["--input-type=module", "--eval", seamRunner, "test-seam", verifierPath, archivePath, JSON.stringify(packument)],
		{ cwd: repoRoot, encoding: "utf8", env },
	);
}

function executable(directory: string, name: string, body: string): string {
	const filePath = path.join(directory, name);
	writeFileSync(filePath, `#!${process.execPath}\n${body}`);
	chmodSync(filePath, 0o755);
	return filePath;
}

function validFakeNpm(
	fixture: ArchiveFixture,
	marker: string,
	finalStatement = "",
): string {
	return `
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const destination = args[args.indexOf("--pack-destination") + 1];
const filename = ${JSON.stringify(fixture.packument.filename)};
fs.copyFileSync(${JSON.stringify(fixture.archivePath)}, path.join(destination, filename));
fs.writeFileSync(${JSON.stringify(marker)}, destination);
process.stdout.write(${JSON.stringify(JSON.stringify([fixture.packument]))});
${finalStatement}`;
}

function runProduction(
	binDirectory: string,
	args: readonly string[] = [],
	includeSystemPath = true,
): ReturnType<typeof spawnSync> {
	return spawnSync(process.execPath, [verifierPath, ...args], {
		cwd: repoRoot,
		encoding: "utf8",
		env: {
			...process.env,
			PATH: includeSystemPath
				? `${binDirectory}${path.delimiter}${process.env.PATH ?? ""}`
				: binDirectory,
		},
	});
}

afterEach(() => {
	for (const directory of tempDirs.splice(0)) {
		try {
			chmodSync(directory, 0o700);
		} catch {}
		rmSync(directory, { force: true, recursive: true });
	}
});

describe("archive-backed package platform verification", () => {
	it("wires package:check directly and preserves exact OS eligibility", () => {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		expect(packageJson.scripts["package:check"]).toBe(
			"node scripts/verify-package-contents.mjs",
		);
		expect(packageJson.os).toEqual(["linux", "win32"]);
	});

	it("rejects production arguments before invoking a child", () => {
		const directory = tempDir("javi-forge-cli-test-");
		const marker = path.join(directory, "called");
		executable(directory, "npm", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "called");`);
		const result = runProduction(directory, ["fixture.json"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toBe("Package content verification failed:\n- usage: no arguments are accepted\n");
		expect(() => readFileSync(marker)).toThrow();
	});

	it("rejects non-Linux package verification before creating temporary state", () => {
		const directory = tempDir("javi-forge-platform-test-");
		const marker = path.join(directory, "mkdtemp-called");
		const preload = path.join(directory, "win32-platform.mjs");
		writeFileSync(
			preload,
			`import fs from "node:fs";
Object.defineProperty(process, "platform", { value: "win32" });
fs.mkdtempSync = () => {
  fs.writeFileSync(${JSON.stringify(marker)}, "called");
  throw new Error("temporary state must not be created");
};\n`,
		);
		const result = spawnSync(process.execPath, ["--import", preload, verifierPath], {
			cwd: repoRoot,
			encoding: "utf8",
			env: { ...process.env, PATH: directory },
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toBe(
			"Package content verification failed:\n- platform: package content verification requires Linux\n",
		);
		expect(() => readFileSync(marker)).toThrow();
	});

	it("uses one real archive and cleans production-owned temporary state", () => {
		const fixture = createArchive();
		const directory = tempDir("javi-forge-production-test-");
		const marker = path.join(directory, "owned-temp");
		executable(directory, "npm", validFakeNpm(fixture, marker));
		const result = runProduction(directory);
		const ownedTemp = readFileSync(marker, "utf8");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Package content verification passed");
		expect(() => readFileSync(ownedTemp)).toThrow();
	});
	it.each([
		"assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs",
		"assets/claude-hooks/manifest.json",
	])("rejects omission of explicit guard package file %s", (missing) => {
		const fixture = createArchive();
		const packument = {
			...fixture.packument,
			files: fixture.packument.files.filter(({ path: filePath }) => filePath !== missing),
		};
		const result = runSeam(fixture, { packument });
		expect(result.status).toBe(1);
		expect(JSON.parse(String(result.stderr))).toContain(
			`missing required file: ${missing}`,
		);
	});
	it("ignores caller TAR_OPTIONS while verifying the real archive", () => {
		const result = runSeam(createArchive(), {}, { ...process.env, TAR_OPTIONS: "--version" });
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Package content verification passed");
	});
	it.each([
		["unavailable", undefined, "tar-list: tool unavailable", false],
		["nonzero", "process.exitCode = 7;", "tar-list: command failed (exit 7)", false],
		["listing overflow", "process.stdout.write('x'.repeat(262145));", "tar-list: output exceeds 262144 bytes", false],
		["member read failure", "const cp=require('node:child_process'); if(process.argv[2]==='-xOf') process.exitCode=8; else process.exitCode=cp.spawnSync('/usr/bin/tar',process.argv.slice(2),{stdio:'inherit'}).status;", "tar-read package/package.json: command failed (exit 8)", true],
	] as const)("fails closed when tar is %s", (_label, tarBody, diagnostic, systemPath) => {
		const fixture = createArchive(); const directory = tempDir("javi-forge-tar-failure-");
		executable(directory, "npm", validFakeNpm(fixture, path.join(directory, "owned-temp")));
		if (tarBody !== undefined) executable(directory, "tar", tarBody);
		const result = runProduction(directory, [], systemPath);
		expect(result.status).toBe(1); expect(result.stderr).toContain(diagnostic);
	});

	it.each([
		["npm unavailable", undefined, "npm-pack: tool unavailable"],
		["npm nonzero", "process.exitCode = 9;", "npm-pack: command failed (exit 9)"],
		["invalid pack UTF-8", "process.stdout.write(Buffer.from([255]));", "npm-pack: invalid UTF-8"],
		["malformed pack JSON", "process.stdout.write('{');", "npm-pack: invalid JSON"],
		["zero pack results", "process.stdout.write('[]');", "npm-pack: expected exactly one result"],
		["multiple pack results", "process.stdout.write('[{},{}]');", "npm-pack: expected exactly one result"],
		["pack output overflow", "process.stdout.write('x'.repeat(1048577));", "npm-pack: output exceeds 1048576 bytes"],
		["pack stderr overflow", "process.stderr.write('x'.repeat(1048577));", "npm-pack: output exceeds 1048576 bytes"],
	] as const)("fails closed for %s", (_label, statement, diagnostic) => {
		const directory = tempDir("javi-forge-npm-failure-");
		if (statement !== undefined) {
			executable(directory, "npm", statement);
		}
		const result = runProduction(directory, [], false);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(diagnostic);
	});

	it.each(["", "/tmp/outside.tgz", "nested/out.tgz", "../outside.tgz", "out\\side.tgz"])(
		"rejects unsafe archive filename %j",
		(filename) => {
			const fixture = createArchive();
			const result = runSeam(fixture, {
				packument: { ...fixture.packument, filename },
			});
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("archive: invalid filename");
		},
	);

	it("rejects a missing archive", () => {
		const fixture = createArchive();
		const archivePath = path.join(path.dirname(fixture.archivePath), "missing.tgz");
		const result = runSeam(fixture, {
			archivePath,
			packument: { ...fixture.packument, filename: path.basename(archivePath) },
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("archive: expected one regular file");
	});

	it("rejects a directory archive", () => {
		const fixture = createArchive();
		const archivePath = path.join(path.dirname(fixture.archivePath), "directory.tgz");
		mkdirSync(archivePath);
		const result = runSeam(fixture, {
			archivePath,
			packument: { ...fixture.packument, filename: path.basename(archivePath) },
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("archive: expected one regular file");
	});

	it("rejects a symbolic-link archive", () => {
		const fixture = createArchive();
		const linkPath = path.join(path.dirname(fixture.archivePath), "linked.tgz");
		symlinkSync(fixture.archivePath, linkPath);
		const result = runSeam(fixture, {
			archivePath: linkPath,
			packument: { ...fixture.packument, filename: "linked.tgz" },
		});
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("archive: expected one regular file");
	});

	it.each([
		["missing", ["package/package.json", "package/lib/common.sh"]],
		[
			"duplicate",
			[
				"package/package.json",
				"package/lib/common.sh",
				"package/lib/common.sh",
				"package/ci-local/lib/common.sh",
			],
		],
	] as const)("rejects a %s exact member", (_label, entries) => {
		const fixture = createArchive({ entries });
		const result = runSeam(fixture);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("archive-members:");
	});

	it("rejects a non-regular exact member", () => {
		const fixture = createArchive({
			mutate(packageRoot) {
				rmSync(path.join(packageRoot, "lib/common.sh"));
				symlinkSync("../package.json", path.join(packageRoot, "lib/common.sh"));
			},
		});
		const result = runSeam(fixture);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("archive-members: non-regular package/lib/common.sh");
	});

	it.each([
		["invalid package UTF-8", { metadata: Buffer.from([255]) }, "package-metadata: invalid UTF-8"],
		["malformed package JSON", { metadata: "{" }, "package-metadata: invalid JSON"],
		["invalid helper UTF-8", { libHelper: Buffer.from([255]) }, "package/lib/common.sh: invalid UTF-8"],
		[
			"identity mismatch",
			{ metadata: { name: "other", version: "2.0.0", os: ["linux", "win32"] } },
			"package-metadata: identity mismatch",
		],
		[
			"OS mismatch",
			{ metadata: { name: "javi-forge", version: "2.0.0", os: ["win32", "linux"] } },
			'package-metadata: os must be exactly ["linux","win32"]',
		],
	] as const)("fails closed for %s", (_label, options, diagnostic) => {
		const result = runSeam(createArchive(options));
		expect(result.status).toBe(1);
		expect(JSON.parse(String(result.stderr))).toContain(diagnostic);
	});

	it.each(["macOS", "MACOS", "(macOS)", "macOS-compatible", "_DARWIN_", "\nDarwin\n", "éDarwiné"])(
		"rejects delimited helper token %j",
		(token) => {
			const result = runSeam(createArchive({ libHelper: token }));
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("package/lib/common.sh: forbidden token");
		},
	);

	it.each(["macOSonic", "Darwinian", "premacOS", "Darwin2"])(
		"accepts larger-word helper substring %j",
		(token) => {
			const result = runSeam(createArchive({ libHelper: token }));
			expect(result.status).toBe(0);
		},
	);

	it("orders every violation by canonical member then byte position", () => {
		const result = runSeam(
			createArchive({
				ciHelper: "Darwin macOS",
				libHelper: "xx macOS Darwin",
			}),
		);
		expect(result.status).toBe(1);
		expect(JSON.parse(String(result.stderr).trim())).toEqual([
			"package/lib/common.sh: forbidden token macos at byte 3",
			"package/lib/common.sh: forbidden token darwin at byte 9",
			"package/ci-local/lib/common.sh: forbidden token darwin at byte 0",
			"package/ci-local/lib/common.sh: forbidden token macos at byte 7",
		]);
		expect(result.stderr).not.toContain("javi-forge-archive-test-");
	});

	it("uses archive bytes when workspace helper bytes differ", () => {
		const fixture = createArchive({ libHelper: "macOSonic\n" });
		const result = runSeam(fixture);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("Package content verification passed");
	});

	it("rejects oversized member output", () => {
		const result = runSeam(createArchive({ libHelper: "x".repeat(262_145) }));
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"tar-read package/lib/common.sh: output exceeds 262144 bytes",
		);
	});

	it.each([["cleanup only", false], ["after a primary diagnostic", true]] as const)("reports cleanup failure %s", (_label, hasPrimary) => {
		const fixture = createArchive();
		const directory = tempDir("javi-forge-cleanup-test-");
		const marker = path.join(directory, "owned-temp");
		const preload = path.join(directory, "fail-cleanup.mjs");
		writeFileSync(
			preload,
			'import fs from "node:fs"; fs.rmSync = () => { throw new Error("injected cleanup failure"); };\n',
		);
		const primaryBody = `
const fs = require("node:fs");
const args = process.argv.slice(2);
const destination = args[args.indexOf("--pack-destination") + 1];
fs.writeFileSync(${JSON.stringify(marker)}, destination);
process.stdout.write("{");`;
		executable(directory, "npm", hasPrimary ? primaryBody : validFakeNpm(fixture, marker));
		const result = spawnSync(
			process.execPath,
			["--import", preload, verifierPath],
			{
				cwd: repoRoot,
				encoding: "utf8",
				env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}` },
			},
		);
		const primary = result.stderr.indexOf("npm-pack: invalid JSON");
		const cleanup = result.stderr.indexOf("cleanup: unable to remove temporary artifacts");
		expect(result.status).toBe(1);
		expect(primary > -1).toBe(hasPrimary);
		expect(cleanup).toBeGreaterThan(primary);
		const ownedTemp = readFileSync(marker, "utf8");
		rmSync(ownedTemp, { force: true, recursive: true });
	});

	it("rejects test seam keys beyond archivePath and packument", () => {
		const fixture = createArchive();
		const runner = seamRunner.replace(
			"packument: JSON.parse(process.argv[4]),",
			'packument: JSON.parse(process.argv[4]), packageRoot: ".",',
		);
		const result = spawnSync(
			process.execPath,
			["--input-type=module", "--eval", runner, "test-seam", verifierPath, fixture.archivePath, JSON.stringify(fixture.packument)],
			{ cwd: repoRoot, encoding: "utf8" },
		);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("test-seam: expected only archivePath and packument");
	});
});
