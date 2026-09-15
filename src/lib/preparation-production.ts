import { createPublicKey } from "node:crypto";
import { lstatSync } from "node:fs";
import { POLICY } from "./preparation-capability.js";
import { captureWorker } from "./preparation-executor.js";
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
	RUNTIME_UNAVAILABLE: "runtime-unavailable",
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

function inspectPublicKey(publicKeyPem: string): boolean {
	try {
		const key = createPublicKey(publicKeyPem);
		return key.type === "public" && key.asymmetricKeyType === "ed25519";
	} catch {
		return false;
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
		if (!inspectPublicKey(config.publicKeyPem)) {
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
	} catch {
		return unavailable(PREPARATION_PREFLIGHT_REASON.RUNTIME_UNAVAILABLE);
	} finally {
		close(controlDirectory);
		close(stateDirectory);
	}
}
