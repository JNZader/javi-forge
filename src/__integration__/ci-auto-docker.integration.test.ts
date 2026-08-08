/**
 * Auto (zero-config) resolution against REAL Docker — the end-to-end leaf the
 * mocked unit characterization cannot reach.
 *
 * Opportunistic by design: the suite is skipped unless Docker is running AND
 * the javi-forge node image already exists locally, mirroring the `bash:5`
 * gate in ci-mixed.integration.test.ts. Building the image here would turn a
 * test run into a multi-minute image build, so the always-on safety net stays
 * the mocked-Docker unit block in src/commands/ci.test.ts.
 */

import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCI } from "../commands/ci.js";
import { getImageName, isDockerAvailable } from "../lib/docker.js";
import { cleanupTempDir, collectSteps, createTempDir } from "./helpers.js";

const DOCKER_OK = await isDockerAvailable();

/** The per-stack image is built by a prior real CI run; skip when absent. */
const NODE_IMAGE_OK =
	DOCKER_OK &&
	(await (async () => {
		try {
			const { execFileAsync } = await import("../lib/exec.js");
			await execFileAsync(
				"docker",
				["image", "inspect", getImageName("node")],
				{ timeout: 10_000 },
			);
			return true;
		} catch {
			return false;
		}
	})());

const DOCKER_RUN = {
	mode: "full" as const,
	noGhagga: true,
	noSecurity: true,
};

describe("runCI() — auto resolution in real Docker", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await createTempDir("javi-forge-auto-docker-");
		// mkdtemp creates 0700 owned by the host user; the javi-forge image runs
		// as `runner` (uid 1001), which could otherwise neither enter nor write
		// the bind-mounted workdir. Real project directories are world-readable.
		await fs.chmod(tmpDir, 0o777);
	});

	afterEach(async () => {
		await cleanupTempDir(tmpDir);
	});

	it.skipIf(!NODE_IMAGE_OK)(
		"runs lint, compile and test inside the container with bare step ids",
		async () => {
			// No .javi-forge/ci.yaml → resolved.source === "auto".
			await fs.writeJson(path.join(tmpDir, "package.json"), {
				name: "auto-docker-fixture",
				scripts: {
					lint: "echo lint-proof > lint-proof.txt",
					build: "echo build-proof > build-proof.txt",
					test: "echo test-proof > test-proof.txt",
				},
			});

			const { steps, onStep } = collectSteps();
			await runCI({ projectDir: tmpDir, ...DOCKER_RUN }, onStep);

			expect(steps.find((s) => s.id === "docker-check")?.status).toBe("done");
			expect(steps.find((s) => s.id === "docker-image")?.status).toBe("done");
			// Auto keeps bare ids — no per-runner suffix.
			expect(steps.find((s) => s.id === "lint")?.status).toBe("done");
			expect(steps.find((s) => s.id === "compile")?.status).toBe("done");
			expect(steps.find((s) => s.id === "test")?.status).toBe("done");
			expect(steps.some((s) => s.id.includes(":"))).toBe(false);

			// Written inside the container against the bind-mounted workdir:
			// proof that every phase really executed in Docker, not natively.
			for (const proof of [
				"lint-proof",
				"build-proof",
				"test-proof",
			] as const) {
				expect(
					await fs.readFile(path.join(tmpDir, `${proof}.txt`), "utf-8"),
				).toContain(proof);
			}
		},
		300_000,
	);

	it.skipIf(!NODE_IMAGE_OK)(
		"propagates a non-zero container exit code as a failed step",
		async () => {
			await fs.writeJson(path.join(tmpDir, "package.json"), {
				name: "auto-docker-failing-fixture",
				scripts: { test: "exit 7" },
			});

			const { steps, onStep } = collectSteps();
			await expect(
				runCI({ projectDir: tmpDir, ...DOCKER_RUN }, onStep),
			).rejects.toThrow(/7/);

			const test = steps.find((s) => s.id === "test");
			expect(test?.status).toBe("error");
			expect(test?.detail).toContain("7");
		},
		300_000,
	);
});
