/**
 * `javi-forge hooks run <name>` dispatcher (hook-consolidation S1a).
 *
 * Pure logic, no Ink: composes the ENABLED sections for a hook from the
 * `hooks:` section of `.javi-forge/ci.yaml`, in a fixed cheap→expensive order,
 * and runs them fail-fast. A blocking section failure exits non-zero; only an
 * advisory section (pre-push `tdd: "warn"`) prints and continues.
 *
 * Fail-closed: a missing config means the default `[ci]` composition (today's
 * behavior); a config that FAILS to validate exits 1 — a broken config never
 * silently skips a gate.
 *
 * S1a scope: only the `ci` section has a body. The tdd/secrets/permissions/deps
 * sections have no factory yet (they land in S3/S4); an enabled-but-unregistered
 * feature is skipped by `composeSections` until its slice wires a factory.
 */

import {
	type CIHooksConfig,
	findCIConfig,
	loadCIConfig,
} from "../lib/ci-config.js";
import { type CIStep, runCI } from "./ci.js";

/** A single composable unit of hook work. */
export interface HookSection {
	/** stable id — "secrets" | "permissions" | "tdd" | "deps" | "ci" */
	id: string;
	/** false ONLY for an advisory section (pre-push tdd:"warn") */
	blocking: boolean;
	run(ctx: { projectDir: string }): Promise<{ ok: boolean; detail?: string }>;
}

export type SectionId = "secrets" | "permissions" | "tdd" | "deps" | "ci";
export type SectionFactory = () => HookSection;
export type SectionRegistry = Partial<Record<SectionId, SectionFactory>>;
export type HookName = "pre-commit" | "pre-push";

/** Fixed cheap→expensive order per hook (deterministic is a feature). */
const PRE_COMMIT_ORDER: SectionId[] = ["secrets", "permissions", "tdd", "ci"];
const PRE_PUSH_ORDER: SectionId[] = ["deps", "tdd", "ci"];

/** No config / no `hooks:` section → the [ci]-only default (byte-for-byte today). */
const DEFAULT_HOOKS: CIHooksConfig = {
	preCommit: { ci: true, tdd: false, secrets: false, permissions: false },
	prePush: { ci: true, tdd: false, deps: false },
};

interface FeatureState {
	enabled: boolean;
	blocking: boolean;
}

function featureState(
	id: SectionId,
	name: HookName,
	config: CIHooksConfig,
): FeatureState {
	if (name === "pre-commit") {
		const pc = config.preCommit;
		switch (id) {
			case "secrets":
				return { enabled: pc.secrets, blocking: true };
			case "permissions":
				return { enabled: pc.permissions, blocking: true };
			case "tdd":
				return { enabled: pc.tdd, blocking: true };
			case "ci":
				return { enabled: pc.ci, blocking: true };
			default:
				return { enabled: false, blocking: true };
		}
	}
	const pp = config.prePush;
	switch (id) {
		case "deps":
			return { enabled: pp.deps, blocking: true };
		case "tdd":
			// "warn" is advisory (never blocks); false is off; "strict"/true block.
			return { enabled: pp.tdd !== false, blocking: pp.tdd !== "warn" };
		case "ci":
			return { enabled: pp.ci, blocking: true };
		default:
			return { enabled: false, blocking: true };
	}
}

/**
 * Compose the enabled, implemented sections for a hook in fixed order. The
 * section's blocking flag is derived from config (so pre-push tdd:"warn" is
 * advisory) regardless of the factory's own default. An enabled feature with no
 * registered factory is skipped — the S1a gate for tdd/security bodies that land
 * in later slices.
 */
export function composeSections(
	name: HookName,
	config: CIHooksConfig | null,
	registry: SectionRegistry,
): HookSection[] {
	const cfg = config ?? DEFAULT_HOOKS;
	const order = name === "pre-commit" ? PRE_COMMIT_ORDER : PRE_PUSH_ORDER;
	const sections: HookSection[] = [];
	for (const id of order) {
		const state = featureState(id, name, cfg);
		if (!state.enabled) continue;
		const factory = registry[id];
		if (!factory) continue; // S1a: enabled but not yet implemented → skip
		const section = factory();
		sections.push({ ...section, blocking: state.blocking });
	}
	return sections;
}

/**
 * The `ci` section: runs the quick native CI gate IN-PROCESS (no subprocess, no
 * PATH/version skew). `runCI` throws on a blocking failure → the section reports
 * ok:false. `quick` runs setup + lint + compile + gates — NO tests, NO coverage.
 */
function ciSection(
	runCIImpl: typeof runCI,
	log: (msg: string) => void,
): HookSection {
	return {
		id: "ci",
		blocking: true,
		async run({ projectDir }) {
			try {
				await runCIImpl(
					{
						projectDir,
						mode: "quick",
						noDocker: true,
						noSecurity: true,
						noGhagga: true,
					},
					(step) => reportStep(step, log),
				);
				return { ok: true };
			} catch (e) {
				return {
					ok: false,
					detail: e instanceof Error ? e.message : String(e),
				};
			}
		},
	};
}

/** Console step feedback (no Ink in a git hook). Honest — never claims tests. */
function reportStep(step: CIStep, log: (msg: string) => void): void {
	if (step.status === "done") log(`  ✓ ${step.label}`);
	else if (step.status === "error")
		log(`  ✗ ${step.label}${step.detail ? ` — ${step.detail}` : ""}`);
	else if (step.status === "warning") log(`  ⚠ ${step.label}`);
}

function defaultRegistry(
	runCIImpl: typeof runCI,
	log: (msg: string) => void,
): SectionRegistry {
	return { ci: () => ciSection(runCIImpl, log) };
}

/** Resolve the parsed `hooks:` config for a project (null → default [ci]). */
export async function loadHooksConfig(
	projectDir: string,
): Promise<CIHooksConfig | null> {
	const configPath = await findCIConfig(projectDir);
	if (!configPath) return null;
	// Throws CIConfigError on an invalid config → runHook maps that to exit 1.
	const config = await loadCIConfig(configPath);
	return config.hooks ?? null;
}

/** Injectable seams for tests; every field defaults to the real implementation. */
export interface RunHookDeps {
	loadConfig?: (projectDir: string) => Promise<CIHooksConfig | null>;
	registry?: SectionRegistry;
	runCIImpl?: typeof runCI;
	log?: (msg: string) => void;
	logError?: (msg: string) => void;
}

const USAGE = "Usage: javi-forge hooks run <pre-commit|pre-push>";

/**
 * Run the composed sections for `name`. Returns the process exit code:
 * 0 iff every blocking section passed. Fail-fast on the first blocking failure;
 * fail-closed (exit 1) on an unknown hook name or an unparseable config.
 */
export async function runHook(
	name: string,
	projectDir: string,
	deps: RunHookDeps = {},
): Promise<number> {
	const log = deps.log ?? ((m: string) => console.log(m));
	const logError = deps.logError ?? ((m: string) => console.error(m));

	if (name !== "pre-commit" && name !== "pre-push") {
		logError(USAGE);
		return 1;
	}

	const loadConfig = deps.loadConfig ?? loadHooksConfig;
	let config: CIHooksConfig | null;
	try {
		config = await loadConfig(projectDir);
	} catch (e) {
		// Fail-closed: a broken config never silently skips a gate.
		logError(e instanceof Error ? e.message : String(e));
		return 1;
	}

	const runCIImpl = deps.runCIImpl ?? runCI;
	const registry = deps.registry ?? defaultRegistry(runCIImpl, log);

	const sections = composeSections(name, config, registry);
	for (const section of sections) {
		log(`▶ ${section.id}`);
		const result = await section.run({ projectDir });
		if (result.ok) continue;
		const detail = result.detail ? `: ${result.detail}` : "";
		if (section.blocking) {
			logError(`✗ ${section.id} failed${detail}`);
			return 1; // fail-fast
		}
		log(`⚠ ${section.id} (advisory) failed${detail}`);
	}
	return 0;
}
