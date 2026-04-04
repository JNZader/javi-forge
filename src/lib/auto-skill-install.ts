import fs from "fs-extra";
import path from "path";
import type { StackDetectionResult } from "./stack-detector.js";
import { detectProjectStack } from "./stack-detector.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SkillInstallResult {
	/** Skills that were successfully installed (copied) */
	installed: string[];
	/** Skills that were already present */
	skipped: string[];
	/** Skills that were recommended but not found in the source */
	notFound: string[];
	/** The full detection result for reporting */
	detection: StackDetectionResult;
}

export interface AutoInstallOptions {
	/** Directory to scan for tech stack detection */
	projectDir: string;
	/** Source directory containing skill folders (default: ~/.claude/skills) */
	skillsSourceDir?: string;
	/** Target directory where skills are installed (default: ~/.claude/skills) */
	skillsTargetDir?: string;
	/** If true, skip actually copying files */
	dryRun?: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_SKILLS_DIR = path.join(
	process.env["HOME"] ?? "~",
	".claude",
	"skills",
);

// ── Core ───────────────────────────────────────────────────────────────────

/**
 * Scan a project, detect its stack, and install matching AI skills.
 *
 * Skills are "installed" by verifying they exist in the source directory.
 * Since javi-forge skills live in ~/.claude/skills/, this mainly validates
 * that the recommended skills are available and reports which ones are missing.
 *
 * If skillsSourceDir !== skillsTargetDir, it copies skill folders from
 * source to target (useful for project-local skill installation).
 */
export async function autoInstallSkills(
	options: AutoInstallOptions,
): Promise<SkillInstallResult> {
	const {
		projectDir,
		skillsSourceDir = DEFAULT_SKILLS_DIR,
		skillsTargetDir = DEFAULT_SKILLS_DIR,
		dryRun = false,
	} = options;

	// 1. Detect project stack
	const detection = await detectProjectStack(projectDir);

	if (detection.recommendedSkills.length === 0) {
		return {
			installed: [],
			skipped: [],
			notFound: [],
			detection,
		};
	}

	const installed: string[] = [];
	const skipped: string[] = [];
	const notFound: string[] = [];

	const sameDir =
		path.resolve(skillsSourceDir) === path.resolve(skillsTargetDir);

	for (const skillName of detection.recommendedSkills) {
		const sourcePath = path.join(skillsSourceDir, skillName);
		const targetPath = path.join(skillsTargetDir, skillName);
		const sourceSkillMd = path.join(sourcePath, "SKILL.md");

		// Check if skill exists in source
		if (!(await fs.pathExists(sourceSkillMd))) {
			notFound.push(skillName);
			continue;
		}

		// If same directory, skill is already "installed"
		if (sameDir) {
			skipped.push(skillName);
			continue;
		}

		// Check if already present in target
		const targetSkillMd = path.join(targetPath, "SKILL.md");
		if (await fs.pathExists(targetSkillMd)) {
			skipped.push(skillName);
			continue;
		}

		// Copy skill to target
		if (!dryRun) {
			await fs.ensureDir(targetPath);
			await fs.copy(sourcePath, targetPath, {
				overwrite: false,
				errorOnExist: false,
			});
		}

		installed.push(skillName);
	}

	return { installed, skipped, notFound, detection };
}

/**
 * Get a human-readable summary of auto-install results.
 */
export function formatAutoInstallSummary(result: SkillInstallResult): string {
	const lines: string[] = [];

	if (result.detection.stack) {
		lines.push(`Detected stack: ${result.detection.stack}`);
	} else {
		lines.push("No stack detected");
	}

	if (result.detection.signals.length > 0) {
		lines.push(
			`Signals: ${result.detection.signals.map((s) => s.signal).join(", ")}`,
		);
	}

	const total =
		result.installed.length + result.skipped.length + result.notFound.length;
	lines.push(`Recommended skills: ${total}`);

	if (result.installed.length > 0) {
		lines.push(`  Installed: ${result.installed.join(", ")}`);
	}
	if (result.skipped.length > 0) {
		lines.push(`  Already present: ${result.skipped.join(", ")}`);
	}
	if (result.notFound.length > 0) {
		lines.push(`  Not found: ${result.notFound.join(", ")}`);
	}

	return lines.join("\n");
}
