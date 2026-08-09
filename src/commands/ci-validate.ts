/**
 * `javi-forge ci validate` — dry validation of `.javi-forge/ci.yaml`.
 *
 * Pure parse-and-report over the existing validator (src/lib/ci-config.ts):
 * resolve the config path (same discovery `runCI` uses), call `loadCIConfig`,
 * and return a structured result. It NEVER builds images, runs Docker, or
 * executes any phase — the CLI surface stops BEFORE execution.
 */

import path from "node:path";
import fs from "fs-extra";
import {
	CI_CONFIG_CANDIDATES,
	CIConfigError,
	type CIConfigValidationError,
	findCIConfig,
	loadCIConfig,
} from "../lib/ci-config.js";

/** One validated runner, reduced to what the report shows. */
export interface CIValidateRunnerSummary {
	name: string;
	stack: string;
}

export interface CIValidateOk {
	ok: true;
	configPath: string;
	runners: CIValidateRunnerSummary[];
}

export interface CIValidateErr {
	ok: false;
	/** Resolved path we looked at, or null when discovery found nothing. */
	configPath: string | null;
	errors: CIConfigValidationError[];
}

export type CIValidateResult = CIValidateOk | CIValidateErr;

/**
 * Validate a project's CI config without executing anything.
 *
 * @param projectDir Project root to discover `.javi-forge/ci.yaml` in.
 * @param config Optional explicit config path (from `--config`).
 */
export async function validateCIConfig(
	projectDir: string,
	config?: string,
): Promise<CIValidateResult> {
	const configPath = config ?? (await findCIConfig(projectDir));

	// Missing file → a clear named error, never a stack trace. Covers both the
	// zero-config case (discovery found nothing) and an explicit path that does
	// not exist.
	if (!configPath || !(await fs.pathExists(configPath))) {
		const where = configPath ?? path.join(projectDir, CI_CONFIG_CANDIDATES[0]);
		return {
			ok: false,
			configPath,
			errors: [
				{ path: where, message: `no .javi-forge/ci.yaml found at ${where}` },
			],
		};
	}

	try {
		const ciConfig = await loadCIConfig(configPath);
		return {
			ok: true,
			configPath,
			runners: ciConfig.runners.map((r) => ({
				name: r.name,
				stack: r.stack,
			})),
		};
	} catch (e) {
		if (e instanceof CIConfigError) {
			return { ok: false, configPath, errors: e.errors };
		}
		throw e;
	}
}
