import { setHookFeature } from "../../../lib/ci-config.js";
import { installClaudePreToolUse } from "../../../lib/claude-hook-manager.js";
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
		let guardNote = "";
		if (claudePreToolUseGuard) {
			const result = await installClaudePreToolUse(projectDir);
			if (!result.ok) {
				report(
					onStep,
					stepId,
					"Scaffold security hooks",
					"error",
					`Claude guard install refused: ${result.errors.join("; ")}`,
				);
				return;
			}
			guardNote = "; Claude guard installed";
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
		report(
			onStep,
			stepId,
			"Scaffold security hooks",
			"done",
			`${presetNote}${guardNote}`,
		);
	} catch (e) {
		report(onStep, stepId, "Scaffold security hooks", "error", String(e));
	}
};
