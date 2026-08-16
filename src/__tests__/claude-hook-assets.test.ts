// biome-ignore-all format: compact table-driven policy corpus keeps the security review slice bounded.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";

interface Decision { allowed: boolean; ruleId?: string }
interface Runtime {
	INPUT_LIMIT_BYTES: number;
	MANAGED_MARKER: string;
	POLICY_REGISTRY: { schemaVersion: number; policyVersion: number; diagnosticsMaxBytes: number };
	SUPPORTED_TOOLS: readonly string[];
	canonicalizePolicyPath(input: string, options?: { base?: string; platform?: string; projectRoot?: string }): string;
	isSensitivePolicyKey(input: string, platform?: string): boolean;
	evaluateEvent(input: unknown): Decision;
	parseAndEvaluateInput(input: Buffer): Decision;
}
const ASSET_NAME = "javi-forge-skillguard-pre-tool-use.mjs";
const ASSET = path.join(CLAUDE_HOOK_ASSETS_DIR, ASSET_NAME);
const ROOT = path.resolve(CLAUDE_HOOK_ASSETS_DIR, "../..");
// Decision ②: placeholder-normalized canonical hash of the exact managed matcher
// group. Bound here so a silent settings-identity rewrite fails this contract.
const SETTINGS_CANONICAL_SHA256 = "038c59a91bf8967f6908afed74c465f1e7030254e11e4f8738975d6d708424d4";
// R2 fleet-brick guard for the settings entry, mirroring hook-assets.test.ts:
// settingsEntries.historical[] MUST forever START WITH this released list.
const RELEASED_SETTINGS_SNAPSHOT = { current: SETTINGS_CANONICAL_SHA256, historical: [] as string[] };
// Append-only invariant: the manifest history must still start with the released
// list; when current moves, the outgoing hash must have been appended and grown.
function settingsHistoryViolations(released: { current: string; historical: string[] }, entry: { current: { canonicalSha256: string } | null; historical: { canonicalSha256: string }[] }): string[] {
	const violations: string[] = [];
	const hashes = entry.historical.map((h) => h.canonicalSha256);
	const prefixIntact = hashes.length >= released.historical.length && released.historical.every((h, i) => hashes[i] === h);
	if (!prefixIntact) violations.push("settingsEntries.historical[] no longer starts with the released list (append-only violated)");
	if (entry.current?.canonicalSha256 === released.current) return violations;
	if (!hashes.includes(released.current)) violations.push(`outgoing settings hash ${released.current} was not appended to historical[]`);
	if (hashes.length <= released.historical.length) violations.push(`settingsEntries.historical[] did not grow: ${released.historical.length} -> ${hashes.length}`);
	return violations;
}
const TOOLS = ["Bash", "PowerShell", "Read", "Write", "Edit"];
const event = (tool_name: string, tool_input: Record<string, unknown>): unknown => ({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: ROOT });
let runtime: Runtime;
let temp: string;
beforeAll(async () => {
	runtime = (await import(pathToFileURL(ASSET).href)) as Runtime;
	temp = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-hook-paths-"));
});
afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));
describe("packaged Claude PreToolUse asset contract", () => {
	it("binds the exact standalone runtime to its manifest", () => {
		const bytes = fs.readFileSync(ASSET);
		const source = bytes.toString("utf8");
		const manifest = JSON.parse(fs.readFileSync(path.join(CLAUDE_HOOK_ASSETS_DIR, "manifest.json"), "utf8"));
		expect(source.startsWith("// javi-forge-managed: claude-pretooluse v1\n")).toBe(true);
		expect(runtime.MANAGED_MARKER).toBe("// javi-forge-managed: claude-pretooluse v1");
		expect(runtime.SUPPORTED_TOOLS).toEqual(TOOLS);
		expect(runtime.INPUT_LIMIT_BYTES).toBe(1_048_576);
		expect(runtime.POLICY_REGISTRY).toEqual({ schemaVersion: 1, policyVersion: 1, diagnosticsMaxBytes: 240 });
		expect(manifest).toMatchObject({ schemaVersion: 1, asset: { name: ASSET_NAME, version: 1, policyVersion: 1, historical: [] }, settingsEntries: { current: { version: 1, canonicalSha256: SETTINGS_CANONICAL_SHA256 }, historical: [] }, installerHelpers: { windowsSecureObject: null } });
		expect(manifest.asset.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
		expect(source.match(/^import .+ from "(.+)";$/gm)?.every((line) => line.includes('"node:'))).toBe(true);
		expect(source).not.toMatch(/\b(?:fetch|https?:\/\/|require\s*\(|import\s*\()\b/);
	});
	it("keeps the settings-entry historical list append-only (R2 fleet-brick guard)", () => {
		const manifest = JSON.parse(fs.readFileSync(path.join(CLAUDE_HOOK_ASSETS_DIR, "manifest.json"), "utf8"));
		expect(manifest.settingsEntries.current.canonicalSha256).toBe(SETTINGS_CANONICAL_SHA256);
		expect(settingsHistoryViolations(RELEASED_SETTINGS_SNAPSHOT, manifest.settingsEntries)).toEqual([]);
	});
	it("settingsHistoryViolations flags a silently rewritten released hash", () => {
		expect(settingsHistoryViolations({ current: "a".repeat(64), historical: ["a".repeat(64)] }, { current: { canonicalSha256: "a".repeat(64) }, historical: [{ canonicalSha256: "b".repeat(64) }] })).toEqual(["settingsEntries.historical[] no longer starts with the released list (append-only violated)"]);
		expect(settingsHistoryViolations({ current: "a".repeat(64), historical: [] }, { current: { canonicalSha256: "b".repeat(64) }, historical: [{ canonicalSha256: "a".repeat(64) }, { canonicalSha256: "b".repeat(64) }] })).toEqual([]);
	});
	// biome-ignore format: compact security corpus keeps the review slice bounded.
	it.each([
		["future tool", event("WebFetch", { url: "https://example.test" })],
		["wrong event", { ...event("Read", { file_path: "/tmp/a" }) as object, hook_event_name: "PostToolUse" }],
		["missing input", { hook_event_name: "PreToolUse", tool_name: "Read" }],
		["wrong shell field", event("Bash", { file_path: "/tmp/a" })],
		["relative file", event("Write", { file_path: "relative.txt" })],
	])("rejects invalid schema: %s", (_name, input) => expect(() => runtime.evaluateEvent(input)).toThrow(/invalid-event/));
	it.each([Buffer.alloc(0), Buffer.from("null"), Buffer.from("[]"), Buffer.from("{")])("rejects malformed/non-object JSON", (input) => expect(() => runtime.parseAndEvaluateInput(input)).toThrow(/invalid-json/));
	it("accepts exactly 1 MiB and rejects the next byte", () => {
		const base = event("Read", { file_path: "/tmp/public.txt" }) as Record<string, unknown>;
		const prefix = Buffer.from(JSON.stringify({ ...base, padding: "" }));
		const exact = Buffer.from(JSON.stringify({ ...base, padding: "x".repeat(runtime.INPUT_LIMIT_BYTES - prefix.length) }));
		expect(exact).toHaveLength(runtime.INPUT_LIMIT_BYTES);
		expect(runtime.parseAndEvaluateInput(exact)).toEqual({ allowed: true });
		expect(() => runtime.parseAndEvaluateInput(Buffer.concat([exact, Buffer.from("x")]))).toThrow(/oversized-input/);
	});
});
describe("cross-platform file-tool policy", () => {
	// biome-ignore format: compact policy corpus keeps fixtures auditable together.
	it.each([
		["Read", "/repo/src/config.ts", true, undefined], ["Read", "/repo/.env", false, "path.sensitive"],
		["Read", "/repo/.env.example", true, undefined], ["Write", path.join(ROOT, "src/result.ts"), true, undefined],
		["Write", path.join(ROOT, ".claude/settings.json"), false, "path.managed-config"], ["Edit", "/home/me/.aws/credentials", false, "path.sensitive"],
		["Edit", path.join(ROOT, ".javi-forge/ci.yaml"), false, "path.managed-config"],
	])("evaluates %s path %s", (tool, file_path, allowed, ruleId) => expect(runtime.evaluateEvent(event(tool, { file_path }))).toEqual({ allowed, ...(ruleId ? { ruleId } : {}) }));
	it("ignores Write content", () => expect(runtime.evaluateEvent(event("Write", { file_path: "/tmp/out", content: "rm -rf /" }))).toEqual({ allowed: true }));
	// biome-ignore format: aliases are intentionally side-by-side.
	it.each([
		["C:\\Users\\me\\.ssh\\id", "c:/users/me/.ssh/id"], ["\\\\?\\C:\\Users\\me\\.ssh\\id", "c:/users/me/.ssh/id"],
		["\\??\\C:\\Users\\me\\.ssh\\id", "c:/users/me/.ssh/id"], ["\\\\.\\C:\\Users\\me\\.ssh\\id", "c:/users/me/.ssh/id"],
		["\\\\?\\UNC\\server\\share\\.env", "//server/share/.env"],
	])("normalizes Windows alias %s", (input, expected) => {
		expect(runtime.canonicalizePolicyPath(input, { platform: "win32" })).toBe(expected);
		expect(runtime.evaluateEvent(event("Read", { file_path: input }))).toEqual({ allowed: false, ruleId: "path.sensitive" });
	});
	it("rejects unsupported Windows devices", () => expect(() => runtime.canonicalizePolicyPath("\\\\?\\GLOBALROOT\\Device\\Disk", { platform: "win32" })).toThrow(/unsupported-device-path/));
	it("normalizes Darwin aliases", () => expect(runtime.canonicalizePolicyPath("/Users/ME/.GNUPG/e\u0301", { platform: "darwin" })).toBe("/users/me/.gnupg/é"));
	it("realpaths the nearest existing ancestor", () => {
		fs.mkdirSync(path.join(temp, "real"));
		fs.symlinkSync(path.join(temp, "real"), path.join(temp, "alias"), "dir");
		expect(runtime.canonicalizePolicyPath(path.join(temp, "alias/new/file"))).toBe(`${runtime.canonicalizePolicyPath(path.join(temp, "real"))}/new/file`);
	});
	it("JD-S1-004 preserves lexical and realpath policy identities for every file tool", () => {
		const lexicalProtected = path.join(temp, ".ssh");
		const realProtected = path.join(temp, "real-protected", ".ssh");
		fs.mkdirSync(realProtected, { recursive: true });
		fs.symlinkSync(path.join(temp, "real"), lexicalProtected, "dir");
		fs.symlinkSync(realProtected, path.join(temp, "alias-protected"), "dir");
		for (const tool of ["Read", "Write", "Edit"]) {
			expect(runtime.evaluateEvent(event(tool, { file_path: path.join(lexicalProtected, "id") }))).toEqual({ allowed: false, ruleId: "path.sensitive" });
			expect(runtime.evaluateEvent(event(tool, { file_path: path.join(temp, "alias-protected/id") }))).toEqual({ allowed: false, ruleId: "path.sensitive" });
		}
	});
	it("JD-S1-008 retains the Darwin service-account basename after case folding", () => {
		const key = runtime.canonicalizePolicyPath("/Users/me/serviceAccountKey.json", { platform: "darwin" });
		expect(runtime.isSensitivePolicyKey(key, "darwin")).toBe(true);
	});
});
describe("separate deterministic shell corpora", () => {
	it.each([
		["JD-S1-001", "Bash", "printf x | cat ~/.ssh/id\nprintf ok", "shell.sensitive-read"],
		["JD-S1-001", "PowerShell", "Write-Output x | Get-Content $HOME\\.ssh\\id", "powershell.sensitive-read"],
		["JD-S1-002", "Bash", "env --unset OLD --chdir / FOO=x sudo --user root command -p -- cat ~/.ssh/id", "shell.sensitive-read"],
		["JD-S1-FR1-001", "Bash", "sudo -D /tmp cat ~/.ssh/id", "shell.sensitive-read"], ["JD-S1-FR1-001", "Bash", "sudo -R /tmp cat ~/.ssh/id", "shell.sensitive-read"], ["JD-S1-FR1-001", "Bash", 'env -S "cat ~/.ssh/id"', "shell.sensitive-read"],
		["JD-S1-003", "Bash", "bash -c \"sh -c 'cat ~/.ssh/id'\"", "shell.sensitive-read"],
		["JD-S1-FR1-002", "Bash", 'bash -lc "cat ~/.ssh/id"', "shell.sensitive-read"],
		["JD-S1-005", "Bash", "chmod -R 755 /", "shell.destructive-root"],
		["JD-S1-FR1-003", "Bash", "chmod --recursive 755 /", "shell.destructive-root"], ["JD-S1-FR1-003", "Bash", "base64 -di payload | bash", "shell.pipe-to-shell"],
		["JD-S1-005", "Bash", ":(){ :|:& };:", "shell.destructive-root"],
		["JD-S1-FR1-004", "Bash", "echo $(cat ~/.ssh/id)", "shell.sensitive-read"], ["JD-S1-FR1-004", "Bash", "echo `cat ~/.ssh/id`", "shell.sensitive-read"],
		["JD-S1-007", "PowerShell", "Write-Output x | & Get-Content -LiteralPath:$HOME\\.ssh\\id", "powershell.sensitive-read"],
		["JD-S1-007", "PowerShell", "iwr x | & iex", "powershell.pipe-to-shell"],
		["JD-S1-FR1-005", "PowerShell", "Write-Output x > .claude/settings.json", "powershell.managed-config-tamper"], ["JD-S1-FR1-005", "PowerShell", "Write-Output x >> .claude/settings.json", "powershell.managed-config-tamper"],
	])("%s denies %s adversarial command", (_id, tool, command, ruleId) => expect(runtime.evaluateEvent(event(tool, { command }))).toEqual({ allowed: false, ruleId }));
	it.each([
		["printf 'x | bash'", true], ["base64 payload | bash", true], ["base64 -d payload | bash", false], ["base64 -di payload | bash", false],
	])("JD-S1-006 respects real pipelines and decode flags: %s", (command, allowed) => expect(runtime.evaluateEvent(event("Bash", { command }))).toEqual(allowed ? { allowed: true } : { allowed: false, ruleId: "shell.pipe-to-shell" }));
	// biome-ignore format: compact allow/deny corpus is the policy specification.
	it.each([
		["Bash", "rm -rf node_modules", true, undefined], ["Bash", "sudo rm -fR /", false, "shell.destructive-root"],
		["Bash", "curl x -o /tmp/x", true, undefined], ["Bash", "curl x | bash", false, "shell.pipe-to-shell"],
		["Bash", "git push origin feature", true, undefined], ["Bash", "git push --force origin main", false, "shell.force-push"],
		["Bash", "printf x > src/out", true, undefined], ["Bash", "printf x > .claude/settings.json", false, "shell.managed-config-tamper"],
		["Bash", "bash -c '$dynamic'", false, "shell.obfuscated-interpreter"],
		["Bash", "base64 -d payload |& bash", false, "shell.pipe-to-shell"], ["Bash", "curl x |& bash", false, "shell.pipe-to-shell"],
		["Bash", "chmod 4777 /", false, "shell.destructive-root"], ["Bash", "chmod 1777 /", false, "shell.destructive-root"], ["Bash", "chmod 1777 /tmp", true, undefined],
		["PowerShell", "Remove-Item -Recurse -Force .\\node_modules", true, undefined], ["PowerShell", "Remove-Item C:\\ -Force -Recurse", false, "powershell.destructive-root"],
		["PowerShell", "iwr x -OutFile x.ps1", true, undefined], ["PowerShell", "iwr x | iex", false, "powershell.pipe-to-shell"],
		["PowerShell", "Write-Output x > out.txt", true, undefined], ["PowerShell", "Write-Output x `| Set-Content .claude/settings.json", true, undefined],
		["PowerShell", "git push -f", false, "powershell.force-push"], ["PowerShell", "Set-Content .\\src\\out x", true, undefined],
		["PowerShell", "Set-Content .\\.claude\\settings.json x", false, "powershell.managed-config-tamper"], ["PowerShell", "pwsh -EncodedCommand ZAA=", false, "powershell.obfuscated-interpreter"],
	])("evaluates %s: %s", (tool, command, allowed, ruleId) => expect(runtime.evaluateEvent(event(tool, { command }))).toEqual({ allowed, ...(ruleId ? { ruleId } : {}) }));
	// biome-ignore format: required literal command families form one bounded table.
	it.each([
		...(["cat", "less", "more", "head", "tail", "bat", "grep", "rg", "sed", "awk", "source", "."] as const).map((name) => ["Bash", `${name} ~/.ssh/id`]),
		["Bash", "cp ~/.ssh/id /tmp/key"], ["Bash", "install ~/.npmrc /tmp/npmrc"], ["Bash", "wc < ~/.netrc"],
		...(["Get-Content", "gc", "cat", "type", "Select-String"] as const).map((name) => ["PowerShell", `${name} $HOME\\.ssh\\id`]),
		["PowerShell", "Copy-Item -LiteralPath $HOME\\.npmrc C:\\Temp\\x"], ["PowerShell", "cp $HOME\\.ssh\\id C:\\Temp\\x"], ["PowerShell", "copy $HOME\\.netrc C:\\Temp\\x"],
	])("denies %s sensitive family: %s", (tool, command) => expect(runtime.evaluateEvent(event(tool, { command }))).toEqual({ allowed: false, ruleId: tool === "Bash" ? "shell.sensitive-read" : "powershell.sensitive-read" }));
});
type SemanticStatus = "accepted-safe" | "accepted-dangerous" | "rejected-by-profile" | "unsupported";
interface SemanticResult { status: SemanticStatus; applicability: { profileId: string; utility: string; mode: string; applicable: boolean }; facts?: Record<string, unknown>; reasonCode?: string; partialRoles?: Record<string, unknown>; evidence?: { code: string; phase: string } }
interface SemanticRuntime extends Runtime {
	UTILITY_PROFILE_REGISTRY: readonly { id: string; utility: string; mode: string; source: { publisher: string; artifact: string; version: string; section: string; sourceReference: string }; longOptions: readonly { name: string }[]; shortOptions: Readonly<Record<string, unknown>> }[];
	normalizeEnvInvocation(tokens: string[]): SemanticResult[];
	normalizeChmodInvocation(tokens: string[]): SemanticResult[];
	normalizeBase64Invocation(tokens: string[]): SemanticResult[];
	reduceProfileUnion(results: SemanticResult[]): { classification: string; utility: string; results: SemanticResult[]; acceptedFacts: readonly unknown[] };
}
const semantic = (): SemanticRuntime => runtime as unknown as SemanticRuntime;
describe("utility profile registry governance (S48,S50)", () => {
	it("binds exactly seven versioned GNU/Apple profiles in fixed registry order", () => {
		const registry = semantic().UTILITY_PROFILE_REGISTRY;
		expect(registry.map((profile) => profile.id)).toEqual(["gnu-env-v1", "gnu-chmod-default-v1", "gnu-chmod-posix-v1", "apple-chmod-v1", "gnu-base64-default-v1", "gnu-base64-posix-v1", "apple-base64-v1"]);
		expect(registry.map((profile) => [profile.utility, profile.mode])).toEqual([["env", "default"], ["chmod", "default"], ["chmod", "posixly-correct"], ["chmod", "apple"], ["base64", "default"], ["base64", "posixly-correct"], ["base64", "apple"]]);
		expect(Object.isFrozen(registry)).toBe(true);
		expect(registry.every((profile) => Object.isFrozen(profile) && Object.isFrozen(profile.source) && Object.isFrozen(profile.longOptions) && Object.isFrozen(profile.shortOptions))).toBe(true);
	});
	it.each([
		["gnu-env-v1", "GNU", "GNU Coreutils manual (doc/coreutils.texi)", "Coreutils 9.4", "env invocation"], ["gnu-chmod-default-v1", "GNU", "GNU Coreutils manual (doc/coreutils.texi)", "Coreutils 9.4", "chmod invocation"],
		["gnu-chmod-posix-v1", "GNU", "GNU Coreutils manual (doc/coreutils.texi)", "Coreutils 9.4", "chmod invocation"], ["apple-chmod-v1", "Apple", "chmod(1)", "2017-01-07", "SYNOPSIS"],
		["gnu-base64-default-v1", "GNU", "GNU Coreutils manual (doc/coreutils.texi)", "Coreutils 9.4", "base64 invocation"], ["gnu-base64-posix-v1", "GNU", "GNU Coreutils manual (doc/coreutils.texi)", "Coreutils 9.4", "base64 invocation"],
		["apple-base64-v1", "Apple", "bintrans(1)", "2022-04-18", "base64"],
	])("binds %s to its immutable documented source", (id, publisher, artifact, version, section) => {
		const profile = semantic().UTILITY_PROFILE_REGISTRY.find((entry) => entry.id === id);
		expect(profile?.source).toMatchObject({ publisher, artifact, version });
		expect(profile?.source.section).toContain(section);
		expect(profile?.source.sourceReference.length).toBeGreaterThan(0);
	});
	it.each([
		["gnu-env-v1", ["argv0", "chdir", "debug", "help", "ignore-environment", "null", "split-string", "unset", "version"], ["0", "C", "S", "a", "i", "u", "v"]],
		["gnu-chmod-default-v1", ["changes", "help", "no-preserve-root", "preserve-root", "quiet", "recursive", "reference", "silent", "verbose", "version"], ["R", "c", "f", "v"]],
		["apple-chmod-v1", [], ["C", "E", "H", "I", "L", "N", "P", "R", "f", "h", "i", "v"]],
		["gnu-base64-default-v1", ["decode", "help", "ignore-garbage", "version", "wrap"], ["d", "i", "w"]],
		["apple-base64-v1", ["break", "decode", "help", "ignore-garbage", "input", "output", "wrap"], ["D", "b", "d", "h", "i", "o", "w"]],
	])("commits the complete %s option table", (id, longNames, shortNames) => {
		const profile = semantic().UTILITY_PROFILE_REGISTRY.find((entry) => entry.id === id);
		expect(profile?.longOptions.map((option) => option.name)).toEqual(longNames);
		expect(Object.keys(profile?.shortOptions ?? {}).sort()).toEqual(shortNames);
	});
});
describe("env profile semantics (L1/L3: S01,S02,S13-S22)", () => {
	const env = (tokens: string[]): SemanticResult[] => semantic().normalizeEnvInvocation(tokens);
	it.each([["-iS", "i"], ["-vS", "v"]])("S13/S14 bundled %s records the boolean, the split input, and the eventual argv", (bundle, flag) => {
		const [result] = env(["env", bundle, String.raw`cat\_~/.ssh/id`]);
		expect(result).toMatchObject({ status: "accepted-safe", applicability: { profileId: "gnu-env-v1", utility: "env", mode: "default" }, facts: { wrapperOptions: [flag], eventualExecutable: "cat", eventualArgv: ["~/.ssh/id"], assignments: [], activeExpansion: false, terminatedByControlEscape: false, delimiter: { seen: false } } });
		expect(result.facts?.splitInput).toMatchObject({ option: "split-string", source: "next-token", role: "split-string", value: String.raw`cat\_~/.ssh/id` });
	});
	it.each([
		[["env", "--split-str", String.raw`cat\_~/.ssh/id`], "next-token"], [["env", `--split-str=${String.raw`cat\_~/.ssh/id`}`], "attached"], [["env", "--split-string", String.raw`cat\_~/.ssh/id`], "next-token"],
	])("S15 unique split-string abbreviations normalize to the canonical option %#", (tokens, source) => {
		const [result] = env(tokens);
		expect(result).toMatchObject({ status: "accepted-safe", facts: { eventualExecutable: "cat", eventualArgv: ["~/.ssh/id"] } });
		expect(result.facts?.splitInput).toMatchObject({ option: "split-string", source });
	});
	it("S16 active ${VARNAME} returns unsupported expansion evidence and is never evaluated", () => {
		expect(env(["env", "-S", "${READER}\\_~/.ssh/id"])).toEqual([expect.objectContaining({ status: "unsupported", applicability: expect.objectContaining({ profileId: "gnu-env-v1" }), evidence: expect.objectContaining({ code: "env-active-expansion", phase: "split" }) })]);
	});
	it("S17 an escaped dollar stays literal and raises no expansion ambiguity", () => {
		const [result] = env(["env", "-S", String.raw`printf\_\${HOME}`]);
		expect(result).toMatchObject({ status: "accepted-safe", facts: { eventualExecutable: "printf", eventualArgv: ["${HOME}"], activeExpansion: false } });
	});
	it(String.raw`S18 \c stops the split string and preserves trailing argv`, () => {
		const [result] = env(["env", "-S", String.raw`cat\c`, "~/.ssh/id"]);
		expect(result).toMatchObject({ status: "accepted-safe", facts: { eventualExecutable: "cat", eventualArgv: ["~/.ssh/id"], terminatedByControlEscape: true } });
	});
	it("S19 split output preserves the command -- wrapper for reduction", () => {
		const [result] = env(["env", "-S", String.raw`command -- cat\_~/.ssh/id`]);
		expect(result).toMatchObject({ status: "accepted-safe", facts: { eventualExecutable: "command", eventualArgv: ["--", "cat", "~/.ssh/id"] } });
	});
	it("S20 a split-generated pipe is literal argv data", () => {
		const [result] = env(["env", "-S", String.raw`printf\_x|bash`]);
		expect(result).toMatchObject({ status: "accepted-safe", facts: { eventualExecutable: "printf", eventualArgv: ["x|bash"] } });
	});
	it("S21 an unsupported split escape returns fixed unsupported evidence", () => {
		expect(env(["env", "-S", String.raw`printf\q`])).toEqual([expect.objectContaining({ status: "unsupported", evidence: expect.objectContaining({ code: "env-unsupported-escape", phase: "split" }) })]);
	});
	it("JD-DES-005 the cumulative split-work bound stops runaway -S chains", () => {
		expect(env(["env", ...Array.from({ length: 33 }, () => "-S"), "printf ok"])).toEqual([expect.objectContaining({ status: "unsupported", evidence: expect.objectContaining({ code: "split-work-limit", phase: "split" }) })]);
	});
	it("S01 a consumed option argument is never rescanned as an option", () => {
		const [result] = env(["env", "-u", "-S", "cat", "~/.ssh/id"]);
		expect(result).toMatchObject({ status: "accepted-safe", facts: { eventualExecutable: "cat", eventualArgv: ["~/.ssh/id"] } });
		expect(result.facts?.consumedArguments).toEqual([expect.objectContaining({ option: "u", source: "next-token", value: "-S" })]);
		expect(result.facts?.splitInput).toBeUndefined();
	});
	it("S02 the delimiter terminates the option pass and demotes dash tokens", () => {
		const [result] = env(["env", "--", "-S", "x"]);
		expect(result).toMatchObject({ status: "accepted-safe", facts: { delimiter: { seen: true }, eventualExecutable: "-S", eventualArgv: ["x"] } });
	});
	it.each([[["env"]], [["env", "-i"]], [["env", "NAME=VALUE"]]])("JD-DES-008 commandless %j is a proven accepted-safe terminal, never wrapper ambiguity", (tokens) => {
		expect(env(tokens)).toEqual([expect.objectContaining({ status: "accepted-safe", facts: expect.objectContaining({ eventualExecutable: null, eventualArgv: [] }) })]);
	});
});
describe("chmod profile semantics (L1/L3: S01-S03,S23-S30)", () => {
	const chmod = (tokens: string[]): SemanticResult[] => semantic().normalizeChmodInvocation(tokens);
	it("S23 GNU default permutes a recursive option after mode and target while POSIX stops", () => {
		const [gnu, posix, apple] = chmod(["chmod", "755", "/", "--recursive"]);
		expect(gnu).toMatchObject({ status: "accepted-dangerous", applicability: { profileId: "gnu-chmod-default-v1" }, facts: { recursive: true, mode777: false, roles: { mode: "755", targets: ["/"] } } });
		expect(posix).toMatchObject({ status: "accepted-safe", applicability: { profileId: "gnu-chmod-posix-v1" }, facts: { recursive: false } });
		expect(apple).toMatchObject({ status: "rejected-by-profile", applicability: { profileId: "apple-chmod-v1" } });
	});
	it.each(["rec", "recu", "recur", "recurs", "recursi", "recursiv", "recursive"])("S25 GNU unique abbreviation --%s is recursive", (prefix) => {
		expect(chmod(["chmod", `--${prefix}`, "755", "/"])[0]).toMatchObject({ status: "accepted-dangerous", facts: { recursive: true } });
	});
	it("S25 ambiguous --r is rejected by both GNU modes", () => {
		const [gnu, posix] = chmod(["chmod", "--r", "755", "/"]);
		expect(gnu).toMatchObject({ status: "rejected-by-profile", reasonCode: "ambiguous-long-option" });
		expect(posix).toMatchObject({ status: "rejected-by-profile", reasonCode: "ambiguous-long-option" });
	});
	it.each(["-vR", "-Rv"])("S26 bundle order %s preserves recursion", (bundle) => {
		expect(chmod(["chmod", bundle, "755", "/"])[0]).toMatchObject({ status: "accepted-dangerous", facts: { recursive: true } });
	});
	it("S24 a reference argument is never a target and later options still permute", () => {
		const [gnu] = chmod(["chmod", "--reference=/tmp/ref", "/", "--recursive"]);
		expect(gnu).toMatchObject({ status: "accepted-dangerous", facts: { recursive: true, roles: { reference: "/tmp/ref", targets: ["/"] } } });
		expect(gnu.facts?.consumedArguments).toEqual([expect.objectContaining({ option: "reference", source: "attached", role: "reference", value: "/tmp/ref" })]);
	});
	it("S03/JD-DES-001 a mixed literal mode and reference is rejected with complete partial roles", () => {
		const [gnu, posix, apple] = chmod(["chmod", "--reference=/tmp/ref", "777", "/"]);
		expect(gnu).toMatchObject({ status: "rejected-by-profile", reasonCode: "mixed-mode-reference", partialRoles: { mode: "777", reference: "/tmp/ref", targets: ["/"] } });
		expect(posix).toMatchObject({ status: "rejected-by-profile", reasonCode: "mixed-mode-reference", partialRoles: { mode: "777", reference: "/tmp/ref", targets: ["/"] } });
		expect(apple).toMatchObject({ status: "rejected-by-profile" });
	});
	it("S27 a root used solely as the reference input is non-target evidence", () => {
		const [gnu] = chmod(["chmod", "-R", "--reference=/", "/tmp/safe"]);
		expect(gnu).toMatchObject({ status: "accepted-safe", facts: { recursive: true, roles: { reference: "/", targets: ["/tmp/safe"] } } });
	});
	it("S29 mode 777 alone is dangerous on a critical target and the delimiter is recorded", () => {
		const [gnu] = chmod(["chmod", "777", "--", "/"]);
		expect(gnu).toMatchObject({ status: "accepted-dangerous", facts: { mode777: true, recursive: false, delimiter: { seen: true }, roles: { mode: "777", targets: ["/"] } } });
	});
	it("S28 a non-dangerous mode after the delimiter is a benign near miss", () => {
		const [gnu] = chmod(["chmod", "755", "--", "/"]);
		expect(gnu).toMatchObject({ status: "accepted-safe", facts: { mode777: false, recursive: false, delimiter: { seen: true } } });
	});
	it("S30 the Apple profile accepts its own bundle and rejects the GNU long family and delimiter", () => {
		expect(chmod(["chmod", "-R", "777", "/"])[2]).toMatchObject({ status: "accepted-dangerous", facts: { recursive: true, mode777: true } });
		expect(chmod(["chmod", "--recursive", "755", "/"])[2]).toMatchObject({ status: "rejected-by-profile" });
		expect(chmod(["chmod", "777", "--", "/"])[2]).toMatchObject({ status: "rejected-by-profile" });
	});
	it("S01 a reference value shaped like a mode never sets mode semantics", () => {
		const [gnu] = chmod(["chmod", "--reference", "777", "/"]);
		expect(gnu).toMatchObject({ status: "accepted-safe", facts: { mode777: false, recursive: false, roles: { reference: "777", targets: ["/"] } } });
	});
});
describe("base64 profile semantics (L1/L3: S01,S02,S31-S37)", () => {
	const base64 = (tokens: string[]): SemanticResult[] => semantic().normalizeBase64Invocation(tokens);
	it("S31 the GNU -id bundle is boolean -i plus decode -d while Apple -i consumes d", () => {
		const [gnu, , apple] = base64(["base64", "-id", "payload"]);
		expect(gnu).toMatchObject({ status: "accepted-safe", applicability: { profileId: "gnu-base64-default-v1" }, facts: { decode: true, booleanOptions: ["i"], operands: ["payload"] } });
		expect(apple).toMatchObject({ status: "accepted-safe", facts: { decode: false } });
		expect(apple.facts?.consumedArguments).toEqual([expect.objectContaining({ option: "i", source: "attached", value: "d" })]);
	});
	it("S32 separated GNU -i never consumes the -d token while Apple -i does", () => {
		const [gnu, , apple] = base64(["base64", "-i", "-d", "payload"]);
		expect(gnu).toMatchObject({ status: "accepted-safe", facts: { decode: true } });
		expect(apple).toMatchObject({ status: "accepted-safe", facts: { decode: false } });
		expect(apple.facts?.consumedArguments).toEqual([expect.objectContaining({ option: "i", source: "next-token", value: "-d" })]);
	});
	it("S33 the Apple -Di bundle decodes and consumes the input argument", () => {
		const [gnu, , apple] = base64(["base64", "-Di", "input"]);
		expect(apple).toMatchObject({ status: "accepted-safe", facts: { decode: true, booleanOptions: ["D"] } });
		expect(apple.facts?.consumedArguments).toEqual([expect.objectContaining({ option: "i", source: "next-token", value: "input" })]);
		expect(gnu).toMatchObject({ status: "rejected-by-profile" });
	});
	it("S01 the argument-taking -w consumes the bundle remainder without activating decode", () => {
		expect(base64(["base64", "-wid", "payload"])[0]).toMatchObject({ status: "accepted-safe", facts: { decode: false, consumedArguments: [{ option: "w", source: "attached", value: "id" }] } });
	});
	it.each(["--d", "--de", "--dec", "--deco", "--decod", "--decode"])("S34 GNU decode abbreviation %s is accepted", (option) => {
		expect(base64(["base64", option, "payload"])[0]).toMatchObject({ status: "accepted-safe", facts: { decode: true } });
	});
	it.each(["--d", "--de", "--dec", "--deco", "--decod"])("S34 Apple infers no GNU abbreviation %s", (option) => {
		expect(base64(["base64", option, "payload"])[2]).toMatchObject({ status: "rejected-by-profile" });
	});
	it("S35 GNU default permutes -d after an operand while POSIX stops", () => {
		const [gnu, posix] = base64(["base64", "payload", "-d"]);
		expect(gnu).toMatchObject({ status: "accepted-safe", facts: { decode: true } });
		expect(posix).toMatchObject({ status: "accepted-safe", facts: { decode: false, operands: ["payload", "-d"] } });
	});
	it("S36 Apple option arguments containing d never activate decode", () => {
		const [gnu, , apple] = base64(["base64", "-i", "input", "-o", "output", "-b", "76"]);
		expect(apple).toMatchObject({ status: "accepted-safe", facts: { decode: false } });
		expect(apple.facts?.consumedArguments).toEqual([expect.objectContaining({ option: "i", value: "input" }), expect.objectContaining({ option: "o", value: "output" }), expect.objectContaining({ option: "b", value: "76" })]);
		expect(gnu).toMatchObject({ status: "rejected-by-profile" });
	});
	it("S37 the delimiter demotes -d to an operand under GNU and is rejected by Apple", () => {
		const [gnu, , apple] = base64(["base64", "--", "-d"]);
		expect(gnu).toMatchObject({ status: "accepted-safe", facts: { decode: false, delimiter: { seen: true }, operands: ["-d"] } });
		expect(apple).toMatchObject({ status: "rejected-by-profile" });
	});
});
describe("literal identity and profile union (L1: S04-S07,S41-S44)", () => {
	it("S41-S43 path-qualified basenames normalize to the same literal identity", () => {
		expect(semantic().normalizeEnvInvocation(["/usr/bin/env", "-iS", String.raw`cat\_~/.ssh/id`])[0]).toMatchObject({ status: "accepted-safe", facts: { eventualExecutable: "cat", eventualArgv: ["~/.ssh/id"] } });
		expect(semantic().normalizeChmodInvocation(["/bin/chmod", "-R", "755", "/"])[0]).toMatchObject({ status: "accepted-dangerous", facts: { recursive: true } });
		expect(semantic().normalizeBase64Invocation(["/usr/bin/base64", "-id", "payload"])[0]).toMatchObject({ status: "accepted-safe", facts: { decode: true } });
	});
	it("S44 dynamic or foreign identities return unsupported identity evidence", () => {
		expect(semantic().normalizeEnvInvocation(["$ENV_BIN", "-S", "x"])).toEqual([expect.objectContaining({ status: "unsupported", evidence: expect.objectContaining({ code: "non-literal-identity", phase: "identity" }) })]);
		expect(semantic().normalizeChmodInvocation(["busybox", "-R", "755", "/"])).toEqual([expect.objectContaining({ status: "unsupported", evidence: expect.objectContaining({ code: "unsupported-utility", phase: "identity" }) })]);
	});
	const gnuDefault = { profileId: "gnu-chmod-default-v1", utility: "chmod", mode: "default", applicable: true };
	const gnuPosix = { profileId: "gnu-chmod-posix-v1", utility: "chmod", mode: "posixly-correct", applicable: true };
	const appleProfile = { profileId: "apple-chmod-v1", utility: "chmod", mode: "apple", applicable: true };
	const accepted = (status: "accepted-safe" | "accepted-dangerous", applicability = gnuDefault): SemanticResult => ({ status, applicability, facts: {} });
	const rejected = (applicability = appleProfile): SemanticResult => ({ status: "rejected-by-profile", applicability, reasonCode: "long-options-unsupported" });
	const unsupported = (applicability = appleProfile): SemanticResult => ({ status: "unsupported", applicability, evidence: { code: "test", phase: "option" } });
	it("S04 an accepted-dangerous profile dominates every other status", () => {
		const union = semantic().reduceProfileUnion([accepted("accepted-safe"), accepted("accepted-dangerous", gnuPosix), rejected(), unsupported()]);
		expect(union).toMatchObject({ classification: "dangerous", utility: "chmod" });
		expect(union.acceptedFacts).toHaveLength(2);
	});
	it("S05 an accepted-safe profile is not invalidated by rejection or unsupported attempts", () => {
		expect(semantic().reduceProfileUnion([accepted("accepted-safe"), rejected(), unsupported()])).toMatchObject({ classification: "safe", utility: "chmod" });
	});
	it("S06/S07 an all-rejected or all-unsupported union is unsupported, never safe", () => {
		expect(semantic().reduceProfileUnion([rejected(gnuDefault), rejected(gnuPosix), rejected()])).toMatchObject({ classification: "unsupported" });
		expect(semantic().reduceProfileUnion([unsupported(gnuDefault), rejected()])).toMatchObject({ classification: "unsupported" });
	});
});
describe("utility redesign L2 policy decisions", () => {
	it.each([
		["S13", String.raw`env -iS 'cat\_~/.ssh/id'`, "shell.sensitive-read"], ["S14", String.raw`env -vS 'cat\_~/.ssh/id'`, "shell.sensitive-read"],
		["S15", String.raw`env --split-str='cat\_~/.ssh/id'`, "shell.sensitive-read"], ["S18", String.raw`env -S 'cat\c' ~/.ssh/id`, "shell.sensitive-read"],
		["S19", String.raw`env -S 'command -- cat\_~/.ssh/id'`, "shell.sensitive-read"], ["JD-DES-005", String.raw`env -S "-S\_'cat\_~/.ssh/id'"`, "shell.sensitive-read"],
		["S41", String.raw`/usr/bin/env -iS 'cat\_~/.ssh/id'`, "shell.sensitive-read"], ["S23", "chmod 755 / --recursive", "shell.destructive-root"],
		["S24", "chmod --reference=/tmp/ref / --recursive", "shell.destructive-root"], ["S29", "chmod 777 -- /", "shell.destructive-root"],
		["S30", "chmod --recursive 755 /", "shell.destructive-root"], ["JD-R1-001 mode-first", "chmod 777 --reference=/tmp/ref /", "shell.destructive-root"],
		["S42", "/bin/chmod -R 755 /", "shell.destructive-root"], ["S31", "base64 -id payload | bash", "shell.pipe-to-shell"],
		["S32", "base64 -i -d payload | bash", "shell.pipe-to-shell"], ["S33", "base64 -Di input | bash", "shell.pipe-to-shell"],
		["S35", "base64 payload -d | bash", "shell.pipe-to-shell"], ["S43", "/usr/bin/base64 -id payload | bash", "shell.pipe-to-shell"],
	])("%s denies through the inherited or wrapper policy: %s", (_id, command, ruleId) => expect(runtime.evaluateEvent(event("Bash", { command }))).toEqual({ allowed: false, ruleId }));
	it.each([
		["S16", "READER=cat env -S '${READER}\\_~/.ssh/id'"], ["S21", String.raw`env -S 'printf\q'`],
		["S09/JD-R1-001 reference-first", "chmod --reference=/tmp/ref 777 /"], ["S12", "base64 --bogus payload | bash"],
	])("%s denies as bounded utility ambiguity", (_id, command) => expect(runtime.evaluateEvent(event("Bash", { command }))).toEqual({ allowed: false, ruleId: "utility-ambiguity" }));
	it.each([
		["S20", String.raw`env -S 'printf\_x|bash'`], ["S44", "$READER ~/.ssh/id"], ["JD-DES-008 bare env", "env"], ["JD-DES-008 env -i", "env -i"], ["JD-DES-008 env assignment", "env NAME=VALUE"],
		["S27", "chmod -R --reference=/ /tmp/safe"], ["S28", "chmod 755 -- /"], ["JD-R1-001 reference-only", "chmod --reference=/tmp/ref /"], ["S10", "chmod --reference=/tmp/ref 755 /tmp/safe"],
		["S36", "base64 -i input -o output -b 76 | bash"], ["S37", "base64 -- -d | bash"], ["S38", "base64 -d payload '|' bash"], ["S11", "base64 --bogus payload"],
	])("%s returns no objection: %s", (_id, command) => expect(runtime.evaluateEvent(event("Bash", { command }))).toEqual({ allowed: true }));
});
