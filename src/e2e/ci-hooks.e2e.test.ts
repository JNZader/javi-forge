/**
 * E2E hook-contract tests for mixed-stack CI — plan task 7.
 *
 * The git hooks installed by `javi-forge ci init` delegate to these commands:
 *   pre-commit: javi-forge ci --quick --no-docker --no-security --no-ci-ghagga
 *   pre-push:   javi-forge ci   (full, Docker)
 * The hook blocks the git operation when the command exits non-zero. These
 * tests prove exit-code propagation end to end by spawning the compiled CLI
 * in a hybrid repository: a failing configured runner must produce exit 1,
 * a passing run must produce exit 0.
 *
 * Notes:
 *   - The pre-push FAILURE case uses the exact bare hook command: the runner
 *     fails during lint, before the environment-gated semgrep/ghagga steps.
 *   - The pre-push SUCCESS case passes --no-security --no-ci-ghagga because
 *     semgrep/ghagga are global, environment-dependent gates orthogonal to
 *     runner plumbing (covered by their own unit tests).
 *   - Docker cases are skipped when Docker or the local bash:5 image is
 *     unavailable; args-level coverage lives in src/lib/docker.test.ts.
 *
 * Prerequisites: `pnpm build` must be run before these tests.
 */
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";
import { isDockerAvailable } from "../lib/docker.js";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(__dirname, "../../dist/index.js");

const DOCKER_OK = await isDockerAvailable();
const BASH_IMAGE_OK =
	DOCKER_OK &&
	(await (async () => {
		try {
			await execFileAsync("docker", ["image", "inspect", "bash:5"], {
				timeout: 10_000,
			});
			return true;
		} catch {
			return false;
		}
	})());

// ── Helpers ──────────────────────────────────────────────────────────────────

const sandboxes: string[] = [];

afterEach(async () => {
	for (const dir of sandboxes) {
		await fs.remove(dir).catch(() => {});
	}
	sandboxes.length = 0;
});

async function runCLI(
	args: string[],
	options: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	try {
		const { stdout, stderr } = await execFileAsync(
			"node",
			[CLI_PATH, ...args],
			{
				timeout: options.timeout ?? 60_000,
				cwd: options.cwd,
				env: {
					...process.env,
					FORCE_COLOR: "0",
					CI: "1",
					...options.env,
				},
			},
		);
		return { stdout, stderr, exitCode: 0 };
	} catch (e: unknown) {
		const err = e as Record<string, unknown>;
		return {
			stdout: (err.stdout as string) ?? "",
			stderr: (err.stderr as string) ?? "",
			exitCode: (err.code as number) ?? 1,
		};
	}
}

/** Hybrid repo: root package.json + nested backend/ Python project. */
async function createHybridRepo(configYaml: string): Promise<string> {
	const dir = path.join(os.tmpdir(), `javi-forge-hooks-${crypto.randomUUID()}`);
	await fs.ensureDir(dir);
	sandboxes.push(dir);
	await fs.writeJson(path.join(dir, "package.json"), {
		name: "hybrid-hooks-fixture",
	});
	await fs.ensureDir(path.join(dir, "backend"));
	await fs.writeFile(path.join(dir, "backend", "pyproject.toml"), "");
	await fs.outputFile(path.join(dir, ".javi-forge", "ci.yaml"), configYaml);
	return dir;
}

const PASSING_CONFIG = `
version: 1
runners:
  - name: backend
    stack: python
    directory: backend
    lint: "true"
  - name: frontend
    stack: node
    directory: .
    lint: "true"
`;

const FAILING_CONFIG = `
version: 1
runners:
  - name: backend
    stack: python
    directory: backend
    lint: "exit 1"
  - name: frontend
    stack: node
    directory: .
    lint: "true"
`;

// The exact command the pre-commit hook invokes.
const PRE_COMMIT_ARGS = [
	"ci",
	"--quick",
	"--no-docker",
	"--no-security",
	"--no-ci-ghagga",
];

// ── pre-commit path (--quick --no-docker) ────────────────────────────────────

describe("hook contract — pre-commit (quick, no-docker)", () => {
	it("passing configured runners exit 0 — commit proceeds", async () => {
		const repo = await createHybridRepo(PASSING_CONFIG);
		const { exitCode, stdout } = await runCLI(PRE_COMMIT_ARGS, { cwd: repo });

		expect(exitCode).toBe(0);
		expect(stdout).toContain("Lint [backend] passed");
		expect(stdout).toContain("Lint [frontend] passed");
	});

	it("a failing configured runner exits 1 — commit is blocked", async () => {
		const repo = await createHybridRepo(FAILING_CONFIG);
		const { exitCode, stdout } = await runCLI(PRE_COMMIT_ARGS, { cwd: repo });

		expect(exitCode).toBe(1);
		expect(stdout).toContain("Lint [backend] failed");
		// Fail fast: the frontend runner must not execute.
		expect(stdout).not.toContain("Lint [frontend]");
	});

	it("a missing required tool (ruff) fails closed with exit 1", async () => {
		// Curated PATH without ruff: the check runs command -v ruff, which
		// must fail even though every command in the config would succeed.
		const binDir = path.join(
			os.tmpdir(),
			`javi-forge-path-${crypto.randomUUID()}`,
		);
		sandboxes.push(binDir);
		await fs.ensureDir(binDir);
		for (const tool of ["node", "bash", "python3"]) {
			const real = (
				await execFileAsync("bash", ["-c", `command -v ${tool}`])
			).stdout.trim();
			await fs.symlink(real, path.join(binDir, tool));
		}

		const repo = await createHybridRepo(`
version: 1
runners:
  - name: backend
    stack: python
    directory: backend
    lint: "true"
    requires: [ruff]
`);
		const { exitCode, stdout } = await runCLI(PRE_COMMIT_ARGS, {
			cwd: repo,
			env: { PATH: binDir },
		});

		expect(exitCode).toBe(1);
		// Ink wraps long lines in the terminal frame — normalize whitespace.
		const flat = stdout.replace(/\s+/g, " ");
		expect(flat).toContain('required tool "ruff" not found');
		expect(flat).toContain("backend");
		// The runner's lint never executed (would have passed — proving the
		// failure comes from the tool check, not from the command).
		expect(stdout).not.toContain("Lint [backend] passed");
	});
});

// ── pre-push path (full, Docker) ─────────────────────────────────────────────

describe("hook contract — pre-push (full, docker)", () => {
	it.skipIf(!BASH_IMAGE_OK)(
		"a failing configured runner exits 1 with the exact bare hook command — push is blocked",
		async () => {
			const repo = await createHybridRepo(`
version: 1
runners:
  - name: pinned
    stack: node
    image: bash:5
    lint: "exit 1"
`);
			// Exact command the pre-push hook runs. The runner fails during
			// lint, before the environment-gated semgrep/ghagga steps.
			const { exitCode, stdout } = await runCLI(["ci"], {
				cwd: repo,
				timeout: 120_000,
			});

			expect(exitCode).toBe(1);
			expect(stdout).toContain("Lint [pinned] failed");
		},
		180_000,
	);

	it.skipIf(!BASH_IMAGE_OK)(
		"passing configured runners exit 0 — push proceeds",
		async () => {
			const repo = await createHybridRepo(`
version: 1
runners:
  - name: pinned
    stack: node
    image: bash:5
    lint: "true"
    requires: [bash]
`);
			// semgrep/ghagga are global, environment-gated steps orthogonal to
			// runner plumbing; they are disabled here for determinism.
			const { exitCode, stdout } = await runCLI(
				["ci", "--no-security", "--no-ci-ghagga"],
				{ cwd: repo, timeout: 120_000 },
			);

			expect(exitCode).toBe(0);
			expect(stdout).toContain("Required tools OK [pinned]");
			expect(stdout).toContain("Lint [pinned] passed");
		},
		180_000,
	);
});
