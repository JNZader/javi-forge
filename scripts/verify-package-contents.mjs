#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REQUIRED_FILES = [
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
	// Every hook asset is asserted BY NAME, not by tree: REQUIRED_PREFIXES passes
	// as soon as ANY single path under assets/ is packed, so a tarball shipping
	// pre-commit while silently dropping commit-msg would pass both checks while
	// `ci init` fails at runtime. installCIHooks reads all four at install time.
	"assets/hooks/pre-commit",
	"assets/hooks/pre-push",
	"assets/hooks/commit-msg",
	"assets/hooks/manifest.json",
	// Slice 3b: the digest-bound win32 secure-object helper MUST ship — the
	// manifest binds its sha256 and the win32 installer refuses without it, so a
	// tarball that silently dropped it would fail closed on every Windows run.
	// Asserted BY NAME so an omission (or a rename) fails `pnpm package:check`.
	"assets/claude-hooks/javi-forge-skillguard-pre-tool-use.mjs",
	"assets/claude-hooks/manifest.json",
	"assets/claude-hooks/javi-forge-windows-secure-object.ps1",
	"assets/opencode-plugins/javi-forge-skillguard-plugin.mjs",
	"assets/opencode-plugins/manifest.json",
	"assets/grok-hooks/manifest.json",
	"templates/github/ci-node.yml",
	"modules/engram/install-engram.sh",
	"workflows/reusable-build-node.yml",
	"ci-local/ci-local.sh",
	// PKG-002: every stack Dockerfile MUST ship so ensureImage's bundled
	// fallback dir is complete and the first-run write-through (EACCES on
	// root-owned global installs) never fires. Asserted BY NAME, one per
	// stack getDockerfileContent produces, plus the shell scripts' shared
	// java.Dockerfile and the default/ubuntu template (elixir.Dockerfile).
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

const REQUIRED_PREFIXES = [
	"assets/",
	"dist/commands/",
	"dist/lib/",
	"dist/tasks/",
	"dist/ui/",
	"dist/types/",
	"templates/",
	"modules/",
	"workflows/",
	"ci-local/",
];

const FORBIDDEN_PREFIXES = [
	"src/",
	"coverage/",
	"reports/",
	"node_modules/",
	".github/",
	".vscode/",
	".idea/",
	"docs/",
	"dist/__integration__/",
	"dist/e2e/",
	".pytest_cache/",
	".ruff_cache/",
	".javi-forge/",
	".stryker-tmp/",
];

const FORBIDDEN_FILES = [
	".releaserc",
	"tsconfig.json",
	"vitest.config.ts",
	"stryker.config.json",
	"biome.json",
];

const ALLOWED_SENSITIVE_EXAMPLES = new Set([
	"modules/ghagga/.env.example",
	"templates/local-ai/.env.example",
]);

const SUPPORTED_OS = ["linux", "win32"];

const REQUIRED_ARCHIVE_MEMBERS = [
	"package/package.json",
	"package/lib/common.sh",
	"package/ci-local/lib/common.sh",
];
const PACK_OUTPUT_LIMIT = 1_048_576;
const TAR_LIST_OUTPUT_LIMIT = 262_144;
const MEMBER_OUTPUT_LIMIT = 262_144;

const FORBIDDEN_PATTERNS = [
	/(^|\/)\.env($|\.)/,
	/(^|\/)credentials?(\.|\/|$)/i,
	/(^|\/)secrets?(\/|$)/i,
	/(^|\/)oauth(\.|\/|$)/i,
	/(^|\/)npm-debug\.log$/,
	/\.test\.[cm]?[jt]sx?$/,
	/\.test\.sh$/,
	/\.spec\.[cm]?[jt]sx?$/,
	/\.map$/,
	/\.log$/,
	/\.jsonl$/,
	/\.(sqlite|sqlite3|db|db-wal|db-shm)$/,
];

class VerificationFailure extends Error {
	constructor(messages) {
		super(messages[0]);
		this.messages = messages;
	}
}

function fail(...messages) {
	throw new VerificationFailure(messages);
}

function strictUtf8(buffer, phase) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		fail(`${phase}: invalid UTF-8`);
	}
}

function run(command, args, phase, limit, env) {
	const result = spawnSync(command, args, {
		encoding: null,
		env,
		maxBuffer: limit,
		shell: false,
	});
	if (result.error?.code === "ENOBUFS") {
		fail(`${phase}: output exceeds ${limit} bytes`);
	}
	if (result.error?.code === "ENOENT") {
		fail(`${phase}: tool unavailable`);
	}
	if (result.error) {
		fail(`${phase}: command failed`);
	}
	if (result.status !== 0) {
		fail(`${phase}: command failed (exit ${result.status})`);
	}
	return result.stdout;
}

function runNpm(args, phase, limit) {
	return run("npm", args, phase, limit, {
		...process.env,
		LANG: "C",
		LC_ALL: "C",
	});
}

function runTar(args, phase, limit) {
	return run("tar", args, phase, limit, {
		PATH: process.env.PATH ?? "",
		LANG: "C",
		LC_ALL: "C",
	});
}

function parseJson(buffer, phase) {
	try {
		return JSON.parse(strictUtf8(buffer, phase));
	} catch (error) {
		if (error instanceof VerificationFailure) throw error;
		fail(`${phase}: invalid JSON`);
	}
}

function validateFilename(filename) {
	if (
		typeof filename !== "string" ||
		filename.length === 0 ||
		filename === "." ||
		filename === ".." ||
		path.isAbsolute(filename) ||
		filename.includes("/") ||
		filename.includes("\\")
	) {
		fail("archive: invalid filename");
	}
}

// biome-ignore format: compact validation keeps the atomic verifier within the chained PR review budget.
function validateShape(packument) {
	if (!packument || !Array.isArray(packument.files)) {
		fail("npm-pack: result has no file manifest");
	}
	const files = packument.files.map((file) => file?.path);
	if (files.some((file) => typeof file !== "string")) {
		fail("npm-pack: invalid file manifest");
	}
	files.sort();
	const fileSet = new Set(files);
	const errors = [];
	for (const requiredFile of REQUIRED_FILES) {
		if (!fileSet.has(requiredFile)) errors.push(`missing required file: ${requiredFile}`);
	}
	for (const requiredPrefix of REQUIRED_PREFIXES) {
		if (!files.some((file) => file.startsWith(requiredPrefix))) {
			errors.push(`missing required asset tree: ${requiredPrefix}`);
		}
	}
	for (const forbiddenFile of FORBIDDEN_FILES) {
		if (fileSet.has(forbiddenFile)) errors.push(`forbidden file included: ${forbiddenFile}`);
	}
	for (const forbiddenPrefix of FORBIDDEN_PREFIXES) {
		const match = files.find((file) => file.startsWith(forbiddenPrefix));
		if (match) errors.push(`forbidden asset included from ${forbiddenPrefix}: ${match}`);
	}
	for (const forbiddenPattern of FORBIDDEN_PATTERNS) {
		const match = files.find(
			(file) => forbiddenPattern.test(file) && !ALLOWED_SENSITIVE_EXAMPLES.has(file),
		);
		if (match) errors.push(`forbidden asset included: ${match}`);
	}
	if (errors.length > 0) fail(...errors);
	return files;
}

function isAsciiAlphanumeric(byte) {
	return (
		(byte >= 48 && byte <= 57) ||
		(byte >= 65 && byte <= 90) ||
		(byte >= 97 && byte <= 122)
	);
}

// biome-ignore format: compact byte scanner keeps token ordering auditable within the review budget.
function tokenViolations(member, bytes) {
	const lower = Buffer.from(bytes.map((byte) => (byte >= 65 && byte <= 90 ? byte + 32 : byte)));
	const violations = [];
	for (const token of ["macos", "darwin"]) {
		const needle = Buffer.from(token);
		let start = lower.indexOf(needle);
		while (start !== -1) {
			const before = start === 0 ? undefined : bytes[start - 1];
			const afterIndex = start + needle.length;
			const after = afterIndex === bytes.length ? undefined : bytes[afterIndex];
			if (
				(before === undefined || !isAsciiAlphanumeric(before)) &&
				(after === undefined || !isAsciiAlphanumeric(after))
			) {
				violations.push({ message: `${member}: forbidden token ${token} at byte ${start}`, start });
			}
			start = lower.indexOf(needle, start + 1);
		}
	}
	return violations.sort((left, right) => left.start - right.start).map(({ message }) => message);
}

// biome-ignore format: one compact archive flow keeps membership, metadata, and token checks reviewable together.
export function verifyArchive(input) {
	if (
		!input ||
		Object.keys(input).sort().join(",") !== "archivePath,packument"
	) {
		fail("test-seam: expected only archivePath and packument");
	}
	const { archivePath, packument } = input;
	validateFilename(packument?.filename);
	if (path.basename(archivePath) !== packument.filename) fail("archive: filename mismatch");
	let archiveStat;
	try {
		archiveStat = fs.lstatSync(archivePath);
	} catch {
		fail("archive: expected one regular file");
	}
	if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) {
		fail("archive: expected one regular file");
	}
	const files = validateShape(packument);
	const list = strictUtf8(
		runTar(["-tf", archivePath], "tar-list", TAR_LIST_OUTPUT_LIMIT),
		"tar-list",
	).split("\n");
	const verbose = strictUtf8(
		runTar(["-tvf", archivePath], "tar-list", TAR_LIST_OUTPUT_LIMIT),
		"tar-list",
	).split("\n");
	for (const member of REQUIRED_ARCHIVE_MEMBERS) {
		const count = list.filter((entry) => entry === member).length;
		if (count !== 1) fail(`archive-members: expected exactly one ${member}; received ${count}`);
		const rows = verbose.filter((entry) => entry.endsWith(` ${member}`));
		if (rows.length !== 1 || !rows[0].startsWith("-")) {
			fail(`archive-members: non-regular ${member}`);
		}
	}
	const memberBytes = new Map(
		REQUIRED_ARCHIVE_MEMBERS.map((member) => [
			member,
			runTar(["-xOf", archivePath, member], `tar-read ${member}`, MEMBER_OUTPUT_LIMIT),
		]),
	);
	const metadata = parseJson(memberBytes.get("package/package.json"), "package-metadata");
	if (metadata.name !== packument.name || metadata.version !== packument.version) {
		fail("package-metadata: identity mismatch");
	}
	if (
		!Array.isArray(metadata.os) ||
		metadata.os.length !== SUPPORTED_OS.length ||
		metadata.os.some((entry, index) => entry !== SUPPORTED_OS[index])
	) {
		fail(`package-metadata: os must be exactly ${JSON.stringify(SUPPORTED_OS)}`);
	}
	const violations = REQUIRED_ARCHIVE_MEMBERS.slice(1).flatMap((member) => {
		const bytes = memberBytes.get(member);
		strictUtf8(bytes, member);
		return tokenViolations(member, bytes);
	});
	if (violations.length > 0) fail(...violations);
	const counts = {
		dts: files.filter((file) => file.endsWith(".d.ts")).length,
		js: files.filter((file) => file.endsWith(".js")).length,
		modules: files.filter((file) => file.startsWith("modules/")).length,
		templates: files.filter((file) => file.startsWith("templates/")).length,
		workflows: files.filter((file) => file.startsWith("workflows/")).length,
	};
	return {
		summary: `Package content verification passed: ${files.length} files, ${counts.js} js, ${counts.dts} declarations, ${counts.templates} templates, ${counts.modules} modules, ${counts.workflows} workflows.`,
	};
}

// biome-ignore format: compact deterministic fallback avoids non-contract diagnostics.
function failureMessages(error) {
	return error instanceof VerificationFailure ? error.messages : ["internal: verification failed"];
}

function printFailure(messages) {
	console.error("Package content verification failed:");
	for (const message of messages) console.error(`- ${message}`);
}

// biome-ignore format: compact lifecycle keeps pack, verification, and cleanup ordering together.
function main(args) {
	if (args.length > 0) {
		printFailure(["usage: no arguments are accepted"]);
		return 1;
	}
	if (process.platform !== "linux") {
		printFailure(["platform: package content verification requires Linux"]);
		return 1;
	}
	let temporaryDirectory;
	let summary;
	let messages = [];
	try {
		temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-package-check-"));
		const packOutput = runNpm(
			["pack", "--json", "--pack-destination", temporaryDirectory],
			"npm-pack",
			PACK_OUTPUT_LIMIT,
		);
		const parsed = parseJson(packOutput, "npm-pack");
		if (!Array.isArray(parsed) || parsed.length !== 1) {
			fail("npm-pack: expected exactly one result");
		}
		const [packument] = parsed;
		validateFilename(packument?.filename);
		const archivePath = path.resolve(temporaryDirectory, packument.filename);
		if (path.dirname(archivePath) !== temporaryDirectory) fail("archive: invalid filename");
		const entries = fs.readdirSync(temporaryDirectory);
		if (entries.length !== 1 || entries[0] !== packument.filename) {
			fail("archive: expected exactly one pack result/archive");
		}
		summary = verifyArchive({ archivePath, packument }).summary;
	} catch (error) {
		messages = failureMessages(error);
	} finally {
		if (temporaryDirectory) {
			try {
				fs.rmSync(temporaryDirectory, { force: true, recursive: true });
			} catch {
				messages.push("cleanup: unable to remove temporary artifacts");
			}
		}
	}
	if (messages.length > 0) {
		printFailure(messages);
		return 1;
	}
	console.log(summary);
	return 0;
}

if (
	process.argv[1] &&
	pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
	process.exitCode = main(process.argv.slice(2));
}
