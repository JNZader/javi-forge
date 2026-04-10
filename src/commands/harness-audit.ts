/**
 * Harness audit — scores how well-configured the AI agent development
 * environment is (hooks, skills, memory, configs). Detects which AI
 * agent harness is installed and generates appropriate config.
 */

import fs from "fs-extra";
import path from "path";

// ── Types ──

export type Harness =
	| "claude"
	| "cursor"
	| "codex"
	| "copilot"
	| "windsurf"
	| "none";

export interface HarnessDetection {
	harness: Harness;
	configDir: string | null;
	version: string | null;
}

export interface AuditCategory {
	name: string;
	score: number; // 0-100
	maxScore: number;
	checks: AuditCheck[];
}

export interface AuditCheck {
	id: string;
	label: string;
	passed: boolean;
	points: number;
	detail?: string;
}

export interface HarnessAuditResult {
	harness: Harness;
	totalScore: number;
	maxScore: number;
	grade: string; // A/B/C/D/F
	categories: AuditCategory[];
}

// ── Harness Detection ──

const HARNESS_SIGNATURES: Array<{
	harness: Harness;
	markers: string[];
	configDir: string;
}> = [
	{
		harness: "claude",
		markers: [".claude", "CLAUDE.md"],
		configDir: ".claude",
	},
	{
		harness: "cursor",
		markers: [".cursor", ".cursorrules"],
		configDir: ".cursor",
	},
	{ harness: "codex", markers: [".codex", "AGENTS.md"], configDir: ".codex" },
	{
		harness: "copilot",
		markers: [".github/copilot-instructions.md"],
		configDir: ".github",
	},
	{ harness: "windsurf", markers: [".windsurfrules"], configDir: "." },
];

export function detectHarness(projectDir: string): HarnessDetection {
	for (const sig of HARNESS_SIGNATURES) {
		for (const marker of sig.markers) {
			const fullPath = path.join(projectDir, marker);
			if (fs.existsSync(fullPath)) {
				return {
					harness: sig.harness,
					configDir: path.join(projectDir, sig.configDir),
					version: null,
				};
			}
		}
	}

	// Check home directory for global installs
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	if (home && fs.existsSync(path.join(home, ".claude"))) {
		return {
			harness: "claude",
			configDir: path.join(home, ".claude"),
			version: null,
		};
	}

	return { harness: "none", configDir: null, version: null };
}

export function detectAllHarnesses(projectDir: string): HarnessDetection[] {
	const found: HarnessDetection[] = [];
	for (const sig of HARNESS_SIGNATURES) {
		for (const marker of sig.markers) {
			if (fs.existsSync(path.join(projectDir, marker))) {
				found.push({
					harness: sig.harness,
					configDir: path.join(projectDir, sig.configDir),
					version: null,
				});
				break; // one detection per harness
			}
		}
	}
	return found;
}

// ── Audit Checks ──

function checkFileExists(dir: string, relativePath: string): boolean {
	return fs.existsSync(path.join(dir, relativePath));
}

function checkDirHasFiles(dir: string, relativePath: string): boolean {
	const full = path.join(dir, relativePath);
	if (!fs.existsSync(full)) return false;
	try {
		const entries = fs.readdirSync(full);
		return entries.length > 0;
	} catch {
		return false;
	}
}

function auditClaude(projectDir: string, configDir: string): AuditCategory[] {
	const categories: AuditCategory[] = [];

	// Config category
	const configChecks: AuditCheck[] = [
		{
			id: "claude-md",
			label: "CLAUDE.md exists",
			passed:
				checkFileExists(projectDir, "CLAUDE.md") ||
				checkFileExists(configDir, "CLAUDE.md"),
			points: 15,
		},
		{
			id: "settings",
			label: "settings.json configured",
			passed:
				checkFileExists(configDir, "settings.json") ||
				checkFileExists(configDir, "settings.local.json"),
			points: 10,
		},
		{
			id: "project-config",
			label: "Project-level config exists",
			passed: checkDirHasFiles(configDir, "projects"),
			points: 5,
		},
	];

	// Skills category
	const skillChecks: AuditCheck[] = [
		{
			id: "skills-dir",
			label: "Skills directory exists",
			passed: checkDirHasFiles(configDir, "skills"),
			points: 15,
		},
		{
			id: "skills-count",
			label: "At least 5 skills installed",
			passed: countSubdirs(path.join(configDir, "skills")) >= 5,
			points: 10,
		},
		{
			id: "shared-conventions",
			label: "Shared conventions configured",
			passed: checkDirHasFiles(configDir, "skills/_shared"),
			points: 5,
		},
	];

	// Hooks category
	const hookChecks: AuditCheck[] = [
		{
			id: "hooks-configured",
			label: "Hooks configured in settings",
			passed: hasHooksInSettings(configDir),
			points: 15,
		},
		{
			id: "pre-commit-hook",
			label: "Pre-commit or CI hook exists",
			passed:
				checkFileExists(projectDir, ".husky/pre-commit") ||
				checkFileExists(projectDir, ".git/hooks/pre-commit"),
			points: 5,
		},
	];

	// Memory category
	const memoryChecks: AuditCheck[] = [
		{
			id: "memory-dir",
			label: "Memory/projects directory exists",
			passed: checkDirHasFiles(configDir, "projects"),
			points: 10,
		},
		{
			id: "memory-md",
			label: "MEMORY.md exists in projects",
			passed: hasMemoryMd(configDir),
			points: 10,
		},
	];

	categories.push(buildCategory("Configuration", configChecks));
	categories.push(buildCategory("Skills", skillChecks));
	categories.push(buildCategory("Hooks", hookChecks));
	categories.push(buildCategory("Memory", memoryChecks));

	return categories;
}

function auditGeneric(projectDir: string): AuditCategory[] {
	const checks: AuditCheck[] = [
		{
			id: "has-config",
			label: "AI agent config file exists",
			passed: HARNESS_SIGNATURES.some((sig) =>
				sig.markers.some((m) => checkFileExists(projectDir, m)),
			),
			points: 30,
		},
		{
			id: "has-gitignore",
			label: ".gitignore excludes agent artifacts",
			passed: gitignoreHasAgent(projectDir),
			points: 10,
		},
	];

	return [buildCategory("Basic Setup", checks)];
}

// ── Helpers ──

function countSubdirs(dir: string): number {
	if (!fs.existsSync(dir)) return 0;
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((d) => d.isDirectory()).length;
	} catch {
		return 0;
	}
}

function hasHooksInSettings(configDir: string): boolean {
	const settingsPath = path.join(configDir, "settings.json");
	if (!fs.existsSync(settingsPath)) return false;
	try {
		const content = fs.readFileSync(settingsPath, "utf-8");
		return content.includes("hooks") || content.includes("hook");
	} catch {
		return false;
	}
}

function hasMemoryMd(configDir: string): boolean {
	const projectsDir = path.join(configDir, "projects");
	if (!fs.existsSync(projectsDir)) return false;
	try {
		const dirs = fs.readdirSync(projectsDir, { withFileTypes: true });
		return dirs.some((d) => {
			if (!d.isDirectory()) return false;
			const memDir = path.join(projectsDir, d.name, "memory");
			return (
				fs.existsSync(memDir) && fs.existsSync(path.join(memDir, "MEMORY.md"))
			);
		});
	} catch {
		return false;
	}
}

function gitignoreHasAgent(projectDir: string): boolean {
	const giPath = path.join(projectDir, ".gitignore");
	if (!fs.existsSync(giPath)) return false;
	try {
		const content = fs.readFileSync(giPath, "utf-8");
		return (
			content.includes(".claude") ||
			content.includes(".cursor") ||
			content.includes(".codex")
		);
	} catch {
		return false;
	}
}

function buildCategory(name: string, checks: AuditCheck[]): AuditCategory {
	const score = checks
		.filter((c) => c.passed)
		.reduce((sum, c) => sum + c.points, 0);
	const maxScore = checks.reduce((sum, c) => sum + c.points, 0);
	return { name, score, maxScore, checks };
}

function computeGrade(score: number, max: number): string {
	if (max === 0) return "F";
	const pct = (score / max) * 100;
	if (pct >= 90) return "A";
	if (pct >= 75) return "B";
	if (pct >= 60) return "C";
	if (pct >= 40) return "D";
	return "F";
}

// ── Main ──

export function runHarnessAudit(projectDir: string): HarnessAuditResult {
	const detection = detectHarness(projectDir);

	const categories =
		detection.harness === "claude" && detection.configDir
			? auditClaude(projectDir, detection.configDir)
			: auditGeneric(projectDir);

	const totalScore = categories.reduce((s, c) => s + c.score, 0);
	const maxScore = categories.reduce((s, c) => s + c.maxScore, 0);

	return {
		harness: detection.harness,
		totalScore,
		maxScore,
		grade: computeGrade(totalScore, maxScore),
		categories,
	};
}
