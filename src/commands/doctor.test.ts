import type { ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =============================================================================
// Real-fs tests for runDoctor.
//
// The previous version mocked fs-extra, child_process, common.js, plugin.js,
// AND context.js — basically replacing the entire dependency tree. That
// guaranteed the tests verified the orchestrator's branches but never caught
// any real integration drift between the doctor command and the libs it
// inspects. Mock-heavy refactor (M6) drops everything except execFile (we
// can't assume git / docker / node are present in every test env).
//
// Each test scaffolds a real tmpdir, writes the minimum set of marker files
// the doctor expects (package.json, manifest.json, .context/, templates/),
// and calls runDoctor against it. Drop in a stack marker → real detectStack
// runs. Drop in a real manifest → real read. Etc.
// =============================================================================

// Mock execFile only — system tools (git, docker, node) may not be present.
vi.mock("node:child_process", async (importOriginal) => {
	const actual =
		(await importOriginal()) as typeof import("node:child_process");
	return {
		...actual,
		execFile: vi.fn((_cmd: string, _args: string[], cb: unknown) => {
			if (typeof cb === "function")
				(
					cb as (
						e: Error | null,
						out: { stdout: string; stderr: string },
					) => void
				)(null, { stdout: "/usr/bin/tool", stderr: "" });
			return undefined as unknown as ChildProcess;
		}),
	};
});

const { execFile } = await import("node:child_process");
const mockedExecFile = vi.mocked(execFile);

const { runDoctor } = await import("./doctor.js");

// `execFileAsync` is `promisify(execFile)`, which appends the callback as the
// LAST argument — so a call with an options object (e.g.
// `execFile("git", args, { cwd }, cb)`) puts the callback in position 4. These
// helpers locate the callback as the last function argument regardless of arity
// (the S4 Security checks pass `{ cwd }`, unlike the older 3-arg tool probes).
type ExecCb = (
	e: Error | null,
	out: { stdout: string; stderr: string },
) => void;

function lastCallback(args: unknown[]): ExecCb | null {
	const last = args[args.length - 1];
	return typeof last === "function" ? (last as ExecCb) : null;
}

function respond(args: unknown[], e: Error | null, stdout: string) {
	const cb = lastCallback(args);
	if (cb) cb(e, { stdout, stderr: "" });
	return undefined as unknown as ChildProcess;
}

// Default execFile behaviour: every tool "exists" and reports v1.0.0. Tests
// that need a tool to be missing override the implementation per-case.
function execFileAllPresent() {
	mockedExecFile.mockImplementation((...callArgs: unknown[]) => {
		const cmd = String(callArgs[0]);
		if (cmd === "which" || cmd === "command")
			return respond(callArgs, null, "/usr/bin/tool");
		return respond(callArgs, null, "v1.0.0");
	});
}

function execFileMissing(toolName: string) {
	mockedExecFile.mockImplementation((...callArgs: unknown[]) => {
		const cmd = String(callArgs[0]);
		const args = (callArgs[1] as string[]) ?? [];
		if ((cmd === "which" || cmd === "command") && args.includes(toolName))
			return respond(callArgs, new Error("not found"), "");
		if (cmd === "which" || cmd === "command")
			return respond(callArgs, null, "/usr/bin/tool");
		return respond(callArgs, null, "v1.0.0");
	});
}

// ─── tmpdir scaffolding ────────────────────────────────────────────

let tmpDir: string;

// Note: doctor reads "Framework Structure" against the BUNDLED templates
// directory of the javi-forge package itself (TEMPLATES_DIR constant from
// src/constants.ts) — NOT against projectDir/templates/. So we can't fake
// "missing framework" by scaffolding tmpdir; those checks always reflect
// the installed package state. The previous mock-heavy version of the
// test could fake it because it shadowed fs-extra; with real fs we test
// the real behaviour instead.

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-doctor-"));
	mockedExecFile.mockReset();
	execFileAllPresent();
});

afterEach(async () => {
	await fs.remove(tmpDir);
});

// =============================================================================
// runDoctor
// =============================================================================

describe("runDoctor", () => {
	it("reports all tools as ok when execFile reports them present", async () => {
		const result = await runDoctor(tmpDir);
		const toolSection = result.sections.find((s) => s.title === "System Tools");
		expect(toolSection).toBeDefined();
		const allOk = toolSection!.checks.every((c) => c.status === "ok");
		expect(allOk).toBe(true);
	});

	it("reports fail for missing required tool (git)", async () => {
		execFileMissing("git");

		const result = await runDoctor(tmpDir);
		const toolSection = result.sections.find(
			(s) => s.title === "System Tools",
		)!;
		const gitCheck = toolSection.checks.find((c) => c.label === "Git");
		expect(gitCheck!.status).toBe("fail");
	});

	it("reports skip for missing optional tool (docker)", async () => {
		execFileMissing("docker");

		const result = await runDoctor(tmpDir);
		const toolSection = result.sections.find(
			(s) => s.title === "System Tools",
		)!;
		const dockerCheck = toolSection.checks.find((c) => c.label === "Docker");
		expect(dockerCheck!.status).toBe("skip");
	});

	it("shows skip when no .javi-forge/manifest.json present", async () => {
		// Empty tmpDir — no .javi-forge/ at all.
		const result = await runDoctor(tmpDir);
		const manifestSection = result.sections.find(
			(s) => s.title === "Project Manifest",
		)!;
		const manifestCheck = manifestSection.checks.find(
			(c) => c.label === "Forge manifest",
		);
		expect(manifestCheck!.status).toBe("skip");
		expect(manifestCheck!.detail).toContain("not a forge-managed project");
	});

	it("shows manifest details when a real file is present", async () => {
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeJson(path.join(tmpDir, ".javi-forge", "manifest.json"), {
			version: "0.1.0",
			projectName: "test-project",
			stack: "node",
			ciProvider: "github",
			memory: "engram",
			createdAt: "2025-01-15T10:00:00Z",
			updatedAt: "2025-01-15T10:00:00Z",
			modules: ["engram", "ghagga"],
		});

		const result = await runDoctor(tmpDir);
		const manifestSection = result.sections.find(
			(s) => s.title === "Project Manifest",
		)!;
		const manifestCheck = manifestSection.checks.find(
			(c) => c.label === "Forge manifest",
		);
		expect(manifestCheck!.status).toBe("ok");
		expect(manifestCheck!.detail).toContain("test-project");

		const modulesCheck = manifestSection.checks.find(
			(c) => c.label === "Modules",
		);
		expect(modulesCheck!.status).toBe("ok");
		expect(modulesCheck!.detail).toContain("engram");
	});

	it("reports framework structure from the bundled templates/ dir", async () => {
		// templates/ is read from the package-bundled TEMPLATES_DIR constant,
		// not from projectDir. With the package installed we expect "ok".
		const result = await runDoctor(tmpDir);
		const structSection = result.sections.find(
			(s) => s.title === "Framework Structure",
		)!;
		const templatesCheck = structSection.checks.find(
			(c) => c.label === "templates/",
		);
		expect(templatesCheck).toBeDefined();
		expect(templatesCheck!.status).toBe("ok");
		// The bundled templates directory has many real entries (subdirs +
		// files). Just assert the detail says "N entries" without pinning N.
		expect(templatesCheck!.detail).toMatch(/^\d+ entries$/);
	});

	it("shows stack when a real package.json + pnpm-lock.yaml are present", async () => {
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			name: "test",
			scripts: { test: "true" },
		});
		await fs.writeFile(path.join(tmpDir, "pnpm-lock.yaml"), "");

		const result = await runDoctor(tmpDir);
		const stackSection = result.sections.find(
			(s) => s.title === "Stack Detection",
		)!;
		const stackCheck = stackSection.checks[0];
		expect(stackCheck.status).toBe("ok");
		expect(stackCheck.detail).toContain("node");
		expect(stackCheck.detail).toContain("pnpm");
	});

	// "countDir filters dotfiles" was dropped from the refactor: with the
	// real bundled templates/ directory we can't control its contents from
	// a test. The filter behaviour is exercised indirectly by the entry
	// count returned for the bundled dir; a unit test for countDir itself
	// belongs in lib/common.test.ts if we want explicit coverage.

	it("shows context refresh ok when .context/ + manifest are present", async () => {
		// Round-7 review flagged that the original loose assertion
		// (`["ok", "skip"]`) made this test pass even if refresh silently
		// failed. Tighten back to a strict "ok" — when both .context/ and
		// the manifest exist, the doctor MUST report success or there's a
		// real regression.
		await fs.ensureDir(path.join(tmpDir, ".context"));
		await fs.writeFile(
			path.join(tmpDir, ".context", "INDEX.md"),
			"# old content\n",
		);
		await fs.writeFile(path.join(tmpDir, ".context", "summary.md"), "# old\n");
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeJson(path.join(tmpDir, ".javi-forge", "manifest.json"), {
			version: "0.1.0",
			projectName: "test-project",
			stack: "node",
			ciProvider: "github",
			memory: "engram",
			createdAt: "2025-01-15T10:00:00Z",
			updatedAt: "2025-01-15T10:00:00Z",
			modules: [],
		});
		// detectStack needs a stack marker — without it refreshContextDir
		// cannot pick a template and falls through to skip.
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			name: "test-project",
		});

		const result = await runDoctor(tmpDir);
		const ctxSection = result.sections.find(
			(s) => s.title === "Context Directory",
		)!;
		expect(ctxSection).toBeDefined();
		expect(ctxSection.checks[0].status).toBe("ok");
	});

	it("shows context refresh skip when no .context/ exists", async () => {
		// No .context/ scaffolded.
		const result = await runDoctor(tmpDir);
		const ctxSection = result.sections.find(
			(s) => s.title === "Context Directory",
		)!;
		expect(ctxSection.checks[0].status).toBe("skip");
	});
});

// =============================================================================
// Security advisories (hook-consolidation S4)
//
// commit-signing (L4+L6 merged) + branch-protection (L5) are advisories: doctor
// reports, nothing blocks. These tests drive the mocked execFile per-case to
// simulate git config values and gh api responses.
// =============================================================================

/**
 * Route the mocked execFile by (cmd, args). `git config --get <key>` resolves
 * from `gitConfig`; `which <bin>` resolves present/absent from `bins`; `gh api`
 * resolves/rejects from `ghApi`; everything else succeeds with a stub.
 */
function routeExecFile(opts: {
	gitConfig?: Record<string, string>;
	bins?: Record<string, boolean>;
	originHead?: string;
	ghApiOk?: boolean;
}) {
	const gitConfig = opts.gitConfig ?? {};
	const bins = opts.bins ?? {};
	mockedExecFile.mockImplementation((...callArgs: unknown[]) => {
		const cmd = String(callArgs[0]);
		const args = (callArgs[1] as string[]) ?? [];
		if (cmd === "which" || cmd === "command") {
			const bin = args[args.length - 1];
			return respond(
				callArgs,
				bins[bin] === false ? new Error("not found") : null,
				"/usr/bin/x",
			);
		}
		if (cmd === "git" && args[0] === "config") {
			const key = args[args.length - 1];
			const val = gitConfig[key];
			return val === undefined
				? respond(callArgs, new Error("unset"), "")
				: respond(callArgs, null, val);
		}
		if (cmd === "git" && args[0] === "symbolic-ref") {
			return respond(
				callArgs,
				opts.originHead ? null : new Error("no head"),
				opts.originHead ?? "",
			);
		}
		if (cmd === "gh" && args[0] === "api") {
			return respond(
				callArgs,
				opts.ghApiOk ? null : new Error("HTTP 404"),
				"{}",
			);
		}
		return respond(callArgs, null, "v1.0.0");
	});
}

describe("runDoctor — Security advisories", () => {
	it("commit-signing: ok when gpgsign=true AND signingkey set", async () => {
		routeExecFile({
			gitConfig: {
				"commit.gpgsign": "true",
				"user.signingkey": "ABC123",
				"remote.origin.url": "",
			},
		});
		const result = await runDoctor(tmpDir);
		const sec = result.sections.find((s) => s.title === "Security")!;
		const signing = sec.checks.find((c) => c.label === "Commit signing")!;
		expect(signing.status).toBe("ok");
		expect(signing.detail).toContain("enabled");
	});

	it("commit-signing: skip (advisory) when not configured, detail carries the snippet", async () => {
		routeExecFile({ gitConfig: {} });
		const result = await runDoctor(tmpDir);
		const sec = result.sections.find((s) => s.title === "Security")!;
		const signing = sec.checks.find((c) => c.label === "Commit signing")!;
		expect(signing.status).toBe("skip");
		expect(signing.detail).toContain("commit.gpgsign true");
	});

	it("commit-signing: skip when gpgsign true but signingkey missing", async () => {
		routeExecFile({ gitConfig: { "commit.gpgsign": "true" } });
		const result = await runDoctor(tmpDir);
		const sec = result.sections.find((s) => s.title === "Security")!;
		const signing = sec.checks.find((c) => c.label === "Commit signing")!;
		expect(signing.status).toBe("skip");
	});

	it("branch-protection: ok when gh + GitHub origin + protection API succeeds", async () => {
		routeExecFile({
			gitConfig: {
				"remote.origin.url": "git@github.com:acme/widgets.git",
			},
			bins: { gh: true },
			originHead: "origin/main",
			ghApiOk: true,
		});
		const result = await runDoctor(tmpDir);
		const sec = result.sections.find((s) => s.title === "Security")!;
		const bp = sec.checks.find((c) => c.label === "Branch protection")!;
		expect(bp.status).toBe("ok");
		expect(bp.detail).toContain("main");
	});

	it("branch-protection: skip (advisory) when GitHub protection API 404s", async () => {
		routeExecFile({
			gitConfig: {
				"remote.origin.url": "https://github.com/acme/widgets.git",
			},
			bins: { gh: true },
			originHead: "origin/main",
			ghApiOk: false,
		});
		const result = await runDoctor(tmpDir);
		const sec = result.sections.find((s) => s.title === "Security")!;
		const bp = sec.checks.find((c) => c.label === "Branch protection")!;
		expect(bp.status).toBe("skip");
		expect(bp.detail).toContain("no server-side branch protection");
	});

	it("branch-protection: skip-with-note for a GitLab origin (no gh probe)", async () => {
		routeExecFile({
			gitConfig: {
				"remote.origin.url": "git@gitlab.com:acme/widgets.git",
			},
			bins: { gh: true },
		});
		const result = await runDoctor(tmpDir);
		const sec = result.sections.find((s) => s.title === "Security")!;
		const bp = sec.checks.find((c) => c.label === "Branch protection")!;
		expect(bp.status).toBe("skip");
		expect(bp.detail).toContain("forge UI");
	});

	it("branch-protection: skip-with-note when gh is not installed", async () => {
		routeExecFile({
			gitConfig: {
				"remote.origin.url": "git@github.com:acme/widgets.git",
			},
			bins: { gh: false },
		});
		const result = await runDoctor(tmpDir);
		const sec = result.sections.find((s) => s.title === "Security")!;
		const bp = sec.checks.find((c) => c.label === "Branch protection")!;
		expect(bp.status).toBe("skip");
		expect(bp.detail).toContain("forge UI");
	});
});

describe("runDoctor unsupported-platform dependency boundary", () => {
	it.each([
		"darwin",
		"darwin-arm64",
		"freebsd",
		"unknown",
	])("returns a minimal refusal before cwd or semantic effects on %s", async (platform) => {
		const originalCwd = process.cwd();
		const before = new Map<string, Buffer>();
		const snapshot = async (root: string) => {
			for (const relative of [
				".context/INDEX.md",
				".context/nested/data.txt",
				".javi-forge/manifest.json",
			]) {
				before.set(relative, await fs.readFile(path.join(root, relative)));
			}
		};
		await fs.ensureDir(path.join(tmpDir, ".context", "nested"));
		await fs.writeFile(
			path.join(tmpDir, ".context", "INDEX.md"),
			"raw-index\\n",
		);
		await fs.writeFile(
			path.join(tmpDir, ".context", "nested", "data.txt"),
			Buffer.from([0, 255, 1]),
		);
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeFile(
			path.join(tmpDir, ".javi-forge", "manifest.json"),
			"{ updatedAt: before }\n",
		);
		await snapshot(tmpDir);
		const fail = vi.fn(() => {
			throw new Error("unsupported doctor invoked an effect");
		});
		process.chdir(tmpDir);
		try {
			const result = await runDoctor(undefined, {
				platform,
				cwd: fail,
				filesystem: fail,
				exec: fail,
				stackDetector: fail,
				pluginLister: fail,
				contextRefresher: fail,
			} as never);
			expect(result).toEqual({
				state: "unsupported-platform",
				guidance: "javi-forge supports Linux and Windows only.",
				sections: [],
			});
			expect(fail).not.toHaveBeenCalled();
			for (const [relative, bytes] of before)
				expect(await fs.readFile(path.join(tmpDir, relative))).toEqual(bytes);
		} finally {
			process.chdir(originalCwd);
		}
	});

	it.each([
		"linux",
		"win32",
	])("reads cwd only after supported classification on %s", async (platform) => {
		const cwd = vi.fn(() => tmpDir);
		await runDoctor(undefined, { platform, cwd } as never);
		expect(cwd).toHaveBeenCalledOnce();
	});
});
