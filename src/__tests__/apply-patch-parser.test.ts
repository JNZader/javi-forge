// biome-ignore-all format: compact table-driven security corpus keeps the review slice bounded.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";

// S1 apply_patch shim (security-critical): Codex delivers file writes as
// tool_name:"apply_patch" with the target path(s) inside tool_input.command patch
// text and NO file_path field. This surface is where a parse miss = a managed-config
// file-write bypass. Grammar VERIFIED against a REAL captured codex-cli 0.147.0
// envelope (2026-08-18): `*** Begin Patch` / `*** End Patch` bookends and
// `*** Add File:` / `*** Update File:` / `*** Delete File:` / `*** Move to:` headers,
// the last CONFIRMED present for renames (rename-target bypass is real, not theoretical).
interface Decision { allowed: boolean; ruleId?: string }
interface AgentConfig { id: string; managedSet: unknown; projectDir: unknown; marker: string }
interface Runtime {
	AGENT_CONFIGS: Record<string, AgentConfig>;
	parseApplyPatchPaths(command: unknown): string[];
	evaluateEvent(input: unknown, config?: AgentConfig): Decision;
}
const ASSET = path.join(CLAUDE_HOOK_ASSETS_DIR, "javi-forge-skillguard-pre-tool-use.mjs");
// Codex resolves projectRoot from the envelope cwd (no env var); anchor the tests to
// the real asset-relative repo root so canonicalization/realpath is stable.
const ROOT = path.resolve(CLAUDE_HOOK_ASSETS_DIR, "../..");
let runtime: Runtime;
beforeAll(async () => { runtime = (await import(pathToFileURL(ASSET).href)) as Runtime; });
const patch = (...body: string[]): string => ["*** Begin Patch", ...body, "*** End Patch"].join("\n");
const codexEvent = (command: string): unknown => ({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command }, cwd: ROOT });
const evalCodex = (command: string): Decision => runtime.evaluateEvent(codexEvent(command), runtime.AGENT_CONFIGS.codex);

describe("parseApplyPatchPaths — real codex apply_patch grammar", () => {
	it.each([
		["single Add", patch("*** Add File: src/new.ts", "+export const x = 1;"), ["src/new.ts"]],
		["single Update", patch("*** Update File: src/app.ts", "@@", " const a = 1;"), ["src/app.ts"]],
		["single Delete", patch("*** Delete File: src/old.ts"), ["src/old.ts"]],
		["rename via Move to (both source and target extracted)", patch("*** Update File: src/a.ts", "*** Move to: src/b.ts", "@@", " x"), ["src/a.ts", "src/b.ts"]],
		["add-then-move-to (real captured shape)", patch("*** Add File: alpha.txt", "+NEW", "*** Move to: beta.txt", "*** Delete File: seed.txt"), ["alpha.txt", "beta.txt", "seed.txt"]],
		["multi-file patch extracts every header path", patch("*** Update File: src/a.ts", "@@", " a", "*** Add File: src/b.ts", "+b", "*** Delete File: src/c.ts"), ["src/a.ts", "src/b.ts", "src/c.ts"]],
	])("extracts %s", (_name, command, expected) => {
		expect(runtime.parseApplyPatchPaths(command)).toEqual(expected);
	});

	// voice-3 O1 golden: the EXACT captured codex-cli 0.147.0 apply_patch envelope shape
	// (Add + Move-to + Delete in one patch, live-captured 2026-08-18 — engram
	// sdd/agent-agnostic-codex/apply-progress). Pins parseApplyPatchPaths grammar
	// equivalence against the real emitter, not just synthetic fixtures.
	it("O1 golden: extracts every target from the real captured codex 0.147.0 envelope", () => {
		const captured = ["*** Begin Patch", "*** Add File: alpha.txt", "+NEW", "*** Move to: beta.txt", "*** Delete File: seed.txt", "*** End Patch"].join("\n");
		expect(runtime.parseApplyPatchPaths(captured)).toEqual(["alpha.txt", "beta.txt", "seed.txt"]);
	});

	it.each([
		["non-string command", 42],
		["null command", null],
		["empty string", ""],
		["missing Begin Patch header", "*** Add File: x.ts\n+1\n*** End Patch"],
		["missing End Patch (truncated)", "*** Begin Patch\n*** Add File: x.ts\n+1"],
		["zero extractable paths (body only)", "*** Begin Patch\n@@\n+line\n*** End Patch"],
		["NUL byte in command", "*** Begin Patch\n*** Add File: x\0.ts\n*** End Patch"],
		["header with empty path", "*** Begin Patch\n*** Add File:    \n*** End Patch"],
	])("fails closed on %s", (_name, command) => {
		expect(() => runtime.parseApplyPatchPaths(command as unknown)).toThrow("invalid-event");
	});
});

describe("evaluateEvent apply_patch — managed-config WRITE protection under Codex", () => {
	it.each([
		["Add managed .claude/settings.json", patch("*** Add File: .claude/settings.json", "+{}"), "path.managed-config"],
		["Update managed CLAUDE.md", patch("*** Update File: CLAUDE.md", "@@", "-a", "+b"), "path.managed-config"],
		["Delete managed .javi-forge/ci.yaml", patch("*** Delete File: .javi-forge/ci.yaml"), "path.managed-config"],
		["Add managed .codex/hooks.json (self-protection)", patch("*** Add File: .codex/hooks.json", "+{}"), "path.managed-config"],
		["Add under managed prefix .claude/hooks/", patch("*** Add File: .claude/hooks/evil.sh", "+rm -rf /"), "path.managed-config"],
		["rename benign INTO a managed path via Move to", patch("*** Update File: notes.txt", "*** Move to: .claude/settings.json", "@@", " x"), "path.managed-config"],
		["multi-file patch where ONE path is managed", patch("*** Update File: src/a.ts", "@@", " a", "*** Add File: .claude/settings.json", "+{}"), "path.managed-config"],
		["escape via ../ into a managed path", patch("*** Add File: sub/../.claude/settings.json", "+{}"), "path.managed-config"],
	])("denies: %s", (_name, command, ruleId) => {
		expect(evalCodex(command)).toEqual({ allowed: false, ruleId });
	});

	it.each([
		["Add benign source file", patch("*** Add File: src/feature.ts", "+export const y = 2;")],
		["Update benign source file", patch("*** Update File: README.md", "@@", "-old", "+new")],
		["multi-file patch touching only benign paths", patch("*** Update File: src/a.ts", "@@", " a", "*** Add File: src/b.ts", "+b")],
		["rename benign to benign via Move to", patch("*** Update File: src/a.ts", "*** Move to: src/b.ts", "@@", " x")],
	])("allows: %s", (_name, command) => {
		expect(evalCodex(command)).toEqual({ allowed: true });
	});

	it.each([
		["truncated patch (no End) fails closed to deny path", "*** Begin Patch\n*** Add File: src/a.ts"],
		["missing Begin fails closed", "*** Add File: .claude/settings.json\n*** End Patch"],
		["zero-path fails closed", "*** Begin Patch\n+orphan line\n*** End Patch"],
	])("fails closed (throws invalid-event, host maps to deny): %s", (_name, command) => {
		expect(() => evalCodex(command)).toThrow("invalid-event");
	});

	it("does not fire the apply_patch branch for Claude file tools (behavior untouched)", () => {
		const managed = path.join(ROOT, "CLAUDE.md");
		expect(runtime.evaluateEvent({ hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: managed }, cwd: ROOT }, runtime.AGENT_CONFIGS.claude)).toEqual({ allowed: false, ruleId: "path.managed-config" });
		expect(runtime.evaluateEvent({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: managed }, cwd: ROOT }, runtime.AGENT_CONFIGS.claude)).toEqual({ allowed: true });
	});

	// voice-3 O2 (cheap regression fixtures on the security surface): an ABSOLUTE-path
	// managed header and a CRLF envelope with a managed header were probed safe live but
	// were untested. Both must DENY.
	it.each([
		["absolute-path managed header", patch(`*** Add File: ${path.join(ROOT, ".claude/settings.json")}`, "+{}")],
		["CRLF-line-ending envelope with a managed header", ["*** Begin Patch", "*** Add File: .claude/settings.json", "+{}", "*** End Patch"].join("\r\n")],
	])("denies: %s", (_name, command) => {
		expect(evalCodex(command)).toEqual({ allowed: false, ruleId: "path.managed-config" });
	});
});

describe("evaluateEvent apply_patch — symlinked managed dir must NOT bypass (JD-S1 regression)", () => {
	let temp: string;
	beforeAll(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-applypatch-symlink-")); });
	afterAll(() => fs.rmSync(temp, { recursive: true, force: true }));
	const codexAt = (root: string, command: string): Decision =>
		runtime.evaluateEvent({ hook_event_name: "PreToolUse", tool_name: "apply_patch", tool_input: { command }, cwd: root }, runtime.AGENT_CONFIGS.codex);
	const writeAt = (root: string, file_path: string): Decision =>
		runtime.evaluateEvent({ hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path }, cwd: root }, runtime.AGENT_CONFIGS.codex);
	// Mirrors JD-S1-004 (the Write/Edit lexical+realpath identity test in claude-hook-assets.test.ts):
	// when a managed dir (.claude) is a SYMLINK escaping the project root, realpath collapses
	// <root>/.claude/settings.json onto the escaped target. Pre-fix, the apply_patch branch realpathed
	// the header path BEFORE evaluateFile, destroying the protective lexical managed key -> ALLOW (bypass
	// via codex's PRIMARY write mechanism). apply_patch now resolves LEXICALLY like Write/Edit, so the
	// lexical managed key survives and the write is DENIED — identical managed-symlink semantics as Write.
	it("denies an apply_patch Add onto a symlinked .claude, matching Write (regression: was ALLOW)", () => {
		const root = fs.mkdtempSync(path.join(temp, "root-"));
		fs.mkdirSync(path.join(temp, "escape-add"), { recursive: true });
		fs.symlinkSync(path.join(temp, "escape-add"), path.join(root, ".claude"), "dir");
		expect(codexAt(root, patch("*** Add File: .claude/settings.json", "+{}"))).toEqual({ allowed: false, ruleId: "path.managed-config" });
		// The Write/Edit branch on the identical symlinked target — apply_patch MUST match it.
		expect(writeAt(root, path.join(root, ".claude/settings.json"))).toEqual({ allowed: false, ruleId: "path.managed-config" });
	});
	it("denies a Move-to retarget onto a symlinked managed path", () => {
		const root = fs.mkdtempSync(path.join(temp, "root-"));
		fs.mkdirSync(path.join(temp, "escape-move"), { recursive: true });
		fs.symlinkSync(path.join(temp, "escape-move"), path.join(root, ".claude"), "dir");
		expect(codexAt(root, patch("*** Update File: src/a.ts", "*** Move to: .claude/settings.json", "@@", " x"))).toEqual({ allowed: false, ruleId: "path.managed-config" });
	});
});
