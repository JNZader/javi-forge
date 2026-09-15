import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	inspectPreparationProductionPreflight,
	PREPARATION_PREFLIGHT_STATUS,
} from "../lib/preparation-production.js";
import type { InitStep } from "../types/index.js";
import {
	PREPARATION_COMMAND_STATUS,
	runPreparationCommand,
} from "./preparation.js";

vi.mock("../lib/preparation-production.js", () => ({
	inspectPreparationProductionPreflight: vi.fn(),
	PREPARATION_PREFLIGHT_STATUS: {
		READY: "ready",
		UNAVAILABLE: "unavailable",
		DENIED: "denied",
	},
}));

const mockInspect = vi.mocked(inspectPreparationProductionPreflight);

function collectSteps(): {
	steps: InitStep[];
	onStep: (step: InitStep) => void;
} {
	const steps: InitStep[] = [];
	return { steps, onStep: (step: InitStep) => steps.push(step) };
}

async function writeConfig(value: unknown): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "preparation-command-"));
	const configPath = path.join(root, "config.json");
	await writeFile(configPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
	return configPath;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("runPreparationCommand", () => {
	it("runs read-only production preflight from --config", async () => {
		mockInspect.mockReturnValue({
			status: PREPARATION_PREFLIGHT_STATUS.READY,
			measurements: {
				executableDigest: "a".repeat(64),
				codeDigest: "b".repeat(64),
				dependenciesDigest: "c".repeat(64),
				launcherDigest: "d".repeat(64),
			},
		});
		const config = { workerExecutable: "/worker" };
		const configPath = await writeConfig(config);
		const { steps, onStep } = collectSteps();

		const result = await runPreparationCommand(
			{
				action: "preflight",
				configPath,
				json: false,
			},
			onStep,
		);

		expect(result.status).toBe(PREPARATION_COMMAND_STATUS.SUCCESS);
		expect(mockInspect).toHaveBeenCalledExactlyOnceWith(config);
		expect(steps).toHaveLength(2);
		expect(steps[1]).toMatchObject({
			status: "done",
			label: "Preparation production preflight",
		});
		expect(steps[1]!.detail).toContain("side effects: none");
		expect(steps[1]!.detail).toContain("executable: ");
	});

	it("fails closed when preflight is not ready", async () => {
		mockInspect.mockReturnValue({
			status: PREPARATION_PREFLIGHT_STATUS.DENIED,
			reason: "state-directory-unsafe",
		});
		const configPath = await writeConfig({ workerExecutable: "/worker" });
		const { steps, onStep } = collectSteps();

		const result = await runPreparationCommand(
			{ action: "preflight", configPath, json: false },
			onStep,
		);

		expect(result).toEqual({
			status: PREPARATION_COMMAND_STATUS.FAILURE,
			preflight: {
				status: PREPARATION_PREFLIGHT_STATUS.DENIED,
				reason: "state-directory-unsafe",
			},
		});
		expect(steps[1]).toMatchObject({ status: "error" });
		expect(steps[1]!.detail).toContain("reason: state-directory-unsafe");
	});

	it("rejects missing config and unsupported actions without measuring runtime", async () => {
		const { steps, onStep } = collectSteps();

		const missing = await runPreparationCommand(
			{ action: "preflight", configPath: "", json: false },
			onStep,
		);
		const unsupported = await runPreparationCommand(
			{ action: "execute", configPath: "/tmp/config.json", json: false },
			onStep,
		);

		expect(missing.status).toBe(PREPARATION_COMMAND_STATUS.FAILURE);
		expect(missing.error).toContain("--config");
		expect(unsupported.status).toBe(PREPARATION_COMMAND_STATUS.FAILURE);
		expect(unsupported.error).toContain("preparation preflight");
		expect(mockInspect).not.toHaveBeenCalled();
		expect(steps.at(-1)?.detail).toContain("preparation preflight");
	});

	it("rejects malformed JSON without printing config content", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "preparation-command-"));
		const configPath = path.join(root, "config.json");
		await writeFile(configPath, '{"secret":"value"', { mode: 0o600 });
		const { steps, onStep } = collectSteps();

		const result = await runPreparationCommand(
			{ action: "preflight", configPath, json: false },
			onStep,
		);

		expect(result.status).toBe(PREPARATION_COMMAND_STATUS.FAILURE);
		expect(result.error).toBe("preflight config is not valid JSON");
		expect(steps.at(-1)?.detail).toBe("preflight config is not valid JSON");
		expect(steps.at(-1)?.detail).not.toContain("secret");
	});
});
