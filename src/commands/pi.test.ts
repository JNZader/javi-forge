import { beforeEach, describe, expect, it, vi } from "vitest";
import { writePiFreeProvidersBundle } from "../lib/pi-free-providers.js";
import type { InitStep } from "../types/index.js";
import { PI_COMMAND_STATUS, runPiCommand } from "./pi.js";

vi.mock("../lib/pi-free-providers.js", () => ({
	writePiFreeProvidersBundle: vi.fn(),
}));

const mockWriteBundle = vi.mocked(writePiFreeProvidersBundle);

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

describe("runPiCommand", () => {
	it("exports the free providers bundle", async () => {
		mockWriteBundle.mockResolvedValue({
			configPath: "/target/models.free.generated.json",
			readmePath: "/target/README.md",
			envExamplePath: "/target/env.example",
			providerModelCounts: {
				"kilo-free": 21,
				"openrouter-free": 22,
				"public-noauth-blockrun": 6,
				"public-noauth-vireonix": 1,
				"ollama-local": 1,
			},
			wrote: true,
		});
		const { steps, onStep } = collectSteps();

		const result = await runPiCommand(
			{
				action: "providers",
				providersAction: "export-free",
				outputDir: "/target",
				dryRun: false,
			},
			onStep,
		);

		expect(result).toEqual({ status: PI_COMMAND_STATUS.SUCCESS });
		expect(mockWriteBundle).toHaveBeenCalledExactlyOnceWith({
			outputDir: "/target",
			dryRun: false,
		});
		expect(steps[0]!.status).toBe("running");
		expect(steps[1]!.status).toBe("done");
		expect(steps[1]!.detail).toContain("/target/models.free.generated.json");
		expect(steps[1]!.detail).toContain("secrets: none written");
	});

	it("reports usage for unsupported pi subcommands", async () => {
		const { steps, onStep } = collectSteps();

		const result = await runPiCommand(
			{ action: "wat", providersAction: "nope", dryRun: false },
			onStep,
		);

		expect(result).toEqual({ status: PI_COMMAND_STATUS.FAILURE });
		expect(mockWriteBundle).not.toHaveBeenCalled();
		expect(steps[0]!.detail).toContain("javi-forge pi providers export-free");
	});
});
