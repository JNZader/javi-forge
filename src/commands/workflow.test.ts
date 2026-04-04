import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readFile: vi.fn(),
		readdir: vi.fn(),
		readJson: vi.fn(),
		copy: vi.fn(),
		ensureDir: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

vi.mock("../lib/workflow/index.js", () => ({
	parseDot: vi.fn(),
	parseMermaid: vi.fn(),
	renderAscii: vi.fn(),
	validateWorkflow: vi.fn(),
	discoverWorkflows: vi.fn(),
	listBuiltinTemplates: vi.fn(),
	loadBuiltinTemplate: vi.fn(),
	getAvailableChecks: vi.fn(),
}));

import fs from "fs-extra";
import {
	discoverWorkflows,
	getAvailableChecks,
	listBuiltinTemplates,
	loadBuiltinTemplate,
	parseDot,
	parseMermaid,
	renderAscii,
	validateWorkflow,
} from "../lib/workflow/index.js";
import type { InitStep, WorkflowGraph } from "../types/index.js";
import {
	runWorkflowList,
	runWorkflowShow,
	runWorkflowValidate,
} from "./workflow.js";

const mockedFs = vi.mocked(fs);
const mockedParseDot = vi.mocked(parseDot);
const mockedParseMermaid = vi.mocked(parseMermaid);
const mockedRenderAscii = vi.mocked(renderAscii);
const mockedValidateWorkflow = vi.mocked(validateWorkflow);
const mockedDiscoverWorkflows = vi.mocked(discoverWorkflows);
const mockedListBuiltinTemplates = vi.mocked(listBuiltinTemplates);
const mockedLoadBuiltinTemplate = vi.mocked(loadBuiltinTemplate);
const mockedGetAvailableChecks = vi.mocked(getAvailableChecks);

const steps: InitStep[] = [];
const onStep = (step: InitStep) => {
	steps.push(step);
};

const sampleGraph: WorkflowGraph = {
	name: "test",
	nodes: [
		{ id: "lint", label: "Lint" },
		{ id: "test", label: "Test" },
	],
	edges: [{ from: "lint", to: "test" }],
	format: "dot",
};

beforeEach(() => {
	vi.resetAllMocks();
	steps.length = 0;
	mockedRenderAscii.mockReturnValue("[Lint] -> [Test]");
	mockedGetAvailableChecks.mockReturnValue(["has-linter", "has-tests"]);
});

describe("runWorkflowShow", () => {
	it("shows a built-in template", async () => {
		mockedLoadBuiltinTemplate.mockResolvedValue({
			content: "digraph { A -> B }",
			format: "dot",
		});
		mockedParseDot.mockReturnValue(sampleGraph);

		const result = await runWorkflowShow("/test", onStep, {
			template: "ci-pipeline",
		});
		expect(result).toBe("[Lint] -> [Test]");
		expect(mockedLoadBuiltinTemplate).toHaveBeenCalledWith("ci-pipeline");
	});

	it("shows a file by path", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readFile.mockResolvedValue("digraph { A -> B }" as never);
		mockedParseDot.mockReturnValue(sampleGraph);

		const result = await runWorkflowShow("/test", onStep, {
			target: "/test/pipeline.dot",
		});
		expect(result).toBe("[Lint] -> [Test]");
	});

	it("auto-discovers workflows", async () => {
		mockedDiscoverWorkflows.mockResolvedValue([
			{
				name: "deploy",
				path: "/test/.javi-forge/workflows/deploy.dot",
				format: "dot",
			},
		]);
		mockedFs.readFile.mockResolvedValue("digraph { A -> B }" as never);
		mockedParseDot.mockReturnValue(sampleGraph);

		const result = await runWorkflowShow("/test", onStep, {});
		expect(result).toBe("[Lint] -> [Test]");
	});

	it("returns null when template not found", async () => {
		mockedLoadBuiltinTemplate.mockResolvedValue(null);
		const result = await runWorkflowShow("/test", onStep, {
			template: "nonexistent",
		});
		expect(result).toBeNull();
	});

	it("returns null when no workflows found", async () => {
		mockedDiscoverWorkflows.mockResolvedValue([]);
		const result = await runWorkflowShow("/test", onStep, {});
		expect(result).toBeNull();
	});
});

describe("runWorkflowValidate", () => {
	it("validates and renders with results", async () => {
		mockedLoadBuiltinTemplate.mockResolvedValue({
			content: "digraph { A -> B }",
			format: "dot",
		});
		mockedParseDot.mockReturnValue(sampleGraph);
		mockedValidateWorkflow.mockResolvedValue([
			{ node: "lint", status: "pass", detail: "OK" },
			{ node: "test", status: "fail", detail: "Missing" },
		]);

		const result = await runWorkflowValidate("/test", onStep, {
			template: "ci-pipeline",
		});
		expect(result).toBe("[Lint] -> [Test]");
		expect(mockedValidateWorkflow).toHaveBeenCalledWith(sampleGraph, "/test");
		expect(mockedRenderAscii).toHaveBeenCalledWith(
			sampleGraph,
			expect.any(Array),
		);
	});
});

describe("runWorkflowList", () => {
	it("lists project and built-in workflows", async () => {
		mockedDiscoverWorkflows.mockResolvedValue([
			{ name: "deploy", path: "/test/deploy.dot", format: "dot" },
		]);
		mockedListBuiltinTemplates.mockResolvedValue([
			{ name: "ci-pipeline", path: "/tpl/ci-pipeline.dot", format: "dot" },
		]);

		const result = await runWorkflowList("/test", onStep);
		expect(result).toContain("deploy");
		expect(result).toContain("ci-pipeline");
		expect(result).toContain("has-linter");
	});

	it("shows message when no project workflows", async () => {
		mockedDiscoverWorkflows.mockResolvedValue([]);
		mockedListBuiltinTemplates.mockResolvedValue([]);

		const result = await runWorkflowList("/test", onStep);
		expect(result).toContain("No project workflows found");
	});
});
