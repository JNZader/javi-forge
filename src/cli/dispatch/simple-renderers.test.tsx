import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ink", () => ({ render: vi.fn() }));
vi.mock("./doctor.js", () => ({ default: "DoctorController" }));
vi.mock("./plugin.js", () => ({ default: "PluginController" }));

import { render } from "ink";
import type { ReactElement } from "react";
import {
	handleDoctor,
	handleInitDefault,
	handlePlugin,
} from "./simple-renderers.js";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("handleInitDefault", () => {
	it("refuses Darwin without rendering Ink", () => {
		const original = process.platform;
		Object.defineProperty(process, "platform", {
			value: "darwin",
			configurable: true,
		});
		const oldExitCode = process.exitCode;
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			handleInitDefault(
				{ flags: {}, input: [] } as never,
				{ isCI: false } as never,
			);
			expect(render).not.toHaveBeenCalled();
			expect(process.exitCode).toBe(1);
			expect(error).toHaveBeenCalled();
		} finally {
			Object.defineProperty(process, "platform", {
				value: original,
				configurable: true,
			});
			process.exitCode = oldExitCode;
			error.mockRestore();
		}
	});
});

describe("unsupported-platform renderer boundary", () => {
	it.each([
		"darwin",
		"darwin-arm64",
		"freebsd",
		"unknown",
	])("refuses doctor before Ink render on %s", (platform) => {
		const renderDependency = vi.fn(() => {
			throw new Error("Ink must not render");
		});
		const errors: string[] = [];
		const exits: number[] = [];
		handleDoctor(
			{ flags: {}, input: [] } as never,
			{ isCI: false } as never,
			{
				platform,
				render: renderDependency,
				error: (message: string) => errors.push(message),
				setExitCode: (code: number) => exits.push(code),
			} as never,
		);
		expect(renderDependency).not.toHaveBeenCalled();
		expect(errors.join("\\n")).toContain("unsupported-platform");
		expect(exits).toEqual([1]);
	});
});

describe("doctor dispatch", () => {
	it.each([
		false,
		true,
	])("forwards explicit refresh and dry-run flags (dryRun=%s)", (dryRun) => {
		handleDoctor(
			{
				input: ["doctor"],
				flags: { dryRun, refreshContext: true },
			} as never,
			{
				isCI: true,
				inkStdin: process.stdin,
			} as never,
		);
		const renderCalls = vi.mocked(render).mock.calls;
		const tree = renderCalls[renderCalls.length - 1][0] as ReactElement<{
			children: ReactElement;
		}>;
		expect(tree.props.children.type).toBe("DoctorController");
		expect(tree.props.children.props).toEqual({ dryRun, refreshContext: true });
	});
});

describe("plugin dispatch", () => {
	it("forwards raw plugin request to the controller", () => {
		handlePlugin(
			{
				input: ["plugin", "add", "org/repo"],
				flags: { dryRun: true, codex: true, force: true },
			} as never,
			{
				isCI: true,
				inkStdin: process.stdin,
			} as never,
		);
		const renderCalls = vi.mocked(render).mock.calls;
		const tree = renderCalls[renderCalls.length - 1][0] as ReactElement<{
			children: ReactElement;
		}>;
		const child = tree.props.children as ReactElement<{
			request: { projectDir: string };
		}>;
		expect(child.type).toBe("PluginController");
		expect(child.props.request).toMatchObject({
			action: "add",
			target: "org/repo",
			dryRun: true,
			codex: true,
			force: true,
		});
		expect(child.props.request.projectDir).toBe(process.cwd());
	});
});
