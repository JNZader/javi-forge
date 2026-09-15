import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAiProvidersCommand } from "../../commands/ai-providers.js";
import { aiCommandExitCode, handleAi } from "./ai.js";
import type { CLI } from "./types.js";

vi.mock("../../commands/ai-providers.js", () => ({
	runAiProvidersCommand: vi.fn(),
	AI_PROVIDERS_COMMAND_STATUS: { SUCCESS: "success", FAILURE: "failure" },
}));

const mockRun = vi.mocked(runAiProvidersCommand);

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, "log").mockImplementation(() => {});
	process.exitCode = undefined;
});

describe("ai dispatch", () => {
	it("preserves previous non-zero exit code", () => {
		expect(aiCommandExitCode({ status: "success" }, 2)).toBe(2);
	});

	it("routes export-free arguments", async () => {
		mockRun.mockResolvedValue({ status: "success" });

		await handleAi({
			input: ["ai", "providers", "export-free", "/target"],
			flags: { target: "both", config: "", dryRun: true },
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "providers",
				providersAction: "export-free",
				from: undefined,
				to: undefined,
				outputDir: "/target",
				target: "both",
				inputPath: "",
				dryRun: true,
			},
			expect.any(Function),
		);
		expect(process.exitCode).toBe(0);
	});

	it("routes convert arguments", async () => {
		mockRun.mockResolvedValue({ status: "success" });

		await handleAi({
			input: ["ai", "providers", "convert", "pi", "opencode", "/target"],
			flags: { target: "", config: "/source/models.json", dryRun: false },
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			expect.objectContaining({
				from: "pi",
				to: "opencode",
				outputDir: "/target",
				inputPath: "/source/models.json",
			}),
			expect.any(Function),
		);
	});
});
