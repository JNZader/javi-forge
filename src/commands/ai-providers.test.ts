import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	convertProviderBundle,
	writeFreeProvidersBundle,
} from "../lib/ai-provider-bundles.js";
import { writeModelAssignmentProfiles } from "../lib/ai-provider-profiles.js";
import { applyProviderScope } from "../lib/ai-provider-scope.js";
import { runProviderSmokeTests } from "../lib/ai-provider-smoke.js";
import type { InitStep } from "../types/index.js";
import {
	AI_PROVIDERS_COMMAND_STATUS,
	runAiProvidersCommand,
} from "./ai-providers.js";

vi.mock("../lib/ai-provider-bundles.js", () => ({
	convertProviderBundle: vi.fn(),
	writeFreeProvidersBundle: vi.fn(),
	PROVIDER_BUNDLE_SOURCE: { PI: "pi", OPENCODE: "opencode" },
	PROVIDER_BUNDLE_TARGET: { PI: "pi", OPENCODE: "opencode", BOTH: "both" },
}));

vi.mock("../lib/ai-provider-smoke.js", () => ({
	runProviderSmokeTests: vi.fn(),
}));

vi.mock("../lib/ai-provider-scope.js", () => ({
	applyProviderScope: vi.fn(),
}));

vi.mock("../lib/ai-provider-profiles.js", () => ({
	writeModelAssignmentProfiles: vi.fn(),
}));

const mockWriteBundle = vi.mocked(writeFreeProvidersBundle);
const mockConvertBundle = vi.mocked(convertProviderBundle);
const mockRunSmokeTests = vi.mocked(runProviderSmokeTests);
const mockApplyScope = vi.mocked(applyProviderScope);
const mockWriteProfiles = vi.mocked(writeModelAssignmentProfiles);

function collectSteps(): {
	steps: InitStep[];
	onStep: (step: InitStep) => void;
} {
	const steps: InitStep[] = [];
	return { steps, onStep: (step: InitStep) => steps.push(step) };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("runAiProvidersCommand", () => {
	it("exports free providers for both runtimes", async () => {
		mockWriteBundle.mockResolvedValue({
			outputDir: "/target",
			files: [
				"/target/models.free.generated.json",
				"/target/opencode.providers.generated.json",
			],
			providerModelCounts: { "openrouter-free": 22 },
			wrote: true,
		});
		const { steps, onStep } = collectSteps();

		const result = await runAiProvidersCommand(
			{
				action: "providers",
				providersAction: "export-free",
				outputDir: "/target",
				target: "both",
				dryRun: false,
			},
			onStep,
		);

		expect(result).toEqual({ status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS });
		expect(mockWriteBundle).toHaveBeenCalledExactlyOnceWith({
			outputDir: "/target",
			target: "both",
			dryRun: false,
		});
		expect(steps[1]!.detail).toContain(
			"/target/opencode.providers.generated.json",
		);
		expect(steps[1]!.detail).toContain("secrets: none written");
	});

	it("converts provider metadata between Pi and OpenCode", async () => {
		mockConvertBundle.mockResolvedValue({
			outputDir: "/target",
			files: ["/target/opencode.providers.converted.json"],
			providerModelCounts: { "pi-provider": 1 },
			wrote: false,
		});
		const { steps, onStep } = collectSteps();

		const result = await runAiProvidersCommand(
			{
				action: "providers",
				providersAction: "convert",
				from: "pi",
				to: "opencode",
				inputPath: "/source/models.json",
				outputDir: "/target",
				dryRun: true,
			},
			onStep,
		);

		expect(result).toEqual({ status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS });
		expect(mockConvertBundle).toHaveBeenCalledExactlyOnceWith({
			from: "pi",
			to: "opencode",
			inputPath: "/source/models.json",
			outputDir: "/target",
			dryRun: true,
		});
		expect(steps[1]!.detail).toContain("dry-run: would generate");
	});

	it("smoke-tests provider subsets", async () => {
		mockRunSmokeTests.mockResolvedValue({
			selected: 1,
			ran: 1,
			dryRun: false,
			reportPath: "/target/smoke.jsonl",
			summaryPath: "/target/smoke.summary.md",
			passListPath: "/target/smoke.pass.tsv",
			counts: { pass: 1 },
			providerStatusCounts: { "openrouter-free": { pass: 1 } },
		});
		const { steps, onStep } = collectSteps();

		const result = await runAiProvidersCommand(
			{
				action: "providers",
				providersAction: "smoke-test",
				outputDir: "/target",
				inputPath: "/source/models.json",
				reportPath: "/source/previous.jsonl",
				provider: "openrouter-free",
				family: "deepseek",
				model: "free",
				statusFilter: "failed",
				limit: 2,
				timeoutSeconds: 10,
				runtime: "opencode",
				includeLocal: false,
				envFile: "/secrets/providers.env",
				piCommand: "pi",
				opencodeCommand: "opencode",
				opencodeAgent: "title",
				smokeCwd: "/tmp",
				dryRun: false,
			},
			onStep,
		);

		expect(result).toEqual({ status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS });
		expect(mockRunSmokeTests).toHaveBeenCalledExactlyOnceWith({
			modelsPath: "/source/models.json",
			previousReportPath: "/source/previous.jsonl",
			outputPath: "/target",
			timeoutSeconds: 10,
			runtime: "opencode",
			piCommand: "pi",
			opencodeCommand: "opencode",
			opencodeAgent: "title",
			smokeCwd: "/tmp",
			envFile: "/secrets/providers.env",
			prompt: undefined,
			dryRun: false,
			filters: {
				provider: "openrouter-free",
				family: "deepseek",
				model: "free",
				status: "failed",
				limit: 2,
				includeLocal: false,
			},
		});
		expect(steps[1]!.detail).toContain("/target/smoke.jsonl");
		expect(steps[1]!.detail).toContain("pass: 1");
	});

	it("applies smoke-test pass scope to runtime configs", async () => {
		mockApplyScope.mockResolvedValue({
			inputPath: "/target/smoke.pass.tsv",
			target: "both",
			dryRun: true,
			wrote: false,
			passModels: 2,
			scopedProviders: ["opencode-go", "openrouter-free"],
			files: ["/pi/settings.json", "/opencode/opencode.json"],
			backups: [],
			piEnabledModels: 2,
			opencodeProviderModelCounts: {
				"opencode-go": 1,
				"openrouter-free": 1,
			},
		});
		const { steps, onStep } = collectSteps();

		const result = await runAiProvidersCommand(
			{
				action: "providers",
				providersAction: "apply-scope",
				outputDir: "/target/smoke.pass.tsv",
				target: "both",
				passListPath: "/override/pass.tsv",
				piSettingsPath: "/pi/settings.json",
				opencodeConfigPath: "/opencode/opencode.json",
				dryRun: true,
			},
			onStep,
		);

		expect(result).toEqual({ status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS });
		expect(mockApplyScope).toHaveBeenCalledExactlyOnceWith({
			inputPath: "/override/pass.tsv",
			target: "both",
			piSettingsPath: "/pi/settings.json",
			opencodeConfigPath: "/opencode/opencode.json",
			dryRun: true,
		});
		expect(steps[1]!.detail).toContain("dry-run: would update");
		expect(steps[1]!.detail).toContain("pi enabledModels: 2");
		expect(steps[1]!.detail).toContain("opencode-go: 1");
	});

	it("uses the apply-scope positional path when --pass-list is omitted", async () => {
		mockApplyScope.mockResolvedValue({
			inputPath: "/target/smoke.pass.tsv",
			target: "pi",
			dryRun: true,
			wrote: false,
			passModels: 1,
			scopedProviders: ["openrouter-free"],
			files: ["/pi/settings.json"],
			backups: [],
			piEnabledModels: 1,
		});
		const { onStep } = collectSteps();

		await runAiProvidersCommand(
			{
				action: "providers",
				providersAction: "apply-scope",
				outputDir: "/target/smoke.pass.tsv",
				target: "pi",
				passListPath: "",
				dryRun: true,
			},
			onStep,
		);

		expect(mockApplyScope).toHaveBeenCalledExactlyOnceWith({
			inputPath: "/target/smoke.pass.tsv",
			target: "pi",
			piSettingsPath: undefined,
			opencodeConfigPath: undefined,
			dryRun: true,
		});
	});

	it("generates smoke-tested model assignment profiles", async () => {
		mockWriteProfiles.mockResolvedValue({
			inputPath: "/target/smoke.pass.tsv",
			outputDir: "/profiles",
			dryRun: true,
			wrote: false,
			files: [
				"/profiles/model-assignment.profiles.generated.json",
				"/profiles/model-assignment.profiles.generated.md",
			],
			passModels: 3,
			profileCounts: {
				"sdd-strong": 2,
				"sdd-mid": 2,
				"sdd-cheap": 2,
			},
			profilePrimaries: {
				"sdd-strong": "opencode-go/qwen3-coder",
				"sdd-mid": "opencode-go/qwen3-coder",
				"sdd-cheap": "google/gemini-3.1-flash-lite",
			},
			warnings: [],
		});
		const { steps, onStep } = collectSteps();

		const result = await runAiProvidersCommand(
			{
				action: "providers",
				providersAction: "profile-plan",
				outputDir: "/profiles",
				passListPath: "/target/smoke.pass.tsv",
				limit: 2,
				dryRun: true,
			},
			onStep,
		);

		expect(result).toEqual({ status: AI_PROVIDERS_COMMAND_STATUS.SUCCESS });
		expect(mockWriteProfiles).toHaveBeenCalledExactlyOnceWith({
			inputPath: "/target/smoke.pass.tsv",
			outputDir: "/profiles",
			maxCandidatesPerProfile: 2,
			dryRun: true,
		});
		expect(steps[1]!.detail).toContain("dry-run: would generate");
		expect(steps[1]!.detail).toContain("sdd-strong: 2");
		expect(steps[1]!.detail).toContain(
			"sdd-cheap: google/gemini-3.1-flash-lite",
		);
		expect(steps[1]!.detail).toContain("runtime configs unchanged");
	});

	it("reports usage for unsupported subcommands", async () => {
		const { steps, onStep } = collectSteps();

		const result = await runAiProvidersCommand(
			{ action: "nope", providersAction: "wat", dryRun: false },
			onStep,
		);

		expect(result).toEqual({ status: AI_PROVIDERS_COMMAND_STATUS.FAILURE });
		expect(mockWriteBundle).not.toHaveBeenCalled();
		expect(mockConvertBundle).not.toHaveBeenCalled();
		expect(mockRunSmokeTests).not.toHaveBeenCalled();
		expect(mockApplyScope).not.toHaveBeenCalled();
		expect(mockWriteProfiles).not.toHaveBeenCalled();
		expect(steps[0]!.detail).toContain("javi-forge ai providers export-free");
	});
});
