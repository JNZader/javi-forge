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

/** Config schema versions this loader accepts. v2 is additive (unlocks gates). */
export const CI_CONFIG_VERSIONS: readonly number[] = [1, 2];

/** Gate outcome mode: a blocking gate fails the build, informative degrades. */
export const GATE_MODE = {
	BLOCKING: "blocking",
	INFORMATIVE: "informative",
} as const;
export type GateMode = (typeof GATE_MODE)[keyof typeof GATE_MODE];

/** Gate file scope: all files, or only the changed set (slice 4 wiring). */
export const GATE_SCOPE = {
	ALL: "all",
	CHANGED: "changed",
} as const;
export type GateScope = (typeof GATE_SCOPE)[keyof typeof GATE_SCOPE];

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

/** A declarable named quality gate (version 2 only). Runs host-native. */
export interface CIGateConfig {
	/** Unique, tag-safe identifier (reuses RUNNER_NAME_RE). */
	id: string;
	/** Command(s) to run — string or list, normalized to a list. */
	run: string[];
	/** blocking (default) fails the build; informative degrades to a warning. */
	mode: GateMode;
	/** all (default) or changed — the file scope the gate cares about. */
	scope: GateScope;
	/** Optional baseline artifact path (slice 4). */
	baseline?: string;
	/** Optional env injected via the child-process env map (slice 4). */
	env?: Record<string, string>;
	/**
	 * Optional container image ref (containerized-gates). A plain,
	 * digest-pinnable image ref; when present the gate runs inside this image
	 * instead of host-native. Omitted → host-native (unchanged). Execution
	 * routing lands in a later slice; this slice validates the schema only.
	 */
	image?: string;
	/**
	 * Optional per-command wall-clock timeout in seconds (GATE-2). When set, a
	 * command exceeding it is killed and the gate FAILS (non-zero). Omitted →
	 * no timeout (unchanged behavior).
	 */
	timeout?: number;
}

/** pre-commit hook feature toggles (version 2 only). */
export interface CIHookCommitConfig {
	/** quick native CI gate (default true when `hooks:` is present) */
	ci: boolean;
	/** run the stack test command */
	tdd: boolean;
	/** L1 secret scan */
	secrets: boolean;
	/** L3 permission boundaries */
	permissions: boolean;
}

/** pre-push hook feature toggles (version 2 only). */
export interface CIHookPushConfig {
	/** quick native CI gate (default true when `hooks:` is present) */
	ci: boolean;
	/** run the stack test command — false | "strict" | "warn" ("warn" = advisory) */
	tdd: boolean | "strict" | "warn";
	/** L2 dependency audit */
	deps: boolean;
}

/**
 * Parsed `hooks:` section. Every hook is always present with defaults applied
 * (ci on, every other feature off) so the dispatcher never branches on absence.
 */
export interface CIHooksConfig {
	preCommit: CIHookCommitConfig;
	prePush: CIHookPushConfig;
}

export interface CIConfig {
	version: number;
	runners: CIRunnerConfig[];
	/** Present only under version 2 when `gates:` is declared. */
	gates?: CIGateConfig[];
	/** Present only under version 2 when `hooks:` is declared. */
	hooks?: CIHooksConfig;
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

/** Runner names become docker image tags — keep them tag-safe. */
const RUNNER_NAME_RE = /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/;

/** Required tools are checked via `command -v <tool>` — no shell metachars. */
const TOOL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._+~-]*$/;
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

/**
 * Validate an optional container `image` ref shared by the runner and gate
 * paths (IMG-1). Rejects non-string / empty-after-trim and leading-dash refs
 * (an image like "--privileged" or "-v /:/host" would be parsed by `docker run`
 * as a FLAG, not an image, if it reached argv — JDB-004) with a named error at
 * `fieldPath`. Returns the TRIMMED value to store, so a whitespace-padded ref
 * fails cleanly at validation instead of reaching docker argv untrimmed.
 * Returns undefined when the field is absent or invalid.
 */
function validateImageRef(
	value: unknown,
	fieldPath: string,
	errors: CIConfigValidationError[],
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !value.trim()) {
		errors.push({
			path: fieldPath,
			message: "image must be a non-empty string",
		});
		return undefined;
	}
	const trimmed = value.trim();
	if (trimmed.startsWith("-")) {
		errors.push({
			path: fieldPath,
			message:
				"image must not start with '-' (would be parsed as a docker flag)",
		});
		return undefined;
	}
	return trimmed;
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
	} else if (!RUNNER_NAME_RE.test(name.trim())) {
		errors.push({
			path: `${base}.name`,
			message:
				"name must start with a letter, digit or underscore and contain only [a-zA-Z0-9._-] (it is used as a docker image tag)",
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

	const image = validateImageRef(raw.image, `${base}.image`, errors);

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

	const requires = normalizeStringList(
		raw.requires,
		`${base}.requires`,
		errors,
	);
	for (const tool of requires) {
		if (!TOOL_NAME_RE.test(tool)) {
			errors.push({
				path: `${base}.requires`,
				message: `requires entry "${tool}" has unsafe characters — expected a plain tool name like python, ruff or node`,
			});
		}
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
		requires,
	};
}

const GATE_FIELDS = new Set([
	"id",
	"run",
	"mode",
	"scope",
	"baseline",
	"env",
	"image",
	"timeout",
]);

function validateGate(
	raw: unknown,
	index: number,
	errors: CIConfigValidationError[],
): CIGateConfig | null {
	const base = `gates[${index}]`;
	if (!isRecord(raw)) {
		errors.push({ path: base, message: "gate must be an object" });
		return null;
	}

	for (const key of Object.keys(raw)) {
		if (!GATE_FIELDS.has(key)) {
			errors.push({
				path: `${base}.${key}`,
				message: `unknown field "${key}"`,
			});
		}
	}

	const id = raw.id;
	if (typeof id !== "string" || !id.trim()) {
		errors.push({
			path: `${base}.id`,
			message: "id is required and must be a non-empty string",
		});
	} else if (!RUNNER_NAME_RE.test(id.trim())) {
		errors.push({
			path: `${base}.id`,
			message:
				"id must start with a letter, digit or underscore and contain only [a-zA-Z0-9._-] (it is used as a tag)",
		});
	}

	const run = normalizeCommands(raw.run, `${base}.run`, errors);
	if (raw.run === undefined) {
		errors.push({
			path: `${base}.run`,
			message:
				"run is required and must be a non-empty string or a list of non-empty strings",
		});
	} else if (
		run.length === 0 &&
		!errors.some((e) => e.path === `${base}.run`)
	) {
		errors.push({
			path: `${base}.run`,
			message: "run must be a non-empty string or a list of non-empty strings",
		});
	}

	let mode: GateMode = GATE_MODE.BLOCKING;
	if (raw.mode !== undefined) {
		if (raw.mode === GATE_MODE.BLOCKING || raw.mode === GATE_MODE.INFORMATIVE) {
			mode = raw.mode;
		} else {
			errors.push({
				path: `${base}.mode`,
				message: `mode must be one of: ${GATE_MODE.BLOCKING}, ${GATE_MODE.INFORMATIVE} (got "${String(raw.mode)}")`,
			});
		}
	}

	let scope: GateScope = GATE_SCOPE.ALL;
	if (raw.scope !== undefined) {
		if (raw.scope === GATE_SCOPE.ALL || raw.scope === GATE_SCOPE.CHANGED) {
			scope = raw.scope;
		} else {
			errors.push({
				path: `${base}.scope`,
				message: `scope must be one of: ${GATE_SCOPE.ALL}, ${GATE_SCOPE.CHANGED} (got "${String(raw.scope)}")`,
			});
		}
	}

	let baseline: string | undefined;
	if (raw.baseline !== undefined) {
		if (typeof raw.baseline !== "string" || !raw.baseline.trim()) {
			errors.push({
				path: `${base}.baseline`,
				message: "baseline must be a non-empty string (path)",
			});
		} else {
			baseline = raw.baseline;
		}
	}

	let env: Record<string, string> | undefined;
	if (raw.env !== undefined) {
		if (!isRecord(raw.env)) {
			errors.push({
				path: `${base}.env`,
				message: "env must be a mapping of string keys to string values",
			});
		} else if (Object.values(raw.env).some((v) => typeof v !== "string")) {
			errors.push({
				path: `${base}.env`,
				message: "env values must all be strings",
			});
		} else {
			env = raw.env as Record<string, string>;
		}
	}

	const image = validateImageRef(raw.image, `${base}.image`, errors);

	let timeout: number | undefined;
	if (raw.timeout !== undefined) {
		if (
			typeof raw.timeout !== "number" ||
			!Number.isFinite(raw.timeout) ||
			raw.timeout <= 0
		) {
			errors.push({
				path: `${base}.timeout`,
				message: `timeout must be a positive number of seconds (got "${String(raw.timeout)}")`,
			});
		} else {
			timeout = raw.timeout;
		}
	}

	return {
		id: typeof id === "string" ? id.trim() : "",
		run,
		mode,
		scope,
		baseline,
		env,
		image,
		timeout,
	};
}

/**
 * Validate the `gates:` block (version 2 only). Every schema error names the
 * offending field; a duplicate id is reported once. Returns the parsed gates
 * (the caller discards them all if `errors` is non-empty — fail closed).
 */
export function validateGates(
	raw: unknown,
	errors: CIConfigValidationError[],
): CIGateConfig[] {
	if (!Array.isArray(raw)) {
		errors.push({ path: "gates", message: "gates must be a non-empty list" });
		return [];
	}
	if (raw.length === 0) {
		errors.push({ path: "gates", message: "gates must be a non-empty list" });
		return [];
	}

	const gates: CIGateConfig[] = [];
	const seen = new Set<string>();
	raw.forEach((item, index) => {
		const gate = validateGate(item, index, errors);
		if (!gate) return;
		if (gate.id) {
			if (seen.has(gate.id)) {
				errors.push({
					path: `gates[${index}].id`,
					message: `duplicate gate id "${gate.id}"`,
				});
			}
			seen.add(gate.id);
		}
		gates.push(gate);
	});
	return gates;
}

const HOOK_NAMES = new Set(["pre-commit", "pre-push"]);
const PRE_COMMIT_FEATURES = new Set(["ci", "tdd", "secrets", "permissions"]);
const PRE_PUSH_FEATURES = new Set(["ci", "tdd", "deps"]);

/** Validate one boolean feature toggle, returning `dflt` when absent. */
function validateBoolFeature(
	raw: Record<string, unknown>,
	key: string,
	base: string,
	errors: CIConfigValidationError[],
	dflt: boolean,
): boolean {
	const value = raw[key];
	if (value === undefined) return dflt;
	if (typeof value !== "boolean") {
		errors.push({
			path: `${base}.${key}`,
			message: `${key} must be a boolean`,
		});
		return dflt;
	}
	return value;
}

/** Validate the tri-state pre-push.tdd toggle (false | "strict" | "warn"). */
function validatePushTdd(
	value: unknown,
	base: string,
	errors: CIConfigValidationError[],
): boolean | "strict" | "warn" {
	if (value === undefined) return false;
	if (typeof value === "boolean") return value;
	if (value === "strict" || value === "warn") return value;
	errors.push({
		path: `${base}.tdd`,
		message: `tdd must be a boolean or one of: strict, warn (got "${String(value)}")`,
	});
	return false;
}

/**
 * Validate the `hooks:` block (version 2 only). Mirrors validateGate: every
 * schema error names the offending field and the caller discards the whole
 * config if `errors` is non-empty (fail closed). Always returns a fully
 * defaulted config (ci on, every other feature off) so the dispatcher never
 * branches on an omitted hook or feature.
 */
export function validateHooks(
	raw: unknown,
	errors: CIConfigValidationError[],
): CIHooksConfig {
	const preCommit: CIHookCommitConfig = {
		ci: true,
		tdd: false,
		secrets: false,
		permissions: false,
	};
	const prePush: CIHookPushConfig = { ci: true, tdd: false, deps: false };

	if (!isRecord(raw)) {
		errors.push({
			path: "hooks",
			message: "hooks must be a mapping of hook names to feature toggles",
		});
		return { preCommit, prePush };
	}

	for (const key of Object.keys(raw)) {
		if (!HOOK_NAMES.has(key)) {
			errors.push({ path: `hooks.${key}`, message: `unknown field "${key}"` });
		}
	}

	if (raw["pre-commit"] !== undefined) {
		const pc = raw["pre-commit"];
		const base = "hooks.pre-commit";
		if (!isRecord(pc)) {
			errors.push({
				path: base,
				message: "pre-commit must be a mapping of feature toggles",
			});
		} else {
			for (const key of Object.keys(pc)) {
				if (!PRE_COMMIT_FEATURES.has(key)) {
					errors.push({
						path: `${base}.${key}`,
						message: `unknown field "${key}"`,
					});
				}
			}
			preCommit.ci = validateBoolFeature(pc, "ci", base, errors, true);
			preCommit.tdd = validateBoolFeature(pc, "tdd", base, errors, false);
			preCommit.secrets = validateBoolFeature(
				pc,
				"secrets",
				base,
				errors,
				false,
			);
			preCommit.permissions = validateBoolFeature(
				pc,
				"permissions",
				base,
				errors,
				false,
			);
		}
	}

	if (raw["pre-push"] !== undefined) {
		const pp = raw["pre-push"];
		const base = "hooks.pre-push";
		if (!isRecord(pp)) {
			errors.push({
				path: base,
				message: "pre-push must be a mapping of feature toggles",
			});
		} else {
			for (const key of Object.keys(pp)) {
				if (!PRE_PUSH_FEATURES.has(key)) {
					errors.push({
						path: `${base}.${key}`,
						message: `unknown field "${key}"`,
					});
				}
			}
			prePush.ci = validateBoolFeature(pp, "ci", base, errors, true);
			prePush.tdd = validatePushTdd(pp.tdd, base, errors);
			prePush.deps = validateBoolFeature(pp, "deps", base, errors, false);
		}
	}

	return { preCommit, prePush };
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

	// Read the version FIRST: the allowed-key set is a function of the accepted
	// version, so `gates` under v1 reports the named "gates require version: 2"
	// error, never the generic unknown-field error (JDA-006).
	const version =
		typeof doc.version === "number" && CI_CONFIG_VERSIONS.includes(doc.version)
			? doc.version
			: undefined;
	if (version === undefined) {
		errors.push({
			path: "version",
			message: `version is required and must be one of: ${CI_CONFIG_VERSIONS.join(", ")}`,
		});
	}

	const isV2 = version === 2;
	const hasGates = doc.gates !== undefined;
	const hasHooks = doc.hooks !== undefined;

	for (const key of Object.keys(doc)) {
		if (TOP_LEVEL_FIELDS.has(key)) continue;
		if (key === "gates") {
			// `gates` is only a known key under v2; under any other version it is a
			// named schema error that takes precedence over the generic path.
			if (!isV2) {
				errors.push({ path: "gates", message: "gates require version: 2" });
			}
			continue;
		}
		if (key === "hooks") {
			// Same version-gating as `gates`: `hooks` is a v2-only key, so under any
			// other version it reports a named error, not the generic unknown-field.
			if (!isV2) {
				errors.push({ path: "hooks", message: "hooks require version: 2" });
			}
			continue;
		}
		errors.push({ path: key, message: `unknown field "${key}"` });
	}

	if (isV2) {
		// v2: runners OPTIONAL when gates OR hooks are present; declaring NONE of the
		// three fails closed (nothing to run).
		if (
			!hasGates &&
			!hasHooks &&
			(!Array.isArray(doc.runners) || doc.runners.length === 0)
		) {
			errors.push({
				path: "runners",
				message:
					"a version 2 config must declare runners, gates or hooks (nothing to run otherwise)",
			});
		}
	} else if (!Array.isArray(doc.runners) || doc.runners.length === 0) {
		// v1 (and invalid-version) still hard-require a non-empty runners list.
		errors.push({
			path: "runners",
			message: "runners is required and must be a non-empty list",
		});
	}

	// Gates are validated ONLY under v2 — a v1+gates config is already rejected
	// above and must not surface a second, confusing wave of gate-field errors.
	const gates: CIGateConfig[] =
		isV2 && hasGates ? validateGates(doc.gates, errors) : [];

	// Hooks are validated ONLY under v2 — a v1+hooks config is already rejected
	// above and must not surface a second wave of hook-field errors.
	const hooks: CIHooksConfig | undefined =
		isV2 && hasHooks ? validateHooks(doc.hooks, errors) : undefined;

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

	// `version` is defined here (an undefined version pushed an error above and
	// would have thrown). A v1 config carries NO gates key — byte-identical shape.
	const config: CIConfig = { version: version ?? CI_CONFIG_VERSION, runners };
	if (gates.length > 0) config.gates = gates;
	if (hooks) config.hooks = hooks;
	return config;
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
