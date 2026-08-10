import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CIHooksConfig } from "../lib/ci-config.js";
import {
	composeSections,
	type HookSection,
	loadHooksConfig,
	type RunHookDeps,
	runHook,
} from "./hooks.js";

// =============================================================================
// hook-consolidation S1a — dispatcher composition, fail-fast, fail-closed
// =============================================================================

/** A full hooks config with everything OFF except what a test flips on. */
const hooksConfig = (
	overrides: {
		preCommit?: Partial<CIHooksConfig["preCommit"]>;
		prePush?: Partial<CIHooksConfig["prePush"]>;
	} = {},
): CIHooksConfig => ({
	preCommit: {
		ci: true,
		tdd: false,
		secrets: false,
		permissions: false,
		...overrides.preCommit,
	},
	prePush: { ci: true, tdd: false, deps: false, ...overrides.prePush },
});

/** A fake section registry covering every id so ordering is observable. */
const fakeSection = (id: string, ok = true, blocking = true): HookSection => ({
	id,
	blocking,
	run: vi.fn(async () => ({ ok })),
});

describe("composeSections — fixed cheap→expensive order", () => {
	const fullRegistry = () => ({
		secrets: () => fakeSection("secrets"),
		permissions: () => fakeSection("permissions"),
		tdd: () => fakeSection("tdd"),
		deps: () => fakeSection("deps"),
		ci: () => fakeSection("ci"),
	});

	it("composes pre-commit as secrets → permissions → tdd → ci", () => {
		const sections = composeSections(
			"pre-commit",
			hooksConfig({
				preCommit: { secrets: true, permissions: true, tdd: true, ci: true },
			}),
			fullRegistry(),
		);
		expect(sections.map((s) => s.id)).toEqual([
			"secrets",
			"permissions",
			"tdd",
			"ci",
		]);
	});

	it("composes pre-push as deps → tdd → ci", () => {
		const sections = composeSections(
			"pre-push",
			hooksConfig({ prePush: { deps: true, tdd: "strict", ci: true } }),
			fullRegistry(),
		);
		expect(sections.map((s) => s.id)).toEqual(["deps", "tdd", "ci"]);
	});

	it("defaults to [ci] when config is null (today's behavior)", () => {
		const sections = composeSections("pre-commit", null, fullRegistry());
		expect(sections.map((s) => s.id)).toEqual(["ci"]);
	});

	it("omits a disabled section", () => {
		const sections = composeSections(
			"pre-commit",
			hooksConfig({ preCommit: { ci: false, secrets: true } }),
			fullRegistry(),
		);
		expect(sections.map((s) => s.id)).toEqual(["secrets"]);
	});

	it("skips an enabled section whose factory is not registered (S1a gating)", () => {
		// Only ci implemented → secrets enabled but no factory ⇒ not composed.
		const sections = composeSections(
			"pre-commit",
			hooksConfig({ preCommit: { secrets: true, ci: true } }),
			{ ci: () => fakeSection("ci") },
		);
		expect(sections.map((s) => s.id)).toEqual(["ci"]);
	});

	it("marks pre-push tdd:'warn' as advisory (non-blocking)", () => {
		const sections = composeSections(
			"pre-push",
			hooksConfig({ prePush: { tdd: "warn", ci: false } }),
			fullRegistry(),
		);
		const tdd = sections.find((s) => s.id === "tdd");
		expect(tdd?.blocking).toBe(false);
	});
});

describe("runHook — fail-fast, fail-closed, exit codes", () => {
	const deps = (over: Partial<RunHookDeps> = {}): RunHookDeps => ({
		loadConfig: async () => null,
		log: () => {},
		logError: () => {},
		...over,
	});

	it("rejects any hook name except pre-commit / pre-push (usage + exit 1)", async () => {
		const logError = vi.fn();
		const code = await runHook("commit-msg", "/repo", deps({ logError }));
		expect(code).toBe(1);
		expect(logError.mock.calls.flat().join(" ")).toMatch(
			/pre-commit.*pre-push/,
		);
	});

	it("defaults to the [ci] composition when there is no config", async () => {
		const ciRun = vi.fn(async () => ({ ok: true }));
		const code = await runHook(
			"pre-push",
			"/repo",
			deps({
				loadConfig: async () => null,
				registry: { ci: () => ({ id: "ci", blocking: true, run: ciRun }) },
			}),
		);
		expect(code).toBe(0);
		expect(ciRun).toHaveBeenCalledTimes(1);
	});

	it("exits 1 (fail-closed) when the config fails to load", async () => {
		const logError = vi.fn();
		const code = await runHook(
			"pre-commit",
			"/repo",
			deps({
				loadConfig: async () => {
					throw new Error("Invalid CI config: boom");
				},
				logError,
			}),
		);
		expect(code).toBe(1);
		expect(logError.mock.calls.flat().join(" ")).toMatch(/Invalid CI config/);
	});

	it("fail-fast: a blocking section failure exits non-zero and later sections do not run", async () => {
		const first = vi.fn(async () => ({ ok: false, detail: "leak" }));
		const second = vi.fn(async () => ({ ok: true }));
		const code = await runHook(
			"pre-commit",
			"/repo",
			deps({
				loadConfig: async () =>
					hooksConfig({ preCommit: { secrets: true, ci: true } }),
				registry: {
					secrets: () => ({ id: "secrets", blocking: true, run: first }),
					ci: () => ({ id: "ci", blocking: true, run: second }),
				},
			}),
		);
		expect(code).toBe(1);
		expect(first).toHaveBeenCalledTimes(1);
		expect(second).not.toHaveBeenCalled();
	});

	it("advisory section failure prints and continues (exit 0 if the rest pass)", async () => {
		const advisory = vi.fn(async () => ({ ok: false, detail: "tdd warn" }));
		const ciRun = vi.fn(async () => ({ ok: true }));
		const code = await runHook(
			"pre-push",
			"/repo",
			deps({
				loadConfig: async () =>
					hooksConfig({ prePush: { tdd: "warn", ci: true } }),
				registry: {
					tdd: () => ({ id: "tdd", blocking: false, run: advisory }),
					ci: () => ({ id: "ci", blocking: true, run: ciRun }),
				},
			}),
		);
		expect(code).toBe(0);
		expect(advisory).toHaveBeenCalledTimes(1);
		expect(ciRun).toHaveBeenCalledTimes(1);
	});
});

describe("ci section — runCI in-process with the frozen quick option set", () => {
	it("calls runCI with mode:quick, noDocker, noSecurity, noGhagga and returns ok:true", async () => {
		const runCIImpl = vi.fn(
			async (_opts: Record<string, unknown>, _cb: unknown) => undefined,
		);
		const code = await runHook("pre-push", "/repo", {
			loadConfig: async () => null,
			runCIImpl: runCIImpl as unknown as RunHookDeps["runCIImpl"],
			log: () => {},
			logError: () => {},
		});
		expect(code).toBe(0);
		expect(runCIImpl).toHaveBeenCalledTimes(1);
		const [opts] = runCIImpl.mock.calls[0];
		expect(opts).toMatchObject({
			projectDir: "/repo",
			mode: "quick",
			noDocker: true,
			noSecurity: true,
			noGhagga: true,
		});
	});

	it("maps a runCI throw to a blocking section failure (exit 1)", async () => {
		const runCIImpl = vi.fn(async () => {
			throw new Error("gate failed");
		});
		const code = await runHook("pre-push", "/repo", {
			loadConfig: async () => null,
			runCIImpl: runCIImpl as unknown as RunHookDeps["runCIImpl"],
			log: () => {},
			logError: () => {},
		});
		expect(code).toBe(1);
	});

	it("forwards runCI step feedback to the console (done/error/warning)", async () => {
		const out: string[] = [];
		const runCIImpl = vi.fn(
			async (
				_opts: Record<string, unknown>,
				onStep: (s: {
					id: string;
					label: string;
					status: string;
					detail?: string;
				}) => void,
			) => {
				onStep({ id: "a", label: "Lint", status: "done" });
				onStep({ id: "b", label: "Compile", status: "error", detail: "boom" });
				onStep({ id: "c", label: "Scan", status: "warning" });
				onStep({ id: "d", label: "Detect", status: "running" });
			},
		);
		const code = await runHook("pre-push", "/repo", {
			loadConfig: async () => null,
			runCIImpl: runCIImpl as unknown as RunHookDeps["runCIImpl"],
			log: (m) => out.push(m),
			logError: () => {},
		});
		expect(code).toBe(0);
		const joined = out.join("\n");
		expect(joined).toContain("Lint");
		expect(joined).toContain("Compile");
		expect(joined).toContain("boom");
	});
});

describe("loadHooksConfig — resolve the hooks: section from disk", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "jf-hooks-"));
	});
	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("returns null when there is no config file", async () => {
		expect(await loadHooksConfig(tmpDir)).toBeNull();
	});

	it("returns null when the config has no hooks: section", async () => {
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			"version: 2\nrunners:\n  - name: api\n    stack: go",
		);
		expect(await loadHooksConfig(tmpDir)).toBeNull();
	});

	it("parses the hooks: section when present", async () => {
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			"version: 2\nhooks:\n  pre-commit:\n    secrets: true",
		);
		const hooks = await loadHooksConfig(tmpDir);
		expect(hooks?.preCommit.secrets).toBe(true);
		expect(hooks?.preCommit.ci).toBe(true);
	});

	it("throws (fail-closed) on an invalid config", async () => {
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			"version: 2\nhooks:\n  pre-commit:\n    banana: true",
		);
		await expect(loadHooksConfig(tmpDir)).rejects.toThrow(/Invalid CI config/);
	});
});
