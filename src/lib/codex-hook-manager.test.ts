import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import { ASSET_NAME } from "./__fixtures__/claude-hook-ownership.js";
import { makeFakeSecureFs } from "./__fixtures__/fake-secure-fs.js";
import {
	_runCodex,
	classifyCodexHooksJson,
	codexConfigPaths,
	codexTrustGrantCommand,
	doctorCodexPreToolUse,
	expectedCodexCommand,
	hasCodexTrustEntry,
	type Manifest,
	mergeFeaturesHooksTrue,
	type NodeOnPathProbe,
	parseFeaturesHooks,
	removeCodexTrustEntries,
} from "./codex-hook-manager.js";

const REAL_ASSET = path.join(CLAUDE_HOOK_ASSETS_DIR, ASSET_NAME);
const REAL_ASSET_SHA = createHash("sha256")
	.update(fs.readFileSync(REAL_ASSET))
	.digest("hex");

const manifest = (overrides: Partial<Manifest["asset"]> = {}): Manifest => ({
	asset: {
		name: ASSET_NAME,
		version: 1,
		sha256: REAL_ASSET_SHA,
		historical: [],
		...overrides,
	},
});

const clock = () => new Date("2026-08-18T19:00:00.123Z");
const makeNonce = () => {
	let n = 0;
	return () => (++n).toString(16).padStart(8, "0");
};
const STUB_NODE_PROBE = async (): Promise<NodeOnPathProbe> => ({
	status: "resolved",
	version: "v22.11.0",
	major: 22,
});

let home: string;
const codexDir = () => path.join(home, ".codex");
const hooksFile = () => path.join(codexDir(), "hooks.json");
const configFile = () => path.join(codexDir(), "config.toml");

const mirror = (fake: ReturnType<typeof makeFakeSecureFs>): void => {
	let current = home;
	while (true) {
		fake.seedDir(current);
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	if (fs.existsSync(codexDir())) fake.seedDir(codexDir());
	for (const p of [hooksFile(), configFile()]) {
		if (fs.existsSync(p)) {
			fake.seedFile(p, fs.readFileSync(p), fs.statSync(p).mode & 0o7777);
		}
	}
};

const runInstall = (
	fake: ReturnType<typeof makeFakeSecureFs>,
	m: Manifest = manifest(),
) =>
	_runCodex(
		home,
		"install",
		{},
		{
			secureFs: fake,
			clock,
			nonce: makeNonce(),
			manifest: m,
			nodeProbe: STUB_NODE_PROBE,
		},
	);

beforeEach(() => {
	home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-mgr-"));
});
afterEach(() => {
	fs.rmSync(home, { recursive: true, force: true });
});

describe("codex pure TOML helpers", () => {
	it("parseFeaturesHooks reads the [features] hooks flag", () => {
		expect(parseFeaturesHooks("[features]\nhooks = true\n")).toBe("true");
		expect(parseFeaturesHooks("[features]\nhooks = false\n")).toBe("false");
		expect(parseFeaturesHooks("[other]\nx = 1\n")).toBe("absent");
		expect(parseFeaturesHooks("")).toBe("absent");
	});

	it("mergeFeaturesHooksTrue is idempotent and preserves content", () => {
		const already = "[features]\nhooks = true\n";
		expect(mergeFeaturesHooksTrue(already)).toBe(already);
		expect(parseFeaturesHooks(mergeFeaturesHooksTrue(""))).toBe("true");
		const flipped = mergeFeaturesHooksTrue("[features]\nhooks = false\n");
		expect(parseFeaturesHooks(flipped)).toBe("true");
		const preserved = mergeFeaturesHooksTrue('[model]\nname = "x"\n');
		expect(preserved).toContain('name = "x"');
		expect(parseFeaturesHooks(preserved)).toBe("true");
	});

	it("hasCodexTrustEntry detects the pre_tool_use trust table for the hook path", () => {
		const p = "/home/u/.codex/hooks.json";
		const trusted = `[hooks.state."${p}:pre_tool_use:0:0"]\ntrusted_hash = "abc"\n`;
		expect(hasCodexTrustEntry(trusted, p)).toBe(true);
		expect(hasCodexTrustEntry("[features]\nhooks = true\n", p)).toBe(false);
		// A trust entry for a DIFFERENT hook path does not count.
		const other = `[hooks.state."/elsewhere/hooks.json:pre_tool_use:0:0"]\n`;
		expect(hasCodexTrustEntry(other, p)).toBe(false);
	});

	it("removeCodexTrustEntries drops OUR hooks.state table but keeps foreign rows + other content", () => {
		const p = "/home/u/.codex/hooks.json";
		const text = [
			"[features]",
			"hooks = true",
			`[hooks.state."${p}:pre_tool_use:0:0"]`,
			'trusted_hash = "stale"',
			'[hooks.state."/other/hooks.json:pre_tool_use:0:0"]',
			'trusted_hash = "keep"',
			"",
		].join("\n");
		const out = removeCodexTrustEntries(text, p);
		expect(hasCodexTrustEntry(out, p)).toBe(false);
		// Foreign row + [features] survive untouched.
		expect(out).toContain("/other/hooks.json:pre_tool_use:0:0");
		expect(out).toContain('trusted_hash = "keep"');
		expect(parseFeaturesHooks(out)).toBe("true");
		// A path that merely has ours as a string prefix is NOT removed.
		const prefixed = `[hooks.state."${p}.bak:pre_tool_use:0:0"]\ntrusted_hash = "x"\n`;
		expect(removeCodexTrustEntries(prefixed, p)).toBe(prefixed);
	});

	it("classifyCodexHooksJson reuses the settings shape and recognizes our command", () => {
		const cmd = expectedCodexCommand(REAL_ASSET);
		const managed = {
			hooks: {
				PreToolUse: [
					{
						matcher: "*",
						hooks: [{ type: "command", command: cmd, timeout: 30 }],
					},
				],
			},
		};
		expect(classifyCodexHooksJson(managed, cmd).state).toBe("managed-current");
		expect(
			classifyCodexHooksJson({ hooks: { PreToolUse: [] } }, cmd).state,
		).toBe("absent");
		expect(classifyCodexHooksJson({ hooks: 5 }, cmd).state).toBe("malformed");
		const foreign = {
			hooks: {
				PreToolUse: [
					{ matcher: "*", hooks: [{ type: "command", command: "echo hi" }] },
				],
			},
		};
		expect(classifyCodexHooksJson(foreign, cmd).state).toBe("foreign");
	});
});

describe("codex install (secure-fs transaction)", () => {
	it("S2.1 writes hooks.json + config.toml [features] hooks=true", async () => {
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await runInstall(fake);
		expect(result.ok).toBe(true);
		expect(result.changed).toContain(hooksFile());
		expect(result.changed).toContain(configFile());

		const hooksText = fake.fileText(hooksFile()) as string;
		const parsedHooks = JSON.parse(hooksText);
		const cmd = parsedHooks.hooks.PreToolUse[0].hooks[0].command as string;
		expect(cmd).toContain("--agent=codex");
		expect(cmd).toContain(ASSET_NAME);

		const configText = fake.fileText(configFile()) as string;
		expect(parseFeaturesHooks(configText)).toBe("true");
	});

	it("S2.1 idempotent re-run writes nothing", async () => {
		const fake = makeFakeSecureFs();
		mirror(fake);
		await runInstall(fake);
		// Seed the fake's written files as if on disk for the classify re-read by
		// persisting them to the real temp dir, then re-run.
		fs.mkdirSync(codexDir(), { recursive: true });
		fs.writeFileSync(hooksFile(), fake.fileText(hooksFile()) as string);
		fs.writeFileSync(configFile(), fake.fileText(configFile()) as string);

		const fake2 = makeFakeSecureFs();
		mirror(fake2);
		const again = await runInstall(fake2);
		expect(again.ok).toBe(true);
		expect(again.changed).toEqual([]);
	});

	it("R-1 rewriting hooks.json invalidates the now-stale trust entry (doctor → untrusted/blocked)", async () => {
		// Trusted + installed, but the managed hook references a STALE asset path.
		fs.mkdirSync(codexDir(), { recursive: true });
		const staleCmd =
			"node /old/javi-forge-skillguard-pre-tool-use.mjs --agent=codex";
		fs.writeFileSync(
			hooksFile(),
			`${JSON.stringify(
				{
					hooks: {
						PreToolUse: [
							{
								matcher: "*",
								hooks: [{ type: "command", command: staleCmd, timeout: 30 }],
							},
						],
					},
				},
				null,
				2,
			)}\n`,
		);
		fs.writeFileSync(
			configFile(),
			`[features]\nhooks = true\n[hooks.state."${hooksFile()}:pre_tool_use:0:0"]\ntrusted_hash = "stale"\n[hooks.state."/other/hooks.json:pre_tool_use:0:0"]\ntrusted_hash = "keep"\n`,
		);

		const fake = makeFakeSecureFs();
		mirror(fake);
		// Re-install at the REAL asset path → managed hooks.json content changes.
		const result = await runInstall(fake);
		expect(result.ok).toBe(true);
		expect(result.changed).toContain(hooksFile());
		expect(result.changed).toContain(configFile());

		// OUR trust table is stripped from the written config; foreign row + the
		// [features] flag survive.
		const writtenConfig = fake.fileText(configFile()) as string;
		expect(hasCodexTrustEntry(writtenConfig, hooksFile())).toBe(false);
		expect(writtenConfig).toContain("/other/hooks.json:pre_tool_use:0:0");
		expect(parseFeaturesHooks(writtenConfig)).toBe("true");

		// Persist the transaction's bytes and confirm the doctor reverts honestly.
		fs.writeFileSync(hooksFile(), fake.fileText(hooksFile()) as string);
		fs.writeFileSync(configFile(), writtenConfig);
		const report = await doctorCodexPreToolUse(home, {
			manifest: manifest(),
			nodeProbe: STUB_NODE_PROBE,
		});
		expect(report.trust.state).toBe("untrusted");
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(/trust|untrusted/);
	});

	it("R-1 idempotent re-install (no content change) does NOT strip a valid trust entry", async () => {
		// Managed-current hooks.json at the REAL asset + trusted + features on.
		fs.mkdirSync(codexDir(), { recursive: true });
		const cmd = expectedCodexCommand(REAL_ASSET);
		fs.writeFileSync(
			hooksFile(),
			`${JSON.stringify(
				{
					hooks: {
						PreToolUse: [
							{
								matcher: "*",
								hooks: [{ type: "command", command: cmd, timeout: 30 }],
							},
						],
					},
				},
				null,
				2,
			)}\n`,
		);
		fs.writeFileSync(
			configFile(),
			`[features]\nhooks = true\n[hooks.state."${hooksFile()}:pre_tool_use:0:0"]\ntrusted_hash = "valid"\n`,
		);
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await runInstall(fake);
		expect(result.ok).toBe(true);
		// Nothing rewritten → the valid trust entry is left intact on disk.
		expect(result.changed).toEqual([]);
		expect(
			hasCodexTrustEntry(fs.readFileSync(configFile(), "utf8"), hooksFile()),
		).toBe(true);
	});

	it("R-3 repair --force captures persistent backups of the prior managed files", async () => {
		// Existing managed hook at a STALE path + [features] hooks=false → repair
		// rewrites BOTH files.
		fs.mkdirSync(codexDir(), { recursive: true });
		const staleCmd =
			"node /old/javi-forge-skillguard-pre-tool-use.mjs --agent=codex";
		fs.writeFileSync(
			hooksFile(),
			`${JSON.stringify(
				{
					hooks: {
						PreToolUse: [
							{
								matcher: "*",
								hooks: [{ type: "command", command: staleCmd, timeout: 30 }],
							},
						],
					},
				},
				null,
				2,
			)}\n`,
		);
		fs.writeFileSync(configFile(), "[features]\nhooks = false\n");
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await _runCodex(
			home,
			"repair",
			{ force: true },
			{
				secureFs: fake,
				clock,
				nonce: makeNonce(),
				manifest: manifest(),
				nodeProbe: STUB_NODE_PROBE,
			},
		);
		expect(result.ok).toBe(true);
		expect(result.backups.length).toBeGreaterThan(0);
	});

	it("R-3 repair WITHOUT --force writes no persistent backup", async () => {
		fs.mkdirSync(codexDir(), { recursive: true });
		const staleCmd =
			"node /old/javi-forge-skillguard-pre-tool-use.mjs --agent=codex";
		fs.writeFileSync(
			hooksFile(),
			`${JSON.stringify(
				{
					hooks: {
						PreToolUse: [
							{
								matcher: "*",
								hooks: [{ type: "command", command: staleCmd, timeout: 30 }],
							},
						],
					},
				},
				null,
				2,
			)}\n`,
		);
		fs.writeFileSync(configFile(), "[features]\nhooks = false\n");
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await _runCodex(
			home,
			"repair",
			{ force: false },
			{
				secureFs: fake,
				clock,
				nonce: makeNonce(),
				manifest: manifest(),
				nodeProbe: STUB_NODE_PROBE,
			},
		);
		expect(result.ok).toBe(true);
		expect(result.backups).toEqual([]);
	});

	it("S2.5 reports untrusted right after install (report-the-trust-step)", async () => {
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await runInstall(fake);
		if (!result.ok)
			throw new Error(`unexpected refusal: ${result.errors.join(", ")}`);
		expect(result.report.trust.state).toBe("untrusted");
		expect(result.report.trust.grantCommand).toContain("codex");
		expect(result.warnings.join("\n")).toMatch(/trust|approve/i);
	});
});

describe("codex doctor (execution matrix)", () => {
	const writeConfig = (text: string) => {
		fs.mkdirSync(codexDir(), { recursive: true });
		fs.writeFileSync(configFile(), text);
	};
	const writeManagedHooks = () => {
		fs.mkdirSync(codexDir(), { recursive: true });
		const cmd = expectedCodexCommand(REAL_ASSET);
		fs.writeFileSync(
			hooksFile(),
			`${JSON.stringify(
				{
					hooks: {
						PreToolUse: [
							{
								matcher: "*",
								hooks: [{ type: "command", command: cmd, timeout: 30 }],
							},
						],
					},
				},
				null,
				2,
			)}\n`,
		);
	};
	const trustText = () =>
		`[features]\nhooks = true\n[hooks.state."${hooksFile()}:pre_tool_use:0:0"]\ntrusted_hash = "x"\n`;

	const doctor = (m: Manifest = manifest()) =>
		doctorCodexPreToolUse(home, { manifest: m, nodeProbe: STUB_NODE_PROBE });

	it("S2.2 features hooks=false → blocked", async () => {
		writeManagedHooks();
		writeConfig(`[features]\nhooks = false\n${trustText()}`);
		const report = await doctor();
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(/hooks=false/);
	});

	it("S2.2 untrusted (no trust entry) → blocked — THE fail-open guard", async () => {
		writeManagedHooks();
		writeConfig("[features]\nhooks = true\n");
		const report = await doctor();
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(/trust|untrusted/);
	});

	it("S2.2 asset SHA ∉ manifest → blocked", async () => {
		writeManagedHooks();
		writeConfig(trustText());
		const report = await doctor(manifest({ sha256: "0".repeat(64) }));
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(/asset/);
	});

	it("S2.2 hooks.json missing → blocked", async () => {
		writeConfig(trustText());
		const report = await doctor();
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(
			/registration|hooks\.json/,
		);
	});

	it("S2.2 foreign hooks.json → blocked", async () => {
		fs.mkdirSync(codexDir(), { recursive: true });
		fs.writeFileSync(
			hooksFile(),
			`${JSON.stringify({ hooks: { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "echo hi" }] }] } })}\n`,
		);
		writeConfig(trustText());
		const report = await doctor();
		expect(report.execution.status).toBe("blocked");
	});

	it("fully trusted + current + node → runnable", async () => {
		writeManagedHooks();
		writeConfig(trustText());
		const report = await doctor();
		expect(report.execution.status).toBe("runnable");
		expect(report.trust.state).toBe("trusted");
	});

	it("codexConfigPaths + grant command are stable", () => {
		const paths = codexConfigPaths("/home/u");
		expect(paths.hooksFile).toBe("/home/u/.codex/hooks.json");
		expect(paths.configFile).toBe("/home/u/.codex/config.toml");
		expect(codexTrustGrantCommand("/home/u/.codex/hooks.json")).toMatch(
			/codex/,
		);
	});

	it("node absent on PATH → blocked", async () => {
		writeManagedHooks();
		writeConfig(trustText());
		const report = await doctorCodexPreToolUse(home, {
			manifest: manifest(),
			nodeProbe: async () => ({ status: "absent" }),
		});
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(/node-not-on-PATH/);
	});

	it("node-on-PATH unknown → inconclusive (never promoted to runnable)", async () => {
		writeManagedHooks();
		writeConfig(trustText());
		const report = await doctorCodexPreToolUse(home, {
			manifest: manifest(),
			nodeProbe: async () => ({ status: "unknown", detail: "timeout" }),
		});
		expect(report.execution.status).toBe("inconclusive");
	});

	it("R-5 config.toml unreadable (a directory / EISDIR) → blocked, config not readable", async () => {
		writeManagedHooks();
		fs.mkdirSync(configFile()); // codexDir already exists; config path is a dir
		const report = await doctor();
		expect(report.config.readable).toBe(false);
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(/config:unreadable/);
	});

	it("R-5 node-on-PATH resolved but major < 22 → blocked (heuristic)", async () => {
		writeManagedHooks();
		writeConfig(trustText());
		const report = await doctorCodexPreToolUse(home, {
			manifest: manifest(),
			nodeProbe: async () => ({
				status: "resolved",
				version: "v18.19.0",
				major: 18,
			}),
		});
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(/node-on-PATH v18/);
	});

	it("R-5 hooks.json non-regular (a directory) → blocked", async () => {
		fs.mkdirSync(codexDir(), { recursive: true });
		fs.mkdirSync(hooksFile()); // hooks path is a directory
		writeConfig(trustText());
		const report = await doctor();
		expect(report.hooksJson.state).toBe("non-regular");
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(
			/hooks\.json=non-regular/,
		);
	});

	it("R-5 malformed hooks.json (invalid JSON) → blocked via the doctor catch", async () => {
		fs.mkdirSync(codexDir(), { recursive: true });
		fs.writeFileSync(hooksFile(), "{ not valid json");
		writeConfig(trustText());
		const report = await doctor();
		expect(report.hooksJson.state).toBe("malformed");
		expect(report.execution.status).toBe("blocked");
	});
});

describe("codex install edge cases", () => {
	it("refuses a malformed hooks.json without mutating", async () => {
		fs.mkdirSync(codexDir(), { recursive: true });
		fs.writeFileSync(hooksFile(), "{ not valid json");
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await runInstall(fake);
		expect(result.ok).toBe(false);
		expect(result.errors.join("\n")).toMatch(/refuse hooks\.json/);
		expect(result.changed).toEqual([]);
	});

	it("merges into a foreign hooks.json, preserving the existing group", async () => {
		fs.mkdirSync(codexDir(), { recursive: true });
		fs.writeFileSync(
			hooksFile(),
			`${JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo keep" }] }] } })}\n`,
		);
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await runInstall(fake);
		expect(result.ok).toBe(true);
		const parsed = JSON.parse(fake.fileText(hooksFile()) as string);
		const commands = parsed.hooks.PreToolUse.flatMap(
			(g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command),
		);
		expect(commands).toContain("echo keep");
		expect(commands.some((c: string) => c.includes("--agent=codex"))).toBe(
			true,
		);
	});

	it("refuses with zero mutation when no secure-fs adapter exists (Windows)", async () => {
		const result = await _runCodex(
			home,
			"install",
			{},
			{
				secureFs: null,
				clock,
				nonce: makeNonce(),
				manifest: manifest(),
				nodeProbe: STUB_NODE_PROBE,
			},
		);
		expect(result.ok).toBe(false);
		expect(result.errors).toContain("windows-secure-object-unavailable");
	});
	it.each([
		"install",
		"repair",
	] as const)("refuses exact Darwin %s before doctor, probes, secure-fs selection, or mutation", async (mode) => {
		const secureFs = makeFakeSecureFs();
		const openDirNoFollow = vi.spyOn(secureFs, "openDirNoFollow");
		const nodeProbe = vi.fn(async () => {
			throw new Error("Darwin refusal must not probe node");
		});
		const doctor = vi.fn(async () => {
			throw new Error("Darwin refusal must not invoke doctor");
		});
		const result = await _runCodex(
			home,
			mode,
			{},
			{
				platform: "darwin",
				secureFs,
				nodeProbe,
				doctor,
			},
		);
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
		expect(doctor).not.toHaveBeenCalled();
		expect(result.warnings.join("\n")).toContain(
			"pin a supported release or migrate",
		);
	});
});

describe("doctor platform support advisory", () => {
	it("reports exact Darwin support data without changing report semantics", async () => {
		const darwin = await doctorCodexPreToolUse(home, {
			manifest: manifest(),
			nodeProbe: STUB_NODE_PROBE,
			platform: "darwin",
		});
		const linux = await doctorCodexPreToolUse(home, {
			manifest: manifest(),
			nodeProbe: STUB_NODE_PROBE,
			platform: "linux",
		});
		expect(darwin.platformSupport).toMatchObject({
			state: "macos-deprecated",
			lifecycle: "unsupported",
			refusalCode: "macos-lifecycle-unsupported",
			guidance: expect.stringContaining("pin a supported release or migrate"),
		});
		expect(linux.platformSupport).toBeUndefined();
		expect(darwin.healthy).toBe(linux.healthy);
		expect(darwin.execution).toEqual(linux.execution);
		expect(darwin.remediation).toEqual(linux.remediation);
	});
});
