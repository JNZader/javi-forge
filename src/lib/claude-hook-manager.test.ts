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
import { makeFakeSecureFs } from "./__fixtures__/fake-secure-fs.js";
import {
	_run,
	classifyAssetState,
	classifySettingsFile,
	detectNode,
	doctorClaudePreToolUse,
	type Manifest,
	type NodeOnPathProbe,
} from "./claude-hook-manager.js";
import { canonicalizeSettingsEntry } from "./claude-hook-settings.js";
import { ACL_PACKAGE_REMEDIATION } from "./secure-refusal-remediation.js";

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

/**
 * Every doctor call in this file goes through this wrapper so NO unit test ever
 * spawns the real `getfacl`: the ACL capability probe defaults to a stub, making
 * the suite host-independent. Tests that deliberately assert a specific probe
 * result pass their own `aclProbe` and win (spread order).
 */
type DoctorOptions = NonNullable<Parameters<typeof doctorClaudePreToolUse>[1]>;
const STUB_ACL_PROBE: NonNullable<DoctorOptions["aclProbe"]> = async () => ({
	status: "available",
	tool: "getfacl",
});
/**
 * Same reasoning for the node-on-PATH heuristic: it spawns `node --version` from
 * the host PATH, so every doctor call here stubs it. Tests that assert a
 * specific outcome inject their own through `execution.nodeProbe`.
 */
const STUB_NODE_PROBE = async (): Promise<NodeOnPathProbe> => ({
	status: "resolved",
	version: "v22.11.0",
	major: 22,
});
const doctor = (
	projectDir: string,
	options: DoctorOptions = {},
): ReturnType<typeof doctorClaudePreToolUse> =>
	doctorClaudePreToolUse(projectDir, {
		aclProbe: STUB_ACL_PROBE,
		...options,
		execution: { nodeProbe: STUB_NODE_PROBE, ...(options.execution ?? {}) },
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

	it("reads the packaged manifest by default and round-trips the real released identities", async () => {
		// No injected manifest: exercises readManifest against the populated
		// packaged manifest and proves the exact managed asset + group are
		// recognized as managed-current end-to-end.
		writeCurrent(REAL_ASSET_SHA);
		const report = await doctor(dir, { nodeVersion: "22.5.0" });
		expect(report.asset.state).toBe("managed-current");
		expect(report.settings.state).toBe("managed-current");
		expect(report.healthy).toBe(true);
	});

	it("is healthy only when both components are current, shape exact, Node >= 22", async () => {
		writeCurrent(REAL_ASSET_SHA);
		const report = await doctor(dir, {
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
		const report = await doctor(dir, {
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
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
		});
		expect(report.healthy).toBe(false);
		expect(report.asset.state).toBe("absent");
	});

	it("reports assetSettingsConsistent only when the statusMessage token matches the asset sha", async () => {
		writeCurrent(REAL_ASSET_SHA);
		const consistent = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
		});
		expect(consistent.assetSettingsConsistent).toBe(true);

		writeCurrent("b".repeat(64));
		const rotated = await doctor(dir, {
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
		await doctor(dir, {
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

	it("reports an execution verdict independent of healthy (healthy + inconclusive)", async () => {
		writeCurrent(REAL_ASSET_SHA);
		const home = fs.mkdtempSync(
			path.join(os.tmpdir(), "javi-forge-exec-home-"),
		);
		const managedDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "javi-forge-exec-mgd-"),
		);
		const managedFile = path.join(managedDir, "managed-settings.json");
		// Present-but-unreadable managed source (a directory at the file path)
		// forces inconclusive while the install itself is healthy + current.
		fs.mkdirSync(managedFile);
		try {
			const report = await doctor(dir, {
				manifest: syntheticManifest(),
				nodeVersion: "22.5.0",
				execution: {
					platform: "linux",
					homeDir: home,
					env: {},
					managedFile,
					managedDropInDir: path.join(managedDir, "managed-settings.d"),
				},
			});
			expect(report.healthy).toBe(true);
			expect(report.execution.status).toBe("inconclusive");
			expect(report.execution.unknownSources.length).toBeGreaterThan(0);
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
			fs.rmSync(managedDir, { recursive: true, force: true });
		}
	});
});

describe("doctor installCapability (ACL adapter capability section)", () => {
	const writeCurrent = (assetSha = REAL_ASSET_SHA): void => {
		fs.copyFileSync(REAL_ASSET, assetPath());
		fs.writeFileSync(
			settingsPath(),
			`${JSON.stringify({ hooks: { PreToolUse: [managedGroup(assetSha)] } }, null, 2)}\n`,
		);
	};
	const isolatedExecution = (home: string) => ({
		platform: "linux" as const,
		homeDir: home,
		env: {},
		managedFile: null,
		managedDropInDir: null,
	});
	let home: string;
	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-cap-home-"));
	});
	afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

	it("reports the row when the adapter is available, with no remediation", async () => {
		writeCurrent();
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
			aclProbe: async () => ({ status: "available", tool: "getfacl" }),
			execution: isolatedExecution(home),
		});
		expect(report.installCapability.acl).toEqual({
			status: "available",
			tool: "getfacl",
		});
		expect(report.installCapability.remediation).toBeUndefined();
	});

	it("an absent adapter on a current guard stays runnable and exits 0", async () => {
		writeCurrent();
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
			aclProbe: async () => ({ status: "absent", tool: "getfacl" }),
			execution: isolatedExecution(home),
		});
		expect(report.installCapability.acl.status).toBe("absent");
		expect(report.installCapability.remediation).toBe(ACL_PACKAGE_REMEDIATION);
		// The installed guard still fires: the capability section NEVER feeds the
		// execution matrix, so a slim image is not reported as blocked.
		expect(report.execution.status).toBe("runnable");
		expect(report.execution.blockers).toEqual([]);
		expect(report.execution.unknownSources).toEqual([]);
		expect(report.remediation).not.toContain(ACL_PACKAGE_REMEDIATION);
	});

	it("joins report.remediation when a guard-currency blocker already exists", async () => {
		// Asset absent → the user MUST install, and cannot without the adapter.
		fs.writeFileSync(
			settingsPath(),
			`${JSON.stringify({ hooks: { PreToolUse: [managedGroup(REAL_ASSET_SHA)] } }, null, 2)}\n`,
		);
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
			aclProbe: async () => ({ status: "absent", tool: "getfacl" }),
			execution: isolatedExecution(home),
		});
		expect(report.execution.blockers).toContain("guard:asset=absent");
		expect(report.remediation).toContain(ACL_PACKAGE_REMEDIATION);
	});

	it("keeps an unknown probe inside the section, never in unknownSources", async () => {
		writeCurrent();
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
			aclProbe: async () => ({
				status: "unknown",
				tool: "getfacl",
				detail: "getfacl --version timeout",
			}),
			execution: isolatedExecution(home),
		});
		expect(report.installCapability.acl.status).toBe("unknown");
		expect(report.installCapability.remediation).toBeUndefined();
		expect(report.execution.status).toBe("runnable");
		expect(report.execution.unknownSources).toEqual([]);
	});

	it("carries no remediation when the adapter is not applicable (win32)", async () => {
		writeCurrent();
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
			aclProbe: async () => ({
				status: "not-applicable",
				tool: "windows-secure-object",
			}),
			execution: isolatedExecution(home),
		});
		expect(report.installCapability.acl.status).toBe("not-applicable");
		expect(report.installCapability.remediation).toBeUndefined();
	});

	it("always carries the node-on-PATH row, also when the capability is satisfied", async () => {
		writeCurrent();
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
			execution: isolatedExecution(home),
		});
		// Satisfied is NOT silent: the row is present and stays a heuristic
		// observation — it clears nothing and adds no confidence.
		expect(report.nodeOnPath).toEqual({
			status: "resolved",
			version: "v22.11.0",
			major: 22,
		});
		expect(report.execution.status).toBe("runnable");
	});

	it("keeps report.node (process.versions.node) distinct from the node-on-PATH row", async () => {
		writeCurrent();
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
			execution: {
				...isolatedExecution(home),
				nodeProbe: async () => ({ status: "absent" }),
			},
		});
		// The diagnosing process itself runs a supported Node…
		expect(report.node).toEqual({
			available: true,
			version: "22.5.0",
			satisfiesMinimum: true,
		});
		// …while the independent PATH heuristic reports the guard as unspawnable.
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers).toContain(
			"runtime:node-not-on-PATH (heuristic: this process' PATH)",
		);
		expect(report.nodeOnPath).toEqual({ status: "absent" });
	});

	it("probes node ONCE per doctor run (the row and the matrix share it)", async () => {
		writeCurrent();
		let calls = 0;
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
			execution: {
				...isolatedExecution(home),
				nodeProbe: async () => {
					calls++;
					return { status: "absent" };
				},
			},
		});
		expect(calls).toBe(1);
		expect(report.nodeOnPath.status).toBe("absent");
	});

	it("does not report an absent adapter as healthy-affecting", async () => {
		writeCurrent();
		const report = await doctor(dir, {
			manifest: syntheticManifest(),
			nodeVersion: "22.5.0",
			aclProbe: async () => ({ status: "absent", tool: "getfacl" }),
			execution: isolatedExecution(home),
		});
		expect(report.healthy).toBe(true);
	});
});

const txClock = () => new Date("2026-08-16T19:00:00.123Z");
const makeNonce = () => {
	let n = 0;
	return () => (++n).toString(16).padStart(8, "0");
};
/** Seed the fake with the real ancestor chain of a project dir (root first). */
const seedChain = (
	fake: ReturnType<typeof makeFakeSecureFs>,
	projectDir: string,
): void => {
	let current = projectDir;
	while (true) {
		fake.seedDir(current);
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
};

describe("_run — install seam wiring (fake secureFs, host-independent)", () => {
	it("installs both absent components in place and returns a reconciled report", async () => {
		const fake = makeFakeSecureFs();
		seedChain(fake, dir);
		const res = await _run(
			dir,
			"install",
			{},
			{
				secureFs: fake,
				clock: txClock,
				nonce: makeNonce(),
				manifest: syntheticManifest(),
				aclProbe: STUB_ACL_PROBE,
			},
		);
		expect(res.ok).toBe(true);
		expect(res.changed).toEqual([assetPath(), settingsPath()]);
		expect(res.backups).toEqual([]);
		expect(res.report).toBeDefined();
		const parsed = JSON.parse(fake.fileText(settingsPath()) as string);
		expect(parsed.hooks.PreToolUse[0].matcher).toBe(
			"Bash|PowerShell|Read|Write|Edit",
		);
		expect(fake.fileText(assetPath())).toBe(
			fs.readFileSync(REAL_ASSET, "utf8"),
		);
	});

	it("still installs when node does not resolve on PATH, with a non-blocking warning", async () => {
		// No guard at all is strictly worse than an exec-form guard that may not
		// resolve, so the mutation proceeds and the operator is warned.
		const fake = makeFakeSecureFs();
		seedChain(fake, dir);
		const res = await _run(
			dir,
			"install",
			{},
			{
				secureFs: fake,
				clock: txClock,
				nonce: makeNonce(),
				manifest: syntheticManifest(),
				aclProbe: STUB_ACL_PROBE,
				nodeProbe: async () => ({ status: "absent" }),
			},
		);
		expect(res.ok).toBe(true);
		expect(res.changed).toEqual([assetPath(), settingsPath()]);
		expect(res.errors).toEqual([]);
		expect(res.warnings).toHaveLength(1);
		expect(res.warnings[0]).toContain("node");
		expect(res.warnings[0]).toContain("PATH");
	});

	it("emits no warning when node resolves at or above the minimum major", async () => {
		const fake = makeFakeSecureFs();
		seedChain(fake, dir);
		const res = await _run(
			dir,
			"install",
			{},
			{
				secureFs: fake,
				clock: txClock,
				nonce: makeNonce(),
				manifest: syntheticManifest(),
				aclProbe: STUB_ACL_PROBE,
				nodeProbe: async () => ({
					status: "resolved",
					version: "v22.11.0",
					major: 22,
				}),
			},
		);
		expect(res.ok).toBe(true);
		expect(res.warnings).toEqual([]);
	});

	it("warns when node on PATH is below the minimum major", async () => {
		const fake = makeFakeSecureFs();
		seedChain(fake, dir);
		const res = await _run(
			dir,
			"repair",
			{},
			{
				secureFs: fake,
				clock: txClock,
				nonce: makeNonce(),
				manifest: syntheticManifest(),
				aclProbe: STUB_ACL_PROBE,
				nodeProbe: async () => ({
					status: "resolved",
					version: "v18.20.4",
					major: 18,
				}),
			},
		);
		expect(res.ok).toBe(true);
		expect(res.warnings.join("\n")).toContain("v18");
	});

	it("carries warnings on a refusal too, and never turns one into an error", async () => {
		const res = await _run(
			dir,
			"install",
			{},
			{
				secureFs: null,
				manifest: syntheticManifest(),
				aclProbe: STUB_ACL_PROBE,
				nodeProbe: async () => ({ status: "absent" }),
			},
		);
		expect(res.ok).toBe(false);
		expect(res.errors).toEqual(["windows-secure-object-unavailable"]);
		expect(res.warnings).toHaveLength(1);
	});

	it("refuses on Windows with zero mutation and still returns a report", async () => {
		const res = await _run(
			dir,
			"install",
			{},
			{
				secureFs: null,
				manifest: syntheticManifest(),
				aclProbe: STUB_ACL_PROBE,
			},
		);
		expect(res.ok).toBe(false);
		expect(res.errors).toContain("windows-secure-object-unavailable");
		expect(res.changed).toEqual([]);
		expect(res.report).toBeDefined();
	});
	it.each(["install", "repair"] as const)("refuses exact Darwin %s before doctor, probes, secure-fs selection, or mutation", async (mode) => {
		const secureFs = makeFakeSecureFs();
		const openDirNoFollow = vi.spyOn(secureFs, "openDirNoFollow");
		const nodeProbe = vi.fn(async () => {
			throw new Error("Darwin refusal must not probe node");
		});
		const aclProbe = vi.fn(async () => {
			throw new Error("Darwin refusal must not probe ACL capability");
		});
		const doctor = vi.fn(async () => {
			throw new Error("Darwin refusal must not invoke doctor");
		});
		const result = await _run(dir, mode, {}, {
			platform: "darwin",
			secureFs,
			nodeProbe,
			aclProbe,
			doctor,
		});
		expect(result).toMatchObject({
			ok: false,
			changed: [],
			backups: [],
			errors: ["macos-lifecycle-unsupported"],
		});
		expect(result.report).toBeUndefined();
		expect(result.lifecycleRefusal).toMatchObject({
			platform: "darwin",
			state: "macos-deprecated",
			lifecycle: "unsupported",
			refusalCode: "macos-lifecycle-unsupported",
		});
		expect(openDirNoFollow).not.toHaveBeenCalled();
		expect(nodeProbe).not.toHaveBeenCalled();
		expect(aclProbe).not.toHaveBeenCalled();
		expect(doctor).not.toHaveBeenCalled();
		expect(result.warnings.join("\n")).toContain(
			"pin a supported release or migrate",
		);
	});

});


describe("doctor platform support advisory", () => {
	it("reports exact Darwin support data without changing report semantics", async () => {
		const darwin = await doctor(dir, { platform: "darwin" });
		const linux = await doctor(dir, { platform: "linux" });
		expect(darwin.platformSupport).toMatchObject({ state: "macos-deprecated", lifecycle: "unsupported", refusalCode: "macos-lifecycle-unsupported", guidance: expect.stringContaining("pin a supported release or migrate") });
		expect(linux.platformSupport).toBeUndefined();
		expect(darwin.healthy).toBe(linux.healthy);
		expect(darwin.execution).toEqual(linux.execution);
		expect(darwin.remediation).toEqual(linux.remediation);
	});
});
