import type { InitOptions, InitStep } from "../../types/index.js";

/**
 * Callback invoked by each step to report progress.
 * Steps emit at least 2 events: status:"running" followed by a terminal status
 * ("done" | "skipped" | "error").
 */
export type StepCallback = (step: InitStep) => void;

/**
 * Context passed to every step. Built once by initProject and shared
 * across all extracted step functions.
 *
 * Fields are intentionally minimal:
 * - `options`: full InitOptions (steps can read any flag they need)
 * - `projectDir`: convenience alias for options.projectDir
 * - `dryRun`: convenience alias for options.dryRun
 * - `onStep`: the progress callback (passed to report())
 */
export type StepContext = {
	options: InitOptions;
	projectDir: string;
	dryRun: boolean;
	onStep: StepCallback;
};

/**
 * Step function signature. All step* functions follow this shape.
 * Returns a promise that resolves when the step is complete
 * (success, skipped, or recovered error — steps must NOT throw).
 */
export type StepFn = (ctx: StepContext) => Promise<void>;
