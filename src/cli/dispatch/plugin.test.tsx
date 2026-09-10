import { render } from "ink-testing-library";
import { createElement, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type PluginCommandResult,
	runPluginCommand,
} from "../../commands/plugin.js";
import PluginController, { pluginCommandExitCode } from "./plugin.js";

vi.mock("../../commands/plugin.js", () => ({ runPluginCommand: vi.fn() }));
const initialExit = process.exitCode;
beforeEach(() => {
	vi.clearAllMocks();
	process.exitCode = undefined;
});
afterEach(() => {
	process.exitCode = initialExit;
});

describe("plugin CLI ownership", () => {
	it.each([
		"success",
		"failure",
		"refused",
	] as const)("maps %s without clearing prior failure", (status) => {
		const result = { status };
		expect(pluginCommandExitCode(result)).toBe(status === "success" ? 0 : 1);
		expect(pluginCommandExitCode(result, 7)).toBe(7);
	});
	it.each([
		"success",
		"failure",
		"refused",
	] as const)("executes once and completes %s under StrictMode and rerender", async (status) => {
		let finish!: (result: PluginCommandResult) => void;
		vi.mocked(runPluginCommand).mockImplementation((_request, onStep) => {
			onStep({ id: "progress", label: "Progress", status: "running" });
			onStep({ id: "progress", label: "Updated progress", status: "done" });
			return new Promise((resolve) => {
				finish = resolve;
			});
		});
		const request = {
			action: "add",
			target: "org/repo",
			projectDir: "/project",
			dryRun: true,
			force: true,
		};
		const tree = () =>
			createElement(
				StrictMode,
				null,
				createElement(PluginController, { request: { ...request } }),
			);
		const view = render(tree());
		try {
			await vi.waitFor(() => expect(runPluginCommand).toHaveBeenCalledTimes(1));
			view.rerender(tree());
			finish({ status });
			await vi.waitFor(() =>
				expect(view.lastFrame()).toContain(
					status === "success"
						? "Done."
						: status === "refused"
							? "Refused."
							: "Failed.",
				),
			);
			expect(runPluginCommand).toHaveBeenCalledExactlyOnceWith(
				request,
				expect.any(Function),
			);
			expect(view.lastFrame()).toContain("Updated progress");
			expect(process.exitCode).toBe(status === "success" ? 0 : 1);
			if (status !== "success") expect(view.lastFrame()).not.toContain("Done.");
		} finally {
			view.unmount();
		}
	});
	it("does not erase an earlier failure after successful execution", async () => {
		process.exitCode = 7;
		vi.mocked(runPluginCommand).mockResolvedValue({ status: "success" });
		const view = render(
			createElement(PluginController, {
				request: { projectDir: "/project", dryRun: false },
			}),
		);
		try {
			await vi.waitFor(() => expect(view.lastFrame()).toContain("Done."));
			expect(process.exitCode).toBe(7);
		} finally {
			view.unmount();
		}
	});
});
