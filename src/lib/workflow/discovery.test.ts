import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs-extra", () => {
	const mockFs = {
		pathExists: vi.fn(),
		readFile: vi.fn(),
		readdir: vi.fn(),
		copy: vi.fn(),
		ensureDir: vi.fn(),
	};
	return { default: mockFs, ...mockFs };
});

import fs from "fs-extra";
import {
	discoverWorkflows,
	listBuiltinTemplates,
	loadBuiltinTemplate,
} from "./discovery.js";

const mockedFs = vi.mocked(fs);

beforeEach(() => {
	vi.resetAllMocks();
});

describe("discoverWorkflows", () => {
	it("returns empty array when workflow dir does not exist", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const result = await discoverWorkflows("/test/project");
		expect(result).toEqual([]);
	});

	it("discovers .dot and .mermaid files", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue([
			"deploy.dot",
			"review.mermaid",
			"notes.txt",
		] as never);

		const result = await discoverWorkflows("/test/project");
		expect(result).toHaveLength(2);
		expect(result[0]?.name).toBe("deploy");
		expect(result[0]?.format).toBe("dot");
		expect(result[1]?.name).toBe("review");
		expect(result[1]?.format).toBe("mermaid");
	});

	it("ignores non-workflow files", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue(["README.md", "config.json"] as never);

		const result = await discoverWorkflows("/test/project");
		expect(result).toEqual([]);
	});
});

describe("listBuiltinTemplates", () => {
	it("returns empty when templates dir does not exist", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const result = await listBuiltinTemplates();
		expect(result).toEqual([]);
	});

	it("lists .dot templates", async () => {
		mockedFs.pathExists.mockResolvedValue(true as never);
		mockedFs.readdir.mockResolvedValue([
			"ci-pipeline.dot",
			"release.dot",
		] as never);

		const result = await listBuiltinTemplates();
		expect(result).toHaveLength(2);
		expect(result[0]?.name).toBe("ci-pipeline");
		expect(result[1]?.name).toBe("release");
	});
});

describe("loadBuiltinTemplate", () => {
	it("returns null when template does not exist", async () => {
		mockedFs.pathExists.mockResolvedValue(false as never);
		const result = await loadBuiltinTemplate("nonexistent");
		expect(result).toBeNull();
	});

	it("loads a .dot template", async () => {
		mockedFs.pathExists.mockImplementation(async (p: unknown) => {
			const s = String(p);
			if (s.endsWith(".dot")) return true as never;
			return false as never;
		});
		mockedFs.readFile.mockResolvedValue("digraph { A -> B }" as never);

		const result = await loadBuiltinTemplate("ci-pipeline");
		expect(result).not.toBeNull();
		expect(result?.format).toBe("dot");
		expect(result?.content).toContain("digraph");
	});
});
