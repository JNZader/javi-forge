#!/usr/bin/env node
import fs from "node:fs";

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

function readPackedFiles(manifestPath) {
	if (!manifestPath) {
		throw new Error(
			"Usage: node scripts/verify-package-contents.mjs <npm-pack-json-output>",
		);
	}

	const output = fs.readFileSync(manifestPath, "utf-8").trim();
	if (!output) {
		throw new Error(`Package manifest is empty: ${manifestPath}`);
	}

	const parsed = JSON.parse(output);
	const [packument] = parsed;
	if (!packument || !Array.isArray(packument.files)) {
		throw new Error("npm pack did not return a file manifest");
	}
	return packument.files.map((file) => file.path).sort();
}

function fail(messages) {
	console.error("Package content verification failed:");
	for (const message of messages) {
		console.error(`- ${message}`);
	}
	process.exit(1);
}

const files = readPackedFiles(process.argv[2]);
const fileSet = new Set(files);
const errors = [];

for (const requiredFile of REQUIRED_FILES) {
	if (!fileSet.has(requiredFile)) {
		errors.push(`missing required file: ${requiredFile}`);
	}
}

for (const requiredPrefix of REQUIRED_PREFIXES) {
	if (!files.some((file) => file.startsWith(requiredPrefix))) {
		errors.push(`missing required asset tree: ${requiredPrefix}`);
	}
}

for (const forbiddenFile of FORBIDDEN_FILES) {
	if (fileSet.has(forbiddenFile)) {
		errors.push(`forbidden file included: ${forbiddenFile}`);
	}
}

for (const forbiddenPrefix of FORBIDDEN_PREFIXES) {
	const match = files.find((file) => file.startsWith(forbiddenPrefix));
	if (match) {
		errors.push(`forbidden asset included from ${forbiddenPrefix}: ${match}`);
	}
}

for (const forbiddenPattern of FORBIDDEN_PATTERNS) {
	const match = files.find(
		(file) =>
			forbiddenPattern.test(file) && !ALLOWED_SENSITIVE_EXAMPLES.has(file),
	);
	if (match) {
		errors.push(`forbidden asset included: ${match}`);
	}
}

if (errors.length > 0) {
	fail(errors);
}

const jsCount = files.filter((file) => file.endsWith(".js")).length;
const dtsCount = files.filter((file) => file.endsWith(".d.ts")).length;
const templateCount = files.filter((file) =>
	file.startsWith("templates/"),
).length;
const moduleCount = files.filter((file) => file.startsWith("modules/")).length;
const workflowCount = files.filter((file) =>
	file.startsWith("workflows/"),
).length;
console.log(
	`Package content verification passed: ${files.length} files, ${jsCount} js, ${dtsCount} declarations, ${templateCount} templates, ${moduleCount} modules, ${workflowCount} workflows.`,
);
