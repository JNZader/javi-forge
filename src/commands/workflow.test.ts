import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { InitStep } from "../types/index.js";
import {
	runWorkflowList,
	runWorkflowShow,
	runWorkflowValidate,
} from "./workflow.js";

// =============================================================================
// Real-fs tests for the workflow commands.
//
// The previous version of this file mocked fs-extra AND every export from
// ../lib/workflow/index.js — meaning the tests verified that the orchestrator
// called the right mocks, NOT that the real parser/renderer/validator agreed
// on the data shape. Mock-heavy refactor (M6 from the audit checklist) drops
// the mocks: each test writes a real DOT file to a tmpdir and lets the real
// workflow library do its work. Catches contract drift between the orchestrator
// and the lib that mock-asserted tests would miss.
// =============================================================================

const DOT_SAMPLE = `digraph ci {
  lint [label="Lint" check="has-linter"]
  test [label="Test" check="has-tests"]
  lint -> test
}
`;

let tmpDir: string;
let steps: InitStep[];
const onStep = (step: InitStep) => {
	steps.push(step);
};

beforeEach(async () => {
	tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-workflow-"));
	steps = [];
});

afterEach(async () => {
	await fs.remove(tmpDir);
});

// =============================================================================
// runWorkflowShow
// =============================================================================

describe("runWorkflowShow", () => {
	it("shows a built-in template by name", async () => {
		// ci-pipeline is shipped under templates/workflows/ci-pipeline.dot.
		const result = await runWorkflowShow(tmpDir, onStep, {
			template: "ci-pipeline",
		});
		expect(result).not.toBeNull();
		// Real renderAscii output uses box-drawing chars + node labels.
		expect(result!.length).toBeGreaterThan(0);
		// The bundled template defines well-known node labels we can pin on.
		expect(result!.toLowerCase()).toMatch(/lint|test|build/);
	});

	it("shows a file by path", async () => {
		const filePath = path.join(tmpDir, "pipeline.dot");
		await fs.writeFile(filePath, DOT_SAMPLE);

		const result = await runWorkflowShow(tmpDir, onStep, {
			target: filePath,
		});
		expect(result).not.toBeNull();
		// Both nodes from the DOT source must appear in the rendered output.
		expect(result).toContain("Lint");
		expect(result).toContain("Test");
	});

	it("auto-discovers workflows from .javi-forge/workflows/", async () => {
		const wfDir = path.join(tmpDir, ".javi-forge", "workflows");
		await fs.ensureDir(wfDir);
		await fs.writeFile(path.join(wfDir, "deploy.dot"), DOT_SAMPLE);

		const result = await runWorkflowShow(tmpDir, onStep, {});
		expect(result).not.toBeNull();
		expect(result).toContain("Lint");
	});

	it("returns null when template not found", async () => {
		const result = await runWorkflowShow(tmpDir, onStep, {
			template: "nonexistent-template",
		});
		expect(result).toBeNull();
	});

	it("returns null when no workflows found (no built-ins, no discovered)", async () => {
		// No target, no template, no .javi-forge/workflows/ → null.
		const result = await runWorkflowShow(tmpDir, onStep, {});
		expect(result).toBeNull();
	});

	it("surfaces parser errors on malformed DOT input", async () => {
		const filePath = path.join(tmpDir, "broken.dot");
		await fs.writeFile(filePath, "not a graph at all { broken syntax");

		// runWorkflowShow propagates WorkflowParseError to the caller so the
		// CLI surface can render it as a user-facing message. This is the
		// real behaviour — the previous mock version of this test had no
		// way to reach this branch.
		await expect(
			runWorkflowShow(tmpDir, onStep, { target: filePath }),
		).rejects.toThrow(/digraph/);
	});
});

// =============================================================================
// runWorkflowValidate
// =============================================================================

describe("runWorkflowValidate", () => {
	it("validates a built-in template against the project", async () => {
		// Empty project: most checks should fail (no linter, no tests).
		const result = await runWorkflowValidate(tmpDir, onStep, {
			template: "ci-pipeline",
		});
		expect(result).not.toBeNull();
		// renderAscii output is a string with the validation status appended.
		expect(typeof result).toBe("string");
		// At least one node is expected to have validation feedback.
		expect(result!.length).toBeGreaterThan(0);
	});

	it("validates a custom DOT workflow with passing checks", async () => {
		// Set up a project that satisfies has-tests: a package.json with a
		// "test" script. Validator will look for that and mark the node OK.
		await fs.writeJson(path.join(tmpDir, "package.json"), {
			scripts: { test: "vitest" },
		});

		const filePath = path.join(tmpDir, "wf.dot");
		await fs.writeFile(filePath, DOT_SAMPLE);

		const result = await runWorkflowValidate(tmpDir, onStep, {
			target: filePath,
		});
		expect(result).not.toBeNull();
		// Done step recorded — the orchestrator emits step events too.
		expect(steps.some((s) => s.status === "done")).toBe(true);
	});

	it("returns null when target not found", async () => {
		const result = await runWorkflowValidate(tmpDir, onStep, {
			target: path.join(tmpDir, "missing.dot"),
		});
		expect(result).toBeNull();
		expect(steps.some((s) => s.status === "error")).toBe(true);
	});
});

// =============================================================================
// runWorkflowList
// =============================================================================

describe("runWorkflowList", () => {
	it("lists project + built-in workflows when both exist", async () => {
		const wfDir = path.join(tmpDir, ".javi-forge", "workflows");
		await fs.ensureDir(wfDir);
		await fs.writeFile(path.join(wfDir, "deploy.dot"), DOT_SAMPLE);

		const result = await runWorkflowList(tmpDir, onStep);
		expect(result).toContain("deploy");
		// At least one built-in template should be discoverable from the
		// templates/workflows directory shipped with the package.
		expect(result.toLowerCase()).toMatch(/ci-pipeline|release|feature-flow/);
	});

	it("shows the empty-project message when no workflows found", async () => {
		// Empty tmpdir, no .javi-forge/workflows/.
		const result = await runWorkflowList(tmpDir, onStep);
		expect(result).toContain("No project workflows found");
	});

	it("includes the list of available checks", async () => {
		const result = await runWorkflowList(tmpDir, onStep);
		// getAvailableChecks returns at least the canonical has-* set.
		expect(result.toLowerCase()).toMatch(/has-/);
	});
});
