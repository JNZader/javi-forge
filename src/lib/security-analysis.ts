/**
 * Trail of Bits security analysis patterns for CI pipeline.
 *
 * Integrates static analysis via CodeQL/Semgrep rule patterns for
 * vulnerability detection, variant analysis, and structured reporting
 * with severity levels (critical, high, medium, low).
 */

import fs from "fs-extra";
import path from "path";
import type { SecuritySeverity } from "../types/index.js";

// =============================================================================
// Types
// =============================================================================

export type AnalysisEngine = "semgrep" | "codeql";

export interface SecurityAnalysisFinding {
	ruleId: string;
	engine: AnalysisEngine;
	severity: SecuritySeverity;
	message: string;
	file: string;
	line: number;
	column?: number;
	category: string;
	cwe?: string;
	owasp?: string;
}

export interface SecurityAnalysisReport {
	engine: AnalysisEngine;
	timestamp: string;
	projectDir: string;
	findings: SecurityAnalysisFinding[];
	summary: SecurityAnalysisSummary;
}

export interface SecurityAnalysisSummary {
	total: number;
	bySeverity: Record<SecuritySeverity, number>;
	byCategory: Record<string, number>;
	passed: boolean;
	failThreshold: SecuritySeverity;
}

export interface SecurityAnalysisOptions {
	/** Minimum severity to cause CI failure (default: "high") */
	failThreshold?: SecuritySeverity;
	/** Custom rules directory (Semgrep YAML or CodeQL QL files) */
	rulesDir?: string;
	/** Specific rule IDs to include (empty = all) */
	includeRules?: string[];
	/** Specific rule IDs to exclude */
	excludeRules?: string[];
	/** Target directories to scan (default: ["."]) */
	targetDirs?: string[];
}

// =============================================================================
// Constants
// =============================================================================

const SEVERITY_ORDER: Record<SecuritySeverity, number> = {
	critical: 5,
	high: 4,
	moderate: 3,
	low: 2,
	info: 1,
};

// =============================================================================
// Built-in Semgrep Rules (Trail of Bits patterns)
// =============================================================================

export interface SemgrepRule {
	id: string;
	severity: SecuritySeverity;
	message: string;
	category: string;
	pattern: string;
	languages: string[];
	cwe?: string;
	owasp?: string;
}

/**
 * Trail of Bits-inspired static analysis rules ported to pattern matching.
 * These cover the most common vulnerability classes found in security audits.
 */
export const BUILTIN_RULES: SemgrepRule[] = [
	// -- Injection --
	{
		id: "tob-js-eval-injection",
		severity: "critical",
		message: "Use of eval() with dynamic input enables code injection",
		category: "injection",
		pattern: "\\beval\\s*\\(",
		languages: ["javascript", "typescript"],
		cwe: "CWE-94",
		owasp: "A03:2021",
	},
	{
		id: "tob-js-function-constructor",
		severity: "critical",
		message: "Function constructor with dynamic input enables code injection",
		category: "injection",
		pattern: "\\bnew\\s+Function\\s*\\(",
		languages: ["javascript", "typescript"],
		cwe: "CWE-94",
		owasp: "A03:2021",
	},
	{
		id: "tob-py-exec-injection",
		severity: "critical",
		message: "Use of exec() with dynamic input enables code injection",
		category: "injection",
		pattern: "\\bexec\\s*\\(",
		languages: ["python"],
		cwe: "CWE-94",
		owasp: "A03:2021",
	},
	{
		id: "tob-py-eval-injection",
		severity: "critical",
		message: "Use of eval() with dynamic input enables code injection",
		category: "injection",
		pattern: "\\beval\\s*\\(",
		languages: ["python"],
		cwe: "CWE-94",
		owasp: "A03:2021",
	},
	{
		id: "tob-sql-injection",
		severity: "critical",
		message:
			"String concatenation in SQL query — use parameterized queries instead",
		category: "injection",
		pattern:
			"(?:SELECT|INSERT|UPDATE|DELETE|DROP)\\s+.*\\+\\s*(?:req\\.|params\\.|query\\.|body\\.)",
		languages: ["javascript", "typescript", "python"],
		cwe: "CWE-89",
		owasp: "A03:2021",
	},
	{
		id: "tob-cmd-injection",
		severity: "critical",
		message: "Shell command with string interpolation — use execFile instead",
		category: "injection",
		pattern: "\\bexec(?:Sync)?\\s*\\(\\s*`",
		languages: ["javascript", "typescript"],
		cwe: "CWE-78",
		owasp: "A03:2021",
	},

	// -- Cryptography --
	{
		id: "tob-weak-hash-md5",
		severity: "high",
		message: "MD5 is cryptographically broken — use SHA-256 or better",
		category: "cryptography",
		pattern:
			"(?:createHash\\s*\\(\\s*['\"]md5['\"]|hashlib\\.md5|MD5\\.Create|Digest::MD5)",
		languages: ["javascript", "typescript", "python", "ruby", "go"],
		cwe: "CWE-328",
	},
	{
		id: "tob-weak-hash-sha1",
		severity: "high",
		message: "SHA-1 is deprecated — use SHA-256 or better",
		category: "cryptography",
		pattern:
			"(?:createHash\\s*\\(\\s*['\"]sha1['\"]|hashlib\\.sha1|SHA1\\.Create)",
		languages: ["javascript", "typescript", "python"],
		cwe: "CWE-328",
	},
	{
		id: "tob-hardcoded-secret",
		severity: "high",
		message:
			"Hardcoded secret or API key detected — use environment variables",
		category: "cryptography",
		pattern:
			"(?:password|secret|api_key|apikey|auth_token|private_key)\\s*=\\s*['\"][^'\"]{8,}['\"]",
		languages: ["javascript", "typescript", "python", "go", "ruby"],
		cwe: "CWE-798",
		owasp: "A07:2021",
	},

	// -- Deserialization --
	{
		id: "tob-unsafe-deserialize",
		severity: "critical",
		message:
			"Unsafe deserialization can lead to remote code execution — use safe alternatives",
		category: "deserialization",
		pattern: "(?:pickle\\.loads?|yaml\\.load\\s*\\((?!.*Loader=SafeLoader))",
		languages: ["python"],
		cwe: "CWE-502",
		owasp: "A08:2021",
	},
	{
		id: "tob-unsafe-json-parse",
		severity: "moderate",
		message:
			"JSON.parse without try/catch can crash on malformed input",
		category: "deserialization",
		pattern:
			"(?<!try\\s*\\{[^}]*)JSON\\.parse\\s*\\(\\s*(?:req\\.|body\\.|input)",
		languages: ["javascript", "typescript"],
		cwe: "CWE-502",
	},

	// -- Path Traversal --
	{
		id: "tob-path-traversal",
		severity: "high",
		message:
			"User input in file path without sanitization — validate path components",
		category: "path-traversal",
		pattern:
			"(?:readFile|writeFile|createReadStream|open)\\s*\\(.*(?:req\\.|params\\.|query\\.)",
		languages: ["javascript", "typescript"],
		cwe: "CWE-22",
		owasp: "A01:2021",
	},
	{
		id: "tob-py-path-traversal",
		severity: "high",
		message:
			"User input in file path without sanitization — validate path components",
		category: "path-traversal",
		pattern: "open\\s*\\(.*(?:request\\.|args\\.|kwargs\\.)",
		languages: ["python"],
		cwe: "CWE-22",
		owasp: "A01:2021",
	},

	// -- Information Disclosure --
	{
		id: "tob-stack-trace-leak",
		severity: "moderate",
		message: "Stack trace sent to client — hide error details in production",
		category: "information-disclosure",
		pattern: "(?:res\\.(?:send|json)\\s*\\(.*(?:err|error)\\.(?:stack|message))",
		languages: ["javascript", "typescript"],
		cwe: "CWE-209",
		owasp: "A04:2021",
	},
	{
		id: "tob-debug-enabled",
		severity: "moderate",
		message: "Debug mode should not be enabled in production",
		category: "information-disclosure",
		pattern: "(?:DEBUG\\s*=\\s*True|app\\.debug\\s*=\\s*True)",
		languages: ["python"],
		cwe: "CWE-489",
	},

	// -- Authentication --
	{
		id: "tob-jwt-none-algorithm",
		severity: "critical",
		message:
			"JWT with 'none' algorithm allows token forgery — always specify algorithm",
		category: "authentication",
		pattern:
			"(?:algorithm\\s*[=:]\\s*['\"]none['\"]|algorithms\\s*[=:]\\s*\\[\\s*['\"]none['\"])",
		languages: ["javascript", "typescript", "python"],
		cwe: "CWE-345",
		owasp: "A07:2021",
	},
];

// =============================================================================
// Language detection
// =============================================================================

const LANG_EXTENSIONS: Record<string, string[]> = {
	javascript: [".js", ".mjs", ".cjs"],
	typescript: [".ts", ".mts", ".cts", ".tsx"],
	python: [".py"],
	go: [".go"],
	ruby: [".rb"],
	rust: [".rs"],
};

export function detectFileLanguage(filePath: string): string | null {
	const ext = path.extname(filePath).toLowerCase();
	for (const [lang, exts] of Object.entries(LANG_EXTENSIONS)) {
		if (exts.includes(ext)) return lang;
	}
	return null;
}

// =============================================================================
// Pattern matching engine
// =============================================================================

export function matchRule(
	rule: SemgrepRule,
	content: string,
	filePath: string,
): SecurityAnalysisFinding[] {
	const lang = detectFileLanguage(filePath);
	if (!lang || !rule.languages.includes(lang)) return [];

	const findings: SecurityAnalysisFinding[] = [];
	const lines = content.split("\n");
	const regex = new RegExp(rule.pattern, "gi");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		// Skip comments
		const trimmed = line.trim();
		if (
			trimmed.startsWith("//") ||
			trimmed.startsWith("#") ||
			trimmed.startsWith("*") ||
			trimmed.startsWith("/*")
		) {
			continue;
		}

		let match: RegExpExecArray | null;
		// Reset lastIndex for global regex
		regex.lastIndex = 0;
		match = regex.exec(line);
		while (match) {
			findings.push({
				ruleId: rule.id,
				engine: "semgrep",
				severity: rule.severity,
				message: rule.message,
				file: filePath,
				line: i + 1,
				column: match.index + 1,
				category: rule.category,
				cwe: rule.cwe,
				owasp: rule.owasp,
			});
			match = regex.exec(line);
		}
	}

	return findings;
}

// =============================================================================
// File scanning
// =============================================================================

const IGNORED_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"coverage",
	".next",
	"__pycache__",
	".venv",
	"venv",
	"vendor",
	"target",
]);

const SCANNABLE_EXTENSIONS = new Set([
	".js",
	".mjs",
	".cjs",
	".ts",
	".mts",
	".cts",
	".tsx",
	".py",
	".go",
	".rb",
	".rs",
]);

export async function collectFiles(dir: string): Promise<string[]> {
	const results: string[] = [];

	async function walk(currentDir: string): Promise<void> {
		let entries: string[];
		try {
			entries = await fs.readdir(currentDir);
		} catch {
			return;
		}

		for (const entry of entries) {
			if (IGNORED_DIRS.has(entry)) continue;
			const fullPath = path.join(currentDir, entry);
			let stat: fs.Stats;
			try {
				stat = await fs.stat(fullPath);
			} catch {
				continue;
			}
			if (stat.isDirectory()) {
				await walk(fullPath);
			} else if (SCANNABLE_EXTENSIONS.has(path.extname(entry).toLowerCase())) {
				results.push(fullPath);
			}
		}
	}

	await walk(dir);
	return results;
}

// =============================================================================
// Severity helpers
// =============================================================================

export function severityAtOrAbove(
	severity: SecuritySeverity,
	threshold: SecuritySeverity,
): boolean {
	return SEVERITY_ORDER[severity] >= SEVERITY_ORDER[threshold];
}

// =============================================================================
// Report generation
// =============================================================================

export function buildSummary(
	findings: SecurityAnalysisFinding[],
	failThreshold: SecuritySeverity,
): SecurityAnalysisSummary {
	const bySeverity: Record<SecuritySeverity, number> = {
		critical: 0,
		high: 0,
		moderate: 0,
		low: 0,
		info: 0,
	};
	const byCategory: Record<string, number> = {};

	for (const f of findings) {
		bySeverity[f.severity]++;
		byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
	}

	const passed = !findings.some((f) =>
		severityAtOrAbove(f.severity, failThreshold),
	);

	return {
		total: findings.length,
		bySeverity,
		byCategory,
		passed,
		failThreshold,
	};
}

export function buildReport(
	findings: SecurityAnalysisFinding[],
	projectDir: string,
	options: SecurityAnalysisOptions = {},
): SecurityAnalysisReport {
	const failThreshold = options.failThreshold ?? "high";

	return {
		engine: "semgrep",
		timestamp: new Date().toISOString(),
		projectDir,
		findings,
		summary: buildSummary(findings, failThreshold),
	};
}

// =============================================================================
// Filtering
// =============================================================================

export function filterRules(
	rules: SemgrepRule[],
	options: SecurityAnalysisOptions = {},
): SemgrepRule[] {
	let filtered = [...rules];

	if (options.includeRules && options.includeRules.length > 0) {
		const includeSet = new Set(options.includeRules);
		filtered = filtered.filter((r) => includeSet.has(r.id));
	}

	if (options.excludeRules && options.excludeRules.length > 0) {
		const excludeSet = new Set(options.excludeRules);
		filtered = filtered.filter((r) => !excludeSet.has(r.id));
	}

	return filtered;
}

// =============================================================================
// Custom rules loading
// =============================================================================

export async function loadCustomRules(
	rulesDir: string,
): Promise<SemgrepRule[]> {
	if (!(await fs.pathExists(rulesDir))) return [];

	const customRules: SemgrepRule[] = [];
	const files = await fs.readdir(rulesDir);

	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		try {
			const content = await fs.readJson(path.join(rulesDir, file));
			if (Array.isArray(content)) {
				for (const rule of content) {
					if (isValidRule(rule)) {
						customRules.push(rule);
					}
				}
			} else if (isValidRule(content)) {
				customRules.push(content);
			}
		} catch {
			// Skip invalid rule files
		}
	}

	return customRules;
}

function isValidRule(rule: unknown): rule is SemgrepRule {
	if (!rule || typeof rule !== "object") return false;
	const r = rule as Record<string, unknown>;
	return (
		typeof r.id === "string" &&
		typeof r.severity === "string" &&
		typeof r.message === "string" &&
		typeof r.category === "string" &&
		typeof r.pattern === "string" &&
		Array.isArray(r.languages)
	);
}

// =============================================================================
// Main scan function
// =============================================================================

export async function runSecurityAnalysis(
	projectDir: string,
	options: SecurityAnalysisOptions = {},
): Promise<SecurityAnalysisReport> {
	// Collect rules
	let rules = filterRules(BUILTIN_RULES, options);

	// Load custom rules if provided
	if (options.rulesDir) {
		const custom = await loadCustomRules(options.rulesDir);
		const customFiltered = filterRules(custom, options);
		rules = [...rules, ...customFiltered];
	}

	// Collect files
	const targetDirs = options.targetDirs ?? [projectDir];
	const allFiles: string[] = [];
	for (const dir of targetDirs) {
		const absDir = path.isAbsolute(dir) ? dir : path.join(projectDir, dir);
		const files = await collectFiles(absDir);
		allFiles.push(...files);
	}

	// Run pattern matching
	const findings: SecurityAnalysisFinding[] = [];
	for (const filePath of allFiles) {
		let content: string;
		try {
			content = await fs.readFile(filePath, "utf-8");
		} catch {
			continue;
		}

		// Use relative paths in findings for readability
		const relativePath = path.relative(projectDir, filePath);

		for (const rule of rules) {
			const matches = matchRule(rule, content, filePath);
			// Rewrite file paths to relative
			for (const match of matches) {
				match.file = relativePath;
			}
			findings.push(...matches);
		}
	}

	// Sort by severity (critical first), then by file
	findings.sort((a, b) => {
		const sevDiff = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
		if (sevDiff !== 0) return sevDiff;
		return a.file.localeCompare(b.file);
	});

	return buildReport(findings, projectDir, options);
}

// =============================================================================
// Report formatting (for CI output)
// =============================================================================

export function formatReportText(report: SecurityAnalysisReport): string {
	const lines: string[] = [];
	const { summary, findings } = report;

	lines.push("=== Security Analysis Report ===");
	lines.push(`Engine: ${report.engine}`);
	lines.push(`Findings: ${summary.total}`);
	lines.push(
		`Severity breakdown: ${Object.entries(summary.bySeverity)
			.filter(([, count]) => count > 0)
			.map(([sev, count]) => `${count} ${sev}`)
			.join(", ") || "none"}`,
	);
	lines.push(`Pass threshold: ${summary.failThreshold}`);
	lines.push(`Result: ${summary.passed ? "PASS" : "FAIL"}`);
	lines.push("");

	if (findings.length > 0) {
		lines.push("--- Findings ---");
		for (const f of findings) {
			const loc = f.column ? `${f.file}:${f.line}:${f.column}` : `${f.file}:${f.line}`;
			const cwe = f.cwe ? ` [${f.cwe}]` : "";
			lines.push(
				`[${f.severity.toUpperCase()}] ${f.ruleId}${cwe} at ${loc}`,
			);
			lines.push(`  ${f.message}`);
		}
	}

	return lines.join("\n");
}

export function formatReportJson(report: SecurityAnalysisReport): string {
	return JSON.stringify(report, null, 2);
}
