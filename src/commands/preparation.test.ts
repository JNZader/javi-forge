import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	inspectPreparationProductionBinding,
	inspectPreparationProductionPreflight,
	PREPARATION_PREFLIGHT_STATUS,
} from "../lib/preparation-production.js";
import type { InitStep } from "../types/index.js";
import {
	PREPARATION_COMMAND_STATUS,
	runPreparationCommand,
} from "./preparation.js";

vi.mock("../lib/preparation-production.js", () => ({
	createPreparationProductionConfigTemplate: () => ({
		workerExecutable: "/absolute/path/to/pinned/preparation-worker",
		workerExecutableDigest: "0".repeat(64),
		workerSource: "/absolute/path/to/pinned/preparation-worker.c",
		workerSourceDigest: "0".repeat(64),
		launcher: "/usr/bin/bwrap",
		launcherDigest: "0".repeat(64),
		publicKeyPem:
			"-----BEGIN PUBLIC KEY-----\n<replace-with-ed25519-public-key>\n-----END PUBLIC KEY-----",
		stateDirectory: "/home/javier/.local/state/javi-forge/preparation",
		cwd: "/home/javier/.local/share/ere-gateway-runtime/structured-1",
		destination:
			"/home/javier/.local/share/ere-gateway-runtime/structured-1/attempt-3",
	}),
	inspectPreparationProductionBinding: vi.fn(),
	inspectPreparationProductionPreflight: vi.fn(),
	PREPARATION_PREFLIGHT_STATUS: {
		READY: "ready",
		UNAVAILABLE: "unavailable",
		DENIED: "denied",
	},
}));

const mockInspect = vi.mocked(inspectPreparationProductionPreflight);
const mockBind = vi.mocked(inspectPreparationProductionBinding);

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
				outputsPath: "",
				force: false,
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
			{ action: "preflight", configPath, force: false, json: false },
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
			{
				action: "preflight",
				configPath: "",
				outputsPath: "",
				force: false,
				json: false,
			},
			onStep,
		);
		const unsupported = await runPreparationCommand(
			{
				action: "execute",
				configPath: "/tmp/config.json",
				outputsPath: "",
				force: false,
				json: false,
			},
			onStep,
		);

		expect(missing.status).toBe(PREPARATION_COMMAND_STATUS.FAILURE);
		expect(missing.error).toContain("--config");
		expect(unsupported.status).toBe(PREPARATION_COMMAND_STATUS.FAILURE);
		expect(unsupported.error).toContain("preparation bind");
		expect(unsupported.error).toContain("approval-message");
		expect(mockInspect).not.toHaveBeenCalled();
		expect(steps.at(-1)?.detail).toContain("preparation preflight");
	});

	it("rejects malformed JSON without printing config content", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "preparation-command-"));
		const configPath = path.join(root, "config.json");
		await writeFile(configPath, '{"secret":"value"', { mode: 0o600 });
		const { steps, onStep } = collectSteps();

		const result = await runPreparationCommand(
			{
				action: "preflight",
				configPath,
				outputsPath: "",
				force: false,
				json: false,
			},
			onStep,
		);

		expect(result.status).toBe(PREPARATION_COMMAND_STATUS.FAILURE);
		expect(result.error).toBe("preparation config is not valid JSON");
		expect(steps.at(-1)?.detail).toBe("preparation config is not valid JSON");
		expect(steps.at(-1)?.detail).not.toContain("secret");
	});

	it("computes a read-only production binding without printing outputs", async () => {
		mockBind.mockReturnValue({
			status: PREPARATION_PREFLIGHT_STATUS.READY,
			binding: "e".repeat(64),
			measurements: {
				executableDigest: "a".repeat(64),
				codeDigest: "b".repeat(64),
				dependenciesDigest: "c".repeat(64),
				launcherDigest: "d".repeat(64),
			},
		});
		const config = { workerExecutable: "/worker" };
		const outputs = { "minimal.py": "secret-output" };
		const configPath = await writeConfig(config);
		const outputsPath = await writeConfig(outputs);
		const { steps, onStep } = collectSteps();

		const result = await runPreparationCommand(
			{
				action: "bind",
				configPath,
				outputsPath,
				force: false,
				json: false,
			},
			onStep,
		);

		expect(result.status).toBe(PREPARATION_COMMAND_STATUS.SUCCESS);
		expect(result.binding?.binding).toBe("e".repeat(64));
		expect(mockBind).toHaveBeenCalledExactlyOnceWith(config, outputs);
		expect(mockInspect).not.toHaveBeenCalled();
		expect(steps.at(-1)?.detail).toContain(`binding: ${"e".repeat(64)}`);
		expect(steps.at(-1)?.detail).not.toContain("secret-output");
	});

	it("rejects malformed outputs without printing output content", async () => {
		const configPath = await writeConfig({ workerExecutable: "/worker" });
		const root = await mkdtemp(path.join(os.tmpdir(), "preparation-command-"));
		const outputsPath = path.join(root, "outputs.json");
		await writeFile(outputsPath, '{"minimal.py":"secret-output"', {
			mode: 0o600,
		});
		const { steps, onStep } = collectSteps();

		const result = await runPreparationCommand(
			{
				action: "bind",
				configPath,
				outputsPath,
				force: false,
				json: false,
			},
			onStep,
		);

		expect(result.status).toBe(PREPARATION_COMMAND_STATUS.FAILURE);
		expect(result.error).toBe("preparation outputs are not valid JSON");
		expect(steps.at(-1)?.detail).toBe("preparation outputs are not valid JSON");
		expect(steps.at(-1)?.detail).not.toContain("secret-output");
		expect(mockBind).not.toHaveBeenCalled();
	});

	it("prepares an approval message without signing or executing", async () => {
		const issuedAt = Date.now();
		const binding = "b".repeat(64);
		const nonce = "a".repeat(64);
		const { steps, onStep } = collectSteps();

		const result = await runPreparationCommand(
			{
				action: "approval-message",
				binding,
				nonce,
				issuedAt,
				expiresAt: issuedAt + 600000,
				force: false,
				json: false,
			},
			onStep,
		);

		expect(result.status).toBe(PREPARATION_COMMAND_STATUS.SUCCESS);
		expect(result.approvalMessage?.payload).toMatchObject({
			version: 1,
			purpose: "six-file-preparation",
			binding,
			nonce,
			issuedAt,
			expiresAt: issuedAt + 600000,
			maxUses: 1,
		});
		expect(result.approvalMessage?.message).toContain(
			"javi-forge/six-file-preparation/v1",
		);
		expect(steps.at(-1)?.detail).toContain(`binding: ${binding}`);
		expect(steps.at(-1)?.detail).toContain("no signing");
		expect(steps.at(-1)?.detail).toContain("no worker execution");
		expect(mockInspect).not.toHaveBeenCalled();
		expect(mockBind).not.toHaveBeenCalled();
	});

	it("rejects malformed approval message input without signing", async () => {
		const { steps, onStep } = collectSteps();

		const result = await runPreparationCommand(
			{
				action: "approval-message",
				binding: "not-a-binding",
				nonce: "a".repeat(64),
				force: false,
				json: false,
			},
			onStep,
		);

		expect(result.status).toBe(PREPARATION_COMMAND_STATUS.FAILURE);
		expect(result.error).toBe("approval-denied");
		expect(steps.at(-1)?.detail).toBe("approval-denied");
		expect(mockInspect).not.toHaveBeenCalled();
		expect(mockBind).not.toHaveBeenCalled();
	});

	it("writes a template without executing the preflight runtime", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "preparation-command-"));
		const outputPath = path.join(root, "preparation.config.example.json");
		const { steps, onStep } = collectSteps();

		const result = await runPreparationCommand(
			{
				action: "template",
				outputPath,
				force: false,
				json: false,
			},
			onStep,
		);

		const parsed = JSON.parse(await readFile(outputPath, "utf8")) as Record<
			string,
			unknown
		>;
		expect(result).toEqual({
			status: PREPARATION_COMMAND_STATUS.SUCCESS,
			outputPath,
		});
		expect(parsed.workerExecutableDigest).toBe("0".repeat(64));
		expect(parsed.publicKeyPem).toContain("PUBLIC KEY");
		expect(parsed.publicKeyPem).not.toContain("PRIVATE KEY");
		expect(mockInspect).not.toHaveBeenCalled();
		expect(steps.at(-1)?.detail).toContain("wrote ");
		expect(steps.at(-1)?.detail).toContain("side effects: wrote template only");
	});

	it("refuses to overwrite a template unless --force is set", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "preparation-command-"));
		const outputPath = path.join(root, "preparation.config.example.json");
		await writeFile(outputPath, "operator-owned\n", { mode: 0o600 });
		const { onStep } = collectSteps();

		const refused = await runPreparationCommand(
			{
				action: "template",
				outputPath,
				force: false,
				json: false,
			},
			onStep,
		);
		const preserved = await readFile(outputPath, "utf8");
		const overwritten = await runPreparationCommand(
			{
				action: "template",
				outputPath,
				force: true,
				json: false,
			},
			onStep,
		);

		expect(refused.status).toBe(PREPARATION_COMMAND_STATUS.FAILURE);
		expect(preserved).toBe("operator-owned\n");
		expect(overwritten.status).toBe(PREPARATION_COMMAND_STATUS.SUCCESS);
		expect(await readFile(outputPath, "utf8")).toContain(
			"workerExecutableDigest",
		);
	});
});
