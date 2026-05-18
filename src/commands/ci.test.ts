import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CIStep } from "./ci.js";
import { detectCIStack, installCIHooks, runCI } from "./ci.js";

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
