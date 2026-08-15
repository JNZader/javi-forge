// javi-forge-managed: claude-pretooluse v1
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// host fail-open residual: spawn, parse/start, external termination, and timeout
// failures before this guarded main path continue through Claude's permissions.
export const MANAGED_MARKER = "// javi-forge-managed: claude-pretooluse v1";
export const INPUT_LIMIT_BYTES = 1_048_576;
export const SUPPORTED_TOOLS = Object.freeze(["Bash", "PowerShell", "Read", "Write", "Edit"]);
export const POLICY_REGISTRY = Object.freeze({ schemaVersion: 1, policyVersion: 1, diagnosticsMaxBytes: 240 });
const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const POSIX_ABSOLUTE = /^\//;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC = /^\\\\[^\\]+\\[^\\]+/;
function fail(reason) { throw new Error(reason); }
function isObject(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function normalizeWindowsAlias(input) {
	if (/^\\\\\?\\GLOBALROOT\\/i.test(input) || /^\\\\\.\\(?![a-z]:\\)/i.test(input)) fail("unsupported-device-path");
	if (/^\\\\\?\\UNC\\/i.test(input)) return `\\\\${input.slice(8)}`;
	if (/^\\\\\?\\[a-z]:\\/i.test(input)) return input.slice(4);
	if (/^\\\?\?\\[a-z]:\\/i.test(input)) return input.slice(4);
	if (/^\\\\\.\\[a-z]:\\/i.test(input)) return input.slice(4);
	if (/^\\\\\?\\/i.test(input) || /^\\\?\?\\/i.test(input)) fail("unsupported-device-path");
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
	const native = platform === process.platform && path.isAbsolute(expanded) ? nativeRealpath(expanded) : expanded;
	return lexicalNormalize(native, platform);
}
function policyPathKeys(input, options = {}) {
	const platform = options.platform ?? process.platform;
	const lexical = lexicalNormalize(input, platform);
	if (platform !== process.platform || !path.isAbsolute(input)) return [lexical];
	const real = canonicalizePolicyPath(input, options);
	return real === lexical ? [lexical] : [lexical, real];
}
function isAbsolutePolicyPath(value) { return POSIX_ABSOLUTE.test(value) || WINDOWS_DRIVE.test(value) || WINDOWS_UNC.test(value) || /^\\(?:\\\?|\?\?|\\\.)\\/i.test(value); }
export function isSensitivePolicyKey(key, platform = process.platform) {
	const parts = key.split("/").filter(Boolean);
	const basename = parts.at(-1) ?? "";
	if (/^\.env(?:\..+)?$/i.test(basename) && !/^\.env\.(?:example|sample|template)$/i.test(basename)) return true;
	if ([".npmrc", ".pypirc", ".netrc", ".git-credentials"].includes(basename.toLowerCase())) return true;
	if (parts.some((part) => part === ".ssh" || part === ".gnupg")) return true;
	if (key.endsWith("/.aws/credentials") || key.endsWith("/.kube/config") || key.endsWith("/.config/gcloud/application_default_credentials.json")) return true;
	return platform === "win32" || platform === "darwin" ? basename.toLowerCase() === "serviceaccountkey.json" : basename === "serviceAccountKey.json";
}
function isManaged(key) {
	const project = canonicalizePolicyPath(PROJECT_ROOT);
	if (!key.startsWith(`${project}/`) && key !== project) return false;
	const relative = key.slice(project.length + 1);
	return relative === ".claude/settings.json" || relative === ".claude/settings.local.json" || relative === ".claude/CLAUDE.md" || relative === "CLAUDE.md" || relative === ".javi-forge/ci.yaml" || relative.startsWith(".claude/hooks/") || relative.startsWith(".claude/agents/") || relative.startsWith(".claude/skills/");
}
function evaluateFile(toolName, filePath) {
	const keys = policyPathKeys(filePath);
	if (keys.some((key) => isSensitivePolicyKey(key))) return { allowed: false, ruleId: "path.sensitive" };
	if (toolName !== "Read" && keys.some(isManaged)) return { allowed: false, ruleId: "path.managed-config" };
	return { allowed: true };
}
function lex(command, powershell = false) {
	const commands = [[]];
	const separators = [];
	let token = "", quote = "", escaped = false;
	const pushToken = () => { if (token) commands.at(-1).push(token); token = ""; };
	const split = (separator) => { pushToken(); if (commands.at(-1).length) { separators.push(separator); commands.push([]); } };
	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		if (escaped) { token += char; escaped = false; continue; }
		if (char === "\\" && quote !== "'" && !powershell) { escaped = true; continue; }
		if (char === "`" && quote !== "'" && powershell) { escaped = true; continue; }
		if (quote) { if (char === quote) quote = ""; else token += char; continue; }
		if (char === "'" || char === '"') { quote = char; continue; }
		if (char === "|" && command[index + 1] === "|") { split("||"); index++; continue; }
		if (char === "&" && command[index + 1] === "&") { split("&&"); index++; continue; }
		if (char === "|" || char === ";" || char === "\n" || char === "\r") { split(char === "|" ? "|" : ";"); continue; }
		if (char === ">" || char === "<") { pushToken(); commands.at(-1).push(char); continue; }
		if (/\s/.test(char)) { pushToken(); continue; }
		token += char;
	}
	if (quote || escaped) fail("unlexable-command");
	pushToken();
	if (!commands.at(-1).length) commands.pop();
	return { commands, separators };
}
function commandWords(input, powershell = false) {
	const tokens = [...input];
	if (powershell) while (tokens[0] === "&") tokens.shift();
	for (;;) {
		while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? "")) tokens.shift();
		const wrapper = (tokens[0] ?? "").toLowerCase();
		if (!["sudo", "command", "builtin", "nohup", "env"].includes(wrapper)) break;
		tokens.shift();
		for (;;) {
			if (tokens[0] === "--" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? "")) { tokens.shift(); continue; }
			if (wrapper === "env") { const option = tokens[0] ?? "", attached = option.match(/^-S(.+)$|^--split-string=(.*)$/); if (attached || /^(?:-S|--split-string)$/.test(option)) { const split = lex(attached ? (attached[1] ?? attached[2]) : (tokens[1] ?? "")); if (split.commands.length !== 1 || split.separators.length) fail("unlexable-command"); tokens.splice(0, attached ? 1 : 2, ...split.commands[0]); continue; } }
			if ((wrapper === "sudo" && /^(?:-u|-g|-h|-p|-C|-D|-R|-T|-r|-t|--user|--group|--host|--prompt|--chdir|--chroot|--command-timeout|--role|--type)$/.test(tokens[0] ?? "")) || (wrapper === "env" && /^(?:-u|-C|--unset|--chdir)$/.test(tokens[0] ?? ""))) { tokens.splice(0, 2); continue; }
			if (tokens[0]?.startsWith("-") && tokens[0] !== "--") { tokens.shift(); continue; }
			break;
		}
	}
	return tokens;
}
function hasSensitiveLiteral(tokens, cwd) {
	return tokens.some((token) => {
		if ((token.startsWith("-") && !/^-(?:LiteralPath|Path):/i.test(token)) || !/[\\/.~$]/.test(token)) return false;
		try {
			return isSensitivePolicyKey(canonicalizePolicyPath(token.replace(/^(?:-LiteralPath:|-Path:)/i, "").replace(/[;,]$/, ""), { base: cwd, projectRoot: PROJECT_ROOT }));
		} catch {
			return false;
		}
	});
}
function hasManagedLiteral(tokens, cwd) {
	return tokens.some((token) => {
		if ((token.startsWith("-") && !/^-(?:LiteralPath|Path):/i.test(token)) || !/[\\/.]/.test(token)) return false;
		try {
			return isManaged(canonicalizePolicyPath(token.replace(/^(?:-LiteralPath:|-Path:)/i, "").replace(/[;,]$/, ""), { base: cwd, projectRoot: PROJECT_ROOT }));
		} catch {
			return false;
		}
	});
}
function bashSubstitutions(command) {
	const bodies = [];
	let quote = "", escaped = false;
	for (let index = 0; index < command.length; index++) {
		const char = command[index];
		if (escaped) { escaped = false; continue; }
		if (char === "\\" && quote !== "'") { escaped = true; continue; }
		if (char === "'" && quote !== '"') { quote = quote === "'" ? "" : "'"; continue; }
		if (char === '"' && quote !== "'") { quote = quote === '"' ? "" : '"'; continue; }
		if (quote === "'") continue;
		if (char === "`") {
			let body = "", closed = false;
			for (++index; index < command.length; index++) { if (command[index] === "\\" && index + 1 < command.length) body += command[++index]; else if (command[index] === "`") { closed = true; break; } else body += command[index]; }
			if (!closed) fail("unlexable-command");
			bodies.push(body);
		} else if (char === "$" && command[index + 1] === "(") {
			let depth = 1, innerQuote = "", innerEscaped = false, end = index + 2;
			for (; end < command.length && depth; end++) {
				const inner = command[end];
				if (innerEscaped) { innerEscaped = false; continue; }
				if (inner === "\\" && innerQuote !== "'") { innerEscaped = true; continue; }
				if (inner === "'" && innerQuote !== '"' && innerQuote !== "`") innerQuote = innerQuote === "'" ? "" : "'";
				else if (inner === '"' && innerQuote !== "'" && innerQuote !== "`") innerQuote = innerQuote === '"' ? "" : '"';
				else if (inner === "`" && innerQuote !== "'") innerQuote = innerQuote === "`" ? "" : "`";
				else if (!innerQuote && inner === "(") depth++;
				else if (!innerQuote && inner === ")") depth--;
			}
			if (depth) fail("unlexable-command");
			bodies.push(command.slice(index + 2, end - 1)); index = end - 1;
		}
	}
	return bodies;
}
function evaluateBash(command, cwd, depth = 0) {
	if (depth > 4) return { allowed: false, ruleId: "shell.obfuscated-interpreter" };
	try { for (const body of bashSubstitutions(command)) { const nested = evaluateBash(body, cwd, depth + 1); if (!nested.allowed) return nested; } } catch { return { allowed: false, ruleId: "shell.obfuscated-interpreter" }; }
	if (/^\s*:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:\s*$/.test(command)) return { allowed: false, ruleId: "shell.destructive-root" };
	let parsed;
	try { parsed = lex(command); } catch { return { allowed: false, ruleId: "shell.obfuscated-interpreter" }; }
	for (let index = 0; index < parsed.commands.length; index++) {
		const tokens = commandWords(parsed.commands[index]);
		const executable = (tokens[0] ?? "").toLowerCase();
		const rmOptions = tokens.filter((token) => token.startsWith("-")).join("");
		if ((executable === "rm" && /r/i.test(rmOptions) && /f/i.test(rmOptions) && tokens.some((token) => ["/", "/*", "~", "$HOME", "${HOME}", ".", "..", PROJECT_ROOT].includes(token))) || /^mkfs/.test(executable) || (executable === "dd" && tokens.some((token) => /^of=\/dev\/(?:sd|nvme|vd|disk)/.test(token)))) return { allowed: false, ruleId: "shell.destructive-root" };
		if (executable === "chmod" && (tokens.some((token) => /^-[^-]*R[^-]*$|^--recursive$/.test(token)) || tokens.some((token) => /^(?:0?777)$/.test(token))) && tokens.some((token) => ["/", "/*", "~", "$HOME", "${HOME}", ".", "..", PROJECT_ROOT].includes(token))) return { allowed: false, ruleId: "shell.destructive-root" };
		if (parsed.separators[index] === "|") {
			const downstream = commandWords(parsed.commands[index + 1] ?? []);
			const producer = executable === "base64" ? tokens.some((token) => /^-[^-]*d[^-]*$|^-D$|^--d(?:e(?:c(?:o(?:d(?:e)?)?)?)?)?$/.test(token)) : /^(?:curl|wget)$/.test(executable);
			if (producer && /^(?:sh|bash|zsh|dash|ksh)$/.test((downstream[0] ?? "").toLowerCase())) return { allowed: false, ruleId: "shell.pipe-to-shell" };
		}
		if (["cat", "less", "more", "head", "tail", "bat", "grep", "rg", "sed", "awk", "source", ".", "cp", "install"].includes(executable) && hasSensitiveLiteral(tokens.slice(1), cwd)) return { allowed: false, ruleId: "shell.sensitive-read" };
		if (tokens.some((token) => token === "<") && hasSensitiveLiteral(tokens, cwd)) return { allowed: false, ruleId: "shell.sensitive-read" };
		if (executable === "git" && tokens[1]?.toLowerCase() === "push" && tokens.some((token) => ["-f", "--force", "--force-with-lease"].includes(token.toLowerCase()))) return { allowed: false, ruleId: "shell.force-push" };
		if (["rm", "mv", "cp", "install", "truncate", "touch", "chmod", "chown", "tee"].includes(executable) && hasManagedLiteral(tokens.slice(1), cwd)) return { allowed: false, ruleId: "shell.managed-config-tamper" };
		if ((/^(?:sed|perl)$/.test(executable) && tokens.some((token) => token.startsWith("-i")) && hasManagedLiteral(tokens, cwd)) || (tokens.includes(">") && hasManagedLiteral(tokens, cwd))) return { allowed: false, ruleId: "shell.managed-config-tamper" };
		if (/^(?:powershell|pwsh)(?:\.exe)?$/i.test(executable) && tokens.some((token) => /^-(?:enc|encodedcommand)$/i.test(token))) return { allowed: false, ruleId: "shell.obfuscated-interpreter" };
		if (/^(?:bash|sh|zsh|dash|ksh)$/.test(executable)) {
			const flag = tokens.findIndex((token) => /^-[^-]*c[^-]*$/.test(token));
			if (flag >= 0) { const body = tokens[flag + 1]; if (!body || /\$(?!\()/.test(body)) return { allowed: false, ruleId: "shell.obfuscated-interpreter" }; const nested = evaluateBash(body, cwd, depth + 1); if (!nested.allowed) return nested; }
		}
	}
	return { allowed: true };
}
function evaluatePowerShell(command, cwd) {
	const parsed = lex(command, true);
	for (let index = 0; index < parsed.commands.length; index++) {
		const tokens = commandWords(parsed.commands[index], true);
		const executable = (tokens[0] ?? "").toLowerCase();
		if ((["remove-item", "rm", "del", "erase", "rmdir", "rd"].includes(executable) && tokens.some((token) => /^-(?:r|recurse)$/i.test(token)) && tokens.some((token) => /^-(?:fo|force)$/i.test(token)) && tokens.some((token) => /^(?:[a-z]:\\?|[/~]|\$HOME)$/i.test(token))) || ["format-volume", "clear-disk", "initialize-disk"].includes(executable)) return { allowed: false, ruleId: "powershell.destructive-root" };
		if (parsed.separators[index] === "|" && /^(?:invoke-webrequest|iwr|curl|wget|invoke-restmethod|irm)$/.test(executable) && /^(?:invoke-expression|iex)$/.test((commandWords(parsed.commands[index + 1] ?? [], true)[0] ?? "").toLowerCase())) return { allowed: false, ruleId: "powershell.pipe-to-shell" };
		if (["get-content", "gc", "cat", "type", "select-string", "copy-item", "cp", "copy"].includes(executable) && hasSensitiveLiteral(tokens.slice(1), cwd)) return { allowed: false, ruleId: "powershell.sensitive-read" };
		if (executable === "git" && tokens[1]?.toLowerCase() === "push" && tokens.some((token) => ["-f", "--force", "--force-with-lease"].includes(token.toLowerCase()))) return { allowed: false, ruleId: "powershell.force-push" };
		if (["set-content", "add-content", "out-file", "clear-content", "remove-item", "move-item", "copy-item", "rename-item", "new-item"].includes(executable) && hasManagedLiteral(tokens.slice(1), cwd)) return { allowed: false, ruleId: "powershell.managed-config-tamper" };
		if (tokens.includes(">") && hasManagedLiteral(tokens, cwd)) return { allowed: false, ruleId: "powershell.managed-config-tamper" };
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
function denialDiagnostic(toolName, decision) { return `javi-forge PreToolUse denied ${SUPPORTED_TOOLS.includes(toolName) ? toolName : "supported tool"} [${decision.ruleId}]: global guard policy denied the invocation`; }
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
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
