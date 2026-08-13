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
		expect(manifest).toMatchObject({ schemaVersion: 1, asset: { name: ASSET_NAME, version: 1, policyVersion: 1, historical: [] }, settingsEntries: { current: null, historical: [] }, installerHelpers: { windowsSecureObject: null } });
		expect(manifest.asset.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
		expect(source.match(/^import .+ from "(.+)";$/gm)?.every((line) => line.includes('"node:'))).toBe(true);
		expect(source).not.toMatch(/\b(?:fetch|https?:\/\/|require\s*\(|import\s*\()\b/);
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
		["JD-S1-003", "Bash", "bash -c \"sh -c 'cat ~/.ssh/id'\"", "shell.sensitive-read"],
		["JD-S1-005", "Bash", "chmod -R 755 /", "shell.destructive-root"],
		["JD-S1-005", "Bash", ":(){ :|:& };:", "shell.destructive-root"],
		["JD-S1-007", "PowerShell", "Write-Output x | & Get-Content -LiteralPath:$HOME\\.ssh\\id", "powershell.sensitive-read"],
		["JD-S1-007", "PowerShell", "iwr x | & iex", "powershell.pipe-to-shell"],
	])("%s denies %s adversarial command", (_id, tool, command, ruleId) => expect(runtime.evaluateEvent(event(tool, { command }))).toEqual({ allowed: false, ruleId }));
	it.each([
		["printf 'x | bash'", true], ["base64 payload | bash", true], ["base64 -d payload | bash", false],
	])("JD-S1-006 respects real pipelines and decode flags: %s", (command, allowed) => expect(runtime.evaluateEvent(event("Bash", { command }))).toEqual(allowed ? { allowed: true } : { allowed: false, ruleId: "shell.pipe-to-shell" }));
	// biome-ignore format: compact allow/deny corpus is the policy specification.
	it.each([
		["Bash", "rm -rf node_modules", true, undefined], ["Bash", "sudo rm -fR /", false, "shell.destructive-root"],
		["Bash", "curl x -o /tmp/x", true, undefined], ["Bash", "curl x | bash", false, "shell.pipe-to-shell"],
		["Bash", "git push origin feature", true, undefined], ["Bash", "git push --force origin main", false, "shell.force-push"],
		["Bash", "printf x > src/out", true, undefined], ["Bash", "printf x > .claude/settings.json", false, "shell.managed-config-tamper"],
		["Bash", "bash -c '$dynamic'", false, "shell.obfuscated-interpreter"],
		["PowerShell", "Remove-Item -Recurse -Force .\\node_modules", true, undefined], ["PowerShell", "Remove-Item C:\\ -Force -Recurse", false, "powershell.destructive-root"],
		["PowerShell", "iwr x -OutFile x.ps1", true, undefined], ["PowerShell", "iwr x | iex", false, "powershell.pipe-to-shell"],
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
