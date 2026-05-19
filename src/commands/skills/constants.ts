import path from "node:path";

// ── Default paths and limits ────────────────────────────────────────────────

export const DEFAULT_SKILLS_DIR = path.join(
	process.env.HOME ?? "~",
	".claude",
	"skills",
);

export const DEFAULT_BUDGET = 8000;

/** Approximate tokens per character (GPT/Claude rough average) */
export const CHARS_PER_TOKEN = 4;

/** Default skill quality scoring threshold */
export const DEFAULT_THRESHOLD = 50;

/** Default registry quality threshold */
export const DEFAULT_REGISTRY_THRESHOLD = 60;

// ── Contradiction keywords (pairs that signal opposite intent) ───────────────

export const CONTRADICTION_PAIRS: [RegExp, RegExp][] = [
	[/\buse semicolons\b/i, /\bno semicolons\b/i],
	[/\bsemicolons required\b/i, /\bno semicolons\b/i],
	[/\bsingle quotes\b/i, /\bdouble quotes\b/i],
	[/\btabs\b/i, /\bspaces\b/i],
	[/\b2[- ]?spaces?\b/i, /\b4[- ]?spaces?\b/i],
	[/\bclass[- ]?based\b/i, /\bfunctional\b/i],
	[/\bOOP\b/i, /\bfunctional\b/i],
	[/\bmutable\b/i, /\bimmutable\b/i],
	[/\bany\b.*\ballowed\b/i, /\bno any\b/i],
	[/\bdefault export\b/i, /\bnamed export\b/i],
	[/\bnever use\b/i, /\balways use\b/i],
	[/\bavoid\b/i, /\bprefer\b/i],
	[/\bdo not\b/i, /\bmust\b/i],
];
