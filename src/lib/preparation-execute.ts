import { createPublicKey } from "node:crypto";
import { lstatSync } from "node:fs";
import { ApprovalAuthority } from "./preparation-authorization.js";
import { POLICY } from "./preparation-capability.js";
import {
	captureWorker,
	createPreparationExecutor,
} from "./preparation-executor.js";
import {
	PREPARATION_PREFLIGHT_REASON,
	type PreparationProductionConfig,
	parsePreparationProductionConfig,
} from "./preparation-production.js";

export interface PreparationExecuteResult {
	status: "prepared" | "denied";
	reason?: string;
	consumed: boolean;
	audit: string[];
	cleanup?: string;
}

export interface PreparationExecuteDeps {
	cwd?: string;
	destExists?: (destination: string) => boolean;
	runPinnedWorker?: (
		config: PreparationProductionConfig,
		outputs: Readonly<Record<string, string>>,
		approvalEvidence: string,
	) => Promise<PreparationExecuteResult>;
}

function destinationPresent(destination: string): boolean {
	try {
		const seen = lstatSync(destination);
		return !seen.isSymbolicLink();
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return false;
		}
		throw error;
	}
}

export async function defaultRunPinnedWorker(
	config: PreparationProductionConfig,
	outputs: Readonly<Record<string, string>>,
	approvalEvidence: string,
): Promise<PreparationExecuteResult> {
	const worker = captureWorker({
		executable: config.workerExecutable,
		executableDigest: config.workerExecutableDigest,
		source: config.workerSource,
		sourceDigest: config.workerSourceDigest,
		launcher: config.launcher,
		launcherDigest: config.launcherDigest,
	});
	const executor = createPreparationExecutor(worker, outputs);
	try {
		const authority = new ApprovalAuthority(
			createPublicKey(config.publicKeyPem),
			config.stateDirectory,
		);
		try {
			const result = await executor.execute(authority, approvalEvidence);
			return {
				status: result.status === "prepared" ? "prepared" : "denied",
				consumed: result.audit.includes("consumed"),
				audit: result.audit,
				cleanup: result.cleanup,
			};
		} finally {
			authority.close();
		}
	} finally {
		executor.close();
	}
}

export async function runPreparationExecute(
	configInput: unknown,
	outputs: Readonly<Record<string, string>>,
	approvalEvidence: string,
	deps: PreparationExecuteDeps = {},
): Promise<PreparationExecuteResult> {
	const config = parsePreparationProductionConfig(configInput);
	if (config.cwd !== POLICY.cwd || config.destination !== POLICY.destination) {
		return {
			status: "denied",
			reason: PREPARATION_PREFLIGHT_REASON.POLICY_MISMATCH,
			consumed: false,
			audit: [],
		};
	}
	const cwd = deps.cwd ?? process.cwd();
	if (cwd !== config.cwd) {
		return {
			status: "denied",
			reason: PREPARATION_PREFLIGHT_REASON.RUNTIME_UNAVAILABLE,
			consumed: false,
			audit: [],
		};
	}
	const exists = deps.destExists ?? destinationPresent;
	if (exists(config.destination)) {
		return {
			status: "denied",
			reason: PREPARATION_PREFLIGHT_REASON.DESTINATION_PRESENT,
			consumed: false,
			audit: [],
		};
	}
	const run = deps.runPinnedWorker ?? defaultRunPinnedWorker;
	return await run(config, outputs, approvalEvidence);
}
