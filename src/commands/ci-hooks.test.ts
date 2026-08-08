import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HOOK_ASSETS_DIR } from "../constants.js";
import {
	classifyHookContent,
	HOOK_STATE,
	type HookManifestEntry,
	type HookState,
	installCIHooks,
} from "./ci.js";

/**
 * Classify-before-write matrix for `installCIHooks` (design D4/D6, spec
 * `ci-hook-install`). Lives in its own file so it runs against the REAL
 * filesystem with no Docker/exec module mocks in scope.
 */

const HOOK_NAMES = ["pre-commit", "pre-push", "commit-msg"] as const;
type HookName = (typeof HOOK_NAMES)[number];

const sha256 = (value: string): string =>
	createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");

const readAsset = (hook: HookName): string =>
	fs.readFileSync(path.join(HOOK_ASSETS_DIR, hook), "utf8");

const readManifestEntry = (hook: HookName): HookManifestEntry =>
	JSON.parse(
		fs.readFileSync(path.join(HOOK_ASSETS_DIR, "manifest.json"), "utf8"),
	)[hook] as HookManifestEntry;

/** Splice a marker block after the shebang, exactly as install time does. */
function withMarker(
	body: string,
	name: string,
	version: number,
	hex: string,
): string {
	const [shebang, ...rest] = body.split("\n");
	return [
		shebang,
		`# javi-forge-hook: ${name} v${version}`,
		`# javi-forge-hash: sha256:${hex}`,
		...rest,
	].join("\n");
}

// =============================================================================
// classifyHookContent — pure classification (D6 steps 1-5)
// =============================================================================

describe("classifyHookContent", () => {
	const CURRENT = "#!/bin/bash\necho current\n";
	const OUTGOING = "#!/bin/bash\necho outgoing\n";
	const entry: HookManifestEntry = {
		version: 2,
		sha256: sha256(CURRENT),
		historical: [
			{ sha256: sha256(OUTGOING), firstCommit: "abc1234" },
			{ sha256: sha256(CURRENT), firstCommit: "def5678" },
		],
	};

	const cases: Array<{ name: string; content: string; expected: HookState }> = [
		{
			name: "marker version and body hash both current → managed-current",
			content: withMarker(CURRENT, "pre-commit", 2, sha256(CURRENT)),
			expected: HOOK_STATE.MANAGED_CURRENT,
		},
		{
			name: "current body under a stale marker version → managed-outdated",
			content: withMarker(CURRENT, "pre-commit", 1, sha256(CURRENT)),
			expected: HOOK_STATE.MANAGED_OUTDATED,
		},
		{
			name: "body hash listed in historical[] → managed-outdated",
			content: withMarker(OUTGOING, "pre-commit", 1, sha256(OUTGOING)),
			expected: HOOK_STATE.MANAGED_OUTDATED,
		},
		{
			name: "marker present, body matches nothing → managed-edited",
			content: withMarker(
				"#!/bin/bash\necho current tampered\n",
				"pre-commit",
				2,
				sha256(CURRENT),
			),
			expected: HOOK_STATE.MANAGED_EDITED,
		},
		{
			name: "marker names a different hook → foreign",
			content: withMarker(CURRENT, "pre-push", 2, sha256(CURRENT)),
			expected: HOOK_STATE.FOREIGN,
		},
		{
			name: "unmarked bytes equal to the CURRENT body → legacy-v0, not managed-current",
			content: CURRENT,
			expected: HOOK_STATE.LEGACY_V0,
		},
		{
			name: "unmarked bytes equal to an outgoing released body → legacy-v0",
			content: OUTGOING,
			expected: HOOK_STATE.LEGACY_V0,
		},
		{
			name: "unmarked bytes matching nothing → foreign",
			content: "#!/bin/bash\necho hand written\n",
			expected: HOOK_STATE.FOREIGN,
		},
		{
			name: "CRLF-converted managed hook → foreign (marker regex fails on \\r)",
			content: withMarker(CURRENT, "pre-commit", 2, sha256(CURRENT)).replace(
				/\n/g,
				"\r\n",
			),
			expected: HOOK_STATE.FOREIGN,
		},
		{
			name: "marker block without a shebang on line 0 → foreign",
			content: withMarker(CURRENT, "pre-commit", 2, sha256(CURRENT)).slice(
				"#!/bin/bash\n".length,
			),
			expected: HOOK_STATE.FOREIGN,
		},
		{
			name: "claimed hash lies but body is current → managed-current (hex never trusted)",
			content: withMarker(CURRENT, "pre-commit", 2, "0".repeat(64)),
			expected: HOOK_STATE.MANAGED_CURRENT,
		},
		{
			name: "claimed hash matches while the body was edited → managed-edited",
			content: withMarker(
				"#!/bin/bash\necho drifted\n",
				"pre-commit",
				2,
				sha256("#!/bin/bash\necho drifted\n"),
			),
			expected: HOOK_STATE.MANAGED_EDITED,
		},
	];

	it.each(cases)("$name", ({ content, expected }) => {
		expect(classifyHookContent(content, "pre-commit", entry)).toBe(expected);
	});
});

// =============================================================================
// installCIHooks — classification, write policy, refusals (no --force)
// =============================================================================

describe("installCIHooks classification and write policy", () => {
	let tmpDir: string;
	let hooksDir: string;

	const hookPathFor = (hook: string): string => path.join(hooksDir, hook);

	const stateOf = (
		result: Awaited<ReturnType<typeof installCIHooks>>,
		hook: string,
	): HookState | undefined =>
		result.states.find((entry) => entry.name === hook)?.state;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-hookcls-"));
		hooksDir = path.join(tmpDir, ".git", "hooks");
		await fs.ensureDir(hooksDir);
	});

	afterEach(async () => {
		await fs.remove(tmpDir);
	});

	it("writes an absent hook and reports it as installed, not upgraded", async () => {
		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.ABSENT);
		expect(result.installed).toContain("pre-commit");
		expect(result.upgraded).toEqual([]);
		expect(result.errors).toEqual([]);
	});

	it("injects the marker block after the shebang, hashing the body below it", async () => {
		await installCIHooks(tmpDir);

		const lines = (await fs.readFile(hookPathFor("pre-commit"), "utf8")).split(
			"\n",
		);

		expect(lines[0]).toBe("#!/bin/bash");
		expect(lines[1]).toBe("# javi-forge-hook: pre-commit v1");
		expect(lines[2]).toBe(
			`# javi-forge-hash: sha256:${sha256(readAsset("pre-commit"))}`,
		);
		expect(lines[2]).toBe(
			`# javi-forge-hash: sha256:${readManifestEntry("pre-commit").sha256}`,
		);
	});

	it("re-running on a managed-current hook writes ZERO bytes (bytes and mtime unchanged)", async () => {
		await installCIHooks(tmpDir);
		const before = await fs.readFile(hookPathFor("pre-commit"));
		const statBefore = await fs.stat(hookPathFor("pre-commit"));

		await new Promise((resolve) => setTimeout(resolve, 20));
		const result = await installCIHooks(tmpDir);

		const statAfter = await fs.stat(hookPathFor("pre-commit"));
		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.MANAGED_CURRENT);
		expect(result.installed).toEqual([]);
		expect(result.upgraded).toEqual([]);
		expect(await fs.readFile(hookPathFor("pre-commit"))).toEqual(before);
		expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
	});

	it("upgrades an UNMARKED file whose bytes equal the current asset body as legacy-v0", async () => {
		// The discriminator is the MARKER, never the bytes: identical content
		// without a marker is fleet content (legacy-v0), never managed-current.
		await fs.writeFile(hookPathFor("pre-commit"), readAsset("pre-commit"));

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.LEGACY_V0);
		expect(result.upgraded).toContain("pre-commit");
		expect(result.installed).not.toContain("pre-commit");
		expect(result.errors).toEqual([]);
		expect(await fs.readFile(hookPathFor("pre-commit"), "utf8")).toContain(
			"# javi-forge-hook: pre-commit v1",
		);
	});

	it("upgrades a managed hook carrying a stale marker version without touching the body", async () => {
		const asset = readAsset("pre-commit");
		await fs.writeFile(
			hookPathFor("pre-commit"),
			withMarker(asset, "pre-commit", 0, sha256(asset)),
		);

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.MANAGED_OUTDATED);
		expect(result.upgraded).toContain("pre-commit");
		expect(await fs.readFile(hookPathFor("pre-commit"), "utf8")).toContain(
			"# javi-forge-hook: pre-commit v1",
		);
	});

	it("refuses a managed-edited hook, leaving the bytes untouched", async () => {
		await installCIHooks(tmpDir);
		const edited = `${await fs.readFile(hookPathFor("pre-commit"), "utf8")}echo mine\n`;
		await fs.writeFile(hookPathFor("pre-commit"), edited);

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.MANAGED_EDITED);
		expect(await fs.readFile(hookPathFor("pre-commit"), "utf8")).toBe(edited);
		expect(result.installed).not.toContain("pre-commit");
		const error = result.errors.find((e) => e.startsWith("pre-commit:"));
		expect(error).toContain(hookPathFor("pre-commit"));
		expect(error).toContain("modified locally");
		expect(error).toContain("--force");
		expect(error).toContain(`${hookPathFor("pre-commit")}.bak`);
	});

	it("refuses a foreign hook and names the path, the reason and the remedy", async () => {
		const foreign = "#!/bin/bash\necho hand written\n";
		await fs.writeFile(hookPathFor("pre-commit"), foreign);

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.FOREIGN);
		expect(await fs.readFile(hookPathFor("pre-commit"), "utf8")).toBe(foreign);
		const error = result.errors.find((e) => e.startsWith("pre-commit:"));
		expect(error).toContain(hookPathFor("pre-commit"));
		expect(error).toContain("is not a javi-forge hook");
		expect(error).toContain("javi-forge ci init --force");
		expect(error).toContain(`${hookPathFor("pre-commit")}.bak`);
	});

	it("names the timestamped backup target in the refusal when .bak is taken", async () => {
		await fs.writeFile(
			hookPathFor("pre-commit"),
			"#!/bin/bash\necho foreign\n",
		);
		await fs.writeFile(`${hookPathFor("pre-commit")}.bak`, "earlier backup");

		const result = await installCIHooks(tmpDir);

		const error = result.errors.find((e) => e.startsWith("pre-commit:")) ?? "";
		expect(error).toContain(`${hookPathFor("pre-commit")}.bak.`);
		expect(error).not.toContain(`saved as ${hookPathFor("pre-commit")}.bak)`);
	});

	it("does not let one refusal block sibling hooks", async () => {
		await fs.writeFile(
			hookPathFor("pre-commit"),
			"#!/bin/bash\necho foreign\n",
		);

		const result = await installCIHooks(tmpDir);

		expect(result.errors).toHaveLength(1);
		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-push", "commit-msg"]),
		);
	});

	it("classifies a marker naming another hook as foreign and refuses it", async () => {
		const asset = readAsset("pre-push");
		await fs.writeFile(
			hookPathFor("pre-commit"),
			withMarker(asset, "pre-push", 1, sha256(asset)),
		);

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.FOREIGN);
		expect(result.installed).not.toContain("pre-commit");
	});

	it("classifies a CRLF-converted managed hook as foreign and refuses it", async () => {
		await installCIHooks(tmpDir);
		const crlf = (await fs.readFile(hookPathFor("pre-commit"), "utf8")).replace(
			/\n/g,
			"\r\n",
		);
		await fs.writeFile(hookPathFor("pre-commit"), crlf);

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.FOREIGN);
		expect(await fs.readFile(hookPathFor("pre-commit"), "utf8")).toBe(crlf);
	});

	it("refuses a symlinked hook path and leaves the target intact", async () => {
		const target = path.join(tmpDir, "target");
		await fs.writeFile(target, "ORIGINAL");
		await fs.symlink(target, hookPathFor("pre-commit"));

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.SYMLINK);
		expect(result.errors.some((e) => e.includes("symlink"))).toBe(true);
		expect(await fs.readFile(target, "utf8")).toBe("ORIGINAL");
	});

	it("refuses a non-regular hook path with a named reason", async () => {
		await fs.ensureDir(hookPathFor("pre-commit"));

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.NOT_A_FILE);
		const error = result.errors.find((e) => e.startsWith("pre-commit:"));
		expect(error).toContain("is not a regular file");
		expect((await fs.lstat(hookPathFor("pre-commit"))).isDirectory()).toBe(
			true,
		);
	});
});
