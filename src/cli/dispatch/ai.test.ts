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
			flags: {
				target: "both",
				config: "",
				dryRun: true,
				report: "",
				provider: "",
				family: "",
				model: "",
				status: "",
				limit: 0,
				timeout: 600,
				includeLocal: false,
				piCommand: "",
				envFile: "",
				prompt: "",
				passList: "",
				piSettings: "",
				opencodeConfig: "",
			},
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
				reportPath: "",
				provider: "",
				family: "",
				model: "",
				statusFilter: "",
				limit: undefined,
				timeoutSeconds: 600,
				includeLocal: false,
				piCommand: "",
				envFile: "",
				prompt: "",
				passListPath: "",
				piSettingsPath: "",
				opencodeConfigPath: "",
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
			flags: {
				target: "",
				config: "/source/models.json",
				dryRun: false,
				report: "",
				provider: "",
				family: "",
				model: "",
				status: "",
				limit: 0,
				timeout: 600,
				includeLocal: false,
				piCommand: "",
				envFile: "",
				prompt: "",
				passList: "",
				piSettings: "",
				opencodeConfig: "",
			},
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

	it("routes smoke-test filters", async () => {
		mockRun.mockResolvedValue({ status: "success" });

		await handleAi({
			input: ["ai", "providers", "smoke-test", "/target"],
			flags: {
				target: "",
				config: "/source/models.json",
				dryRun: false,
				report: "/source/previous.jsonl",
				provider: "openrouter-free",
				family: "deepseek",
				model: "free",
				status: "failed",
				limit: 3,
				timeout: 12,
				includeLocal: true,
				piCommand: "pi",
				envFile: "/secrets/providers.env",
				prompt: "pong",
				passList: "",
				piSettings: "",
				opencodeConfig: "",
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			expect.objectContaining({
				providersAction: "smoke-test",
				outputDir: "/target",
				inputPath: "/source/models.json",
				reportPath: "/source/previous.jsonl",
				provider: "openrouter-free",
				family: "deepseek",
				model: "free",
				statusFilter: "failed",
				limit: 3,
				timeoutSeconds: 12,
				includeLocal: true,
				piCommand: "pi",
				envFile: "/secrets/providers.env",
				prompt: "pong",
			}),
			expect.any(Function),
		);
	});

	it("routes apply-scope arguments", async () => {
		mockRun.mockResolvedValue({ status: "success" });

		await handleAi({
			input: ["ai", "providers", "apply-scope", "/target/smoke.pass.tsv"],
			flags: {
				target: "both",
				config: "",
				dryRun: true,
				report: "",
				provider: "",
				family: "",
				model: "",
				status: "",
				limit: 0,
				timeout: 600,
				includeLocal: false,
				piCommand: "",
				envFile: "",
				prompt: "",
				passList: "/override/pass.tsv",
				piSettings: "/pi/settings.json",
				opencodeConfig: "/opencode/opencode.json",
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			expect.objectContaining({
				providersAction: "apply-scope",
				outputDir: "/target/smoke.pass.tsv",
				target: "both",
				passListPath: "/override/pass.tsv",
				piSettingsPath: "/pi/settings.json",
				opencodeConfigPath: "/opencode/opencode.json",
				dryRun: true,
			}),
			expect.any(Function),
		);
	});
});
