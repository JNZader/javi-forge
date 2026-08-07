import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CIStep } from "./ci.js";
import {
	detectCIStack,
	installCIHooks,
	resolveCIRunners,
	runCI,
} from "./ci.js";

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
		expect(info.compileCmd).toContain("chown");
		expect(info.testCmd).toBe("go test ./...");
	});

	it("detects rust", async () => {
		await fs.writeFile(path.join(tmpDir, "Cargo.toml"), "[package]");

		const info = await detectCIStack(tmpDir);
		expect(info.stackType).toBe("rust");
		expect(info.lintCmd).toContain("clippy");
		expect(info.compileCmd).toContain("cargo build");
		expect(info.compileCmd).toContain("cargo clean");
		expect(info.compileCmd).toContain("chown");
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

	it("pre-push hook requires docker", async () => {
		await fs.ensureDir(path.join(tmpDir, ".git"));
		await installCIHooks(tmpDir);
		const content = await fs.readFile(
			path.join(tmpDir, ".git", "hooks", "pre-push"),
			"utf-8",
		);
		expect(content).toContain("docker info");
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
		expect(content).toContain("anthropic.com");
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
