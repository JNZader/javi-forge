import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../commands/plugin.js", () => ({
	runPluginAdd: vi.fn(),
	runPluginExport: vi.fn(),
	runPluginExportCodex: vi.fn(),
	runPluginExportGlobalSkillsJson: vi.fn(),
	runPluginExportSkillsJson: vi.fn(),
	runPluginImport: vi.fn(),
	runPluginList: vi.fn(),
	runPluginRemove: vi.fn(),
	runPluginSearch: vi.fn(),
	runPluginSync: vi.fn(),
	runPluginValidate: vi.fn(),
}));

import { runPluginSearch } from "../commands/plugin.js";
import Plugin from "./Plugin.js";

describe("Plugin command signal handling", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.removeAllListeners("SIGINT");
		process.removeAllListeners("SIGTERM");
	});

	it("aborts search and exits 130 on SIGINT", async () => {
		const originalExitCode = process.exitCode;
		(vi.mocked(runPluginSearch) as ReturnType<typeof vi.fn>).mockImplementation(
			async () => {
				await new Promise(() => {});
			},
		);

		const view = render(
			React.createElement(Plugin, {
				action: "search",
				target: "coder",
				dryRun: false,
			}),
		);

		await vi.waitFor(() => {
			expect(vi.mocked(runPluginSearch)).toHaveBeenCalledTimes(1);
		});

		const signal = vi.mocked(runPluginSearch).mock.calls[0]![2] as
			| { signal?: AbortSignal }
			| undefined;
		if (!signal) {
			throw new Error("Expected search call to receive options");
		}

		process.emit("SIGINT");
		expect(signal.signal?.aborted).toBe(true);
		expect(process.exitCode).toBe(130);
		process.emit("SIGTERM");
		expect(process.exitCode).toBe(130);

		view.unmount();
		process.exitCode = originalExitCode;
	});

	it("exits 143 on SIGTERM and does not override on SIGINT later", async () => {
		const originalExitCode = process.exitCode;
		(vi.mocked(runPluginSearch) as ReturnType<typeof vi.fn>).mockImplementation(
			async () => {
				await new Promise(() => {});
			},
		);

		const view = render(
			React.createElement(Plugin, {
				action: "search",
				target: "coder",
				dryRun: false,
			}),
		);

		await vi.waitFor(() => {
			expect(vi.mocked(runPluginSearch)).toHaveBeenCalledTimes(1);
		});

		const signal = vi.mocked(runPluginSearch).mock.calls[0]![2] as
			| { signal?: AbortSignal }
			| undefined;
		if (!signal) {
			throw new Error("Expected search call to receive options");
		}

		process.emit("SIGTERM");
		expect(signal.signal?.aborted).toBe(true);
		expect(process.exitCode).toBe(143);
		process.emit("SIGINT");
		expect(process.exitCode).toBe(143);

		view.unmount();
		process.exitCode = originalExitCode;
	});
});
