import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import fs from "fs-extra";
import type { Stack } from "../types/index.js";
import { execFileAsync } from "./exec.js";

// =============================================================================
// Types
// =============================================================================

export interface DockerRunOptions {
	/** Absolute path to mount as /home/runner/work */
	projectDir: string;
	/**
	 * Pre-resolved image from the CI runner (required). Passed through
	 * verbatim, including digest pins (`name@sha256:...`). runInContainer
	 * never performs marker detection — resolution happens once, upstream.
	 */
	image: string;
	/** Command to run inside the container */
	command: string;
	/**
	 * Wall-clock timeout in seconds, enforced HOST-SIDE (a host timer → `docker
	 * stop`), NOT by an in-container `timeout` binary. Omitted → the container
	 * runs UNBOUNDED (no timer armed) — there is no silent default cap.
	 */
	timeout?: number;
	/** Stream output to stdout/stderr (default: true) */
	stream?: boolean;
	/** Override the user to run as inside the container (default: runner) */
	user?: string;
	/**
	 * Extra env vars injected as discrete `-e KEY=VALUE` argv elements (one per
	 * entry), NEVER shell-spliced. Values with spaces/`=`/newlines survive
	 * verbatim (argv, not a shell string); Docker splits only on the first `=`.
	 * A caller passing no map yields the same argv as today (only `-e CI=true`).
	 */
	env?: Record<string, string>;
}

export interface DockerRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	/**
	 * `true` IFF the host wall-clock timer fired and terminated the container —
	 * set DETERMINISTICALLY by the host BEFORE the kill, never inferred from a
	 * raw 124 exit code. Lets a caller tell a real timeout apart from a command
	 * that itself exits 124 (both surface non-zero, only one is a timeout).
	 */
	timedOut: boolean;
}

export interface DockerImageOptions {
	stack: Stack;
	/** Java version override (only for java-* stacks) */
	javaVersion?: string;
	/** Directory where Dockerfiles are stored (defaults to package-bundled dir) */
	dockerfilesDir?: string;
	/**
	 * Custom build context directory (must contain a Dockerfile, which is
	 * the source of truth and is never overwritten). Mutually exclusive
	 * with dockerfilesDir.
	 */
	buildContext?: string;
	/** Image tag for build-context builds (default: derived from the stack) */
	imageTag?: string;
}

// =============================================================================
// Image name
// =============================================================================

export function getImageName(stack: Stack): string {
	return `javi-forge-ci-${stack}`;
}

// =============================================================================
// Dockerfile content per stack
// =============================================================================

export function getDockerfileContent(stack: Stack): string {
	switch (stack) {
		case "java-gradle":
		case "java-maven":
			return [
				"ARG JAVA_VERSION=21",
				"FROM eclipse-temurin:${JAVA_VERSION}-jdk-noble",
				"RUN apt-get update && apt-get install -y git curl unzip && rm -rf /var/lib/apt/lists/*",
				"RUN useradd -m -s /bin/bash runner",
				"USER runner",
				"WORKDIR /home/runner/work",
				'ENTRYPOINT ["/bin/bash", "-c"]',
			].join("\n");

		case "node":
			return [
				"FROM node:22-slim",
				"RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*",
				"RUN npm install -g pnpm",
				"RUN useradd -m -s /bin/bash runner",
				"USER runner",
				"WORKDIR /home/runner/work",
				'ENTRYPOINT ["/bin/bash", "-c"]',
			].join("\n");

		case "python":
			return [
				"FROM python:3.12-slim",
				"RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*",
				"RUN pip install --no-cache-dir pytest ruff pylint poetry",
				"RUN useradd -m -s /bin/bash runner",
				"USER runner",
				"WORKDIR /home/runner/work",
				'ENTRYPOINT ["/bin/bash", "-c"]',
			].join("\n");

		case "go":
			return [
				"FROM golang:1.23-bookworm",
				"RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*",
				"RUN go install github.com/golangci/golangci-lint/cmd/golangci-lint@v1.62.0 && mv /root/go/bin/golangci-lint /usr/local/bin/",
				"RUN useradd -m -s /bin/bash runner",
				"USER runner",
				"WORKDIR /home/runner/work",
				'ENTRYPOINT ["/bin/bash", "-c"]',
			].join("\n");

		case "rust":
			return [
				"FROM rust:1.83-slim",
				"RUN apt-get update && apt-get install -y git pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*",
				"RUN rustup component add clippy rustfmt",
				"RUN useradd -m -s /bin/bash runner",
				"USER runner",
				"WORKDIR /home/runner/work",
				'ENTRYPOINT ["/bin/bash", "-c"]',
			].join("\n");

		default:
			return [
				"FROM ubuntu:24.04",
				"RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*",
				"RUN useradd -m -s /bin/bash runner",
				"USER runner",
				"WORKDIR /home/runner/work",
				'ENTRYPOINT ["/bin/bash", "-c"]',
			].join("\n");
	}
}

// =============================================================================
// Docker availability
// =============================================================================

export async function isDockerAvailable(): Promise<boolean> {
	try {
		await execFileAsync("docker", ["info"], { timeout: 5000 });
		return true;
	} catch {
		return false;
	}
}

// =============================================================================
// Image management
// =============================================================================

/**
 * Ensure a CI Docker image exists and is up-to-date.
 * Rebuilds only if the Dockerfile content has changed (hash-based staleness check).
 * Returns the image name.
 *
 * Two modes:
 *   - per-stack (default): the Dockerfile is generated/managed by javi-forge
 *   - build-context: the configured context directory provides its own
 *     Dockerfile (source of truth, never overwritten); fails closed if
 *     the Dockerfile is missing.
 */
export async function ensureImage(
	options: DockerImageOptions,
): Promise<string> {
	const { stack, javaVersion, dockerfilesDir, buildContext, imageTag } =
		options;

	let imageName: string;
	let dockerfilePath: string;
	let contextDir: string;

	if (buildContext) {
		imageName = imageTag ?? getImageName(stack);
		dockerfilePath = path.join(buildContext, "Dockerfile");
		contextDir = buildContext;
		// Fail closed: a build context without a Dockerfile is a config error,
		// never something to silently work around.
		if (!(await fs.pathExists(dockerfilePath))) {
			throw new Error(
				`build-context "${buildContext}" has no Dockerfile — ` +
					"add one or use image/stack defaults instead",
			);
		}
	} else {
		imageName = getImageName(stack);
		const dockerDir =
			dockerfilesDir ??
			path.join(
				path.dirname(new URL(import.meta.url).pathname),
				"../../ci-local/docker",
			);
		dockerfilePath = path.join(dockerDir, `${stack}.Dockerfile`);
		contextDir = dockerDir;

		// Write Dockerfile if it doesn't exist yet (first run)
		if (!(await fs.pathExists(dockerfilePath))) {
			await fs.ensureDir(dockerDir);
			await fs.writeFile(dockerfilePath, getDockerfileContent(stack), "utf-8");
		}
	}

	// Staleness check: compare Dockerfile hash with the one embedded in the image label
	const content = await fs.readFile(dockerfilePath, "utf-8");
	const currentHash = crypto.createHash("sha256").update(content).digest("hex");

	let imageHash = "";
	try {
		const { stdout } = await execFileAsync("docker", [
			"inspect",
			"--format",
			'{{index .Config.Labels "dockerfile-hash"}}',
			imageName,
		]);
		imageHash = stdout.trim();
	} catch {
		// Image doesn't exist yet
	}

	if (currentHash === imageHash) {
		return imageName;
	}

	// Build image
	const buildArgs = [
		"build",
		"--label",
		`dockerfile-hash=${currentHash}`,
		"-f",
		dockerfilePath,
		"-t",
		imageName,
	];

	if (
		!buildContext &&
		javaVersion &&
		(stack === "java-gradle" || stack === "java-maven")
	) {
		buildArgs.push("--build-arg", `JAVA_VERSION=${javaVersion}`);
	}

	buildArgs.push(contextDir);

	await new Promise<void>((resolve, reject) => {
		const proc = spawn("docker", buildArgs, { stdio: "inherit" });
		proc.on("close", (code) =>
			code === 0
				? resolve()
				: reject(new Error(`docker build exited with code ${code}`)),
		);
		proc.on("error", reject);
	});

	return imageName;
}

// =============================================================================
// Run command in container
// =============================================================================

/**
 * Run a shell command inside the CI Docker container.
 * Mounts projectDir as /home/runner/work.
 * Streams output to process.stdout/stderr by default.
 */
export async function runInContainer(
	options: DockerRunOptions,
): Promise<DockerRunResult> {
	const {
		projectDir,
		image,
		command,
		timeout,
		stream = true,
		user,
		env,
	} = options;
	// The image is always pre-resolved by the caller (resolveCIRunners →
	// ensureImage or an explicit/digest-pinned config image). No marker
	// detection happens on this path — ever.
	const imageName = image;

	const isInteractive = process.stdin.isTTY && stream;
	// ENV-1: match the container process to the HOST user. The images bake a
	// `runner` user whose uid depends on the base (1001 on node:22-slim, where
	// uid 1000 is already `node`). When that uid differs from the host uid,
	// everything the container writes to the bind-mounted workspace (dist/,
	// node_modules/.vite-temp, build output) lands owned by the wrong user,
	// and the host's local vitest then fails with EACCES. Running as the host
	// uid:gid makes artifacts host-owned — no chown dance, ever. An explicit
	// `user` override still wins (e.g. a caller that needs root). getuid/getgid
	// are undefined on non-POSIX platforms (Windows); there we omit the flag
	// and keep the image default.
	const uid = process.getuid?.();
	const gid = process.getgid?.();
	const runAsUser =
		user ??
		(uid !== undefined && gid !== undefined ? `${uid}:${gid}` : undefined);
	// Env injection (containerized-gates gate 2): CI=true FIRST, then one
	// discrete `-e KEY=VALUE` argv pair per caller entry. These are argv
	// elements handed to spawn (no shell), so values with spaces/`=`/newlines
	// survive verbatim — Docker splits only on the first `=`. A caller passing
	// no map yields the same argv as before (only `-e CI=true`).
	const envArgs: string[] = ["-e", "CI=true"];
	for (const [k, v] of Object.entries(env ?? {})) {
		envArgs.push("-e", `${k}=${v}`);
	}
	// A unique container name so the HOST-SIDE timeout can `docker stop <cid>`
	// a concrete target (design gate 1) rather than guessing.
	const cid = `javi-forge-ci-${crypto.randomBytes(6).toString("hex")}`;
	// Use --mount instead of -v: the -v form parses the value as a single
	// "src:dst[:opt]" colon-separated string, which breaks (and could be
	// hijacked) when projectDir itself contains a colon. --mount takes
	// comma-separated key=value pairs and is colon-safe.
	//
	// NOTE (containerized-gates gate 1): the in-container `timeout <N>` wrapper
	// is REMOVED. The timeout is enforced host-side below (host wall-clock timer
	// → `docker stop`), so the container command is just `bash -c <cmd>`. This
	// mirrors runGateNative (ci.ts) one level up, at the docker-run process.
	const dockerArgs = [
		"run",
		"--rm",
		...(isInteractive ? ["-it"] : []),
		"--name",
		cid,
		"--stop-timeout",
		"30",
		"--entrypoint",
		"",
		...(runAsUser ? ["--user", runAsUser] : []),
		"--mount",
		`type=bind,source=${projectDir},target=/home/runner/work`,
		...envArgs,
		imageName,
		"bash",
		"-c",
		command,
	];

	return new Promise<DockerRunResult>((resolve, reject) => {
		const proc = spawn("docker", dockerArgs, {
			stdio: stream ? "inherit" : "pipe",
		});

		let stdout = "";
		let stderr = "";

		// HOST-SIDE timeout (design gate 1): arm a host wall-clock timer ONLY when
		// a timeout is provided. When it fires, set `timedOut = true` BEFORE the
		// kill (authoritative — never inferred from the exit code), then
		// `docker stop -t <grace> <cid>` (SIGTERM → SIGKILL after grace) to tear
		// the CONTAINER down by name — NOT `proc.kill()` on the client, which would
		// orphan the container. A `backstopTimer` SIGKILLs the docker-run CLIENT
		// only as a LAST RESORT: if `docker stop` itself wedges (dead daemon) the
		// client would never `close` and the gate would hang forever. `--rm` +
		// `--name <cid>` keep any orphan bounded and identifiable. No timeout →
		// no timer → the container runs UNBOUNDED (no silent cap).
		let killTimer: NodeJS.Timeout | undefined;
		let backstopTimer: NodeJS.Timeout | undefined;
		let timedOut = false;
		const clearTimers = () => {
			if (killTimer !== undefined) clearTimeout(killTimer);
			if (backstopTimer !== undefined) clearTimeout(backstopTimer);
		};
		if (timeout !== undefined) {
			killTimer = setTimeout(() => {
				timedOut = true;
				// Fire-and-forget teardown: swallow spawn errors (e.g. the docker
				// binary vanished mid-run) so an unhandled 'error' event can't crash
				// the process. The armed backstopTimer still guarantees the run
				// promise resolves via the client SIGKILL. (jd A+B convergent finding)
				spawn("docker", ["stop", "-t", String(DOCKER_STOP_GRACE_SEC), cid], {
					stdio: "ignore",
				}).on("error", () => {});
				backstopTimer = setTimeout(
					() => {
						proc.kill("SIGKILL");
					},
					(DOCKER_STOP_GRACE_SEC + 1) * 1000,
				);
			}, timeout * 1000);
		}

		if (!stream) {
			proc.stdout?.on("data", (d: Buffer) => {
				stdout += d.toString();
			});
			proc.stderr?.on("data", (d: Buffer) => {
				stderr += d.toString();
			});
		}

		proc.on("close", (code) => {
			clearTimers();
			resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
		});
		proc.on("error", (e) => {
			clearTimers();
			reject(e);
		});
	});
}

/**
 * Grace (seconds) passed to `docker stop -t` between the container SIGTERM and
 * the daemon's escalated SIGKILL. The client-side backstop fires one second
 * after this window to guarantee the run promise always resolves.
 */
const DOCKER_STOP_GRACE_SEC = 10;

/**
 * Open an interactive shell inside the CI container.
 * The image must be pre-resolved by the caller (no marker detection here).
 */
export async function openShell(
	projectDir: string,
	image: string,
): Promise<void> {
	const imageName = image;

	// ENV-1: run the interactive shell as the host user too, so anything
	// written from the debug shell stays host-owned. See runInContainer.
	const uid = process.getuid?.();
	const gid = process.getgid?.();
	const runAsUser =
		uid !== undefined && gid !== undefined ? `${uid}:${gid}` : undefined;

	await new Promise<void>((resolve, reject) => {
		const proc = spawn(
			"docker",
			[
				"run",
				"--rm",
				"-it",
				"--entrypoint",
				"",
				...(runAsUser ? ["--user", runAsUser] : []),
				// --mount is colon-safe; see runInContainer for the rationale.
				"--mount",
				`type=bind,source=${projectDir},target=/home/runner/work`,
				"-e",
				"CI=true",
				imageName,
				"bash",
				"-c",
				"cd /home/runner/work && exec bash",
			],
			{ stdio: "inherit" },
		);

		proc.on("close", () => resolve());
		proc.on("error", reject);
	});
}
