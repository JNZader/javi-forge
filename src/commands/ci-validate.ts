/**
 * `javi-forge ci validate` — dry validation of `.javi-forge/ci.yaml`.
 *
 * Pure parse-and-report over the existing validator (src/lib/ci-config.ts):
 * resolve the config path (same discovery `runCI` uses), call `loadCIConfig`,
 * and return a structured result. It NEVER builds images, runs Docker, or
 * executes any phase — the CLI surface stops BEFORE execution.
 */

import fs from "fs-extra";
import {
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

/** One validated gate, reduced to what the report shows. */
export interface CIValidateGateSummary {
	id: string;
	mode: string;
	scope: string;
	/** Container image ref, present ONLY when the gate declares one. */
	image?: string;
}

export interface CIValidateOk {
	ok: true;
	/**
	 * "config" — a config file was found and validated.
	 * "auto-detect" — no config exists and none was explicitly requested, so
	 * `runCI` would use its zero-config single-runner auto-detect path
	 * (ci.ts:396-406). There is nothing to validate, and that is valid.
	 */
	mode: "config" | "auto-detect";
	/** Resolved config path, or null in auto-detect mode. */
	configPath: string | null;
	runners: CIValidateRunnerSummary[];
	/** Declared gates (version 2). Empty when none are declared. */
	gates: CIValidateGateSummary[];
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
	// Discriminator: was a config path explicitly requested (`--config`)?
	//   - explicit path that is missing → ERROR (the user asserted a file that
	//     isn't there).
	//   - discovery finds nothing → VALID auto-detect: `runCI` runs fine in this
	//     exact state via its zero-config single-runner path (ci.ts:396-406), so
	//     there is nothing to validate and that is not a failure.
	let configPath: string;
	if (config) {
		if (!(await fs.pathExists(config))) {
			return {
				ok: false,
				configPath: config,
				errors: [{ path: config, message: `no CI config found at ${config}` }],
			};
		}
		configPath = config;
	} else {
		const discovered = await findCIConfig(projectDir);
		if (!discovered) {
			return {
				ok: true,
				mode: "auto-detect",
				configPath: null,
				runners: [],
				gates: [],
			};
		}
		configPath = discovered;
	}

	try {
		const ciConfig = await loadCIConfig(configPath);
		return {
			ok: true,
			mode: "config",
			configPath,
			runners: ciConfig.runners.map((r) => ({
				name: r.name,
				stack: r.stack,
			})),
			gates: (ciConfig.gates ?? []).map((g) => ({
				id: g.id,
				mode: g.mode,
				scope: g.scope,
				// Surface `image` ONLY when declared, so an image-less gate summary
				// stays byte-identical to today (no `image` key).
				...(g.image !== undefined ? { image: g.image } : {}),
			})),
		};
	} catch (e) {
		if (e instanceof CIConfigError) {
			return { ok: false, configPath, errors: e.errors };
		}
		throw e;
	}
}
