import type {
	CIProvider,
	HookProfile,
	InitOptions,
	MemoryOption,
	Stack,
} from "../types/index.js";

/**
 * Wizard-collected toggles for an init run — the subset the user answers
 * interactively (or via presets). Mirrors the `runInit` opts parameter.
 */
export interface InitOptionsWizardResult {
	aiSync: boolean;
	sdd: boolean;
	contextDir: boolean;
	claudeMd: boolean;
	ghagga: boolean;
	securityHooks: boolean;
	codeGraph: boolean;
	localAi: boolean;
	hookProfile: HookProfile;
}

/**
 * Surrounding context resolved before the wizard finishes — project identity,
 * stack/CI/memory choices, and run flags (mock/dryRun).
 */
export interface InitOptionsContext {
	projectName: string;
	projectDir: string;
	stack: Stack;
	ciProvider: CIProvider;
	memory: MemoryOption;
	mock: boolean;
	dryRun: boolean;
}

/**
 * Pure mapping from wizard result + surrounding context to the full
 * {@link InitOptions} contract passed to `initProject`.
 *
 * Extracted from the single inline object literal in `App.tsx#runInit` so the
 * derivation is unit-testable. Behavior-identical: field values must match the
 * previous inline literal exactly.
 *
 * Notably, `claudePreToolUseGuard` is derived from `securityHooks` alone — ALL
 * hook profiles (including "minimal") install the managed guard when security
 * hooks are enabled. A regression here silently disables managed-guard
 * installation, so it is pinned by build-init-options.test.ts.
 */
export function buildInitOptions(
	opts: InitOptionsWizardResult,
	ctx: InitOptionsContext,
): InitOptions {
	return {
		projectName: ctx.projectName,
		projectDir: ctx.projectDir,
		stack: ctx.stack,
		ciProvider: ctx.ciProvider,
		memory: ctx.memory,
		aiSync: opts.aiSync,
		sdd: opts.sdd,
		ghagga: opts.ghagga,
		contextDir: opts.contextDir,
		claudeMd: opts.claudeMd,
		securityHooks: opts.securityHooks,
		hookProfile: opts.hookProfile,
		// Derived from securityHooks alone — ALL profiles incl. Minimal
		// install the managed guard when security hooks are enabled.
		claudePreToolUseGuard: opts.securityHooks,
		codeGraph: opts.codeGraph,
		localAi: opts.localAi,
		dockerDeploy: false,
		dockerServiceName: "app",
		mock: ctx.mock,
		dryRun: ctx.dryRun,
	};
}
