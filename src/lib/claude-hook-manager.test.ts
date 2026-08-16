import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import {
	ASSET_MANAGED_MARKER,
	ASSET_NAME,
	LEGACY_FILE_SHA256,
	managedGroup,
	managedHandler,
	SAMPLE_ASSET_SHA256,
} from "./__fixtures__/claude-hook-ownership.js";
import {
	classifyAssetState,
	classifySettingsFile,
	detectNode,
	doctorClaudePreToolUse,
	installClaudePreToolUse,
	type Manifest,
	repairClaudePreToolUse,
} from "./claude-hook-manager.js";
import { canonicalizeSettingsEntry } from "./claude-hook-settings.js";

const REAL_ASSET = path.join(CLAUDE_HOOK_ASSETS_DIR, ASSET_NAME);
const REAL_ASSET_SHA = createHash("sha256")
	.update(fs.readFileSync(REAL_ASSET))
	.digest("hex");
const CANONICAL_SHA = canonicalizeSettingsEntry(
	managedGroup(),
	managedHandler(),
).canonicalSha256;

const syntheticManifest = (
	overrides: Partial<Manifest["asset"]> = {},
	settingsCurrent = { version: 1, canonicalSha256: CANONICAL_SHA },
): Manifest => ({
	asset: {
		name: ASSET_NAME,
		version: 1,
		sha256: REAL_ASSET_SHA,
		historical: [],
		...overrides,
	},
	settingsEntries: { current: settingsCurrent, historical: [] },
});

let dir: string;
const assetPath = (): string => path.join(dir, ".claude", "hooks", ASSET_NAME);
const settingsPath = (): string => path.join(dir, ".claude", "settings.json");

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-claude-mgr-"));
	fs.mkdirSync(path.join(dir, ".claude", "hooks"), { recursive: true });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("classifyAssetState (read-only, always recompute)", () => {
	it("reports absent when the asset path does not exist", async () => {
		expect(
			(await classifyAssetState(assetPath(), syntheticManifest())).state,
		).toBe("absent");
	});

	it("reports symlink without following the link", async () => {
		fs.symlinkSync(REAL_ASSET, assetPath());
		expect(
			(await classifyAssetState(assetPath(), syntheticManifest())).state,
		).toBe("symlink");
	});

	it("reports non-regular for a directory at the asset path", async () => {
		fs.mkdirSync(assetPath());
		expect(
			(await classifyAssetState(assetPath(), syntheticManifest())).state,
		).toBe("non-regular");
	});

	it("reports managed-current for the exact packaged bytes", async () => {
		fs.copyFileSync(REAL_ASSET, assetPath());
		const result = await classifyAssetState(assetPath(), syntheticManifest());
		expect(result.state).toBe("managed-current");
		expect(result.sha256).toBe(REAL_ASSET_SHA);
	});

	it("reports released-outdated when the recomputed hash is historical", async () => {
		fs.copyFileSync(REAL_ASSET, assetPath());
		const manifest = syntheticManifest({
			sha256: "0".repeat(64),
			historical: [REAL_ASSET_SHA],
		});
		expect((await classifyAssetState(assetPath(), manifest)).state).toBe(
			"released-outdated",
		);
	});

	it("reports edited-managed for a marked asset with an unknown hash", async () => {
		fs.writeFileSync(assetPath(), `${ASSET_MANAGED_MARKER}\n// edited body\n`);
		expect(
			(await classifyAssetState(assetPath(), syntheticManifest())).state,
		).toBe("edited-managed");
	});

	it("never trusts a forged asset-body hash — recompute wins", async () => {
		fs.writeFileSync(
			assetPath(),
			`${ASSET_MANAGED_MARKER}\n// claims ${REAL_ASSET_SHA} but is not the bytes\n`,
		);
		expect(
			(await classifyAssetState(assetPath(), syntheticManifest())).state,
		).toBe("edited-managed");
	});

	it("reports foreign for a regular file without the exact marker", async () => {
		fs.writeFileSync(assetPath(), "// someone else's hook\n");
		expect(
			(await classifyAssetState(assetPath(), syntheticManifest())).state,
		).toBe("foreign");
	});

	it("reports foreign for a binary asset", async () => {
		fs.writeFileSync(assetPath(), Buffer.from([0x00, 0x01, 0x02, 0x00]));
		const result = await classifyAssetState(assetPath(), syntheticManifest());
		expect(result.state).toBe("foreign");
		expect(result.detail).toBe("binary");
	});

	it("reports foreign for an asset exceeding the byte budget", async () => {
		fs.writeFileSync(
			assetPath(),
			`${ASSET_MANAGED_MARKER}\n${"x".repeat(1_200_000)}`,
		);
		expect(
			(await classifyAssetState(assetPath(), syntheticManifest())).state,
		).toBe("foreign");
	});
});

describe("classifySettingsFile wrapper (read-only)", () => {
	it("reports absent when the settings file is missing", async () => {
		expect(
			(
				await classifySettingsFile(
					settingsPath(),
					REAL_ASSET_SHA,
					syntheticManifest().settingsEntries,
				)
			).state,
		).toBe("absent");
	});

	it("reports symlink without following", async () => {
		fs.writeFileSync(path.join(dir, "target.json"), "{}");
		fs.symlinkSync(path.join(dir, "target.json"), settingsPath());
		expect(
			(
				await classifySettingsFile(
					settingsPath(),
					REAL_ASSET_SHA,
					syntheticManifest().settingsEntries,
				)
			).state,
		).toBe("symlink");
	});

	it("reports malformed for invalid JSON", async () => {
		fs.writeFileSync(settingsPath(), "{ not json");
		expect(
			(
				await classifySettingsFile(
					settingsPath(),
					REAL_ASSET_SHA,
					syntheticManifest().settingsEntries,
				)
			).state,
		).toBe("malformed");
	});

	it("recognizes the whole-file v0 legacy scaffold as exact-legacy", async () => {
		const legacy = fs.readFileSync(
			path.join(
				CLAUDE_HOOK_ASSETS_DIR,
				"../..",
				"templates",
				"security-hooks",
				"claude-settings-security.json",
			),
		);
		expect(createHash("sha256").update(legacy).digest("hex")).toBe(
			LEGACY_FILE_SHA256,
		);
		fs.writeFileSync(settingsPath(), legacy);
		const result = await classifySettingsFile(
			settingsPath(),
			REAL_ASSET_SHA,
			syntheticManifest().settingsEntries,
		);
		expect(result.state).toBe("exact-legacy");
		expect(result.detail).toBe("whole-file");
	});
});

describe("detectNode", () => {
	it("requires Node major >= 22", () => {
		expect(detectNode("22.5.0")).toEqual({
			available: true,
			version: "22.5.0",
			satisfiesMinimum: true,
		});
		expect(detectNode("20.11.0").satisfiesMinimum).toBe(false);
		expect(detectNode(undefined)).toEqual({
			available: false,
			satisfiesMinimum: false,
		});
	});
});

describe("doctorClaudePreToolUse (read-only component report)", () => {
	const writeCurrent = (assetSha = SAMPLE_ASSET_SHA256): void => {
		fs.copyFileSync(REAL_ASSET, assetPath());
		fs.writeFileSync(
			settingsPath(),
			`${JSON.stringify({ hooks: { PreToolUse: [managedGroup(assetSha)] } }, null, 2)}\n`,
		);
	};

	it("is healthy only when both components are current, shape exact, Node >= 22", async () => {
		writeCurrent(REAL_ASSET_SHA);
		const report = await doctorClaudePreToolUse(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
		});
		expect(report.healthy).toBe(true);
		expect(report.asset.state).toBe("managed-current");
		expect(report.settings.state).toBe("managed-current");
		expect(report.matcherExact).toBe(true);
		expect(report.commandShapeExact).toBe(true);
		expect(report.coverage).toEqual([
			"Bash",
			"PowerShell",
			"Read",
			"Write",
			"Edit",
		]);
		expect(report.hostResidual).toContain("permission flow");
	});

	it("is unhealthy when Node is below 22 and names a remediation", async () => {
		writeCurrent(REAL_ASSET_SHA);
		const report = await doctorClaudePreToolUse(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "20.0.0",
		});
		expect(report.healthy).toBe(false);
		expect(report.remediation.join(" ")).toMatch(/Node 22/);
	});

	it("is unhealthy when the asset is absent", async () => {
		fs.writeFileSync(
			settingsPath(),
			`${JSON.stringify({ hooks: { PreToolUse: [managedGroup(REAL_ASSET_SHA)] } }, null, 2)}\n`,
		);
		const report = await doctorClaudePreToolUse(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
		});
		expect(report.healthy).toBe(false);
		expect(report.asset.state).toBe("absent");
	});

	it("reports assetSettingsConsistent only when the statusMessage token matches the asset sha", async () => {
		writeCurrent(REAL_ASSET_SHA);
		const consistent = await doctorClaudePreToolUse(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
		});
		expect(consistent.assetSettingsConsistent).toBe(true);

		writeCurrent("b".repeat(64));
		const rotated = await doctorClaudePreToolUse(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
		});
		// Decision ②: rotation keeps the settings entry managed-current…
		expect(rotated.settings.state).toBe("managed-current");
		// …but the cross-component consistency advisory flips off.
		expect(rotated.assetSettingsConsistent).toBe(false);
		expect(rotated.healthy).toBe(true);
	});

	it("never mutates bytes, mtimes, or creates backups", async () => {
		writeCurrent(REAL_ASSET_SHA);
		const snapshot = (p: string) => {
			const st = fs.statSync(p);
			return { bytes: fs.readFileSync(p), mtime: st.mtimeMs };
		};
		const before = {
			asset: snapshot(assetPath()),
			settings: snapshot(settingsPath()),
			hookDir: fs.readdirSync(path.join(dir, ".claude", "hooks")).sort(),
			claudeDir: fs.readdirSync(path.join(dir, ".claude")).sort(),
		};
		await doctorClaudePreToolUse(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
		});
		expect(fs.readFileSync(assetPath())).toEqual(before.asset.bytes);
		expect(fs.readFileSync(settingsPath())).toEqual(before.settings.bytes);
		expect(fs.statSync(assetPath()).mtimeMs).toBe(before.asset.mtime);
		expect(fs.readdirSync(path.join(dir, ".claude", "hooks")).sort()).toEqual(
			before.hookDir,
		);
		expect(fs.readdirSync(path.join(dir, ".claude")).sort()).toEqual(
			before.claudeDir,
		);
	});
});

describe("Slice-3 seams are declared but unimplemented", () => {
	it("installClaudePreToolUse throws the Slice-3 marker", () => {
		expect(() => installClaudePreToolUse(dir)).toThrow(
			/unimplemented: Slice 3/,
		);
	});
	it("repairClaudePreToolUse throws the Slice-3 marker", () => {
		expect(() => repairClaudePreToolUse(dir, { force: true })).toThrow(
			/unimplemented: Slice 3/,
		);
	});
});
