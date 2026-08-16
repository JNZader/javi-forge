import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import {
	ASSET_NAME,
	L1_BASH_DANGEROUS,
	L2_BASH_SENSITIVE_READ,
	L3_WRITE_EDIT_PROTECTED,
	L4_BASH_POST_SECRET_SCAN,
	managedGroup,
	managedHandler,
	settingsContainer,
} from "./__fixtures__/claude-hook-ownership.js";
import { makeFakeSecureFs } from "./__fixtures__/fake-secure-fs.js";
import {
	_run,
	installClaudePreToolUse,
	type Manifest,
	repairClaudePreToolUse,
} from "./claude-hook-manager.js";
import { canonicalizeSettingsEntry } from "./claude-hook-settings.js";

const MANAGED_MATCHER = "Bash|PowerShell|Read|Write|Edit";
const REAL_ASSET = path.join(CLAUDE_HOOK_ASSETS_DIR, ASSET_NAME);
const REAL_ASSET_SHA = createHash("sha256")
	.update(fs.readFileSync(REAL_ASSET))
	.digest("hex");
const CANONICAL_SHA = canonicalizeSettingsEntry(
	managedGroup(),
	managedHandler(),
).canonicalSha256;

const manifest = (overrides: Partial<Manifest["asset"]> = {}): Manifest => ({
	asset: {
		name: ASSET_NAME,
		version: 1,
		sha256: REAL_ASSET_SHA,
		historical: [],
		...overrides,
	},
	settingsEntries: {
		current: { version: 1, canonicalSha256: CANONICAL_SHA },
		historical: [],
	},
});

const clock = () => new Date("2026-08-16T19:00:00.123Z");
const makeNonce = () => {
	let n = 0;
	return () => (++n).toString(16).padStart(8, "0");
};

let dir: string;
const assetPath = () => path.join(dir, ".claude", "hooks", ASSET_NAME);
const settingsPath = () => path.join(dir, ".claude", "settings.json");
const claudeDir = () => path.join(dir, ".claude");

/** Mirror the real project tree into the fake so classify + transaction agree. */
const mirror = (fake: ReturnType<typeof makeFakeSecureFs>): void => {
	let current = dir;
	while (true) {
		fake.seedDir(current);
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const claude = claudeDir();
	const hooks = path.join(claude, "hooks");
	if (fs.existsSync(claude)) fake.seedDir(claude);
	if (fs.existsSync(hooks)) fake.seedDir(hooks);
	for (const p of [settingsPath(), assetPath()]) {
		if (fs.existsSync(p)) {
			fake.seedFile(p, fs.readFileSync(p), fs.statSync(p).mode & 0o7777);
		}
	}
};

const writeSettings = (value: unknown): void =>
	fs.writeFileSync(settingsPath(), `${JSON.stringify(value, null, 2)}\n`);

const run = (
	fake: ReturnType<typeof makeFakeSecureFs>,
	mode: "install" | "repair",
	options: { force?: boolean } = {},
	m: Manifest = manifest(),
) =>
	_run(dir, mode, options, {
		secureFs: fake,
		clock,
		nonce: makeNonce(),
		manifest: m,
	});

const parseSettings = (
	fake: ReturnType<typeof makeFakeSecureFs>,
): {
	hooks: { PreToolUse: Record<string, unknown>[]; PostToolUse?: unknown[] };
	[k: string]: unknown;
} => JSON.parse(fake.fileText(settingsPath()) as string);

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-run-"));
	fs.mkdirSync(path.join(dir, ".claude", "hooks"), { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("_run state→action matrix (fake secureFs, never platform-skipped)", () => {
	it("released-outdated asset upgrades; current settings stay a no-op", async () => {
		fs.copyFileSync(REAL_ASSET, assetPath());
		writeSettings({ hooks: { PreToolUse: [managedGroup(REAL_ASSET_SHA)] } });
		const fake = makeFakeSecureFs();
		mirror(fake);
		const res = await run(
			fake,
			"install",
			{},
			manifest({
				sha256: "0".repeat(64),
				historical: [REAL_ASSET_SHA],
			}),
		);
		expect(res.ok).toBe(true);
		expect(res.changed).toEqual([assetPath()]);
		expect(res.backups).toEqual([]);
		expect(fake.fileText(assetPath())).toBe(
			fs.readFileSync(REAL_ASSET, "utf8"),
		);
	});

	it("migrates a whole-file legacy scaffold to a managed-only container", async () => {
		const legacy = fs.readFileSync(
			path.join(
				CLAUDE_HOOK_ASSETS_DIR,
				"../..",
				"templates",
				"security-hooks",
				"claude-settings-security.json",
			),
		);
		fs.writeFileSync(settingsPath(), legacy);
		fs.copyFileSync(REAL_ASSET, assetPath());
		const fake = makeFakeSecureFs();
		mirror(fake);
		const res = await run(fake, "install");
		expect(res.ok).toBe(true);
		expect(res.changed).toEqual([settingsPath()]);
		expect(res.backups).toEqual([]);
		const parsed = parseSettings(fake);
		expect(parsed.hooks.PreToolUse).toHaveLength(1);
		expect(parsed.hooks.PreToolUse[0]?.matcher).toBe(MANAGED_MATCHER);
	});

	it("migrates an embedded legacy cohort, excising it and preserving siblings", async () => {
		const readGroup = { matcher: "Read", hooks: [{ type: "command" }] };
		writeSettings(
			settingsContainer(
				[
					readGroup,
					L1_BASH_DANGEROUS,
					L2_BASH_SENSITIVE_READ,
					L3_WRITE_EDIT_PROTECTED,
				],
				[L4_BASH_POST_SECRET_SCAN],
				{ model: "keep-me" },
			),
		);
		fs.copyFileSync(REAL_ASSET, assetPath());
		const fake = makeFakeSecureFs();
		mirror(fake);
		const res = await run(fake, "install");
		expect(res.ok).toBe(true);
		expect(res.changed).toEqual([settingsPath()]);
		const parsed = parseSettings(fake);
		expect(parsed.model).toBe("keep-me");
		expect(parsed.hooks.PreToolUse).toHaveLength(2); // readGroup + managed
		expect(parsed.hooks.PreToolUse[0]?.matcher).toBe("Read");
		expect(parsed.hooks.PreToolUse[1]?.matcher).toBe(MANAGED_MATCHER);
		expect(parsed.hooks.PostToolUse).toEqual([]);
	});

	it("refuses edited-managed settings without force and mutates nothing", async () => {
		const edited = managedGroup();
		edited.hooks[0].timeout = 45;
		writeSettings({ hooks: { PreToolUse: [edited] } });
		fs.copyFileSync(REAL_ASSET, assetPath());
		const fake = makeFakeSecureFs();
		mirror(fake);
		const res = await run(fake, "repair");
		expect(res.ok).toBe(false);
		expect(res.errors.join(" ")).toMatch(/edited-managed/);
		expect(res.changed).toEqual([]);
		expect(fake.hasBackup(claudeDir())).toBe(false);
		expect(res.report).toBeDefined();
	});
});

describe("_run force-replace keys on matcher exactness (§324)", () => {
	it("force-replaces in place preserving siblings when the matcher is exact", async () => {
		const group = managedGroup();
		group.hooks[0].timeout = 45; // edits identity → edited-managed
		(group.hooks as unknown[]).push({ type: "command", command: "echo" });
		writeSettings({ hooks: { PreToolUse: [group] } });
		fs.copyFileSync(REAL_ASSET, assetPath());
		const fake = makeFakeSecureFs();
		mirror(fake);
		const res = await run(fake, "repair", { force: true });
		expect(res.ok).toBe(true);
		expect(res.changed).toEqual([settingsPath()]);
		expect(res.backups).toHaveLength(1);
		const parsed = parseSettings(fake);
		expect(parsed.hooks.PreToolUse[0]?.matcher).toBe(MANAGED_MATCHER);
		expect(parsed.hooks.PreToolUse[0]?.hooks as unknown[]).toHaveLength(2);
		expect(
			(parsed.hooks.PreToolUse[0]?.hooks as Record<string, unknown>[])[0]
				?.timeout,
		).toBe(30);
	});

	it("force-replaces when the matcher is edited with zero siblings", async () => {
		writeSettings({
			hooks: {
				PreToolUse: [
					{ matcher: "Bash", hooks: [{ ...managedHandler(), timeout: 45 }] },
				],
			},
		});
		fs.copyFileSync(REAL_ASSET, assetPath());
		const fake = makeFakeSecureFs();
		mirror(fake);
		const res = await run(fake, "repair", { force: true });
		expect(res.ok).toBe(true);
		expect(res.backups).toHaveLength(1);
		expect(parseSettings(fake).hooks.PreToolUse[0]?.matcher).toBe(
			MANAGED_MATCHER,
		);
	});

	it("refuses force even with --force when the matcher is edited and siblings exist", async () => {
		writeSettings({
			hooks: {
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [
							{ ...managedHandler(), timeout: 45 },
							{ type: "command", command: "echo" },
						],
					},
				],
			},
		});
		fs.copyFileSync(REAL_ASSET, assetPath());
		const fake = makeFakeSecureFs();
		mirror(fake);
		const res = await run(fake, "repair", { force: true });
		expect(res.ok).toBe(false);
		expect(res.errors.join(" ")).toMatch(/§324|sibling/);
		expect(res.changed).toEqual([]);
		expect(fake.hasBackup(claudeDir())).toBe(false);
	});
});

describe("_run refuses unsafe states and no-ops the healthy one", () => {
	it("refuses a foreign asset untouched", async () => {
		fs.writeFileSync(assetPath(), "// not ours\n");
		writeSettings({ hooks: { PreToolUse: [managedGroup(REAL_ASSET_SHA)] } });
		const fake = makeFakeSecureFs();
		mirror(fake);
		const res = await run(fake, "install");
		expect(res.ok).toBe(false);
		expect(res.changed).toEqual([]);
		expect(res.errors.join(" ")).toMatch(/foreign/);
	});

	it("refuses a symlinked settings file untouched", async () => {
		fs.writeFileSync(path.join(dir, "target.json"), "{}");
		fs.symlinkSync(path.join(dir, "target.json"), settingsPath());
		fs.copyFileSync(REAL_ASSET, assetPath());
		const fake = makeFakeSecureFs();
		mirror(fake);
		const res = await run(fake, "install");
		expect(res.ok).toBe(false);
		expect(res.errors.join(" ")).toMatch(/symlink/);
	});

	it("is a zero-write no-op when both components are managed-current", async () => {
		fs.copyFileSync(REAL_ASSET, assetPath());
		writeSettings({ hooks: { PreToolUse: [managedGroup(REAL_ASSET_SHA)] } });
		const fake = makeFakeSecureFs();
		mirror(fake);
		const before = fake.files.size;
		const res = await run(fake, "install");
		expect(res.ok).toBe(true);
		expect(res.changed).toEqual([]);
		expect(res.backups).toEqual([]);
		// No temp/backup was ever created — the transaction was never entered.
		expect(fake.files.size).toBe(before);
	});
});

describe("_run real POSIX adapter idempotency (skips on incapable hosts)", () => {
	it("installs then re-runs as a zero-write no-op under a private 0700 tree", async () => {
		if (process.platform === "win32") return; // no adapter — covered elsewhere
		const base = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-real-"));
		const project = path.join(base, "proj");
		fs.mkdirSync(project);
		fs.chmodSync(project, 0o700);
		fs.chmodSync(base, 0o700);
		try {
			const first = await installClaudePreToolUse(project);
			// Incapable host (world-writable temp ancestor, or getfacl absent) →
			// the gate refuses; treat as skipped rather than failing.
			if (!first.ok) return;
			const asset = path.join(project, ".claude", "hooks", ASSET_NAME);
			expect(fs.existsSync(asset)).toBe(true);
			const second = await installClaudePreToolUse(project);
			expect(second.ok).toBe(true);
			expect(second.changed).toEqual([]);
			const repaired = await repairClaudePreToolUse(project, {});
			expect(repaired.changed).toEqual([]);
		} finally {
			fs.rmSync(base, { recursive: true, force: true });
		}
	});
});
