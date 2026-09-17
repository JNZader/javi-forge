import { describe, expect, it, vi } from "vitest";
import { OUTPUTS, POLICY } from "./preparation-capability.js";
import { runPreparationExecute } from "./preparation-execute.js";
import { createPreparationProductionConfigTemplate } from "./preparation-production.js";

const outputs = Object.fromEntries(
	OUTPUTS.map((name) => [name, name.endsWith(".json") ? "{}" : "#\n"]),
);

describe("runPreparationExecute", () => {
	it("refuses an existing destination before running the worker", async () => {
		const runPinnedWorker = vi.fn();
		const result = await runPreparationExecute(
			createPreparationProductionConfigTemplate(),
			outputs,
			"{}",
			{
				cwd: POLICY.cwd,
				destExists: () => true,
				runPinnedWorker,
			},
		);
		expect(result).toEqual({
			status: "denied",
			reason: "destination-present",
			consumed: false,
			audit: [],
		});
		expect(runPinnedWorker).not.toHaveBeenCalled();
	});

	it("refuses when process cwd is not the policy cwd", async () => {
		const runPinnedWorker = vi.fn();
		const result = await runPreparationExecute(
			createPreparationProductionConfigTemplate(),
			outputs,
			"{}",
			{
				cwd: "/tmp",
				destExists: () => false,
				runPinnedWorker,
			},
		);
		expect(result.reason).toBe("runtime-unavailable");
		expect(result.consumed).toBe(false);
		expect(runPinnedWorker).not.toHaveBeenCalled();
	});

	it("runs the pinned worker only after dest is absent", async () => {
		const runPinnedWorker = vi.fn(async () => ({
			status: "prepared" as const,
			consumed: true,
			audit: ["ready", "consumed", "validated", "prepared"],
			cleanup: "complete",
		}));
		const result = await runPreparationExecute(
			createPreparationProductionConfigTemplate(),
			outputs,
			"evidence",
			{
				cwd: POLICY.cwd,
				destExists: () => false,
				runPinnedWorker,
			},
		);
		expect(result.status).toBe("prepared");
		expect(result.consumed).toBe(true);
		expect(runPinnedWorker).toHaveBeenCalledOnce();
	});
});
