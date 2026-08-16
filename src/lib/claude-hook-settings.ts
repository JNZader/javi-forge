/**
 * Pure settings-entry ownership recognition for the SkillGuard Claude
 * PreToolUse guard (Slice 2). Every function takes already-parsed JS values and
 * returns values — ZERO filesystem access (all bytes-on-disk access lives in
 * `claude-hook-manager.ts`). It covers protocol-shape validation, deterministic
 * canonical identity (Decision ②: the live asset SHA token is normalized out
 * before hashing), exact v0 legacy recognition by deep structural equality, and
 * removal/merge PLANNING only. Identity is always recomputed from observed
 * structure; a marker only claims ownership, it never proves it.
 */

import { createHash } from "node:crypto";
import {
	ASSET_SHA_PLACEHOLDER,
	LEGACY_COHORT,
	LEGACY_FILE_SHA256,
	MANAGED_ASSET_ARG,
	MANAGED_MATCHER,
	MANAGED_STATUS_PREFIX,
} from "./__fixtures__/claude-hook-ownership.js";

export {
	ASSET_SHA_PLACEHOLDER,
	LEGACY_FILE_SHA256,
	MANAGED_ASSET_ARG,
	MANAGED_MATCHER,
	MANAGED_STATUS_PREFIX,
};

/** The nine independent component states (identical for asset and settings). */
export type ClaudeHookComponentState =
	| "absent"
	| "managed-current"
	| "released-outdated"
	| "exact-legacy"
	| "edited-managed"
	| "foreign"
	| "symlink"
	| "non-regular"
	| "malformed";

/** A released settings-entry identity: version plus placeholder-normalized hash. */
export interface CanonicalSettingsEntry {
	version: number;
	canonicalSha256: string;
}

/** The manifest's settings-entry identity binding. */
export interface SettingsIdentityManifest {
	current: CanonicalSettingsEntry | null;
	historical: CanonicalSettingsEntry[];
}

/** Result of classifying a settings container against the manifest identity. */
export interface SettingsClassification {
	state: ClaudeHookComponentState;
	version?: number;
	canonicalSha256?: string;
	detail?: string;
	/** Index of the marked group inside `hooks.PreToolUse`. */
	groupIndex?: number;
	/** Index of the marked handler inside the group's `hooks`. */
	handlerIndex?: number;
}

// Shape helpers

export function isPlainObject(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A valid settings container is an object; when `hooks` is present it MUST be
 * an object; when `hooks.PreToolUse` is present it MUST be an array. Anything
 * else is malformed.
 */
export function validateSettingsShape(parsed: unknown): boolean {
	if (!isPlainObject(parsed)) return false;
	const { hooks } = parsed;
	if (hooks !== undefined && !isPlainObject(hooks)) return false;
	const pre = isPlainObject(hooks) ? hooks.PreToolUse : undefined;
	if (pre !== undefined && !Array.isArray(pre)) return false;
	return true;
}

// Canonical identity (Decision ②)

const ASSET_SHA_TOKEN = /^[0-9a-f]{64}$/;
const VERSION_PATTERN = /^javi-forge-global-pretooluse:v(\d+):sha256:/;

/**
 * Replace the trailing 64-hex asset SHA token in a managed `statusMessage` with
 * the fixed placeholder so settings identity is invariant under asset rotation.
 * A non-managed or malformed token is returned unchanged so it hashes to a
 * distinct (non-current) value.
 */
export function normalizeStatusMessage(statusMessage: unknown): string {
	if (typeof statusMessage !== "string") return "";
	if (!statusMessage.startsWith(MANAGED_STATUS_PREFIX)) return statusMessage;
	const token = statusMessage.slice(MANAGED_STATUS_PREFIX.length);
	return ASSET_SHA_TOKEN.test(token)
		? `${MANAGED_STATUS_PREFIX}${ASSET_SHA_PLACEHOLDER}`
		: statusMessage;
}

/** Parse the marker version (`…:v1:…` → 1) for diagnostics only. */
export function parseVersionFromStatus(
	statusMessage: unknown,
): number | undefined {
	if (typeof statusMessage !== "string") return undefined;
	const match = VERSION_PATTERN.exec(statusMessage);
	return match ? Number(match[1]) : undefined;
}

/**
 * Canonicalize the marker-proven handler group into deterministic bytes and its
 * SHA-256. Fixed key order (`type,command,args,timeout,statusMessage` inside a
 * `matcher,hooks` group), the asset-SHA token normalized out, two-space indent
 * plus a trailing newline. Only the single handler participates.
 */
export function canonicalizeSettingsEntry(
	group: unknown,
	handler: unknown,
): { serialization: string; canonicalSha256: string } {
	const h = isPlainObject(handler) ? handler : {};
	const g = isPlainObject(group) ? group : {};
	const canonicalHandler = {
		type: h.type,
		command: h.command,
		args: h.args,
		timeout: h.timeout,
		statusMessage: normalizeStatusMessage(h.statusMessage),
	};
	const canonicalGroup = { matcher: g.matcher, hooks: [canonicalHandler] };
	const serialization = `${JSON.stringify(canonicalGroup, null, 2)}\n`;
	const canonicalSha256 = createHash("sha256")
		.update(serialization, "utf8")
		.digest("hex");
	return { serialization, canonicalSha256 };
}

// Legacy recognition (deep structural equality only)

/**
 * Order-sensitive for arrays, key-set-exact (order-insensitive) for objects,
 * strict for scalars. No substring, normalization, or tolerance.
 */
export function deepStructuralEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
			return false;
		}
		return a.every((item, index) => deepStructuralEqual(item, b[index]));
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		const keysA = Object.keys(a);
		const keysB = Object.keys(b);
		if (keysA.length !== keysB.length) return false;
		return keysA.every(
			(key) => Object.hasOwn(b, key) && deepStructuralEqual(a[key], b[key]),
		);
	}
	return false;
}

function countDeepMatches(target: unknown, list: unknown[]): number {
	let count = 0;
	for (const item of list) if (deepStructuralEqual(target, item)) count++;
	return count;
}

/**
 * In-object legacy recognition: exactly one deep-equal match for each of the
 * four cohort objects (L1–L3 Pre, L4 Post) is `exact-legacy`; a partial,
 * duplicate, or edited cohort is `foreign` (partial-legacy); unrecognized
 * PreToolUse handler content is `foreign` per spec R2; only a container with no
 * PreToolUse handler content is `absent` (installable). Whole-file SHA legacy is
 * decided by the manager, which holds the raw bytes. (Spec R2 overrides
 * design.md Algorithm C, which returns `absent` for the no-cohort fallthrough
 * and so cannot flag a resembling unmarked handler.)
 */
export function classifyLegacy(parsed: unknown): SettingsClassification {
	const hooks = isPlainObject(parsed) ? parsed.hooks : undefined;
	const pre =
		isPlainObject(hooks) && Array.isArray(hooks.PreToolUse)
			? hooks.PreToolUse
			: [];
	const post =
		isPlainObject(hooks) && Array.isArray(hooks.PostToolUse)
			? hooks.PostToolUse
			: [];
	const counts = [
		countDeepMatches(LEGACY_COHORT.L1, pre),
		countDeepMatches(LEGACY_COHORT.L2, pre),
		countDeepMatches(LEGACY_COHORT.L3, pre),
		countDeepMatches(LEGACY_COHORT.L4, post),
	];
	if (counts.every((count) => count === 1)) {
		return { state: "exact-legacy", detail: "cohort" };
	}
	if (counts.some((count) => count >= 1)) {
		return { state: "foreign", detail: "partial-legacy" };
	}
	const preHandlers = pre.reduce(
		(total, group) =>
			total +
			(isPlainObject(group) && Array.isArray(group.hooks)
				? group.hooks.length
				: 0),
		0,
	);
	if (preHandlers > 0) return { state: "foreign", detail: "no-marker" };
	return { state: "absent" };
}

// Marker-driven settings classification

interface FoundMarker {
	groupIndex: number;
	handlerIndex: number;
	group: unknown;
	handler: Record<string, unknown>;
}

function findManagedMarkers(groups: unknown[]): FoundMarker[] {
	const markers: FoundMarker[] = [];
	for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
		const group = groups[groupIndex];
		const handlers =
			isPlainObject(group) && Array.isArray(group.hooks) ? group.hooks : [];
		for (let handlerIndex = 0; handlerIndex < handlers.length; handlerIndex++) {
			const handler = handlers[handlerIndex];
			if (
				isPlainObject(handler) &&
				typeof handler.statusMessage === "string" &&
				handler.statusMessage.startsWith(MANAGED_STATUS_PREFIX)
			) {
				markers.push({ groupIndex, handlerIndex, group, handler });
			}
		}
	}
	return markers;
}

function isValidMatcherGroup(group: unknown): group is Record<string, unknown> {
	return (
		isPlainObject(group) &&
		typeof group.matcher === "string" &&
		Array.isArray(group.hooks)
	);
}

/**
 * Reduce a parsed settings container to one component state, from parsed
 * structure only. Shape validation first, then marker-driven identity (always
 * recomputed), then the legacy fallback when no marker is present.
 */
export function classifySettingsEntry(
	parsed: unknown,
	_currentAssetSha: string,
	identities: SettingsIdentityManifest,
): SettingsClassification {
	if (!validateSettingsShape(parsed)) return { state: "malformed" };

	const hooks = isPlainObject(parsed) ? parsed.hooks : undefined;
	const groups =
		isPlainObject(hooks) && Array.isArray(hooks.PreToolUse)
			? hooks.PreToolUse
			: [];

	const markers = findManagedMarkers(groups);
	if (markers.length > 1) {
		return { state: "edited-managed", detail: "multiple markers" };
	}
	if (markers.length === 0) return classifyLegacy(parsed);

	const marker = markers[0] as FoundMarker;
	if (!isValidMatcherGroup(marker.group)) {
		return { state: "edited-managed", detail: "marker in invalid container" };
	}

	const { canonicalSha256 } = canonicalizeSettingsEntry(
		marker.group,
		marker.handler,
	);
	const version = parseVersionFromStatus(marker.handler.statusMessage);
	const base = {
		version,
		canonicalSha256,
		groupIndex: marker.groupIndex,
		handlerIndex: marker.handlerIndex,
	};

	if (
		identities.current &&
		canonicalSha256 === identities.current.canonicalSha256
	) {
		return { state: "managed-current", ...base };
	}
	if (
		identities.historical.some(
			(entry) => entry.canonicalSha256 === canonicalSha256,
		)
	) {
		return { state: "released-outdated", ...base };
	}
	return { state: "edited-managed", ...base };
}

// Removal / merge planning (planning only — no I/O, no execution)

export interface ManagedRemovalPlan {
	refused: boolean;
	reason?: string;
	state: ClaudeHookComponentState;
	groupIndex?: number;
	handlerIndex?: number;
	/** True when removing the managed handler empties the group. */
	removeGroup?: boolean;
	/** Sibling handlers in the group that removal must preserve. */
	preservedSiblings?: number;
}

function groupHandlerCount(parsed: unknown, groupIndex: number): number {
	const hooks = isPlainObject(parsed) ? parsed.hooks : undefined;
	const groups =
		isPlainObject(hooks) && Array.isArray(hooks.PreToolUse)
			? hooks.PreToolUse
			: [];
	const group = groups[groupIndex];
	return isPlainObject(group) && Array.isArray(group.hooks)
		? group.hooks.length
		: 0;
}

/**
 * Plan removal of the marker-proven managed handler. Only a recognized managed
 * identity (`managed-current` or `released-outdated`) is eligible; foreign,
 * partial-legacy, edited-managed, and every non-regular state refuse.
 */
export function planManagedClaudeHookRemoval(
	parsed: unknown,
	currentAssetSha: string,
	identities: SettingsIdentityManifest,
): ManagedRemovalPlan {
	const cls = classifySettingsEntry(parsed, currentAssetSha, identities);
	if (cls.state === "managed-current" || cls.state === "released-outdated") {
		const handlerCount = groupHandlerCount(parsed, cls.groupIndex ?? -1);
		const preservedSiblings = Math.max(handlerCount - 1, 0);
		return {
			refused: false,
			state: cls.state,
			groupIndex: cls.groupIndex,
			handlerIndex: cls.handlerIndex,
			removeGroup: preservedSiblings === 0,
			preservedSiblings,
		};
	}
	return {
		refused: true,
		reason: `refuse removal for state ${cls.state}`,
		state: cls.state,
	};
}

export interface ManagedMergePlan {
	refused: boolean;
	reason?: string;
	state: ClaudeHookComponentState;
	action: "install" | "replace" | "noop" | "refuse";
	groupIndex?: number;
	handlerIndex?: number;
	preservedSiblings?: number;
}

/**
 * Plan the managed merge. `absent` installs a new group, `managed-current` is a
 * no-op, `released-outdated` replaces the marked handler in place (siblings
 * preserved), and every other state refuses (edited/force is a Slice-3 concern).
 */
export function planManagedClaudeHookMerge(
	parsed: unknown,
	currentAssetSha: string,
	identities: SettingsIdentityManifest,
): ManagedMergePlan {
	const cls = classifySettingsEntry(parsed, currentAssetSha, identities);
	if (cls.state === "absent") {
		return { refused: false, state: cls.state, action: "install" };
	}
	if (cls.state === "managed-current") {
		return {
			refused: false,
			state: cls.state,
			action: "noop",
			groupIndex: cls.groupIndex,
			handlerIndex: cls.handlerIndex,
		};
	}
	if (cls.state === "released-outdated") {
		const preservedSiblings = Math.max(
			groupHandlerCount(parsed, cls.groupIndex ?? -1) - 1,
			0,
		);
		return {
			refused: false,
			state: cls.state,
			action: "replace",
			groupIndex: cls.groupIndex,
			handlerIndex: cls.handlerIndex,
			preservedSiblings,
		};
	}
	return {
		refused: true,
		reason: `refuse merge for state ${cls.state}`,
		state: cls.state,
		action: "refuse",
	};
}

// Slice-3a write-plan helpers (Decision 8) — pure, reuse the module primitives.

/** The managed timeout, matching the fixture handler shape. */
const MANAGED_TIMEOUT = 30;

/** The exact managed handler shape the writer installs. */
export interface ManagedHandler {
	type: "command";
	command: "node";
	args: [string];
	timeout: number;
	statusMessage: string;
}

/** The exact managed matcher group the writer installs. */
export interface ManagedMatcherGroup {
	matcher: string;
	hooks: [ManagedHandler];
}

/** Cohort-excision plan for embedded exact-legacy. */
export interface LegacyCohortExcisionPlan {
	refused: boolean;
	reason?: string;
	/** Indices to remove from hooks.PreToolUse (L1..L3 matches), ascending. */
	removePreIndices: number[];
	/** Indices to remove from hooks.PostToolUse (L4 match), ascending. */
	removePostIndices: number[];
	/** Append position for the freshly built managed PreToolUse group. */
	insertPreAt: number;
}

function preToolUseArray(parsed: unknown): unknown[] {
	const hooks = isPlainObject(parsed) ? parsed.hooks : undefined;
	return isPlainObject(hooks) && Array.isArray(hooks.PreToolUse)
		? hooks.PreToolUse
		: [];
}

function postToolUseArray(parsed: unknown): unknown[] {
	const hooks = isPlainObject(parsed) ? parsed.hooks : undefined;
	return isPlainObject(hooks) && Array.isArray(hooks.PostToolUse)
		? hooks.PostToolUse
		: [];
}

/**
 * Plan excision of the proven four-object legacy cohort from an embedded
 * container. Reuses `LEGACY_COHORT` + `deepStructuralEqual` (the same primitives
 * `classifyLegacy` uses) and never re-derives the classifier. Returns the exact
 * ascending object indices to remove per event plus the append position for the
 * freshly built managed group; every non-cohort sibling is preserved by index.
 * Only an exact-legacy cohort is eligible — a partial/edited cohort refuses
 * (the classifier already routes those to `foreign`).
 */
export function planLegacyCohortExcision(
	parsed: unknown,
): LegacyCohortExcisionPlan {
	const cls = classifyLegacy(parsed);
	if (cls.state !== "exact-legacy") {
		return {
			refused: true,
			reason: `refuse cohort excision for state ${cls.state}`,
			removePreIndices: [],
			removePostIndices: [],
			insertPreAt: 0,
		};
	}
	const pre = preToolUseArray(parsed);
	const post = postToolUseArray(parsed);
	const removePreIndices: number[] = [];
	for (const member of [LEGACY_COHORT.L1, LEGACY_COHORT.L2, LEGACY_COHORT.L3]) {
		const index = pre.findIndex((item) => deepStructuralEqual(member, item));
		if (index >= 0) removePreIndices.push(index);
	}
	const removePostIndices: number[] = [];
	const l4Index = post.findIndex((item) =>
		deepStructuralEqual(LEGACY_COHORT.L4, item),
	);
	if (l4Index >= 0) removePostIndices.push(l4Index);
	removePreIndices.sort((a, b) => a - b);
	removePostIndices.sort((a, b) => a - b);
	return {
		refused: false,
		removePreIndices,
		removePostIndices,
		// The managed group appends after every surviving Pre sibling.
		insertPreAt: pre.length - removePreIndices.length,
	};
}

/**
 * Force-replace plan for edited-managed. Eligibility keys on MATCHER EXACTNESS
 * (§324), not unconditionally on sibling count. Exposes matcherExact +
 * siblingHandlers so the manager can enforce the exact §324 rule.
 */
export interface ForceReplacePlan {
	refused: boolean;
	/** Set only when matcher edited AND siblingHandlers > 0. */
	reason?: string;
	state: ClaudeHookComponentState;
	groupIndex?: number;
	handlerIndex?: number;
	/** True => group matcher === MANAGED_MATCHER. */
	matcherExact?: boolean;
	/** Count of unrelated handlers in the group. */
	siblingHandlers?: number;
}

/**
 * Plan an in-place force replacement of the single marker-proven managed
 * handler for an `edited-managed` component. Eligibility (§324 / JD-A-001):
 * - matcherExact === true  → eligible regardless of siblingHandlers.
 * - matcherExact === false && siblingHandlers === 0 → eligible.
 * - matcherExact === false && siblingHandlers  >  0 → refused even under force.
 * A container without exactly one marker-proven handler in a valid matcher
 * group also refuses.
 */
export function planForceReplace(
	parsed: unknown,
	currentAssetSha: string,
): ForceReplacePlan {
	// Empty identities force the marker-proven state to resolve as edited-managed
	// while still exposing groupIndex/handlerIndex from the marker finder.
	const cls = classifySettingsEntry(parsed, currentAssetSha, {
		current: null,
		historical: [],
	});
	if (
		cls.state !== "edited-managed" ||
		cls.groupIndex === undefined ||
		cls.handlerIndex === undefined
	) {
		return {
			refused: true,
			reason: `refuse force replace for state ${cls.state}`,
			state: cls.state,
		};
	}
	const groups = preToolUseArray(parsed);
	const group = groups[cls.groupIndex];
	const matcherExact =
		isPlainObject(group) && group.matcher === MANAGED_MATCHER;
	const handlerCount =
		isPlainObject(group) && Array.isArray(group.hooks) ? group.hooks.length : 0;
	const siblingHandlers = Math.max(handlerCount - 1, 0);
	if (!matcherExact && siblingHandlers > 0) {
		return {
			refused: true,
			reason:
				"refuse force replace: edited matcher with unrelated sibling handlers (§324)",
			state: cls.state,
			groupIndex: cls.groupIndex,
			handlerIndex: cls.handlerIndex,
			matcherExact,
			siblingHandlers,
		};
	}
	return {
		refused: false,
		state: cls.state,
		groupIndex: cls.groupIndex,
		handlerIndex: cls.handlerIndex,
		matcherExact,
		siblingHandlers,
	};
}

/**
 * Synthesize a fresh managed-only container for the two terminal states with no
 * parsed value: fresh install (`absent`) and whole-file `exact-legacy`. Takes
 * only the current asset SHA — not the whole Manifest — so this module never
 * imports the manager's manifest reader at runtime (JD-A-002).
 */
export function buildManagedContainer(currentAssetSha: string): {
	hooks: { PreToolUse: [ManagedMatcherGroup] };
} {
	return {
		hooks: {
			PreToolUse: [
				{
					matcher: MANAGED_MATCHER,
					hooks: [
						{
							type: "command",
							command: "node",
							args: [MANAGED_ASSET_ARG],
							timeout: MANAGED_TIMEOUT,
							statusMessage: `${MANAGED_STATUS_PREFIX}${currentAssetSha}`,
						},
					],
				},
			],
		},
	};
}
