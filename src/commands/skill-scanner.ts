/**
 * CI-level skill security scanner — pre-install analysis of SKILL.md files.
 *
 * Detects credential theft, code injection, data exfiltration, and scope escape
 * patterns before skills are installed. Inspired by the SkillGuard skill
 * (javi-ai) but implemented as a programmatic module with structured output.
 */

import fs from "fs-extra";
import path from "path";
import type { SecuritySeverity } from "../types/index.js";

// =============================================================================
// Types
// =============================================================================

export type SkillThreatCategory =
	| "credential-theft"
	| "code-injection"
	| "data-exfiltration"
	| "scope-escape"
	| "privilege-escalation"
	| "destructive-command"
	| "self-modification"
	| "hook-tampering"
	| "obfuscation"
	| "missing-provenance"
	| "excessive-permissions"
	| "file-traversal";

export interface SkillThreat {
	category: SkillThreatCategory;
	severity: SecuritySeverity;
	pattern: string;
	line: number;
	context: string;
	message: string;
}

export type SkillScanVerdict = "pass" | "warn" | "block";

export interface SkillScanResult {
	skillPath: string;
	skillName: string;
	verdict: SkillScanVerdict;
	threats: SkillThreat[];
	summary: SkillScanSummary;
}

export interface SkillScanSummary {
	total: number;
	critical: number;
	high: number;
	moderate: number;
	low: number;
}

// =============================================================================
// Threat patterns
// =============================================================================

interface ThreatPattern {
	category: SkillThreatCategory;
	severity: SecuritySeverity;
	pattern: RegExp;
	message: string;
}

/**
 * Ordered by severity (critical first). Each pattern is tested against
 * every non-comment line in the skill file.
 */
export const THREAT_PATTERNS: ThreatPattern[] = [
	// ── Critical: Credential Theft ──
	{
		category: "credential-theft",
		severity: "critical",
		pattern:
			/(?:~\/\.ssh|~\/\.aws|~\/\.config\/gh|~\/\.gnupg|~\/\.netrc|~\/\.npmrc|\/etc\/shadow|\/etc\/passwd|id_rsa|id_ed25519)/i,
		message: "References sensitive credential paths — potential data theft",
	},
	{
		category: "credential-theft",
		severity: "critical",
		pattern:
			/(?:AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN|NPM_TOKEN|PRIVATE_KEY|API_SECRET|DATABASE_URL|MONGO_URI|REDIS_URL)\s*[=:]/i,
		message:
			"References environment variable containing secrets — potential exfiltration",
	},
	{
		category: "credential-theft",
		severity: "critical",
		pattern:
			/(?:read|cat|type|get-content|less|more|head|tail)\s+.*(?:\.env|credentials|secrets?\.(json|yaml|yml|toml))/i,
		message:
			"Reads secret/credential files directly — potential credential theft",
	},

	// ── Critical: Code Injection ──
	{
		category: "code-injection",
		severity: "critical",
		pattern: /\beval\s*\(\s*(?:user|input|req|params|args|data|body)/i,
		message:
			"eval() with user-controlled input — enables arbitrary code execution",
	},
	{
		category: "code-injection",
		severity: "critical",
		pattern:
			/\b(?:exec|execSync|spawn|spawnSync)\s*\(\s*(?:user|input|req|params|args|data)/i,
		message:
			"Process execution with user input — enables command injection",
	},
	{
		category: "code-injection",
		severity: "critical",
		pattern:
			/\b(?:subprocess\.(?:call|run|Popen)|os\.system|os\.popen)\s*\(\s*(?:f['\"]|user|input|req)/i,
		message:
			"Python subprocess with user input — enables command injection",
	},

	// ── Critical: Data Exfiltration ──
	{
		category: "data-exfiltration",
		severity: "critical",
		pattern:
			/(?:curl|wget|fetch|axios|got|request)\s+.*(?:--data|--upload|-d\s|-F\s|\.post\(|\.put\()\s*.*(?:\/etc\/|~\/\.|\.env|secret|credential|token|key)/i,
		message:
			"Sending sensitive data to external endpoint — data exfiltration",
	},
	{
		category: "data-exfiltration",
		severity: "high",
		pattern:
			/(?:curl|wget)\s+(?:-[sSfLkO]*\s+)*(?:https?:\/\/)?(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)[\w.-]+\.\w{2,}/i,
		message:
			"Outbound HTTP request to external URL — verify the destination is trusted",
	},
	{
		category: "data-exfiltration",
		severity: "high",
		pattern:
			/fetch\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)/i,
		message:
			"fetch() to external URL — verify the destination is trusted",
	},

	// ── Critical: Scope Escape ──
	{
		category: "scope-escape",
		severity: "critical",
		pattern:
			/(?:ignore\s+(?:all\s+)?previous|disregard\s+(?:all\s+)?(?:prior|above)|override\s+(?:safety|security|rules)|bypass\s+(?:safety|security|restrictions))/i,
		message:
			"Prompt injection attempt — tries to override safety instructions",
	},
	{
		category: "scope-escape",
		severity: "critical",
		pattern:
			/(?:you\s+are\s+now|from\s+now\s+on|new\s+instructions?:?\s+)/i,
		message:
			"Attempts to redefine agent identity — prompt injection risk",
	},

	// ── Critical: Self-Modification ──
	{
		category: "self-modification",
		severity: "critical",
		pattern:
			/(?:write|append|modify|edit|overwrite|patch)\s+.*(?:CLAUDE\.md|AGENTS\.md|settings\.json|\.claude\/)/i,
		message:
			"Attempts to modify agent config files — persistence/privilege escalation",
	},
	{
		category: "hook-tampering",
		severity: "critical",
		pattern:
			/(?:rm|remove|delete|disable)\s+.*(?:pre-commit|pre-push|commit-msg|\.git\/hooks)/i,
		message:
			"Attempts to disable or remove git hooks — bypasses safety guardrails",
	},

	// ── High: Privilege Escalation ──
	{
		category: "privilege-escalation",
		severity: "high",
		pattern: /\bsudo\s+/i,
		message: "Uses sudo — may escalate to root privileges",
	},
	{
		category: "privilege-escalation",
		severity: "high",
		pattern: /chmod\s+(?:777|666|a\+[rwx])/i,
		message:
			"Sets overly permissive file permissions — security risk",
	},
	{
		category: "privilege-escalation",
		severity: "high",
		pattern: /chown\s+root/i,
		message: "Changes file ownership to root — privilege escalation",
	},

	// ── High: Destructive Commands ──
	{
		category: "destructive-command",
		severity: "high",
		pattern: /\brm\s+-rf?\s+(?:\/|~|\$HOME|\.\.)/i,
		message:
			"Destructive file deletion targeting root, home, or parent directories",
	},
	{
		category: "destructive-command",
		severity: "high",
		pattern: /git\s+push\s+--force\b/i,
		message: "Force push can destroy remote history",
	},
	{
		category: "destructive-command",
		severity: "high",
		pattern: /DROP\s+(?:TABLE|DATABASE|INDEX)/i,
		message: "SQL DROP statement — potential data loss",
	},

	// ── High: File Traversal ──
	{
		category: "file-traversal",
		severity: "high",
		pattern: /(?:\.\.\/){2,}/,
		message:
			"Multiple path traversal sequences — may access files outside project",
	},
	{
		category: "file-traversal",
		severity: "high",
		pattern:
			/(?:readFile|writeFile|open|fs\.)\s*\(\s*['"`]\/(?:etc|usr|var|tmp|root|home)\//i,
		message:
			"Absolute path to system directory — scope escape risk",
	},

	// ── Moderate: Obfuscation ──
	{
		category: "obfuscation",
		severity: "moderate",
		pattern: /(?:atob|btoa|Buffer\.from)\s*\(\s*['"`][A-Za-z0-9+/]{40,}/,
		message:
			"Base64 encoded content — may hide malicious payloads",
	},
	{
		category: "obfuscation",
		severity: "moderate",
		pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){4,}/,
		message:
			"Hex-encoded string sequence — may hide malicious payloads",
	},

	// ── Moderate: Excessive Permissions ──
	{
		category: "excessive-permissions",
		severity: "moderate",
		pattern:
			/allowed-tools:\s*.*(?:Bash|Edit|Write|Read|Glob|Grep|WebFetch|WebSearch).*(?:Bash|Edit|Write|Read|Glob|Grep|WebFetch|WebSearch).*(?:Bash|Edit|Write|Read|Glob|Grep|WebFetch|WebSearch).*(?:Bash|Edit|Write|Read|Glob|Grep|WebFetch|WebSearch)/i,
		message:
			"Requests many tools — verify skill actually needs all of them",
	},
];

// =============================================================================
// Provenance check
// =============================================================================

interface ProvenanceInfo {
	hasAuthor: boolean;
	hasVersion: boolean;
	hasDescription: boolean;
}

export function checkProvenance(content: string): ProvenanceInfo {
	// Check YAML frontmatter
	const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
	if (!frontmatterMatch) {
		return { hasAuthor: false, hasVersion: false, hasDescription: false };
	}

	const fm = frontmatterMatch[1];
	return {
		hasAuthor: /\bauthor\s*:/i.test(fm),
		hasVersion: /\bversion\s*:/i.test(fm),
		hasDescription: /\bdescription\s*:/i.test(fm),
	};
}

// =============================================================================
// Core scanner
// =============================================================================

export function scanSkillContent(
	content: string,
	filePath: string,
): SkillThreat[] {
	const threats: SkillThreat[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// Skip empty lines
		if (!trimmed) continue;

		for (const tp of THREAT_PATTERNS) {
			if (tp.pattern.test(trimmed)) {
				threats.push({
					category: tp.category,
					severity: tp.severity,
					pattern: tp.pattern.source.slice(0, 80),
					line: i + 1,
					context: trimmed.slice(0, 120),
					message: tp.message,
				});
			}
		}
	}

	// Check provenance
	const prov = checkProvenance(content);
	if (!prov.hasAuthor) {
		threats.push({
			category: "missing-provenance",
			severity: "moderate",
			pattern: "missing author",
			line: 1,
			context: "YAML frontmatter",
			message: "No author metadata — skill origin is unknown",
		});
	}
	if (!prov.hasVersion) {
		threats.push({
			category: "missing-provenance",
			severity: "moderate",
			pattern: "missing version",
			line: 1,
			context: "YAML frontmatter",
			message: "No version metadata — cannot track updates",
		});
	}

	return threats;
}

// =============================================================================
// Verdict computation
// =============================================================================

export function computeVerdict(threats: SkillThreat[]): SkillScanVerdict {
	if (threats.some((t) => t.severity === "critical")) return "block";
	if (threats.some((t) => t.severity === "high")) return "warn";
	return "pass";
}

export function computeScanSummary(threats: SkillThreat[]): SkillScanSummary {
	const summary: SkillScanSummary = {
		total: threats.length,
		critical: 0,
		high: 0,
		moderate: 0,
		low: 0,
	};

	for (const t of threats) {
		switch (t.severity) {
			case "critical":
				summary.critical++;
				break;
			case "high":
				summary.high++;
				break;
			case "moderate":
				summary.moderate++;
				break;
			case "low":
				summary.low++;
				break;
		}
	}

	return summary;
}

// =============================================================================
// Skill name extraction
// =============================================================================

export function extractSkillName(
	content: string,
	filePath: string,
): string {
	// Try frontmatter name
	const fmMatch = content.match(/^---\n[\s\S]*?\bname:\s*(.+)/m);
	if (fmMatch?.[1]) return fmMatch[1].trim();

	// Fall back to directory name
	const dirName = path.basename(path.dirname(filePath));
	if (dirName && dirName !== ".") return dirName;

	return path.basename(filePath, path.extname(filePath));
}

// =============================================================================
// Main scan function
// =============================================================================

export async function scanSkillFile(
	filePath: string,
): Promise<SkillScanResult> {
	const content = await fs.readFile(filePath, "utf-8");
	const skillName = extractSkillName(content, filePath);
	const threats = scanSkillContent(content, filePath);
	const verdict = computeVerdict(threats);
	const summary = computeScanSummary(threats);

	return {
		skillPath: filePath,
		skillName,
		verdict,
		threats,
		summary,
	};
}

/**
 * Scan all SKILL.md files in a directory (recursive).
 * Useful for scanning a plugin's skills directory before installation.
 */
export async function scanSkillsDirectory(
	dir: string,
): Promise<SkillScanResult[]> {
	const results: SkillScanResult[] = [];

	async function walk(currentDir: string): Promise<void> {
		let entries: string[];
		try {
			entries = await fs.readdir(currentDir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry === "node_modules" || entry === ".git") continue;
			const fullPath = path.join(currentDir, entry);
			let stat: fs.Stats;
			try {
				stat = await fs.stat(fullPath);
			} catch {
				continue;
			}

			if (stat.isDirectory()) {
				await walk(fullPath);
			} else if (
				entry === "SKILL.md" ||
				entry === "PLUGIN.md" ||
				entry.toLowerCase() === "skill.md"
			) {
				const result = await scanSkillFile(fullPath);
				results.push(result);
			}
		}
	}

	await walk(dir);
	return results;
}

// =============================================================================
// Report formatting
// =============================================================================

export function formatScanReport(result: SkillScanResult): string {
	const lines: string[] = [];
	const { summary, threats, verdict } = result;

	lines.push(`=== SkillGuard Scan: ${result.skillName} ===`);
	lines.push(`Path: ${result.skillPath}`);
	lines.push(`Verdict: ${verdict.toUpperCase()}`);
	lines.push(
		`Findings: ${summary.total} (${summary.critical} critical, ${summary.high} high, ${summary.moderate} moderate, ${summary.low} low)`,
	);
	lines.push("");

	if (threats.length > 0) {
		lines.push("--- Threats ---");
		for (const t of threats) {
			lines.push(
				`[${t.severity.toUpperCase()}] ${t.category} (line ${t.line})`,
			);
			lines.push(`  ${t.message}`);
			lines.push(`  Context: ${t.context}`);
		}
	}

	if (verdict === "block") {
		lines.push("");
		lines.push(
			"BLOCKED: Critical threats detected. Review and remove before installing.",
		);
	} else if (verdict === "warn") {
		lines.push("");
		lines.push(
			"WARNING: High-severity threats detected. Confirm you trust this skill.",
		);
	}

	return lines.join("\n");
}

export function formatBatchReport(results: SkillScanResult[]): string {
	const lines: string[] = [];
	const blocked = results.filter((r) => r.verdict === "block");
	const warned = results.filter((r) => r.verdict === "warn");
	const passed = results.filter((r) => r.verdict === "pass");

	lines.push(`=== SkillGuard Batch Scan ===`);
	lines.push(`Scanned: ${results.length} skill(s)`);
	lines.push(`Blocked: ${blocked.length}`);
	lines.push(`Warned: ${warned.length}`);
	lines.push(`Passed: ${passed.length}`);
	lines.push("");

	for (const result of results) {
		lines.push(
			`[${result.verdict.toUpperCase()}] ${result.skillName} (${result.summary.total} finding(s))`,
		);
	}

	return lines.join("\n");
}
