/**
 * Shared install-gate evaluation for the skillguard runtime gate (D2).
 *
 * Pure helper: verdict evaluation for a set of declared skill scans lives in
 * exactly one place so all three entrypoints (plugin add, plugin import, skills
 * auto-install) share identical force semantics. Scanning + try/catch stay at
 * the call sites (a pure helper cannot own the I/O); this module imports no fs.
 *
 * Force rule (fail-closed): `block` always refuses; `--force` lifts ONLY
 * `unscannable`. Manifest-integrity refusals (undeclared SKILL.md in the tree,
 * any symlink, empty/missing `skills` on import, declared paths escaping the
 * source dir) are NOT verdicts — call sites enforce them BEFORE this helper
 * runs, so `force` can never lift them either.
 */

import type { SkillScanResult } from "./skill-scanner.js";
import { isRejectedVerdict } from "./skill-scanner.js";

export interface InstallGateDecision {
	allowed: boolean;
	/** Rejected results when `!allowed`, else `[]`. */
	rejected: SkillScanResult[];
}

/**
 * Evaluate a set of declared-skill scan results against the install gate.
 *
 * `allowed = !hasBlock && (rejected.length === 0 || force)` — a `block` verdict
 * refuses unconditionally; `force` bypasses ONLY `unscannable`. Empty,
 * pass, and warn results are allowed.
 */
export function evaluateInstallGate(
	results: SkillScanResult[],
	options?: { force?: boolean },
): InstallGateDecision {
	const rejected = results.filter((r) => isRejectedVerdict(r.verdict));
	const hasBlock = results.some((r) => r.verdict === "block");
	const force = options?.force ?? false;

	const allowed = !hasBlock && (rejected.length === 0 || force);
	return { allowed, rejected: allowed ? [] : rejected };
}
