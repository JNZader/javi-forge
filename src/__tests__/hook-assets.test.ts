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
 * hook asset must append the outgoing body hash to `historical[]` and update
 * this snapshot in the SAME PR. Updating only the manifest fails the guard
 * below, so a body change cannot silently brick `ci init` for the installed
 * fleet (R2).
 */
const RELEASED_SNAPSHOT: Record<
	HookName,
	{ sha256: string; historicalCount: number }
> = {
	"pre-commit": {
		sha256: "811f34ce57517e129554bc9c09801a66c0207332cd3e7f2950db43a40580e914",
		historicalCount: 1,
	},
	"pre-push": {
		sha256: "7de58640aeef33085a49f31f1d9d0c8bacde0069d6d3265ae41aa8d3cd14d7a5",
		historicalCount: 1,
	},
	"commit-msg": {
		sha256: "1c23a60cd4ba7f6bc666da400b5d2971c4294782c8d9ce41543e7815de11a1d6",
		historicalCount: 1,
	},
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
 * Pure comparison behind the forward-maintenance guard: `historical[]` must
 * STRICTLY GROW (and must retain the outgoing hash) whenever the manifest hash
 * moves away from the released snapshot, and must never shrink otherwise.
 * Returns the reasons the invariant is violated — empty means it holds.
 */
function historyMaintenanceViolations(
	released: { sha256: string; historicalCount: number },
	current: { sha256: string; historical: HistoricalEntry[] },
): string[] {
	const violations: string[] = [];
	const hashes = current.historical.map((entry) => entry.sha256);

	if (current.sha256 === released.sha256) {
		if (hashes.length < released.historicalCount) {
			violations.push(
				`historical[] shrank from ${released.historicalCount} to ${hashes.length} entries`,
			);
		}
		return violations;
	}

	if (!hashes.includes(released.sha256)) {
		violations.push(
			`outgoing body hash ${released.sha256} was not appended to historical[]`,
		);
	}
	if (hashes.length <= released.historicalCount) {
		violations.push(
			`historical[] did not grow: ${released.historicalCount} -> ${hashes.length}`,
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
	)("%s v1 manifest hash equals the v0 historical entry (byte-equivalence to the inline literal)", (hook) => {
		const entry = readManifest()[hook];

		expect(entry.version).toBe(1);
		expect(entry.historical.length).toBeGreaterThan(0);
		expect(entry.sha256).toBe(entry.historical[0].sha256);
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
	const released = { sha256: "a".repeat(64), historicalCount: 1 };

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
		).toEqual(["historical[] shrank from 1 to 0 entries"]);
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
			`outgoing body hash ${"a".repeat(64)} was not appended to historical[]`,
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
