// ── Skill rules lexicons ────────────────────────────────────────────────────

/** Vague terms that reduce clarity score */
export const VAGUE_TERMS = [
	/\bstuff\b/i,
	/\bthings?\b/i,
	/\betc\.?\b/i,
	/\bmisc\b/i,
	/\bvarious\b/i,
	/\bsome\b/i,
	/\bmaybe\b/i,
	/\bprobably\b/i,
];

/** Action verbs that indicate actionable rules */
export const ACTION_VERBS = [
	/\buse\b/i,
	/\bavoid\b/i,
	/\bprefer\b/i,
	/\bnever\b/i,
	/\balways\b/i,
	/\bmust\b/i,
	/\bshould\b/i,
	/\bshall\b/i,
	/\bensure\b/i,
	/\bwrite\b/i,
	/\bcreate\b/i,
	/\bfollow\b/i,
	/\bdo not\b/i,
	/\bapply\b/i,
	/\bimplement\b/i,
	/\brun\b/i,
];
