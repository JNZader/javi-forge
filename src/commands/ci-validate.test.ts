import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateCIConfig } from "./ci-validate.js";

/**
 * `ci validate` is a pure parse-and-report surface over the existing CI config
 * validator (src/lib/ci-config.ts). It NEVER builds images or runs Docker — it
 * resolves the config path, calls `loadCIConfig`, and reports the outcome.
 */

let tmpDir: string;

async function writeConfig(body: string): Promise<string> {
	const dir = path.join(tmpDir, ".javi-forge");
	await fs.ensureDir(dir);
	const file = path.join(dir, "ci.yaml");
	await fs.writeFile(file, body);
	return file;
}

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-validate-"));
});

afterEach(async () => {
	await fs.remove(tmpDir);
});

describe("validateCIConfig", () => {
	it("returns ok with runner names+stacks for a valid config", async () => {
		const configPath = await writeConfig(
			[
				"version: 1",
				"runners:",
				"  - name: api",
				"    stack: go",
				"  - name: web",
				"    stack: node",
			].join("\n"),
		);

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.configPath).toBe(configPath);
			expect(result.runners).toEqual([
				{ name: "api", stack: "go" },
				{ name: "web", stack: "node" },
			]);
		}
	});

	it("discovers the default config when no explicit path is given", async () => {
		await writeConfig("version: 1\nrunners:\n  - name: api\n    stack: go");

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(true);
	});

	it("honors an explicit config path", async () => {
		const configPath = await writeConfig(
			"version: 1\nrunners:\n  - name: api\n    stack: go",
		);

		const result = await validateCIConfig(tmpDir, configPath);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.configPath).toBe(configPath);
	});

	it("reports an unknown top-level key", async () => {
		await writeConfig(
			"version: 1\nbogus: true\nrunners:\n  - name: api\n    stack: go",
		);

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContainEqual({
				path: "bogus",
				message: 'unknown field "bogus"',
			});
		}
	});

	it("reports a version other than 1", async () => {
		await writeConfig("version: 2\nrunners:\n  - name: api\n    stack: go");

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			const versionErr = result.errors.find((e) => e.path === "version");
			expect(versionErr?.message).toContain("must be the number 1");
		}
	});

	it("reports an empty runners list", async () => {
		await writeConfig("version: 1\nrunners: []");

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			const runnersErr = result.errors.find((e) => e.path === "runners");
			expect(runnersErr?.message).toContain("non-empty list");
		}
	});

	it("reports a duplicate runner name", async () => {
		await writeConfig(
			[
				"version: 1",
				"runners:",
				"  - name: api",
				"    stack: go",
				"  - name: api",
				"    stack: node",
			].join("\n"),
		);

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContainEqual({
				path: "runners",
				message: 'duplicate runner name "api"',
			});
		}
	});

	it("reports an unknown runner field", async () => {
		await writeConfig(
			"version: 1\nrunners:\n  - name: api\n    stack: go\n    bogus: 1",
		);

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toContainEqual({
				path: "runners[0].bogus",
				message: 'unknown field "bogus"',
			});
		}
	});

	it("returns a named missing-file error (not a stack trace) when no config exists", async () => {
		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].message).toContain(
				"no .javi-forge/ci.yaml found",
			);
		}
	});

	it("returns a named missing-file error for an explicit path that does not exist", async () => {
		const missing = path.join(tmpDir, ".javi-forge", "ci.yaml");

		const result = await validateCIConfig(tmpDir, missing);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors[0].message).toContain(
				"no .javi-forge/ci.yaml found",
			);
			expect(result.errors[0].message).toContain(missing);
		}
	});
});
