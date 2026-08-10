import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CIConfigError,
	type CIConfigValidationError,
	findCIConfig,
	loadCIConfig,
	parseCIConfig,
	validateGates,
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

	it("stores a whitespace-padded runner image trimmed (IMG-1)", () => {
		const config = parseCIConfig(
			'version: 1\nrunners:\n  - name: x\n    stack: node\n    image: "  python:3.12-slim  "',
		);
		expect(config.runners[0]?.image).toBe("python:3.12-slim");
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
		// version 2 is now a supported, additive schema (see the gates suite below);
		// a genuinely out-of-set version (3) is the one that must still fail closed.
		expectError(
			"version: 3\nrunners:\n  - name: x\n    stack: node",
			/version/i,
		);
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

	it("rejects a runner image starting with a dash (docker-flag injection, IMG-1)", () => {
		expectError(
			"version: 1\nrunners:\n  - name: x\n    stack: node\n    image: --privileged",
			/docker flag|start with '-'/,
		);
	});

	it("rejects a runner image that is leading-dash after trimming whitespace", () => {
		expectError(
			'version: 1\nrunners:\n  - name: x\n    stack: node\n    image: "  -v /:/host"',
			/docker flag|start with '-'/,
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
// parseCIConfig — version:2 negotiation (additive, fail-closed preserved)
// =============================================================================

describe("parseCIConfig — version negotiation {1,2}", () => {
	const expectError = (yaml: string, match: RegExp) => {
		try {
			parseCIConfig(yaml);
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			expect(e).toBeInstanceOf(CIConfigError);
			expect((e as CIConfigError).message).toMatch(match);
		}
	};

	it("parses a version 1 config byte-identically (regression, no gate machinery)", () => {
		const config = parseCIConfig(VALID_CONFIG);
		expect(config.version).toBe(1);
		expect(config.runners).toHaveLength(2);
		// A v1 config must carry NO gates key — the shape is identical to today.
		expect("gates" in config).toBe(false);
		expect(config.gates).toBeUndefined();
	});

	it("accepts version 2 with runners and no gates", () => {
		const config = parseCIConfig(
			"version: 2\nrunners:\n  - name: api\n    stack: go",
		);
		expect(config.version).toBe(2);
		expect(config.runners).toHaveLength(1);
	});

	it("rejects a version 1 config that declares gates with a named error", () => {
		expectError(
			"version: 1\nrunners:\n  - name: api\n    stack: go\ngates:\n  - id: lint\n    run: echo hi",
			/gates require version: 2/,
		);
	});

	it("surfaces 'gates require version: 2' BEFORE a generic unknown-field error", () => {
		try {
			parseCIConfig(
				"version: 1\nrunners:\n  - name: api\n    stack: go\ngates:\n  - id: lint\n    run: echo hi",
			);
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			const err = e as CIConfigError;
			const gatesErr = err.errors.find((x) => x.path === "gates");
			expect(gatesErr?.message).toBe("gates require version: 2");
			// It must NOT be reported as a generic unknown field.
			expect(gatesErr?.message).not.toMatch(/unknown field/);
		}
	});

	it("rejects a version 2 config with NEITHER runners nor gates (fail closed)", () => {
		expectError("version: 2", /runners or gates/i);
	});

	it("rejects an unknown top-level key under version 2 (fail closed)", () => {
		expectError(
			"version: 2\nsurprise: true\ngates:\n  - id: lint\n    run: echo hi",
			/unknown.*surprise|surprise/i,
		);
	});
});

// =============================================================================
// parseCIConfig — gates block schema (version 2)
// =============================================================================

describe("parseCIConfig — gates schema", () => {
	const V2 = (gatesYaml: string): string => `version: 2\n${gatesYaml}`;

	const expectError = (yaml: string, match: RegExp) => {
		try {
			parseCIConfig(yaml);
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			expect(e).toBeInstanceOf(CIConfigError);
			expect((e as CIConfigError).message).toMatch(match);
		}
	};

	it("accepts a gates-only config and defaults mode=blocking, scope=all", () => {
		const config = parseCIConfig(
			V2("gates:\n  - id: coverage\n    run: echo cover"),
		);
		expect(config.runners).toHaveLength(0);
		expect(config.gates).toHaveLength(1);
		const gate = config.gates?.[0];
		expect(gate?.id).toBe("coverage");
		expect(gate?.run).toEqual(["echo cover"]);
		expect(gate?.mode).toBe("blocking");
		expect(gate?.scope).toBe("all");
		expect(gate?.baseline).toBeUndefined();
		expect(gate?.env).toBeUndefined();
	});

	it("normalizes a list `run` and reads mode/scope/baseline/env", () => {
		const config = parseCIConfig(
			V2(
				[
					"gates:",
					"  - id: audit",
					"    run:",
					"      - echo one",
					"      - echo two",
					"    mode: informative",
					"    scope: changed",
					"    baseline: .baseline/audit.json",
					"    env:",
					"      FOO: bar",
				].join("\n"),
			),
		);
		const gate = config.gates?.[0];
		expect(gate?.run).toEqual(["echo one", "echo two"]);
		expect(gate?.mode).toBe("informative");
		expect(gate?.scope).toBe("changed");
		expect(gate?.baseline).toBe(".baseline/audit.json");
		expect(gate?.env).toEqual({ FOO: "bar" });
	});

	it("rejects a duplicate gate id with a named error", () => {
		try {
			parseCIConfig(
				V2(
					"gates:\n  - id: dup\n    run: echo a\n  - id: dup\n    run: echo b",
				),
			);
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			const err = e as CIConfigError;
			expect(
				err.errors.some((x) => /duplicate gate id "dup"/.test(x.message)),
			).toBe(true);
		}
	});

	it("rejects an invalid mode naming the field and value", () => {
		try {
			parseCIConfig(V2("gates:\n  - id: g\n    run: echo a\n    mode: warn"));
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			const err = e as CIConfigError;
			const modeErr = err.errors.find((x) => x.path === "gates[0].mode");
			expect(modeErr?.message).toMatch(/blocking, informative/);
			expect(modeErr?.message).toContain("warn");
		}
	});

	it("rejects an invalid scope naming the field and value", () => {
		try {
			parseCIConfig(
				V2("gates:\n  - id: g\n    run: echo a\n    scope: staged"),
			);
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			const err = e as CIConfigError;
			const scopeErr = err.errors.find((x) => x.path === "gates[0].scope");
			expect(scopeErr?.message).toMatch(/all, changed/);
			expect(scopeErr?.message).toContain("staged");
		}
	});

	it("rejects a tag-unsafe gate id", () => {
		expectError(
			V2("gates:\n  - id: bad id!\n    run: echo a"),
			/gates\[0\]\.id/,
		);
	});

	it("rejects a gate without a run", () => {
		expectError(V2("gates:\n  - id: g"), /gates\[0\]\.run/);
	});

	it("rejects an unknown gate field (fail closed)", () => {
		expectError(
			V2("gates:\n  - id: g\n    run: echo a\n    bogus: 1"),
			/gates\[0\]\.bogus|unknown field "bogus"/,
		);
	});

	it("accepts an optional positive timeout (seconds)", () => {
		const config = parseCIConfig(
			V2("gates:\n  - id: slow\n    run: echo a\n    timeout: 30"),
		);
		expect(config.gates?.[0]?.timeout).toBe(30);
	});

	it("defaults timeout to undefined when omitted (no timeout)", () => {
		const config = parseCIConfig(V2("gates:\n  - id: g\n    run: echo a"));
		expect(config.gates?.[0]?.timeout).toBeUndefined();
	});

	it("rejects timeout: 0 with a named error", () => {
		try {
			parseCIConfig(V2("gates:\n  - id: g\n    run: echo a\n    timeout: 0"));
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			const err = e as CIConfigError;
			const tErr = err.errors.find((x) => x.path === "gates[0].timeout");
			expect(tErr?.message).toMatch(/positive/);
		}
	});

	it("rejects a negative timeout with a named error", () => {
		try {
			parseCIConfig(V2("gates:\n  - id: g\n    run: echo a\n    timeout: -5"));
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			const err = e as CIConfigError;
			const tErr = err.errors.find((x) => x.path === "gates[0].timeout");
			expect(tErr?.message).toMatch(/positive/);
		}
	});

	it("rejects a non-numeric timeout with a named error", () => {
		try {
			parseCIConfig(V2('gates:\n  - id: g\n    run: echo a\n    timeout: "x"'));
			expect.unreachable("expected parseCIConfig to throw");
		} catch (e) {
			const err = e as CIConfigError;
			const tErr = err.errors.find((x) => x.path === "gates[0].timeout");
			expect(tErr?.message).toMatch(/positive/);
		}
	});

	// The `!Number.isFinite` guard rejects Infinity/NaN, which cannot be expressed
	// in YAML source but CAN arrive as a parsed JS number. Construct the gate object
	// directly (post-YAML-parse) to exercise the finite boundary.
	it("rejects timeout: Infinity with a named error (finite boundary)", () => {
		const errors: CIConfigValidationError[] = [];
		validateGates(
			[{ id: "g", run: "echo a", timeout: Number.POSITIVE_INFINITY }],
			errors,
		);
		const tErr = errors.find((x) => x.path === "gates[0].timeout");
		expect(tErr?.message).toMatch(/positive/);
	});

	it("rejects timeout: NaN with a named error (finite boundary)", () => {
		const errors: CIConfigValidationError[] = [];
		validateGates([{ id: "g", run: "echo a", timeout: Number.NaN }], errors);
		const tErr = errors.find((x) => x.path === "gates[0].timeout");
		expect(tErr?.message).toMatch(/positive/);
	});

	// -------------------------------------------------------------------------
	// gate.image (containerized-gates slice 1 — schema only)
	// -------------------------------------------------------------------------

	it("accepts an optional non-empty image and marks the gate containerized", () => {
		const config = parseCIConfig(
			V2(
				"gates:\n  - id: audit\n    run: echo a\n    image: ghcr.io/acme/tool@sha256:abc",
			),
		);
		expect(config.gates?.[0]?.image).toBe("ghcr.io/acme/tool@sha256:abc");
	});

	it("defaults image to undefined when omitted (native gate)", () => {
		const config = parseCIConfig(V2("gates:\n  - id: g\n    run: echo a"));
		expect(config.gates?.[0]?.image).toBeUndefined();
	});

	it("rejects an empty image with a named gates[N].image error", () => {
		const errors: CIConfigValidationError[] = [];
		validateGates([{ id: "g", run: "echo a", image: "   " }], errors);
		const imgErr = errors.find((x) => x.path === "gates[0].image");
		expect(imgErr?.message).toMatch(/non-empty string/);
	});

	it("rejects a non-string image with a named gates[N].image error", () => {
		const errors: CIConfigValidationError[] = [];
		validateGates([{ id: "g", run: "echo a", image: 42 }], errors);
		const imgErr = errors.find((x) => x.path === "gates[0].image");
		expect(imgErr?.message).toMatch(/non-empty string/);
	});

	it("rejects a leading-dash image (docker-flag injection, JDB-004)", () => {
		const errors: CIConfigValidationError[] = [];
		validateGates([{ id: "g", run: "echo a", image: "--privileged" }], errors);
		const imgErr = errors.find((x) => x.path === "gates[0].image");
		expect(imgErr?.message).toMatch(/docker flag|start with '-'/);
	});

	it("rejects a leading-dash image after trimming surrounding whitespace", () => {
		const errors: CIConfigValidationError[] = [];
		validateGates([{ id: "g", run: "echo a", image: "  -v /:/host" }], errors);
		const imgErr = errors.find((x) => x.path === "gates[0].image");
		expect(imgErr?.message).toMatch(/docker flag|start with '-'/);
	});

	it("stores a whitespace-padded gate image trimmed (IMG-1)", () => {
		const config = parseCIConfig(
			V2("gates:\n  - id: audit\n    run: echo a\n    image: '  alpine:3  '"),
		);
		expect(config.gates?.[0]?.image).toBe("alpine:3");
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
