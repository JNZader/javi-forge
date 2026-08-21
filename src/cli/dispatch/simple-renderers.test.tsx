import { describe, expect, it, vi } from "vitest";

vi.mock("ink", () => ({ render: vi.fn() }));

import { render } from "ink";
import { handleDoctor, handleInitDefault } from "./simple-renderers.js";

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
