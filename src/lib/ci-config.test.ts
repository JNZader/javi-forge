import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CIConfigError,
	findCIConfig,
	loadCIConfig,
	parseCIConfig,
} from "./ci-config.js";

// =============================================================================
// Fixtures
// =============================================================================

const VALID_CONFIG = `
version: 1
runners:
  - name: frontend
    stack: node
    directory: .
    setup: pnpm install --frozen-lockfile
    lint: pnpm run lint
    build: pnpm run build
    test: pnpm run test
    requires: [node, pnpm]
  - name: backend
    stack: python
    directory: backend
    image: python:3.12-slim
    setup:
      - pip install -r requirements.txt
    lint: ruff check .
    test: pytest
    security: bandit -r .
    requires: [python, ruff, pytest]
`;

// =============================================================================
// parseCIConfig — valid inputs
// =============================================================================

describe("parseCIConfig — valid configs", () => {
	it("parses a full valid mixed-runner config", () => {
		const config = parseCIConfig(VALID_CONFIG);
		expect(config.version).toBe(1);
		expect(config.runners).toHaveLength(2);

		const [frontend, backend] = config.runners;
		expect(frontend?.name).toBe("frontend");
		expect(frontend?.stack).toBe("node");
		expect(frontend?.directory).toBe(".");
		expect(frontend?.lint).toEqual(["pnpm run lint"]);
		expect(frontend?.build).toEqual(["pnpm run build"]);
		expect(frontend?.requires).toEqual(["node", "pnpm"]);

		expect(backend?.name).toBe("backend");
		expect(backend?.stack).toBe("python");
		expect(backend?.directory).toBe("backend");
		expect(backend?.image).toBe("python:3.12-slim");
		expect(backend?.security).toEqual(["bandit -r ."]);
	});

	it("normalizes a single string command into a one-element list", () => {
		const config = parseCIConfig(VALID_CONFIG);
		expect(config.runners[0]?.setup).toEqual([
			"pnpm install --frozen-lockfile",
		]);
		expect(config.runners[1]?.setup).toEqual([
			"pip install -r requirements.txt",
		]);
	});

	it("applies defaults for optional fields", () => {
		const config = parseCIConfig(`
version: 1
runners:
  - name: only
    stack: go
`);
		const runner = config.runners[0];
		expect(runner?.directory).toBe(".");
		expect(runner?.image).toBeUndefined();
		expect(runner?.buildContext).toBeUndefined();
		expect(runner?.setup).toEqual([]);
		expect(runner?.lint).toEqual([]);
		expect(runner?.build).toEqual([]);
		expect(runner?.test).toEqual([]);
		expect(runner?.security).toEqual([]);
		expect(runner?.requires).toEqual([]);
	});

	it("accepts a build context instead of an image", () => {
		const config = parseCIConfig(`
version: 1
runners:
  - name: custom
    stack: node
    build-context: ./ci/docker
`);
		expect(config.runners[0]?.buildContext).toBe("./ci/docker");
		expect(config.runners[0]?.image).toBeUndefined();
	});
});

// =============================================================================
// parseCIConfig — fail-closed validation
// =============================================================================

describe("parseCIConfig — validation errors (fail closed)", () => {
	const expectError = (yaml: string, match: RegExp) => {
		try {
			parseCIConfig(yaml);
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			expect(e).toBeInstanceOf(CIConfigError);
			expect((e as CIConfigError).message).toMatch(match);
			expect((e as CIConfigError).errors.length).toBeGreaterThan(0);
		}
	};

	it("rejects invalid YAML syntax", () => {
		expectError("version: [unclosed", /yaml/i);
	});

	it("rejects a non-object document", () => {
		expectError("- just\n- a\n- list", /object|mapping/i);
	});

	it("rejects a missing version", () => {
		expectError("runners: []", /version/i);
	});

	it("rejects an unsupported version", () => {
		expectError("version: 2\nrunners: []", /version/i);
	});

	it("rejects a version given as a string", () => {
		expectError('version: "1"\nrunners: []', /version/i);
	});

	it("rejects missing runners", () => {
		expectError("version: 1", /runners/i);
	});

	it("rejects an empty runner list", () => {
		expectError("version: 1\nrunners: []", /runners/i);
	});

	it("rejects a runner without name", () => {
		expectError("version: 1\nrunners:\n  - stack: node", /name/i);
	});

	it("rejects a runner without stack", () => {
		expectError("version: 1\nrunners:\n  - name: x", /stack/i);
	});

	it("rejects an unknown stack", () => {
		expectError(
			"version: 1\nrunners:\n  - name: x\n    stack: cobol",
			/stack/i,
		);
	});

	it("rejects unknown top-level fields", () => {
		expectError(
			"version: 1\nsurprise: true\nrunners:\n  - name: x\n    stack: node",
			/unknown.*surprise|surprise/i,
		);
	});

	it("rejects unknown runner fields", () => {
		expectError(
			"version: 1\nrunners:\n  - name: x\n    stack: node\n    lints: oops",
			/unknown.*lints|lints/i,
		);
	});

	it("rejects a directory that escapes the project root", () => {
		expectError(
			"version: 1\nrunners:\n  - name: x\n    stack: node\n    directory: ../../etc",
			/directory/i,
		);
	});

	it("rejects an absolute directory", () => {
		expectError(
			"version: 1\nrunners:\n  - name: x\n    stack: node\n    directory: /etc",
			/directory/i,
		);
	});

	it("rejects image and build-context set together", () => {
		expectError(
			"version: 1\nrunners:\n  - name: x\n    stack: node\n    image: node:22\n    build-context: ./ci",
			/image.*build|build.*image/i,
		);
	});

	it("rejects non-string commands", () => {
		expectError(
			"version: 1\nrunners:\n  - name: x\n    stack: node\n    lint: 42",
			/lint/i,
		);
	});

	it("rejects non-string entries in command lists", () => {
		expectError(
			"version: 1\nrunners:\n  - name: x\n    stack: node\n    setup: [ok, 42]",
			/setup/i,
		);
	});

	it("rejects duplicate runner names", () => {
		expectError(
			"version: 1\nrunners:\n  - name: x\n    stack: node\n  - name: x\n    stack: python",
			/duplicate|name/i,
		);
	});

	it("rejects runner names that are not docker-tag safe", () => {
		expectError(
			"version: 1\nrunners:\n  - name: bad name!\n    stack: node",
			/name/i,
		);
	});

	it("rejects requires entries with shell-unsafe characters", () => {
		expectError(
			'version: 1\nrunners:\n  - name: x\n    stack: node\n    requires: ["rm -rf /"]',
			/requires/i,
		);
	});

	it("collects multiple errors in one report", () => {
		try {
			parseCIConfig("runners:\n  - directory: /abs");
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			expect(e).toBeInstanceOf(CIConfigError);
			expect((e as CIConfigError).errors.length).toBeGreaterThanOrEqual(3);
		}
	});
});

// =============================================================================
// loadCIConfig / findCIConfig — filesystem
// =============================================================================

describe("loadCIConfig / findCIConfig", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-ciconfig-"));
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("loads and validates a config file from disk", async () => {
		const configPath = path.join(tmpDir, "ci.yaml");
		await fs.writeFile(configPath, VALID_CONFIG);
		const config = await loadCIConfig(configPath);
		expect(config.runners).toHaveLength(2);
	});

	it("fails closed with an explicit error when the file does not exist", async () => {
		await expect(
			loadCIConfig(path.join(tmpDir, "missing.yaml")),
		).rejects.toThrow(/not found|does not exist/i);
	});

	it("wraps validation errors with the config path", async () => {
		const configPath = path.join(tmpDir, "ci.yaml");
		await fs.writeFile(configPath, "version: 9\nrunners: []");
		await expect(loadCIConfig(configPath)).rejects.toThrow(/ci\.yaml/);
	});

	it("findCIConfig discovers .javi-forge/ci.yaml", async () => {
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeFile(
			path.join(tmpDir, ".javi-forge", "ci.yaml"),
			VALID_CONFIG,
		);
		const found = await findCIConfig(tmpDir);
		expect(found).toBe(path.join(tmpDir, ".javi-forge", "ci.yaml"));
	});

	it("findCIConfig discovers .javi-forge/ci.yml", async () => {
		await fs.ensureDir(path.join(tmpDir, ".javi-forge"));
		await fs.writeFile(
			path.join(tmpDir, ".javi-forge", "ci.yml"),
			VALID_CONFIG,
		);
		const found = await findCIConfig(tmpDir);
		expect(found).toBe(path.join(tmpDir, ".javi-forge", "ci.yml"));
	});

	it("findCIConfig returns null when no config exists", async () => {
		expect(await findCIConfig(tmpDir)).toBeNull();
	});
});
