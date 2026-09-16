import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPreparationCommand } from "../../commands/preparation.js";
import {
	handlePreparation,
	preparationCommandExitCode,
} from "./preparation.js";
import type { CLI } from "./types.js";

vi.mock("../../commands/preparation.js", () => ({
	runPreparationCommand: vi.fn(),
	PREPARATION_COMMAND_STATUS: { SUCCESS: "success", FAILURE: "failure" },
}));

const mockRun = vi.mocked(runPreparationCommand);

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, "log").mockImplementation(() => {});
	process.exitCode = undefined;
});

describe("preparation dispatch", () => {
	it("preserves previous non-zero exit code", () => {
		expect(preparationCommandExitCode({ status: "success" }, 2)).toBe(2);
	});

	it("routes preflight arguments", async () => {
		mockRun.mockResolvedValue({
			status: "success",
			preflight: { status: "ready" },
		});

		await handlePreparation({
			input: ["preparation", "preflight"],
			flags: {
				config: "/safe/config.json",
				output: "",
				force: false,
				json: false,
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "preflight",
				configPath: "/safe/config.json",
				outputPath: "",
				force: false,
				json: false,
			},
			expect.any(Function),
		);
		expect(process.exitCode).toBe(0);
	});

	it("prints structured JSON without step noise", async () => {
		mockRun.mockResolvedValue({
			status: "failure",
			preflight: { status: "denied", reason: "state-directory-unsafe" },
		});

		await handlePreparation({
			input: ["preparation", "preflight"],
			flags: {
				config: "/safe/config.json",
				output: "",
				force: false,
				json: true,
			},
		} as CLI);

		expect(console.log).toHaveBeenCalledExactlyOnceWith(
			JSON.stringify(
				{
					status: "failure",
					preflight: {
						status: "denied",
						reason: "state-directory-unsafe",
					},
				},
				null,
				2,
			),
		);
		expect(process.exitCode).toBe(1);
	});

	it("routes template arguments", async () => {
		mockRun.mockResolvedValue({
			status: "success",
			outputPath: "/safe/preparation.config.example.json",
		});

		await handlePreparation({
			input: ["preparation", "template"],
			flags: {
				config: "",
				output: "/safe/preparation.config.example.json",
				force: true,
				json: false,
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "template",
				configPath: "",
				outputPath: "/safe/preparation.config.example.json",
				force: true,
				json: false,
			},
			expect.any(Function),
		);
		expect(process.exitCode).toBe(0);
	});
});
