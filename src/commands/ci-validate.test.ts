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
			expect(result.mode).toBe("config");
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

	it("reports a version outside the accepted set {1,2}", async () => {
		// version 2 is now valid (additive gates schema); version 3 is the genuine
		// out-of-set case that must still fail closed.
		await writeConfig("version: 3\nrunners:\n  - name: api\n    stack: go");

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			const versionErr = result.errors.find((e) => e.path === "version");
			expect(versionErr?.message).toContain("must be one of: 1, 2");
		}
	});

	it("surfaces gate schema errors (duplicate id + invalid mode) without executing", async () => {
		await writeConfig(
			[
				"version: 2",
				"gates:",
				"  - id: dup",
				"    run: echo a",
				"    mode: warn",
				"  - id: dup",
				"    run: echo b",
			].join("\n"),
		);

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(
				result.errors.some((e) => /blocking, informative/.test(e.message)),
			).toBe(true);
			expect(
				result.errors.some((e) => /duplicate gate id "dup"/.test(e.message)),
			).toBe(true);
		}
	});

	it("reports a gates-only v2 config as valid with a gate summary", async () => {
		await writeConfig(
			"version: 2\ngates:\n  - id: coverage\n    run: echo cover\n    mode: informative",
		);

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.runners).toEqual([]);
			expect(result.gates).toEqual([
				{ id: "coverage", mode: "informative", scope: "all" },
			]);
		}
	});

	it("surfaces a gate's image in the summary when declared", async () => {
		await writeConfig(
			"version: 2\ngates:\n  - id: audit\n    run: echo a\n    image: ghcr.io/acme/tool@sha256:abc",
		);

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.gates).toEqual([
				{
					id: "audit",
					mode: "blocking",
					scope: "all",
					image: "ghcr.io/acme/tool@sha256:abc",
				},
			]);
		}
	});

	it("omits image from the summary for a v2 gate without image (byte-identical)", async () => {
		await writeConfig(
			"version: 2\ngates:\n  - id: coverage\n    run: echo cover\n    mode: informative",
		);

		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.gates[0]).not.toHaveProperty("image");
			expect(result.gates[0]).toEqual({
				id: "coverage",
				mode: "informative",
				scope: "all",
			});
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

	it("treats a zero-config repo (discovery finds nothing) as valid auto-detect, not a failure", async () => {
		// runCI runs fine in this exact state via its zero-config auto-detect path
		// (ci.ts:396-406), so `ci validate` must NOT report FAIL here.
		const result = await validateCIConfig(tmpDir);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.mode).toBe("auto-detect");
			expect(result.configPath).toBeNull();
			expect(result.runners).toEqual([]);
		}
	});

	it("returns a named error for an explicit --config path that does not exist", async () => {
		const missing = path.join(tmpDir, ".javi-forge", "ci.yaml");

		const result = await validateCIConfig(tmpDir, missing);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0].message).toContain("no CI config found at");
			expect(result.errors[0].message).toContain(missing);
		}
	});
});
