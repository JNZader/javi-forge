import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

	// The synthetic bodies above prove the STATE table; this pair proves the
	// matcher is byte-exact (not fuzzy) against the SHIPPED asset: the released
	// bytes are legacy-v0, the same bytes plus ONE space are foreign.
	it("classifies the shipped asset body as legacy-v0 and one byte of drift as foreign", () => {
		const asset = readAsset("pre-commit");
		const shipped = readManifestEntry("pre-commit");

		expect(classifyHookContent(asset, "pre-commit", shipped)).toBe(
			HOOK_STATE.LEGACY_V0,
		);
		expect(classifyHookContent(`${asset} `, "pre-commit", shipped)).toBe(
			HOOK_STATE.FOREIGN,
		);
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
		expect(lines[1]).toBe("# javi-forge-hook: pre-commit v2");
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
			"# javi-forge-hook: pre-commit v2",
		);
	});

	it("repairs the mode of a managed-current hook without writing a single byte", async () => {
		// A hook stripped of its exec bit is DEAD — git skips it silently. The
		// repair is a chmod, never a rewrite: bytes and mtime must both survive.
		await installCIHooks(tmpDir);
		const before = await fs.readFile(hookPathFor("pre-commit"));
		await fs.chmod(hookPathFor("pre-commit"), 0o644);
		const statBefore = await fs.stat(hookPathFor("pre-commit"));

		await new Promise((resolve) => setTimeout(resolve, 20));
		const result = await installCIHooks(tmpDir);

		const statAfter = await fs.stat(hookPathFor("pre-commit"));
		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.MANAGED_CURRENT);
		expect(result.installed).toEqual([]);
		expect(result.upgraded).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(statAfter.mode & 0o777).toBe(0o755);
		expect(await fs.readFile(hookPathFor("pre-commit"))).toEqual(before);
		expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
	});

	it("gives a legacy-v0 upgrade the exec bit even when the historical file was 0644", async () => {
		await fs.writeFile(hookPathFor("pre-commit"), readAsset("pre-commit"));
		await fs.chmod(hookPathFor("pre-commit"), 0o644);

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.LEGACY_V0);
		expect(result.upgraded).toContain("pre-commit");
		expect((await fs.stat(hookPathFor("pre-commit"))).mode & 0o777).toBe(0o755);
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
			"# javi-forge-hook: pre-commit v2",
		);
	});

	// ── Matrix row b — managed-outdated auto-upgrade (the rollout's load-bearing
	// path) ────────────────────────────────────────────────────────────────────
	// A prior-managed install (marker present) carrying the OLD pre-commit(v1)
	// body — whose hash now lives in historical[] — MUST classify
	// MANAGED_OUTDATED and silently auto-upgrade to the shim: no --force, listed
	// under `upgraded`, never `errors`, never FOREIGN. If this regressed, every
	// existing install would refuse the S1b upgrade and the fleet would freeze on
	// v1/v2 hooks.
	const OLD_PRE_COMMIT_V1_BODY =
		"#!/bin/bash\n" +
		"# Pre-commit: quick CI check via javi-forge\n" +
		"# To skip: git commit --no-verify\n" +
		"set -e\n" +
		'echo "PRE-COMMIT: Running quick check..."\n' +
		"if command -v javi-forge &>/dev/null; then\n" +
		"  javi-forge ci --quick --no-docker --no-security --no-ci-ghagga\n" +
		"else\n" +
		"  npx javi-forge ci --quick --no-docker --no-security --no-ci-ghagga\n" +
		"fi || {\n" +
		'  echo ""\n' +
		'  echo "Quick check FAILED — fix the issues above before committing."\n' +
		'  echo "To skip: git commit --no-verify"\n' +
		"  exit 1\n" +
		"}\n";

	it("silently auto-upgrades a prior-managed v1 body (hash in historical[]) to the shim — MANAGED_OUTDATED, not FOREIGN, no --force", async () => {
		// Sanity: the embedded body really is a released body (its hash is in the
		// shipped manifest's historical list), so this exercises the true upgrade
		// path, not a synthetic one.
		const preCommitEntry = readManifestEntry("pre-commit");
		expect(preCommitEntry.historical.map((h) => h.sha256)).toContain(
			sha256(OLD_PRE_COMMIT_V1_BODY),
		);

		await fs.writeFile(
			hookPathFor("pre-commit"),
			withMarker(
				OLD_PRE_COMMIT_V1_BODY,
				"pre-commit",
				1,
				sha256(OLD_PRE_COMMIT_V1_BODY),
			),
		);

		const result = await installCIHooks(tmpDir);

		expect(stateOf(result, "pre-commit")).toBe(HOOK_STATE.MANAGED_OUTDATED);
		expect(result.upgraded).toContain("pre-commit");
		expect(result.installed).not.toContain("pre-commit");
		expect(
			result.errors.find((e) => e.startsWith("pre-commit:")),
		).toBeUndefined();

		// The file is now the S1b shim: v2 marker + execs `hooks run pre-commit`,
		// no leftover `ci --quick` invocation from the old body.
		const upgraded = await fs.readFile(hookPathFor("pre-commit"), "utf8");
		expect(upgraded).toContain("# javi-forge-hook: pre-commit v2");
		expect(upgraded).toContain("javi-forge hooks run pre-commit");
		expect(upgraded).not.toContain("ci --quick");
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

	it("says --force will REFUSE when a symlink is parked at the backup path", async () => {
		// Promising "the current file is saved as <path>.bak" here would be a
		// lie: backupHook refuses a non-regular backup target even WITH --force.
		const sensitive = path.join(tmpDir, "authorized_keys");
		await fs.writeFile(sensitive, "SSH KEYS");
		await fs.writeFile(
			hookPathFor("pre-commit"),
			"#!/bin/bash\necho foreign\n",
		);
		await fs.symlink(sensitive, `${hookPathFor("pre-commit")}.bak`);

		const result = await installCIHooks(tmpDir);

		const error = result.errors.find((e) => e.startsWith("pre-commit:")) ?? "";
		expect(error).toContain(`${hookPathFor("pre-commit")}.bak`);
		expect(error).toContain("REFUSE");
		expect(error).not.toContain("saved as");
	});

	it("says --force will REFUSE when a directory occupies the backup path", async () => {
		await fs.writeFile(
			hookPathFor("pre-commit"),
			"#!/bin/bash\necho foreign\n",
		);
		await fs.ensureDir(`${hookPathFor("pre-commit")}.bak`);

		const result = await installCIHooks(tmpDir);

		const error = result.errors.find((e) => e.startsWith("pre-commit:")) ?? "";
		expect(error).toContain("REFUSE");
		expect(error).not.toContain("saved as");
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

	it("refuses a symlink planted AFTER classification (O_NOFOLLOW closes the race)", async () => {
		// The window SEC-1 hardens: the path classified as ABSENT is replaced by
		// a symlink before the write lands. Reading the hook asset is the last
		// step before that write, so it is where the attacker is simulated.
		const target = path.join(tmpDir, "victim");
		await fs.writeFile(target, "ORIGINAL");
		const realReadFile = fs.readFile.bind(fs) as typeof fs.readFile;
		const spy = vi.spyOn(fs, "readFile").mockImplementation((async (
			file: string,
			encoding: unknown,
		) => {
			if (file === path.join(HOOK_ASSETS_DIR, "pre-commit")) {
				await fs.symlink(target, hookPathFor("pre-commit"));
			}
			return await realReadFile(file, encoding as never);
		}) as never);

		try {
			const result = await installCIHooks(tmpDir);

			const error = result.errors.find((e) => e.startsWith("pre-commit:"));
			expect(error).toContain("ELOOP");
			expect(result.installed).not.toContain("pre-commit");
			expect(await fs.readFile(target, "utf8")).toBe("ORIGINAL");
		} finally {
			spy.mockRestore();
		}
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

// =============================================================================
// installCIHooks --force — the backup protocol (D4)
// =============================================================================

describe("installCIHooks --force and the backup protocol", () => {
	let tmpDir: string;
	let hooksDir: string;
	let preCommit: string;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-hookbak-"));
		hooksDir = path.join(tmpDir, ".git", "hooks");
		await fs.ensureDir(hooksDir);
		preCommit = path.join(hooksDir, "pre-commit");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.remove(tmpDir);
	});

	it("backs a foreign hook up before overwriting it, preserving bytes and mode", async () => {
		// Deliberately NOT valid UTF-8: the backup must copy the original BYTES,
		// never a utf8 decode/encode round-trip.
		const original = Buffer.from([
			0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x62, 0x61, 0x73, 0x68, 0x0a,
			0xff, 0xfe, 0x0a,
		]);
		await fs.writeFile(preCommit, original);
		await fs.chmod(preCommit, 0o700);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(result.backups).toContain(`${preCommit}.bak`);
		expect(result.installed).toContain("pre-commit");
		expect(result.errors).toEqual([]);
		expect(await fs.readFile(`${preCommit}.bak`)).toEqual(original);
		expect((await fs.stat(`${preCommit}.bak`)).mode & 0o777).toBe(0o700);
		expect(await fs.readFile(preCommit, "utf8")).toContain(
			"# javi-forge-hook: pre-commit v2",
		);
	});

	it("backs a managed-edited hook up before overwriting it", async () => {
		await installCIHooks(tmpDir);
		const edited = `${await fs.readFile(preCommit, "utf8")}echo mine\n`;
		await fs.writeFile(preCommit, edited);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(await fs.readFile(`${preCommit}.bak`, "utf8")).toBe(edited);
		expect(result.backups).toContain(`${preCommit}.bak`);
		expect(await fs.readFile(preCommit, "utf8")).not.toBe(edited);
	});

	it("never clobbers an earlier backup — falls through to a timestamped target", async () => {
		await fs.writeFile(preCommit, "#!/bin/bash\necho foreign\n");
		await fs.writeFile(`${preCommit}.bak`, "EARLIER BACKUP");

		const result = await installCIHooks(tmpDir, { force: true });

		expect(await fs.readFile(`${preCommit}.bak`, "utf8")).toBe(
			"EARLIER BACKUP",
		);
		const used = result.backups.find((backup) =>
			backup.startsWith(`${preCommit}.bak.`),
		);
		expect(used).toBeDefined();
		expect(await fs.readFile(used as string, "utf8")).toBe(
			"#!/bin/bash\necho foreign\n",
		);
	});

	it("refuses even WITH --force when the backup target is a symlink", async () => {
		const sensitive = path.join(tmpDir, "authorized_keys");
		await fs.writeFile(sensitive, "SSH KEYS");
		const foreign = "#!/bin/bash\necho foreign\n";
		await fs.writeFile(preCommit, foreign);
		await fs.symlink(sensitive, `${preCommit}.bak`);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(await fs.readFile(sensitive, "utf8")).toBe("SSH KEYS");
		expect(await fs.readFile(preCommit, "utf8")).toBe(foreign);
		expect(result.installed).not.toContain("pre-commit");
		expect(result.errors.find((e) => e.startsWith("pre-commit:"))).toContain(
			"backup",
		);
	});

	it("refuses even WITH --force when the backup target is a directory", async () => {
		const foreign = "#!/bin/bash\necho foreign\n";
		await fs.writeFile(preCommit, foreign);
		await fs.ensureDir(`${preCommit}.bak`);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(await fs.readFile(preCommit, "utf8")).toBe(foreign);
		expect(result.installed).not.toContain("pre-commit");
		expect((await fs.lstat(`${preCommit}.bak`)).isDirectory()).toBe(true);
	});

	it("leaves the hook BYTE-UNCHANGED when the backup write throws, and installs siblings", async () => {
		const foreign = "#!/bin/bash\necho foreign\n";
		await fs.writeFile(preCommit, foreign);
		vi.spyOn(fs, "copyFile").mockRejectedValue(
			Object.assign(new Error("no space left on device"), { code: "ENOSPC" }),
		);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(await fs.readFile(preCommit, "utf8")).toBe(foreign);
		expect(await fs.pathExists(`${preCommit}.bak`)).toBe(false);
		expect(result.installed).not.toContain("pre-commit");
		expect(result.backups).toEqual([]);
		expect(result.errors.find((e) => e.startsWith("pre-commit:"))).toContain(
			"ENOSPC",
		);
		// Sibling hooks are untouched by the failure.
		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-push", "commit-msg"]),
		);
	});

	it("keeps refusing a symlinked hook path with --force, target intact", async () => {
		const target = path.join(tmpDir, "target");
		await fs.writeFile(target, "ORIGINAL");
		await fs.symlink(target, preCommit);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(await fs.readFile(target, "utf8")).toBe("ORIGINAL");
		expect(result.installed).not.toContain("pre-commit");
		expect(result.backups).toEqual([]);
	});

	it("keeps refusing a non-regular hook path with --force", async () => {
		await fs.ensureDir(preCommit);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(result.installed).not.toContain("pre-commit");
		expect((await fs.lstat(preCommit)).isDirectory()).toBe(true);
	});

	it("creates the backup with COPYFILE_EXCL so it can never clobber an existing file", async () => {
		await fs.writeFile(preCommit, "#!/bin/bash\necho foreign\n");
		const copyFile = vi.spyOn(fs, "copyFile");

		const result = await installCIHooks(tmpDir, { force: true });

		expect(result.errors).toEqual([]);
		const call = copyFile.mock.calls.find(
			(args) => String(args[1]) === `${preCommit}.bak`,
		);
		expect(call).toBeDefined();
		expect(call?.[2]).toBe(constants.COPYFILE_EXCL);
	});

	it("restores the exec bit when forcing over a 0644 foreign hook", async () => {
		await fs.writeFile(preCommit, "#!/bin/bash\necho foreign\n");
		await fs.chmod(preCommit, 0o644);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(result.errors).toEqual([]);
		expect(result.installed).toContain("pre-commit");
		expect(await fs.readFile(preCommit, "utf8")).toContain(
			"# javi-forge-hook: pre-commit v2",
		);
		expect((await fs.stat(preCommit)).mode & 0o777).toBe(0o755);
		// The BACKUP keeps the original mode — only the hook is normalized.
		expect((await fs.stat(`${preCommit}.bak`)).mode & 0o777).toBe(0o644);
	});

	it("is a NO-OP on a managed-current hook even WITH --force (zero writes, no backup)", async () => {
		// The managed-current guard precedes the force branch: --force is consent
		// to lose YOUR file, not an instruction to rewrite an identical one.
		await installCIHooks(tmpDir);
		const before = await fs.readFile(preCommit);
		const statBefore = await fs.stat(preCommit);

		await new Promise((resolve) => setTimeout(resolve, 20));
		const result = await installCIHooks(tmpDir, { force: true });

		const statAfter = await fs.stat(preCommit);
		expect(result.installed).toEqual([]);
		expect(result.upgraded).toEqual([]);
		expect(result.backups).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(await fs.readFile(preCommit)).toEqual(before);
		expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
		expect(await fs.pathExists(`${preCommit}.bak`)).toBe(false);
	});

	it("upgrades a managed-outdated hook with --force exactly as without one", async () => {
		const asset = readAsset("pre-commit");
		await fs.writeFile(
			preCommit,
			withMarker(asset, "pre-commit", 0, sha256(asset)),
		);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(result.upgraded).toContain("pre-commit");
		expect(result.installed).not.toContain("pre-commit");
		expect(result.backups).toEqual([]);
		expect(await fs.pathExists(`${preCommit}.bak`)).toBe(false);
		expect(await fs.readFile(preCommit, "utf8")).toContain(
			"# javi-forge-hook: pre-commit v2",
		);
	});

	it("does not back up hooks it would write anyway (absent, legacy-v0)", async () => {
		await fs.writeFile(
			path.join(hooksDir, "pre-push"),
			fs.readFileSync(path.join(HOOK_ASSETS_DIR, "pre-push"), "utf8"),
		);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(result.backups).toEqual([]);
		expect(result.upgraded).toContain("pre-push");
		expect(await fs.pathExists(path.join(hooksDir, "pre-push.bak"))).toBe(
			false,
		);
	});
});

// =============================================================================
// installCIHooks — a broken install surfaces as a named error, never a crash
// =============================================================================

describe("installCIHooks manifest failures", () => {
	let tmpDir: string;
	const manifestPath = path.join(HOOK_ASSETS_DIR, "manifest.json");

	const realManifest = (): Record<string, HookManifestEntry> =>
		JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<
			string,
			HookManifestEntry
		>;

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-hookman-"));
		await fs.ensureDir(path.join(tmpDir, ".git", "hooks"));
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await fs.remove(tmpDir);
	});

	it("reports a named error instead of rejecting when the manifest is unreadable", async () => {
		vi.spyOn(fs, "readJson").mockRejectedValue(
			Object.assign(new Error("no such file or directory"), {
				code: "ENOENT",
			}),
		);

		const result = await installCIHooks(tmpDir);

		expect(result.installed).toEqual([]);
		expect(result.states).toEqual([]);
		expect(result.errors).toHaveLength(1);
		const [error] = result.errors;
		expect(error).toContain(manifestPath);
		expect(error).toContain("ENOENT");
		expect(error).toContain("reinstall javi-forge");
	});

	it("reports a per-hook named error when the manifest is missing a hook entry", async () => {
		const { "commit-msg": _dropped, ...partial } = realManifest();
		vi.spyOn(fs, "readJson").mockResolvedValue(partial);

		const result = await installCIHooks(tmpDir);

		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-commit", "pre-push"]),
		);
		const error = result.errors.find((e) => e.startsWith("commit-msg:"));
		expect(error).toContain(manifestPath);
		expect(error).toContain("commit-msg");
		expect(error).toContain("reinstall javi-forge");
	});

	it("reports a per-hook named error when a manifest entry is malformed", async () => {
		const manifest = realManifest();
		vi.spyOn(fs, "readJson").mockResolvedValue({
			...manifest,
			"pre-push": { ...manifest["pre-push"], historical: "not-an-array" },
		});

		const result = await installCIHooks(tmpDir);

		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-commit", "commit-msg"]),
		);
		const error = result.errors.find((e) => e.startsWith("pre-push:"));
		expect(error).toContain(manifestPath);
		expect(error).toContain("reinstall javi-forge");
		expect(
			await fs.pathExists(path.join(tmpDir, ".git", "hooks", "pre-push")),
		).toBe(false);
	});

	it("reports a per-hook named error when a historical element is null", async () => {
		const manifest = realManifest();
		vi.spyOn(fs, "readJson").mockResolvedValue({
			...manifest,
			"pre-push": { ...manifest["pre-push"], historical: [null] },
		});

		const result = await installCIHooks(tmpDir);

		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-commit", "commit-msg"]),
		);
		const error = result.errors.find((e) => e.startsWith("pre-push:"));
		expect(error).toContain(manifestPath);
		expect(error).toContain("reinstall javi-forge");
		expect(
			await fs.pathExists(path.join(tmpDir, ".git", "hooks", "pre-push")),
		).toBe(false);
	});

	it("reports a per-hook named error when a historical element is a raw string", async () => {
		const manifest = realManifest();
		vi.spyOn(fs, "readJson").mockResolvedValue({
			...manifest,
			"pre-push": { ...manifest["pre-push"], historical: ["raw-string"] },
		});

		const result = await installCIHooks(tmpDir);

		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-commit", "commit-msg"]),
		);
		const error = result.errors.find((e) => e.startsWith("pre-push:"));
		expect(error).toContain(manifestPath);
		expect(error).toContain("reinstall javi-forge");
		expect(
			await fs.pathExists(path.join(tmpDir, ".git", "hooks", "pre-push")),
		).toBe(false);
	});
});

// =============================================================================
// installCIHooks — the ATOMIC core.hooksPath guard (D6 detect-before-mutate)
//
// These run against REAL git repos (git init) so `git config` scope semantics
// (--local / --global / --system) are exercised for real. GIT_CONFIG_GLOBAL /
// GIT_CONFIG_SYSTEM are redirected to per-test temp files, so the guard is
// hermetic against the developer's own global git config and a global/system
// shadow can be simulated without touching the real machine config.
//
// The load-bearing invariant is ATOMICITY: every REFUSE path (steps 2, 3, 4)
// leaves the repo in its EXACT prior state — the local core.hooksPath value is
// NEVER mutated on a refuse, and nothing is installed. Only the fully-validated
// success/force path (step 5) unsets the legacy value and writes the shims.
// =============================================================================

describe("installCIHooks core.hooksPath guard (D6 detect-before-mutate)", () => {
	let tmpDir: string;
	let hooksDir: string;
	let globalCfg: string;
	let systemCfg: string;
	let prevGlobal: string | undefined;
	let prevSystem: string | undefined;

	const hookPathFor = (hook: string): string => path.join(hooksDir, hook);

	const gitEnv = (): NodeJS.ProcessEnv => ({
		...process.env,
		GIT_CONFIG_GLOBAL: globalCfg,
		GIT_CONFIG_SYSTEM: systemCfg,
	});

	/** Read a scoped core.hooksPath value the same way the guard does. "" = unset. */
	const readScope = (scope: "--local" | "--global" | "--system"): string => {
		try {
			return execFileSync("git", ["config", scope, "--get", "core.hooksPath"], {
				cwd: tmpDir,
				env: gitEnv(),
				encoding: "utf8",
			}).trim();
		} catch {
			return "";
		}
	};

	const setLocalHooksPath = (value: string): void => {
		execFileSync("git", ["config", "--local", "core.hooksPath", value], {
			cwd: tmpDir,
			env: gitEnv(),
		});
	};

	beforeEach(async () => {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "javi-forge-hookguard-"));
		execFileSync("git", ["init", "-q"], { cwd: tmpDir });
		hooksDir = path.join(tmpDir, ".git", "hooks");
		await fs.ensureDir(hooksDir);
		// Redirect global/system git config to empty temp files so the guard is
		// hermetic: no dev/CI global core.hooksPath can leak in.
		globalCfg = path.join(tmpDir, "gitconfig-global");
		systemCfg = path.join(tmpDir, "gitconfig-system");
		await fs.writeFile(globalCfg, "");
		await fs.writeFile(systemCfg, "");
		prevGlobal = process.env.GIT_CONFIG_GLOBAL;
		prevSystem = process.env.GIT_CONFIG_SYSTEM;
		process.env.GIT_CONFIG_GLOBAL = globalCfg;
		process.env.GIT_CONFIG_SYSTEM = systemCfg;
	});

	afterEach(async () => {
		if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
		else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
		if (prevSystem === undefined) delete process.env.GIT_CONFIG_SYSTEM;
		else process.env.GIT_CONFIG_SYSTEM = prevSystem;
		vi.restoreAllMocks();
		await fs.remove(tmpDir);
	});

	// ── Fresh install: no hooksPath anywhere (spec "Unset value is a normal
	//   install") ────────────────────────────────────────────────────────────
	it("installs normally when core.hooksPath is unset, with no migration note", async () => {
		const result = await installCIHooks(tmpDir);

		expect(result.errors).toEqual([]);
		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-commit", "pre-push", "commit-msg"]),
		);
		expect(result.notes).toEqual([]);
		expect(readScope("--local")).toBe("");
	});

	// ── Matrix row c — legacy migration: local hooksPath=ci-local/hooks, slots
	//   absent → unset local + note + fresh install ────────────────────────────
	it("row c: migrates the legacy ci-local/hooks value — unsets local, emits a note, installs the shims", async () => {
		setLocalHooksPath("ci-local/hooks");
		expect(readScope("--local")).toBe("ci-local/hooks");

		const result = await installCIHooks(tmpDir);

		expect(result.errors).toEqual([]);
		expect(result.installed).toEqual(
			expect.arrayContaining(["pre-commit", "pre-push", "commit-msg"]),
		);
		// The legacy local value is now GONE (only --local scope touched).
		expect(readScope("--local")).toBe("");
		// A single informational note announces the removal.
		expect(result.notes.some((n) => /hooksPath removed/i.test(n))).toBe(true);
		expect(await fs.readFile(hookPathFor("pre-commit"), "utf8")).toContain(
			"# javi-forge-hook: pre-commit v2",
		);
	});

	// ── Matrix row d — foreign LOCAL manager (husky/lefthook/custom) → refuse,
	//   zero mutation, --force irrelevant ──────────────────────────────────────
	it("row d: refuses a foreign LOCAL hooksPath, mutates nothing, installs nothing", async () => {
		setLocalHooksPath(".husky/_");

		const result = await installCIHooks(tmpDir);

		expect(result.installed).toEqual([]);
		expect(result.upgraded).toEqual([]);
		// Config UNCHANGED — never hijack another manager.
		expect(readScope("--local")).toBe(".husky/_");
		expect(await fs.pathExists(hookPathFor("pre-commit"))).toBe(false);
		expect(result.errors.join("\n")).toMatch(/another hook manager|\.husky/);
	});

	it("row d: --force does NOT override a foreign LOCAL hooksPath", async () => {
		setLocalHooksPath(".husky/_");

		const result = await installCIHooks(tmpDir, { force: true });

		expect(result.installed).toEqual([]);
		expect(readScope("--local")).toBe(".husky/_");
		expect(result.errors.length).toBeGreaterThan(0);
	});

	// ── Matrix row f — DORMANT foreign slot under a legacy hooksPath →
	//   `guard_refuses_before_unset_when_dormant_foreign_slot`. Unsetting the
	//   legacy value would ACTIVATE the dormant hook, so the guard REFUSES BEFORE
	//   it mutates and leaves core.hooksPath STILL set to ci-local/hooks. ────────
	it("guard_refuses_before_unset_when_dormant_foreign_slot: hooksPath UNCHANGED after refusal", async () => {
		setLocalHooksPath("ci-local/hooks");
		// A dormant foreign hook git is ignoring while hooksPath redirects it — e.g.
		// a stale `tdd init` body written directly into .git/hooks.
		const dormant = "#!/bin/bash\n# old tdd hook\nnpm test\n";
		await fs.writeFile(hookPathFor("pre-commit"), dormant);

		const result = await installCIHooks(tmpDir);

		// ATOMIC REFUSE — zero mutation.
		expect(readScope("--local")).toBe("ci-local/hooks");
		expect(result.installed).toEqual([]);
		expect(result.upgraded).toEqual([]);
		// The dormant hook was never touched, never activated into a half state.
		expect(await fs.readFile(hookPathFor("pre-commit"), "utf8")).toBe(dormant);
		// No sibling was installed either — the WHOLE operation refused.
		expect(await fs.pathExists(hookPathFor("pre-push"))).toBe(false);
		expect(result.errors.join("\n")).toMatch(/foreign|--force/);
	});

	it("row f: --force unsets, backs up the dormant foreign slot, and installs the shims", async () => {
		setLocalHooksPath("ci-local/hooks");
		const dormant = "#!/bin/bash\n# old tdd hook\nnpm test\n";
		await fs.writeFile(hookPathFor("pre-commit"), dormant);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(result.errors).toEqual([]);
		// Now migrated: local value gone, dormant hook backed up, shims installed.
		expect(readScope("--local")).toBe("");
		expect(result.backups).toContain(`${hookPathFor("pre-commit")}.bak`);
		expect(await fs.readFile(`${hookPathFor("pre-commit")}.bak`, "utf8")).toBe(
			dormant,
		);
		expect(result.notes.some((n) => /hooksPath removed/i.test(n))).toBe(true);
		expect(await fs.readFile(hookPathFor("pre-commit"), "utf8")).toContain(
			"# javi-forge-hook: pre-commit v2",
		);
	});

	// ── Matrix row g — a global/system shadow detected BEFORE any mutation →
	//   `guard_refuses_global_shadow_leaves_local_hookspath_unchanged`. Detected
	//   via scoped reads, so the local value is never unset. ────────────────────
	it("guard_refuses_global_shadow_leaves_local_hookspath_unchanged: local value still exactly ci-local/hooks", async () => {
		setLocalHooksPath("ci-local/hooks");
		// A global core.hooksPath that WOULD shadow .git/hooks the instant local is
		// unset — detectable via `git config --global --get` with zero mutation.
		await fs.writeFile(
			globalCfg,
			"[core]\n\thooksPath = /home/user/.global-hooks\n",
		);
		expect(readScope("--global")).toBe("/home/user/.global-hooks");

		const result = await installCIHooks(tmpDir);

		// ATOMIC REFUSE — the LOCAL value is UNCHANGED (never unset).
		expect(readScope("--local")).toBe("ci-local/hooks");
		expect(result.installed).toEqual([]);
		expect(result.upgraded).toEqual([]);
		// Never report a successful install.
		expect(await fs.pathExists(hookPathFor("pre-commit"))).toBe(false);
		// The refusal names the shadowing global value.
		expect(result.errors.join("\n")).toContain("/home/user/.global-hooks");
	});

	it("row g: a SYSTEM-scope shadow also refuses with zero mutation", async () => {
		setLocalHooksPath("ci-local/hooks");
		await fs.writeFile(systemCfg, "[core]\n\thooksPath = /etc/git-hooks\n");
		expect(readScope("--system")).toBe("/etc/git-hooks");

		const result = await installCIHooks(tmpDir);

		expect(readScope("--local")).toBe("ci-local/hooks");
		expect(result.installed).toEqual([]);
		expect(result.errors.join("\n")).toContain("/etc/git-hooks");
	});

	it("row g: a global shadow refuses even on a FRESH repo (no local value) — install would be inert", async () => {
		// Even with nothing to unset, installing into .git/hooks while a global
		// hooksPath shadows it is a FAIL-OPEN (hooks would never run). Refuse.
		await fs.writeFile(
			globalCfg,
			"[core]\n\thooksPath = /home/user/.global-hooks\n",
		);

		const result = await installCIHooks(tmpDir);

		expect(result.installed).toEqual([]);
		expect(await fs.pathExists(hookPathFor("pre-commit"))).toBe(false);
		expect(result.errors.join("\n")).toContain("/home/user/.global-hooks");
	});

	it("row g: --force does NOT override a global/system shadow", async () => {
		setLocalHooksPath("ci-local/hooks");
		await fs.writeFile(
			globalCfg,
			"[core]\n\thooksPath = /home/user/.global-hooks\n",
		);

		const result = await installCIHooks(tmpDir, { force: true });

		expect(readScope("--local")).toBe("ci-local/hooks");
		expect(result.installed).toEqual([]);
		expect(result.errors.join("\n")).toContain("/home/user/.global-hooks");
	});
});
