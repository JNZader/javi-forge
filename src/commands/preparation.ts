import { readFile } from "node:fs/promises";
import {
	inspectPreparationProductionPreflight,
	PREPARATION_PREFLIGHT_STATUS,
	type PreparationPreflightResult,
} from "../lib/preparation-production.js";
import type { InitStep } from "../types/index.js";

type StepCallback = (step: InitStep) => void;

export const PREPARATION_COMMAND_STATUS = {
	SUCCESS: "success",
	FAILURE: "failure",
} as const;

export type PreparationCommandStatus =
	(typeof PREPARATION_COMMAND_STATUS)[keyof typeof PREPARATION_COMMAND_STATUS];

export const PREPARATION_ACTION = {
	PREFLIGHT: "preflight",
} as const;

export interface PreparationCommandRequest {
	action?: string;
	configPath?: string;
	json: boolean;
}

export interface PreparationCommandResult {
	status: PreparationCommandStatus;
	preflight?: PreparationPreflightResult;
	error?: string;
}

function report(
	onStep: StepCallback,
	id: string,
	label: string,
	status: InitStep["status"],
	detail?: string,
): void {
	onStep({ id, label, status, detail });
}

function usage(): string {
	return [
		"Usage:",
		"  javi-forge preparation preflight --config <path> [--json]",
	].join("\n");
}

function detail(preflight: PreparationPreflightResult): string {
	return [
		`status: ${preflight.status}`,
		...(preflight.reason ? [`reason: ${preflight.reason}`] : []),
		...(preflight.measurements
			? [
					"measurements:",
					`  executable: ${preflight.measurements.executableDigest}`,
					`  code: ${preflight.measurements.codeDigest}`,
					`  dependencies: ${preflight.measurements.dependenciesDigest}`,
					`  launcher: ${preflight.measurements.launcherDigest}`,
				]
			: []),
		"side effects: none; no worker execution, approval verification, approval consumption, staging, model call, deploy, publish, or release",
	].join("\n");
}

async function readConfig(configPath?: string): Promise<unknown> {
	const path = configPath?.trim();
	if (!path) throw new Error("preflight requires --config <path>");
	try {
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error("preflight config is not valid JSON");
		}
		throw error;
	}
}

export async function runPreparationCommand(
	request: PreparationCommandRequest,
	onStep: StepCallback,
): Promise<PreparationCommandResult> {
	if (request.action !== PREPARATION_ACTION.PREFLIGHT) {
		report(onStep, "preparation-usage", "Preparation", "error", usage());
		return { status: PREPARATION_COMMAND_STATUS.FAILURE, error: usage() };
	}

	try {
		report(
			onStep,
			"preparation-preflight",
			"Preparation production preflight",
			"running",
		);
		const config = await readConfig(request.configPath);
		const preflight = inspectPreparationProductionPreflight(config);
		const ok = preflight.status === PREPARATION_PREFLIGHT_STATUS.READY;
		report(
			onStep,
			"preparation-preflight",
			"Preparation production preflight",
			ok ? "done" : "error",
			detail(preflight),
		);
		return {
			status: ok
				? PREPARATION_COMMAND_STATUS.SUCCESS
				: PREPARATION_COMMAND_STATUS.FAILURE,
			preflight,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		report(
			onStep,
			"preparation-error",
			"Preparation production preflight",
			"error",
			message,
		);
		return { status: PREPARATION_COMMAND_STATUS.FAILURE, error: message };
	}
}
