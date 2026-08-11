import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type DepsSectionDeps, depsSection } from "./deps.js";

function baseDeps(over: Partial<DepsSectionDeps>): DepsSectionDeps {
	return {
		execFile: async () => ({ stdout: "", stderr: "" }),
		which: async () => true,
		fileExists: async () => false,
		log: () => {},
		...over,
	};
}

describe("depsSection (unit, mocked)", () => {
	it("no manifest → advisory skip ok:true", async () => {
		const section = depsSection(baseDeps({ fileExists: async () => false }));
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("package.json + pnpm-lock → runs pnpm audit; non-zero exit blocks", async () => {
		const seen: string[][] = [];
		const section = depsSection(
			baseDeps({
				fileExists: async (p) =>
					p.endsWith("package.json") || p.endsWith("pnpm-lock.yaml"),
				execFile: async (cmd, args) => {
					seen.push([cmd, ...args]);
					const err = new Error("audit failed") as Error & { code: number };
					err.code = 1;
					throw err;
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(false);
		expect(seen[0]).toEqual(["pnpm", "audit", "--audit-level=high"]);
	});

	it("package.json + pnpm-lock, clean audit → ok:true", async () => {
		const section = depsSection(
			baseDeps({
				fileExists: async (p) =>
					p.endsWith("package.json") || p.endsWith("pnpm-lock.yaml"),
				execFile: async () => ({ stdout: "0 vulns", stderr: "" }),
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("auditor binary missing (ENOENT) → advisory skip ok:true, does not block", async () => {
		const section = depsSection(
			baseDeps({
				fileExists: async (p) =>
					p.endsWith("package.json") || p.endsWith("pnpm-lock.yaml"),
				execFile: async () => {
					const err = new Error("spawn pnpm ENOENT") as Error & {
						code: string;
					};
					err.code = "ENOENT";
					throw err;
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("go.mod + govulncheck NOT installed → advisory skip ok:true", async () => {
		let logged = "";
		const section = depsSection(
			baseDeps({
				fileExists: async (p) => p.endsWith("go.mod"),
				which: async () => false,
				log: (m) => {
					logged += m;
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
		expect(logged).toContain("not installed");
	});

	it("go.mod + govulncheck installed, finding → blocks", async () => {
		const seen: string[][] = [];
		const section = depsSection(
			baseDeps({
				fileExists: async (p) => p.endsWith("go.mod"),
				which: async () => true,
				execFile: async (cmd, args) => {
					seen.push([cmd, ...args]);
					const err = new Error("vuln") as Error & { code: number };
					err.code = 3;
					throw err;
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(false);
		expect(seen[0]).toEqual(["govulncheck", "./..."]);
	});

	it("requirements.txt + pip-audit missing → advisory skip", async () => {
		const section = depsSection(
			baseDeps({
				fileExists: async (p) => p.endsWith("requirements.txt"),
				which: async () => false,
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("package.json + yarn.lock → yarn npm audit", async () => {
		const seen: string[][] = [];
		const section = depsSection(
			baseDeps({
				fileExists: async (p) =>
					p.endsWith("package.json") || p.endsWith("yarn.lock"),
				execFile: async (cmd, args) => {
					seen.push([cmd, ...args]);
					return { stdout: "", stderr: "" };
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
		expect(seen[0]).toEqual(["yarn", "npm", "audit", "--severity", "high"]);
	});

	it("package.json only (no lockfile) → npm audit", async () => {
		const seen: string[][] = [];
		const section = depsSection(
			baseDeps({
				fileExists: async (p) => p.endsWith("package.json"),
				execFile: async (cmd, args) => {
					seen.push([cmd, ...args]);
					return { stdout: "", stderr: "" };
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
		expect(seen[0]).toEqual(["npm", "audit", "--audit-level=high"]);
	});

	it("Cargo.toml + cargo-audit installed, clean → ok:true", async () => {
		const seen: string[][] = [];
		const section = depsSection(
			baseDeps({
				fileExists: async (p) => p.endsWith("Cargo.toml"),
				which: async () => true,
				execFile: async (cmd, args) => {
					seen.push([cmd, ...args]);
					return { stdout: "", stderr: "" };
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
		expect(seen[0]).toEqual(["cargo-audit"]);
	});

	it("Cargo.toml + cargo-audit missing → advisory skip", async () => {
		const section = depsSection(
			baseDeps({
				fileExists: async (p) => p.endsWith("Cargo.toml"),
				which: async () => false,
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("pyproject.toml + pip-audit installed, clean → runs pip-audit", async () => {
		const seen: string[][] = [];
		const section = depsSection(
			baseDeps({
				fileExists: async (p) => p.endsWith("pyproject.toml"),
				which: async () => true,
				execFile: async (cmd, args) => {
					seen.push([cmd, ...args]);
					return { stdout: "", stderr: "" };
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
		expect(seen[0]).toEqual(["pip-audit"]);
	});

	it("an unexpected thrown error (fileExists) is caught → ok:false", async () => {
		const section = depsSection(
			baseDeps({
				fileExists: async () => {
					throw new Error("fs boom");
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("fs boom");
	});
});

describe("depsSection (integration, real fs)", () => {
	let repo: string;
	beforeEach(async () => {
		repo = await fs.mkdtemp(path.join(os.tmpdir(), "jf-deps-"));
	});
	afterEach(async () => {
		await fs.remove(repo);
	});

	it("empty project (no manifest) → ok:true using the real fs seam", async () => {
		const section = depsSection({ log: () => {} });
		const result = await section.run({ projectDir: repo });
		expect(result.ok).toBe(true);
	});
});
