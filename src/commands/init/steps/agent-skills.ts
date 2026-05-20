import path from "node:path";
import fs from "fs-extra";
import { AGENT_SKILLS_MANIFEST_FILE } from "../../../constants.js";
import type { AgentSkillsManifest } from "../../../types/index.js";
import { report } from "../report.js";
import type { StepFn } from "../types.js";

/**
 * Step 17: Generate Agent Skills manifest (skills.json).
 *
 * - In dry-run mode, reports what would be created without touching disk.
 * - Otherwise writes <projectDir>/<AGENT_SKILLS_MANIFEST_FILE> with an empty
 *   skills array unless the file already exists (idempotent).
 * - Errors are swallowed and reported as status:"error" — never thrown.
 *
 * Extracted VERBATIM from src/commands/init.ts (PR 6 of 6).
 */
export const stepAgentSkills: StepFn = async (ctx) => {
	const { projectDir, dryRun, onStep, options } = ctx;
	const { projectName } = options;
	const stepId = "agent-skills";
	report(
		onStep,
		stepId,
		"Generate Agent Skills manifest (skills.json)",
		"running",
	);
	try {
		if (!dryRun) {
			const skillsManifest: AgentSkillsManifest = {
				name: projectName,
				version: "0.1.0",
				description: `Agent Skills manifest for ${projectName}`,
				skills: [],
			};
			const skillsJsonPath = path.join(projectDir, AGENT_SKILLS_MANIFEST_FILE);
			if (!(await fs.pathExists(skillsJsonPath))) {
				await fs.writeJson(skillsJsonPath, skillsManifest, { spaces: 2 });
				report(
					onStep,
					stepId,
					"Generate Agent Skills manifest (skills.json)",
					"done",
					AGENT_SKILLS_MANIFEST_FILE,
				);
			} else {
				report(
					onStep,
					stepId,
					"Generate Agent Skills manifest (skills.json)",
					"done",
					"already exists",
				);
			}
		} else {
			report(
				onStep,
				stepId,
				"Generate Agent Skills manifest (skills.json)",
				"done",
				`dry-run: would generate ${AGENT_SKILLS_MANIFEST_FILE}`,
			);
		}
	} catch (e) {
		report(
			onStep,
			stepId,
			"Generate Agent Skills manifest (skills.json)",
			"error",
			String(e),
		);
	}
};
