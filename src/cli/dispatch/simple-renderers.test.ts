import { render } from "ink";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleDoctor, handlePlugin } from "./simple-renderers.js";
import type { CLI } from "./types.js";

vi.mock("ink", () => ({ render: vi.fn() }));
vi.mock("../../ui/CIContext.js", () => ({ CIProvider: "CIProvider" }));
vi.mock("../../ui/Doctor.js", () => ({ default: "Doctor" }));
vi.mock("../../ui/AnalyzeUI.js", () => ({ default: "AnalyzeUI" }));
vi.mock("../../ui/App.js", () => ({ default: "App" }));
vi.mock("../../ui/LlmsTxt.js", () => ({ default: "LlmsTxt" }));
vi.mock("../../ui/Plugin.js", () => ({ default: "Plugin" }));
vi.mock("./plugin.js", () => ({ default: "PluginController" }));

beforeEach(() => vi.clearAllMocks());

describe("doctor flags", () => {
	it.each([
		false,
		true,
	])("forwards explicit refresh and dry-run flags (dryRun=%s)", (dryRun) => {
		handleDoctor(
			{
				input: ["doctor"],
				flags: { dryRun, refreshContext: true },
			} as unknown as CLI,
			{
				isCI: true,
				inkStdin: process.stdin,
			},
		);
		const tree = vi.mocked(render).mock.calls[0][0] as ReactElement<{
			children: ReactElement;
		}>;
		expect(tree.props.children.type).toBe("Doctor");
		expect(tree.props.children.props).toEqual({ dryRun, refreshContext: true });
	});
});

describe("plugin dispatch", () => {
	it.each([
		undefined,
		"list",
		"unknown",
	])("preserves raw action %s and all request flags", (action) => {
		handlePlugin(
			{
				input: ["plugin", action, "target"],
				flags: { dryRun: true, force: true, codex: true },
			} as unknown as CLI,
			{ isCI: true, inkStdin: process.stdin },
		);
		const tree = vi.mocked(render).mock.calls[0][0] as ReactElement<{
			children: ReactElement;
		}>;
		expect(tree.props.children.type).toBe("PluginController");
		expect(tree.props.children.props).toEqual({
			request: {
				action,
				target: "target",
				dryRun: true,
				force: true,
				codex: true,
				projectDir: process.cwd(),
			},
		});
	});
});
