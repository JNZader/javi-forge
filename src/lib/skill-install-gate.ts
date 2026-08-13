/**
 * Shared install-gate evaluation for the skillguard runtime gate (D2).
 *
 * Pure helpers: verdict evaluation ({@link evaluateInstallGate}) and the
 * coverage refusal policy + message-building ({@link evaluateCoverageGate},
 * {@link scanFailureMessage}) live in exactly one place so all three
 * entrypoints (plugin add, plugin import, skills auto-install) share
 * identical force semantics and byte-identical refusal messages (R2-001).
 * Scanning + try/catch stay at the call sites (a pure helper cannot own the
 * I/O); this module imports no fs.
 *
 * Force rule (fail-closed): `block` always refuses; `--force` lifts ONLY
 * `unscannable`. Manifest-integrity refusals (undeclared SKILL.md in the tree,
 * any symlink, case-colliding declared dirs, empty/missing `skills` on import,
 * declared paths escaping the source dir) are NOT verdicts —
 * `evaluateCoverageGate` enforces the walk-derived ones BEFORE the verdict
 * gate runs, so `force` can never lift them either.
 */

import type { SkillCoverageScan, SkillScanResult } from "./skill-scanner.js";
import { formatBatchReport, isRejectedVerdict } from "./skill-scanner.js";

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

export interface CoverageGateDecision {
	/** Verdict-gate evaluation of the declared results. */
	gate: InstallGateDecision;
	/**
	 * Refusal message when the install must be refused, else `null`
	 * (⇔ the install proceeds). Manifest-integrity refusals come first
	 * (errors → symlinks → undeclared — block-level, force never lifts),
	 * then the verdict refusal (`!gate.allowed`). Messages are the
	 * byte-identical UX contract both package entrypoints share (spec:
	 * "refusal output reuses scanner reports"; R2-001: the refusal policy +
	 * message-building lives in exactly one place).
	 */
	refusalError: string | null;
}

/**
 * Shared refusal policy for the coverage walk + verdict gate (R2-001) — the
 * chain both `plugin add` and `plugin import` run between
 * `scanSkillsWithCoverage` and placement. A `null` refusalError means the
 * install may proceed; any non-null message is a block-level refusal the
 * caller returns verbatim (`force` never lifts integrity refusals; the
 * verdict branch already encodes the force rule via {@link evaluateInstallGate}).
 */
export function evaluateCoverageGate(
	coverage: SkillCoverageScan,
	options?: { force?: boolean },
): CoverageGateDecision {
	// Manifest-integrity refusals — block-level, force NEVER lifts
	// (JD-007: ANY symlink; JD-006: undeclared SKILL.md incl.
	// node_modules/.git). A walk with I/O errors cannot certify the
	// installed footprint — refuse first, before symlink/undeclared
	// checks, because the broken subtree may hide either (JD-013).
	if (coverage.errors.length > 0) {
		return {
			gate: { allowed: false, rejected: [] },
			refusalError: `skillguard: install refused — ${coverage.errors.length} path(s) could not be read (walk incomplete; manifest-integrity, force never lifts):\n${coverage.errors.map((p) => `  ${p}`).join("\n")}`,
		};
	}
	// FU-5 (F3 residual): a declared dir with case-colliding on-disk twins
	// is ambiguous — the declared scan read one twin while both install.
	const ambiguous = coverage.ambiguousDeclaredDirs ?? [];
	if (ambiguous.length > 0) {
		return {
			gate: { allowed: false, rejected: [] },
			refusalError: `skillguard: install refused — ambiguous declared skill dir(s) (case-colliding on-disk dirs; manifest-integrity, force never lifts):\n${ambiguous.map((p) => `  ${p}`).join("\n")}`,
		};
	}
	if (coverage.symlinks.length > 0) {
		return {
			gate: { allowed: false, rejected: [] },
			refusalError: `skillguard: install refused — symlink(s) in tree (manifest-integrity, force never lifts):\n${coverage.symlinks.map((p) => `  ${p}`).join("\n")}`,
		};
	}
	if (coverage.undeclared.length > 0) {
		return {
			gate: { allowed: false, rejected: [] },
			refusalError: `skillguard: install refused — undeclared SKILL.md(s) in tree (every skill-shaped file must be declared; force never lifts):\n${coverage.undeclared.map((p) => `  ${p}`).join("\n")}`,
		};
	}

	const gate = evaluateInstallGate(coverage.declared, options);
	if (!gate.allowed) {
		const blocked = gate.rejected.filter((r) => r.verdict === "block").length;
		const unscannable = gate.rejected.filter(
			(r) => r.verdict === "unscannable",
		).length;
		return {
			gate,
			// Lead line names the rejected count; the batch report renders
			// the FULL declared set so the header/rows reflect every scanned
			// skill (D6, JD-014).
			refusalError: `skillguard: install refused — ${gate.rejected.length} rejected (${blocked} blocked, ${unscannable} unscannable)\n${formatBatchReport(coverage.declared)}`,
		};
	}

	return { gate, refusalError: null };
}

/**
 * Byte-identical message for the scanner-error deny (D7): a throw from the
 * coverage walk or verdict evaluation is not a verdict, so no force branch
 * consults it — the install is denied unconditionally (R2-001: shared by
 * both package entrypoints).
 */
export function scanFailureMessage(error: unknown): string {
	const msg = error instanceof Error ? error.message : String(error);
	return `skillguard scan failed — ${msg}`;
}
