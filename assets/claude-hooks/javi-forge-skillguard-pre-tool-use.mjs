// javi-forge-managed: claude-pretooluse v1
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// host fail-open residual: spawn, parse/start, external termination, and timeout
// failures before this guarded main path continue through Claude's permissions.

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

function shellSegments(command) {
	const nested = [...command.matchAll(/\$\(([^()]*)\)|`([^`]*)`/g)].map((match) => match[1] ?? match[2]);
	return [...command.split(/(?:\r?\n|&&|\|\||;)/), ...nested].map((part) => part.trim()).filter(Boolean);
}

function words(segment) {
	return [...segment.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|([^\s<>|]+)/g)].map((match) => (match[1] ?? match[2] ?? match[3]).replace(/\\([\s"'\\])/g, "$1"));
}

function commandWords(segment, powershell = false) {
	const tokens = words(segment);
	while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? "")) tokens.shift();
	while (["sudo", "command", "builtin", "nohup", "env"].includes((tokens[0] ?? "").toLowerCase())) tokens.shift();
	if (powershell && tokens[0] === "&") tokens.shift();
	return tokens;
}

function hasSensitiveLiteral(tokens, cwd) {
	return tokens.some((token) => {
		if (token.startsWith("-") || !/[\\/.~$]/.test(token)) return false;
		try {
			return isSensitive(canonicalizePolicyPath(token.replace(/[;,]$/, ""), { base: cwd, projectRoot: PROJECT_ROOT }));
		} catch {
			return false;
		}
	});
}

function hasManagedLiteral(tokens, cwd) {
	return tokens.some((token) => {
		if (token.startsWith("-") || !/[\\/.]/.test(token)) return false;
		try {
			return isManaged(canonicalizePolicyPath(token.replace(/[;,]$/, ""), { base: cwd, projectRoot: PROJECT_ROOT }));
		} catch {
			return false;
		}
	});
}

function evaluateBash(command, cwd) {
	const segments = shellSegments(command);
	for (const segment of segments) {
		const tokens = commandWords(segment);
		const executable = (tokens[0] ?? "").toLowerCase();
		const rmOptions = tokens.filter((token) => token.startsWith("-")).join("");
		if ((executable === "rm" && /r/i.test(rmOptions) && /f/i.test(rmOptions) && tokens.some((token) => ["/", "/*", "~", "$HOME", "${HOME}", ".", "..", PROJECT_ROOT].includes(token))) || /^mkfs/.test(executable) || (executable === "dd" && tokens.some((token) => /^of=\/dev\/(?:sd|nvme|vd|disk)/.test(token)))) return { allowed: false, ruleId: "shell.destructive-root" };
		if (/^(?:curl|wget|base64)\b[^|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh)\b/i.test(segment)) return { allowed: false, ruleId: "shell.pipe-to-shell" };
		if (["cat", "less", "more", "head", "tail", "bat", "grep", "rg", "sed", "awk", "source", ".", "cp", "install"].includes(executable) && hasSensitiveLiteral(tokens.slice(1), cwd)) return { allowed: false, ruleId: "shell.sensitive-read" };
		if (/<\s*[^\s]+/.test(segment) && hasSensitiveLiteral(tokens, cwd)) return { allowed: false, ruleId: "shell.sensitive-read" };
		if (executable === "git" && tokens[1]?.toLowerCase() === "push" && tokens.some((token) => ["-f", "--force", "--force-with-lease"].includes(token.toLowerCase()))) return { allowed: false, ruleId: "shell.force-push" };
		if (["rm", "mv", "cp", "install", "truncate", "touch", "chmod", "chown", "tee"].includes(executable) && hasManagedLiteral(tokens.slice(1), cwd)) return { allowed: false, ruleId: "shell.managed-config-tamper" };
		if ((/^(?:sed|perl)$/.test(executable) && tokens.some((token) => token.startsWith("-i")) && hasManagedLiteral(tokens, cwd)) || (/>/.test(segment) && hasManagedLiteral(tokens, cwd))) return { allowed: false, ruleId: "shell.managed-config-tamper" };
		if (/^(?:powershell|pwsh)(?:\.exe)?$/i.test(executable) && tokens.some((token) => /^-(?:enc|encodedcommand)$/i.test(token))) return { allowed: false, ruleId: "shell.obfuscated-interpreter" };
		if (/^(?:bash|sh|zsh|dash|ksh)$/.test(executable) && tokens.some((token) => token === "-c") && /[$`]/.test(tokens.at(-1) ?? "")) return { allowed: false, ruleId: "shell.obfuscated-interpreter" };
	}
	return { allowed: true };
}

function evaluatePowerShell(command, cwd) {
	for (const segment of shellSegments(command)) {
		const tokens = commandWords(segment, true);
		const executable = (tokens[0] ?? "").toLowerCase();
		if ((["remove-item", "rm", "del", "erase", "rmdir", "rd"].includes(executable) && tokens.some((token) => /^-(?:r|recurse)$/i.test(token)) && tokens.some((token) => /^-(?:fo|force)$/i.test(token)) && tokens.some((token) => /^(?:[a-z]:\\?|[/~]|\$HOME)$/i.test(token))) || ["format-volume", "clear-disk", "initialize-disk"].includes(executable)) return { allowed: false, ruleId: "powershell.destructive-root" };
		if (/^(?:invoke-webrequest|iwr|curl|wget|invoke-restmethod|irm)\b[^|]*\|\s*(?:invoke-expression|iex)\b/i.test(segment)) return { allowed: false, ruleId: "powershell.pipe-to-shell" };
		if (["get-content", "gc", "cat", "type", "select-string", "copy-item", "cp", "copy"].includes(executable) && hasSensitiveLiteral(tokens.slice(1), cwd)) return { allowed: false, ruleId: "powershell.sensitive-read" };
		if (executable === "git" && tokens[1]?.toLowerCase() === "push" && tokens.some((token) => ["-f", "--force", "--force-with-lease"].includes(token.toLowerCase()))) return { allowed: false, ruleId: "powershell.force-push" };
		if (["set-content", "add-content", "out-file", "clear-content", "remove-item", "move-item", "copy-item", "rename-item", "new-item"].includes(executable) && hasManagedLiteral(tokens.slice(1), cwd)) return { allowed: false, ruleId: "powershell.managed-config-tamper" };
		if (/>/.test(segment) && hasManagedLiteral(tokens, cwd)) return { allowed: false, ruleId: "powershell.managed-config-tamper" };
		if (/^(?:powershell|pwsh)(?:\.exe)?$/i.test(executable) && tokens.some((token) => /^-(?:enc|encodedcommand)$/i.test(token))) return { allowed: false, ruleId: "powershell.obfuscated-interpreter" };
	}
	return { allowed: true };
}

export function evaluateEvent(input) {
	if (!isObject(input) || input.hook_event_name !== "PreToolUse" || !SUPPORTED_TOOLS.includes(input.tool_name) || !isObject(input.tool_input)) fail("invalid-event");
	if (input.tool_name === "Bash" || input.tool_name === "PowerShell") {
		if (typeof input.tool_input.command !== "string") fail("invalid-event");
		const cwd = typeof input.cwd === "string" && isAbsolutePolicyPath(input.cwd) ? input.cwd : PROJECT_ROOT;
		return input.tool_name === "Bash" ? evaluateBash(input.tool_input.command, cwd) : evaluatePowerShell(input.tool_input.command, cwd);
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

function diagnostic(error) {
	const id = error instanceof Error && /^[a-z-]+$/.test(error.message) ? error.message : "internal-error";
	const messages = {
		"invalid-json": "input is not a valid JSON object",
		"invalid-event": "input does not match the supported event schema",
		"oversized-input": "stdin exceeds 1048576 bytes",
		"missing-policy": "embedded policy registry is unavailable",
		"internal-error": "policy evaluation could not complete",
	};
	return `javi-forge PreToolUse failed closed [${id}]: ${messages[id] ?? messages["internal-error"]}`;
}

function denialDiagnostic(toolName, decision) {
	return `javi-forge PreToolUse denied ${SUPPORTED_TOOLS.includes(toolName) ? toolName : "supported tool"} [${decision.ruleId}]: global guard policy denied the invocation`;
}

function truncateUtf8(message, maxBytes) {
	let output = message;
	while (Buffer.byteLength(output) > maxBytes) output = output.slice(0, -1);
	return output;
}

function denyAndExit(message) {
	try {
		fs.writeSync(2, `${truncateUtf8(message, POLICY_REGISTRY.diagnosticsMaxBytes)}\n`);
	} finally {
		process.stdin.destroy();
		process.stdin.unref?.();
		process.exit(2);
	}
}

export function readBoundedStdin(stream = process.stdin) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let bytes = 0;
		let settled = false;
		const cleanup = () => {
			stream.removeListener("data", onData);
			stream.removeListener("end", onEnd);
			stream.removeListener("error", onError);
			stream.removeListener("aborted", onAborted);
		};
		const finish = (callback) => {
			if (settled) return;
			settled = true;
			cleanup();
			callback();
		};
		const onData = (chunk) => {
			bytes += chunk.length;
			if (bytes > INPUT_LIMIT_BYTES) {
				finish(() => reject(new Error("oversized-input")));
				return;
			}
			chunks.push(chunk);
		};
		const onEnd = () => finish(() => resolve(Buffer.concat(chunks)));
		const onError = () => finish(() => reject(new Error("stdin-error")));
		const onAborted = () => finish(() => reject(new Error("stdin-error")));
		stream.on("data", onData);
		stream.on("end", onEnd);
		stream.on("error", onError);
		stream.on("aborted", onAborted);
	});
}

export async function main() {
	try {
		const fault = process.argv.find((arg) => arg.startsWith("--javi-forge-test-fault="))?.split("=")[1];
		if (fault === "missing-policy") throw new Error("missing-policy");
		if (POLICY_REGISTRY.schemaVersion !== 1 || POLICY_REGISTRY.policyVersion !== 1) throw new Error("missing-policy");
		const input = await readBoundedStdin();
		let parsed;
		try {
			parsed = JSON.parse(input.toString("utf8"));
		} catch {
			throw new Error("invalid-json");
		}
		if (fault === "evaluator-throw") throw new Error("internal-error");
		const decision = evaluateEvent(parsed);
		if (!decision.allowed) denyAndExit(denialDiagnostic(parsed.tool_name, decision));
		process.exitCode = 0;
	} catch (error) {
		denyAndExit(diagnostic(error));
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}
