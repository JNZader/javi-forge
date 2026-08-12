import path from "node:path";
import fs from "fs-extra";
import { parseFrontmatter } from "../../lib/frontmatter.js";
import {
	describeSafeReadFailure,
	type SafeReadFailureReason,
	safeReadFile,
} from "../../lib/safe-read.js";
import { CHARS_PER_TOKEN, MAX_SKILL_BYTES } from "./constants.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Estimate token count from a string */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Why a SKILL.md could not be analysed — reportable, never thrown */
export interface SkillReadSkip {
	reason: SafeReadFailureReason;
	message: string;
}

export interface ParsedSkillFile {
	name: string;
	rules: string[];
	rawContent: string;
	triggers: string[];
	/**
	 * Non-null when the file could not be read as analysable text (binary,
	 * oversized, permission denied). `rawContent` is empty in that case, so
	 * callers can report the skip instead of scoring an empty skill.
	 */
	skip: SkillReadSkip | null;
	/** True when the file was longer than the read budget and got cut short. */
	truncated: boolean;
}

/** Read a SKILL.md and extract its name + critical rules section */
export async function parseSkillFile(
	skillPath: string,
): Promise<ParsedSkillFile | null> {
	if (!(await fs.pathExists(skillPath))) return null;

	const read = await safeReadFile(skillPath, {
		hardRejectOverBytes: MAX_SKILL_BYTES,
	});

	if (!read.ok) {
		// A path that vanished between the existence check and the read is the
		// same "no such skill" case the caller already handles with null.
		if (read.reason === "not-found" || read.reason === "not-a-file")
			return null;
		return {
			name: path.basename(path.dirname(skillPath)),
			rules: [],
			rawContent: "",
			triggers: [],
			skip: { reason: read.reason, message: describeSafeReadFailure(read) },
			truncated: false,
		};
	}

	const raw = read.content;
	const fm = parseFrontmatter(raw);

	const rawName = fm?.data?.name;
	const name =
		typeof rawName === "string"
			? rawName
			: path.basename(path.dirname(skillPath));

	// Extract critical rules — look for "Critical Rules" or numbered list after it
	const rules = extractCriticalRules(fm?.content ?? raw);

	// Extract trigger keywords from description
	const rawDesc = fm?.data?.description;
	const description = typeof rawDesc === "string" ? rawDesc : "";
	const triggers = extractTriggers(description);

	// rawContent is the kept text, so token estimates reflect what was analysed.
	return {
		name,
		rules,
		rawContent: raw,
		triggers,
		skip: null,
		truncated: read.truncated,
	};
}

/** Extract critical rules from markdown content */
export function extractCriticalRules(content: string): string[] {
	const rules: string[] = [];

	// Strategy 1: Find "Critical Rules" or "## Critical Rules" section
	const block1 = extractSection(content, /Critical Rules?/i);
	if (block1) {
		extractListItems(block1, rules);
	}

	// Strategy 2: If no critical rules section, look for rules/conventions in any section
	if (rules.length === 0) {
		const block2 = extractSection(content, /Rules?/i);
		if (block2) {
			extractListItems(block2, rules);
		}
	}

	return rules;
}

/** Extract a markdown section body by heading pattern */
function extractSection(
	content: string,
	headingPattern: RegExp,
): string | null {
	const lines = content.split("\n");
	let capturing = false;
	const blockLines: string[] = [];

	for (const line of lines) {
		if (capturing) {
			// Stop at next heading
			if (/^#+\s/.test(line) || /^---/.test(line)) break;
			blockLines.push(line);
		} else if (/^#+\s/.test(line) && headingPattern.test(line)) {
			capturing = true;
		}
	}

	return blockLines.length > 0 ? blockLines.join("\n") : null;
}

/** Extract numbered or bulleted list items from a markdown block */
function extractListItems(block: string, out: string[]): void {
	const lines = block.split("\n");
	for (const line of lines) {
		const match = line.match(/^\s*(?:\d+[.)]\s+|-\s+|\*\s+)(.+)/);
		if (match) {
			const cleaned = match[1].trim();
			if (cleaned.length > 5) out.push(cleaned);
		}
	}
}

/** Extract trigger keywords from a skill description */
export function extractTriggers(description: string): string[] {
	const triggerMatch = description.match(/Trigger:\s*(.+)/i);
	if (!triggerMatch) return [];

	const triggerText = triggerMatch[1];
	// Split on commas, "or", "and", common delimiters
	const keywords = triggerText
		.split(/[,;]|\bor\b/i)
		.map((k) =>
			k
				.trim()
				.toLowerCase()
				.replace(/^when\s+/i, ""),
		)
		.filter((k) => k.length > 2);

	return keywords;
}

// ── Core: Scan installed skills ─────────────────────────────────────────────

/** Discover all SKILL.md files in a skills directory */
export async function discoverSkills(skillsDir: string): Promise<string[]> {
	if (!(await fs.pathExists(skillsDir))) return [];

	const entries = await fs.readdir(skillsDir);
	const skillFiles: string[] = [];

	for (const entry of entries) {
		if (entry.startsWith(".") || entry.startsWith("_")) continue;
		const skillPath = path.join(skillsDir, entry, "SKILL.md");
		if (await fs.pathExists(skillPath)) {
			skillFiles.push(skillPath);
		}
	}

	return skillFiles.sort();
}
