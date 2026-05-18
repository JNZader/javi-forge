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

// Default execFile behaviour: every tool "exists" and reports v1.0.0. Tests
// that need a tool to be missing override the implementation per-case.
function execFileAllPresent() {
	mockedExecFile.mockImplementation(
		(_cmd: unknown, _args: unknown, cb: unknown) => {
			const cmd = String(_cmd);
			if (cmd === "which" || cmd === "command") {
				if (typeof cb === "function")
					(
						cb as (
							e: Error | null,
							out: { stdout: string; stderr: string },
						) => void
					)(null, { stdout: "/usr/bin/tool", stderr: "" });
			} else {
				if (typeof cb === "function")
					(
						cb as (
							e: Error | null,
							out: { stdout: string; stderr: string },
						) => void
					)(null, { stdout: "v1.0.0", stderr: "" });
			}
			return undefined as unknown as ChildProcess;
		},
	);
}

function execFileMissing(toolName: string) {
	mockedExecFile.mockImplementation(
		(_cmd: unknown, _args: unknown, cb: unknown) => {
			const cmd = String(_cmd);
			const args = _args as string[];
			if ((cmd === "which" || cmd === "command") && args?.includes(toolName)) {
				if (typeof cb === "function")
					(
						cb as (
							e: Error | null,
							out: { stdout: string; stderr: string },
						) => void
					)(new Error("not found"), { stdout: "", stderr: "" });
			} else if (cmd === "which" || cmd === "command") {
				if (typeof cb === "function")
					(
						cb as (
							e: Error | null,
							out: { stdout: string; stderr: string },
						) => void
					)(null, { stdout: "/usr/bin/tool", stderr: "" });
			} else {
				if (typeof cb === "function")
					(
						cb as (
							e: Error | null,
							out: { stdout: string; stderr: string },
						) => void
					)(null, { stdout: "v1.0.0", stderr: "" });
			}
			return undefined as unknown as ChildProcess;
		},
	);
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

	it("shows context refresh ok when .context/ has the expected files", async () => {
		// refreshContextDir reads the existing .context/ and reports an
		// updated status if it can refresh from the manifest. Scaffold the
		// .context/ + manifest so the path is reachable.
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

		const result = await runDoctor(tmpDir);
		const ctxSection = result.sections.find(
			(s) => s.title === "Context Directory",
		)!;
		expect(ctxSection).toBeDefined();
		// Real refresh either updates or leaves files alone; both report ok.
		expect(["ok", "skip"]).toContain(ctxSection.checks[0].status);
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
