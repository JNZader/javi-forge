import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import { ASSET_NAME } from "./__fixtures__/claude-hook-ownership.js";
import { makeFakeSecureFs } from "./__fixtures__/fake-secure-fs.js";
import {
	_runCodex,
	type CodexHookDoctorReport,
	classifyCodexHooksJson,
	codexConfigPaths,
	codexTrustGrantCommand,
	detectCodexTrust,
	doctorCodexPreToolUse,
	expectedCodexCommand,
	installCodexPreToolUse,
	type Manifest,
	mergeFeaturesHooksTrue,
	type NodeOnPathProbe,
	parseFeaturesHooks,
	removeCodexTrustEntries,
	repairCodexPreToolUse,
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

const supportedDoctor = async (
	...args: Parameters<typeof doctorCodexPreToolUse>
): Promise<CodexHookDoctorReport> => {
	const result = await doctorCodexPreToolUse(...args);
	if ("state" in result) throw new Error("expected supported doctor report");
	return result;
};

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

	it("does not claim provider trust without an authoritative verifier", () => {
		expect(detectCodexTrust()).toBe("unknown");
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
		expect(out).not.toContain(`[hooks.state."${p}:pre_tool_use:0:0"]`);
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
						matcher: "Bash|apply_patch",
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

	it("R-1 command replacement preserves recorded trust for provider mismatch verification", async () => {
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
								matcher: "Bash|apply_patch",
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

		const originalConfig = fs.readFileSync(configFile(), "utf8");
		const fake = makeFakeSecureFs();
		mirror(fake);
		// Re-install at the REAL asset path → managed hooks.json content changes.
		const result = await runInstall(fake);
		expect(result.ok).toBe(true);
		expect(result.changed).toContain(hooksFile());
		expect(result.changed).not.toContain(configFile());

		// Preserve ALL trust bytes; no hash is minted or removed by migration.
		const writtenConfig = fake.fileText(configFile()) as string;
		expect(writtenConfig).toBe(originalConfig);
		expect(writtenConfig).toContain(
			`[hooks.state."${hooksFile()}:pre_tool_use:0:0"]`,
		);
		expect(writtenConfig).toContain("/other/hooks.json:pre_tool_use:0:0");
		expect(parseFeaturesHooks(writtenConfig)).toBe("true");

		// Persist the transaction's bytes and confirm the doctor reverts honestly.
		fs.writeFileSync(hooksFile(), fake.fileText(hooksFile()) as string);
		fs.writeFileSync(configFile(), writtenConfig);
		const report = await supportedDoctor(home, {
			manifest: manifest(),
			nodeProbe: STUB_NODE_PROBE,
		});
		expect(report.trust.state).toBe("unknown");
		expect(report.execution.status).toBe("inconclusive");
		expect(report.execution.unknownSources.join(",")).toContain("trust");
	});

	it("R-1 idempotent re-install (no content change) does NOT strip a recorded trust entry", async () => {
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
								matcher: "Bash|apply_patch",
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
		// Nothing rewritten → the recorded trust entry is left intact on disk.
		expect(result.changed).toEqual([]);
		expect(fs.readFileSync(configFile(), "utf8")).toContain(
			`[hooks.state."${hooksFile()}:pre_tool_use:0:0"]`,
		);
	});

	it("R-3 repair --force captures persistent backups of the prior managed files", async () => {
		// Existing managed hook at a STALE path + [features] hooks=false → repair
		// rewrites hooks.json only; config enablement remains false.
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
								matcher: "Bash|apply_patch",
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
		expect(result.backups).toHaveLength(1);
		expect(result.backups[0]).toContain("hooks.json");
		expect(result.changed).toEqual([hooksFile()]);
		expect(fake.fileText(configFile())).toBe("[features]\nhooks = false\n");
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
								matcher: "Bash|apply_patch",
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
		expect(result.changed).toEqual([hooksFile()]);
		expect(fake.fileText(configFile())).toBe("[features]\nhooks = false\n");
	});

	it("S2.5 reports unknown trust right after install (report-the-trust-step)", async () => {
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await runInstall(fake);
		if (!result.ok)
			throw new Error(`unexpected refusal: ${result.errors.join(", ")}`);
		expect(result.report.trust.state).toBe("unknown");
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
								matcher: "Bash|apply_patch",
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

	const supportedReport = (
		result: Awaited<ReturnType<typeof doctorCodexPreToolUse>>,
	): CodexHookDoctorReport => {
		if ("state" in result) throw new Error("expected supported doctor report");
		return result;
	};

	const supportedDoctor = async (
		...args: Parameters<typeof doctorCodexPreToolUse>
	): Promise<CodexHookDoctorReport> =>
		supportedReport(await doctorCodexPreToolUse(...args));

	const doctor = (m: Manifest = manifest()) =>
		supportedDoctor(home, { manifest: m, nodeProbe: STUB_NODE_PROBE });

	it("S2.2 features hooks=false → blocked", async () => {
		writeManagedHooks();
		writeConfig(`[features]\nhooks = false\n${trustText()}`);
		const report = await doctor();
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(/hooks=false/);
	});

	it("S2.2 no trust entry without provider identity → inconclusive", async () => {
		writeManagedHooks();
		writeConfig("[features]\nhooks = true\n");
		const report = await doctor();
		expect(report.execution.status).toBe("inconclusive");
		expect(report.execution.unknownSources.join(",")).toContain("trust");
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

	it("recorded hash + current + node → inconclusive", async () => {
		writeManagedHooks();
		writeConfig(trustText());
		const report = await doctor();
		expect(report.execution.status).toBe("inconclusive");
		expect(report.trust.state).toBe("unknown");
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
		const report = await supportedDoctor(home, {
			manifest: manifest(),
			nodeProbe: async () => ({ status: "absent" }),
		});
		expect(report.execution.status).toBe("blocked");
		expect(report.execution.blockers.join(",")).toMatch(/node-not-on-PATH/);
	});

	it("node-on-PATH unknown → inconclusive (never promoted to runnable)", async () => {
		writeManagedHooks();
		writeConfig(trustText());
		const report = await supportedDoctor(home, {
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
		const report = await supportedDoctor(home, {
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
			errors: ["unsupported-platform"],
		});
		expect(result.report).toBeUndefined();
		expect(result.lifecycleRefusal).toMatchObject({
			state: "unsupported-platform",
			refusalCode: "unsupported-platform",
		});
		expect(openDirNoFollow).not.toHaveBeenCalled();
		expect(nodeProbe).not.toHaveBeenCalled();
		expect(doctor).not.toHaveBeenCalled();
		expect(result.warnings.join("\n")).toContain(
			"javi-forge supports Linux and Windows only.",
		);
	});
});

describe("doctor platform support advisory", () => {
	it("preserves the zero-argument API and returns a discriminated unsupported result before resolving home", async () => {
		const zeroArgumentDoctor: () => ReturnType<typeof doctorCodexPreToolUse> =
			doctorCodexPreToolUse;
		const homedir = vi.spyOn(os, "homedir");
		const result = await doctorCodexPreToolUse(undefined, {
			platform: "darwin",
		});

		expect(zeroArgumentDoctor).toBe(doctorCodexPreToolUse);
		expect(result).toMatchObject({
			state: "unsupported-platform",
			healthy: false,
			platformSupport: { refusalCode: "unsupported-platform" },
		});
		expect(homedir).not.toHaveBeenCalled();
	});

	it("reports exact Darwin support data without changing report semantics", async () => {
		const darwin = await doctorCodexPreToolUse(home, {
			manifest: manifest(),
			nodeProbe: STUB_NODE_PROBE,
			platform: "darwin",
		});
		const linux = await supportedDoctor(home, {
			manifest: manifest(),
			nodeProbe: STUB_NODE_PROBE,
			platform: "linux",
		});
		expect(darwin).toMatchObject({
			state: "unsupported-platform",
			platformSupport: {
				state: "unsupported-platform",
				refusalCode: "unsupported-platform",
				guidance: expect.stringContaining(
					"javi-forge supports Linux and Windows only.",
				),
			},
		});
		expect(darwin.healthy).toBe(false);
		expect("state" in linux).toBe(false);
		expect("report" in darwin).toBe(false);
	});
});

describe("public wrapper platform boundary", () => {
	it.each([
		(deps: Parameters<typeof installCodexPreToolUse>[1]) =>
			installCodexPreToolUse(undefined, deps),
		(deps: Parameters<typeof repairCodexPreToolUse>[2]) =>
			repairCodexPreToolUse(undefined, undefined, deps),
	])("refuses before lazy home on synthetic unsupported input", async (run) => {
		let homeRead = false;
		const result = await run({
			platform: "darwin",
			homeDirProvider: () => {
				homeRead = true;
				throw new Error("home touched");
			},
		});
		expect(result).toMatchObject({
			ok: false,
			errors: ["unsupported-platform"],
		});
		expect(homeRead).toBe(false);
	});
});

describe("Codex registration and trust evidence", () => {
	const handler = () => ({
		type: "command",
		command: expectedCodexCommand(REAL_ASSET),
		timeout: 30,
	});
	const foreign = { type: "command", command: "echo keep" };
	const group = (
		matcher: unknown = "Bash|apply_patch",
		timeout: unknown = 30,
	) => ({ matcher, hooks: [{ ...handler(), timeout }] });
	const seed = (groups: unknown[], config = "[features]\nhooks = true\n") => {
		fs.mkdirSync(codexDir(), { recursive: true });
		fs.writeFileSync(
			hooksFile(),
			JSON.stringify({ hooks: { PreToolUse: groups } }),
		);
		fs.writeFileSync(configFile(), config);
	};
	it.each([
		"*",
		"Read",
		"Bash",
		"",
		"[",
		null,
		7,
	])("never calls matcher %j managed-current", (matcher) => {
		expect(
			classifyCodexHooksJson(
				{ hooks: { PreToolUse: [group(matcher)] } },
				expectedCodexCommand(REAL_ASSET),
			).state,
		).not.toBe("managed-current");
	});
	it.each([
		null,
		0,
		-1,
		"30",
		31,
	])("requires the exact managed timeout rather than %j", (timeout) => {
		expect(
			classifyCodexHooksJson(
				{ hooks: { PreToolUse: [group("Bash|apply_patch", timeout)] } },
				expectedCodexCommand(REAL_ASSET),
			).state,
		).not.toBe("managed-current");
	});
	it("carries config coordinates across preceding foreign groups and handlers", () => {
		const value = {
			hooks: {
				PreToolUse: [
					{ matcher: "Read", hooks: [foreign] },
					{ matcher: "Bash|apply_patch", hooks: [foreign, handler()] },
				],
			},
		};
		expect(
			classifyCodexHooksJson(value, expectedCodexCommand(REAL_ASSET)),
		).toMatchObject({
			state: "managed-current",
			groupIndex: 1,
			handlerIndex: 1,
		});
	});
	it.each([
		"echo before && ",
		"after",
	])("does not own an embedded or suffixed command: %s", (part) => {
		const command =
			part === "after"
				? expectedCodexCommand(REAL_ASSET) + " && echo after"
				: part + expectedCodexCommand(REAL_ASSET);
		expect(
			classifyCodexHooksJson(
				{
					hooks: {
						PreToolUse: [
							{
								matcher: "Bash|apply_patch",
								hooks: [{ ...handler(), command }],
							},
						],
					},
				},
				expectedCodexCommand(REAL_ASSET),
			).state,
		).toBe("foreign");
	});
	it.each([
		"",
		'trusted_hash = ""',
		'trusted_hash = "arbitrary"',
	])("recorded field %j never proves runnable trust", async (hashLine) => {
		seed(
			[
				{ matcher: "Read", hooks: [foreign] },
				{ matcher: "Bash|apply_patch", hooks: [foreign, handler()] },
			],
			`[features]\nhooks = true\n[hooks.state."${hooksFile()}:pre_tool_use:1:1"]\n${hashLine}\n`,
		);
		const report = await supportedDoctor(home, {
			manifest: manifest(),
			nodeProbe: STUB_NODE_PROBE,
		});
		expect(report.trust.state).toBe("unknown");
		expect(report.healthy).toBe(false);
		expect(report.execution.status).toBe("inconclusive");
	});
	it.each([
		"0:0suffix",
		"0:00:extra",
	])("preserves colliding trust-key suffix %s", (suffix) => {
		const text = `[hooks.state."${hooksFile()}:pre_tool_use:${suffix}"]\ntrusted_hash = "foreign"\n`;
		expect(removeCodexTrustEntries(text, hooksFile())).toBe(text);
	});
	it.each([
		"echo keep",
		`node /foreign/prefix-${ASSET_NAME} --agent=codex`,
	])("preserves foreign handler %s when repair is safe", async (command) => {
		const foreign = { type: "command", command };
		const value = { hooks: { PreToolUse: [{ hooks: [foreign] }] } };
		expect(classifyCodexHooksJson(value, handler().command).state).toBe(
			"foreign",
		);
		const original = {
			matcher: "Bash|apply_patch",
			hooks: [
				foreign,
				{ ...handler(), command: `node /old/${ASSET_NAME} --agent=codex` },
			],
			description: "keep group metadata",
		};
		seed([original]);
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await runInstall(fake);
		expect(result.ok).toBe(true);
		const written = JSON.parse(fake.fileText(hooksFile()) as string).hooks
			.PreToolUse;
		expect(written).toEqual([{ ...original, hooks: [foreign, handler()] }]);
	});
	it.each([
		"install",
		"repair",
	] as const)("refuses %s before writes when a shared matcher would change", async (mode) => {
		seed(
			[{ matcher: "Read", hooks: [foreign, handler()] }],
			`[features]\nhooks = true\n[hooks.state."${hooksFile()}:pre_tool_use:0:0"]\ntrusted_hash = "foreign"\n`,
		);
		const before = [
			fs.readFileSync(hooksFile()),
			fs.readFileSync(configFile()),
		];
		const fake = makeFakeSecureFs();
		mirror(fake);
		const result = await _runCodex(
			home,
			mode,
			{ force: true },
			{ secureFs: fake, manifest: manifest(), nodeProbe: STUB_NODE_PROBE },
		);
		expect(result.ok).toBe(false);
		expect(result.changed).toEqual([]);
		expect(result.errors.join(" ")).toContain("matcher");
		expect([
			fs.readFileSync(hooksFile()),
			fs.readFileSync(configFile()),
		]).toEqual(before);
		expect([fake.fileText(hooksFile()), fake.fileText(configFile())]).toEqual(
			before.map((bytes) => bytes.toString()),
		);
	});
	it("leaves a canonical mixed registration and its recorded trust untouched", async () => {
		seed(
			[{ matcher: "Bash|apply_patch", hooks: [foreign, handler()] }],
			`[features]\nhooks = true\n[hooks.state."${hooksFile()}:pre_tool_use:0:1"]\ntrusted_hash = "unverified"\n`,
		);
		const fake = makeFakeSecureFs();
		mirror(fake);
		expect((await runInstall(fake)).changed).toEqual([]);
	});
});

describe("selective Codex command migration", () => {
	const owned = () => ({
		type: "command",
		command: "node /old/javi-forge-skillguard-pre-tool-use.mjs --agent=codex",
		timeout: 30,
		description: "keep owned metadata",
	});
	const foreign = (name: string) => ({
		type: "command",
		command: `echo ${name}`,
		timeout: 17,
	});
	const group = (hooks: unknown[]) => ({
		matcher: "Bash|apply_patch",
		hooks,
		description: "keep group metadata",
	});
	const seed = (groups: unknown[], config: string) => {
		const value = {
			metadata: { preserve: true },
			hooks: {
				PreToolUse: groups,
				PostToolUse: [group([foreign("other-event")])],
			},
		};
		fs.mkdirSync(codexDir(), { recursive: true });
		fs.writeFileSync(hooksFile(), JSON.stringify(value));
		fs.writeFileSync(configFile(), config);
		const fake = makeFakeSecureFs();
		mirror(fake);
		return { value, fake };
	};
	it.each([
		"before",
		"after",
		"first-sibling",
		"last-sibling",
	])("updates only the owned command at its original %s coordinates", async (layout) => {
		const ours = owned();
		const other = group([foreign("separate")]);
		const groups =
			layout === "before"
				? [group([ours]), other]
				: layout === "after"
					? [other, group([ours])]
					: [
							group(
								layout === "first-sibling"
									? [ours, foreign("sibling")]
									: [foreign("sibling"), ours],
							),
							other,
						];
		const groupIndex = layout === "after" ? 1 : 0;
		const handlerIndex = layout === "last-sibling" ? 1 : 0;
		const config = `# preserve formatting\r\n[features]\r\nhooks = true\r\n[hooks.state."${hooksFile()}:pre_tool_use:${groupIndex}:${handlerIndex}"]\r\nenabled = false\r\ntrusted_hash = "old-owned"\r\n[hooks.state."${hooksFile()}:pre_tool_use:9:7"]\r\ntrusted_hash = "foreign"\r\n[other]\r\nvalue = "opaque"\r\n`;
		const { value, fake } = seed(groups, config);
		const result = await runInstall(fake);
		expect(result.ok).toBe(true);
		expect(result.changed).toEqual([hooksFile()]);
		ours.command = expectedCodexCommand(REAL_ASSET);
		expect(JSON.parse(fake.fileText(hooksFile()) as string)).toEqual(value);
		expect(fake.fileText(configFile())).toBe(config);
		expect(fs.readFileSync(configFile(), "utf8")).toBe(config);
		expect(classifyCodexHooksJson(value, ours.command)).toMatchObject({
			state: "managed-current",
			groupIndex,
			handlerIndex,
		});
		fs.writeFileSync(hooksFile(), fake.fileText(hooksFile()) as string);
		const again = makeFakeSecureFs();
		mirror(again);
		const second = await runInstall(again);
		expect(second.ok).toBe(true);
		expect(second.changed).toEqual([]);
		expect(second.backups).toEqual([]);
		expect(again.fileText(configFile())).toBe(config);
	});
	it("preserves a disabled feature and never inserts trust", async () => {
		const config = "# disabled by user\n[features]\nhooks = false\n";
		const { fake } = seed([group([owned()])], config);
		const result = await runInstall(fake);
		if (!result.ok)
			throw new Error(`unexpected refusal: ${result.errors.join(", ")}`);
		expect(result.changed).toEqual([hooksFile()]);
		expect(fake.fileText(configFile())).toBe(config);
		expect(fake.fileText(configFile())).not.toContain("trusted_hash");
		expect(result.report.execution.blockers).toContain(
			"policy:features.hooks=false",
		);
	});
	it.each([
		"duplicate-groups",
		"duplicate-siblings",
		"shared-matcher",
		"owned-matcher",
		"owned-timeout",
		"null-group",
		"missing-handlers",
		"unknown-handler",
		"invalid-handler",
		"invalid-matcher",
		"ambiguous-features",
		"invalid-feature",
		"missing-feature",
		"unreadable-config",
		"initial-disabled",
		"initial-trust",
	])("refuses %s before any writes or backups", async (problem) => {
		let groups: unknown[] = [group([owned()])];
		let config = "[features]\nhooks = true\n";
		if (problem === "duplicate-groups") groups.push(group([owned()]));
		if (problem === "duplicate-siblings") groups = [group([owned(), owned()])];
		if (problem === "shared-matcher")
			groups = [{ ...group([foreign("keep"), owned()]), matcher: "Read" }];
		if (problem === "owned-matcher")
			groups = [{ ...group([owned()]), matcher: "*" }];
		if (problem === "owned-timeout")
			groups = [group([{ ...owned(), timeout: 20 }])];
		if (problem === "null-group") groups.push(null);
		if (problem === "missing-handlers") groups.push({ matcher: "Bash" });
		if (problem === "unknown-handler")
			groups.push(group([{ type: "unknown", command: "echo keep" }]));
		if (problem === "invalid-handler")
			groups.push(group([{ type: "command", command: 7 }]));
		if (problem === "invalid-matcher")
			groups.push({ ...group([foreign("keep")]), matcher: 7 });
		if (problem === "ambiguous-features")
			config += "[features]\nhooks = false\n";
		if (problem === "invalid-feature")
			config = "[features]\nhooks = true trailing-junk\n";
		if (problem === "missing-feature") config = "[model]\nname = 'untouched'\n";
		if (problem === "initial-disabled") {
			groups = [];
			config = "[features]\nhooks = false\n";
		}
		if (problem === "initial-trust") {
			groups = [];
			config += `[hooks.state."${hooksFile()}:pre_tool_use:0:0"]\ntrusted_hash = "retain"\n`;
		}
		const { fake } = seed(groups, config);
		if (problem === "unreadable-config") {
			fs.unlinkSync(configFile());
			fs.mkdirSync(configFile());
		}
		const files = new Map(
			[...fake.files].map(([name, file]) => [
				name,
				{ ...file, bytes: Buffer.from(file.bytes) },
			]),
		);
		const directories = [...fake.dirs];
		const write = vi.spyOn(fake, "writeExclusive");
		const result = await _runCodex(
			home,
			"repair",
			{ force: true },
			{ secureFs: fake, manifest: manifest(), nodeProbe: STUB_NODE_PROBE },
		);
		expect(result.ok).toBe(false);
		expect(result.errors.join(" ")).toContain("refuse");
		expect(result.changed).toEqual([]);
		expect(result.backups).toEqual([]);
		expect(write).not.toHaveBeenCalled();
		expect(fake.files).toEqual(files);
		expect([...fake.dirs]).toEqual(directories);
	});
});
