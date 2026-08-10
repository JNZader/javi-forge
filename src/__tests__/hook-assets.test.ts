import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOOK_ASSETS_DIR } from "../constants.js";

/**
 * Guards for the extracted git-hook assets (`assets/hooks/*`) and their
 * manifest. See design.md D5/D6 and tasks.md 3.6.
 *
 * Everything here resolves through the exported `HOOK_ASSETS_DIR` constant so a
 * mutant on that constant is killed by these tests (JD-015). No git commands are
 * used and no assertion is skipped when history is unavailable (JDA-R2-001):
 * `actions/checkout` with `fetch-depth: 1` would make a git-based guard skip
 * exactly where it matters.
 */

const HOOK_NAMES = ["pre-commit", "pre-push", "commit-msg"] as const;
type HookName = (typeof HOOK_NAMES)[number];

interface HistoricalEntry {
	sha256: string;
	firstCommit: string;
}

interface HookManifestEntry {
	version: number;
	sha256: string;
	historical: HistoricalEntry[];
}

type HookManifest = Record<HookName, HookManifestEntry>;

/**
 * Snapshot of the manifest as it was RELEASED. It is part of the binding
 * forward-maintenance rule (design.md D6): any PR that changes the bytes of a
 * hook asset must APPEND the outgoing body hash to `historical[]` and APPEND
 * the same hash to this snapshot list in the SAME PR. `historical[]` is
 * APPEND-ONLY: the guard asserts the manifest list still STARTS WITH the full
 * released list, so erasing, replacing or reordering a released hash — even
 * while "updating the snapshot" — requires an explicit deletion in this file
 * that a reviewer sees. A count can be bumped honestly while a hash is
 * silently rewritten; a list cannot (JDA6-001/JDB6-001). This is the R2
 * fleet-brick guard: every released hash must remain recognizable forever.
 */
const RELEASED_SNAPSHOT: Record<
	HookName,
	{ sha256: string; historical: string[] }
> = {
	"pre-commit": {
		sha256: "811f34ce57517e129554bc9c09801a66c0207332cd3e7f2950db43a40580e914",
		historical: [
			"811f34ce57517e129554bc9c09801a66c0207332cd3e7f2950db43a40580e914",
		],
	},
	"pre-push": {
		sha256: "7de58640aeef33085a49f31f1d9d0c8bacde0069d6d3265ae41aa8d3cd14d7a5",
		historical: [
			"7de58640aeef33085a49f31f1d9d0c8bacde0069d6d3265ae41aa8d3cd14d7a5",
		],
	},
	"commit-msg": {
		sha256: "127fb8bfebd81d6b06e6f04bdf1be0036a3a224268ac54f11784043f55796a18",
		historical: [
			"1c23a60cd4ba7f6bc666da400b5d2971c4294782c8d9ce41543e7815de11a1d6",
			"127fb8bfebd81d6b06e6f04bdf1be0036a3a224268ac54f11784043f55796a18",
		],
	},
};

/**
 * Expected shipped `version` per hook. Bumped in lockstep with a body change:
 * commit-msg is at v2 (hooks-ricos Slice A); the others remain v1 until their
 * own slice bumps them.
 */
const EXPECTED_VERSION: Record<HookName, number> = {
	"pre-commit": 1,
	"pre-push": 1,
	"commit-msg": 2,
};

const sha256 = (buf: Buffer): string =>
	createHash("sha256").update(buf).digest("hex");

const readAsset = (hook: HookName): Buffer =>
	fs.readFileSync(path.join(HOOK_ASSETS_DIR, hook));

const readManifest = (): HookManifest =>
	JSON.parse(
		fs.readFileSync(path.join(HOOK_ASSETS_DIR, "manifest.json"), "utf8"),
	) as HookManifest;

/**
 * Pure comparison behind the forward-maintenance guard. Two invariants:
 * (1) APPEND-ONLY — the manifest's `historical[]` must still START WITH the
 *     complete released hash list, in order (no erasure, no rewrite, no
 *     reorder of anything ever released);
 * (2) GROWTH — whenever the manifest hash moves away from the released one,
 *     the outgoing released hash must be present and the list must be
 *     strictly longer than the released list.
 * Returns the reasons the invariant is violated — empty means it holds.
 */
function historyMaintenanceViolations(
	released: { sha256: string; historical: string[] },
	current: { sha256: string; historical: HistoricalEntry[] },
): string[] {
	const violations: string[] = [];
	const hashes = current.historical.map((entry) => entry.sha256);

	const prefixIntact =
		hashes.length >= released.historical.length &&
		released.historical.every((hash, i) => hashes[i] === hash);
	if (!prefixIntact) {
		violations.push(
			"historical[] no longer starts with the released hash list (append-only violated)",
		);
	}

	if (current.sha256 === released.sha256) {
		return violations;
	}

	if (!hashes.includes(released.sha256)) {
		violations.push(
			`outgoing body hash ${released.sha256} was not appended to historical[]`,
		);
	}
	if (hashes.length <= released.historical.length) {
		violations.push(
			`historical[] did not grow: ${released.historical.length} -> ${hashes.length}`,
		);
	}
	return violations;
}

describe("hook assets", () => {
	it.each(HOOK_NAMES)("%s ends with exactly one trailing newline", (hook) => {
		const body = readAsset(hook).toString("utf8");

		expect(body.endsWith("\n")).toBe(true);
		expect(body.endsWith("\n\n")).toBe(false);
		expect(body.startsWith("#!/bin/bash\n")).toBe(true);
	});

	it.each(
		HOOK_NAMES,
	)("%s asset bytes match manifest.sha256 (asset drift)", (hook) => {
		const manifest = readManifest();

		expect(sha256(readAsset(hook))).toBe(manifest[hook].sha256);
	});

	it.each(
		HOOK_NAMES,
	)("%s manifest hash equals the latest historical entry at its expected version", (hook) => {
		const entry = readManifest()[hook];

		expect(entry.version).toBe(EXPECTED_VERSION[hook]);
		expect(entry.historical.length).toBeGreaterThan(0);
		expect(entry.sha256).toBe(entry.historical.at(-1)?.sha256);
	});

	it.each(HOOK_NAMES)("%s historical entries are well-formed", (hook) => {
		const entry = readManifest()[hook];
		const hashes = entry.historical.map((h) => h.sha256);

		for (const historical of entry.historical) {
			expect(historical.sha256).toMatch(/^[0-9a-f]{64}$/);
			expect(historical.firstCommit).toMatch(/^[0-9a-f]{7,40}$/);
		}
		expect(new Set(hashes).size).toBe(hashes.length);
	});
});

describe("historyMaintenanceViolations", () => {
	const released = { sha256: "a".repeat(64), historical: ["a".repeat(64)] };

	it("accepts an unchanged hash with an unchanged history", () => {
		expect(
			historyMaintenanceViolations(released, {
				sha256: "a".repeat(64),
				historical: [{ sha256: "a".repeat(64), firstCommit: "abc1234" }],
			}),
		).toEqual([]);
	});

	it("rejects a shrinking history even when the hash is unchanged", () => {
		expect(
			historyMaintenanceViolations(released, {
				sha256: "a".repeat(64),
				historical: [],
			}),
		).toEqual([
			"historical[] no longer starts with the released hash list (append-only violated)",
		]);
	});

	it("accepts a changed hash when the outgoing hash was appended", () => {
		expect(
			historyMaintenanceViolations(released, {
				sha256: "b".repeat(64),
				historical: [
					{ sha256: "a".repeat(64), firstCommit: "abc1234" },
					{ sha256: "c".repeat(64), firstCommit: "def5678" },
				],
			}),
		).toEqual([]);
	});

	it("rejects a changed hash whose outgoing hash was never appended", () => {
		expect(
			historyMaintenanceViolations(released, {
				sha256: "b".repeat(64),
				historical: [
					{ sha256: "c".repeat(64), firstCommit: "def5678" },
					{ sha256: "d".repeat(64), firstCommit: "0123456" },
				],
			}),
		).toEqual([
			"historical[] no longer starts with the released hash list (append-only violated)",
			`outgoing body hash ${"a".repeat(64)} was not appended to historical[]`,
		]);
	});

	it("rejects rewriting a released hash even when the snapshot's own sha256 is also updated (fleet-brick attack)", () => {
		expect(
			historyMaintenanceViolations(
				{ sha256: "b".repeat(64), historical: ["a".repeat(64)] },
				{
					sha256: "b".repeat(64),
					historical: [{ sha256: "b".repeat(64), firstCommit: "def5678" }],
				},
			),
		).toEqual([
			"historical[] no longer starts with the released hash list (append-only violated)",
		]);
	});

	it("rejects a changed hash with a history that did not grow", () => {
		expect(
			historyMaintenanceViolations(released, {
				sha256: "b".repeat(64),
				historical: [{ sha256: "a".repeat(64), firstCommit: "abc1234" }],
			}),
		).toEqual([`historical[] did not grow: 1 -> 1`]);
	});
});

describe("hook manifest forward maintenance", () => {
	it.each(
		HOOK_NAMES,
	)("%s keeps historical[] in sync with the released snapshot", (hook) => {
		const entry = readManifest()[hook];

		expect(
			historyMaintenanceViolations(RELEASED_SNAPSHOT[hook], entry),
		).toEqual([]);
	});
});
