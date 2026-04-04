import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CIStep } from "./ci.js";
import { detectCIStack } from "./ci.js";

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
