// javi-forge-managed: claude-pretooluse v1
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MANAGED_MARKER = "// javi-forge-managed: claude-pretooluse v1";
export const INPUT_LIMIT_BYTES = 1_048_576;
export const SUPPORTED_TOOLS = Object.freeze([
	"Bash",
	"PowerShell",
	"Read",
	"Write",
	"Edit",
]);
export const POLICY_REGISTRY = Object.freeze({
	schemaVersion: 1,
	policyVersion: 1,
	diagnosticsMaxBytes: 240,
});

const PROJECT_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const POSIX_ABSOLUTE = /^\//;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC = /^\\\\[^\\]+\\[^\\]+/;

function fail(reason) {
	throw new Error(reason);
}

function isObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeWindowsAlias(input) {
	if (/^\\\\\?\\GLOBALROOT\\/i.test(input) || /^\\\\\.\\(?![a-z]:\\)/i.test(input)) {
		fail("unsupported-device-path");
	}
	if (/^\\\\\?\\UNC\\/i.test(input)) return `\\\\${input.slice(8)}`;
	if (/^\\\\\?\\[a-z]:\\/i.test(input)) return input.slice(4);
	if (/^\\\?\?\\[a-z]:\\/i.test(input)) return input.slice(4);
	if (/^\\\\\.\\[a-z]:\\/i.test(input)) return input.slice(4);
	if (/^\\\\\?\\/i.test(input) || /^\\\?\?\\/i.test(input)) {
		fail("unsupported-device-path");
	}
	return input;
}

function lexicalNormalize(input, platform) {
	const windows = platform === "win32" || WINDOWS_DRIVE.test(input) || WINDOWS_UNC.test(input) || /^\\(?:\\\?|\?\?|\\\.)\\/i.test(input);
	let value = windows ? normalizeWindowsAlias(input) : input;
	value = value.replaceAll("\\", "/");
	const root = value.startsWith("//")
		? `//${value.split("/").filter(Boolean).slice(0, 2).join("/")}`
		: /^[a-zA-Z]:\//.test(value)
			? value.slice(0, 3)
			: "/";
	const body = value.slice(root.length);
	const parts = [];
	for (const part of body.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	value = `${root}${root.endsWith("/") || parts.length === 0 ? "" : "/"}${parts.join("/")}`;
	if (windows || platform === "darwin") value = value.normalize("NFC").toLowerCase();
	return value;
}

function nativeRealpath(input) {
	let candidate = input;
	const suffix = [];
	while (!fs.existsSync(candidate)) {
		const parent = path.dirname(candidate);
		if (parent === candidate) return input;
		suffix.unshift(path.basename(candidate));
		candidate = parent;
	}
	try {
		return path.join(fs.realpathSync.native(candidate), ...suffix);
	} catch {
		fail("path-resolution-failed");
	}
}

export function canonicalizePolicyPath(input, options = {}) {
	if (typeof input !== "string" || input.includes("\0")) fail("invalid-event");
	const platform = options.platform ?? process.platform;
	let expanded = input;
	if (options.base) {
		expanded = expanded.replace(/^\$\{CLAUDE_PROJECT_DIR\}|^\$CLAUDE_PROJECT_DIR/, options.projectRoot ?? PROJECT_ROOT);
		expanded = expanded.replace(/^~(?=[\\/]|$)|^\$HOME(?=[\\/]|$)/, os.homedir());
		if (!POSIX_ABSOLUTE.test(expanded) && !WINDOWS_DRIVE.test(expanded) && !WINDOWS_UNC.test(expanded)) {
			expanded = path.resolve(options.base, expanded);
		}
	}
	const native = platform === process.platform && path.isAbsolute(expanded)
		? nativeRealpath(expanded)
		: expanded;
	return lexicalNormalize(native, platform);
}

function isAbsolutePolicyPath(value) {
	return POSIX_ABSOLUTE.test(value) || WINDOWS_DRIVE.test(value) || WINDOWS_UNC.test(value) || /^\\(?:\\\?|\?\?|\\\.)\\/i.test(value);
}

function isSensitive(key) {
	const parts = key.split("/").filter(Boolean);
	const basename = parts.at(-1) ?? "";
	if (/^\.env(?:\..+)?$/i.test(basename) && !/^\.env\.(?:example|sample|template)$/i.test(basename)) return true;
	if ([".npmrc", ".pypirc", ".netrc", ".git-credentials"].includes(basename.toLowerCase())) return true;
	if (parts.some((part) => part === ".ssh" || part === ".gnupg")) return true;
	if (key.endsWith("/.aws/credentials") || key.endsWith("/.kube/config") || key.endsWith("/.config/gcloud/application_default_credentials.json")) return true;
	return process.platform === "win32" ? basename.toLowerCase() === "serviceaccountkey.json" : basename === "serviceAccountKey.json";
}

function isManaged(key) {
	const project = canonicalizePolicyPath(PROJECT_ROOT);
	if (!key.startsWith(`${project}/`) && key !== project) return false;
	const relative = key.slice(project.length + 1);
	return relative === ".claude/settings.json" || relative === ".claude/settings.local.json" || relative === ".claude/CLAUDE.md" || relative === "CLAUDE.md" || relative === ".javi-forge/ci.yaml" || relative.startsWith(".claude/hooks/") || relative.startsWith(".claude/agents/") || relative.startsWith(".claude/skills/");
}

function evaluateFile(toolName, filePath) {
	const key = canonicalizePolicyPath(filePath);
	if (isSensitive(key)) return { allowed: false, ruleId: "path.sensitive" };
	if (toolName !== "Read" && isManaged(key)) return { allowed: false, ruleId: "path.managed-config" };
	return { allowed: true };
}

export function evaluateEvent(input) {
	if (!isObject(input) || input.hook_event_name !== "PreToolUse" || !SUPPORTED_TOOLS.includes(input.tool_name) || !isObject(input.tool_input)) fail("invalid-event");
	if (input.tool_name === "Bash" || input.tool_name === "PowerShell") {
		if (typeof input.tool_input.command !== "string") fail("invalid-event");
		return { allowed: true };
	}
	if (typeof input.tool_input.file_path !== "string" || !isAbsolutePolicyPath(input.tool_input.file_path)) fail("invalid-event");
	return evaluateFile(input.tool_name, input.tool_input.file_path);
}

export function parseAndEvaluateInput(input) {
	if (!Buffer.isBuffer(input) || input.length === 0) fail("invalid-json");
	if (input.length > INPUT_LIMIT_BYTES) fail("oversized-input");
	let parsed;
	try {
		parsed = JSON.parse(input.toString("utf8"));
	} catch {
		fail("invalid-json");
	}
	if (!isObject(parsed)) fail("invalid-json");
	return evaluateEvent(parsed);
}
