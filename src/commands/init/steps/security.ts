import { setHookFeature } from "../../../lib/ci-config.js";
import { installClaudePreToolUse } from "../../../lib/claude-hook-manager.js";
import { remediationForMessage } from "../../../lib/secure-refusal-remediation.js";
import type { HookProfile } from "../../../types/index.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Hook-feature preset per reliability profile (hook-consolidation S4).
 *
 * The old `stepHookProfile` wrote a `ci-local/hooks/profile.json` that had ZERO
 * runtime readers (design D7). The selector is repurposed: the chosen profile
 * now drives WHICH `hooks:` security sections get merged into
 * `.javi-forge/ci.yaml`, using the EXISTING `HookProfile` values (no "relaxed"):
 *   - strict   → secrets + permissions + deps (every section)
 *   - standard → secrets + deps
 *   - minimal  → CI gate only (no security sections)
 */
const PROFILE_PRESET: Record<
	HookProfile,
	{ preCommit: string[]; prePush: string[] }
> = {
	minimal: { preCommit: [], prePush: [] },
	standard: { preCommit: ["secrets"], prePush: ["deps"] },
	strict: { preCommit: ["secrets", "permissions"], prePush: ["deps"] },
};

/**
 * Step 14: Scaffold security hooks (hook-consolidation S4 fold + SkillGuard 4a).
 *
 * - When options.securityHooks is false, reports "skipped".
 * - Otherwise:
 *   1. When `claudePreToolUseGuard` is set, installs the managed Claude
 *      PreToolUse guard via the transactional `installClaudePreToolUse`
 *      (SkillGuard Slice 4a). The legacy copy-if-absent
 *      `claude-settings-security.json` scaffold is RETIRED — the managed
 *      installer owns `.claude/settings.json` + the hook asset with proper
 *      ownership markers.
 *      A guard refusal/failure is REPORTED but does NOT abort the step: the
 *      profile merge below is an independent outcome (Linux hardening Slice A).
 *   2. Merges the `hooks:` security sections for the selected reliability
 *      profile into `.javi-forge/ci.yaml` via `setHookFeature` (creating a
 *      minimal `version: 2` config when absent). The dispatcher composes these
 *      sections at hook-run time (see src/commands/hooks.ts).
 * - The old inert `ci-local/hooks/security/` git-hook copy is GONE (those hook
 *   bodies were ported to TypeScript sections in S4).
 * - Errors are swallowed and reported as status:"error" — never thrown.
 */
export const stepSecurityHooks: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { securityHooks, hookProfile, claudePreToolUseGuard } = options;
	const stepId = "security-hooks";
	report(onStep, stepId, "Scaffold security hooks", "running");
	// Declared OUTSIDE the try so a throw from the profile merge below cannot
	// swallow a guard refusal that already happened: the outer catch reports
	// BOTH failures (Linux hardening Slice A — a captured refusal and its
	// remediation are never silently lost).
	let guardError: string | undefined;
	try {
		if (!securityHooks) {
			report(
				onStep,
				stepId,
				"Scaffold security hooks",
				"skipped",
				"not selected",
			);
			return;
		}

		const profile: HookProfile = hookProfile ?? "standard";
		const preset = PROFILE_PRESET[profile];

		if (dryRun) {
			const guardNote = claudePreToolUseGuard
				? " + install Claude PreToolUse guard"
				: "";
			report(
				onStep,
				stepId,
				"Scaffold security hooks",
				"done",
				`dry-run: would merge ${profile} hooks preset${guardNote}`,
			);
			return;
		}

		// 1. Install the managed Claude PreToolUse guard (transactional; owns
		//    .claude/settings.json + the hook asset). Retires the legacy copy.
		//    A refusal (or a throw) is CAPTURED, not returned on: the guard and
		//    the hook-profile merge below are independent outcomes, so a host
		//    that cannot install the guard must not silently lose its
		//    secrets/permissions/deps wiring. The captured failure still drives a
		//    terminal status of "error" — visibility is never downgraded.
		let guardNote = "";
		if (claudePreToolUseGuard) {
			try {
				const result = await installClaudePreToolUse(projectDir);
				if (result.ok) {
					guardNote = "; Claude guard installed";
				} else {
					guardError = `Claude guard install refused: ${result.errors.join("; ")}`;
					const remediation = result.errors
						.map((e) => remediationForMessage(e))
						.find((line): line is string => line !== undefined);
					if (remediation) guardError += ` → ${remediation}`;
				}
			} catch (e) {
				guardError = `Claude guard install failed: ${String(e)}`;
			}
		}

		// 2. Merge the profile's security sections into .javi-forge/ci.yaml.
		for (const feature of preset.preCommit) {
			await setHookFeature(projectDir, "pre-commit", feature, true);
		}
		for (const feature of preset.prePush) {
			await setHookFeature(projectDir, "pre-push", feature, true);
		}

		const merged = [
			...preset.preCommit.map((f) => `pre-commit.${f}`),
			...preset.prePush.map((f) => `pre-push.${f}`),
		];
		const presetNote =
			merged.length > 0
				? `${profile} preset: ${merged.join(", ")}`
				: `${profile} preset: CI gate only (no security sections)`;
		// ONE terminal report. On a captured guard failure the status stays
		// "error" and the detail names BOTH the refusal (+ remediation) AND the
		// preset that WAS merged, so a refused guard is never read as installed
		// and a merged profile is never read as lost.
		report(
			onStep,
			stepId,
			"Scaffold security hooks",
			guardError ? "error" : "done",
			guardError
				? `${guardError}; ${presetNote} merged`
				: `${presetNote}${guardNote}`,
		);
	} catch (e) {
		report(
			onStep,
			stepId,
			"Scaffold security hooks",
			"error",
			guardError ? `${guardError}; ${String(e)}` : String(e),
		);
	}
};
