/**
 * Versioned mixed-runner CI config (`.javi-forge/ci.yaml`) — schema and loader.
 *
 * Hybrid repositories declare every required runner explicitly and in order.
 * Single-stack repositories need no config: auto-detection stays the default.
 *
 * Validation is fail-closed: any schema violation produces a CIConfigError
 * listing every problem, and no partially-valid config is ever returned.
 * YAML parsing uses the `yaml` package, already a runtime dependency.
 */

import path from "node:path";
import fs from "fs-extra";
import YAML from "yaml";
import type { Stack } from "../types/index.js";

// =============================================================================
// Types
// =============================================================================

export const CI_CONFIG_VERSION = 1;

/** Default config locations, in discovery order, relative to the project root. */
export const CI_CONFIG_CANDIDATES = [
	".javi-forge/ci.yaml",
	".javi-forge/ci.yml",
] as const;

export interface CIRunnerConfig {
	/** Unique runner name (used in step ids and reports) */
	name: string;
	/** Toolchain stack — selects the default CI image and default commands */
	stack: Stack;
	/** Working directory relative to the project root (default: ".") */
	directory: string;
	/** Explicit container image (mutually exclusive with `buildContext`) */
	image?: string;
	/** Docker build context directory (mutually exclusive with `image`) */
	buildContext?: string;
	/** Dependency setup commands, run before lint/build/test */
	setup: string[];
	lint: string[];
	build: string[];
	test: string[];
	security: string[];
	/** Tools that must exist in the runner environment (validated fail-closed) */
	requires: string[];
}

export interface CIConfig {
	version: number;
	runners: CIRunnerConfig[];
}

export interface CIConfigValidationError {
	path: string;
	message: string;
}

export class CIConfigError extends Error {
	readonly errors: CIConfigValidationError[];

	constructor(errors: CIConfigValidationError[], source?: string) {
		const where = source ? ` in ${source}` : "";
		const lines = errors.map((e) => `  - ${e.path}: ${e.message}`).join("\n");
		super(`Invalid CI config${where}:\n${lines}`);
		this.name = "CIConfigError";
		this.errors = errors;
	}
}

// =============================================================================
// Validation
// =============================================================================

const VALID_STACKS: readonly string[] = [
	"node",
	"python",
	"go",
	"rust",
	"java-gradle",
	"java-maven",
	"elixir",
];

/** Stacks accepted by the CI config schema and the --stack override. */
export const CI_STACKS = VALID_STACKS;

const TOP_LEVEL_FIELDS = new Set(["version", "runners"]);
const RUNNER_FIELDS = new Set([
	"name",
	"stack",
	"directory",
	"image",
	"build-context",
	"setup",
	"lint",
	"build",
	"test",
	"security",
	"requires",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeCommands(
	value: unknown,
	fieldPath: string,
	errors: CIConfigValidationError[],
): string[] {
	if (value === undefined) return [];
	if (typeof value === "string") return value.trim() ? [value] : [];
	if (Array.isArray(value)) {
		const bad = value.some((v) => typeof v !== "string" || !v.trim());
		if (!bad) return value as string[];
	}
	errors.push({
		path: fieldPath,
		message: "must be a non-empty string or a list of non-empty strings",
	});
	return [];
}

function normalizeStringList(
	value: unknown,
	fieldPath: string,
	errors: CIConfigValidationError[],
): string[] {
	if (value === undefined) return [];
	if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
		return value as string[];
	}
	errors.push({ path: fieldPath, message: "must be a list of strings" });
	return [];
}

function validateRunner(
	raw: unknown,
	index: number,
	errors: CIConfigValidationError[],
): CIRunnerConfig | null {
	const base = `runners[${index}]`;
	if (!isRecord(raw)) {
		errors.push({ path: base, message: "runner must be an object" });
		return null;
	}

	for (const key of Object.keys(raw)) {
		if (!RUNNER_FIELDS.has(key)) {
			errors.push({
				path: `${base}.${key}`,
				message: `unknown field "${key}"`,
			});
		}
	}

	const name = raw.name;
	if (typeof name !== "string" || !name.trim()) {
		errors.push({
			path: `${base}.name`,
			message: "name is required and must be a non-empty string",
		});
	}

	const stack = raw.stack;
	if (typeof stack !== "string" || !VALID_STACKS.includes(stack)) {
		errors.push({
			path: `${base}.stack`,
			message: `stack is required and must be one of: ${VALID_STACKS.join(", ")}`,
		});
	}

	let directory = ".";
	if (raw.directory !== undefined) {
		if (typeof raw.directory !== "string" || !raw.directory.trim()) {
			errors.push({
				path: `${base}.directory`,
				message: "directory must be a non-empty string",
			});
		} else {
			const normalized = path.posix.normalize(raw.directory);
			if (
				path.isAbsolute(raw.directory) ||
				normalized === ".." ||
				normalized.startsWith("../")
			) {
				errors.push({
					path: `${base}.directory`,
					message: "directory must stay inside the project root",
				});
			} else {
				directory = normalized;
			}
		}
	}

	let image: string | undefined;
	if (raw.image !== undefined) {
		if (typeof raw.image !== "string" || !raw.image.trim()) {
			errors.push({
				path: `${base}.image`,
				message: "image must be a non-empty string",
			});
		} else {
			image = raw.image;
		}
	}

	let buildContext: string | undefined;
	if (raw["build-context"] !== undefined) {
		if (
			typeof raw["build-context"] !== "string" ||
			!raw["build-context"].trim()
		) {
			errors.push({
				path: `${base}.build-context`,
				message: "build-context must be a non-empty string (directory)",
			});
		} else {
			buildContext = raw["build-context"];
		}
	}

	if (image && buildContext) {
		errors.push({
			path: `${base}.image`,
			message: "image and build-context are mutually exclusive — set only one",
		});
	}

	// If anything failed, the caller discards all runners (fail closed).
	return {
		name: typeof name === "string" ? name.trim() : "",
		stack: stack as Stack,
		directory,
		image,
		buildContext,
		setup: normalizeCommands(raw.setup, `${base}.setup`, errors),
		lint: normalizeCommands(raw.lint, `${base}.lint`, errors),
		build: normalizeCommands(raw.build, `${base}.build`, errors),
		test: normalizeCommands(raw.test, `${base}.test`, errors),
		security: normalizeCommands(raw.security, `${base}.security`, errors),
		requires: normalizeStringList(raw.requires, `${base}.requires`, errors),
	};
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse and validate CI config YAML text. Throws CIConfigError listing every
 * validation problem; never returns a partially valid config.
 */
export function parseCIConfig(rawYaml: string, source?: string): CIConfig {
	let doc: unknown;
	try {
		doc = YAML.parse(rawYaml);
	} catch (e) {
		throw new CIConfigError(
			[
				{
					path: "<document>",
					message: `invalid YAML: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`,
				},
			],
			source,
		);
	}

	const errors: CIConfigValidationError[] = [];

	if (!isRecord(doc)) {
		throw new CIConfigError(
			[{ path: "<document>", message: "config must be a YAML object/mapping" }],
			source,
		);
	}

	for (const key of Object.keys(doc)) {
		if (!TOP_LEVEL_FIELDS.has(key)) {
			errors.push({ path: key, message: `unknown field "${key}"` });
		}
	}

	if (doc.version !== CI_CONFIG_VERSION) {
		errors.push({
			path: "version",
			message: `version is required and must be the number ${CI_CONFIG_VERSION}`,
		});
	}

	if (!Array.isArray(doc.runners) || doc.runners.length === 0) {
		errors.push({
			path: "runners",
			message: "runners is required and must be a non-empty list",
		});
	}

	const runners: CIRunnerConfig[] = [];
	if (Array.isArray(doc.runners)) {
		doc.runners.forEach((raw, index) => {
			const runner = validateRunner(raw, index, errors);
			if (runner) runners.push(runner);
		});

		const seen = new Set<string>();
		for (const runner of runners) {
			if (!runner.name) continue;
			if (seen.has(runner.name)) {
				errors.push({
					path: "runners",
					message: `duplicate runner name "${runner.name}"`,
				});
			}
			seen.add(runner.name);
		}
	}

	if (errors.length > 0) {
		throw new CIConfigError(errors, source);
	}

	return { version: CI_CONFIG_VERSION, runners };
}

/**
 * Load and validate a CI config file. Fails closed: a missing file or any
 * validation error throws — no config is ever silently ignored.
 */
export async function loadCIConfig(configPath: string): Promise<CIConfig> {
	if (!(await fs.pathExists(configPath))) {
		throw new CIConfigError([
			{ path: configPath, message: "config file not found" },
		]);
	}
	const raw = await fs.readFile(configPath, "utf-8");
	return parseCIConfig(raw, configPath);
}

/**
 * Discover the default CI config for a project directory.
 * Returns the config path, or null when the project has no config
 * (single-stack auto-detection stays the default).
 */
export async function findCIConfig(projectDir: string): Promise<string | null> {
	for (const candidate of CI_CONFIG_CANDIDATES) {
		const candidatePath = path.join(projectDir, candidate);
		if (await fs.pathExists(candidatePath)) return candidatePath;
	}
	return null;
}
