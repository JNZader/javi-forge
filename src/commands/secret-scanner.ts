/**
 * Secret scanner — detects leaked credentials in source files using
 * a curated regex bundle. Designed for pre-commit hooks and CI gates.
 */

import fs from "fs-extra";
import path from "path";

// ── Types ──

export interface SecretPattern {
	id: string;
	label: string;
	pattern: RegExp;
	severity: "critical" | "high" | "medium";
}

export interface SecretFinding {
	patternId: string;
	label: string;
	severity: SecretPattern["severity"];
	file: string;
	line: number;
	match: string; // masked: first 4 + last 2 chars
}

export interface ScanResult {
	findings: SecretFinding[];
	filesScanned: number;
	patternsUsed: number;
}

// ── Regex Bundle ──

export const SECRET_PATTERNS: SecretPattern[] = [
	// AWS
	{
		id: "aws-access-key",
		label: "AWS Access Key ID",
		pattern: /\bAKIA[0-9A-Z]{16}\b/,
		severity: "critical",
	},
	{
		id: "aws-secret-key",
		label: "AWS Secret Access Key",
		pattern: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/,
		severity: "critical",
	},

	// Google
	{
		id: "gcp-api-key",
		label: "Google API Key",
		pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
		severity: "high",
	},
	{
		id: "gcp-oauth",
		label: "Google OAuth Client Secret",
		pattern: /\bGOCSPX-[A-Za-z0-9_-]{28}\b/,
		severity: "critical",
	},
	{
		id: "gcp-sa-key",
		label: "GCP Service Account Key",
		pattern: /"type":\s*"service_account"/,
		severity: "critical",
	},

	// GitHub
	{
		id: "github-pat",
		label: "GitHub Personal Access Token",
		pattern: /\bghp_[A-Za-z0-9]{36}\b/,
		severity: "critical",
	},
	{
		id: "github-oauth",
		label: "GitHub OAuth Token",
		pattern: /\bgho_[A-Za-z0-9]{36}\b/,
		severity: "critical",
	},
	{
		id: "github-app-token",
		label: "GitHub App Token",
		pattern: /\bghu_[A-Za-z0-9]{36}\b/,
		severity: "high",
	},
	{
		id: "github-fine-pat",
		label: "GitHub Fine-Grained PAT",
		pattern: /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/,
		severity: "critical",
	},

	// Stripe
	{
		id: "stripe-secret",
		label: "Stripe Secret Key",
		pattern: /\bsk_live_[A-Za-z0-9]{24,}\b/,
		severity: "critical",
	},
	{
		id: "stripe-restricted",
		label: "Stripe Restricted Key",
		pattern: /\brk_live_[A-Za-z0-9]{24,}\b/,
		severity: "critical",
	},

	// Slack
	{
		id: "slack-bot-token",
		label: "Slack Bot Token",
		pattern: /\bxoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24,}\b/,
		severity: "high",
	},
	{
		id: "slack-webhook",
		label: "Slack Webhook URL",
		pattern:
			/https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
		severity: "high",
	},

	// Generic
	{
		id: "private-key",
		label: "Private Key",
		pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
		severity: "critical",
	},
	{
		id: "jwt-token",
		label: "JSON Web Token",
		pattern:
			/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
		severity: "high",
	},
	{
		id: "bearer-token",
		label: "Bearer Token",
		pattern: /[Bb]earer\s+[A-Za-z0-9_-]{20,}/,
		severity: "medium",
	},
	{
		id: "password-assign",
		label: "Password Assignment",
		pattern: /(?:password|passwd|pwd|secret)\s*[:=]\s*['"][^'"]{8,}['"]/,
		severity: "high",
	},

	// Cloud providers
	{
		id: "azure-connection",
		label: "Azure Connection String",
		pattern:
			/DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+/=]+/,
		severity: "critical",
	},
	{
		id: "sendgrid-key",
		label: "SendGrid API Key",
		pattern: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/,
		severity: "high",
	},
	{
		id: "twilio-key",
		label: "Twilio API Key",
		pattern: /\bSK[0-9a-fA-F]{32}\b/,
		severity: "high",
	},

	// Database
	{
		id: "db-connection",
		label: "Database Connection String",
		pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^:\s]+:[^@\s]+@[^\s]+/,
		severity: "critical",
	},

	// Anthropic / OpenAI
	{
		id: "anthropic-key",
		label: "Anthropic API Key",
		pattern: /\bsk-ant-api03-[A-Za-z0-9_-]{93}\b/,
		severity: "critical",
	},
	{
		id: "openai-key",
		label: "OpenAI API Key",
		pattern: /\bsk-[A-Za-z0-9]{48,}\b/,
		severity: "critical",
	},
];

// ── Masking ──

export function maskSecret(value: string): string {
	if (value.length <= 8) return "****";
	return `${value.slice(0, 4)}...${value.slice(-2)}`;
}

// ── File filtering ──

const BINARY_EXTENSIONS = new Set([
	".png",
	".jpg",
	".jpeg",
	".gif",
	".ico",
	".svg",
	".woff",
	".woff2",
	".ttf",
	".eot",
	".mp3",
	".mp4",
	".zip",
	".gz",
	".tar",
	".pdf",
	".exe",
	".dll",
	".so",
	".dylib",
	".o",
	".a",
]);

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	"__pycache__",
	"target",
	"vendor",
	".venv",
	"venv",
	".tox",
	".mypy_cache",
	"coverage",
	".nyc_output",
	".cache",
]);

export function shouldScanFile(filePath: string): boolean {
	const ext = path.extname(filePath).toLowerCase();
	if (BINARY_EXTENSIONS.has(ext)) return false;
	if (filePath.includes("lock") && (ext === ".json" || ext === ".yaml"))
		return false;
	return true;
}

export function shouldSkipDir(dirName: string): boolean {
	return SKIP_DIRS.has(dirName);
}

// ── Scanner ──

export function scanContent(
	content: string,
	filePath: string,
	patterns: SecretPattern[] = SECRET_PATTERNS,
): SecretFinding[] {
	const findings: SecretFinding[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		for (const pat of patterns) {
			const match = pat.pattern.exec(line);
			if (match) {
				findings.push({
					patternId: pat.id,
					label: pat.label,
					severity: pat.severity,
					file: filePath,
					line: i + 1,
					match: maskSecret(match[0]),
				});
			}
		}
	}

	return findings;
}

async function collectFiles(dir: string): Promise<string[]> {
	const results: string[] = [];
	const entries = await fs.readdir(dir, { withFileTypes: true });

	for (const entry of entries) {
		if (entry.isDirectory()) {
			if (!shouldSkipDir(entry.name)) {
				results.push(...(await collectFiles(path.join(dir, entry.name))));
			}
		} else if (entry.isFile() && shouldScanFile(entry.name)) {
			results.push(path.join(dir, entry.name));
		}
	}

	return results;
}

export async function scanDirectory(
	dir: string,
	patterns: SecretPattern[] = SECRET_PATTERNS,
): Promise<ScanResult> {
	const files = await collectFiles(dir);
	const allFindings: SecretFinding[] = [];

	for (const file of files) {
		try {
			const content = await fs.readFile(file, "utf-8");
			const rel = path.relative(dir, file);
			allFindings.push(...scanContent(content, rel, patterns));
		} catch {
			// Skip unreadable files
		}
	}

	return {
		findings: allFindings,
		filesScanned: files.length,
		patternsUsed: patterns.length,
	};
}
