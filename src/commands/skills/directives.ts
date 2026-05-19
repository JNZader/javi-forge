// ── Directive extraction (semantic conflict detection) ─────────────────────

/** A directive is a sentiment + subject extracted from a rule */
export interface RuleDirective {
	sentiment: "positive" | "negative";
	subject: string;
}

/**
 * Positive and negative signal patterns.
 * Order matters — first match wins, so more specific patterns go first.
 */
const POSITIVE_SIGNALS: RegExp[] = [
	/\balways use\b/i,
	/\bmust use\b/i,
	/\bprefer\b/i,
	/\balways\b/i,
	/\bmust\b/i,
	/\brequire\b/i,
	/\buse\b/i,
	/\benable\b/i,
	/\bshould\b/i,
];

const NEGATIVE_SIGNALS: RegExp[] = [
	/\bnever use\b/i,
	/\bdo not use\b/i,
	/\bdon't use\b/i,
	/\bnever\b/i,
	/\bavoid\b/i,
	/\bdo not\b/i,
	/\bdon't\b/i,
	/\bdisable\b/i,
	/\bno\b/i,
	/\bforbid\b/i,
];

/**
 * Extract a directive (sentiment + subject) from a rule string.
 * Returns null if the rule has no clear directive.
 */
export function extractDirective(rule: string): RuleDirective | null {
	const norm = rule.toLowerCase().trim();

	// Try negative first (more specific: "never use X" before "use X")
	for (const pattern of NEGATIVE_SIGNALS) {
		const match = norm.match(pattern);
		if (match) {
			const subject = norm
				.slice((match.index ?? 0) + match[0].length)
				.trim()
				.replace(/^(the|a|an)\s+/i, "")
				.replace(/[.;,!]+$/, "")
				.trim();
			if (subject.length >= 3) {
				return { sentiment: "negative", subject };
			}
		}
	}

	for (const pattern of POSITIVE_SIGNALS) {
		const match = norm.match(pattern);
		if (match) {
			const subject = norm
				.slice((match.index ?? 0) + match[0].length)
				.trim()
				.replace(/^(the|a|an)\s+/i, "")
				.replace(/[.;,!]+$/, "")
				.trim();
			if (subject.length >= 3) {
				return { sentiment: "positive", subject };
			}
		}
	}

	return null;
}

/**
 * Check if two subjects are similar enough to be "about the same thing".
 * Uses simple word-overlap (Jaccard-like) — no external NLP needed.
 */
export function subjectsSimilar(
	a: string,
	b: string,
	threshold = 0.5,
): boolean {
	const wordsA = new Set(a.split(/\s+/).filter((w) => w.length > 2));
	const wordsB = new Set(b.split(/\s+/).filter((w) => w.length > 2));

	if (wordsA.size === 0 || wordsB.size === 0) return false;

	let intersection = 0;
	for (const w of wordsA) {
		if (wordsB.has(w)) intersection++;
	}

	const union = new Set([...wordsA, ...wordsB]).size;
	return union > 0 && intersection / union >= threshold;
}

/**
 * Detect a directive clash between two rules:
 * opposite sentiments about the same subject.
 */
export function detectDirectiveClash(
	ruleA: string,
	ruleB: string,
): string | null {
	const dA = extractDirective(ruleA);
	const dB = extractDirective(ruleB);

	if (!dA || !dB) return null;
	if (dA.sentiment === dB.sentiment) return null;

	if (subjectsSimilar(dA.subject, dB.subject)) {
		const posRule = dA.sentiment === "positive" ? ruleA : ruleB;
		const negRule = dA.sentiment === "negative" ? ruleA : ruleB;
		return `Directive clash on "${dA.subject}": positive="${posRule.slice(0, 50)}" vs negative="${negRule.slice(0, 50)}"`;
	}

	return null;
}
