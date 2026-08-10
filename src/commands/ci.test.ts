import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOOK_ASSETS_DIR } from "../constants.js";
import {
	ensureImage,
	getImageName,
	isDockerAvailable,
	openShell,
	runInContainer,
} from "../lib/docker.js";
import { changedFiles, resolveBaseRef } from "../lib/git-diff.js";
import type { Stack } from "../types/index.js";
import type { CIStep } from "./ci.js";
import {
	collectGateOutcomes,
	detectCIStack,
	installCIHooks,
	resolveCIRunners,
	runCI,
	runGateNative,
} from "./ci.js";

// Docker is mocked for this whole file. No pre-existing test in it reaches a
// Docker code path (they all run with `noDocker: true` or in `detect` mode), so
// the mock only becomes observable inside the characterization block below.
//
// `ensureImage` is PRODUCTION-FAITHFUL on purpose: the real implementation
// returns `imageTag ?? getImageName(stack)` (docker.ts:174,186), so the image
// assertions hold identically before and after the executor collapse — for the
// default per-stack image AND for a build-context runner, whose tag is the one
// production would return.
vi.mock("../lib/docker.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/docker.js")>();
	return {
		...actual,
		isDockerAvailable: vi.fn(async () => true),
		ensureImage: vi.fn(
			async (options: {
				stack: Stack;
				imageTag?: string;
				buildContext?: string;
			}) =>
				// PRODUCTION-FAITHFUL: `imageTag` is honored ONLY on the
				// build-context branch (docker.ts:173-174); without a build context
				// production ignores it and returns the per-stack name
				// (docker.ts:186). The previous, more permissive form honored
				// `imageTag` unconditionally (JDB5-004) — tightening it cannot flip
				// any existing assertion, because no test passes an `imageTag`
				// without a `buildContext`.
				options.buildContext !== undefined && options.imageTag !== undefined
					? options.imageTag
					: actual.getImageName(options.stack),
		),
		runInContainer: vi.fn(async () => ({
			exitCode: 0,
			stdout: "",
			stderr: "",
			timedOut: false,
		})),
		openShell: vi.fn(async () => {}),
	};
});

// The changed-file diff ENGINE (git-diff.ts) is exercised by its own unit +
// integration suites. Here we test the gate-phase WIRING that CONSUMES it, so the
// engine is mocked to make the scope:changed branches (non-empty / empty / null
// base / throw) fully deterministic and hermetic — no real git, no env pollution.
vi.mock("../lib/git-diff.js", () => ({
	resolveBaseRef: vi.fn(),
	changedFiles: vi.fn(),
}));

// The `semgrep`/`ghagga` availability probes shell out through this helper, so
// whether their steps run is a property of the DEVELOPER'S PATH, not of the
// code under test. Force both probes to "not installed" — everything else keeps
// the real implementation — so full-mode characterization runs are deterministic
// on every machine.
vi.mock("../lib/exec.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../lib/exec.js")>();
	const real = actual.execFileAsync as unknown as (
		...args: unknown[]
	) => Promise<unknown>;
	return {
		...actual,
		execFileAsync: vi.fn(async (file: string, ...rest: unknown[]) => {
			if (file === "semgrep" || file === "ghagga") {
				throw new Error(`${file}: not found (stubbed for tests)`);
			}
			return real(file, ...rest);
		}),
	};
});

// =============================================================================
// detectCIStack
// =============================================================================

describe("detectCIStack", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-ci-test-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("detects node + pnpm", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { lint: "eslint .", build: "tsc", test: "vitest run" },
		});
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");

		const info = await detectCIStack(tmpDir);
		expect(info.stackType).toBe("node");
		expect(info.buildTool).toBe("pnpm");
		expect(info.lintCmd).toContain("pnpm run lint");
		expect(info.compileCmd).toContain("pnpm run build");
		expect(info.testCmd).toBeTruthy();
	});

	it("detects node + npm (no lockfile)", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "jest" },
		});

		const info = await detectCIStack(tmpDir);
		expect(info.stackType).toBe("node");
		expect(info.buildTool).toBe("npm");
		expect(info.lintCmd).toBeNull();
		expect(info.compileCmd).toBeNull();
		expect(info.testCmd).toBeTruthy();
	});

	it("detects node + yarn", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await fs.writeFile(path.join(tmpDir, "yarn.lock"), "");

		const info = await detectCIStack(tmpDir);
		expect(info.buildTool).toBe("yarn");
	});

	it("returns null commands for node with no scripts", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });

		const info = await detectCIStack(tmpDir);
		expect(info.lintCmd).toBeNull();
		expect(info.compileCmd).toBeNull();
		expect(info.testCmd).toBeNull();
	});

	it("detects go", async () => {
		await fs.writeFile(path.join(tmpDir, "go.mod"), "module example.com/app");

		const info = await detectCIStack(tmpDir);
		expect(info.stackType).toBe("go");
		expect(info.buildTool).toBe("go");
		expect(info.lintCmd).toContain("golangci-lint");
		expect(info.compileCmd).toContain("go build ./...");
		expect(info.compileCmd).toContain("go clean -cache");
		// ENV-1: the container runs as the host uid, so no chown-back dance.
		expect(info.compileCmd).not.toContain("chown");
		expect(info.testCmd).toBe("go test ./...");
	});

	it("detects rust", async () => {
		await fs.writeFile(path.join(tmpDir, "Cargo.toml"), "[package]");

		const info = await detectCIStack(tmpDir);
		expect(info.stackType).toBe("rust");
		expect(info.lintCmd).toContain("clippy");
		expect(info.compileCmd).toContain("cargo build");
		expect(info.compileCmd).toContain("cargo clean");
		// ENV-1: the container runs as the host uid, so no chown-back dance.
		expect(info.compileCmd).not.toContain("chown");
		expect(info.testCmd).toBe("cargo test");
	});

	it("detects python + poetry", async () => {
		await fs.writeFile(path.join(tmpDir, "pyproject.toml"), "");
		await fs.writeFile(path.join(tmpDir, "poetry.lock"), "");

		const info = await detectCIStack(tmpDir);
		expect(info.stackType).toBe("python");
		expect(info.buildTool).toBe("poetry");
		expect(info.testCmd).toBe("pytest");
	});

	it("detects python + uv", async () => {
		await fs.writeFile(path.join(tmpDir, "pyproject.toml"), "");
		await fs.writeFile(path.join(tmpDir, "uv.lock"), "");

		const info = await detectCIStack(tmpDir);
		expect(info.buildTool).toBe("uv");
	});

	it("detects java-gradle and reads java version from kts", async () => {
		await fs.writeFile(
			path.join(tmpDir, "build.gradle.kts"),
			`
      java {
        toolchain {
          languageVersion = JavaLanguageVersion.of(21)
        }
      }
    `,
		);

		const info = await detectCIStack(tmpDir);
		expect(info.stackType).toBe("java-gradle");
		expect(info.javaVersion).toBe("21");
		expect(info.lintCmd).toContain("spotlessCheck");
		expect(info.compileCmd).toContain("classes");
	});

	it("detects java-maven", async () => {
		await fs.writeFile(path.join(tmpDir, "pom.xml"), "<project/>");

		const info = await detectCIStack(tmpDir);
		expect(info.stackType).toBe("java-maven");
		expect(info.lintCmd).toContain("spotless:check");
		expect(info.testCmd).toContain("mvnw test");
	});

	it("node compileCmd includes rm -rf dist/ prefix", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { build: "tsc" },
		});

		const info = await detectCIStack(tmpDir);
		expect(info.compileCmd).toContain("rm -rf dist/");
	});

	it("java-gradle takes priority over pom.xml when both present", async () => {
		await fs.writeFile(path.join(tmpDir, "build.gradle"), "");
		await fs.writeFile(path.join(tmpDir, "pom.xml"), "");

		const info = await detectCIStack(tmpDir);
		expect(info.stackType).toBe("java-gradle");
	});
});

// =============================================================================
// runCI — detect mode (no Docker, no external processes)
// =============================================================================

describe("runCI — detect mode", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-ci-run-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("calls onStep with detect done and exits without docker-check", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });

		const { runCI } = await import("./ci.js");
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, mode: "detect" }, (s) => steps.push(s));

		// onStep is called multiple times per id (running → done); grab the last state
		const detectSteps = steps.filter((s) => s.id === "detect");
		const detect = detectSteps.at(-1);
		expect(detect).toBeDefined();
		expect(detect?.status).toBe("done");
		expect(steps.find((s) => s.id === "docker-check")).toBeUndefined();
		expect(steps.find((s) => s.id === "lint")).toBeUndefined();
	});

	it("detect mode works for all stacks", async () => {
		const cases = [
			{ file: "go.mod", content: "module app", expected: "go" },
			{ file: "Cargo.toml", content: "[package]", expected: "rust" },
		];

		for (const { file, content, expected } of cases) {
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jf-stack-"));
			await fs.writeFile(path.join(dir, file), content);

			const { runCI } = await import("./ci.js");
			const steps: CIStep[] = [];
			await runCI({ projectDir: dir, mode: "detect" }, (s) => steps.push(s));

			const detectSteps = steps.filter((s) => s.id === "detect");
			const detect = detectSteps.at(-1);
			expect(detect?.status).toBe("done");
			// Final label is "Stack: go (go)" — check it contains the expected stack
			expect(detect?.label.toLowerCase()).toContain(expected);
			await fs.remove(dir);
		}
	});
});

// =============================================================================
// installCIHooks — real fs, no mocking
// =============================================================================

describe("installCIHooks", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-hooks-test-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("refuses when target is not a git repo", async () => {
		const result = await installCIHooks(tmpDir);
		expect(result.installed).toEqual([]);
		expect(result.errors[0]).toMatch(/not a git repository/i);
	});

	it("installs the three hooks when .git exists", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		const result = await installCIHooks(tmpDir);
		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-commit", "pre-push", "commit-msg"]),
		);
		expect(result.errors).toEqual([]);

		for (const hook of ["pre-commit", "pre-push", "commit-msg"]) {
			const hookPath = path.join(tmpDir, ".git", "hooks", hook);
			expect(await fs.pathExists(hookPath)).toBe(true);
			const stat = await fs.stat(hookPath);
			// 0o755 has owner-rwx + group/other-rx
			expect(stat.mode & 0o755).toBe(0o755);
		}
	});

	it("creates the hooks directory if it does not exist", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		// Do NOT pre-create .git/hooks/
		const result = await installCIHooks(tmpDir);
		expect(result.installed.length).toBe(3);
		expect(await fs.pathExists(path.join(tmpDir, ".git", "hooks"))).toBe(true);
	});

	it("pre-commit hook delegates to javi-forge with --quick", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await installCIHooks(tmpDir);
		const content = await fs.readFile(
			path.join(tmpDir, ".git", "hooks", "pre-commit"),
			"utf-8",
		);
		expect(content).toContain("javi-forge ci --quick");
		expect(content).toContain("--no-docker");
		expect(content).toContain("--no-security");
		expect(content).toContain("--no-ci-ghagga");
	});

	it("pre-push hook runs the native quick CI checks (no docker probe)", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await installCIHooks(tmpDir);
		const content = await fs.readFile(
			path.join(tmpDir, ".git", "hooks", "pre-push"),
			"utf-8",
		);
		expect(content).toContain("--no-docker");
		expect(content).toContain("javi-forge ci");
	});

	it("commit-msg hook lists AI attribution patterns", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await installCIHooks(tmpDir);
		const content = await fs.readFile(
			path.join(tmpDir, ".git", "hooks", "commit-msg"),
			"utf-8",
		);
		expect(content).toContain("co-authored-by");
		expect(content).toContain("claude");
		expect(content).toContain("gpt");
		expect(content).toContain("chatgpt");
		expect(content).toContain("anthropic");
	});

	it("refuses to overwrite a hook that is a symlink", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git", "hooks"));
		// Create a symlink at .git/hooks/pre-commit → /tmp/evil-target
		// In the real attack, the target could be ~/.ssh/authorized_keys.
		const evilTarget = path.join(tmpDir, "evil-target");
		await fs.writeFile(evilTarget, "ORIGINAL");
		await fs.symlink(
			evilTarget,
			path.join(tmpDir, ".git", "hooks", "pre-commit"),
		);

		const result = await installCIHooks(tmpDir);
		expect(result.errors.some((e) => e.includes("symlink"))).toBe(true);
		expect(result.installed).not.toContain("pre-commit");
		// pre-push and commit-msg (non-symlinked) still install.
		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-push", "commit-msg"]),
		);
		// Critical: the symlink's TARGET must be untouched.
		const targetAfter = await fs.readFile(evilTarget, "utf-8");
		expect(targetAfter).toBe("ORIGINAL");
	});

	it("records write errors and continues with remaining hooks", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git", "hooks"));
		// Create a DIRECTORY where the pre-commit file should be → writeFile fails
		await fs.ensureDir(path.join(tmpDir, ".git", "hooks", "pre-commit"));

		const result = await installCIHooks(tmpDir);
		expect(result.errors[0]).toContain("pre-commit");
		// pre-push and commit-msg should still install
		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-push", "commit-msg"]),
		);
	});
});

// =============================================================================
// installCIHooks — LIVE byte-equivalence against the shipped assets
//
// This is the ONLY window in which the equivalence "what `ci init` writes ===
// `assets/hooks/*`" is FALSIFIABLE (JDA6-002/JDB6-004): while `installCIHooks`
// still writes the inline `*_HOOK` template literals, this test compares two
// INDEPENDENT sources. Once task 3.20 switches the write source to the assets,
// the same assertion keeps passing BY CONSTRUCTION — and that continuity is
// exactly the proof that the switch changed no byte. It therefore has to land
// FIRST, before the constants are deleted, and must never be edited afterwards.
//
// The marker block (task 3.11) is spliced in AFTER the shebang at install time
// and is NOT part of the asset, so the comparison strips it when present. Before
// 3.11 nothing is stripped and this is a raw byte comparison of the literals.
// =============================================================================

const HOOK_NAMES = ["pre-commit", "pre-push", "commit-msg"] as const;

const MARKER_NAME_LINE = /^# javi-forge-hook: [a-z-]+ v\d+$/;
const MARKER_HASH_LINE = /^# javi-forge-hash: sha256:[0-9a-f]{64}$/;

/** Installed file minus the two marker lines (a no-op on an unmarked file). */
function stripMarkerBlock(content: string): string {
	const lines = content.split("\n");
	const marked =
		lines[0]?.startsWith("#!") === true &&
		MARKER_NAME_LINE.test(lines[1] ?? "") &&
		MARKER_HASH_LINE.test(lines[2] ?? "");
	return marked ? [lines[0], ...lines.slice(3)].join("\n") : content;
}

describe("installCIHooks byte-equivalence with assets/hooks", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-hookeq-"));
		await fs.ensureDir(path.join(tmpDir, ".git"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it.each(
		HOOK_NAMES,
	)("writes %s byte-for-byte identical to its shipped asset, mode 0755", async (hook) => {
		const asset = await fs.readFile(path.join(HOOK_ASSETS_DIR, hook));

		await installCIHooks(tmpDir);

		const hookPath = path.join(tmpDir, ".git", "hooks", hook);
		const written = await fs.readFile(hookPath, "utf8");
		const stat = await fs.stat(hookPath);

		expect(written.length).toBeGreaterThan(0);
		expect(stripMarkerBlock(written)).toBe(asset.toString("utf8"));
		// Exact-equality is umask-INDEPENDENT: `writeFile({mode})` is masked on
		// creation, but installCIHooks chmods unconditionally afterwards and
		// `chmod` ignores the umask. Verified red under `umask 077` before that
		// chmod existed, green after.
		expect(stat.mode & 0o777).toBe(0o755);
	});
});

// =============================================================================
// runCI — quick mode with --no-docker exercises runStep native path
// =============================================================================

describe("runCI native (no-docker)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-runci-test-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("detect mode emits a detect step with the stack info", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "true" },
		});
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, mode: "detect", noDocker: true }, (s) =>
			steps.push({ ...s }),
		);
		const detect = steps.filter((s) => s.id === "detect").at(-1);
		expect(detect?.status).toBe("done");
		expect(detect?.label.toLowerCase()).toContain("node");
	});

	it("quick mode runs lint+compile when scripts exist (native)", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { lint: "true", build: "true", test: "true" },
		});
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");
		const steps: CIStep[] = [];
		try {
			await runCI(
				{
					projectDir: tmpDir,
					mode: "quick",
					noDocker: true,
					noGhagga: true,
					noSecurity: true,
				},
				(s) => steps.push({ ...s }),
			);
		} catch {
			// pnpm may not be on PATH in some environments — that's OK,
			// we mostly care that the steps were attempted.
		}
		const labels = steps.map((s) => s.label.toLowerCase());
		expect(
			labels.some((l) => l.includes("lint") || l.includes("compile")),
		).toBe(true);
	});

	it("skips security step when noSecurity=true", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		const steps: CIStep[] = [];
		try {
			await runCI(
				{
					projectDir: tmpDir,
					mode: "full",
					noDocker: true,
					noSecurity: true,
					noGhagga: true,
				},
				(s) => steps.push({ ...s }),
			);
		} catch {
			/* ignore — the goal is to observe the step set */
		}
		const securitySteps = steps.filter((s) => s.id === "security");
		expect(securitySteps.length).toBe(0);
	});

	it("skips ghagga step when noGhagga=true", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		const steps: CIStep[] = [];
		try {
			await runCI(
				{
					projectDir: tmpDir,
					mode: "full",
					noDocker: true,
					noSecurity: true,
					noGhagga: true,
				},
				(s) => steps.push({ ...s }),
			);
		} catch {
			/* ignore */
		}
		expect(steps.filter((s) => s.id === "ghagga").length).toBe(0);
	});

	it("emits an error step when a native command exits non-zero", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "exit 7" },
		});
		const steps: CIStep[] = [];
		await expect(
			runCI(
				{
					projectDir: tmpDir,
					mode: "full",
					noDocker: true,
					noSecurity: true,
					noGhagga: true,
				},
				(s) => steps.push({ ...s }),
			),
		).rejects.toBeDefined();
		expect(steps.some((s) => s.status === "error")).toBe(true);
	});
});

// =============================================================================
// resolveCIRunners — single resolution point for auto/config/override
// =============================================================================

describe("resolveCIRunners", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-resolve-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	const writeConfig = async (yaml: string) => {
		const configPath = path.join(tmpDir, ".javi-forge", "ci.yaml");
		await fs.ensureDir(path.dirname(configPath));
		await fs.writeFile(configPath, yaml);
		return configPath;
	};

	it("auto-detects a single runner when no config exists", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { lint: "eslint .", test: "vitest" },
		});
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");

		const resolved = await resolveCIRunners(tmpDir);
		expect(resolved.source).toBe("auto");
		expect(resolved.runners).toHaveLength(1);
		const runner = resolved.runners[0];
		expect(runner?.stack).toBe("node");
		expect(runner?.buildTool).toBe("pnpm");
		expect(runner?.directory).toBe(".");
		expect(runner?.lintCmds).toEqual(["pnpm run lint"]);
		expect(runner?.testCmds).toEqual(["pnpm run test"]);
	});

	it("discovers .javi-forge/ci.yaml without an explicit --config", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await writeConfig(`
version: 1
runners:
  - name: backend
    stack: python
    directory: backend
    test: pytest
`);

		const resolved = await resolveCIRunners(tmpDir);
		expect(resolved.source).toBe("config");
		expect(resolved.runners).toHaveLength(1);
		expect(resolved.runners[0]?.name).toBe("backend");
		expect(resolved.runners[0]?.stack).toBe("python");
		expect(resolved.runners[0]?.directory).toBe("backend");
	});

	it("loads an explicit --config path", async () => {
		const configPath = path.join(tmpDir, "custom-ci.yaml");
		await fs.writeFile(
			configPath,
			"version: 1\nrunners:\n  - name: x\n    stack: go\n",
		);

		const resolved = await resolveCIRunners(tmpDir, { config: configPath });
		expect(resolved.source).toBe("config");
		expect(resolved.runners[0]?.stack).toBe("go");
	});

	it("preserves configured runner order", async () => {
		await writeConfig(`
version: 1
runners:
  - name: backend
    stack: python
  - name: frontend
    stack: node
`);

		const resolved = await resolveCIRunners(tmpDir);
		expect(resolved.runners.map((r) => r.name)).toEqual([
			"backend",
			"frontend",
		]);
	});

	it("fills missing runner commands from stack defaults", async () => {
		await writeConfig(`
version: 1
runners:
  - name: backend
    stack: python
    directory: backend
`);

		const resolved = await resolveCIRunners(tmpDir);
		const runner = resolved.runners[0];
		expect(runner?.lintCmds.join(" ")).toContain("ruff check");
		expect(runner?.testCmds).toEqual(["pytest"]);
	});

	it("keeps explicit commands instead of stack defaults", async () => {
		await writeConfig(`
version: 1
runners:
  - name: backend
    stack: python
    test: pytest -k smoke
`);

		const resolved = await resolveCIRunners(tmpDir);
		expect(resolved.runners[0]?.testCmds).toEqual(["pytest -k smoke"]);
	});

	it("carries image, build-context, setup and required tools", async () => {
		await writeConfig(`
version: 1
runners:
  - name: backend
    stack: python
    image: python:3.12-slim
    setup: pip install -r requirements.txt
    requires: [python, ruff]
`);

		const runner = (await resolveCIRunners(tmpDir)).runners[0];
		expect(runner?.image).toBe("python:3.12-slim");
		expect(runner?.setupCmds).toEqual(["pip install -r requirements.txt"]);
		expect(runner?.requiredTools).toEqual(["python", "ruff"]);
	});

	it("returns an immutable resolved object", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });

		const resolved = await resolveCIRunners(tmpDir);
		expect(Object.isFrozen(resolved.runners)).toBe(true);
		expect(Object.isFrozen(resolved.runners[0])).toBe(true);
		expect(Object.isFrozen(resolved.runners[0]?.lintCmds)).toBe(true);
	});

	it("--stack forces a single explicit runner in a foreign repo", async () => {
		// Root package.json would auto-detect as node; --stack python wins.
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });

		const resolved = await resolveCIRunners(tmpDir, { stack: "python" });
		expect(resolved.source).toBe("stack-override");
		expect(resolved.runners).toHaveLength(1);
		expect(resolved.runners[0]?.stack).toBe("python");
		expect(resolved.runners[0]?.testCmds).toEqual(["pytest"]);
	});

	it("--stack rejects unknown stacks (fail closed)", async () => {
		await expect(resolveCIRunners(tmpDir, { stack: "cobol" })).rejects.toThrow(
			/cobol|stack/i,
		);
	});

	it("--config and --stack together are rejected as ambiguous", async () => {
		const configPath = await writeConfig(
			"version: 1\nrunners:\n  - name: x\n    stack: node\n",
		);
		await expect(
			resolveCIRunners(tmpDir, { config: configPath, stack: "node" }),
		).rejects.toThrow(/ambiguous|--config|--stack/i);
	});

	it("fails closed when the discovered config is invalid", async () => {
		await writeConfig("version: 1\nrunners: []");
		await expect(resolveCIRunners(tmpDir)).rejects.toThrow(/runners/i);
	});
});

// =============================================================================
// runCI — configured multi-runner execution (native, no Docker)
// =============================================================================

describe("runCI — configured runners (native)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-mixed-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("runs every configured runner in order, each in its own directory", async () => {
		// Hybrid fixture: root package.json + nested python project.
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await fs.ensureDir(path.join(tmpDir, "backend"));
		await fs.writeFile(path.join(tmpDir, "backend", "pyproject.toml"), "");
		await fs.outputFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			`
version: 1
runners:
  - name: backend
    stack: python
    directory: backend
    lint: echo backend >> ../order.txt
  - name: frontend
    stack: node
    directory: .
    lint: echo frontend >> order.txt
`,
		);
		const steps: CIStep[] = [];
		await runCI(
			{
				projectDir: tmpDir,
				mode: "quick",
				noDocker: true,
				noGhagga: true,
				noSecurity: true,
			},
			(s) => steps.push({ ...s }),
		);

		const order = (await fs.readFile(path.join(tmpDir, "order.txt"), "utf-8"))
			.trim()
			.split("\n");
		expect(order).toEqual(["backend", "frontend"]);

		const lintSteps = steps.filter(
			(s) => s.id.startsWith("lint:") && s.status === "done",
		);
		expect(lintSteps.map((s) => s.id)).toEqual([
			"lint:backend",
			"lint:frontend",
		]);
	});

	it("fails the run when any configured runner fails", async () => {
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			`
version: 1
runners:
  - name: broken
    stack: node
    lint: exit 3
  - name: never
    stack: node
    lint: echo never-ran >> marker.txt
`,
		);

		const steps: CIStep[] = [];
		await expect(
			runCI(
				{
					projectDir: tmpDir,
					mode: "quick",
					noDocker: true,
					noGhagga: true,
					noSecurity: true,
				},
				(s) => steps.push({ ...s }),
			),
		).rejects.toBeDefined();

		expect(
			steps.some((s) => s.id === "lint:broken" && s.status === "error"),
		).toBe(true);
		// Runner after the failure must not execute (fail fast, no skips).
		expect(await fs.pathExists(path.join(tmpDir, "marker.txt"))).toBe(false);
	});

	it("detect mode reports configured runners without executing them", async () => {
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			`
version: 1
runners:
  - name: backend
    stack: python
    lint: echo should-not-run >> ran.txt
`,
		);

		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, mode: "detect" }, (s) =>
			steps.push({ ...s }),
		);

		const detect = steps.filter((s) => s.id === "detect").at(-1);
		expect(detect?.status).toBe("done");
		expect(detect?.label).toContain("backend");
		expect(await fs.pathExists(path.join(tmpDir, "ran.txt"))).toBe(false);
	});

	it("surfaces config validation errors as a failed detect step", async () => {
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			"version: 1\nrunners: []",
		);

		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, mode: "detect" }, (s) =>
				steps.push({ ...s }),
			),
		).rejects.toThrow(/runners/i);

		const detect = steps.filter((s) => s.id === "detect").at(-1);
		expect(detect?.status).toBe("error");
	});

	it("single-runner auto path keeps the legacy step ids", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { lint: "true", build: "true" },
		});
		const steps: CIStep[] = [];
		await runCI(
			{
				projectDir: tmpDir,
				mode: "quick",
				noDocker: true,
				noGhagga: true,
				noSecurity: true,
			},
			(s) => steps.push({ ...s }),
		);
		// Legacy ids, no per-runner suffix, when there is exactly one runner.
		expect(steps.some((s) => s.id === "lint" && s.status === "done")).toBe(
			true,
		);
		expect(steps.some((s) => s.id.startsWith("lint:"))).toBe(false);
	});
});

// =============================================================================
// runGateNative — host-native gate executor (returns the child exit code)
// =============================================================================

describe("runGateNative", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-gatenat-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	// The child inherits PATH so `bash` resolves; the caller (runGates) always
	// passes a PATH-bearing env, so this mirrors real usage.
	const envWithPath = () => ({ PATH: process.env.PATH ?? "" });

	it("resolves the child exit code (0) without throwing on success", async () => {
		expect((await runGateNative("exit 0", tmpDir, envWithPath())).code).toBe(0);
	});

	it("resolves a non-zero exit code instead of throwing", async () => {
		expect((await runGateNative("exit 3", tmpDir, envWithPath())).code).toBe(3);
	});

	it("delivers env via the process env map, never string-spliced into the command", async () => {
		// The value lives ONLY in the env map — a passing `test` builtin proves the
		// child received it through the environment, not via the `run` string.
		expect(
			(
				await runGateNative('[ "$GATE_TOKEN" = "s3-secret" ]', tmpDir, {
					...envWithPath(),
					GATE_TOKEN: "s3-secret",
				})
			).code,
		).toBe(0);
	});

	it("maps signal death to a non-zero code (never a false-green 0)", async () => {
		// The child terminates by SIGTERM → close reports code=null. A null code
		// MUST NOT be resolved as 0 (success); the shell convention 128+signum
		// yields 143 for SIGTERM. Against the old `code ?? 0` this returned 0.
		expect(
			(await runGateNative("kill -TERM $$", tmpDir, envWithPath())).code,
		).toBe(128 + os.constants.signals.SIGTERM);
	});

	it("maps a fatal SIGSEGV to a non-zero code", async () => {
		expect(
			(await runGateNative("kill -SEGV $$", tmpDir, envWithPath())).code,
		).toBe(128 + os.constants.signals.SIGSEGV);
	});

	it("kills a command that exceeds its timeout and resolves NON-ZERO (the timeout sentinel 124)", async () => {
		// A hung command (sleep 10) with timeout: 1 must be SIGTERM-killed. The
		// `timedOut` flag overrides the child's reported code with the timeout
		// sentinel 124 — it MUST NOT resolve 0 — a timed-out gate is a FAILURE.
		const { code } = await runGateNative("sleep 10", tmpDir, envWithPath(), 1);
		expect(code).not.toBe(0);
		expect(code).toBe(124);
	}, 10000);

	it("does NOT kill a command that finishes under its timeout (timer cleared, no hang)", async () => {
		// Finishes well under the 5s budget; the timer must be cleared so the test
		// process is not held open by a dangling handle.
		expect((await runGateNative("exit 0", tmpDir, envWithPath(), 5)).code).toBe(
			0,
		);
	});

	it("resolves NON-ZERO (124) when a timed-out gate traps SIGTERM and exits 0 gracefully", async () => {
		// R3-001 (CRITICAL false-green): a command that traps SIGTERM and exits 0
		// BEFORE the SIGKILL escalation reports close code=0, signal=null. Without a
		// timedOut override that resolves 0 → a timed-out BLOCKING gate PASSES the
		// build — the exact false-green GATE-2 exists to prevent. The timedOut flag
		// MUST override the child's reported 0 with the timeout sentinel 124.
		// `sleep 10 & wait` (not a foreground `sleep`) so the SIGTERM interrupts the
		// interruptible `wait` and the trap actually FIRES → the child exits 0 before
		// the SIGKILL escalation. A foreground `sleep` would defer the trap and get
		// SIGKILLed instead, which never exercises the false-green.
		const { code } = await runGateNative(
			"trap 'exit 0' TERM; sleep 10 & wait",
			tmpDir,
			envWithPath(),
			1,
		);
		expect(code).not.toBe(0);
		expect(code).toBe(124);
	}, 10000);

	it("force-kills (SIGKILL) a command that IGNORES SIGTERM and still resolves NON-ZERO", async () => {
		// R3-002 (escalation path): a command that IGNORES SIGTERM survives the
		// SIGTERM at ~1s; the 2s grace timer then escalates to SIGKILL, which the
		// process cannot trap. The child is force-killed (it does not leak) and the
		// executor resolves the timeout sentinel 124 (timedOut supersedes the
		// 137=128+SIGKILL signal code). Allow ~4s for the 1s timeout + 2s grace.
		const { code } = await runGateNative(
			"trap '' TERM; sleep 10",
			tmpDir,
			envWithPath(),
			1,
		);
		expect(code).not.toBe(0);
		expect(code).toBe(124);
	}, 6000);

	// R3-004 (OBSERVABILITY): the result must carry a REAL `timedOut` signal so a
	// wall-clock timeout is distinguishable from a child that itself exits 124.
	it("reports timedOut:true (with code 124) when the wall-clock timeout fires", async () => {
		const result = await runGateNative("sleep 10", tmpDir, envWithPath(), 1);
		expect(result.timedOut).toBe(true);
		expect(result.code).toBe(124);
	}, 10000);

	it("reports timedOut:false when the child genuinely exits 124 (no timeout)", async () => {
		// A child that returns 124 on its own (curl op-timeout, nested timeout(1), a
		// script returning 124) is NOT a wall-clock timeout — timedOut MUST be false
		// so the two 124s stay distinguishable.
		const result = await runGateNative("exit 124", tmpDir, envWithPath());
		expect(result.code).toBe(124);
		expect(result.timedOut).toBe(false);
	});

	it("reports timedOut:false for a normal non-zero exit under a generous timeout", async () => {
		const result = await runGateNative("exit 124", tmpDir, envWithPath(), 30);
		expect(result.code).toBe(124);
		expect(result.timedOut).toBe(false);
	});
});

// =============================================================================
// runCI — gates (native, version 2)
// =============================================================================

describe("runCI — gates (native, version 2)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-gates-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	const writeConfig = async (yaml: string) => {
		await fs.outputFile(path.join(tmpDir, ".javi-forge", "ci.yaml"), yaml);
	};

	const QUICK = {
		mode: "quick" as const,
		noDocker: true,
		noGhagga: true,
		noSecurity: true,
	};

	it("fails the build when a blocking gate exits non-zero", async () => {
		await writeConfig(`
version: 2
gates:
  - id: blocker
    run: exit 1
`);
		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s })),
		).rejects.toThrow(/blocking gate\(s\) failed: blocker/);

		expect(
			steps.some((s) => s.id === "gate:blocker" && s.status === "error"),
		).toBe(true);
	});

	it("fails the build when a blocking gate is killed by a signal (no false-green)", async () => {
		// A blocking gate whose process dies by signal (OOM kill, SIGSEGV, external
		// SIGTERM) reports close code=null. That MUST be a blocking failure, not a
		// success. Against the old `code ?? 0` the null mapped to 0 → false-green.
		await writeConfig(`
version: 2
gates:
  - id: signalled
    run: kill -TERM $$
`);
		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s })),
		).rejects.toThrow(/blocking gate\(s\) failed: signalled/);

		expect(
			steps.some((s) => s.id === "gate:signalled" && s.status === "error"),
		).toBe(true);
	});

	it("fails the build when a blocking gate exceeds its timeout (no false-green)", async () => {
		// A blocking gate that hangs must be killed on timeout expiry and fail the
		// build — the timeout-kill rides the signal-death path (null code → 143),
		// never resolving 0. Keep the sleep SHORT via timeout: 1.
		await writeConfig(`
version: 2
gates:
  - id: hang
    run: sleep 10
    timeout: 1
`);
		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s })),
		).rejects.toThrow(/blocking gate\(s\) failed: hang/);

		expect(
			steps.some((s) => s.id === "gate:hang" && s.status === "error"),
		).toBe(true);
	}, 10000);

	it("fails the build when a blocking gate traps SIGTERM and exits 0 on timeout (no false-green)", async () => {
		// R3-001 (CRITICAL): a blocking gate whose command traps SIGTERM and exits 0
		// gracefully on the timeout kill MUST still fail the build. Without the
		// timedOut override the child's reported 0 marks the gate `done` and the
		// build FALSE-GREENS. Keep the sleep SHORT via timeout: 1.
		await writeConfig(`
version: 2
gates:
  - id: graceful-hang
    run: "trap 'exit 0' TERM; sleep 10 & wait"
    timeout: 1
`);
		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s })),
		).rejects.toThrow(/blocking gate\(s\) failed: graceful-hang/);

		expect(
			steps.some((s) => s.id === "gate:graceful-hang" && s.status === "error"),
		).toBe(true);
	}, 10000);

	it("informative gate timeout → warning, exit 0, later gates still run", async () => {
		await writeConfig(`
version: 2
gates:
  - id: soft-hang
    run: sleep 10
    timeout: 1
    mode: informative
  - id: after
    run: echo ran >> marker.txt
`);
		const steps: CIStep[] = [];
		// No throw — an informative timed-out gate degrades to a warning.
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		expect(
			steps.some((s) => s.id === "gate:soft-hang" && s.status === "warning"),
		).toBe(true);
		expect(
			await fs.readFile(path.join(tmpDir, "marker.txt"), "utf-8"),
		).toContain("ran");
	}, 10000);

	it("a gate that finishes under its timeout reports done normally", async () => {
		await writeConfig(`
version: 2
gates:
  - id: quick-gate
    run: echo fast >> marker.txt
    timeout: 30
`);
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		expect(
			steps.some((s) => s.id === "gate:quick-gate" && s.status === "done"),
		).toBe(true);
		expect(
			await fs.readFile(path.join(tmpDir, "marker.txt"), "utf-8"),
		).toContain("fast");
	});

	it("defers the blocking throw until AFTER later gates report (ordering guarantee)", async () => {
		// design.md:19 — one blocking failure must NEVER abort the loop and hide a
		// later gate. The first gate blocks and fails; the second gate must still
		// report its own status AND the aggregate throw must still name the blocker.
		// Against a throw-on-first-blocking implementation, the second gate would
		// never report → this goes RED.
		await writeConfig(`
version: 2
gates:
  - id: first-blocker
    run: exit 1
  - id: second-runs
    run: echo second >> order.txt
`);
		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s })),
		).rejects.toThrow(/blocking gate\(s\) failed: first-blocker/);

		// (a) the SECOND gate still reported after the first blocking failure.
		expect(
			steps.some((s) => s.id === "gate:second-runs" && s.status === "done"),
		).toBe(true);
		expect(
			await fs.readFile(path.join(tmpDir, "order.txt"), "utf-8"),
		).toContain("second");
		// (b) the aggregate error names the blocker.
		expect(
			steps.some((s) => s.id === "gate:first-blocker" && s.status === "error"),
		).toBe(true);
	});

	it("informative gate exit non-zero → warning, exit 0, later gates still run", async () => {
		await writeConfig(`
version: 2
gates:
  - id: soft
    run: exit 1
    mode: informative
  - id: after
    run: echo ran >> marker.txt
`);
		const steps: CIStep[] = [];
		// No throw — informative failures never fail the build.
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		expect(
			steps.some((s) => s.id === "gate:soft" && s.status === "warning"),
		).toBe(true);
		// The gate AFTER the informative failure still executed.
		expect(
			await fs.readFile(path.join(tmpDir, "marker.txt"), "utf-8"),
		).toContain("ran");
		expect(
			steps.some((s) => s.id === "gate:after" && s.status === "done"),
		).toBe(true);
	});

	it("multi-command gate is fail-fast: first non-zero wins, later commands skipped", async () => {
		await writeConfig(`
version: 2
gates:
  - id: multi
    run:
      - echo a >> steps.txt
      - exit 2
      - echo c >> steps.txt
`);
		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s })),
		).rejects.toThrow(/blocking gate\(s\) failed: multi/);

		const trace = await fs.readFile(path.join(tmpDir, "steps.txt"), "utf-8");
		expect(trace).toContain("a");
		// The command after the first non-zero exit must NOT run.
		expect(trace).not.toContain("c");
		const errStep = steps.filter((s) => s.id === "gate:multi").at(-1);
		expect(errStep?.status).toBe("error");
		expect(errStep?.detail).toContain("exit 2");
	});

	it("gates-only v2 repo (zero runners) runs the gate phase without crashing", async () => {
		await writeConfig(`
version: 2
gates:
  - id: only
    run: echo gate-ran >> marker.txt
`);
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		expect(
			await fs.readFile(path.join(tmpDir, "marker.txt"), "utf-8"),
		).toContain("gate-ran");
		expect(steps.some((s) => s.id === "gate:only" && s.status === "done")).toBe(
			true,
		);
	});

	it("gates-only v2 repo in detect mode reports a named error and runs no gate", async () => {
		await writeConfig(`
version: 2
gates:
  - id: g
    run: echo should-not-run >> ran.txt
`);
		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, mode: "detect" }, (s) =>
				steps.push({ ...s }),
			),
		).rejects.toThrow(/no runners resolved/);
		expect(await fs.pathExists(path.join(tmpDir, "ran.txt"))).toBe(false);
	});

	it("runs gates under full mode (not just quick)", async () => {
		await writeConfig(`
version: 2
gates:
  - id: full-gate
    run: echo full-ran >> marker.txt
`);
		const steps: CIStep[] = [];
		await runCI(
			{
				projectDir: tmpDir,
				mode: "full",
				noDocker: true,
				noGhagga: true,
				noSecurity: true,
			},
			(s) => steps.push({ ...s }),
		);
		expect(
			await fs.readFile(path.join(tmpDir, "marker.txt"), "utf-8"),
		).toContain("full-ran");
		expect(
			steps.some((s) => s.id === "gate:full-gate" && s.status === "done"),
		).toBe(true);
	});

	it("skips the gate phase in detect mode when runners are present", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await writeConfig(`
version: 2
runners:
  - name: r
    stack: node
    lint: "true"
gates:
  - id: g
    run: echo should-not-run >> ran.txt
`);
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, mode: "detect" }, (s) =>
			steps.push({ ...s }),
		);
		// detect returns before the gate phase — the gate command never executes.
		expect(await fs.pathExists(path.join(tmpDir, "ran.txt"))).toBe(false);
		expect(steps.some((s) => s.id.startsWith("gate:"))).toBe(false);
	});

	it("injects CI=true into the gate environment", async () => {
		await writeConfig(`
version: 2
gates:
  - id: envcheck
    run: '[ "$CI" = "true" ]'
`);
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));
		expect(
			steps.some((s) => s.id === "gate:envcheck" && s.status === "done"),
		).toBe(true);
	});

	it("runs both the runner loop AND the gate phase, gates after runners", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await writeConfig(`
version: 2
runners:
  - name: r
    stack: node
    lint: echo lint-ran >> order.txt
gates:
  - id: g
    run: echo gate-ran >> order.txt
`);
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		const order = (await fs.readFile(path.join(tmpDir, "order.txt"), "utf-8"))
			.trim()
			.split("\n");
		expect(order).toEqual(["lint-ran", "gate-ran"]);
		expect(steps.some((s) => s.id === "gate:g" && s.status === "done")).toBe(
			true,
		);
	});
});

// =============================================================================
// runCI — scope:changed wiring + baseline + env injection (slice 4)
// =============================================================================

describe("runCI — scope:changed wiring (slice 4)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-scope-"));
		vi.mocked(resolveBaseRef).mockReset();
		vi.mocked(changedFiles).mockReset();
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	const QUICK = {
		mode: "quick" as const,
		noDocker: true,
		noGhagga: true,
		noSecurity: true,
	};

	const writeConfig = async (yaml: string) => {
		await fs.outputFile(path.join(tmpDir, ".javi-forge", "ci.yaml"), yaml);
	};

	it("runs a scope:changed gate on a non-empty diff with $JAVI_FORGE_CHANGED_FILES injected", async () => {
		vi.mocked(resolveBaseRef).mockResolvedValue("BASE");
		vi.mocked(changedFiles).mockResolvedValue(["src/a.ts", "src/b.ts"]);
		await writeConfig(`
version: 2
gates:
  - id: changed
    scope: changed
    run: printf '%s' "$JAVI_FORGE_CHANGED_FILES" > changed.txt
`);
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		// The changed set reached the child as a newline-joined, root-relative list.
		expect(await fs.readFile(path.join(tmpDir, "changed.txt"), "utf-8")).toBe(
			"src/a.ts\nsrc/b.ts",
		);
		expect(
			steps.some((s) => s.id === "gate:changed" && s.status === "done"),
		).toBe(true);
	});

	it("skips a scope:changed gate when the changed set is EMPTY", async () => {
		vi.mocked(resolveBaseRef).mockResolvedValue("BASE");
		vi.mocked(changedFiles).mockResolvedValue([]);
		await writeConfig(`
version: 2
gates:
  - id: changed
    scope: changed
    run: echo ran >> ran.txt
`);
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		// Nothing changed → the gate command NEVER runs.
		expect(await fs.pathExists(path.join(tmpDir, "ran.txt"))).toBe(false);
		const step = steps.filter((s) => s.id === "gate:changed").at(-1);
		expect(step?.status).toBe("skipped");
		expect(step?.detail).toContain("no changed files");
	});

	it("loud-degrades (skips, never widens) when NO base ref resolves", async () => {
		vi.mocked(resolveBaseRef).mockResolvedValue(null);
		await writeConfig(`
version: 2
gates:
  - id: changed
    scope: changed
    run: echo ran >> ran.txt
`);
		const steps: CIStep[] = [];
		// A null base must NOT crash the phase and must NOT run the gate as scope:all.
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		expect(vi.mocked(changedFiles)).not.toHaveBeenCalled();
		expect(await fs.pathExists(path.join(tmpDir, "ran.txt"))).toBe(false);
		const step = steps.filter((s) => s.id === "gate:changed").at(-1);
		expect(step?.status).toBe("skipped");
		expect(step?.detail).toMatch(/no base ref/i);
	});

	it("loud-degrades (catches, skips, never widens, never crashes) when changedFiles THROWS", async () => {
		vi.mocked(resolveBaseRef).mockResolvedValue("BASE");
		vi.mocked(changedFiles).mockRejectedValue(
			new Error("fatal: bad object BASE...HEAD"),
		);
		await writeConfig(`
version: 2
gates:
  - id: changed
    scope: changed
    run: echo ran >> ran.txt
`);
		const steps: CIStep[] = [];
		// The shallow-clone throw is caught: the phase does not crash, the gate is
		// skipped with a named warning, and it does NOT run as scope:all.
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		expect(await fs.pathExists(path.join(tmpDir, "ran.txt"))).toBe(false);
		const step = steps.filter((s) => s.id === "gate:changed").at(-1);
		expect(step?.status).toBe("skipped");
		expect(step?.detail).toMatch(
			/shallow clone|missing ref|changed-file diff/i,
		);
	});

	it("resolves the base ref only ONCE and reuses it across scope:changed gates", async () => {
		vi.mocked(resolveBaseRef).mockResolvedValue("BASE");
		vi.mocked(changedFiles).mockResolvedValue(["src/a.ts"]);
		await writeConfig(`
version: 2
gates:
  - id: c1
    scope: changed
    run: "true"
  - id: c2
    scope: changed
    run: "true"
`);
		await runCI({ projectDir: tmpDir, ...QUICK }, () => {});

		// Shared resolution — not recomputed per gate.
		expect(vi.mocked(resolveBaseRef)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(changedFiles)).toHaveBeenCalledTimes(1);
	});

	it("does NOT resolve a base ref when no gate is scope:changed", async () => {
		await writeConfig(`
version: 2
gates:
  - id: allgate
    run: "true"
`);
		await runCI({ projectDir: tmpDir, ...QUICK }, () => {});

		// scope:all gates never touch the diff engine.
		expect(vi.mocked(resolveBaseRef)).not.toHaveBeenCalled();
	});

	it("injects gate baseline as $JAVI_FORGE_BASELINE", async () => {
		await writeConfig(`
version: 2
gates:
  - id: base
    baseline: security-baseline.json
    run: '[ "$JAVI_FORGE_BASELINE" = "security-baseline.json" ]'
`);
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		expect(steps.some((s) => s.id === "gate:base" && s.status === "done")).toBe(
			true,
		);
	});

	it("injects gate env LAST (last-wins over engine-injected CI)", async () => {
		await writeConfig(`
version: 2
gates:
  - id: envgate
    env:
      CI: overridden
      FOO: bar
    run: '[ "$CI" = "overridden" ] && [ "$FOO" = "bar" ]'
`);
		const steps: CIStep[] = [];
		await runCI({ projectDir: tmpDir, ...QUICK }, (s) => steps.push({ ...s }));

		// gate.env spreads AFTER {CI:"true"} → the override wins (documented last-wins).
		expect(
			steps.some((s) => s.id === "gate:envgate" && s.status === "done"),
		).toBe(true);
	});
});

// =============================================================================
// collectGateOutcomes — headless JSON gate-run collector (slice 4)
// =============================================================================

describe("collectGateOutcomes — headless JSON (slice 4)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-json-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	const QUICK = {
		mode: "quick" as const,
		noDocker: true,
		noGhagga: true,
		noSecurity: true,
	};

	const writeConfig = async (yaml: string) => {
		await fs.outputFile(path.join(tmpDir, ".javi-forge", "ci.yaml"), yaml);
	};

	it("ok:false with the blocking entry errored and the informative entry warned", async () => {
		await writeConfig(`
version: 2
gates:
  - id: blocker
    run: exit 3
  - id: soft
    mode: informative
    run: exit 1
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		const blocker = result.gates.find((g) => g.id === "blocker");
		expect(blocker).toMatchObject({
			id: "blocker",
			mode: "blocking",
			scope: "all",
			status: "error",
			blocking: true,
			exitCode: 3,
		});
		const soft = result.gates.find((g) => g.id === "soft");
		expect(soft).toMatchObject({
			status: "warning",
			blocking: false,
		});
	});

	it("ok:true and exit 0 when only an informative gate fails", async () => {
		await writeConfig(`
version: 2
gates:
  - id: soft
    mode: informative
    run: exit 1
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.gates.find((g) => g.id === "soft")?.status).toBe("warning");
	});

	it("ok:true, exit 0, all gates done on a clean run", async () => {
		await writeConfig(`
version: 2
gates:
  - id: g1
    run: "true"
  - id: g2
    run: "true"
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		expect(result.gates.map((g) => g.status)).toEqual(["done", "done"]);
	});

	// JDA-A-001: a scope:changed gate that degrades (changedFiles throws under a
	// shallow clone) must surface the REASON in the JSON outcome — otherwise the
	// headless consumer sees a bare `status:"skipped"` and cannot tell a degrade
	// from an intentional empty-set skip. The degrade must be LOUD for JSON too.
	it("carries the degrade reason on a scope:changed skip when changedFiles THROWS", async () => {
		vi.mocked(resolveBaseRef).mockReset();
		vi.mocked(changedFiles).mockReset();
		vi.mocked(resolveBaseRef).mockResolvedValue("BASE");
		vi.mocked(changedFiles).mockRejectedValue(
			new Error("fatal: bad object BASE...HEAD"),
		);
		await writeConfig(`
version: 2
gates:
  - id: changed
    scope: changed
    run: echo ran >> ran.txt
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		const gate = result.gates.find((g) => g.id === "changed");
		expect(gate?.status).toBe("skipped");
		expect(gate?.reason).toMatch(
			/shallow clone|missing ref|changed-file diff/i,
		);
	});

	// JDA-A-001 (companion): the empty-changed-set skip also carries a reason so a
	// consumer can distinguish "nothing changed" from a degrade.
	it("carries a reason on a scope:changed skip when the changed set is EMPTY", async () => {
		vi.mocked(resolveBaseRef).mockReset();
		vi.mocked(changedFiles).mockReset();
		vi.mocked(resolveBaseRef).mockResolvedValue("BASE");
		vi.mocked(changedFiles).mockResolvedValue([]);
		await writeConfig(`
version: 2
gates:
  - id: changed
    scope: changed
    run: echo ran >> ran.txt
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		const gate = result.gates.find((g) => g.id === "changed");
		expect(gate?.status).toBe("skipped");
		expect(gate?.reason).toMatch(/no changed files/i);
	});

	// R3-004 (OBSERVABILITY): a wall-clock timeout and a child that itself exits
	// 124 both yield exitCode 124 (correctness is fine — both are non-zero, both
	// fail a blocking gate) but the JSON consumer must be able to tell them apart:
	// a timed-out gate carries a `reason` naming the timeout; a genuine 124 does
	// NOT. Otherwise "bump the timeout" vs "fix the command" is unknowable.
	it("blocking timeout carries a `timed out` reason alongside exitCode 124", async () => {
		await writeConfig(`
version: 2
gates:
  - id: hang
    run: sleep 10
    timeout: 1
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		const gate = result.gates.find((g) => g.id === "hang");
		expect(gate?.status).toBe("error");
		expect(gate?.exitCode).toBe(124);
		expect(gate?.reason).toMatch(/timed out/i);
	}, 10000);

	it("a child that genuinely exits 124 has NO timeout reason (the two 124s are distinguishable)", async () => {
		await writeConfig(`
version: 2
gates:
  - id: real124
    run: exit 124
    timeout: 30
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		const gate = result.gates.find((g) => g.id === "real124");
		expect(gate?.status).toBe("error");
		expect(gate?.exitCode).toBe(124);
		// Same status + exitCode as the timeout case, but NO timeout reason.
		expect(gate?.reason).toBeUndefined();
	});

	it("informative timeout carries the reason too (warning, exitCode 124, build stays green)", async () => {
		await writeConfig(`
version: 2
gates:
  - id: soft-hang
    run: sleep 10
    timeout: 1
    mode: informative
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		const gate = result.gates.find((g) => g.id === "soft-hang");
		expect(gate?.status).toBe("warning");
		expect(gate?.exitCode).toBe(124);
		expect(gate?.reason).toMatch(/timed out/i);
	}, 10000);
});

// =============================================================================
// Gate container routing (containerized-gates slice 2b)
// =============================================================================

describe("gate container routing (slice 2b)", () => {
	let tmpDir: string;

	// These assert the CONTAINER path is reached, so Docker must be AVAILABLE:
	// slice 3 fail-closed refuses an image gate when Docker is unavailable, so
	// `noDocker: false` + an available daemon is what routes an image gate to the
	// (mocked) container. Fail-closed refusal has its own block below.
	const QUICK = {
		mode: "quick" as const,
		noDocker: false,
		noGhagga: true,
		noSecurity: true,
	};

	const writeConfig = async (yaml: string) => {
		await fs.outputFile(path.join(tmpDir, ".javi-forge", "ci.yaml"), yaml);
	};

	const lastContainerCall = () =>
		vi.mocked(runInContainer).mock.calls.at(-1)?.[0];

	beforeEach(async () => {
		// mockReset restores the production-faithful module-factory impl (see the
		// top-of-file note): runInContainer → {exitCode:0, timedOut:false}. Docker
		// is available here so image gates reach the container path.
		vi.mocked(runInContainer).mockReset();
		vi.mocked(runInContainer).mockResolvedValue({
			exitCode: 0,
			stdout: "",
			stderr: "",
			timedOut: false,
		});
		vi.mocked(isDockerAvailable).mockReset();
		vi.mocked(isDockerAvailable).mockResolvedValue(true);
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-route-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	// LOAD-BEARING (JDB-001, task 3.1): a host secret sitting in process.env MUST
	// NOT reach the container env — the container path forwards an EXPLICIT
	// ALLOWLIST, never the ambient process.env, so no secret lands in the -e argv
	// (nor in `ps aux`). This is the CRITICAL env-leak fix the design locked.
	it("does NOT forward a host secret from process.env into the container env", async () => {
		process.env.AWS_SECRET_ACCESS_KEY = "leak-me";
		try {
			await writeConfig(`
version: 2
gates:
  - id: img
    image: alpine:3.21
    run: "true"
`);
			await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

			const call = lastContainerCall();
			expect(call).toBeDefined();
			expect(call?.env).toBeDefined();
			// The secret is NOT a key and NOT a value in the container env map.
			expect(call?.env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
			expect(Object.values(call?.env ?? {})).not.toContain("leak-me");
			// The allowlist DID carry CI=true.
			expect(call?.env?.CI).toBe("true");
		} finally {
			delete process.env.AWS_SECRET_ACCESS_KEY;
		}
	});

	it("forwards CI, gate.env and the image/command into the container (allowlist)", async () => {
		await writeConfig(`
version: 2
gates:
  - id: img
    image: alpine:3.21
    env:
      FOO: bar
    run: "true"
`);
		await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		const call = lastContainerCall();
		expect(call?.image).toBe("alpine:3.21");
		expect(call?.command).toContain("cd /home/runner/work");
		expect(call?.env?.CI).toBe("true");
		expect(call?.env?.FOO).toBe("bar");
	});

	it("forwards JAVI_FORGE_CHANGED_FILES into the container allowlist for scope:changed", async () => {
		vi.mocked(resolveBaseRef).mockReset();
		vi.mocked(changedFiles).mockReset();
		vi.mocked(resolveBaseRef).mockResolvedValue("BASE");
		vi.mocked(changedFiles).mockResolvedValue(["src/a.ts"]);
		await writeConfig(`
version: 2
gates:
  - id: img
    image: alpine:3.21
    scope: changed
    run: "true"
`);
		await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		const call = lastContainerCall();
		expect(call?.env?.JAVI_FORGE_CHANGED_FILES).toBe("src/a.ts");
		// Still no ambient host env — allowlist only.
		expect(call?.env).not.toHaveProperty("PATH");
	});

	it("a gate WITHOUT image runs native and never touches the container", async () => {
		await writeConfig(`
version: 2
gates:
  - id: native
    run: "true"
`);
		await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });
		expect(runInContainer).not.toHaveBeenCalled();
	});

	// LOAD-BEARING (task 4.1 seam, no false-green): a timed-out BLOCKING container
	// gate MUST fail the build. Even if the container reports exitCode 0 (a child
	// that trapped SIGTERM and exited cleanly), timedOut=true normalizes to 124 →
	// blocking error → build fails. This is the false-green class the arc guards.
	it("a timed-out containerized BLOCKING gate fails the build (no false-green)", async () => {
		vi.mocked(runInContainer).mockResolvedValue({
			exitCode: 0,
			stdout: "",
			stderr: "",
			timedOut: true,
		});
		await writeConfig(`
version: 2
gates:
  - id: hang
    image: alpine:3.21
    timeout: 1
    run: "sleep 999"
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		const gate = result.gates.find((g) => g.id === "hang");
		expect(gate?.status).toBe("error");
		expect(gate?.exitCode).toBe(124);
		expect(gate?.reason).toMatch(/timed out/i);
	});

	// A container command that GENUINELY exits 124 (no timer fired) is NOT a
	// timeout: timedOut=false → exitCode stays 124 → NO timeout reason.
	it("a genuine container exit 124 is not a timeout (no reason)", async () => {
		vi.mocked(runInContainer).mockResolvedValue({
			exitCode: 124,
			stdout: "",
			stderr: "",
			timedOut: false,
		});
		await writeConfig(`
version: 2
gates:
  - id: real124
    image: alpine:3.21
    timeout: 30
    run: "exit 124"
`);
		const result = await collectGateOutcomes({ projectDir: tmpDir, ...QUICK });

		const gate = result.gates.find((g) => g.id === "real124");
		expect(gate?.status).toBe("error");
		expect(gate?.exitCode).toBe(124);
		expect(gate?.reason).toBeUndefined();
	});
});

// =============================================================================
// Gate fail-closed matrix (containerized-gates slice 3)
// =============================================================================

describe("gate fail-closed matrix (slice 3)", () => {
	let tmpDir: string;

	const writeConfig = async (yaml: string) => {
		await fs.outputFile(path.join(tmpDir, ".javi-forge", "ci.yaml"), yaml);
	};

	beforeEach(async () => {
		vi.mocked(runInContainer).mockReset();
		vi.mocked(runInContainer).mockResolvedValue({
			exitCode: 0,
			stdout: "",
			stderr: "",
			timedOut: false,
		});
		vi.mocked(isDockerAvailable).mockReset();
		vi.mocked(isDockerAvailable).mockResolvedValue(true);
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-failclosed-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	// gates-only call site (zero runners), --no-docker: an image gate is REFUSED,
	// never run native/unpinned; a blocking refusal FAILS the build.
	it("refuses a blocking image gate under --no-docker and fails the build (gates-only path)", async () => {
		await writeConfig(`
version: 2
gates:
  - id: img
    image: alpine:3.21
    run: "true"
`);
		const result = await collectGateOutcomes({
			projectDir: tmpDir,
			mode: "quick",
			noDocker: true,
			noGhagga: true,
			noSecurity: true,
		});

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		const gate = result.gates.find((g) => g.id === "img");
		expect(gate?.status).toBe("error");
		expect(gate?.reason).toMatch(/refus/i);
		// NEVER falls through to native/unpinned execution.
		expect(runInContainer).not.toHaveBeenCalled();
	});

	// gates-only call site, Docker daemon down (isDockerAvailable → false): same
	// refusal, never native/unpinned, blocking fails the build.
	it("refuses a blocking image gate when the Docker daemon is down and fails the build", async () => {
		vi.mocked(isDockerAvailable).mockResolvedValue(false);
		await writeConfig(`
version: 2
gates:
  - id: img
    image: alpine:3.21
    run: "true"
`);
		const result = await collectGateOutcomes({
			projectDir: tmpDir,
			mode: "quick",
			noDocker: false,
			noGhagga: true,
			noSecurity: true,
		});

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		const gate = result.gates.find((g) => g.id === "img");
		expect(gate?.status).toBe("error");
		expect(gate?.reason).toMatch(/docker not available/i);
		expect(runInContainer).not.toHaveBeenCalled();
	});

	// Informative image gate + no Docker → degrade to `warning` (never false-green,
	// never native): build stays green but the gate is loudly not-run.
	it("degrades an informative image gate to warning under --no-docker (no false-green)", async () => {
		await writeConfig(`
version: 2
gates:
  - id: img
    image: alpine:3.21
    mode: informative
    run: "true"
`);
		const result = await collectGateOutcomes({
			projectDir: tmpDir,
			mode: "quick",
			noDocker: true,
			noGhagga: true,
			noSecurity: true,
		});

		expect(result.ok).toBe(true);
		expect(result.exitCode).toBe(0);
		const gate = result.gates.find((g) => g.id === "img");
		expect(gate?.status).toBe("warning");
		expect(gate?.reason).toMatch(/refus/i);
		expect(runInContainer).not.toHaveBeenCalled();
	});

	// Regression: a gate WITHOUT image runs host-native ALWAYS, even under
	// --no-docker, and never touches Docker.
	it("runs a non-image gate host-native under --no-docker (unchanged)", async () => {
		await writeConfig(`
version: 2
gates:
  - id: native
    run: echo ran >> marker.txt
`);
		const result = await collectGateOutcomes({
			projectDir: tmpDir,
			mode: "quick",
			noDocker: true,
			noGhagga: true,
			noSecurity: true,
		});

		expect(result.ok).toBe(true);
		const gate = result.gates.find((g) => g.id === "native");
		expect(gate?.status).toBe("done");
		expect(
			await fs.readFile(path.join(tmpDir, "marker.txt"), "utf-8"),
		).toContain("ran");
		expect(runInContainer).not.toHaveBeenCalled();
		// A native-only gate set pays NO docker cost.
		expect(isDockerAvailable).not.toHaveBeenCalled();
	});

	// full/quick call site (runners present): the SAME fail-closed seam applies at
	// the second runGates call site, proving the context is threaded there too.
	it("refuses an image gate on the full/quick path (with runners present)", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await writeConfig(`
version: 2
runners:
  - name: r
    stack: node
    lint: "true"
gates:
  - id: img
    image: alpine:3.21
    run: "true"
`);
		const result = await collectGateOutcomes({
			projectDir: tmpDir,
			mode: "quick",
			noDocker: true,
			noGhagga: true,
			noSecurity: true,
		});

		expect(result.ok).toBe(false);
		expect(result.exitCode).toBe(1);
		const gate = result.gates.find((g) => g.id === "img");
		expect(gate?.status).toBe("error");
		expect(gate?.reason).toMatch(/refus/i);
		expect(runInContainer).not.toHaveBeenCalled();
	});

	// Lazy memoization: a native-only gate set NEVER computes docker availability.
	it("never calls isDockerAvailable when no gate declares an image", async () => {
		await writeConfig(`
version: 2
gates:
  - id: a
    run: "true"
  - id: b
    run: "true"
`);
		await collectGateOutcomes({
			projectDir: tmpDir,
			mode: "quick",
			noDocker: false,
			noGhagga: true,
			noSecurity: true,
		});

		expect(isDockerAvailable).not.toHaveBeenCalled();
	});

	// Lazy memoization: two image gates + Docker available → availability is
	// computed AT MOST ONCE, and both gates run containerized.
	it("computes docker availability at most once across multiple image gates", async () => {
		await writeConfig(`
version: 2
gates:
  - id: img1
    image: alpine:3.21
    run: "true"
  - id: img2
    image: alpine:3.21
    run: "true"
`);
		const result = await collectGateOutcomes({
			projectDir: tmpDir,
			mode: "quick",
			noDocker: false,
			noGhagga: true,
			noSecurity: true,
		});

		expect(result.ok).toBe(true);
		expect(vi.mocked(isDockerAvailable).mock.calls.length).toBe(1);
		expect(vi.mocked(runInContainer).mock.calls.length).toBe(2);
	});
});

// =============================================================================
// runCI — required-tool fail-closed checks (task 5)
// =============================================================================

describe("runCI — required tools (native)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-tools-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	const writeConfig = (yaml: string) =>
		fs.outputFile(path.join(tmpDir, ".javi-forge", "ci.yaml"), yaml);

	it("fails closed naming runner, tool and environment when a tool is missing", async () => {
		await writeConfig(`
version: 1
runners:
  - name: backend
    stack: python
    directory: .
    lint: echo should-not-run >> lint-ran.txt
    requires: [definitely-missing-tool-xyz]
`);

		const steps: CIStep[] = [];
		await expect(
			runCI(
				{
					projectDir: tmpDir,
					mode: "quick",
					noDocker: true,
					noGhagga: true,
					noSecurity: true,
				},
				(s) => steps.push({ ...s }),
			),
		).rejects.toThrow(/backend[\s\S]*definitely-missing-tool-xyz/);

		const toolsStep = steps.filter((s) => s.id === "tools:backend").at(-1);
		expect(toolsStep?.status).toBe("error");
		expect(toolsStep?.detail).toContain("definitely-missing-tool-xyz");
		// The missing tool must never become a skipped/successful check:
		// no phase of the failing runner may execute.
		expect(await fs.pathExists(path.join(tmpDir, "lint-ran.txt"))).toBe(false);
	});

	it("passes the tool check when all required tools exist", async () => {
		await writeConfig(`
version: 1
runners:
  - name: backend
    stack: python
    lint: echo ok >> lint-ran.txt
    requires: [bash, sh]
`);

		const steps: CIStep[] = [];
		await runCI(
			{
				projectDir: tmpDir,
				mode: "quick",
				noDocker: true,
				noGhagga: true,
				noSecurity: true,
			},
			(s) => steps.push({ ...s }),
		);

		const toolsStep = steps.filter((s) => s.id === "tools:backend").at(-1);
		expect(toolsStep?.status).toBe("done");
		expect(await fs.pathExists(path.join(tmpDir, "lint-ran.txt"))).toBe(true);
	});

	it("checks tools before setup, so setup never runs with a missing tool", async () => {
		await writeConfig(`
version: 1
runners:
  - name: backend
    stack: python
    setup: echo setup-ran >> setup-ran.txt
    requires: [definitely-missing-tool-xyz]
`);

		await expect(
			runCI(
				{
					projectDir: tmpDir,
					mode: "quick",
					noDocker: true,
					noGhagga: true,
					noSecurity: true,
				},
				() => {},
			),
		).rejects.toThrow(/definitely-missing-tool-xyz/);
		expect(await fs.pathExists(path.join(tmpDir, "setup-ran.txt"))).toBe(false);
	});

	it("runs setup commands in the runner directory before lint", async () => {
		await fs.ensureDir(path.join(tmpDir, "backend"));
		await writeConfig(`
version: 1
runners:
  - name: backend
    stack: python
    directory: backend
    setup: echo setup > ../phase-order.txt
    lint: echo lint >> ../phase-order.txt
`);

		await runCI(
			{
				projectDir: tmpDir,
				mode: "quick",
				noDocker: true,
				noGhagga: true,
				noSecurity: true,
			},
			() => {},
		);

		const order = (
			await fs.readFile(path.join(tmpDir, "phase-order.txt"), "utf-8")
		)
			.trim()
			.split("\n");
		expect(order).toEqual(["setup", "lint"]);
		// setup ran inside backend/ — relative path resolved there
		expect(
			await fs.pathExists(path.join(tmpDir, "backend", "phase-order.txt")),
		).toBe(false);
	});

	it("ignores build-context in native mode (no image needed)", async () => {
		await writeConfig(`
version: 1
runners:
  - name: custom
    stack: node
    build-context: ./ci/docker
    lint: echo ok >> lint-ran.txt
`);

		await runCI(
			{
				projectDir: tmpDir,
				mode: "quick",
				noDocker: true,
				noGhagga: true,
				noSecurity: true,
			},
			() => {},
		);
		expect(await fs.pathExists(path.join(tmpDir, "lint-ran.txt"))).toBe(true);
	});
});

// =============================================================================
// Characterization safety net — pins TODAY's observable behavior of the auto
// path in Docker mode so the executor collapse can be verified against it.
// These assertions must hold IDENTICALLY before and after the collapse.
// =============================================================================

describe("characterization: auto + docker", () => {
	let tmpDir: string;

	/** Full mode with Docker on; security + ghagga off to keep the stream deterministic. */
	const AUTO_DOCKER = {
		mode: "full" as const,
		noDocker: false,
		noGhagga: true,
		noSecurity: true,
	};

	/**
	 * Emitted ids in first-emission order (each id is reported running → done).
	 * NOTE: de-duplicating is blind to a step emitted TWICE — the raw-stream
	 * assertions below cover that, do not replace them with this helper.
	 */
	const uniqueIds = (steps: CIStep[]): string[] => [
		...new Set(steps.map((s) => s.id)),
	];

	/** Raw (non-deduplicated) id stream — sensitive to duplicate emissions. */
	const rawIds = (steps: CIStep[]): string[] => steps.map((s) => s.id);

	const countId = (steps: CIStep[], id: string): number =>
		rawIds(steps).filter((emitted) => emitted === id).length;

	const runAuto = async (
		projectDir: string,
		options: Record<string, unknown> = {},
	): Promise<CIStep[]> => {
		const steps: CIStep[] = [];
		await runCI({ projectDir, ...AUTO_DOCKER, ...options }, (s) =>
			steps.push({ ...s }),
		);
		return steps;
	};

	const containerCalls = () =>
		vi.mocked(runInContainer).mock.calls.map(([options]) => options);

	beforeEach(async () => {
		// mockReset, not mockClear: mockClear wipes call history but keeps a
		// per-test `mockImplementation`/`mockResolvedValueOnce`, so a queued value
		// leaks into whichever test runs next (JDA5-005 — observed the moment a
		// failure-path row installed a throwing implementation). Vitest restores
		// the implementation passed to `vi.fn(impl)` in the module factory, so the
		// production-faithful defaults come back on every test.
		vi.mocked(isDockerAvailable).mockReset();
		vi.mocked(ensureImage).mockReset();
		vi.mocked(runInContainer).mockReset();
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-char-"));
		// Node repo with no .javi-forge/ci.yaml → resolved.source === "auto".
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { lint: "eslint .", build: "tsc", test: "vitest run" },
		});
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("emits the global step order on auto+Docker", async () => {
		const steps = await runAuto(tmpDir);

		expect(uniqueIds(steps)).toEqual([
			"detect",
			"docker-check",
			"docker-image",
			"context-refresh",
			"lint",
			"compile",
			"test",
		]);
	});

	it("builds the image BEFORE refreshing .context/", async () => {
		const ids = uniqueIds(await runAuto(tmpDir));

		expect(ids).toContain("docker-image");
		expect(ids).toContain("context-refresh");
		expect(ids.indexOf("docker-image")).toBeLessThan(
			ids.indexOf("context-refresh"),
		);
	});

	it("emits the image step EXACTLY ONCE (no duplicate docker-image)", async () => {
		const steps = await runAuto(tmpDir);

		// Every step reports twice through the same id: running → done/skipped.
		// So today's auto+Docker stream carries exactly 2 `docker-image` events,
		// produced by a SINGLE image build. A second emission (e.g. the auto path
		// falling through into the per-runner image block) would raise this to 4
		// and is invisible to the Set-based order assertions above.
		expect(countId(steps, "docker-image")).toBe(2);
		expect(countId(steps, "docker-check")).toBe(2);
		expect(ensureImage).toHaveBeenCalledTimes(1);

		// The whole raw stream, pinned: 7 ids × 2 emissions each.
		expect(rawIds(steps)).toHaveLength(14);
	});

	it("emits ZERO image steps and never builds an image with --no-docker", async () => {
		const steps: CIStep[] = [];
		// Native execution shells out to the detected commands, whose outcome is
		// environment-dependent (and irrelevant here): the Docker-gate assertions
		// below hold on the emitted stream whether the run passes or fails.
		await runCI({ projectDir: tmpDir, ...AUTO_DOCKER, noDocker: true }, (s) =>
			steps.push({ ...s }),
		).catch(() => undefined);

		expect(countId(steps, "docker-image")).toBe(0);
		expect(countId(steps, "docker-check")).toBe(0);
		expect(ensureImage).not.toHaveBeenCalled();
		expect(runInContainer).not.toHaveBeenCalled();
	});

	it("pins the label + status of every emitted step on auto+Docker", async () => {
		const steps = await runAuto(tmpDir);

		// Today's user-visible stream, measured — not designed. The executor
		// collapse must reproduce these labels and statuses verbatim.
		expect(steps.map((s) => [s.id, s.label, s.status] as const)).toEqual([
			["detect", "Detecting stack", "running"],
			["detect", "Stack: node (pnpm)", "done"],
			["docker-check", "Checking Docker", "running"],
			["docker-check", "Docker available", "done"],
			["docker-image", "Building image for node", "running"],
			["docker-image", "Docker image ready", "done"],
			["context-refresh", "Refresh .context/ directory", "running"],
			// No .context/ in the fixture → the refresh is skipped, not failed.
			["context-refresh", "Refresh .context/ directory", "skipped"],
			["lint", "Lint: pnpm run lint", "running"],
			["lint", "Lint passed", "done"],
			["compile", "Compile: rm -rf dist/ && pnpm run build", "running"],
			["compile", "Compile passed", "done"],
			["test", "Test: pnpm run test", "running"],
			["test", "Tests passed", "done"],
		]);
	});

	it("threads the resolved image into every container run", async () => {
		const resolved = await resolveCIRunners(tmpDir);
		const runner = resolved.runners[0];
		expect(runner?.stack).toBe("node");
		const expectedImage = getImageName(runner?.stack ?? "node");
		expect(expectedImage).toBe("javi-forge-ci-node");

		await runAuto(tmpDir);

		const calls = containerCalls();
		// lint + compile + test — proves the loop below is not a ghost loop.
		expect(calls).toHaveLength(3);
		for (const call of calls) {
			expect(call.image).toBe(expectedImage);
		}
	});

	it("threads the resolved image for a non-node stack too", async () => {
		const goDir = await fs.mkdtemp(
			path.join(os.tmpdir(), "javi-forge-char-go-"),
		);
		try {
			await fs.writeFile(
				path.join(goDir, "go.mod"),
				"module example.com/app\n",
			);

			const resolved = await resolveCIRunners(goDir);
			expect(resolved.runners[0]?.stack).toBe("go");

			await runAuto(goDir);

			const calls = containerCalls();
			expect(calls).toHaveLength(3);
			for (const call of calls) {
				expect(call.image).toBe("javi-forge-ci-go");
			}
		} finally {
			await fs.remove(goDir);
		}
	});

	it("passes no explicit user for any phase — the container defaults to the host uid (ENV-1)", async () => {
		await runAuto(tmpDir);

		const calls = containerCalls();
		expect(calls).toHaveLength(3);
		const withCommand = (needle: string) =>
			calls.filter((call) => call.command.includes(needle));

		const lint = withCommand("pnpm run lint");
		const compile = withCommand("pnpm run build");
		const test = withCommand("pnpm run test");
		expect(lint).toHaveLength(1);
		expect(compile).toHaveLength(1);
		expect(test).toHaveLength(1);

		// No phase forces a user anymore: compile no longer runs as root, so
		// runInContainer applies the host uid:gid uniformly and artifacts land
		// host-owned. This is the fix for the uid 1001 bind-mount war.
		expect(compile[0]?.user).toBeUndefined();
		expect(lint[0]?.user).toBeUndefined();
		expect(test[0]?.user).toBeUndefined();
	});

	it("emits BARE --stack node step ids (B1: implicit name → bare)", async () => {
		const steps = await runAuto(tmpDir, { stack: "node" });

		// B1 (sanctioned spec-reversal of the ci-engine-unification characterization
		// freeze): `--stack` sets `resolved.source === "stack-override"`, an IMPLICIT
		// name (the user never named the runner), so ids are BARE — matching the
		// zero-config auto shape, not the suffixed CONFIG shape. The per-runner image
		// step still lands AFTER context-refresh (stack-override resolves its own
		// image in the runner loop, unlike auto's prologue build).
		expect(uniqueIds(steps)).toEqual([
			"detect",
			"docker-check",
			"context-refresh",
			"docker-image",
			"lint",
			"compile",
			"test",
		]);
	});

	it("emits no setup, per-runner security or tool-check steps for auto", async () => {
		const resolved = await resolveCIRunners(tmpDir);
		expect(resolved.source).toBe("auto");
		// The phases exist in the configured executor but are no-ops for auto
		// because the resolved runner carries no commands for them.
		expect(resolved.runners[0]?.setupCmds).toEqual([]);
		expect(resolved.runners[0]?.securityCmds).toEqual([]);
		expect(resolved.runners[0]?.requiredTools).toEqual([]);

		const ids = uniqueIds(await runAuto(tmpDir));

		// The stream is real (phases did run) — so the absences below are meaningful.
		expect(ids).toEqual(expect.arrayContaining(["lint", "compile", "test"]));
		expect(ids.filter((id) => id.startsWith("setup"))).toEqual([]);
		expect(ids.filter((id) => id.startsWith("security:"))).toEqual([]);
		expect(ids.filter((id) => id.startsWith("tools"))).toEqual([]);
	});

	it("emits no per-runner security step in FULL mode with security ENABLED", async () => {
		// The assertion above runs under `noSecurity: true`, where the configured
		// executor skips the security phase unconditionally (ci.ts phases[].skip),
		// so it cannot prove the auto path lacks per-runner security steps. This
		// variant leaves security ON; the semgrep probe is stubbed unavailable at
		// the module boundary, so the top-level step is deterministically skipped.
		const steps = await runAuto(tmpDir, { noSecurity: false });
		const ids = rawIds(steps);

		// The stream is real — the absence below is meaningful.
		expect(ids).toEqual(expect.arrayContaining(["lint", "compile", "test"]));
		expect(ids.filter((id) => id.startsWith("security:"))).toEqual([]);

		// The auto path emits only the single global `security` step, and today
		// that step is a skip when semgrep is not installed.
		const security = steps.filter((s) => s.id === "security");
		expect(security).toHaveLength(1);
		expect(security[0]?.status).toBe("skipped");
	});
});

// =============================================================================
// Unified executor — naming keyed on resolution source (slice 2)
// =============================================================================

describe("unified executor: naming keyed on resolution source", () => {
	let tmpDir: string;

	/** Full mode with Docker on; security + ghagga off unless a test says otherwise. */
	const DOCKER_FULL = {
		mode: "full" as const,
		noDocker: false,
		noGhagga: true,
		noSecurity: true,
	};

	const run = async (
		projectDir: string,
		options: Record<string, unknown> = {},
	): Promise<CIStep[]> => {
		const steps: CIStep[] = [];
		await runCI({ projectDir, ...DOCKER_FULL, ...options }, (s) =>
			steps.push({ ...s }),
		);
		return steps;
	};

	/** Node repo with no ci.yaml → `resolved.source === "auto"` → BARE naming. */
	const makeAutoRepo = async (dir: string): Promise<void> => {
		await fs.writeJson(path.join(dir, "package.json"), {
			scripts: { lint: "eslint .", build: "tsc", test: "vitest run" },
		});
		await fs.writeFile(path.join(dir, "pnpm-lock.yaml"), "");
	};

	/**
	 * EXACTLY ONE configured runner → `resolved.source === "config"` → SUFFIXED
	 * naming. This is the R3 guard: a single-runner CONFIG must never be renamed
	 * to bare ids just because there happens to be one runner.
	 */
	const makeSingleRunnerConfig = async (
		dir: string,
		extra = "",
	): Promise<void> => {
		await fs.writeJson(path.join(dir, "package.json"), { scripts: {} });
		await fs.outputFile(
			path.join(dir, ".javi-forge", "ci.yaml"),
			`version: 1
runners:
  - name: api
    stack: node
    lint: echo lint
    build: echo build
    test: echo test
${extra}`,
		);
	};

	interface NamingRow {
		readonly mode: "bare" | "suffixed";
		readonly phase: string;
		readonly stepId: string;
		readonly running: string;
		readonly done: string;
	}

	const NAMING_ROWS: readonly NamingRow[] = [
		{
			mode: "bare",
			phase: "lint",
			stepId: "lint",
			running: "Lint: pnpm run lint",
			done: "Lint passed",
		},
		{
			mode: "bare",
			phase: "compile",
			stepId: "compile",
			running: "Compile: rm -rf dist/ && pnpm run build",
			done: "Compile passed",
		},
		{
			// `doneLabel` lives here and NOWHERE else: bare test steps say "Tests
			// passed" while the phase label is "Test".
			mode: "bare",
			phase: "test",
			stepId: "test",
			running: "Test: pnpm run test",
			done: "Tests passed",
		},
		{
			mode: "suffixed",
			phase: "lint",
			stepId: "lint:api",
			running: "Lint [api]: echo lint",
			done: "Lint [api] passed",
		},
		{
			mode: "suffixed",
			phase: "compile",
			stepId: "compile:api",
			running: "Compile [api]: echo build",
			done: "Compile [api] passed",
		},
		{
			// The row that catches `doneLabel` leaking into suffixed mode: this MUST
			// stay "Test [api] passed", never "Tests [api] passed".
			mode: "suffixed",
			phase: "test",
			stepId: "test:api",
			running: "Test [api]: echo test",
			done: "Test [api] passed",
		},
	];

	beforeEach(async () => {
		// mockReset, not mockClear: mockClear wipes call history but keeps a
		// per-test `mockImplementation`/`mockResolvedValueOnce`, so a queued value
		// leaks into whichever test runs next (JDA5-005 — observed the moment a
		// failure-path row installed a throwing implementation). Vitest restores
		// the implementation passed to `vi.fn(impl)` in the module factory, so the
		// production-faithful defaults come back on every test.
		vi.mocked(isDockerAvailable).mockReset();
		vi.mocked(ensureImage).mockReset();
		vi.mocked(runInContainer).mockReset();
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-naming-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it.each(NAMING_ROWS)("$mode mode names the $phase phase $stepId", async ({
		mode,
		stepId,
		running,
		done,
	}) => {
		if (mode === "bare") {
			await makeAutoRepo(tmpDir);
		} else {
			await makeSingleRunnerConfig(tmpDir);
		}

		const steps = await run(tmpDir);
		const emitted = steps.filter((s) => s.id === stepId);

		expect(emitted.map((s) => [s.label, s.status])).toEqual([
			[running, "running"],
			[done, "done"],
		]);
	});

	// JDB5-001: the FAILURE labels were pinned by zero tests repo-wide, so the
	// `doneLabel` scoping was only correct by inspection on the error path. One
	// error-driving row per mode, since bare and suffixed compose the subject
	// differently and only an actual throw reaches that branch.
	const FAILURE_ROWS = [
		{
			mode: "bare" as const,
			stepId: "test",
			failed: "Tests failed",
			forbidden: "Test failed",
		},
		{
			mode: "suffixed" as const,
			stepId: "test:api",
			failed: "Test [api] failed",
			forbidden: "Tests [api] failed",
		},
	];

	it.each(
		FAILURE_ROWS,
	)("$mode mode labels a failing test phase $failed", async ({
		mode,
		stepId,
		failed,
		forbidden,
	}) => {
		if (mode === "bare") {
			await makeAutoRepo(tmpDir);
		} else {
			await makeSingleRunnerConfig(tmpDir);
		}
		// Fail ONLY the test phase: lint and compile run first and must stay
		// green, so the error label is produced by the test phase itself.
		vi.mocked(runInContainer).mockImplementation(async (options) =>
			/test/.test(options.command)
				? { exitCode: 1, stdout: "", stderr: "boom", timedOut: false }
				: { exitCode: 0, stdout: "", stderr: "", timedOut: false },
		);

		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, ...DOCKER_FULL }, (s) =>
				steps.push({ ...s }),
			),
		).rejects.toThrow();

		const emitted = steps.filter((s) => s.id === stepId);
		expect(emitted.at(-1)?.status).toBe("error");
		expect(emitted.at(-1)?.label).toBe(failed);
		expect(steps.map((s) => s.label)).not.toContain(forbidden);
	});

	it("never emits bare ids or bare done labels for a single-runner CONFIG", async () => {
		await makeSingleRunnerConfig(tmpDir);

		const steps = await run(tmpDir);
		const ids = steps.map((s) => s.id);
		const labels = steps.map((s) => s.label);

		// The stream is real — the absences below are meaningful.
		expect(ids).toEqual(
			expect.arrayContaining(["lint:api", "compile:api", "test:api"]),
		);
		for (const bare of ["lint", "compile", "test"]) {
			expect(ids).not.toContain(bare);
		}
		expect(labels).not.toContain("Tests [api] passed");
		expect(labels).not.toContain("Tests passed");
	});

	it("throws an invariant error when a Docker step has no resolved image", async () => {
		// Production `ensureImage` always returns a name; this forces the defensive
		// branch that replaces the old `?? runner.image ?? getImageName(stack)`
		// fallback chain, so a missing image fails loudly instead of being
		// silently re-derived from the stack.
		await makeSingleRunnerConfig(tmpDir);
		vi.mocked(ensureImage).mockResolvedValueOnce(
			undefined as unknown as string,
		);

		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, ...DOCKER_FULL }, (s) =>
				steps.push({ ...s }),
			),
		).rejects.toThrow(/image/i);

		expect(runInContainer).not.toHaveBeenCalled();
		expect(steps.some((s) => s.status === "error")).toBe(true);
	});

	it("runs the per-runner security phase LAST, before the top-level scan", async () => {
		await makeSingleRunnerConfig(tmpDir, "    security: echo audit\n");

		const steps = await run(tmpDir, { noSecurity: false });
		const ids = [...new Set(steps.map((s) => s.id))];

		expect(ids).toEqual([
			"detect",
			"docker-check",
			"context-refresh",
			"docker-image:api",
			"lint:api",
			"compile:api",
			"test:api",
			"security:api",
			"security",
		]);
		// Per-runner security runs after test and before the top-level Semgrep step.
		expect(ids.indexOf("security:api")).toBeGreaterThan(
			ids.indexOf("test:api"),
		);
		expect(ids.indexOf("security:api")).toBeLessThan(ids.indexOf("security"));

		// JDA5-004: the de-duplicated view above cannot see a DUPLICATE emission
		// — the exact regression class JDA2-001 caught on the auto path. Assert
		// the RAW stream too: every phase emits running→done exactly once, and
		// the image is built once for the single configured runner.
		const raw = steps.map((s) => s.id);
		for (const id of ["docker-image:api", "lint:api", "compile:api"]) {
			expect(raw.filter((emitted) => emitted === id)).toHaveLength(2);
		}
		expect(ensureImage).toHaveBeenCalledTimes(1);
	});

	it("skips the per-runner security phase under --no-security and outside full mode", async () => {
		await makeSingleRunnerConfig(tmpDir, "    security: echo audit\n");

		const noSecurity = await run(tmpDir, { noSecurity: true });
		expect(noSecurity.map((s) => s.id)).not.toContain("security:api");

		const quick = await run(tmpDir, { mode: "quick", noSecurity: false });
		expect(quick.map((s) => s.id)).not.toContain("security:api");
		// Quick mode also drops the test phase — proof the run really was quick.
		expect(quick.map((s) => s.id)).not.toContain("test:api");
	});

	it("threads a build-context runner's built tag into every container run", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await fs.outputFile(
			path.join(tmpDir, "docker", "Dockerfile"),
			"FROM scratch\n",
		);
		await fs.outputFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			`version: 1
runners:
  - name: api
    stack: node
    build-context: docker
    lint: echo lint
`,
		);

		const steps = await run(tmpDir, { mode: "quick" });

		expect(ensureImage).toHaveBeenCalledWith({
			stack: "node",
			buildContext: path.resolve(tmpDir, "docker"),
			imageTag: "javi-forge-ci-api",
		});
		// The tag the build produced — NOT the default per-stack image — is what
		// every step runs in.
		const images = vi
			.mocked(runInContainer)
			.mock.calls.map(([options]) => options.image);
		expect(images).toEqual(["javi-forge-ci-api"]);
		expect(images).not.toContain(getImageName("node"));

		const image = steps.filter((s) => s.id === "docker-image:api");
		expect(image.map((s) => [s.label, s.status])).toEqual([
			["Building image for api from docker", "running"],
			["Docker image ready (javi-forge-ci-api)", "done"],
		]);
	});

	it("threads an explicitly configured image verbatim and builds nothing", async () => {
		const pinned =
			"registry.example.com/api@sha256:0000000000000000000000000000000000000000000000000000000000000000";
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await fs.outputFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			`version: 1
runners:
  - name: api
    stack: node
    image: "${pinned}"
    lint: echo lint
`,
		);

		const steps = await run(tmpDir, { mode: "quick" });

		expect(ensureImage).not.toHaveBeenCalled();
		const images = vi
			.mocked(runInContainer)
			.mock.calls.map(([options]) => options.image);
		expect(images).toEqual([pinned]);

		// A configured image reports done once — there is no build to report ready.
		const image = steps.filter((s) => s.id === "docker-image:api");
		expect(image.map((s) => [s.label, s.status])).toEqual([
			[`Using configured image ${pinned}`, "done"],
		]);
	});

	it("fails the runner when the image build fails, before any step runs", async () => {
		await makeSingleRunnerConfig(tmpDir);
		vi.mocked(ensureImage).mockRejectedValueOnce(
			new Error("docker build boom"),
		);

		const steps: CIStep[] = [];
		await expect(
			runCI({ projectDir: tmpDir, ...DOCKER_FULL }, (s) =>
				steps.push({ ...s }),
			),
		).rejects.toThrow(/docker build boom/);

		const image = steps.filter((s) => s.id === "docker-image:api").at(-1);
		expect(image?.status).toBe("error");
		expect(image?.detail).toContain("docker build boom");
		expect(runInContainer).not.toHaveBeenCalled();
	});
});

// =============================================================================
// Shell mode honors runner image / build context (B2)
// =============================================================================

describe("shell mode honors runner image/build context (B2)", () => {
	let tmpDir: string;

	const openShellCalls = () =>
		vi.mocked(openShell).mock.calls.map(([, image]) => image);

	beforeEach(async () => {
		vi.mocked(isDockerAvailable).mockReset();
		vi.mocked(ensureImage).mockReset();
		vi.mocked(openShell).mockReset();
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-shell-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	const runShell = async (): Promise<void> => {
		await runCI(
			{ projectDir: tmpDir, mode: "shell", noDocker: false, noGhagga: true },
			() => {},
		);
	};

	it("opens the shell with a runner's pinned image, not the stack default", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await fs.outputFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			"version: 1\nrunners:\n  - name: web\n    stack: node\n    image: registry.example/custom-node:99\n",
		);

		await runShell();

		// The pinned image passes through verbatim; no stack-default image is built.
		expect(openShellCalls()).toEqual(["registry.example/custom-node:99"]);
		expect(ensureImage).not.toHaveBeenCalled();
	});

	it("opens the shell with a runner's build-context image", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), { scripts: {} });
		await fs.outputFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			"version: 1\nrunners:\n  - name: web\n    stack: node\n    build-context: ./ci/docker\n",
		);

		await runShell();

		// PRODUCTION-FAITHFUL mock returns the imageTag for a build-context build.
		expect(openShellCalls()).toEqual(["javi-forge-ci-web"]);
		expect(ensureImage).toHaveBeenCalledWith(
			expect.objectContaining({
				buildContext: path.resolve(tmpDir, "./ci/docker"),
				imageTag: "javi-forge-ci-web",
			}),
		);
	});

	it("falls back to the stack-default image when the runner pins nothing", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { lint: "eslint .", build: "tsc", test: "vitest run" },
		});
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");

		await runShell();

		// Auto repo, no pinned image → the per-stack default (getImageName("node")).
		expect(openShellCalls()).toEqual([getImageName("node")]);
	});
});
