import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import {
	CI_STACKS,
	type CIRunnerConfig,
	findCIConfig,
	loadCIConfig,
} from "../lib/ci-config.js";
import { refreshContextDir } from "../lib/context.js";
import {
	ensureImage,
	isDockerAvailable,
	openShell,
	runInContainer,
} from "../lib/docker.js";
import { execFileAsync } from "../lib/exec.js";
import type { Stack } from "../types/index.js";

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
	/** Explicit CI config path (--config). Default: .javi-forge/ci.yaml if present */
	config?: string;
	/** Explicit single-stack override (--stack). Insufficient for hybrid repos */
	stack?: string;
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
// Runner resolution (single resolution point — Docker never re-detects)
// =============================================================================

/**
 * Immutable runner produced by resolveCIRunners(). Later stages (Docker
 * execution, required-tool checks) receive this object and must not
 * re-detect anything from filesystem markers.
 */
export interface ResolvedRunner {
	name: string;
	stack: Stack;
	buildTool: string;
	javaVersion: string;
	/** Working directory relative to the project root */
	directory: string;
	/** Explicit container image (skips the default per-stack image) */
	image?: string;
	/** Docker build context directory (execution lands in Slice B) */
	buildContext?: string;
	setupCmds: readonly string[];
	lintCmds: readonly string[];
	compileCmds: readonly string[];
	testCmds: readonly string[];
	securityCmds: readonly string[];
	requiredTools: readonly string[];
}

export type RunnerSource = "auto" | "config" | "stack-override";

export interface ResolvedRunners {
	readonly source: RunnerSource;
	readonly runners: readonly ResolvedRunner[];
}

export interface ResolveRunnerOptions {
	/** Explicit config path (--config). Wins over default discovery */
	config?: string;
	/** Explicit single-stack override (--stack) */
	stack?: string;
}

function freezeRunner(runner: {
	name: string;
	stack: Stack;
	buildTool: string;
	javaVersion: string;
	directory: string;
	image?: string;
	buildContext?: string;
	setupCmds: string[];
	lintCmds: string[];
	compileCmds: string[];
	testCmds: string[];
	securityCmds: string[];
	requiredTools: string[];
}): ResolvedRunner {
	return Object.freeze({
		...runner,
		setupCmds: Object.freeze([...runner.setupCmds]),
		lintCmds: Object.freeze([...runner.lintCmds]),
		compileCmds: Object.freeze([...runner.compileCmds]),
		testCmds: Object.freeze([...runner.testCmds]),
		securityCmds: Object.freeze([...runner.securityCmds]),
		requiredTools: Object.freeze([...runner.requiredTools]),
	});
}

function freezeRunners(
	source: RunnerSource,
	runners: ResolvedRunner[],
): ResolvedRunners {
	return Object.freeze({ source, runners: Object.freeze(runners) });
}

/** Build-tool heuristic for a known stack in a given directory. */
async function detectBuildTool(stack: Stack, dir: string): Promise<string> {
	switch (stack) {
		case "node":
			if (await fs.pathExists(path.join(dir, "pnpm-lock.yaml"))) return "pnpm";
			if (await fs.pathExists(path.join(dir, "yarn.lock"))) return "yarn";
			return "npm";
		case "python":
			if (await fs.pathExists(path.join(dir, "uv.lock"))) return "uv";
			if (await fs.pathExists(path.join(dir, "poetry.lock"))) return "poetry";
			return "pip";
		case "java-gradle":
			return "gradle";
		case "java-maven":
			return "mvn";
		case "go":
			return "go";
		case "rust":
			return "cargo";
		default:
			return "";
	}
}

function toList(command: string | null): string[] {
	return command ? [command] : [];
}

async function resolveConfiguredRunner(
	projectDir: string,
	config: CIRunnerConfig,
): Promise<ResolvedRunner> {
	const runnerDir = path.join(projectDir, config.directory);
	const buildTool = await detectBuildTool(config.stack, runnerDir);
	const defaults = await buildCICommands(config.stack, buildTool, runnerDir);
	return freezeRunner({
		name: config.name,
		stack: config.stack,
		buildTool,
		javaVersion: "21",
		directory: config.directory,
		image: config.image,
		buildContext: config.buildContext,
		setupCmds: config.setup,
		lintCmds: config.lint.length > 0 ? config.lint : toList(defaults.lintCmd),
		compileCmds:
			config.build.length > 0 ? config.build : toList(defaults.compileCmd),
		testCmds: config.test.length > 0 ? config.test : toList(defaults.testCmd),
		securityCmds: config.security,
		requiredTools: config.requires,
	});
}

async function resolveExplicitStackRunner(
	projectDir: string,
	stack: Stack,
): Promise<ResolvedRunner> {
	const buildTool = await detectBuildTool(stack, projectDir);
	const defaults = await buildCICommands(stack, buildTool, projectDir);
	return freezeRunner({
		name: stack,
		stack,
		buildTool,
		javaVersion: "21",
		directory: ".",
		setupCmds: [],
		lintCmds: toList(defaults.lintCmd),
		compileCmds: toList(defaults.compileCmd),
		testCmds: toList(defaults.testCmd),
		securityCmds: [],
		requiredTools: [],
	});
}

/**
 * Resolve the ordered runner list exactly once per CI run.
 *
 * Precedence (fail closed on ambiguity):
 *   1. --config <path> (or discovered .javi-forge/ci.yaml) → configured runners
 *   2. --stack <stack> → single explicit runner (single-stack repos only)
 *   3. otherwise → single auto-detected runner (zero-config default)
 */
export async function resolveCIRunners(
	projectDir: string,
	options: ResolveRunnerOptions = {},
): Promise<ResolvedRunners> {
	const { config, stack } = options;

	if (config && stack) {
		throw new Error(
			"Ambiguous CI options: --config and --stack cannot be used together. " +
				"Use --config for hybrid repositories.",
		);
	}

	if (stack) {
		if (!CI_STACKS.includes(stack)) {
			throw new Error(
				`Unknown stack "${stack}". Valid stacks: ${CI_STACKS.join(", ")}`,
			);
		}
		return freezeRunners("stack-override", [
			await resolveExplicitStackRunner(projectDir, stack as Stack),
		]);
	}

	const configPath = config ?? (await findCIConfig(projectDir));
	if (configPath) {
		const ciConfig = await loadCIConfig(configPath);
		const runners: ResolvedRunner[] = [];
		for (const runnerConfig of ciConfig.runners) {
			runners.push(await resolveConfiguredRunner(projectDir, runnerConfig));
		}
		return freezeRunners("config", runners);
	}

	// Zero-config default: single auto-detected runner (unchanged behavior).
	const info = await detectCIStack(projectDir);
	return freezeRunners("auto", [
		freezeRunner({
			name: info.stackType,
			stack: info.stackType,
			buildTool: info.buildTool,
			javaVersion: info.javaVersion,
			directory: ".",
			setupCmds: [],
			lintCmds: toList(info.lintCmd),
			compileCmds: toList(info.compileCmd),
			testCmds: toList(info.testCmd),
			securityCmds: [],
			requiredTools: [],
		}),
	]);
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

/** Detect-step label: legacy format for auto, explicit otherwise. */
function describeRunners(resolved: ResolvedRunners): string {
	const first = resolved.runners[0];
	if (resolved.source === "auto" && first) {
		return `Stack: ${first.stack} (${first.buildTool})`;
	}
	if (resolved.source === "stack-override" && first) {
		return `Stack: ${first.stack} (${first.buildTool}, --stack override)`;
	}
	const summary = resolved.runners
		.map((r) => `${r.name} (${r.stack})`)
		.join(", ");
	return `Config: ${resolved.runners.length} runner(s) — ${summary}`;
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

	// ── Resolve runners (once — nothing downstream re-detects) ─────────────────
	const stepDetect = "detect";
	report(onStep, stepDetect, "Detecting stack", "running");
	let resolved: ResolvedRunners;
	try {
		resolved = await resolveCIRunners(projectDir, {
			config: options.config,
			stack: options.stack,
		});
		report(onStep, stepDetect, describeRunners(resolved), "done");
	} catch (e) {
		report(onStep, stepDetect, "Detecting stack", "error", String(e));
		throw e;
	}

	// Legacy single-runner view for the zero-config auto path. Keeping this
	// shape guarantees single-stack repositories behave exactly as before.
	const primary = resolved.runners[0];
	const stackInfo: CIStackInfo = {
		stackType: primary?.stack ?? "node",
		buildTool: primary?.buildTool ?? "npm",
		javaVersion: primary?.javaVersion ?? "21",
		lintCmd: primary?.lintCmds[0] ?? null,
		compileCmd: primary?.compileCmds[0] ?? null,
		testCmd: primary?.testCmds[0] ?? null,
	};

	// ── Detect mode ─────────────────────────────────────────────────────────────
	if (mode === "detect") return;

	// ── Shell mode ──────────────────────────────────────────────────────────────
	if (mode === "shell") {
		if (noDocker) {
			report(onStep, "shell", "Shell", "error", "--shell requires Docker");
			throw new Error("--shell requires Docker");
		}
		report(onStep, "docker-image", "Building Docker image", "running");
		let shellImage: string;
		try {
			shellImage = await ensureImage({
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
		await openShell(projectDir, shellImage);
		return;
	}

	// ── Check Docker ─────────────────────────────────────────────────────────────
	// Image resolved by the prologue for the auto path — threaded into the
	// executor so nothing downstream re-derives it. Set iff
	// `resolved.source === "auto" && !noDocker`.
	let autoImage: string | undefined;
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

		// Build image (auto path only — configured runners ensure their own
		// image inside the runner loop)
		if (resolved.source === "auto") {
			const stepImage = "docker-image";
			report(
				onStep,
				stepImage,
				`Building image for ${stackInfo.stackType}`,
				"running",
			);
			try {
				autoImage = await ensureImage({
					stack: stackInfo.stackType,
					javaVersion: stackInfo.javaVersion,
				});
				report(onStep, stepImage, "Docker image ready", "done");
			} catch (e) {
				report(onStep, stepImage, "Building Docker image", "error", String(e));
				throw e;
			}
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

	// ── Runner execution ─────────────────────────────────────────────────────────
	// ONE executor for every resolution source. Naming is a function of
	// `resolved.source` alone — never of `resolved.runners.length`, which would
	// silently rename a single-runner CONFIG.
	const naming: NamingMode =
		resolved.source === "auto" ? NAMING_MODE.BARE : NAMING_MODE.SUFFIXED;
	for (const runner of resolved.runners) {
		await runRunner(runner, {
			projectDir,
			mode,
			noDocker,
			noSecurity,
			timeout,
			onStep,
			naming,
			preresolvedImage: resolved.source === "auto" ? autoImage : undefined,
		});
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

/**
 * Step-id and label naming, keyed on `resolved.source` and nothing else.
 * `bare` is the zero-config (auto) presentation; `suffixed` carries the runner
 * name, including for a CONFIG that happens to declare exactly one runner.
 */
const NAMING_MODE = {
	BARE: "bare",
	SUFFIXED: "suffixed",
} as const;
type NamingMode = (typeof NAMING_MODE)[keyof typeof NAMING_MODE];

interface RunnerExecContext {
	projectDir: string;
	mode: CIMode;
	noDocker: boolean;
	noSecurity: boolean;
	timeout: number;
	onStep: CIStepCallback;
	naming: NamingMode;
	/** Set only for `source === "auto"`: image built in the prologue. */
	preresolvedImage?: string;
}

interface RunPhase {
	id: string;
	label: string;
	/**
	 * Past-tense subject for the done/failed labels. Applies in BARE mode ONLY —
	 * suffixed mode keeps `${label} [${name}] passed`, so a configured `test`
	 * phase stays "Test [api] passed", never "Tests [api] passed".
	 */
	doneLabel?: string;
	cmds: readonly string[];
	user?: string;
	skip: boolean;
}

interface RunStepOptions {
	command: string;
	projectDir: string;
	noDocker: boolean;
	timeout: number;
	runner: ResolvedRunner;
	user?: string;
	/** REQUIRED when `!noDocker` — resolved upstream, never re-derived here. */
	image?: string;
}

/**
 * Execute one resolved runner, whatever its source: resolve the image (already
 * built by the prologue for auto, otherwise the default stack image, an
 * explicit/digest-pinned image, or a deterministic build-context build), verify
 * required tools fail-closed, then run setup/lint/compile/test/security
 * commands in order, inside the runner's working directory.
 * Any failure aborts the whole run — nothing is ever skipped silently.
 */
async function runRunner(
	runner: ResolvedRunner,
	ctx: RunnerExecContext,
): Promise<void> {
	const { projectDir, mode, noDocker, noSecurity, timeout, onStep, naming } =
		ctx;
	const bare = naming === NAMING_MODE.BARE;

	// ── Image resolution (Docker mode only) ────────────────────────────────────
	let imageName: string | undefined;
	if (!noDocker) {
		if (ctx.preresolvedImage) {
			// Auto path: the prologue already built the image BEFORE the .context/
			// refresh. Reuse it verbatim so no second `docker-image` step appears
			// and the global step order is unchanged.
			imageName = ctx.preresolvedImage;
		} else {
			const stepImage = `docker-image:${runner.name}`;
			try {
				if (runner.buildContext) {
					report(
						onStep,
						stepImage,
						`Building image for ${runner.name} from ${runner.buildContext}`,
						"running",
					);
					imageName = await ensureImage({
						stack: runner.stack,
						buildContext: path.resolve(projectDir, runner.buildContext),
						imageTag: `javi-forge-ci-${runner.name}`,
					});
				} else if (runner.image) {
					// Explicit image (digest pins pass through verbatim).
					imageName = runner.image;
					report(
						onStep,
						stepImage,
						`Using configured image ${runner.image}`,
						"done",
					);
				} else {
					report(
						onStep,
						stepImage,
						`Building image for ${runner.name} (${runner.stack})`,
						"running",
					);
					imageName = await ensureImage({
						stack: runner.stack,
						javaVersion: runner.javaVersion,
					});
				}
				if (!runner.image) {
					report(
						onStep,
						stepImage,
						`Docker image ready (${imageName})`,
						"done",
					);
				}
			} catch (e) {
				report(onStep, stepImage, "Building Docker image", "error", String(e));
				throw e;
			}
		}
	}

	// ── Required tools (fail closed, before any phase) ─────────────────────────
	if (runner.requiredTools.length > 0) {
		const stepTools = `tools:${runner.name}`;
		const envDesc = noDocker
			? `native environment (directory "${runner.directory}")`
			: `image ${imageName}`;
		report(
			onStep,
			stepTools,
			`Checking required tools [${runner.name}]: ${runner.requiredTools.join(", ")}`,
			"running",
		);
		for (const tool of runner.requiredTools) {
			try {
				await runStep({
					command: `command -v ${tool}`,
					projectDir,
					noDocker,
					timeout,
					runner,
					image: imageName,
				});
			} catch {
				const message =
					`runner "${runner.name}": required tool "${tool}" not found in ${envDesc} — ` +
					"install it in the runner image/environment or remove it from requires";
				report(
					onStep,
					stepTools,
					`Missing required tool [${runner.name}]: ${tool}`,
					"error",
					message,
				);
				throw new Error(message);
			}
		}
		report(onStep, stepTools, `Required tools OK [${runner.name}]`, "done");
	}

	const phases: RunPhase[] = [
		{ id: "setup", label: "Setup", cmds: runner.setupCmds, skip: false },
		{ id: "lint", label: "Lint", cmds: runner.lintCmds, skip: false },
		{
			id: "compile",
			label: "Compile",
			cmds: runner.compileCmds,
			user: "root",
			skip: false,
		},
		{
			id: "test",
			label: "Test",
			doneLabel: "Tests",
			cmds: runner.testCmds,
			skip: mode !== "full",
		},
		{
			id: "security",
			label: "Security",
			cmds: runner.securityCmds,
			skip: mode !== "full" || noSecurity,
		},
	];

	for (const phase of phases) {
		if (phase.skip) continue;
		const stepId = bare ? phase.id : `${phase.id}:${runner.name}`;
		// `doneLabel` is BARE-only: suffixed mode keeps the historical
		// `${label} [${name}] passed` composition.
		const subject = bare ? (phase.doneLabel ?? phase.label) : phase.label;
		const suffix = bare ? "" : ` [${runner.name}]`;
		for (const cmd of phase.cmds) {
			report(onStep, stepId, `${phase.label}${suffix}: ${cmd}`, "running");
			try {
				await runStep({
					command: cmd,
					projectDir,
					noDocker,
					timeout,
					runner,
					user: phase.user,
					image: imageName,
				});
				report(onStep, stepId, `${subject}${suffix} passed`, "done");
			} catch (e) {
				report(
					onStep,
					stepId,
					`${subject}${suffix} failed`,
					"error",
					String(e),
				);
				throw e;
			}
		}
	}
}

async function runStep(options: RunStepOptions): Promise<void> {
	const { command, projectDir, noDocker, timeout, runner, user, image } =
		options;
	if (noDocker) {
		// Run natively, in the runner's working directory.
		const cwd = path.join(projectDir, runner.directory);
		await new Promise<void>((resolve, reject) => {
			const proc = spawn("bash", ["-c", command], {
				cwd,
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
		// The image is always resolved upstream (prologue build for auto,
		// per-runner ensureImage, explicit config image, or the default
		// per-stack image). Docker receives it verbatim and never re-detects
		// anything, so a missing image is a bug — fail loudly instead of
		// silently re-deriving a name that may not be the one that was built.
		if (!image) {
			throw new Error(
				`internal invariant violated: no Docker image resolved for runner "${runner.name}" — ` +
					"the image must be resolved before any step runs",
			);
		}
		const workdir =
			runner.directory !== "."
				? `/home/runner/work/${runner.directory}`
				: "/home/runner/work";
		const result = await runInContainer({
			projectDir,
			image,
			command: `cd ${workdir} && ${command}`,
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
			// Refuse to follow symlinks. .git/hooks/<name> as a symlink to a
			// sensitive file (e.g., ~/.ssh/authorized_keys) would otherwise be
			// clobbered by writeFile. lstat reports the link, not the target.
			let isSymlink = false;
			try {
				const stat = await fs.lstat(hookPath);
				isSymlink = stat.isSymbolicLink();
			} catch (statErr: unknown) {
				const code =
					statErr && typeof statErr === "object" && "code" in statErr
						? (statErr as { code: string }).code
						: "";
				if (code !== "ENOENT") {
					throw statErr;
				}
				// ENOENT is expected if the hook file doesn't exist yet.
			}
			if (isSymlink) {
				throw new Error(`refusing to write through a symlink at ${hookPath}`);
			}
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
