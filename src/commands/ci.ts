import { execFile, spawn } from "child_process";
import fs from "fs-extra";
import path from "path";
import { promisify } from "util";
import { refreshContextDir } from "../lib/context.js";
import {
	ensureImage,
	isDockerAvailable,
	openShell,
	runInContainer,
} from "../lib/docker.js";
import type { Stack } from "../types/index.js";

const execFileAsync = promisify(execFile);

// =============================================================================
// Types
// =============================================================================

export type CIMode = "full" | "quick" | "shell" | "detect";

export interface CIOptions {
	projectDir?: string;
	mode?: CIMode;
	/** Skip Docker entirely — run commands natively */
	noDocker?: boolean;
	/** Skip GHAGGA review step */
	noGhagga?: boolean;
	/** Skip Semgrep security scan */
	noSecurity?: boolean;
	/** Timeout in seconds for each Docker step (default: 600) */
	timeout?: number;
}

export type CIStepStatus = "pending" | "running" | "done" | "error" | "skipped";

export interface CIStep {
	id: string;
	label: string;
	status: CIStepStatus;
	detail?: string;
}

export type CIStepCallback = (step: CIStep) => void;

export interface CIStackInfo {
	stackType: Stack;
	buildTool: string;
	javaVersion: string;
	lintCmd: string | null;
	compileCmd: string | null;
	testCmd: string | null;
}

// =============================================================================
// Stack detection
// =============================================================================

export async function detectCIStack(projectDir: string): Promise<CIStackInfo> {
	let stackType: Stack = "node";
	let buildTool = "npm";
	let javaVersion = "21";

	// Java Gradle
	if (
		(await fs.pathExists(path.join(projectDir, "build.gradle.kts"))) ||
		(await fs.pathExists(path.join(projectDir, "build.gradle")))
	) {
		stackType = "java-gradle";
		buildTool = "gradle";
		// Try to read java version from build files
		const ktsPath = path.join(projectDir, "build.gradle.kts");
		const gradlePath = path.join(projectDir, "build.gradle");
		if (await fs.pathExists(ktsPath)) {
			const content = await fs.readFile(ktsPath, "utf-8");
			const match = content.match(/JavaLanguageVersion\.of\((\d+)\)/);
			if (match?.[1]) javaVersion = match[1];
		} else if (await fs.pathExists(gradlePath)) {
			const content = await fs.readFile(gradlePath, "utf-8");
			const match = content.match(/sourceCompatibility\s*=\s*['"]*(\d+)/);
			if (match?.[1]) javaVersion = match[1];
		}
	}
	// Java Maven
	else if (await fs.pathExists(path.join(projectDir, "pom.xml"))) {
		stackType = "java-maven";
		buildTool = "mvn";
	}
	// Node
	else if (await fs.pathExists(path.join(projectDir, "package.json"))) {
		stackType = "node";
		if (await fs.pathExists(path.join(projectDir, "pnpm-lock.yaml")))
			buildTool = "pnpm";
		else if (await fs.pathExists(path.join(projectDir, "yarn.lock")))
			buildTool = "yarn";
		else buildTool = "npm";
	}
	// Go
	else if (await fs.pathExists(path.join(projectDir, "go.mod"))) {
		stackType = "go";
		buildTool = "go";
	}
	// Rust
	else if (await fs.pathExists(path.join(projectDir, "Cargo.toml"))) {
		stackType = "rust";
		buildTool = "cargo";
	}
	// Python
	else if (
		(await fs.pathExists(path.join(projectDir, "pyproject.toml"))) ||
		(await fs.pathExists(path.join(projectDir, "requirements.txt"))) ||
		(await fs.pathExists(path.join(projectDir, "setup.py")))
	) {
		stackType = "python";
		if (await fs.pathExists(path.join(projectDir, "uv.lock"))) buildTool = "uv";
		else if (await fs.pathExists(path.join(projectDir, "poetry.lock")))
			buildTool = "poetry";
		else buildTool = "pip";
	}

	// Build CI commands per stack
	const { lintCmd, compileCmd, testCmd } = await buildCICommands(
		stackType,
		buildTool,
		projectDir,
	);

	return { stackType, buildTool, javaVersion, lintCmd, compileCmd, testCmd };
}

async function buildCICommands(
	stack: Stack,
	buildTool: string,
	projectDir: string,
): Promise<{
	lintCmd: string | null;
	compileCmd: string | null;
	testCmd: string | null;
}> {
	switch (stack) {
		case "java-gradle":
			return {
				lintCmd: "./gradlew spotlessCheck --no-daemon",
				compileCmd:
					"./gradlew clean classes testClasses --no-daemon && chown -R runner:runner build/ .gradle/ 2>/dev/null || true",
				testCmd: "./gradlew test --no-daemon",
			};
		case "java-maven":
			return {
				lintCmd: "./mvnw spotless:check",
				compileCmd:
					"./mvnw clean compile test-compile && chown -R runner:runner target/ .mvn/ 2>/dev/null || true",
				testCmd: "./mvnw test",
			};
		case "node": {
			const pkgPath = path.join(projectDir, "package.json");
			let pkgContent = "";
			try {
				pkgContent = await fs.readFile(pkgPath, "utf-8");
			} catch {
				/* no package.json */
			}
			// Clean dist/ before build and chown after so tests (as runner) can access output.
			// Runs as root inside the container to handle host-owned output dirs.
			const buildPrefix = "rm -rf dist/ && ";
			const buildSuffix =
				" && chown -R runner:runner dist/ 2>/dev/null || true";
			return {
				lintCmd: pkgContent.includes('"lint"') ? `${buildTool} run lint` : null,
				compileCmd: pkgContent.includes('"build"')
					? `${buildPrefix}${buildTool} run build${buildSuffix}`
					: null,
				testCmd: pkgContent.includes('"test"')
					? `${buildTool} ${buildTool === "npm" ? "test" : "run test"}`
					: null,
			};
		}
		case "python":
			return {
				lintCmd: "ruff check . && { pylint **/*.py 2>/dev/null || true; }",
				compileCmd: null,
				testCmd: "pytest",
			};
		case "go":
			return {
				lintCmd: "golangci-lint run",
				compileCmd:
					"go clean -cache && go build ./... && chown -R runner:runner . 2>/dev/null || true",
				testCmd: "go test ./...",
			};
		case "rust":
			return {
				lintCmd: "cargo clippy -- -D warnings",
				compileCmd:
					"cargo clean && cargo build && chown -R runner:runner target/ 2>/dev/null || true",
				testCmd: "cargo test",
			};
		default:
			return { lintCmd: null, compileCmd: null, testCmd: null };
	}
}

// =============================================================================
// GHAGGA check
// =============================================================================

async function isGhaggaAvailable(): Promise<boolean> {
	try {
		await execFileAsync("ghagga", ["--version"], { timeout: 3000 });
		return true;
	} catch {
		return false;
	}
}

// =============================================================================
// Main CI runner
// =============================================================================

function report(
	onStep: CIStepCallback,
	id: string,
	label: string,
	status: CIStepStatus,
	detail?: string,
) {
	onStep({ id, label, status, detail });
}

export async function runCI(
	options: CIOptions,
	onStep: CIStepCallback,
): Promise<void> {
	const {
		projectDir = process.cwd(),
		mode = "full",
		noDocker = false,
		noGhagga = false,
		noSecurity = false,
		timeout = 600,
	} = options;

	// ── Detect stack ────────────────────────────────────────────────────────────
	const stepDetect = "detect";
	report(onStep, stepDetect, "Detecting stack", "running");
	let stackInfo: CIStackInfo;
	try {
		stackInfo = await detectCIStack(projectDir);
		report(
			onStep,
			stepDetect,
			`Stack: ${stackInfo.stackType} (${stackInfo.buildTool})`,
			"done",
		);
	} catch (e) {
		report(onStep, stepDetect, "Detecting stack", "error", String(e));
		throw e;
	}

	// ── Detect mode ─────────────────────────────────────────────────────────────
	if (mode === "detect") return;

	// ── Shell mode ──────────────────────────────────────────────────────────────
	if (mode === "shell") {
		if (noDocker) {
			report(onStep, "shell", "Shell", "error", "--shell requires Docker");
			throw new Error("--shell requires Docker");
		}
		report(onStep, "docker-image", "Building Docker image", "running");
		try {
			await ensureImage({
				stack: stackInfo.stackType,
				javaVersion: stackInfo.javaVersion,
			});
			report(onStep, "docker-image", "Docker image ready", "done");
		} catch (e) {
			report(
				onStep,
				"docker-image",
				"Building Docker image",
				"error",
				String(e),
			);
			throw e;
		}
		await openShell(projectDir);
		return;
	}

	// ── Check Docker ─────────────────────────────────────────────────────────────
	if (!noDocker) {
		const stepDocker = "docker-check";
		report(onStep, stepDocker, "Checking Docker", "running");
		const dockerOk = await isDockerAvailable();
		if (!dockerOk) {
			report(
				onStep,
				stepDocker,
				"Docker not available",
				"error",
				"Start Docker or use --no-docker",
			);
			throw new Error("Docker is not available");
		}
		report(onStep, stepDocker, "Docker available", "done");

		// Build image
		const stepImage = "docker-image";
		report(
			onStep,
			stepImage,
			`Building image for ${stackInfo.stackType}`,
			"running",
		);
		try {
			await ensureImage({
				stack: stackInfo.stackType,
				javaVersion: stackInfo.javaVersion,
			});
			report(onStep, stepImage, "Docker image ready", "done");
		} catch (e) {
			report(onStep, stepImage, "Building Docker image", "error", String(e));
			throw e;
		}
	}

	// ── Refresh .context/ ────────────────────────────────────────────────────────
	const stepContext = "context-refresh";
	report(onStep, stepContext, "Refresh .context/ directory", "running");
	try {
		const ctxResult = await refreshContextDir(projectDir);
		if (ctxResult) {
			report(
				onStep,
				stepContext,
				"Refresh .context/ directory",
				"done",
				"INDEX.md + summary.md updated",
			);
		} else {
			report(
				onStep,
				stepContext,
				"Refresh .context/ directory",
				"skipped",
				"no .context/ or no manifest",
			);
		}
	} catch (e) {
		// Non-fatal: context refresh failure should not block CI
		report(
			onStep,
			stepContext,
			"Refresh .context/ directory",
			"error",
			String(e),
		);
	}

	// ── Lint ─────────────────────────────────────────────────────────────────────
	if (stackInfo.lintCmd) {
		const stepLint = "lint";
		report(onStep, stepLint, `Lint: ${stackInfo.lintCmd}`, "running");
		try {
			await runStep(stackInfo.lintCmd, projectDir, noDocker, timeout);
			report(onStep, stepLint, "Lint passed", "done");
		} catch (e) {
			report(onStep, stepLint, "Lint failed", "error", String(e));
			throw e;
		}
	}

	// ── Compile ──────────────────────────────────────────────────────────────────
	if (stackInfo.compileCmd) {
		const stepCompile = "compile";
		report(onStep, stepCompile, `Compile: ${stackInfo.compileCmd}`, "running");
		try {
			// Run as root inside the container to rm/build output dirs owned by any host user,
			// then chown back to runner so subsequent test steps can read the output.
			await runStep(
				stackInfo.compileCmd,
				projectDir,
				noDocker,
				timeout,
				"root",
			);
			report(onStep, stepCompile, "Compile passed", "done");
		} catch (e) {
			report(onStep, stepCompile, "Compile failed", "error", String(e));
			throw e;
		}
	}

	// ── Test (full mode only) ────────────────────────────────────────────────────
	if (mode === "full" && stackInfo.testCmd) {
		const stepTest = "test";
		report(onStep, stepTest, `Test: ${stackInfo.testCmd}`, "running");
		try {
			await runStep(stackInfo.testCmd, projectDir, noDocker, timeout);
			report(onStep, stepTest, "Tests passed", "done");
		} catch (e) {
			report(onStep, stepTest, "Tests failed", "error", String(e));
			throw e;
		}
	}

	// ── Security scan (full mode only) ──────────────────────────────────────────
	if (mode === "full" && !noSecurity) {
		const stepSecurity = "security";
		const semgrepAvailable = await isSemgrepAvailable();
		if (semgrepAvailable) {
			report(onStep, stepSecurity, "Security scan (Semgrep)", "running");
			try {
				await runSemgrep(projectDir);
				report(onStep, stepSecurity, "Security scan passed", "done");
			} catch (e) {
				report(
					onStep,
					stepSecurity,
					"Security scan failed",
					"error",
					String(e),
				);
				throw e;
			}
		} else {
			report(
				onStep,
				stepSecurity,
				"Security scan",
				"skipped",
				"Semgrep not available — install semgrep or Docker",
			);
		}
	}

	// ── GHAGGA review (full mode only) ──────────────────────────────────────────
	if (mode === "full" && !noGhagga) {
		const stepGhagga = "ghagga";
		const ghagga = await isGhaggaAvailable();
		if (ghagga) {
			report(onStep, stepGhagga, "GHAGGA review", "running");
			try {
				await runGhagga(projectDir);
				report(onStep, stepGhagga, "GHAGGA review passed", "done");
			} catch (e) {
				report(onStep, stepGhagga, "GHAGGA review failed", "error", String(e));
				throw e;
			}
		} else {
			report(
				onStep,
				stepGhagga,
				"GHAGGA review",
				"skipped",
				"ghagga not installed",
			);
		}
	}
}

// =============================================================================
// Step runners
// =============================================================================

async function runStep(
	command: string,
	projectDir: string,
	noDocker: boolean,
	timeout: number,
	user?: string,
): Promise<void> {
	if (noDocker) {
		// Run natively
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("bash", ["-c", command], {
				cwd: projectDir,
				stdio: "inherit",
				env: { ...process.env, CI: "true" },
			});
			proc.on("close", (code) =>
				code === 0
					? resolve()
					: reject(new Error(`Command failed with code ${code}`)),
			);
			proc.on("error", reject);
		});
	} else {
		const result = await runInContainer({
			projectDir,
			command: `cd /home/runner/work && ${command}`,
			timeout,
			stream: true,
			user,
		});
		if (result.exitCode !== 0) {
			throw new Error(`Command failed with exit code ${result.exitCode}`);
		}
	}
}

async function isSemgrepAvailable(): Promise<boolean> {
	try {
		await execFileAsync("semgrep", ["--version"], { timeout: 3000 });
		return true;
	} catch {
		return false;
	}
}

async function runSemgrep(projectDir: string): Promise<void> {
	// Look for semgrep config in project or use auto
	const semgrepConfig = (await fs.pathExists(
		path.join(projectDir, ".semgrep.yml"),
	))
		? path.join(projectDir, ".semgrep.yml")
		: "auto";

	await new Promise<void>((resolve, reject) => {
		const proc = spawn(
			"semgrep",
			["--config", semgrepConfig, "--severity", "ERROR", "--quiet", "."],
			{
				cwd: projectDir,
				stdio: "inherit",
			},
		);
		proc.on("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`Semgrep found issues (exit ${code})`)),
		);
		proc.on("error", reject);
	});
}

async function runGhagga(projectDir: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const proc = spawn("ghagga", ["review", "--plain", "--exit-on-issues"], {
			cwd: projectDir,
			stdio: "inherit",
		});
		proc.on("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`GHAGGA review found issues (exit ${code})`)),
		);
		proc.on("error", reject);
	});
}

// =============================================================================
// CI Hooks Installation
// =============================================================================

const PRE_COMMIT_HOOK = `#!/bin/bash
# Pre-commit: quick CI check via javi-forge
# To skip: git commit --no-verify
set -e
echo "PRE-COMMIT: Running quick check..."
if command -v javi-forge &>/dev/null; then
  javi-forge ci --quick --no-docker --no-security --no-ci-ghagga
else
  npx javi-forge ci --quick --no-docker --no-security --no-ci-ghagga
fi || {
  echo ""
  echo "Quick check FAILED — fix the issues above before committing."
  echo "To skip: git commit --no-verify"
  exit 1
}
`;

const PRE_PUSH_HOOK = `#!/bin/bash
# Pre-push: full CI simulation via javi-forge
# To skip: git push --no-verify
set -e
if ! docker info &>/dev/null; then
  echo "PRE-PUSH: Docker is not running."
  echo "  Start Docker or use: git push --no-verify"
  exit 1
fi
echo "PRE-PUSH: Running CI simulation..."
if command -v javi-forge &>/dev/null; then
  javi-forge ci
else
  npx javi-forge ci
fi || {
  echo ""
  echo "CI FAILED — push aborted. Fix the issues above."
  echo "To skip: git push --no-verify"
  exit 1
}
`;

const COMMIT_MSG_HOOK = `#!/bin/bash
# Commit-msg: block AI attribution in commit messages
set -e
COMMIT_MSG_FILE="$1"
COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")

AI_PATTERNS=(
  "co-authored-by:.*claude" "co-authored-by:.*anthropic"
  "co-authored-by:.*gpt" "co-authored-by:.*openai"
  "co-authored-by:.*copilot" "co-authored-by:.*gemini"
  "co-authored-by:.*\\\\bai\\\\b"
  "made by claude" "made by gpt" "made by ai"
  "generated by claude" "generated by gpt" "generated by ai"
  "written by claude" "written by ai"
  "claude code" "claude opus" "claude sonnet" "claude haiku"
  "gpt-4" "gpt-3" "chatgpt"
  "@anthropic.com" "@openai.com"
)

for pattern in "\${AI_PATTERNS[@]}"; do
  if echo "$COMMIT_MSG" | grep -iqE "$pattern"; then
    echo ""
    echo "COMMIT BLOCKED: AI Attribution Detected"
    echo "  Pattern: $pattern"
    echo "  Remove AI attribution. You are the sole author."
    echo ""
    exit 1
  fi
done
exit 0
`;

export async function installCIHooks(
	projectDir: string,
): Promise<{ installed: string[]; errors: string[] }> {
	const gitDir = path.join(projectDir, ".git");
	if (!(await fs.pathExists(gitDir))) {
		return {
			installed: [],
			errors: ["Not a git repository. Run git init first."],
		};
	}

	const hooksDir = path.join(gitDir, "hooks");
	await fs.ensureDir(hooksDir);

	const hooks: Array<{ name: string; content: string }> = [
		{ name: "pre-commit", content: PRE_COMMIT_HOOK },
		{ name: "pre-push", content: PRE_PUSH_HOOK },
		{ name: "commit-msg", content: COMMIT_MSG_HOOK },
	];

	const installed: string[] = [];
	const errors: string[] = [];

	for (const hook of hooks) {
		const hookPath = path.join(hooksDir, hook.name);
		try {
			await fs.writeFile(hookPath, hook.content, { mode: 0o755 });
			installed.push(hook.name);
		} catch (e) {
			errors.push(
				`${hook.name}: ${e instanceof Error ? e.message : String(e)}`,
			);
		}
	}

	return { installed, errors };
}
