import type { InitStep } from "../../types/index.js";
import type { StepCallback } from "./types.js";

/**
 * Emit a step progress event via the callback.
 *
 * Replicates verbatim the local `report()` helper that previously lived
 * inside src/commands/init.ts. Behavior MUST stay byte-identical so that
 * tests asserting on emitted steps[] (and the new ordering contract test)
 * keep passing through the PR 1-6 extraction.
 */
export function report(
	onStep: StepCallback,
	id: string,
	label: string,
	status: InitStep["status"],
	detail?: string,
): void {
	onStep({ id, label, status, detail });
}
