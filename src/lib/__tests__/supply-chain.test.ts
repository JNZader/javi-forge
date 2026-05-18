import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildNpmrcLines,
	buildSocketConfig,
	configureSupplyChain,
	detectPackageManager,
	stackForPM,
} from "../supply-chain.js";

let tmpDir: string;

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sc-test-"));
});

afterEach(async () => {
	await fs.remove(tmpDir);
});

// ── detectPackageManager ──

describe("detectPackageManager", () => {
	it("detects pnpm from pnpm-lock.yaml", async () => {
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");
		expect(detectPackageManager(tmpDir)).toBe("pnpm");
	});

	it("detects yarn from yarn.lock", async () => {
		await fs.writeFile(path.join(tmpDir, "yarn.lock"), "");
		expect(detectPackageManager(tmpDir)).toBe("yarn");
	});

	it("detects npm from package-lock.json", async () => {
		await fs.writeFile(path.join(tmpDir, "package-lock.json"), "{}");
		expect(detectPackageManager(tmpDir)).toBe("npm");
	});

	it("detects pip from Pipfile.lock", async () => {
		await fs.writeFile(path.join(tmpDir, "Pipfile.lock"), "{}");
		expect(detectPackageManager(tmpDir)).toBe("pip");
	});

	it("detects cargo from Cargo.lock", async () => {
		await fs.writeFile(path.join(tmpDir, "Cargo.lock"), "");
		expect(detectPackageManager(tmpDir)).toBe("cargo");
	});

	it("detects go from go.sum", async () => {
		await fs.writeFile(path.join(tmpDir, "go.sum"), "");
		expect(detectPackageManager(tmpDir)).toBe("go");
	});

	it("falls back to npm with package.json", async () => {
		await fs.writeFile(path.join(tmpDir, "package.json"), "{}");
		expect(detectPackageManager(tmpDir)).toBe("npm");
	});

	it("defaults to npm when nothing found", () => {
		expect(detectPackageManager(tmpDir)).toBe("npm");
	});

	it("pnpm takes priority over npm", async () => {
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");
		await fs.writeFile(path.join(tmpDir, "package-lock.json"), "{}");
		expect(detectPackageManager(tmpDir)).toBe("pnpm");
	});
});

// ── stackForPM ──

describe("stackForPM", () => {
	it("maps npm/pnpm/yarn to node", () => {
		expect(stackForPM("npm")).toBe("node");
		expect(stackForPM("pnpm")).toBe("node");
		expect(stackForPM("yarn")).toBe("node");
	});

	it("maps pip to python", () => {
		expect(stackForPM("pip")).toBe("python");
	});

	it("maps cargo to rust", () => {
		expect(stackForPM("cargo")).toBe("rust");
	});

	it("maps go to go", () => {
		expect(stackForPM("go")).toBe("go");
	});
});

// ── buildSocketConfig ──

describe("buildSocketConfig", () => {
	it("returns version 2 config", () => {
		const config = buildSocketConfig("npm");
		expect(config.version).toBe(2);
	});

	it("sets projectType from stack", () => {
		expect(buildSocketConfig("npm").projectType).toBe("node");
		expect(buildSocketConfig("pip").projectType).toBe("python");
	});

	it("blocks install scripts and shell access", () => {
		const config = buildSocketConfig("npm");
		const rules = (config.issueRules as Record<string, Record<string, string>>)[
			"pkg:npm/*"
		]!;
		expect(rules.installScripts).toBe("error");
		expect(rules.shellAccess).toBe("error");
	});
});

// ── buildNpmrcLines ──

describe("buildNpmrcLines", () => {
	it("includes engine-strict and save-exact", () => {
		const lines = buildNpmrcLines(48);
		expect(lines.some((l) => l.includes("engine-strict=true"))).toBe(true);
		expect(lines.some((l) => l.includes("save-exact=true"))).toBe(true);
	});

	it("includes age comment when > 0", () => {
		const lines = buildNpmrcLines(48);
		expect(lines.some((l) => l.includes("48h"))).toBe(true);
	});

	it("omits age comment when 0", () => {
		const lines = buildNpmrcLines(0);
		expect(lines.some((l) => l.includes("Minimum package age"))).toBe(false);
	});
});

// ── configureSupplyChain (integration) ──

describe("configureSupplyChain", () => {
	it("creates .socketrc for node projects", async () => {
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");
		const result = await configureSupplyChain(tmpDir);

		expect(result.configWritten).toContain(".socketrc");
		const socketrc = await fs.readJson(path.join(tmpDir, ".socketrc"));
		expect(socketrc.version).toBe(2);
	});

	it("creates .npmrc with lockfile enforcement for pnpm", async () => {
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");
		const result = await configureSupplyChain(tmpDir);

		expect(result.configWritten).toContain(".npmrc");
		const npmrc = await fs.readFile(path.join(tmpDir, ".npmrc"), "utf-8");
		expect(npmrc).toContain("frozen-lockfile=true");
	});

	it("uses package-lock=true for npm", async () => {
		await fs.writeFile(path.join(tmpDir, "package-lock.json"), "{}");
		await configureSupplyChain(tmpDir);
		const npmrc = await fs.readFile(path.join(tmpDir, ".npmrc"), "utf-8");
		expect(npmrc).toContain("package-lock=true");
	});

	it("saves supply-chain.json metadata", async () => {
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");
		await configureSupplyChain(tmpDir);

		const meta = await fs.readJson(
			path.join(tmpDir, ".javi-forge", "supply-chain.json"),
		);
		expect(meta.packageManager).toBe("pnpm");
		expect(meta.minReleaseAgeHours).toBe(48);
		expect(meta.socketEnabled).toBe(true);
	});

	it("appends to existing .npmrc without overwriting", async () => {
		await fs.writeFile(path.join(tmpDir, "package.json"), "{}");
		await fs.writeFile(
			path.join(tmpDir, ".npmrc"),
			"registry=https://registry.npmjs.org\n",
		);
		await configureSupplyChain(tmpDir);

		const npmrc = await fs.readFile(path.join(tmpDir, ".npmrc"), "utf-8");
		expect(npmrc).toContain("registry=https://registry.npmjs.org");
		expect(npmrc).toContain("engine-strict=true");
	});

	it("respects socketEnabled=false", async () => {
		await fs.writeFile(path.join(tmpDir, "package.json"), "{}");
		const result = await configureSupplyChain(tmpDir, {
			socketEnabled: false,
		});
		expect(result.configWritten).not.toContain(".socketrc");
		expect(result.warnings).toHaveLength(1);
	});

	it("skips .npmrc for non-node stacks", async () => {
		await fs.writeFile(path.join(tmpDir, "Cargo.lock"), "");
		const result = await configureSupplyChain(tmpDir);
		expect(result.configWritten).not.toContain(".npmrc");
	});
});
