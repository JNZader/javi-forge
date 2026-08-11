/**
 * E2E hook-contract tests for the consolidated hook dispatcher.
 *
 * Since hook-consolidation, the static shims installed by `javi-forge ci init`
 * delegate to the SAME dispatcher entry point:
 *   pre-commit: javi-forge hooks run pre-commit
 *   pre-push:   javi-forge hooks run pre-push
 * The dispatcher (not the shim) composes the sections enabled under `hooks:` in
 * `.javi-forge/ci.yaml` and runs them fail-fast. The default composition, with
 * no `hooks:` config, is the quick native CI gate (setup + lint + compile +
 * gates — no tests, no coverage). The shim blocks the git operation when the
 * dispatcher exits non-zero.
 *
 * These tests prove the shim → dispatcher → exit-code round trip end to end by
 * spawning the COMPILED CLI:
 *   1. `hooks run pre-commit` against a real `hooks:` config composes the ci
 *      section and propagates its exit code (0 on pass, non-zero on a blocking
 *      failure).
 *   2. `hooks run <bogus>` prints usage and exits 1 (fail-closed).
 *   3. `ci init` installs a shim whose body invokes `javi-forge hooks run
 *      <name>` — the delegation the round trip depends on.
 *
 * The ci-section quick-gate exit propagation is exercised directly below via the
 * flag vector the section wraps; the argv-log proof that the installed shim
 * drives the dispatcher lives in
 * src/__integration__/ci-hooks-exec.integration.test.ts.
 *
 * Notes:
 *   - args-level coverage lives in src/lib/docker.test.ts.
 *
 * Prerequisites: `pnpm build` must be run before these tests.
 */
import { execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const CLI_PATH = path.resolve(__dirname, "../../dist/index.js");

/** Probe a host toolchain once at module load — skip (not fail) when absent. */
async function hasTool(tool: string): Promise<boolean> {
	try {
		await execFileAsync("bash", ["-c", `command -v ${tool}`], {
			timeout: 5_000,
		});
		return true;
	} catch {
		return false;
	}
}

// The ruff-missing case curates a PATH by symlinking python3 from the host, so
// it needs python3 present. A node-only containerized runner lacks it → SKIP.
const PYTHON_OK = await hasTool("python3");

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

// A valid v2 config whose ci section wraps the same quick native gate the shims
// default to. `runners` give the ci section real work; `hooks:` enables only the
// ci section so the round trip is deterministic.
const DISPATCH_PASSING_CONFIG = `
version: 2
runners:
  - name: backend
    stack: python
    directory: backend
    lint: "true"
  - name: frontend
    stack: node
    directory: .
    lint: "true"
hooks:
  pre-commit:
    ci: true
  pre-push:
    ci: true
`;

const DISPATCH_FAILING_CONFIG = `
version: 2
runners:
  - name: backend
    stack: python
    directory: backend
    lint: "exit 1"
  - name: frontend
    stack: node
    directory: .
    lint: "true"
hooks:
  pre-commit:
    ci: true
`;

// ── ci-section quick gate (the vector the ci section wraps) ───────────────────
// This block proves the quick native gate's exit-code propagation directly via
// the flag vector the dispatcher's ci section invokes in-process. The dispatcher
// round trip (shim → hooks run → this gate) is proven in the block below.

describe("hook contract — ci section quick gate (quick, no-docker)", () => {
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

	it.skipIf(!PYTHON_OK)(
		"a missing required tool (ruff) fails closed with exit 1",
		async () => {
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
		},
	);
});

// The pre-push (full, docker) contract block was RETIRED in hooks-ricos Slice B:
// the native pre-push arg vector is now identical to pre-commit's
// (`ci --quick --no-docker --no-security --no-ci-ghagga`), so its exit-code
// propagation is already proven by the ci-section quick-gate block above. Docker
// image-gate behavior is covered by src/commands/ci.test.ts (runGates) and
// src/lib/docker.test.ts; re-testing it here would be redundant.

// ── dispatcher round trip: shim → hooks run → exit code ──────────────────────
// The substantive S5 assertion: the BUILT CLI's `hooks run <name>` reads the
// `hooks:` config, composes the ci section and propagates its exit code; a bogus
// hook name fails closed; and the shim `ci init` installs actually invokes
// `javi-forge hooks run <name>`.

describe("hook dispatcher — hooks run round trip", () => {
	it("hooks run pre-commit composes the ci section and exits 0 on pass", async () => {
		const repo = await createHybridRepo(DISPATCH_PASSING_CONFIG);
		const { exitCode, stdout } = await runCLI(["hooks", "run", "pre-commit"], {
			cwd: repo,
		});

		expect(exitCode).toBe(0);
		// The dispatcher announced the composed ci section...
		expect(stdout).toContain("▶ ci");
		// ...and the wrapped quick gate really ran both configured runners.
		expect(stdout).toContain("Lint [backend] passed");
		expect(stdout).toContain("Lint [frontend] passed");
	});

	it("hooks run pre-commit exits non-zero when the ci section fails", async () => {
		const repo = await createHybridRepo(DISPATCH_FAILING_CONFIG);
		const { exitCode, stdout, stderr } = await runCLI(
			["hooks", "run", "pre-commit"],
			{ cwd: repo },
		);

		expect(exitCode).toBe(1);
		// The ci section ran the failing runner (step feedback on stdout)...
		expect(stdout).toContain("Lint [backend] failed");
		// ...and the dispatcher reported the blocking section failure (stderr).
		expect(stderr).toContain("✗ ci failed");
	});

	it("hooks run pre-push composes the ci section and exits 0 on pass", async () => {
		const repo = await createHybridRepo(DISPATCH_PASSING_CONFIG);
		const { exitCode, stdout } = await runCLI(["hooks", "run", "pre-push"], {
			cwd: repo,
		});

		expect(exitCode).toBe(0);
		expect(stdout).toContain("▶ ci");
	});

	it("hooks run <bogus> prints usage and exits 1 (fail-closed)", async () => {
		const repo = await createHybridRepo(DISPATCH_PASSING_CONFIG);
		const { exitCode, stderr } = await runCLI(["hooks", "run", "post-merge"], {
			cwd: repo,
		});

		expect(exitCode).toBe(1);
		expect(stderr).toContain(
			"Usage: javi-forge hooks run <pre-commit|pre-push>",
		);
	});

	it("ci init installs a shim whose body invokes the dispatcher", async () => {
		const repo = await createHybridRepo(DISPATCH_PASSING_CONFIG);
		// A real git repo is required for installCIHooks to write .git/hooks.
		execFileSync("git", ["init"], { cwd: repo });

		const { exitCode } = await runCLI(["ci", "init"], { cwd: repo });
		expect(exitCode).toBe(0);

		// The installed shims delegate to the dispatcher — this is the link the
		// round trip above depends on.
		const preCommit = await fs.readFile(
			path.join(repo, ".git", "hooks", "pre-commit"),
			"utf-8",
		);
		const prePush = await fs.readFile(
			path.join(repo, ".git", "hooks", "pre-push"),
			"utf-8",
		);
		expect(preCommit).toContain("javi-forge hooks run pre-commit");
		expect(prePush).toContain("javi-forge hooks run pre-push");
	});
});
