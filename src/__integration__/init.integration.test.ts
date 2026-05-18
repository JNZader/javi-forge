import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "yaml";
import { initProject } from "../commands/init.js";
import type { InitOptions } from "../types/index.js";
import {
	cleanupTempDir,
	collectSteps,
	createTempDir,
	fileExists,
	getFileMode,
	readGenerated,
} from "./helpers.js";

// Mock ONLY external commands (git, npx) — NOT filesystem.
//
// The mocked execFile carries a [util.promisify.custom] property so that
// downstream callers using `promisify(execFile)` get our async shim directly
// from Node's promisify itself. The old approach mocked util.promisify and
// dispatched by `fn.name === "execFile" || "mockConstructor"`, which broke
// across Vitest spy-naming changes (round-9 finding). Anchoring on the
// official promisify.custom symbol is the long-term stable contract.
vi.mock("child_process", async () => {
	const actual =
		await vi.importActual<typeof import("child_process")>("child_process");
	// Import promisify INSIDE the factory — vi.mock is hoisted above
	// top-level imports, so we cannot reference a static `_promisify`.
	const util = await vi.importActual<typeof import("node:util")>("node:util");
	const promisifyCustom = util.promisify.custom as unknown as symbol;

	const mockedExecFile = vi.fn(
		(_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
			// Simulate git init / git config success
			if (cb) cb(null, { stdout: "", stderr: "" });
			return { stdout: "", stderr: "" };
		},
	);

	// Attach the promisify-custom symbol so util.promisify(execFile) resolves
	// to this exact async function without touching the util module mock.
	(mockedExecFile as unknown as Record<symbol, unknown>)[promisifyCustom] =
		async (..._args: unknown[]) => ({ stdout: "", stderr: "" });

	return { ...actual, execFile: mockedExecFile };
});

let tmpDir: string;

function makeOptions(overrides: Partial<InitOptions> = {}): InitOptions {
	const projectDir = path.join(tmpDir, overrides.projectName ?? "test-project");
	return {
		projectName: "test-project",
		projectDir,
		stack: "node",
		ciProvider: "github",
		memory: "engram",
		aiSync: false, // skip javi-ai (external) — flip on per-test as needed
		sdd: true,
		ghagga: true,
		mock: false,
		contextDir: true,
		claudeMd: true,
		securityHooks: false,
		// Required by InitOptions; rounding out the defaults so future
		// renames break typecheck instead of slipping through `as Partial`
		// casts in individual tests (round-8 review finding).
		hookProfile: "standard",
		codeGraph: false,
		dockerDeploy: false,
		dockerServiceName: "app",
		localAi: false,
		dryRun: false,
		...overrides,
		// Always override projectDir based on projectName
		...(overrides.projectDir ? {} : { projectDir }),
	};
}

describe("initProject() — integration", () => {
	beforeEach(async () => {
		tmpDir = await createTempDir();
	});

	afterEach(async () => {
		await cleanupTempDir(tmpDir);
	});

	// ── Task 2: Full happy path ─────────────────────────────────────────────

	it("creates all expected files for node+github+engram+ghagga", async () => {
		const opts = makeOptions();
		const { onStep } = collectSteps();

		await initProject(opts, onStep);

		// Core files exist
		expect(
			await fileExists(opts.projectDir, ".github", "workflows", "ci.yml"),
		).toBe(true);
		expect(await fileExists(opts.projectDir, ".github", "dependabot.yml")).toBe(
			true,
		);
		expect(await fileExists(opts.projectDir, ".gitignore")).toBe(true);
		expect(
			await fileExists(opts.projectDir, ".javi-forge", "manifest.json"),
		).toBe(true);
		expect(await fileExists(opts.projectDir, "openspec", "README.md")).toBe(
			true,
		);

		// ci-local structure
		expect(await fileExists(opts.projectDir, "ci-local", "ci-local.sh")).toBe(
			true,
		);
		expect(
			await fileExists(opts.projectDir, "ci-local", "hooks", "pre-commit"),
		).toBe(true);
		expect(
			await fileExists(opts.projectDir, "ci-local", "hooks", "pre-push"),
		).toBe(true);
		expect(
			await fileExists(opts.projectDir, "ci-local", "hooks", "commit-msg"),
		).toBe(true);

		// Modules
		expect(
			await fileExists(
				opts.projectDir,
				".javi-forge",
				"modules",
				"engram",
				"README.md",
			),
		).toBe(true);
		expect(
			await fileExists(
				opts.projectDir,
				".javi-forge",
				"modules",
				"ghagga",
				"README.md",
			),
		).toBe(true);

		// Ghagga workflow
		expect(
			await fileExists(
				opts.projectDir,
				".github",
				"workflows",
				"ghagga-review.yml",
			),
		).toBe(true);
	});

	// ── Task 3: Verify content of generated files ───────────────────────────

	it("CI workflow points to javi-forge reusable workflows", async () => {
		const opts = makeOptions();
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		const ciContent = await readGenerated(
			opts.projectDir,
			".github",
			"workflows",
			"ci.yml",
		);
		expect(ciContent).toContain("JNZader/javi-forge/");
		expect(ciContent).not.toContain("project-starter-framework");
		// Must be valid YAML
		expect(() => yaml.parse(ciContent)).not.toThrow();
	});

	it("dependabot.yml is valid YAML with npm ecosystem for node stack", async () => {
		const opts = makeOptions();
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		const content = await readGenerated(
			opts.projectDir,
			".github",
			"dependabot.yml",
		);
		const parsed = yaml.parse(content);
		expect(parsed.version).toBe(2);
		expect(parsed.updates).toBeInstanceOf(Array);

		const ecosystems = parsed.updates.map(
			(u: Record<string, unknown>) => u["package-ecosystem"],
		);
		expect(ecosystems).toContain("npm");
		expect(ecosystems).toContain("github-actions");
	});

	it("manifest.json has correct structure and values", async () => {
		const opts = makeOptions({ projectName: "my-app", memory: "engram" });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		const raw = await readGenerated(
			opts.projectDir,
			".javi-forge",
			"manifest.json",
		);
		const manifest = JSON.parse(raw);

		expect(manifest.projectName).toBe("my-app");
		expect(manifest.stack).toBe("node");
		expect(manifest.ciProvider).toBe("github");
		expect(manifest.memory).toBe("engram");
		expect(manifest.version).toBe("0.1.0");
		// Timestamps are valid ISO strings
		expect(new Date(manifest.createdAt).toISOString()).toBe(manifest.createdAt);
		expect(new Date(manifest.updatedAt).toISOString()).toBe(manifest.updatedAt);
		// Modules array
		expect(manifest.modules).toContain("engram");
		expect(manifest.modules).toContain("ghagga");
		expect(manifest.modules).toContain("sdd");
	});

	it(".gitignore is non-empty", async () => {
		const opts = makeOptions();
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		const content = await readGenerated(opts.projectDir, ".gitignore");
		expect(content.trim().length).toBeGreaterThan(10);
	});

	// ── Task 5: ci-local self-contained ─────────────────────────────────────

	it("ci-local has bundled lib/common.sh", async () => {
		const opts = makeOptions();
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		// lib/common.sh must exist inside ci-local
		expect(
			await fileExists(opts.projectDir, "ci-local", "lib", "common.sh"),
		).toBe(true);

		// ci-local.sh references local lib first
		const ciLocal = await readGenerated(
			opts.projectDir,
			"ci-local",
			"ci-local.sh",
		);
		expect(ciLocal).toContain("SCRIPT_DIR/lib/common.sh");
	});

	it("hooks are executable (755)", async () => {
		const opts = makeOptions();
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		const preCommitMode = await getFileMode(
			opts.projectDir,
			"ci-local",
			"hooks",
			"pre-commit",
		);
		const prePushMode = await getFileMode(
			opts.projectDir,
			"ci-local",
			"hooks",
			"pre-push",
		);
		const commitMsgMode = await getFileMode(
			opts.projectDir,
			"ci-local",
			"hooks",
			"commit-msg",
		);

		expect(preCommitMode & 0o111).toBeGreaterThan(0); // at least one execute bit
		expect(prePushMode & 0o111).toBeGreaterThan(0);
		expect(commitMsgMode & 0o111).toBeGreaterThan(0);
	});

	it("pre-commit hook uses --no-docker for quick checks", async () => {
		const opts = makeOptions();
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		const preCommit = await readGenerated(
			opts.projectDir,
			"ci-local",
			"hooks",
			"pre-commit",
		);
		expect(preCommit).toContain("--no-docker");
	});

	it("semgrep.yml is present in ci-local", async () => {
		const opts = makeOptions();
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		expect(await fileExists(opts.projectDir, "ci-local", "semgrep.yml")).toBe(
			true,
		);
	});

	// ── Task 6: Module installation ─────────────────────────────────────────

	it("engram: MCP snippet has project name replaced (not __PROJECT_NAME__)", async () => {
		const opts = makeOptions({ projectName: "my-cool-app" });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		expect(await fileExists(opts.projectDir, ".mcp-config-snippet.json")).toBe(
			true,
		);
		const snippet = await readGenerated(
			opts.projectDir,
			".mcp-config-snippet.json",
		);
		const parsed = JSON.parse(snippet);

		expect(parsed.mcpServers.engram.env.ENGRAM_PROJECT).toBe("my-cool-app");
		expect(snippet).not.toContain("__PROJECT_NAME__");
	});

	it("engram: module has install script and README", async () => {
		const opts = makeOptions({ memory: "engram" });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		expect(
			await fileExists(
				opts.projectDir,
				".javi-forge",
				"modules",
				"engram",
				"install-engram.sh",
			),
		).toBe(true);
		expect(
			await fileExists(
				opts.projectDir,
				".javi-forge",
				"modules",
				"engram",
				"README.md",
			),
		).toBe(true);
	});

	it("obsidian-brain: module has .project/Memory structure", async () => {
		const opts = makeOptions({ memory: "obsidian-brain", ghagga: false });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		expect(
			await fileExists(
				opts.projectDir,
				".javi-forge",
				"modules",
				"obsidian-brain",
				"README.md",
			),
		).toBe(true);
		expect(
			await fileExists(
				opts.projectDir,
				".javi-forge",
				"modules",
				"obsidian-brain",
				".project",
				"Memory",
				"DECISIONS.md",
			),
		).toBe(true);
	});

	it("ghagga: workflow is a caller (on: pull_request), not reusable (on: workflow_call)", async () => {
		const opts = makeOptions({ ghagga: true });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		const workflow = await readGenerated(
			opts.projectDir,
			".github",
			"workflows",
			"ghagga-review.yml",
		);
		expect(workflow).toContain("pull_request");
		expect(workflow).not.toContain("workflow_call");
	});

	it("memory=none: no module installed, no MCP snippet", async () => {
		const opts = makeOptions({ memory: "none", ghagga: false });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		expect(await fileExists(opts.projectDir, ".javi-forge", "modules")).toBe(
			false,
		);
		expect(await fileExists(opts.projectDir, ".mcp-config-snippet.json")).toBe(
			false,
		);
	});

	// ── Task 10 (partial): Cross-stack CI content ──────────────────────────

	it("python+github: CI workflow references python reusable", async () => {
		const opts = makeOptions({ stack: "python", projectName: "py-test" });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		const ci = await readGenerated(
			opts.projectDir,
			".github",
			"workflows",
			"ci.yml",
		);
		expect(ci).toContain("reusable-build-python");
	});

	it("go+gitlab: generates .gitlab-ci.yml (not .github)", async () => {
		const opts = makeOptions({
			stack: "go",
			ciProvider: "gitlab",
			projectName: "go-test",
		});
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		expect(await fileExists(opts.projectDir, ".gitlab-ci.yml")).toBe(true);
		expect(
			await fileExists(opts.projectDir, ".github", "workflows", "ci.yml"),
		).toBe(false);

		const ci = await readGenerated(opts.projectDir, ".gitlab-ci.yml");
		expect(ci.toLowerCase()).toContain("golang");
	});

	it("rust+woodpecker: generates .woodpecker.yml", async () => {
		const opts = makeOptions({
			stack: "rust",
			ciProvider: "woodpecker",
			projectName: "rust-test",
		});
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		expect(await fileExists(opts.projectDir, ".woodpecker.yml")).toBe(true);
		const ci = await readGenerated(opts.projectDir, ".woodpecker.yml");
		expect(ci.toLowerCase()).toContain("rust");
	});

	it("dependabot not generated for gitlab/woodpecker providers", async () => {
		const opts = makeOptions({ ciProvider: "gitlab", projectName: "no-dep" });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		expect(await fileExists(opts.projectDir, ".github", "dependabot.yml")).toBe(
			false,
		);
	});

	// ── Dry-run mode ────────────────────────────────────────────────────────

	it("dry-run: no files created", async () => {
		const opts = makeOptions({ dryRun: true, projectName: "dry-test" });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);

		expect(await fileExists(opts.projectDir)).toBe(false);
	});

	// ── Per-flag manifest modules (consolidated from init.test.ts) ──────────
	// These were previously asserted via writeJson mock assertions in
	// init.test.ts. M6 refactor: verify the same contract by reading the
	// real manifest.json off disk after a real init run. The orchestrator's
	// flag → module mapping is still exercised, but now end-to-end.

	async function readManifestModules(projectDir: string): Promise<string[]> {
		const raw = await readGenerated(projectDir, ".javi-forge", "manifest.json");
		return (JSON.parse(raw).modules ?? []) as string[];
	}

	// All optional-flag module names. Each per-flag test asserts:
	//   - the flag's own module IS in the manifest
	//   - the other optional modules are NOT in the manifest
	// This catches cross-flag contamination (round-9 finding): if enabling
	// `aiSync` accidentally also turned on `localAi`, a pure toContain check
	// would pass while the real coupling bug would slip through.
	const OPTIONAL_FLAG_MODULES = [
		"context",
		"claude-md",
		"docker-deploy",
		"security-hooks",
		"code-graph",
		"local-ai",
		"ai-config",
	] as const;
	type OptionalFlagModule = (typeof OPTIONAL_FLAG_MODULES)[number];

	function expectExactlyTheseOptionalModules(
		actual: string[],
		expected: OptionalFlagModule[],
	) {
		const expectedSet = new Set<string>(expected);
		for (const mod of OPTIONAL_FLAG_MODULES) {
			if (expectedSet.has(mod)) {
				expect(actual).toContain(mod);
			} else {
				expect(actual).not.toContain(mod);
			}
		}
	}

	// Base options leave contextDir and claudeMd true and the rest false.
	// Each test enables ONE extra optional flag and asserts the manifest
	// matches the base set + that one addition.
	const BASE_OPTIONAL_MODULES: OptionalFlagModule[] = ["context", "claude-md"];

	it("manifest includes 'context' when contextDir is true", async () => {
		const opts = makeOptions({ projectName: "context-on", contextDir: true });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);
		expectExactlyTheseOptionalModules(
			await readManifestModules(opts.projectDir),
			BASE_OPTIONAL_MODULES,
		);
	});

	it("manifest includes 'claude-md' when claudeMd is true", async () => {
		const opts = makeOptions({ projectName: "claude-on", claudeMd: true });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);
		expectExactlyTheseOptionalModules(
			await readManifestModules(opts.projectDir),
			BASE_OPTIONAL_MODULES,
		);
	});

	it("manifest includes 'docker-deploy' when dockerDeploy is true", async () => {
		const opts = makeOptions({ projectName: "docker-on", dockerDeploy: true });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);
		expectExactlyTheseOptionalModules(
			await readManifestModules(opts.projectDir),
			[...BASE_OPTIONAL_MODULES, "docker-deploy"],
		);
	});

	it("manifest includes 'security-hooks' when securityHooks is true", async () => {
		const opts = makeOptions({ projectName: "sec-on", securityHooks: true });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);
		expectExactlyTheseOptionalModules(
			await readManifestModules(opts.projectDir),
			[...BASE_OPTIONAL_MODULES, "security-hooks"],
		);
	});

	it("manifest includes 'code-graph' when codeGraph is true", async () => {
		const opts = makeOptions({ projectName: "graph-on", codeGraph: true });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);
		expectExactlyTheseOptionalModules(
			await readManifestModules(opts.projectDir),
			[...BASE_OPTIONAL_MODULES, "code-graph"],
		);
	});

	it("manifest includes 'local-ai' when localAi is true", async () => {
		const opts = makeOptions({ projectName: "ai-on", localAi: true });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);
		expectExactlyTheseOptionalModules(
			await readManifestModules(opts.projectDir),
			[...BASE_OPTIONAL_MODULES, "local-ai"],
		);
	});

	it("manifest includes 'ai-config' when aiSync is true (closes round-8 HIGH gap)", async () => {
		// The dropped "writes manifest with correct structure" unit test was
		// the ONLY assertion that aiSync=true → "ai-config" in modules. The
		// other 6 per-flag integration tests inherit aiSync:false from the
		// base makeOptions, so without this case the ai-config code path
		// (init.ts:1076 `aiSync ? ["ai-config"] : []`) is untested.
		//
		// The aiSync step shells out to javi-ai which is external; we cannot
		// install it inside the test runner. The execFile mock at the top of
		// this file no-ops external calls, so the step "succeeds" enough for
		// the manifest write to land. We assert ONLY on the manifest
		// contents — the actual javi-ai sync is out of scope here.
		const opts = makeOptions({ projectName: "ai-config-on", aiSync: true });
		const { onStep } = collectSteps();
		await initProject(opts, onStep);
		expectExactlyTheseOptionalModules(
			await readManifestModules(opts.projectDir),
			[...BASE_OPTIONAL_MODULES, "ai-config"],
		);
	});
});
