import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import fs from "fs-extra";
import { HOOK_ASSETS_DIR } from "../constants.js";
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
				compileCmd: "./gradlew clean classes testClasses --no-daemon",
				testCmd: "./gradlew test --no-daemon",
			};
		case "java-maven":
			return {
				lintCmd: "./mvnw spotless:check",
				compileCmd: "./mvnw clean compile test-compile",
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
			// Clean dist/ before build so a stale directory never masks a broken
			// build. The container runs as the host uid (see runInContainer,
			// ENV-1), so output lands host-owned — no chown needed.
			const buildPrefix = "rm -rf dist/ && ";
			return {
				lintCmd: pkgContent.includes('"lint"') ? `${buildTool} run lint` : null,
				compileCmd: pkgContent.includes('"build"')
					? `${buildPrefix}${buildTool} run build`
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
				compileCmd: "go clean -cache && go build ./...",
				testCmd: "go test ./...",
			};
		case "rust":
			return {
				lintCmd: "cargo clippy -- -D warnings",
				compileCmd: "cargo clean && cargo build",
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

/**
 * Detect-step label: legacy format for auto, explicit otherwise.
 *
 * INVARIANT (holds for every `ResolvedRunners` value): `runners` is never
 * empty. The config path rejects an empty list before resolving
 * (`src/lib/ci-config.ts` — "runners is required and must be a non-empty
 * list"), and the `auto` and `stack-override` paths each yield exactly one
 * runner. `runners[0]` therefore needs no fallback.
 */
function describeRunners(resolved: ResolvedRunners): string {
	const first = resolved.runners[0];
	if (resolved.source === "auto") {
		return `Stack: ${first.stack} (${first.buildTool})`;
	}
	if (resolved.source === "stack-override") {
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
	// `runners[0]` is always present — see the invariant on `describeRunners`.
	// The command lists CAN be empty, so those keep their `?? null`.
	const primary = resolved.runners[0];
	const stackInfo: CIStackInfo = {
		stackType: primary.stack,
		buildTool: primary.buildTool,
		javaVersion: primary.javaVersion,
		lintCmd: primary.lintCmds[0] ?? null,
		compileCmd: primary.compileCmds[0] ?? null,
		testCmd: primary.testCmds[0] ?? null,
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
	// ONE executor for every resolution source. Naming is a function of whether
	// the runner NAME is IMPLICIT or EXPLICIT — never of `resolved.runners.length`,
	// which would silently rename a single-runner CONFIG (B1):
	//   - IMPLICIT name → BARE ids: `auto` (zero-config) OR `stack-override`
	//     (`--stack`, the user never named the runner).
	//   - EXPLICIT name → SUFFIXED ids: `config` (a runner named in ci.yaml).
	const implicitName =
		resolved.source === "auto" || resolved.source === "stack-override";
	const naming: NamingMode = implicitName
		? NAMING_MODE.BARE
		: NAMING_MODE.SUFFIXED;
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
			// Under an IMPLICIT name (bare) the image step id is unsuffixed too, so a
			// `--stack` run reads identically to zero-config auto. A CONFIG runner
			// (suffixed) keeps `docker-image:<name>` (the R3 guard).
			const stepImage = bare ? "docker-image" : `docker-image:${runner.name}`;
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

/**
 * Classification of an existing `.git/hooks/<name>` before anything is written
 * (design D6). Every state has exactly one write policy, so no hook is ever
 * overwritten without a decision.
 */
export const HOOK_STATE = {
	ABSENT: "absent",
	MANAGED_CURRENT: "managed-current",
	MANAGED_OUTDATED: "managed-outdated",
	MANAGED_EDITED: "managed-edited",
	LEGACY_V0: "legacy-v0",
	FOREIGN: "foreign",
	SYMLINK: "symlink",
	/** Exists but is not a regular file (directory, fifo, device) — never forceable. */
	NOT_A_FILE: "not-a-file",
} as const;

export type HookState = (typeof HOOK_STATE)[keyof typeof HOOK_STATE];

export interface HookHistoricalEntry {
	sha256: string;
	firstCommit: string;
}

export interface HookManifestEntry {
	version: number;
	sha256: string;
	historical: HookHistoricalEntry[];
}

export interface HookStateReport {
	name: string;
	state: HookState;
}

export interface InstallHooksOptions {
	/** Overwrite `foreign` / `managed-edited` hooks, backing them up first. */
	force?: boolean;
}

export interface InstallHooksResult {
	installed: string[];
	/** Hooks that were `managed-outdated` or `legacy-v0` and got REPLACED. */
	upgraded: string[];
	backups: string[];
	errors: string[];
	states: HookStateReport[];
}

const HOOK_NAMES = ["pre-commit", "pre-push", "commit-msg"] as const;

/** Bound on the `.bak.{epochMs}-{n}` ladder before a forced install gives up. */
const BACKUP_RETRY_BUDGET = 8;

const HOOK_MARKER_NAME_RE =
	/^# javi-forge-hook: (?<name>[a-z-]+) v(?<version>\d+)$/;
const HOOK_MARKER_HASH_RE = /^# javi-forge-hash: sha256:[0-9a-f]{64}$/;

function sha256Utf8(value: string): string {
	return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function errorCode(error: unknown): string {
	return error && typeof error === "object" && "code" in error
		? String((error as { code: unknown }).code)
		: "";
}

function isReleasedBody(entry: HookManifestEntry, hash: string): boolean {
	return entry.historical.some((historical) => historical.sha256 === hash);
}

/**
 * Pure classification of hook CONTENT (D6 steps 1-5).
 *
 * The hash input is the body BELOW the marker block — the shebang stays in the
 * body, the two marker lines are removed — so a version bump alone does not
 * invalidate installed hooks. Lines are split on `\n` WITHOUT stripping a
 * trailing `\r`: a CRLF-converted file fails the `$`-anchored marker regex,
 * takes the unmarked path and classifies `foreign`, which is correct — it no
 * longer matches anything released. The hash CLAIMED by the marker is never
 * trusted; classification always recomputes against the shipped manifest.
 */
export function classifyHookContent(
	content: string,
	hookName: string,
	entry: HookManifestEntry,
): HookState {
	const lines = content.split("\n");
	const marker = HOOK_MARKER_NAME_RE.exec(lines[1] ?? "");

	if (
		lines[0]?.startsWith("#!") === true &&
		marker?.groups !== undefined &&
		HOOK_MARKER_HASH_RE.test(lines[2] ?? "")
	) {
		// The marker name is BOUND to the slot: someone else's marker never
		// grants us permission to overwrite this file.
		if (marker.groups.name !== hookName) {
			return HOOK_STATE.FOREIGN;
		}
		const body = [lines[0], ...lines.slice(3)].join("\n");
		const computed = sha256Utf8(body);
		if (computed === entry.sha256) {
			return Number(marker.groups.version) === entry.version
				? HOOK_STATE.MANAGED_CURRENT
				: HOOK_STATE.MANAGED_OUTDATED;
		}
		return isReleasedBody(entry, computed)
			? HOOK_STATE.MANAGED_OUTDATED
			: HOOK_STATE.MANAGED_EDITED;
	}

	// Unmarked: the whole file is the candidate body. Bytes identical to the
	// CURRENT asset still classify legacy-v0 — the marker, not the content, is
	// what makes a hook managed.
	return isReleasedBody(entry, sha256Utf8(content))
		? HOOK_STATE.LEGACY_V0
		: HOOK_STATE.FOREIGN;
}

async function lstatOrNull(target: string): Promise<Stats | null> {
	try {
		return await fs.lstat(target);
	} catch (statErr: unknown) {
		if (errorCode(statErr) === "ENOENT") {
			return null;
		}
		throw statErr;
	}
}

/** D6 step 0 — `lstat` first; only a regular file is ever read. */
async function classifyHookPath(
	hookPath: string,
	hookName: string,
	entry: HookManifestEntry,
): Promise<HookState> {
	const stat = await lstatOrNull(hookPath);
	if (stat === null) {
		return HOOK_STATE.ABSENT;
	}
	if (stat.isSymbolicLink()) {
		return HOOK_STATE.SYMLINK;
	}
	if (!stat.isFile()) {
		return HOOK_STATE.NOT_A_FILE;
	}
	return classifyHookContent(
		await fs.readFile(hookPath, "utf8"),
		hookName,
		entry,
	);
}

/**
 * Splice the marker block in after the shebang. The body is written unmodified,
 * so the round-trip is byte-exact and a re-install classifies `managed-current`
 * with zero writes.
 */
function renderHook(
	body: string,
	hookName: string,
	entry: HookManifestEntry,
): string {
	const [shebang, ...rest] = body.split("\n");
	return [
		shebang,
		`# javi-forge-hook: ${hookName} v${entry.version}`,
		`# javi-forge-hash: sha256:${sha256Utf8(body)}`,
		...rest,
	].join("\n");
}

/**
 * What `--force` would ACTUALLY do with the backup, for the refusal message.
 *
 * Naming `.bak` unconditionally would be a lie whenever `.bak` is already taken
 * by an earlier backup — and promising a backup at all would be a lie whenever
 * the `.bak` path is a symlink or a directory, because `backupHook` refuses
 * those EVEN WITH `--force`. The probe is `lstat`, never `pathExists`: the
 * latter follows symlinks, so it reports `true` for a symlink to an existing
 * file and `false` for a dangling one — both readings promise a backup that
 * will never happen.
 */
async function describeBackupPlan(hookPath: string): Promise<string> {
	const plain = `${hookPath}.bak`;
	const existing = await lstatOrNull(plain);
	if (existing !== null && (existing.isSymbolicLink() || !existing.isFile())) {
		return `note that --force will REFUSE this hook until ${plain} is removed: it exists and is not a regular file, and javi-forge never writes a backup through it`;
	}
	const target = existing === null ? plain : `${plain}.<timestamp>`;
	return `the current file is saved as ${target}`;
}

async function refusalMessage(
	hookPath: string,
	state: HookState,
): Promise<string> {
	if (state === HOOK_STATE.SYMLINK) {
		return `refusing to write through a symlink at ${hookPath}`;
	}
	if (state === HOOK_STATE.NOT_A_FILE) {
		return `${hookPath} exists but is not a regular file. Refusing to overwrite; --force does not apply.`;
	}
	const plan = await describeBackupPlan(hookPath);
	const reason =
		state === HOOK_STATE.MANAGED_EDITED
			? "carries a javi-forge marker but its contents were modified locally"
			: "exists and is not a javi-forge hook (no marker, and its contents match no released javi-forge template)";
	return `${hookPath} ${reason}. Refusing to overwrite. Inspect it, then re-run 'javi-forge ci init --force' (${plan}), or delete it.`;
}

/**
 * Candidate backup targets, in order: `.bak`, `.bak.{epochMs}`, then
 * `.bak.{epochMs}-{n}`. Bounded — a forced install never loops forever.
 */
function* backupCandidates(hookPath: string): Generator<string> {
	yield `${hookPath}.bak`;
	const stamp = Date.now();
	yield `${hookPath}.bak.${stamp}`;
	for (let n = 1; n <= BACKUP_RETRY_BUDGET; n += 1) {
		yield `${hookPath}.bak.${stamp}-${n}`;
	}
}

/**
 * Copy the hook to a `.bak` sibling BEFORE a forced overwrite (D4).
 *
 * The backup path is a write target and gets the same protection as the hook
 * path: every candidate is `lstat`ed and a symlink or non-regular file is
 * refused EVEN WITH `--force`, otherwise a planted
 * `pre-commit.bak -> ~/.ssh/authorized_keys` would turn `--force` into an
 * arbitrary-write primitive. Creation goes through `COPYFILE_EXCL`, so
 * "does it exist?" and "create it" are one atomic step: a backup can never
 * clobber an earlier backup, same-millisecond collisions are impossible, and a
 * symlink planted between the `lstat` and the copy loses the race. The copy is
 * of the ORIGINAL BYTES — never a utf8 round-trip, which would corrupt a
 * non-UTF8 hook — and the original mode is restored so a restored backup is
 * still executable.
 *
 * Throwing here ABORTS the hook: the caller never reaches its write.
 */
async function backupHook(hookPath: string): Promise<string> {
	const original = await fs.stat(hookPath);

	for (const candidate of backupCandidates(hookPath)) {
		const existing = await lstatOrNull(candidate);
		if (existing !== null) {
			if (existing.isSymbolicLink() || !existing.isFile()) {
				throw new Error(
					`refusing to write the backup ${candidate}: it exists and is not a regular file. The hook was left unchanged.`,
				);
			}
			// An earlier backup — keep it, try the next name.
			continue;
		}
		try {
			await fs.copyFile(hookPath, candidate, constants.COPYFILE_EXCL);
		} catch (copyErr: unknown) {
			if (errorCode(copyErr) === "EEXIST") {
				continue;
			}
			throw new Error(
				`could not write the backup ${candidate} (${errorCode(copyErr) || "unknown error"}): ${copyErr instanceof Error ? copyErr.message : String(copyErr)}. The hook was left unchanged.`,
			);
		}
		// The mode restore addresses the FD of the file THIS call just created,
		// not the path: a symlink planted at `candidate` after the
		// `COPYFILE_EXCL` copy cannot capture the mode change (SEC-1).
		const handle = await fsp.open(candidate, constants.O_RDONLY | O_NOFOLLOW);
		try {
			await handle.chmod(original.mode);
		} finally {
			await handle.close();
		}
		return candidate;
	}

	throw new Error(
		`could not back up ${hookPath}: every candidate backup path is taken. The hook was left unchanged.`,
	);
}

const MANIFEST_PATH = path.join(HOOK_ASSETS_DIR, "manifest.json");

/** The mode every installed hook ends up with — git ignores a non-executable hook. */
const HOOK_MODE = 0o755;

const REINSTALL_REMEDY =
	"reinstall javi-forge (npm i -g javi-forge) or repack it from source";

async function loadHookManifest(): Promise<Record<string, HookManifestEntry>> {
	return (await fs.readJson(MANIFEST_PATH)) as Record<
		string,
		HookManifestEntry
	>;
}

/**
 * A broken INSTALL of javi-forge (missing, unreadable or truncated manifest) is
 * an operator-actionable condition, not a stack trace: it surfaces as a named
 * `errors[]` entry naming the path, the reason and the remedy. Without this the
 * rejection escapes `installCIHooks` entirely and takes `handleCi` down with an
 * unhandled promise rejection.
 */
function assertHookManifestEntry(
	entry: HookManifestEntry | undefined,
	hookName: string,
): asserts entry is HookManifestEntry {
	const problem =
		entry === undefined || entry === null
			? `has no "${hookName}" entry`
			: typeof entry.sha256 !== "string" ||
					typeof entry.version !== "number" ||
					!Array.isArray(entry.historical) ||
					!entry.historical.every((h) => typeof h?.sha256 === "string")
				? `has a malformed "${hookName}" entry (expected version:number, sha256:string, historical:array of {sha256:string})`
				: "";
	if (problem !== "") {
		throw new Error(
			`${MANIFEST_PATH} ${problem}. The javi-forge install is incomplete; ${REINSTALL_REMEDY}.`,
		);
	}
}

/**
 * `O_NOFOLLOW` on the platforms that have it, a no-op flag elsewhere. Windows
 * has no such flag AND no hook-symlink threat worth the crash of an
 * `undefined` in a bitmask.
 */
const O_NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * Write the hook through a FILE DESCRIPTOR, never through the path (SEC-1).
 *
 * `classifyHookPath` established moments earlier that `hookPath` is a regular
 * file, but a local attacker with write access to `.git/hooks` could swap a
 * symlink in during that window and turn the write into an arbitrary-write
 * primitive. `O_NOFOLLOW` closes it: if the path IS a symlink when the write
 * finally happens, `open` fails with `ELOOP` and the hook surfaces as a named
 * per-hook error instead of clobbering the link target. Everything after the
 * open then addresses the FD — `fchmod`, not a second path lookup — so the
 * bytes and the mode provably land on the same inode.
 *
 * The mode argument applies ONLY when the file is CREATED: overwriting an
 * existing 0644 hook would leave it non-executable and git would silently skip
 * it. The `fchmod` is therefore unconditional, on every write path, which also
 * makes the final mode independent of the umask.
 *
 * NOT covered (deferred by decision in SEC-1): a hardlink to a victim file
 * survives `O_NOFOLLOW`. On modern Linux `fs.protected_hardlinks=1` blocks the
 * cross-owner case; an `nlink > 1` refusal is parked in the backlog.
 */
async function writeHookFile(hookPath: string, content: string): Promise<void> {
	const handle = await fsp.open(
		hookPath,
		constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | O_NOFOLLOW,
		HOOK_MODE,
	);
	try {
		await handle.writeFile(content, "utf8");
		await handle.chmod(HOOK_MODE);
	} finally {
		await handle.close();
	}
}

/**
 * Bring an already-current hook back to mode 0755 WITHOUT writing bytes.
 *
 * The chmod is skipped when the mode already matches, so the common path does
 * no syscall beyond the `lstat`; when it does run, `chmod` changes `ctime` only
 * — `mtime` and the contents are untouched, so the zero-write idempotence
 * contract survives. The path was classified as a regular file moments earlier;
 * the residual TOCTOU window is the one documented for the write path itself.
 */
async function repairHookMode(hookPath: string): Promise<void> {
	const stat = await lstatOrNull(hookPath);
	if (stat !== null && (stat.mode & 0o777) !== HOOK_MODE) {
		await fs.chmod(hookPath, HOOK_MODE);
	}
}

/**
 * The hook body as SHIPPED. There is no inline copy of these templates any
 * more: `assets/hooks/<name>` is the single source, hashed by the manifest and
 * asserted present in the published tarball by the packaging check.
 */
async function readHookBody(hookName: string): Promise<string> {
	return await fs.readFile(path.join(HOOK_ASSETS_DIR, hookName), "utf8");
}

export async function installCIHooks(
	projectDir: string,
	options: InstallHooksOptions = {},
): Promise<InstallHooksResult> {
	const force = options.force === true;
	const empty = { installed: [], upgraded: [], backups: [], states: [] };
	const gitDir = path.join(projectDir, ".git");
	if (!(await fs.pathExists(gitDir))) {
		return {
			...empty,
			errors: ["Not a git repository. Run git init first."],
		};
	}

	const hooksDir = path.join(gitDir, "hooks");
	let manifest: Record<string, HookManifestEntry>;
	try {
		await fs.ensureDir(hooksDir);
	} catch (e) {
		return {
			...empty,
			errors: [
				`could not create ${hooksDir} (${errorCode(e) || "unknown error"}): ${e instanceof Error ? e.message : String(e)}. No hook was installed.`,
			],
		};
	}
	try {
		manifest = await loadHookManifest();
	} catch (e) {
		return {
			...empty,
			errors: [
				`could not read ${MANIFEST_PATH} (${errorCode(e) || "unknown error"}): ${e instanceof Error ? e.message : String(e)}. The javi-forge install is incomplete; ${REINSTALL_REMEDY}.`,
			],
		};
	}

	const installed: string[] = [];
	const upgraded: string[] = [];
	const backups: string[] = [];
	const errors: string[] = [];
	const states: HookStateReport[] = [];

	for (const name of HOOK_NAMES) {
		const hookPath = path.join(hooksDir, name);
		const entry = manifest[name];
		try {
			assertHookManifestEntry(entry, name);
			const state = await classifyHookPath(hookPath, name, entry);
			states.push({ name, state });

			if (state === HOOK_STATE.MANAGED_CURRENT) {
				// Content is already correct, so nothing is REWRITTEN — but a hook
				// stripped of its exec bit is dead weight (git skips it silently),
				// so the mode is repaired in place. `chmod` leaves both the bytes
				// and the mtime untouched, so idempotence still holds.
				await repairHookMode(hookPath);
				continue;
			}
			// A symlink or a non-regular path is refused ALWAYS — `--force` is
			// consent to lose YOUR file, not permission to write through a link.
			if (state === HOOK_STATE.SYMLINK || state === HOOK_STATE.NOT_A_FILE) {
				throw new Error(await refusalMessage(hookPath, state));
			}
			if (state === HOOK_STATE.MANAGED_EDITED || state === HOOK_STATE.FOREIGN) {
				if (!force) {
					throw new Error(await refusalMessage(hookPath, state));
				}
				// Backup FIRST. If it throws, the write below is never reached.
				backups.push(await backupHook(hookPath));
			}

			const body = await readHookBody(name);
			await writeHookFile(hookPath, renderHook(body, name, entry));
			// `upgraded` means "javi-forge content was replaced by newer
			// javi-forge content". A forced overwrite of someone else's file is a
			// fresh install, not an upgrade.
			if (
				state === HOOK_STATE.MANAGED_OUTDATED ||
				state === HOOK_STATE.LEGACY_V0
			) {
				upgraded.push(name);
			} else {
				installed.push(name);
			}
		} catch (e) {
			errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	return { installed, upgraded, backups, errors, states };
}
