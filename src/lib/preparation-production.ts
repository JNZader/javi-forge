import { createPublicKey, type KeyObject } from "node:crypto";
import { lstatSync } from "node:fs";
import {
	ApprovalAuthority,
	type ApprovalPayload,
} from "./preparation-authorization.js";
import { OUTPUTS, POLICY } from "./preparation-capability.js";
import {
	bindPreparationRuntime,
	captureWorker,
} from "./preparation-executor.js";
import { ProtectedDirectory } from "./preparation-stager.js";

export const PREPARATION_PREFLIGHT_STATUS = {
	READY: "ready",
	UNAVAILABLE: "unavailable",
	DENIED: "denied",
} as const;

export const PREPARATION_PREFLIGHT_REASON = {
	INVALID_CONFIG: "invalid-config",
	POLICY_MISMATCH: "policy-mismatch",
	PUBLIC_KEY_UNAVAILABLE: "public-key-unavailable",
	STATE_DIRECTORY_UNSAFE: "state-directory-unsafe",
	CONTROL_DIRECTORY_UNSAFE: "control-directory-unsafe",
	DESTINATION_PRESENT: "destination-present",
	DESTINATION_UNSAFE: "destination-unsafe",
	APPROVAL_DENIED: "approval-denied",
	RUNTIME_UNAVAILABLE: "runtime-unavailable",
	WORKER_EXECUTABLE_UNAVAILABLE: "worker-executable-unavailable",
	WORKER_SOURCE_UNAVAILABLE: "worker-source-unavailable",
	WORKER_EXECUTABLE_UNSUPPORTED: "worker-executable-unsupported",
	LAUNCHER_UNAVAILABLE: "launcher-unavailable",
} as const;

export type PreparationPreflightStatus =
	(typeof PREPARATION_PREFLIGHT_STATUS)[keyof typeof PREPARATION_PREFLIGHT_STATUS];

export type PreparationPreflightReason =
	(typeof PREPARATION_PREFLIGHT_REASON)[keyof typeof PREPARATION_PREFLIGHT_REASON];

export interface PreparationProductionConfig {
	workerExecutable: string;
	workerExecutableDigest: string;
	workerSource: string;
	workerSourceDigest: string;
	launcher: string;
	launcherDigest: string;
	publicKeyPem: string;
	stateDirectory: string;
	cwd: string;
	destination: string;
}

export interface PreparationProductionPolicy {
	cwd: string;
	destination: string;
	overallMs: number;
	testsMs: number;
}

export interface PreparationPreflightMeasurements {
	executableDigest: string;
	codeDigest: string;
	dependenciesDigest: string;
	launcherDigest: string;
}

export interface PreparationPreflightResult {
	status: PreparationPreflightStatus;
	reason?: PreparationPreflightReason;
	measurements?: PreparationPreflightMeasurements;
}

export interface PreparationProductionBindingResult
	extends PreparationPreflightResult {
	binding?: string;
}

export interface PreparationApprovalCheckResult
	extends PreparationPreflightResult {
	approval?: Pick<ApprovalPayload, "nonce" | "issuedAt" | "expiresAt">;
}

export const PREPARATION_APPROVAL_TERMINAL = {
	REVOKED: "revoked",
} as const;

export type PreparationApprovalTerminal =
	(typeof PREPARATION_APPROVAL_TERMINAL)[keyof typeof PREPARATION_APPROVAL_TERMINAL];

export interface PreparationApprovalRevokeResult
	extends PreparationApprovalCheckResult {
	terminal?: PreparationApprovalTerminal;
}

export interface PreparationProductionConfigTemplateOptions {
	workerExecutable?: string;
	workerSource?: string;
	launcher?: string;
	publicKeyPem?: string;
	stateDirectory?: string;
	policy?: PreparationProductionPolicy;
}

const CONFIG_KEYS = [
	"workerExecutable",
	"workerExecutableDigest",
	"workerSource",
	"workerSourceDigest",
	"launcher",
	"launcherDigest",
	"publicKeyPem",
	"stateDirectory",
	"cwd",
	"destination",
] as const;

const HEX = /^[a-f0-9]{64}$/;
const TEMPLATE_DIGEST = "0".repeat(64);
const TEMPLATE_PUBLIC_KEY =
	"-----BEGIN PUBLIC KEY-----\n<replace-with-ed25519-public-key>\n-----END PUBLIC KEY-----";

function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
	}
	return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>): void {
	if (
		Object.keys(value).sort().join("\0") !== [...CONFIG_KEYS].sort().join("\0")
	) {
		throw new Error(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
	}
}

function stringField(
	value: Record<string, unknown>,
	key: (typeof CONFIG_KEYS)[number],
): string {
	const field = value[key];
	if (typeof field !== "string" || field.length === 0) {
		throw new Error(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
	}
	return field;
}

function digestField(
	value: Record<string, unknown>,
	key: (typeof CONFIG_KEYS)[number],
): string {
	const field = stringField(value, key);
	if (!HEX.test(field)) {
		throw new Error(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
	}
	return field;
}

function preparationOutputs(value: unknown): Readonly<Record<string, string>> {
	const record = object(value);
	if (
		Object.keys(record).sort().join("\0") !== [...OUTPUTS].sort().join("\0")
	) {
		throw new Error(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
	}
	return Object.freeze(
		Object.fromEntries(
			OUTPUTS.map((name) => {
				const output = record[name];
				if (typeof output !== "string") {
					throw new Error(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
				}
				return [name, output];
			}),
		),
	);
}

export function parsePreparationProductionConfig(
	value: unknown,
): PreparationProductionConfig {
	const record = object(value);
	exactKeys(record);
	return Object.freeze({
		workerExecutable: stringField(record, "workerExecutable"),
		workerExecutableDigest: digestField(record, "workerExecutableDigest"),
		workerSource: stringField(record, "workerSource"),
		workerSourceDigest: digestField(record, "workerSourceDigest"),
		launcher: stringField(record, "launcher"),
		launcherDigest: digestField(record, "launcherDigest"),
		publicKeyPem: stringField(record, "publicKeyPem"),
		stateDirectory: stringField(record, "stateDirectory"),
		cwd: stringField(record, "cwd"),
		destination: stringField(record, "destination"),
	});
}

export function createPreparationProductionConfigTemplate(
	options: PreparationProductionConfigTemplateOptions = {},
): PreparationProductionConfig {
	const policy = options.policy ?? POLICY;
	return Object.freeze({
		workerExecutable:
			options.workerExecutable ?? "/absolute/path/to/pinned/preparation-worker",
		workerExecutableDigest: TEMPLATE_DIGEST,
		workerSource:
			options.workerSource ?? "/absolute/path/to/pinned/preparation-worker.c",
		workerSourceDigest: TEMPLATE_DIGEST,
		launcher: options.launcher ?? "/usr/bin/bwrap",
		launcherDigest: TEMPLATE_DIGEST,
		publicKeyPem: options.publicKeyPem ?? TEMPLATE_PUBLIC_KEY,
		stateDirectory:
			options.stateDirectory ??
			"/home/javier/.local/state/javi-forge/preparation",
		cwd: policy.cwd,
		destination: policy.destination,
	});
}

function unavailable(
	reason: PreparationPreflightReason,
): PreparationPreflightResult {
	return { status: PREPARATION_PREFLIGHT_STATUS.UNAVAILABLE, reason };
}

function denied(
	reason: PreparationPreflightReason,
): PreparationPreflightResult {
	return { status: PREPARATION_PREFLIGHT_STATUS.DENIED, reason };
}

function close(directory: ProtectedDirectory | undefined): void {
	try {
		directory?.close();
	} catch {
		/* Preflight result remains sanitized. */
	}
}

const RUNTIME_MEASUREMENT_REASONS = new Set<string>([
	PREPARATION_PREFLIGHT_REASON.WORKER_EXECUTABLE_UNAVAILABLE,
	PREPARATION_PREFLIGHT_REASON.WORKER_SOURCE_UNAVAILABLE,
	PREPARATION_PREFLIGHT_REASON.WORKER_EXECUTABLE_UNSUPPORTED,
	PREPARATION_PREFLIGHT_REASON.LAUNCHER_UNAVAILABLE,
]);

function runtimeMeasurementReason(error: unknown): PreparationPreflightReason {
	if (
		error instanceof Error &&
		RUNTIME_MEASUREMENT_REASONS.has(error.message)
	) {
		return error.message as PreparationPreflightReason;
	}
	return PREPARATION_PREFLIGHT_REASON.RUNTIME_UNAVAILABLE;
}

function productionPublicKey(publicKeyPem: string): KeyObject | undefined {
	try {
		const key = createPublicKey(publicKeyPem);
		if (key.type === "public" && key.asymmetricKeyType === "ed25519") {
			return key;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function inspectPreparationProductionPreflight(
	input: unknown,
	policy: PreparationProductionPolicy = POLICY,
): PreparationPreflightResult {
	let stateDirectory: ProtectedDirectory | undefined;
	let controlDirectory: ProtectedDirectory | undefined;
	try {
		let config: PreparationProductionConfig;
		try {
			config = parsePreparationProductionConfig(input);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
		}
		if (
			config.cwd !== policy.cwd ||
			config.destination !== policy.destination
		) {
			return denied(PREPARATION_PREFLIGHT_REASON.POLICY_MISMATCH);
		}
		if (!productionPublicKey(config.publicKeyPem)) {
			return denied(PREPARATION_PREFLIGHT_REASON.PUBLIC_KEY_UNAVAILABLE);
		}
		try {
			stateDirectory = new ProtectedDirectory(config.stateDirectory);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.STATE_DIRECTORY_UNSAFE);
		}
		try {
			controlDirectory = new ProtectedDirectory(config.cwd);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.CONTROL_DIRECTORY_UNSAFE);
		}
		try {
			const destination = lstatSync(config.destination);
			if (destination.isSymbolicLink()) {
				return denied(PREPARATION_PREFLIGHT_REASON.DESTINATION_UNSAFE);
			}
			return unavailable(PREPARATION_PREFLIGHT_REASON.DESTINATION_PRESENT);
		} catch (error) {
			if (
				!(
					error &&
					typeof error === "object" &&
					"code" in error &&
					error.code === "ENOENT"
				)
			) {
				return denied(PREPARATION_PREFLIGHT_REASON.DESTINATION_UNSAFE);
			}
		}
		const worker = captureWorker({
			executable: config.workerExecutable,
			executableDigest: config.workerExecutableDigest,
			source: config.workerSource,
			sourceDigest: config.workerSourceDigest,
			launcher: config.launcher,
			launcherDigest: config.launcherDigest,
		});
		return {
			status: PREPARATION_PREFLIGHT_STATUS.READY,
			measurements: {
				executableDigest: worker.executableDigest,
				codeDigest: worker.codeDigest,
				dependenciesDigest: worker.dependenciesDigest,
				launcherDigest: worker.launcherDigest,
			},
		};
	} catch (error) {
		return unavailable(runtimeMeasurementReason(error));
	} finally {
		close(controlDirectory);
		close(stateDirectory);
	}
}

export function inspectPreparationProductionBinding(
	input: unknown,
	outputsInput: unknown,
	policy: PreparationProductionPolicy = POLICY,
): PreparationProductionBindingResult {
	let stateDirectory: ProtectedDirectory | undefined;
	let controlDirectory: ProtectedDirectory | undefined;
	try {
		let config: PreparationProductionConfig;
		let outputs: Readonly<Record<string, string>>;
		try {
			config = parsePreparationProductionConfig(input);
			outputs = preparationOutputs(outputsInput);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
		}
		if (
			config.cwd !== policy.cwd ||
			config.destination !== policy.destination
		) {
			return denied(PREPARATION_PREFLIGHT_REASON.POLICY_MISMATCH);
		}
		if (!productionPublicKey(config.publicKeyPem)) {
			return denied(PREPARATION_PREFLIGHT_REASON.PUBLIC_KEY_UNAVAILABLE);
		}
		try {
			stateDirectory = new ProtectedDirectory(config.stateDirectory);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.STATE_DIRECTORY_UNSAFE);
		}
		try {
			controlDirectory = new ProtectedDirectory(config.cwd);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.CONTROL_DIRECTORY_UNSAFE);
		}
		try {
			const destination = lstatSync(config.destination);
			if (destination.isSymbolicLink()) {
				return denied(PREPARATION_PREFLIGHT_REASON.DESTINATION_UNSAFE);
			}
			return unavailable(PREPARATION_PREFLIGHT_REASON.DESTINATION_PRESENT);
		} catch (error) {
			if (
				!(
					error &&
					typeof error === "object" &&
					"code" in error &&
					error.code === "ENOENT"
				)
			) {
				return denied(PREPARATION_PREFLIGHT_REASON.DESTINATION_UNSAFE);
			}
		}
		const worker = captureWorker({
			executable: config.workerExecutable,
			executableDigest: config.workerExecutableDigest,
			source: config.workerSource,
			sourceDigest: config.workerSourceDigest,
			launcher: config.launcher,
			launcherDigest: config.launcherDigest,
		});
		const binding = bindPreparationRuntime(
			worker,
			outputs,
			controlDirectory,
			{ overallMs: policy.overallMs, testsMs: policy.testsMs },
			false,
		);
		return {
			status: PREPARATION_PREFLIGHT_STATUS.READY,
			binding: binding.binding,
			measurements: {
				executableDigest: worker.executableDigest,
				codeDigest: worker.codeDigest,
				dependenciesDigest: worker.dependenciesDigest,
				launcherDigest: worker.launcherDigest,
			},
		};
	} catch (error) {
		return unavailable(runtimeMeasurementReason(error));
	} finally {
		close(controlDirectory);
		close(stateDirectory);
	}
}

export function inspectPreparationApprovalCheck(
	input: unknown,
	binding: string,
	approvalEvidence: string,
	now = Date.now(),
	policy: PreparationProductionPolicy = POLICY,
): PreparationApprovalCheckResult {
	let authority: ApprovalAuthority | undefined;
	try {
		let config: PreparationProductionConfig;
		try {
			config = parsePreparationProductionConfig(input);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
		}
		if (
			config.cwd !== policy.cwd ||
			config.destination !== policy.destination
		) {
			return denied(PREPARATION_PREFLIGHT_REASON.POLICY_MISMATCH);
		}
		const publicKey = productionPublicKey(config.publicKeyPem);
		if (!publicKey) {
			return denied(PREPARATION_PREFLIGHT_REASON.PUBLIC_KEY_UNAVAILABLE);
		}
		try {
			authority = new ApprovalAuthority(publicKey, config.stateDirectory);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.STATE_DIRECTORY_UNSAFE);
		}
		try {
			const approval = authority.verify(approvalEvidence, binding, now);
			return {
				status: PREPARATION_PREFLIGHT_STATUS.READY,
				approval: {
					nonce: approval.payload.nonce,
					issuedAt: approval.payload.issuedAt,
					expiresAt: approval.payload.expiresAt,
				},
			};
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.APPROVAL_DENIED);
		}
	} finally {
		authority?.close();
	}
}

export function inspectPreparationApprovalRevocation(
	input: unknown,
	binding: string,
	approvalEvidence: string,
	now = Date.now(),
	policy: PreparationProductionPolicy = POLICY,
): PreparationApprovalRevokeResult {
	let authority: ApprovalAuthority | undefined;
	try {
		let config: PreparationProductionConfig;
		try {
			config = parsePreparationProductionConfig(input);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.INVALID_CONFIG);
		}
		if (
			config.cwd !== policy.cwd ||
			config.destination !== policy.destination
		) {
			return denied(PREPARATION_PREFLIGHT_REASON.POLICY_MISMATCH);
		}
		const publicKey = productionPublicKey(config.publicKeyPem);
		if (!publicKey) {
			return denied(PREPARATION_PREFLIGHT_REASON.PUBLIC_KEY_UNAVAILABLE);
		}
		try {
			authority = new ApprovalAuthority(publicKey, config.stateDirectory);
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.STATE_DIRECTORY_UNSAFE);
		}
		try {
			const approval = authority.verify(approvalEvidence, binding, now);
			authority.revoke(approval, now);
			return {
				status: PREPARATION_PREFLIGHT_STATUS.READY,
				approval: {
					nonce: approval.payload.nonce,
					issuedAt: approval.payload.issuedAt,
					expiresAt: approval.payload.expiresAt,
				},
				terminal: PREPARATION_APPROVAL_TERMINAL.REVOKED,
			};
		} catch {
			return denied(PREPARATION_PREFLIGHT_REASON.APPROVAL_DENIED);
		}
	} finally {
		authority?.close();
	}
}
