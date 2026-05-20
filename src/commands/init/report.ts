import type { InitStep } from "../../types/index.js";
import type { StepCallback } from "./types.js";

/**
 * Emit a step progress event via the callback.
 *
 * Centralized helper extracted during the init.ts split. Functionally
 * identical to the original inline report function, with an explicit
 * `void` return type added for type clarity. Behavior MUST stay
 * compatible so tests asserting on emitted steps[] (and the ordering
 * contract test) keep passing through the PR 1-6 extraction.
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
