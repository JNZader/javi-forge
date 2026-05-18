import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Stack } from "../types/index.js";

// Mocks must be declared BEFORE the imports they target. vi.mock is hoisted
// to the top of the file at parse time.
vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
	spawn: vi.fn(),
}));
vi.mock("fs-extra", () => ({
	default: {
		pathExists: vi.fn(),
		readFile: vi.fn(),
		writeFile: vi.fn(),
		ensureDir: vi.fn(),
	},
}));

const childProcess = await import("node:child_process");
const fs = (await import("fs-extra")).default as unknown as {
	pathExists: ReturnType<typeof vi.fn>;
	readFile: ReturnType<typeof vi.fn>;
	writeFile: ReturnType<typeof vi.fn>;
	ensureDir: ReturnType<typeof vi.fn>;
};

const {
	ensureImage,
	getDockerfileContent,
	getImageName,
	isDockerAvailable,
	openShell,
	runInContainer,
} = await import("./docker.js");

// ─── Helpers ────────────────────────────────────────────────────────

/** Build a fake ChildProcess with controllable close/error events. */
function fakeProc(
	opts: {
		exit?: number;
		error?: Error;
		stdoutChunks?: string[];
		stderrChunks?: string[];
	} = {},
) {
	const proc = new EventEmitter() as EventEmitter & {
		stdout: EventEmitter;
		stderr: EventEmitter;
	};
	proc.stdout = new EventEmitter();
	proc.stderr = new EventEmitter();
	setImmediate(() => {
		for (const chunk of opts.stdoutChunks ?? [])
			proc.stdout.emit("data", Buffer.from(chunk));
		for (const chunk of opts.stderrChunks ?? [])
			proc.stderr.emit("data", Buffer.from(chunk));
		if (opts.error) proc.emit("error", opts.error);
		else proc.emit("close", opts.exit ?? 0);
	});
	return proc;
}

/** Coerce the mocked execFile signature into something callable from tests. */
const execFileMock = childProcess.execFile as unknown as ReturnType<
	typeof vi.fn
>;
const spawnMock = childProcess.spawn as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// =============================================================================
// getImageName (kept from previous test file)
// =============================================================================

describe("getImageName", () => {
	it("returns correct name for each stack", () => {
		const cases: [Stack, string][] = [
			["node", "javi-forge-ci-node"],
			["python", "javi-forge-ci-python"],
			["go", "javi-forge-ci-go"],
			["rust", "javi-forge-ci-rust"],
			["java-gradle", "javi-forge-ci-java-gradle"],
			["java-maven", "javi-forge-ci-java-maven"],
		];
		for (const [stack, expected] of cases) {
			expect(getImageName(stack)).toBe(expected);
		}
	});
});

// =============================================================================
// getDockerfileContent
// =============================================================================

describe("getDockerfileContent", () => {
	it("node Dockerfile uses node:22-slim and installs pnpm", () => {
		const content = getDockerfileContent("node");
		expect(content).toContain("node:22-slim");
		expect(content).toContain("pnpm");
		expect(content).toContain("runner");
		expect(content).toContain('ENTRYPOINT ["/bin/bash", "-c"]');
	});

	it("java-gradle Dockerfile uses eclipse-temurin with ARG JAVA_VERSION", () => {
		const content = getDockerfileContent("java-gradle");
		expect(content).toContain("ARG JAVA_VERSION");
		expect(content).toContain("eclipse-temurin");
	});

	it("java-maven shares Dockerfile with java-gradle", () => {
		expect(getDockerfileContent("java-maven")).toBe(
			getDockerfileContent("java-gradle"),
		);
	});

	it("python Dockerfile installs pytest ruff pylint", () => {
		const content = getDockerfileContent("python");
		expect(content).toContain("python:3.12-slim");
		expect(content).toContain("pytest");
		expect(content).toContain("ruff");
	});

	it("go Dockerfile installs golangci-lint", () => {
		const content = getDockerfileContent("go");
		expect(content).toContain("golang:");
		expect(content).toContain("golangci-lint");
	});

	it("rust Dockerfile adds clippy rustfmt", () => {
		const content = getDockerfileContent("rust");
		expect(content).toContain("rust:");
		expect(content).toContain("clippy");
		expect(content).toContain("rustfmt");
	});

	it("all Dockerfiles set WORKDIR /home/runner/work", () => {
		const stacks: Stack[] = [
			"node",
			"python",
			"go",
			"rust",
			"java-gradle",
			"java-maven",
		];
		for (const stack of stacks) {
			expect(getDockerfileContent(stack)).toContain(
				"WORKDIR /home/runner/work",
			);
		}
	});

	it("elixir (unknown) falls back to ubuntu:24.04", () => {
		const content = getDockerfileContent("elixir" as Stack);
		expect(content).toContain("ubuntu:24.04");
	});
});

// =============================================================================
// isDockerAvailable
// =============================================================================

describe("isDockerAvailable", () => {
	it("returns true when docker info succeeds", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
			(
				cb as (e: Error | null, out: { stdout: string; stderr: string }) => void
			)(null, { stdout: "", stderr: "" });
			return undefined as never;
		});
		expect(await isDockerAvailable()).toBe(true);
	});

	it("returns false when docker info throws", async () => {
		execFileMock.mockImplementation((_cmd, _args, _opts, cb) => {
			(cb as (e: Error | null) => void)(new Error("docker not running"));
			return undefined as never;
		});
		expect(await isDockerAvailable()).toBe(false);
	});
});

// =============================================================================
// ensureImage
// =============================================================================

describe("ensureImage", () => {
	const dockerDir = "/tmp/dockerfiles";

	it("writes Dockerfile on first run when it doesn't exist", async () => {
		fs.pathExists.mockResolvedValue(false);
		fs.readFile.mockResolvedValue(getDockerfileContent("node"));
		fs.ensureDir.mockResolvedValue(undefined);
		fs.writeFile.mockResolvedValue(undefined);
		// inspect throws → image doesn't exist yet
		execFileMock.mockImplementation((_cmd, _args, cb) => {
			(cb as (e: Error | null) => void)(new Error("no such image"));
			return undefined as never;
		});
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));

		const name = await ensureImage({
			stack: "node",
			dockerfilesDir: dockerDir,
		});

		expect(name).toBe("javi-forge-ci-node");
		expect(fs.ensureDir).toHaveBeenCalledWith(dockerDir);
		expect(fs.writeFile).toHaveBeenCalledWith(
			expect.stringContaining("node.Dockerfile"),
			expect.stringContaining("node:22-slim"),
			"utf-8",
		);
		expect(spawnMock).toHaveBeenCalledWith(
			"docker",
			expect.arrayContaining([
				"build",
				"--label",
				expect.stringContaining("dockerfile-hash="),
			]),
			expect.objectContaining({ stdio: "inherit" }),
		);
	});

	it("skips build when image hash matches Dockerfile hash", async () => {
		const content = getDockerfileContent("node");
		const crypto = await import("node:crypto");
		const hash = crypto.createHash("sha256").update(content).digest("hex");

		fs.pathExists.mockResolvedValue(true);
		fs.readFile.mockResolvedValue(content);
		execFileMock.mockImplementation((_cmd, _args, cb) => {
			(
				cb as (e: Error | null, out: { stdout: string; stderr: string }) => void
			)(null, { stdout: `${hash}\n`, stderr: "" });
			return undefined as never;
		});

		const name = await ensureImage({
			stack: "node",
			dockerfilesDir: dockerDir,
		});

		expect(name).toBe("javi-forge-ci-node");
		expect(spawnMock).not.toHaveBeenCalled();
	});

	it("rebuilds when Dockerfile hash differs from image label", async () => {
		fs.pathExists.mockResolvedValue(true);
		fs.readFile.mockResolvedValue(getDockerfileContent("node"));
		execFileMock.mockImplementation((_cmd, _args, cb) => {
			(
				cb as (e: Error | null, out: { stdout: string; stderr: string }) => void
			)(null, { stdout: "stale-hash\n", stderr: "" });
			return undefined as never;
		});
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));

		await ensureImage({ stack: "node", dockerfilesDir: dockerDir });

		expect(spawnMock).toHaveBeenCalledTimes(1);
	});

	it("passes JAVA_VERSION build-arg for java stacks", async () => {
		fs.pathExists.mockResolvedValue(true);
		fs.readFile.mockResolvedValue(getDockerfileContent("java-gradle"));
		execFileMock.mockImplementation((_cmd, _args, cb) => {
			(cb as (e: Error | null) => void)(new Error("no image"));
			return undefined as never;
		});
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));

		await ensureImage({
			stack: "java-gradle",
			javaVersion: "17",
			dockerfilesDir: dockerDir,
		});

		const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
		expect(callArgs).toContain("--build-arg");
		expect(callArgs).toContain("JAVA_VERSION=17");
	});

	it("does NOT pass JAVA_VERSION for non-java stacks", async () => {
		fs.pathExists.mockResolvedValue(true);
		fs.readFile.mockResolvedValue(getDockerfileContent("node"));
		execFileMock.mockImplementation((_cmd, _args, cb) => {
			(cb as (e: Error | null) => void)(new Error("no image"));
			return undefined as never;
		});
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));

		await ensureImage({
			stack: "node",
			javaVersion: "17",
			dockerfilesDir: dockerDir,
		});

		const callArgs = spawnMock.mock.calls[0]?.[1] as string[];
		expect(callArgs).not.toContain("JAVA_VERSION=17");
	});

	it("throws when docker build exits non-zero", async () => {
		fs.pathExists.mockResolvedValue(true);
		fs.readFile.mockResolvedValue(getDockerfileContent("node"));
		execFileMock.mockImplementation((_cmd, _args, cb) => {
			(cb as (e: Error | null) => void)(new Error("no image"));
			return undefined as never;
		});
		spawnMock.mockReturnValue(fakeProc({ exit: 1 }));

		await expect(
			ensureImage({ stack: "node", dockerfilesDir: dockerDir }),
		).rejects.toThrow(/docker build exited with code 1/);
	});

	it("propagates spawn errors", async () => {
		fs.pathExists.mockResolvedValue(true);
		fs.readFile.mockResolvedValue(getDockerfileContent("node"));
		execFileMock.mockImplementation((_cmd, _args, cb) => {
			(cb as (e: Error | null) => void)(new Error("no image"));
			return undefined as never;
		});
		spawnMock.mockReturnValue(fakeProc({ error: new Error("ENOENT docker") }));

		await expect(
			ensureImage({ stack: "node", dockerfilesDir: dockerDir }),
		).rejects.toThrow(/ENOENT docker/);
	});
});

// =============================================================================
// runInContainer
// =============================================================================

describe("runInContainer", () => {
	const projectDir = "/tmp/proj";

	beforeEach(() => {
		// Stack detection: project has package.json → node
		fs.pathExists.mockImplementation(async (p: string) =>
			p.endsWith("package.json"),
		);
	});

	it("builds correct docker run args with default options", async () => {
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));

		const result = await runInContainer({
			projectDir,
			command: "pnpm test",
			stream: false,
		});

		expect(result.exitCode).toBe(0);
		const args = spawnMock.mock.calls[0]?.[1] as string[];
		expect(args[0]).toBe("run");
		expect(args).toContain("--rm");
		expect(args).toContain("--entrypoint");
		// --mount (comma-syntax) is colon-safe; -v form is not.
		expect(args).toContain("--mount");
		expect(args).toContain(
			`type=bind,source=${projectDir},target=/home/runner/work`,
		);
		expect(args).not.toContain("-v");
		expect(args).toContain("-e");
		expect(args).toContain("CI=true");
		expect(args).toContain("javi-forge-ci-node");
		expect(args).toContain("timeout");
		expect(args).toContain("600");
		expect(args).toContain("bash");
		expect(args).toContain("-c");
		expect(args[args.length - 1]).toBe("pnpm test");
	});

	it("uses --mount syntax to avoid colon-in-path attacks", async () => {
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));
		// Colon-containing path is legal on Linux but would hijack the `-v`
		// source:target:options parser. --mount uses comma syntax → safe.
		const evilDir = "/tmp/a:/etc";
		await runInContainer({
			projectDir: evilDir,
			command: "echo x",
			stream: false,
		});
		const args = spawnMock.mock.calls[0]?.[1] as string[];
		expect(args).toContain("--mount");
		const mountArg = args.find((a) => a.startsWith("type=bind,"));
		expect(mountArg).toBe(
			`type=bind,source=${evilDir},target=/home/runner/work`,
		);
		// Ensure the legacy -v form is gone — otherwise the protection is theatre.
		expect(args).not.toContain("-v");
	});

	it("respects custom timeout", async () => {
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));
		await runInContainer({
			projectDir,
			command: "pnpm test",
			timeout: 120,
			stream: false,
		});
		const args = spawnMock.mock.calls[0]?.[1] as string[];
		expect(args).toContain("120");
	});

	it("applies user override", async () => {
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));
		await runInContainer({
			projectDir,
			command: "ls",
			user: "root",
			stream: false,
		});
		const args = spawnMock.mock.calls[0]?.[1] as string[];
		expect(args).toContain("--user");
		expect(args).toContain("root");
	});

	it("captures stdout/stderr when stream=false", async () => {
		spawnMock.mockReturnValue(
			fakeProc({
				exit: 0,
				stdoutChunks: ["hello\n"],
				stderrChunks: ["warn\n"],
			}),
		);
		const result = await runInContainer({
			projectDir,
			command: "echo hi",
			stream: false,
		});
		expect(result.stdout).toContain("hello");
		expect(result.stderr).toContain("warn");
	});

	it("returns exit code 1 when process exits with null code", async () => {
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));
		// Override emit to send null
		const proc = new EventEmitter() as EventEmitter & {
			stdout: EventEmitter;
			stderr: EventEmitter;
		};
		proc.stdout = new EventEmitter();
		proc.stderr = new EventEmitter();
		spawnMock.mockReturnValue(proc);
		setImmediate(() => proc.emit("close", null));

		const result = await runInContainer({
			projectDir,
			command: "x",
			stream: false,
		});
		expect(result.exitCode).toBe(1);
	});

	it("rejects on process error", async () => {
		spawnMock.mockReturnValue(fakeProc({ error: new Error("docker missing") }));
		await expect(
			runInContainer({ projectDir, command: "x", stream: false }),
		).rejects.toThrow(/docker missing/);
	});
});

// =============================================================================
// openShell
// =============================================================================

describe("openShell", () => {
	const projectDir = "/tmp/proj";

	beforeEach(() => {
		fs.pathExists.mockImplementation(async (p: string) =>
			p.endsWith("package.json"),
		);
	});

	it("builds an interactive docker run with bash -c", async () => {
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));
		await openShell(projectDir);

		const args = spawnMock.mock.calls[0]?.[1] as string[];
		expect(args).toContain("-it");
		expect(args).toContain("javi-forge-ci-node");
		// --mount (colon-safe) is also required here.
		expect(args).toContain("--mount");
		expect(args).not.toContain("-v");
		expect(args).toContain("bash");
		expect(args[args.length - 1]).toContain(
			"cd /home/runner/work && exec bash",
		);
	});

	it("propagates spawn errors", async () => {
		spawnMock.mockReturnValue(fakeProc({ error: new Error("oops") }));
		await expect(openShell(projectDir)).rejects.toThrow(/oops/);
	});
});

// =============================================================================
// detectStackFromDir (exercised via runInContainer)
// =============================================================================

describe("detectStackFromDir (via runInContainer)", () => {
	const projectDir = "/tmp/proj";

	const stackFor = async (marker: string, expectedImage: string) => {
		fs.pathExists.mockImplementation(async (p: string) => p.endsWith(marker));
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));
		await runInContainer({ projectDir, command: "x", stream: false });
		const args = spawnMock.mock.calls[0]?.[1] as string[];
		expect(args).toContain(expectedImage);
	};

	it("detects java-gradle from build.gradle.kts", () =>
		stackFor("build.gradle.kts", "javi-forge-ci-java-gradle"));
	it("detects java-gradle from build.gradle", () =>
		stackFor("build.gradle", "javi-forge-ci-java-gradle"));
	it("detects java-maven from pom.xml", () =>
		stackFor("pom.xml", "javi-forge-ci-java-maven"));
	it("detects node from package.json", () =>
		stackFor("package.json", "javi-forge-ci-node"));
	it("detects go from go.mod", () => stackFor("go.mod", "javi-forge-ci-go"));
	it("detects rust from Cargo.toml", () =>
		stackFor("Cargo.toml", "javi-forge-ci-rust"));
	it("detects python from pyproject.toml", () =>
		stackFor("pyproject.toml", "javi-forge-ci-python"));
	it("detects python from requirements.txt", () =>
		stackFor("requirements.txt", "javi-forge-ci-python"));

	it("falls back to node when no marker present", async () => {
		fs.pathExists.mockResolvedValue(false);
		spawnMock.mockReturnValue(fakeProc({ exit: 0 }));
		await runInContainer({ projectDir, command: "x", stream: false });
		const args = spawnMock.mock.calls[0]?.[1] as string[];
		expect(args).toContain("javi-forge-ci-node");
	});
});
