import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * GATE-3 (JDB-102) — end-to-end seam coverage for the headless `--json` run path.
 *
 * The `--json` run branch is unit-tested in PIECES: `collectGateOutcomes` directly
 * (src/commands/ci.test.ts) and the dispatch branch with a MOCKED collector
 * (src/cli/dispatch/ci-json-run.test.ts). Neither wires the REAL chain
 * dispatch → collectGateOutcomes → runCI → process.exit together. This test closes
 * that gap: it drives the real binary through tsx in a subprocess (so a REAL
 * `process.exit` code is observed) against a real repo with a BLOCKING gate that
 * fails, and asserts the printed JSON AND the exit code together.
 */

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
);
const tsxBin = path.join(repoRoot, "node_modules", ".bin", "tsx");
const entry = path.join(repoRoot, "src", "index.tsx");

async function runCli(
	args: string[],
	cwd: string,
): Promise<{ stdout: string; exitCode: number }> {
	try {
		const { stdout } = await execFileAsync(tsxBin, [entry, ...args], {
			cwd,
			env: { ...process.env, CI: "1", NO_UPDATE_NOTIFIER: "1" },
		});
		return { stdout, exitCode: 0 };
	} catch (e) {
		const err = e as { stdout?: string; code?: number };
		return { stdout: err.stdout ?? "", exitCode: err.code ?? 1 };
	}
}

describe("ci --json run-path end-to-end seam (GATE-3)", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-json-e2e-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("a failing blocking gate exits NON-ZERO with valid ok:false JSON (real dispatch→collector→exit)", async () => {
		await fs.outputFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			["version: 2", "gates:", "  - id: blocker", "    run: exit 1"].join("\n"),
		);

		// Native run (no Docker/security phases): the gate phase is the whole run.
		const { stdout, exitCode } = await runCli(
			["ci", "--json", "--no-docker", "--no-security"],
			tmpDir,
		);

		// The real process.exit code reflects the blocking failure.
		expect(exitCode).not.toBe(0);
		expect(exitCode).toBe(1);

		// stdout is a single valid JSON object matching the spec shape.
		const parsed = JSON.parse(stdout);
		expect(parsed.ok).toBe(false);
		expect(parsed.exitCode).toBe(1);
		expect(Array.isArray(parsed.gates)).toBe(true);
		expect(parsed.gates).toHaveLength(1);
		expect(parsed.gates[0]).toMatchObject({
			id: "blocker",
			mode: "blocking",
			scope: "all",
			status: "error",
			blocking: true,
		});
	}, 30000);

	it("an all-passing run exits 0 with ok:true JSON", async () => {
		await fs.outputFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			["version: 2", "gates:", "  - id: ok", "    run: exit 0"].join("\n"),
		);

		const { stdout, exitCode } = await runCli(
			["ci", "--json", "--no-docker", "--no-security"],
			tmpDir,
		);

		expect(exitCode).toBe(0);
		const parsed = JSON.parse(stdout);
		expect(parsed.ok).toBe(true);
		expect(parsed.exitCode).toBe(0);
		expect(parsed.gates[0]).toMatchObject({ id: "ok", status: "done" });
	}, 30000);
});
