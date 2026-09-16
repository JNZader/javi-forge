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
				approval: "",
				binding: "",
				config: "/safe/config.json",
				expiresAt: 0,
				issuedAt: 0,
				nonce: "",
				outputs: "",
				output: "",
				force: false,
				json: false,
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "preflight",
				approvalPath: "",
				binding: "",
				configPath: "/safe/config.json",
				expiresAt: 0,
				outputsPath: "",
				outputPath: "",
				force: false,
				issuedAt: 0,
				json: false,
				nonce: "",
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
				approval: "",
				config: "/safe/config.json",
				binding: "",
				nonce: "",
				issuedAt: 0,
				expiresAt: 0,
				outputs: "",
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
				approval: "",
				binding: "",
				config: "",
				expiresAt: 0,
				issuedAt: 0,
				nonce: "",
				outputs: "",
				output: "/safe/preparation.config.example.json",
				force: true,
				json: false,
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "template",
				approvalPath: "",
				binding: "",
				configPath: "",
				expiresAt: 0,
				outputsPath: "",
				outputPath: "/safe/preparation.config.example.json",
				force: true,
				issuedAt: 0,
				json: false,
				nonce: "",
			},
			expect.any(Function),
		);
		expect(process.exitCode).toBe(0);
	});

	it("routes outputs-template arguments", async () => {
		mockRun.mockResolvedValue({
			status: "success",
			outputPath: "/safe/preparation.outputs.example.json",
		});

		await handlePreparation({
			input: ["preparation", "outputs-template"],
			flags: {
				approval: "",
				binding: "",
				config: "",
				expiresAt: 0,
				issuedAt: 0,
				nonce: "",
				outputs: "",
				output: "/safe/preparation.outputs.example.json",
				force: true,
				json: false,
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "outputs-template",
				approvalPath: "",
				binding: "",
				configPath: "",
				expiresAt: 0,
				outputsPath: "",
				outputPath: "/safe/preparation.outputs.example.json",
				force: true,
				issuedAt: 0,
				json: false,
				nonce: "",
			},
			expect.any(Function),
		);
		expect(process.exitCode).toBe(0);
	});

	it("routes bind arguments", async () => {
		mockRun.mockResolvedValue({
			status: "success",
			binding: { status: "ready", binding: "a".repeat(64) },
		});

		await handlePreparation({
			input: ["preparation", "bind"],
			flags: {
				approval: "",
				binding: "",
				config: "/safe/config.json",
				expiresAt: 0,
				issuedAt: 0,
				nonce: "",
				outputs: "/safe/outputs.json",
				output: "",
				force: false,
				json: false,
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "bind",
				approvalPath: "",
				binding: "",
				configPath: "/safe/config.json",
				expiresAt: 0,
				outputsPath: "/safe/outputs.json",
				outputPath: "",
				force: false,
				issuedAt: 0,
				json: false,
				nonce: "",
			},
			expect.any(Function),
		);
		expect(process.exitCode).toBe(0);
	});

	it("routes approval-message arguments", async () => {
		mockRun.mockResolvedValue({
			status: "success",
			approvalMessage: {
				payload: {
					version: 1,
					purpose: "six-file-preparation",
					binding: "b".repeat(64),
					nonce: "a".repeat(64),
					issuedAt: 1000,
					expiresAt: 601000,
					maxUses: 1,
				},
				message: "message-to-sign",
			},
		});

		await handlePreparation({
			input: ["preparation", "approval-message"],
			flags: {
				approval: "",
				binding: "b".repeat(64),
				config: "",
				expiresAt: 601000,
				issuedAt: 1000,
				nonce: "a".repeat(64),
				outputs: "",
				output: "",
				force: false,
				json: false,
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "approval-message",
				approvalPath: "",
				binding: "b".repeat(64),
				configPath: "",
				expiresAt: 601000,
				outputsPath: "",
				outputPath: "",
				force: false,
				issuedAt: 1000,
				json: false,
				nonce: "a".repeat(64),
			},
			expect.any(Function),
		);
		expect(process.exitCode).toBe(0);
	});

	it("routes approval-check arguments", async () => {
		mockRun.mockResolvedValue({
			status: "success",
			approvalCheck: {
				status: "ready",
				approval: {
					nonce: "a".repeat(64),
					issuedAt: 1000,
					expiresAt: 601000,
				},
			},
		});

		await handlePreparation({
			input: ["preparation", "approval-check"],
			flags: {
				approval: "/safe/approval.json",
				binding: "b".repeat(64),
				config: "/safe/config.json",
				expiresAt: 0,
				issuedAt: 0,
				nonce: "",
				outputs: "",
				output: "",
				force: false,
				json: false,
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "approval-check",
				approvalPath: "/safe/approval.json",
				binding: "b".repeat(64),
				configPath: "/safe/config.json",
				expiresAt: 0,
				outputsPath: "",
				outputPath: "",
				force: false,
				issuedAt: 0,
				json: false,
				nonce: "",
			},
			expect.any(Function),
		);
		expect(process.exitCode).toBe(0);
	});

	it("routes approval-revoke arguments", async () => {
		mockRun.mockResolvedValue({
			status: "success",
			approvalRevoke: {
				status: "ready",
				approval: {
					nonce: "c".repeat(64),
					issuedAt: 1000,
					expiresAt: 601000,
				},
				terminal: "revoked",
			},
		});

		await handlePreparation({
			input: ["preparation", "approval-revoke"],
			flags: {
				approval: "/safe/approval.json",
				binding: "b".repeat(64),
				config: "/safe/config.json",
				expiresAt: 0,
				issuedAt: 0,
				nonce: "",
				outputs: "",
				output: "",
				force: false,
				json: false,
			},
		} as CLI);

		expect(mockRun).toHaveBeenCalledWith(
			{
				action: "approval-revoke",
				approvalPath: "/safe/approval.json",
				binding: "b".repeat(64),
				configPath: "/safe/config.json",
				expiresAt: 0,
				outputsPath: "",
				outputPath: "",
				force: false,
				issuedAt: 0,
				json: false,
				nonce: "",
			},
			expect.any(Function),
		);
		expect(process.exitCode).toBe(0);
	});
});
