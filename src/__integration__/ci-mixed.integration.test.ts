/**
 * Integration fixtures for mixed-stack (hybrid) repositories — plan task 6.
 *
 * Fixture: root package.json (Node marker) + nested backend/ Python project.
 * Without config, javi-forge classifies the repo as Node only; with
 * .javi-forge/ci.yaml both runners must execute, in order, each in its own
 * working directory.
 *
 * Toolchains are real and deterministic: node, python3 and ruff from PATH.
 * Docker tests use the small local `bash:5` image and prove that container
 * execution uses the RESOLVED runner image (never marker re-detection).
 */

import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCI } from "../commands/ci.js";
import { isDockerAvailable } from "../lib/docker.js";
import { cleanupTempDir, collectSteps, createTempDir } from "./helpers.js";

const DOCKER_OK = await isDockerAvailable();

/** Probe a host toolchain once at module load — mirrors the DOCKER_OK gate. */
async function hasTool(tool: string): Promise<boolean> {
	try {
		const { execFileAsync } = await import("../lib/exec.js");
		await execFileAsync("bash", ["-c", `command -v ${tool}`], {
			timeout: 5_000,
		});
		return true;
	} catch {
		return false;
	}
}

// The native Python runner cases need python3 + ruff on PATH. A node-only
// containerized runner lacks them, so those cases SKIP (never fail) there.
const PYTHON_OK = await hasTool("python3");
const RUFF_OK = await hasTool("ruff");
const PY_RUFF_OK = PYTHON_OK && RUFF_OK;

/** bash:5 is pulled by the developer/CI environment; skip if absent. */
const BASH_IMAGE_OK =
	DOCKER_OK &&
	(await (async () => {
		try {
			const { execFileAsync } = await import("../lib/exec.js");
			await execFileAsync("docker", ["image", "inspect", "bash:5"], {
				timeout: 10_000,
			});
			return true;
		} catch {
			return false;
		}
	})());

const VALID_PY = 'def main():\n    print("ok")\n\n\nmain()\n';
const INVALID_PY = "import os\n"; // ruff F401: imported but unused
const VALID_MJS = "export const answer = 42;\nconsole.log(answer);\n";

async function createHybridRepo(dir: string, pythonSource = VALID_PY) {
	await fs.writeJson(path.join(dir, "package.json"), {
		name: "hybrid-fixture",
		scripts: { lint: "biome check ." },
	});
	await fs.writeFile(path.join(dir, "index.mjs"), VALID_MJS);
	await fs.ensureDir(path.join(dir, "backend"));
	await fs.writeFile(path.join(dir, "backend", "pyproject.toml"), "");
	await fs.writeFile(path.join(dir, "backend", "app.py"), pythonSource);
	await fs.outputFile(
		path.join(dir, ".javi-forge", "ci.yaml"),
		`
version: 1
runners:
  - name: backend
    stack: python
    directory: backend
    lint: ruff check .
    requires: [python3, ruff]
  - name: frontend
    stack: node
    directory: .
    lint: node --check index.mjs
    requires: [node]
`,
	);
}

const NATIVE = {
	mode: "quick" as const,
	noDocker: true,
	noGhagga: true,
	noSecurity: true,
};

describe("runCI() — mixed Node+Python fixture (native, real toolchains)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await createTempDir("javi-forge-mixed-");
	});

	afterEach(async () => {
		await cleanupTempDir(tmpDir);
	});

	it.skipIf(!PY_RUFF_OK)(
		"runs both runners in order, each in its own working directory",
		async () => {
			await createHybridRepo(tmpDir);
			const { steps, onStep } = collectSteps();

			await runCI({ projectDir: tmpDir, ...NATIVE }, onStep);

			// Both runners executed and passed with real tools:
			// ruff really checked backend/, node really parsed index.mjs.
			expect(steps.find((s) => s.id === "lint:backend")?.status).toBe("done");
			expect(steps.find((s) => s.id === "lint:frontend")?.status).toBe("done");
			// Runner order is the configured order.
			expect(
				steps.filter((s) => s.id.startsWith("lint:")).map((s) => s.id),
			).toEqual(["lint:backend", "lint:frontend"]);
			// Required tools were verified fail-closed before phases.
			expect(steps.find((s) => s.id === "tools:backend")?.status).toBe("done");
			expect(steps.find((s) => s.id === "tools:frontend")?.status).toBe("done");
		},
	);

	it.skipIf(!PY_RUFF_OK)(
		"fails closed when real ruff finds a violation; frontend never runs",
		async () => {
			await createHybridRepo(tmpDir, INVALID_PY);
			const { steps, onStep } = collectSteps();

			await expect(
				runCI({ projectDir: tmpDir, ...NATIVE }, onStep),
			).rejects.toBeDefined();

			expect(steps.find((s) => s.id === "lint:backend")?.status).toBe("error");
			// Fail fast: the second runner must not execute after a failure.
			expect(steps.find((s) => s.id === "lint:frontend")).toBeUndefined();
		},
	);

	it("auto-detection still classifies the hybrid repo as node-only without config", async () => {
		await createHybridRepo(tmpDir);
		await fs.remove(path.join(tmpDir, ".javi-forge"));

		const { steps, onStep } = collectSteps();
		await runCI({ projectDir: tmpDir, mode: "detect", noDocker: true }, onStep);

		// Root package.json wins — this is the documented zero-config default
		// and the reason hybrid repos must declare runners explicitly.
		expect(steps.at(-1)?.label).toContain("node");
	});
});

describe("runCI() — resolved runner in real Docker execution", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await createTempDir("javi-forge-mixed-docker-");
	});

	afterEach(async () => {
		await cleanupTempDir(tmpDir);
	});

	it.skipIf(!BASH_IMAGE_OK)(
		"container runs the configured image verbatim, not a marker-detected one",
		async () => {
			// Repo markers say Node; the config pins image bash:5. If Docker
			// re-detected, it would need javi-forge-ci-node instead.
			await fs.writeJson(path.join(tmpDir, "package.json"), {
				name: "markers-say-node",
			});
			await fs.outputFile(
				path.join(tmpDir, ".javi-forge", "ci.yaml"),
				`
version: 1
runners:
  - name: pinned
    stack: node
    image: bash:5
    lint: echo container-proof > proof.txt
    requires: [bash]
`,
			);

			const { steps, onStep } = collectSteps();
			await runCI(
				{
					projectDir: tmpDir,
					mode: "quick",
					noGhagga: true,
					noSecurity: true,
				},
				onStep,
			);

			expect(
				steps.find((s) => s.id === "docker-image:pinned")?.label,
			).toContain("bash:5");
			expect(steps.find((s) => s.id === "tools:pinned")?.status).toBe("done");
			expect(steps.find((s) => s.id === "lint:pinned")?.status).toBe("done");
			// Written inside the container against the bind-mounted workdir.
			expect(
				await fs.readFile(path.join(tmpDir, "proof.txt"), "utf-8"),
			).toContain("container-proof");
		},
		120_000,
	);

	it.skipIf(!BASH_IMAGE_OK)(
		"missing tool inside the container fails closed naming runner, tool and image",
		async () => {
			await fs.writeJson(path.join(tmpDir, "package.json"), {
				name: "markers-say-node",
			});
			await fs.outputFile(
				path.join(tmpDir, ".javi-forge", "ci.yaml"),
				`
version: 1
runners:
  - name: pinned
    stack: node
    image: bash:5
    lint: echo should-not-run > proof.txt
    requires: [python3]
`,
			);

			const { steps, onStep } = collectSteps();
			await expect(
				runCI(
					{
						projectDir: tmpDir,
						mode: "quick",
						noGhagga: true,
						noSecurity: true,
					},
					onStep,
				),
			).rejects.toThrow(/pinned[\s\S]*python3[\s\S]*bash:5/);

			const tools = steps.find((s) => s.id === "tools:pinned");
			expect(tools?.status).toBe("error");
			expect(tools?.detail).toContain("python3");
			expect(tools?.detail).toContain("bash:5");
			expect(await fs.pathExists(path.join(tmpDir, "proof.txt"))).toBe(false);
		},
		120_000,
	);
});
