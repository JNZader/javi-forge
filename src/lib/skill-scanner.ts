/**
 * CI-level skill security scanner — pre-install analysis of SKILL.md files.
 *
 * Detects credential theft, code injection, data exfiltration, and scope escape
 * patterns before skills are installed. Inspired by the SkillGuard skill
 * (javi-ai) but implemented as a programmatic module with structured output.
 */

import path from "node:path";
import fs from "fs-extra";
import type { SecuritySeverity } from "../types/index.js";
import { describeSafeReadFailure, safeReadFile } from "./safe-read.js";

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

/**
 * `unscannable` is a fail-closed verdict: the file could not be read in full
 * (binary, oversized, I/O error) or a content-mutating clamp/truncation
 * happened during the read, so we cannot certify it. A gate MUST treat it as a
 * rejection exactly like `block` — see {@link isRejectedVerdict}, the single
 * predicate every install/registry gate should use instead of `=== "block"`.
 */
export type SkillScanVerdict = "pass" | "warn" | "block" | "unscannable";

/**
 * The set of verdicts an install/registry gate rejects on. Fail-closed:
 * `block` (a critical threat was found) and `unscannable` (the file could not
 * be certified because it was not fully scanned) both mean "do not install".
 * Use this everywhere instead of a bare `verdict === "block"` check so a future
 * gate can never let an `unscannable` file slip through.
 */
export function isRejectedVerdict(verdict: SkillScanVerdict): boolean {
	return verdict === "block" || verdict === "unscannable";
}

export interface SkillScanResult {
	skillPath: string;
	skillName: string;
	verdict: SkillScanVerdict;
	threats: SkillThreat[];
	summary: SkillScanSummary;
	/**
	 * Scan-level notes — populated when the file could not be fully analysed
	 * (binary, oversized, unreadable) so a skipped file is visible in the report
	 * instead of masquerading as a clean pass.
	 */
	notes?: string[];
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
		message: "Process execution with user input — enables command injection",
	},
	{
		category: "code-injection",
		severity: "critical",
		pattern:
			/\b(?:subprocess\.(?:call|run|Popen)|os\.system|os\.popen)\s*\(\s*(?:f['"]|user|input|req)/i,
		message: "Python subprocess with user input — enables command injection",
	},

	// ── Critical: Data Exfiltration ──
	{
		category: "data-exfiltration",
		severity: "critical",
		pattern:
			/(?:curl|wget|fetch|axios|got|request)\s+.*(?:--data|--upload|-d\s|-F\s|\.post\(|\.put\()\s*.*(?:\/etc\/|~\/\.|\.env|secret|credential|token|key)/i,
		message: "Sending sensitive data to external endpoint — data exfiltration",
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
		pattern: /fetch\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)/i,
		message: "fetch() to external URL — verify the destination is trusted",
	},

	// ── Critical: Scope Escape ──
	{
		category: "scope-escape",
		severity: "critical",
		pattern:
			/(?:ignore\s+(?:all\s+)?previous|disregard\s+(?:all\s+)?(?:prior|above)|override\s+(?:safety|security|rules)|bypass\s+(?:safety|security|restrictions))/i,
		message: "Prompt injection attempt — tries to override safety instructions",
	},
	{
		category: "scope-escape",
		severity: "critical",
		pattern: /(?:you\s+are\s+now|from\s+now\s+on|new\s+instructions?:?\s+)/i,
		message: "Attempts to redefine agent identity — prompt injection risk",
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
		message: "Sets overly permissive file permissions — security risk",
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
		message: "Absolute path to system directory — scope escape risk",
	},

	// ── Moderate: Obfuscation ──
	{
		category: "obfuscation",
		severity: "moderate",
		pattern: /(?:atob|btoa|Buffer\.from)\s*\(\s*['"`][A-Za-z0-9+/]{40,}/,
		message: "Base64 encoded content — may hide malicious payloads",
	},
	{
		category: "obfuscation",
		severity: "moderate",
		pattern: /\\x[0-9a-fA-F]{2}(?:\\x[0-9a-fA-F]{2}){4,}/,
		message: "Hex-encoded string sequence — may hide malicious payloads",
	},

	// ── Moderate: Excessive Permissions ──
	{
		category: "excessive-permissions",
		severity: "moderate",
		pattern:
			/allowed-tools:\s*.*(?:Bash|Edit|Write|Read|Glob|Grep|WebFetch|WebSearch).*(?:Bash|Edit|Write|Read|Glob|Grep|WebFetch|WebSearch).*(?:Bash|Edit|Write|Read|Glob|Grep|WebFetch|WebSearch).*(?:Bash|Edit|Write|Read|Glob|Grep|WebFetch|WebSearch)/i,
		message: "Requests many tools — verify skill actually needs all of them",
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
	_filePath: string,
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

export function extractSkillName(content: string, filePath: string): string {
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

/**
 * Hard ceiling for a scanned skill file. Past this it is not a skill document
 * but a dumped log or a vendored bundle: scanning it would run every regex
 * over megabytes of noise, so it is skipped and reported instead.
 */
const MAX_SCAN_BYTES = 1024 * 1024;

export async function scanSkillFile(
	filePath: string,
): Promise<SkillScanResult> {
	// `maxLineLength: 0` disables the per-line clamp for the scanner's own read:
	// a padded single line hiding `rm -rf ~` past column 10k must reach the regex
	// pass intact, not be silently truncated and then scanned as if complete. The
	// total-byte ceiling still bounds memory (a file past it fails `too-large`).
	const read = await safeReadFile(filePath, {
		hardRejectOverBytes: MAX_SCAN_BYTES,
		maxLineLength: 0,
	});

	// A file we could not read is not a clean file. Never crash the batch, and
	// never report it as a pass: an unscannable file cannot be certified safe, so
	// it fails closed with the strongest verdict a gate rejects on.
	if (!read.ok) {
		return {
			skillPath: filePath,
			skillName: path.basename(path.dirname(filePath)),
			verdict: "unscannable",
			threats: [],
			summary: computeScanSummary([]),
			notes: [
				`scanning incomplete: ${describeSafeReadFailure(read)} — rejected (an unscannable file cannot be certified safe)`,
			],
		};
	}

	const content = read.content;
	const skillName = extractSkillName(content, filePath);
	const threats = scanSkillContent(content, filePath);
	const summary = computeScanSummary(threats);

	// A content-mutating read (truncated bytes, or a clamped line) means the
	// regex pass did NOT see the whole file. Even if no threat surfaced in what
	// we did see, we cannot certify the rest — fail closed rather than emit a
	// pass/warn over partial content. With `maxLineLength: 0` and the byte
	// ceiling above these should not fire, but the guard is the safety net.
	const incomplete = read.truncated || read.longLinesClamped;

	const notes: string[] = [];
	if (read.truncated) {
		notes.push(
			`truncated: only the first ${read.bytesRead} of ${read.totalBytes} bytes were scanned`,
		);
	}
	if (read.longLinesClamped) {
		notes.push("clamped: one or more lines exceeded the per-line limit");
	}
	if (incomplete) {
		notes.push(
			"rejected: the file was not fully scanned and cannot be certified safe",
		);
	}

	const verdict: SkillScanVerdict = incomplete
		? "unscannable"
		: computeVerdict(threats);

	return {
		skillPath: filePath,
		skillName,
		verdict,
		threats,
		summary,
		...(notes.length > 0 ? { notes } : {}),
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
// Coverage walk — install-footprint integrity (JD-002, JD-003, JD-005, JD-007)
// =============================================================================

export interface SkillCoverageScan {
	/**
	 * Scan results for the declared-entry SKILL.md files — the ONLY files the
	 * walk content-scans (JD-005). A declared file that is a symlink is never
	 * read through (it is already in {@link symlinks}); a missing declared
	 * SKILL.md fails closed as `unscannable`.
	 */
	declared: SkillScanResult[];
	/**
	 * Skill-shaped files (basename `SKILL.md`/`skill.md`) found in the tree
	 * OUTSIDE the declared set — including under `node_modules`/`.git` (JD-007).
	 * Paths only; content is never read during the walk (JD-005).
	 */
	undeclared: string[];
	/**
	 * ANY symlink (file or dir) found in the tree. The caller refuses on this
	 * (manifest-integrity, block-level, force never lifts — JD-007); the walk
	 * never dereferences them (JD-003).
	 */
	symlinks: string[];
}

/**
 * SKILL.md-only coverage walk for the install gates (JD-006/JD-007).
 *
 * Visits the ENTIRE tree with NO `node_modules`/`.git` exemption, so the visit
 * set is exactly the footprint `fs.move`/`fs.copy` will place (JD-007). Collects
 * only basename `SKILL.md`/`skill.md` files — never `PLUGIN.md`/README content
 * (JD-002) — and flags ANY symlink (file or dir) without dereferencing it
 * (JD-007/JD-003). A realpath visited-set terminates cycles defensively even if
 * a future caller ever recurses through a link (JD-003). The walk itself does NO
 * content reads: only the declared-entry files are handed to
 * {@link scanSkillFile} afterwards (JD-005).
 */
export async function scanSkillsWithCoverage(
	dir: string,
	declaredPaths: string[],
): Promise<SkillCoverageScan> {
	// Resolve the scan root once. Declared entries must stay inside it — a
	// hostile manifest can never make the gate read outside the staged clone
	// (JD-003: "no read outside the staged clone"; the interface contract names
	// declared paths realpath-contained).
	const rootAbs = path.resolve(dir);
	const rootReal = await fs.realpath(rootAbs);

	// Resolve each declared entry once (containment-verified) and reuse it for
	// both the coverage set and the content scan — never twice.
	const declaredDirs = new Map<string, string>();
	for (const entry of declaredPaths) {
		declaredDirs.set(entry, await resolveContained(rootAbs, rootReal, entry));
	}

	const declaredFiles = new Set<string>();
	for (const absDir of declaredDirs.values()) {
		declaredFiles.add(path.join(absDir, "SKILL.md"));
	}

	const undeclared: string[] = [];
	const symlinks: string[] = [];
	const visited = new Set<string>();

	async function walk(currentDir: string): Promise<void> {
		// realpath visited-set: a defensive cycle invariant (JD-003). Symlinks are
		// never recursed into, so no cycle can form through the walk itself; the
		// set guarantees termination even if that ever changes.
		let real: string;
		try {
			real = await fs.realpath(currentDir);
		} catch {
			return;
		}
		if (visited.has(real)) return;
		visited.add(real);

		let entries: string[];
		try {
			entries = await fs.readdir(currentDir);
		} catch {
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry);
			let lst: fs.Stats;
			try {
				lst = await fs.lstat(fullPath);
			} catch {
				continue;
			}

			// Symlinks are never dereferenced: flagged for the caller's
			// manifest-integrity refusal, never recursed into, never scanned
			// (JD-007/JD-003).
			if (lst.isSymbolicLink()) {
				symlinks.push(fullPath);
				continue;
			}

			if (lst.isDirectory()) {
				await walk(fullPath);
				continue;
			}

			// SKILL.md-only collection: basename SKILL.md/skill.md, never
			// PLUGIN.md or README (JD-002).
			if (entry.toLowerCase() === "skill.md") {
				const resolved = path.resolve(fullPath);
				if (!declaredFiles.has(resolved)) {
					undeclared.push(fullPath);
				}
			}
		}
	}

	await walk(dir);

	// Content-scanned results for declared entries only (JD-005), in declared
	// order so reports are deterministic. A declared file that is a symlink is
	// already in `symlinks` — reading through it would escape the tree (JD-003),
	// so it is skipped here (the caller refuses on `symlinks` first anyway).
	const symlinkSet = new Set(symlinks.map((p) => path.resolve(p)));
	const declared: SkillScanResult[] = [];
	// Iterating the map keeps declared order (insertion order == declaredPaths)
	// and guarantees an entry cannot be absent once resolved.
	for (const absDir of declaredDirs.values()) {
		const file = path.join(absDir, "SKILL.md");
		if (symlinkSet.has(file)) continue;
		declared.push(await scanSkillFile(file));
	}

	return { declared, undeclared, symlinks };
}

/**
 * Resolve a declared skill entry to an absolute directory and verify it stays
 * inside the scan root — both lexically (`../../x`, absolute paths) and by
 * realpath, so an in-tree symlink cannot redirect the declared read outside the
 * staged clone (JD-003). Throws when the entry escapes; the caller denies.
 */
async function resolveContained(
	rootAbs: string,
	rootReal: string,
	entry: string,
): Promise<string> {
	const entryAbs = path.resolve(rootAbs, entry);

	// Lexical containment — catches `../outside` and absolute entries.
	const rel = path.relative(rootAbs, entryAbs);
	if (rel.startsWith("..") || path.isAbsolute(rel)) {
		throw new Error(
			`skillguard: declared skill path escapes scan root — ${entry}`,
		);
	}

	// Realpath containment — catches a directory inside the tree whose real
	// location is outside it. A missing declared dir (later `unscannable`) has
	// no realpath yet; its lexical containment above is then the whole guard.
	let real: string;
	try {
		real = await fs.realpath(entryAbs);
	} catch {
		return entryAbs;
	}
	const relReal = path.relative(rootReal, real);
	if (relReal.startsWith("..") || path.isAbsolute(relReal)) {
		throw new Error(
			`skillguard: declared skill path escapes scan root — ${entry}`,
		);
	}

	return entryAbs;
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

	if (result.notes && result.notes.length > 0) {
		lines.push("--- Notes ---");
		for (const note of result.notes) lines.push(`  ${note}`);
		lines.push("");
	}

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

	if (verdict === "unscannable") {
		lines.push("");
		lines.push(
			"REJECTED: File could not be fully scanned, so it cannot be certified safe. Not installed.",
		);
	} else if (verdict === "block") {
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
	const unscannable = results.filter((r) => r.verdict === "unscannable");
	const warned = results.filter((r) => r.verdict === "warn");
	const passed = results.filter((r) => r.verdict === "pass");

	lines.push(`=== SkillGuard Batch Scan ===`);
	lines.push(`Scanned: ${results.length} skill(s)`);
	lines.push(`Rejected: ${blocked.length + unscannable.length}`);
	lines.push(`  Blocked (threats): ${blocked.length}`);
	lines.push(`  Unscannable (not certified): ${unscannable.length}`);
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
