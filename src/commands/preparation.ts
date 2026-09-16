import { readFile, writeFile } from "node:fs/promises";
import {
	createPreparationProductionConfigTemplate,
	inspectPreparationProductionBinding,
	inspectPreparationProductionPreflight,
	PREPARATION_PREFLIGHT_STATUS,
	type PreparationPreflightResult,
	type PreparationProductionBindingResult,
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
	BIND: "bind",
	TEMPLATE: "template",
	PREFLIGHT: "preflight",
} as const;

export interface PreparationCommandRequest {
	action?: string;
	configPath?: string;
	outputsPath?: string;
	outputPath?: string;
	force: boolean;
	json: boolean;
}

export interface PreparationCommandResult {
	status: PreparationCommandStatus;
	preflight?: PreparationPreflightResult;
	binding?: PreparationProductionBindingResult;
	outputPath?: string;
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
		"  javi-forge preparation template --output <path> [--force]",
		"  javi-forge preparation preflight --config <path> [--json]",
		"  javi-forge preparation bind --config <path> --outputs <path> [--json]",
	].join("\n");
}

function detail(preflight: PreparationProductionBindingResult): string {
	return [
		`status: ${preflight.status}`,
		...(preflight.binding ? [`binding: ${preflight.binding}`] : []),
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
	if (!path) throw new Error("preparation requires --config <path>");
	try {
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error("preparation config is not valid JSON");
		}
		throw error;
	}
}

async function readOutputs(outputsPath?: string): Promise<unknown> {
	const path = outputsPath?.trim();
	if (!path) throw new Error("bind requires --outputs <path>");
	try {
		return JSON.parse(await readFile(path, "utf8")) as unknown;
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error("preparation outputs are not valid JSON");
		}
		throw error;
	}
}

async function writeConfigTemplate(
	outputPath: string | undefined,
	force: boolean,
): Promise<string> {
	const path = outputPath?.trim();
	if (!path) throw new Error("template requires --output <path>");
	await writeFile(
		path,
		`${JSON.stringify(createPreparationProductionConfigTemplate(), null, 2)}\n`,
		{
			flag: force ? "w" : "wx",
			mode: 0o600,
		},
	);
	return path;
}

export async function runPreparationCommand(
	request: PreparationCommandRequest,
	onStep: StepCallback,
): Promise<PreparationCommandResult> {
	if (
		request.action !== PREPARATION_ACTION.BIND &&
		request.action !== PREPARATION_ACTION.PREFLIGHT &&
		request.action !== PREPARATION_ACTION.TEMPLATE
	) {
		report(onStep, "preparation-usage", "Preparation", "error", usage());
		return { status: PREPARATION_COMMAND_STATUS.FAILURE, error: usage() };
	}

	try {
		if (request.action === PREPARATION_ACTION.TEMPLATE) {
			report(
				onStep,
				"preparation-template",
				"Preparation config template",
				"running",
			);
			const outputPath = await writeConfigTemplate(
				request.outputPath,
				request.force,
			);
			report(
				onStep,
				"preparation-template",
				"Preparation config template",
				"done",
				`wrote ${outputPath}\nside effects: wrote template only; no worker execution, approval verification, approval consumption, staging, model call, deploy, publish, or release`,
			);
			return { status: PREPARATION_COMMAND_STATUS.SUCCESS, outputPath };
		}

		if (request.action === PREPARATION_ACTION.BIND) {
			report(
				onStep,
				"preparation-binding",
				"Preparation production binding",
				"running",
			);
			const config = await readConfig(request.configPath);
			const outputs = await readOutputs(request.outputsPath);
			const binding = inspectPreparationProductionBinding(config, outputs);
			const ok = binding.status === PREPARATION_PREFLIGHT_STATUS.READY;
			report(
				onStep,
				"preparation-binding",
				"Preparation production binding",
				ok ? "done" : "error",
				detail(binding),
			);
			return {
				status: ok
					? PREPARATION_COMMAND_STATUS.SUCCESS
					: PREPARATION_COMMAND_STATUS.FAILURE,
				binding,
			};
		}

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
