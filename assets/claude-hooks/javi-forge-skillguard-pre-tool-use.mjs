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
// Per-agent adapter config (S0 core-extraction): every agent-specific input the guard needs
// (the isManaged protected-path set, the project-dir source, the managed marker) is resolved by
// the --agent selector instead of a baked-in literal. The pure evaluate*/utility engine stays
// agent-independent. Claude's entry holds today's EXACT values so its observable behavior is
// byte-identical; codex is defined so the map is agent-generic but wired end-to-end only in a later slice.
const CLAUDE_MANAGED_SET = Object.freeze({ exact: Object.freeze([".claude/settings.json", ".claude/settings.local.json", ".claude/CLAUDE.md", "CLAUDE.md", ".javi-forge/ci.yaml"]), prefixes: Object.freeze([".claude/hooks/", ".claude/agents/", ".claude/skills/"]), caseFoldExact: Object.freeze(["claude.md", ".claude/claude.md"]) });
const CODEX_MANAGED_SET = Object.freeze({ exact: Object.freeze([".codex/hooks.json", ".claude/settings.json", ".claude/settings.local.json", ".claude/CLAUDE.md", "CLAUDE.md", ".javi-forge/ci.yaml"]), prefixes: Object.freeze([".claude/hooks/", ".claude/agents/", ".claude/skills/"]), caseFoldExact: Object.freeze(["claude.md", ".claude/claude.md"]) });
export const AGENT_CONFIGS = Object.freeze({ claude: Object.freeze({ id: "claude", managedSet: CLAUDE_MANAGED_SET, projectDir: Object.freeze({ envVar: "CLAUDE_PROJECT_DIR", fallback: "asset-root" }), marker: MANAGED_MARKER }), codex: Object.freeze({ id: "codex", managedSet: CODEX_MANAGED_SET, projectDir: Object.freeze({ envVar: null, fallback: "cwd" }), marker: "// javi-forge-managed: codex-pretooluse v1" }) });
// Fail-closed agent selector: a missing/unknown --agent means we cannot know what to protect, so refuse.
function resolveAgentConfig(argv) { const arg = argv.find((value) => typeof value === "string" && value.startsWith("--agent=")); const id = arg === undefined ? undefined : arg.slice("--agent=".length); const config = id === undefined ? undefined : AGENT_CONFIGS[id]; if (!config) fail("invalid-config"); return config; }
// Project root per agent: the env var when set (Claude = CLAUDE_PROJECT_DIR); otherwise the per-agent
// fallback decides. "asset-root" anchors to the asset-relative PROJECT_ROOT so Claude is byte-identical
// to the pre-extraction guard whether the env var is set OR unset (closing the cwd-divergence gap);
// "cwd" uses the envelope cwd (codex, whose user-global asset has no asset-relative project root and no
// env var). Fail-safe: an unknown/missing fallback anchors to the stricter PROJECT_ROOT, never looser.
function resolveProjectRoot(config, cwd) { const envVar = config.projectDir.envVar; if (envVar) { const value = process.env[envVar]; if (typeof value === "string" && value.length > 0) return value; } if (config.projectDir.fallback === "cwd") return cwd ?? PROJECT_ROOT; return PROJECT_ROOT; }
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
	// Strip Windows device aliases (\??\, \\?\, \\.\) BEFORE native realpath:
	// on a real win32 host nativeRealpath resolves an unstripped \??\ against the
	// current drive (D:\??\C:\...), so the alias must be canonicalized first or a
	// \??\-prefixed path to a secret would evade sensitive/managed detection.
	const windowsInput = platform === "win32" || WINDOWS_DRIVE.test(expanded) || WINDOWS_UNC.test(expanded) || /^\\(?:\\\?|\?\?|\\\.)\\/i.test(expanded);
	if (windowsInput) expanded = normalizeWindowsAlias(expanded);
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
// Home-relative credential files, matched as a path SUFFIX (never an expanded
// literal home) so one rule holds for every user, container and HOME. Literals
// stay lowercase because lexicalNormalize folds keys on darwin/win32.
const SENSITIVE_PATH_SUFFIXES = Object.freeze(["/.aws/credentials", "/.kube/config", "/.config/gcloud/application_default_credentials.json", "/.docker/config.json", "/.config/gh/hosts.yml"]);
// Absolute system secrets: the shadow suite holds every local account's password
// hash, and passwd/vipw leave the "-" backup beside it holding the same secret.
const SENSITIVE_ABSOLUTE_KEYS = Object.freeze(["/etc/shadow", "/etc/shadow-", "/etc/gshadow", "/etc/gshadow-"]);
// /proc/<pid>/environ is the FULL environment - every secret - of ANY process the
// agent can see, so it is a first-class exfiltration sink. The corpus idiom is
// literal matching; this is the one place a wildcard is unavoidable because the
// pid component is unbounded. Kept narrow (environ leaves only) and fail-closed:
// it covers the self/thread-self aliases and the per-thread task/<tid> form.
const PROC_ENVIRON_KEY = /^\/proc\/(?:\d+|self|thread-self)\/(?:task\/\d+\/)?environ$/;
// Secret Service / GNOME keyring store: every file under it is credential
// material, so the directory itself and its whole subtree are sensitive.
const SENSITIVE_DIRECTORY_SUFFIXES = Object.freeze(["/.local/share/keyrings"]);
export function isSensitivePolicyKey(key, platform = process.platform) {
	const parts = key.split("/").filter(Boolean);
	const basename = parts.at(-1) ?? "";
	if (/^\.env(?:\..+)?$/i.test(basename) && !/^\.env\.(?:example|sample|template)$/i.test(basename)) return true;
	if ([".npmrc", ".pypirc", ".netrc", ".git-credentials"].includes(basename.toLowerCase())) return true;
	if (parts.some((part) => part === ".ssh" || part === ".gnupg")) return true;
	if (SENSITIVE_ABSOLUTE_KEYS.includes(key) || PROC_ENVIRON_KEY.test(key)) return true;
	if (SENSITIVE_PATH_SUFFIXES.some((suffix) => key.endsWith(suffix))) return true;
	if (SENSITIVE_DIRECTORY_SUFFIXES.some((directory) => key.endsWith(directory) || key.includes(`${directory}/`))) return true;
	return platform === "win32" || platform === "darwin" ? basename.toLowerCase() === "serviceaccountkey.json" : basename === "serviceAccountKey.json";
}
function isManaged(key, managedSet = CLAUDE_MANAGED_SET, projectRoot = PROJECT_ROOT) {
	const project = canonicalizePolicyPath(projectRoot);
	if (!key.startsWith(`${project}/`) && key !== project) return false;
	const relative = key.slice(project.length + 1);
	// On case-insensitive platforms lexicalNormalize folds the key to lowercase,
	// so the mixed-case CLAUDE.md literals must be matched case-insensitively too
	// (the other literals are already lowercase). Otherwise CLAUDE.md and
	// .claude/CLAUDE.md lose managed-config protection on macOS/Windows.
	const foldedClaudeMd = (process.platform === "win32" || process.platform === "darwin") && managedSet.caseFoldExact.includes(relative);
	return foldedClaudeMd || managedSet.exact.includes(relative) || managedSet.prefixes.some((prefix) => relative.startsWith(prefix));
}
function evaluateFile(toolName, filePath, config = AGENT_CONFIGS.claude, projectRoot = PROJECT_ROOT) {
	const keys = policyPathKeys(filePath);
	if (keys.some((key) => isSensitivePolicyKey(key))) return { allowed: false, ruleId: "path.sensitive" };
	if (toolName !== "Read" && keys.some((key) => isManaged(key, config.managedSet, projectRoot))) return { allowed: false, ruleId: "path.managed-config" };
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
		if (char === "\\" && quote !== "'" && !powershell) { if (quote === '"' && !/[$`"\\\n]/.test(command[index + 1] ?? "")) token += "\\"; else escaped = true; continue; }
		if (char === "`" && quote !== "'" && powershell) { escaped = true; continue; }
		if (quote) { if (char === quote) quote = ""; else token += char; continue; }
		if (char === "'" || char === '"') { quote = char; continue; }
		if (char === "|" && command[index + 1] === "|") { split("||"); index++; continue; }
		if (char === "|" && command[index + 1] === "&") { split("|"); index++; continue; } // bash `|&` pipes stdout+stderr; a real pipe for policy
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
// The pre-redesign boolean helpers (parseEnvSplit/hasChmodRecursive/hasBase64Decode
// and their isLongPrefix/splitEnvString internals) were replaced by the semantic
// state machines below; only ENV_ESCAPES survives, shared with splitEnvSemantics.
const ENV_ESCAPES = Object.freeze({ f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "#": "#", $: "$", _: " ", '"': '"', "'": "'", "\\": "\\" });
// =====================================================================
// Utility profile registry + shared semantic primitives (tasks 2.1-2.2)
//
// Fixed, host-independent GNU Coreutils 9.4 and Apple dated-snapshot
// profile bindings plus the shared primitives the per-profile state
// machines (tasks 2.3-2.5) consume: literal identity normalization,
// exact/unique-prefix long-option matching, the consumed-argument
// recorder, and the danger-dominant profile-union reducer.
//
// WU2-B (tasks 2.3-2.6) adds the three bounded state machines, the env
// split-string character machine with its cumulative split-work bound,
// and the protected-sink adapter wired into evaluateBash. Identity
// rejection evidence (`non-literal-identity`, `unsupported-utility`) and
// the machine-produced evidence codes are pinned by the semantic corpus.
// =====================================================================
const OVERALL_CLASS = Object.freeze({ SAFE: "safe", DANGEROUS: "dangerous", AMBIGUOUS: "ambiguous" });
const PROFILE_STATUS = Object.freeze({ ACCEPTED_SAFE: "accepted-safe", ACCEPTED_DANGEROUS: "accepted-dangerous", REJECTED: "rejected-by-profile", UNSUPPORTED: "unsupported" });
const UTILITY = Object.freeze({ ENV: "env", CHMOD: "chmod", BASE64: "base64", UNSUPPORTED: "unsupported" });
const SINK = Object.freeze({ WRAPPER: "wrapper-extraction", CRITICAL_CHMOD: "critical-chmod", BASE64_SHELL: "base64-to-shell" });
function deepFreeze(value) {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key]);
	}
	return value;
}
const GNU_COREUTILS_9_4_SOURCE = { publisher: "GNU", artifact: "GNU Coreutils manual (doc/coreutils.texi)", version: "Coreutils 9.4", sourceReference: "GNU Coreutils 9.4 release tarball / gnu.org Coreutils manual, 9.4 node set" };
const APPLE_CHMOD_SOURCE = { publisher: "Apple", artifact: "chmod(1)", version: "2017-01-07", sourceReference: "Apple public man page (xcode-man-pages mirror), chmod.1, dated January 7, 2017" };
const APPLE_BINTRANS_SOURCE = { publisher: "Apple", artifact: "bintrans(1)", version: "2022-04-18", sourceReference: "Apple public man page (xcode-man-pages mirror), bintrans.1, dated April 18, 2022" };
const GNU_CHMOD_TABLE = {
	longOptions: [
		{ name: "changes", type: "flag" }, { name: "help", type: "flag" }, { name: "no-preserve-root", type: "flag" },
		{ name: "preserve-root", type: "flag" }, { name: "quiet", type: "flag" }, { name: "recursive", type: "flag" },
		{ name: "reference", type: "arg" }, { name: "silent", type: "flag" }, { name: "verbose", type: "flag" }, { name: "version", type: "flag" },
	],
	shortOptions: { R: { type: "flag" }, c: { type: "flag" }, f: { type: "flag" }, v: { type: "flag" } },
};
const GNU_BASE64_TABLE = {
	longOptions: [
		{ name: "decode", type: "flag" }, { name: "help", type: "flag" }, { name: "ignore-garbage", type: "flag" },
		{ name: "version", type: "flag" }, { name: "wrap", type: "arg" },
	],
	shortOptions: { d: { type: "flag" }, i: { type: "flag" }, w: { type: "arg" } },
};
export const UTILITY_PROFILE_REGISTRY = deepFreeze([
	{
		id: "gnu-env-v1", utility: "env", mode: "default",
		source: { ...GNU_COREUTILS_9_4_SOURCE, section: "env invocation" },
		longOptions: [
			{ name: "argv0", type: "arg" }, { name: "chdir", type: "arg" }, { name: "debug", type: "flag" }, { name: "help", type: "flag" },
			{ name: "ignore-environment", type: "flag" }, { name: "null", type: "flag" }, { name: "split-string", type: "arg" },
			{ name: "unset", type: "arg" }, { name: "version", type: "flag" },
		],
		shortOptions: { 0: { type: "flag" }, a: { type: "arg" }, C: { type: "arg" }, i: { type: "flag" }, S: { type: "arg" }, u: { type: "arg" }, v: { type: "flag" } },
	},
	{ id: "gnu-chmod-default-v1", utility: "chmod", mode: "default", source: { ...GNU_COREUTILS_9_4_SOURCE, section: "chmod invocation" }, ...GNU_CHMOD_TABLE },
	{ id: "gnu-chmod-posix-v1", utility: "chmod", mode: "posixly-correct", source: { ...GNU_COREUTILS_9_4_SOURCE, section: "chmod invocation" }, ...GNU_CHMOD_TABLE },
	{
		id: "apple-chmod-v1", utility: "chmod", mode: "apple", source: { ...APPLE_CHMOD_SOURCE, section: "SYNOPSIS" },
		longOptions: [],
		shortOptions: { C: { type: "flag" }, E: { type: "flag" }, H: { type: "flag" }, I: { type: "flag" }, L: { type: "flag" }, N: { type: "flag" }, P: { type: "flag" }, R: { type: "flag" }, f: { type: "flag" }, h: { type: "flag" }, i: { type: "flag" }, v: { type: "flag" } },
	},
	{ id: "gnu-base64-default-v1", utility: "base64", mode: "default", source: { ...GNU_COREUTILS_9_4_SOURCE, section: "base64 invocation" }, ...GNU_BASE64_TABLE },
	{ id: "gnu-base64-posix-v1", utility: "base64", mode: "posixly-correct", source: { ...GNU_COREUTILS_9_4_SOURCE, section: "base64 invocation" }, ...GNU_BASE64_TABLE },
	{
		id: "apple-base64-v1", utility: "base64", mode: "apple", source: { ...APPLE_BINTRANS_SOURCE, section: "base64" },
		longOptions: [
			{ name: "break", type: "arg" }, { name: "decode", type: "flag" }, { name: "help", type: "flag" }, { name: "ignore-garbage", type: "flag" },
			{ name: "input", type: "arg" }, { name: "output", type: "arg" }, { name: "wrap", type: "arg" },
		],
		shortOptions: { D: { type: "flag" }, b: { type: "arg" }, d: { type: "flag" }, h: { type: "flag" }, i: { type: "arg" }, o: { type: "arg" }, w: { type: "arg" } },
	},
]);
const NON_LITERAL_IDENTITY_MARKERS = /[$`*?\[\]{};|&<>()\n\r\0]/;
export function normalizeLiteralUtilityIdentity(rawToken) {
	// Lexical-only: split on "/" without path/realpath/PATH/alias resolution.
	// Basename compare is case-insensitive and host-independent so inherited
	// deny families still fire for CHMOD/ENV/BASE64 on case-insensitive
	// filesystems, mirroring the darwin/win32 path folding lexicalNormalize
	// already applies. The canonical lowercase utility feeds profile lookup.
	const token = typeof rawToken === "string" ? rawToken : "";
	const literal = token.length > 0 && !NON_LITERAL_IDENTITY_MARKERS.test(token);
	const component = token.split("/").filter(Boolean);
	const basename = literal ? (component.at(-1) ?? "") : "";
	const canonical = basename.toLowerCase();
	const utility = literal && (canonical === "env" || canonical === "chmod" || canonical === "base64") ? canonical : UTILITY.UNSUPPORTED;
	return { rawToken: token, basename, utility, literal, pathQualified: token.includes("/") };
}
export function matchLongOption(token, longOptions) {
	// Exact/unique-prefix matching over the committed long names. Accepts
	// only when exactly one committed name starts with the supplied name
	// and the attached `=value` form is permitted by that option's type.
	// Returns null for zero/multiple matches or a disallowed argument form
	// (the profile machine records that as rejected-by-profile).
	if (typeof token !== "string" || !token.startsWith("--") || token === "--") return null;
	const equal = token.indexOf("=");
	const supplied = token.slice(2, equal < 0 ? undefined : equal);
	if (!supplied) return null;
	const value = equal < 0 ? null : token.slice(equal + 1);
	const matches = longOptions.filter((option) => option.name.startsWith(supplied));
	if (matches.length !== 1) return null;
	const option = matches[0];
	if (value !== null && option.type !== "arg") return null;
	return { option, name: option.name, value };
}
function consumedArgument(option, tokenIndex, source, role, value) {
	return { option, tokenIndex, source, role, value };
}
export function reduceProfileUnion(results = []) {
	const acceptedFacts = results.filter((result) => result && (result.status === PROFILE_STATUS.ACCEPTED_SAFE || result.status === PROFILE_STATUS.ACCEPTED_DANGEROUS));
	const utility = results[0]?.applicability?.utility ?? UTILITY.UNSUPPORTED;
	// Union classification uses "unsupported", not OVERALL_CLASS.AMBIGUOUS:
	// ambiguity is decided later by the protected-sink adapter, never by the union.
	let classification = "unsupported";
	if (acceptedFacts.some((result) => result.status === PROFILE_STATUS.ACCEPTED_DANGEROUS)) classification = "dangerous";
	else if (acceptedFacts.length > 0) classification = "safe";
	return { classification, utility, results, acceptedFacts };
}
function identityEvidence(identity) {
	return [{
		status: PROFILE_STATUS.UNSUPPORTED,
		applicability: { profileId: "unsupported", utility: identity.utility, mode: "unsupported", applicable: false },
		evidence: { code: identity.literal ? "unsupported-utility" : "non-literal-identity", phase: "identity" },
	}];
}
function profilesFor(utility) {
	return UTILITY_PROFILE_REGISTRY.filter((profile) => profile.utility === utility);
}
function profileApplicability(profile) {
	return { profileId: profile.id, utility: profile.utility, mode: profile.mode, applicable: true };
}
function classifyLongOption(token, longOptions) {
	const match = matchLongOption(token, longOptions);
	if (match) return { kind: "match", option: match.option, name: match.name, value: match.value };
	const equal = token.indexOf("=");
	const supplied = token.slice(2, equal < 0 ? undefined : equal);
	const matches = supplied ? longOptions.filter((option) => option.name.startsWith(supplied)) : [];
	return { kind: matches.length > 1 ? "ambiguous" : "unknown" };
}
const ASSIGNMENT_TOKEN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHORT_BUNDLE = /^-[^-]/;
// FHS roots whose wholesale destruction bricks the host. CRITICAL_TARGET gates
// ONLY destructive writes (rm -rf, recursive/777 chmod) and never reads, and
// membership is exact-token, so `rm -rf /var/tmp/scratch` stays allowed: only the
// root token itself is protected, in the same bare / trailing / glob forms as "/".
const CRITICAL_SYSTEM_ROOTS = ["/etc", "/usr", "/var", "/boot"];
const CRITICAL_TARGET_CORPUS = Object.freeze(["/", "/*", "~", "$HOME", "${HOME}", ".", "..", PROJECT_ROOT, ...CRITICAL_SYSTEM_ROOTS.flatMap((root) => [root, `${root}/`, `${root}/*`])]);
const isCriticalTarget = (token) => CRITICAL_TARGET_CORPUS.includes(token);
const OCTAL_MODE_SHAPE = /^0?[0-7]{3,4}$/;
const SYMBOLIC_MODE_SHAPE = /^[ugoa]*[+=-][rwxXstugo]+(?:,[ugoa]*[+=-][rwxXstugo]+)*$/;
const isModeShaped = (token) => OCTAL_MODE_SHAPE.test(token) || SYMBOLIC_MODE_SHAPE.test(token);
const ENV_SPLIT_WHITESPACE = " \t\n\v\f\r";
function splitEnvSemantics(input) {
	const words = [];
	let word = "", quote = "", started = false, stopped = false;
	const push = () => { if (started) words.push(word); word = ""; started = false; };
	for (let index = 0; index < input.length; index++) {
		const char = input[index];
		if (quote === "'") { if (char === "'") quote = ""; else word += char; continue; }
		if (quote === '"' && char === '"') { quote = ""; continue; }
		if (!quote && (char === "'" || char === '"')) { quote = char; started = true; continue; }
		if (char === "\\") {
			const escape = input[index + 1];
			if (escape === undefined) return { error: "env-unsupported-escape" };
			index++;
			if (escape === "c") { if (quote) return { error: "env-unsupported-escape" }; stopped = true; break; }
			if (!(escape in ENV_ESCAPES)) return { error: "env-unsupported-escape" };
			if (escape === "_") { if (quote) { word += " "; started = true; } else push(); continue; }
			word += ENV_ESCAPES[escape]; started = true;
			continue;
		}
		if (char === "$") return { error: "env-active-expansion" };
		if (!quote && ENV_SPLIT_WHITESPACE.includes(char)) { push(); continue; }
		if (!quote && char === "#" && !started) break;
		word += char; started = true;
	}
	if (quote) return { error: "env-unclosed-quote" };
	push();
	return { words, stopped };
}
function runEnvMachine(profile, tokens) {
	const applicability = profileApplicability(profile);
	const unsupported = (code, phase, tokenIndex) => ({ status: PROFILE_STATUS.UNSUPPORTED, applicability, evidence: tokenIndex === undefined ? { code, phase } : { code, phase, tokenIndex } });
	const queue = tokens.slice(1);
	// Cumulative split-work bound: splitOps <= 32 AND splitBytes <= 8N over the
	// outer argv byte count, enforced across every nested -S splice.
	const splitByteBudget = 8 * queue.reduce((total, token) => total + Buffer.byteLength(token, "utf8"), 0);
	const facts = { utility: UTILITY.ENV, wrapperOptions: [], assignments: [], consumedArguments: [], delimiter: { seen: false }, eventualExecutable: null, eventualArgv: [], activeExpansion: false, terminatedByControlEscape: false };
	let splitOps = 0, splitBytes = 0, index = 0;
	const takeSplit = (value, tokenIndex, source) => {
		splitOps += 1;
		splitBytes += Buffer.byteLength(value, "utf8");
		if (splitOps > 32 || splitBytes > splitByteBudget) return unsupported("split-work-limit", "split", tokenIndex);
		const parsed = splitEnvSemantics(value);
		if (parsed.error) return unsupported(parsed.error, "split", tokenIndex);
		facts.splitInput ??= consumedArgument("split-string", tokenIndex, source, "split-string", value);
		if (parsed.stopped) facts.terminatedByControlEscape = true;
		queue.splice(index, 0, ...parsed.words);
		return null;
	};
	while (index < queue.length) {
		const token = queue[index];
		if (token === "--") { facts.delimiter = { seen: true, tokenIndex: index }; index++; break; }
		if (token === "-") { facts.wrapperOptions.push("-"); index++; continue; } // GNU: a bare - implies -i, never the command
		if (ASSIGNMENT_TOKEN.test(token)) { facts.assignments.push(token); index++; continue; }
		if (token.startsWith("--")) {
			const match = classifyLongOption(token, profile.longOptions);
			if (match.kind !== "match") return unsupported("env-unsupported-option", "wrapper", index);
			const optionIndex = index;
			index++;
			if (match.option.type !== "arg") { facts.wrapperOptions.push(match.name); continue; }
			let value = match.value, source = "attached";
			if (value === null) { if (index >= queue.length) return unsupported("env-missing-argument", "option", optionIndex); value = queue[index]; queue.splice(index, 1); source = "next-token"; }
			if (match.name === "split-string") { const stop = takeSplit(value, optionIndex, source); if (stop) return stop; continue; }
			facts.consumedArguments.push(consumedArgument(match.name, optionIndex, source, "other", value));
			continue;
		}
		if (SHORT_BUNDLE.test(token)) {
			const bundleIndex = index;
			index++;
			let stop = null;
			for (let position = 1; position < token.length; position++) {
				const short = token[position];
				const spec = profile.shortOptions[short];
				if (!spec) { stop = unsupported("env-unsupported-option", "wrapper", bundleIndex); break; }
				if (spec.type === "flag") { facts.wrapperOptions.push(short); continue; }
				let value, source;
				if (position + 1 < token.length) { value = token.slice(position + 1); source = "attached"; }
				else if (index < queue.length) { value = queue[index]; queue.splice(index, 1); source = "next-token"; }
				else { stop = unsupported("env-missing-argument", "option", bundleIndex); break; }
				if (short === "S") stop = takeSplit(value, bundleIndex, source);
				else facts.consumedArguments.push(consumedArgument(short, bundleIndex, source, "other", value));
				break;
			}
			if (stop) return stop;
			continue;
		}
		break;
	}
	if (index < queue.length) { facts.eventualExecutable = queue[index]; facts.eventualArgv = queue.slice(index + 1); }
	return { status: PROFILE_STATUS.ACCEPTED_SAFE, applicability, facts };
}
function conservativePossibleTargets(tokens) {
	return tokens.slice(1).filter(isCriticalTarget);
}
function assessChmodProfile(applicability, state) {
	// Low 777 (world rwx) is the danger; setuid/setgid/sticky prefixes (4777, 2777,
	// 1777, 00777, …) on a critical root are equally dangerous, so match any leading
	// special/zero octal digits before 777.
	const mode777 = state.mode !== undefined && /^[0-7]{0,2}777$/.test(state.mode);
	const roles = { targets: state.targets, possibleTargets: [] };
	if (state.mode !== undefined) roles.mode = state.mode;
	if (state.reference !== undefined) roles.reference = state.reference;
	const dangerous = state.targets.some(isCriticalTarget) && (state.recursive || mode777);
	return { status: dangerous ? PROFILE_STATUS.ACCEPTED_DANGEROUS : PROFILE_STATUS.ACCEPTED_SAFE, applicability, facts: { utility: UTILITY.CHMOD, recursive: state.recursive, mode777, roles, consumedArguments: state.consumedArguments, delimiter: state.delimiter } };
}
function runGnuChmodMachine(profile, tokens) {
	const applicability = profileApplicability(profile);
	const posix = profile.mode === "posixly-correct";
	const consumedArguments = [];
	const operands = [];
	let delimiter = { seen: false };
	let recursive = false, reference, recognizing = true;
	const rejected = (reasonCode) => ({ status: PROFILE_STATUS.REJECTED, applicability, reasonCode, partialRoles: { targets: [...operands], possibleTargets: conservativePossibleTargets(tokens) } });
	for (let index = 1; index < tokens.length; index++) {
		const token = tokens[index];
		if (recognizing && token === "--") { delimiter = { seen: true, tokenIndex: index }; recognizing = false; continue; }
		if (recognizing && token.startsWith("--")) {
			const match = classifyLongOption(token, profile.longOptions);
			if (match.kind === "ambiguous") return rejected("ambiguous-long-option");
			if (match.kind !== "match") return rejected("unknown-long-option");
			if (match.option.type === "arg") {
				let value = match.value, source = "attached";
				if (value === null) { if (index + 1 >= tokens.length) return rejected("missing-option-argument"); value = tokens[++index]; source = "next-token"; }
				if (match.name === "reference") reference = value;
				consumedArguments.push(consumedArgument(match.name, index, source, match.name === "reference" ? "reference" : "other", value));
			} else if (match.name === "recursive") recursive = true;
			continue;
		}
		if (recognizing && SHORT_BUNDLE.test(token)) {
			for (let position = 1; position < token.length; position++) {
				if (!profile.shortOptions[token[position]]) return rejected("unknown-short-option");
				if (token[position] === "R") recursive = true;
			}
			continue;
		}
		operands.push(token);
		if (posix) recognizing = false;
	}
	if (reference !== undefined) {
		const modeCandidate = operands.findIndex(isModeShaped);
		if (modeCandidate >= 0) {
			const targets = operands.filter((_, position) => position !== modeCandidate);
			return { status: PROFILE_STATUS.REJECTED, applicability, reasonCode: "mixed-mode-reference", partialRoles: { mode: operands[modeCandidate], reference, targets, possibleTargets: [...targets] } };
		}
		return assessChmodProfile(applicability, { recursive, mode: undefined, reference, targets: [...operands], consumedArguments, delimiter });
	}
	return assessChmodProfile(applicability, { recursive, mode: operands[0], reference: undefined, targets: operands.slice(1), consumedArguments, delimiter });
}
function runAppleChmodMachine(profile, tokens) {
	const applicability = profileApplicability(profile);
	const partialRoles = { targets: [], possibleTargets: conservativePossibleTargets(tokens) };
	if (tokens.slice(1).some((token) => token.startsWith("--"))) return { status: PROFILE_STATUS.REJECTED, applicability, reasonCode: "long-option-unsupported", partialRoles };
	const aclEvidence = (tokenIndex) => ({ status: PROFILE_STATUS.UNSUPPORTED, applicability, evidence: { code: "chmod-acl-mode", phase: "roles", tokenIndex }, partialRoles });
	const operands = [];
	let recursive = false, recognizing = true;
	for (let index = 1; index < tokens.length; index++) {
		const token = tokens[index];
		if (recognizing && SHORT_BUNDLE.test(token)) {
			for (let position = 1; position < token.length; position++) {
				if (token[position] === "a") return aclEvidence(index);
				if (!profile.shortOptions[token[position]]) return { status: PROFILE_STATUS.REJECTED, applicability, reasonCode: "unknown-short-option", partialRoles };
				if (token[position] === "R") recursive = true;
			}
			continue;
		}
		recognizing = false;
		if (/^[+=]a|^-a/.test(token)) return aclEvidence(index);
		operands.push(token);
	}
	return assessChmodProfile(applicability, { recursive, mode: operands[0], reference: undefined, targets: operands.slice(1), consumedArguments: [], delimiter: { seen: false } });
}
function runGnuBase64Machine(profile, tokens) {
	const applicability = profileApplicability(profile);
	const posix = profile.mode === "posixly-correct";
	const booleanOptions = [];
	const operands = [];
	const consumedArguments = [];
	let delimiter = { seen: false };
	let decode = false, recognizing = true;
	const rejected = (reasonCode) => ({ status: PROFILE_STATUS.REJECTED, applicability, reasonCode });
	for (let index = 1; index < tokens.length; index++) {
		const token = tokens[index];
		if (recognizing && token === "--") { delimiter = { seen: true, tokenIndex: index }; recognizing = false; continue; }
		if (recognizing && token.startsWith("--")) {
			const match = classifyLongOption(token, profile.longOptions);
			if (match.kind === "ambiguous") return rejected("ambiguous-long-option");
			if (match.kind !== "match") return rejected("unknown-long-option");
			if (match.option.type === "arg") {
				let value = match.value, source = "attached";
				if (value === null) { if (index + 1 >= tokens.length) return rejected("missing-option-argument"); value = tokens[++index]; source = "next-token"; }
				consumedArguments.push(consumedArgument(match.name, index, source, match.name === "wrap" ? "wrap" : "other", value));
			} else if (match.name === "decode") decode = true;
			else booleanOptions.push(match.name);
			continue;
		}
		if (recognizing && SHORT_BUNDLE.test(token)) {
			for (let position = 1; position < token.length; position++) {
				const short = token[position];
				const spec = profile.shortOptions[short];
				if (!spec) return rejected("unknown-short-option");
				if (spec.type === "flag") { if (short === "d") decode = true; else booleanOptions.push(short); continue; }
				let value, source;
				if (position + 1 < token.length) { value = token.slice(position + 1); source = "attached"; }
				else if (index + 1 < tokens.length) { value = tokens[++index]; source = "next-token"; }
				else return rejected("missing-option-argument");
				consumedArguments.push(consumedArgument(short, index, source, short === "w" ? "wrap" : "other", value));
				break;
			}
			continue;
		}
		operands.push(token);
		if (posix) recognizing = false;
	}
	return { status: PROFILE_STATUS.ACCEPTED_SAFE, applicability, facts: { utility: UTILITY.BASE64, decode, booleanOptions, operands, consumedArguments, delimiter } };
}
const APPLE_BASE64_ARGUMENT_ROLES = Object.freeze({ b: "wrap", i: "input", o: "output", w: "wrap", break: "wrap", input: "input", output: "output", wrap: "wrap" });
function runAppleBase64Machine(profile, tokens) {
	const applicability = profileApplicability(profile);
	const booleanOptions = [];
	const operands = [];
	const consumedArguments = [];
	let decode = false, recognizing = true;
	const rejected = (reasonCode) => ({ status: PROFILE_STATUS.REJECTED, applicability, reasonCode });
	for (let index = 1; index < tokens.length; index++) {
		const token = tokens[index];
		if (recognizing && token === "--") return rejected("delimiter-unsupported");
		if (recognizing && token.startsWith("--")) {
			const equal = token.indexOf("=");
			const name = token.slice(2, equal < 0 ? undefined : equal);
			const option = profile.longOptions.find((entry) => entry.name === name);
			if (!option) return rejected("unknown-long-option");
			const attached = equal < 0 ? null : token.slice(equal + 1);
			if (attached !== null && option.type !== "arg") return rejected("unknown-long-option");
			if (option.type === "arg") {
				let value = attached, source = "attached";
				if (value === null) { if (index + 1 >= tokens.length) return rejected("missing-option-argument"); value = tokens[++index]; source = "next-token"; }
				consumedArguments.push(consumedArgument(name, index, source, APPLE_BASE64_ARGUMENT_ROLES[name] ?? "other", value));
			} else if (name === "decode") decode = true;
			else booleanOptions.push(name);
			continue;
		}
		if (recognizing && SHORT_BUNDLE.test(token)) {
			for (let position = 1; position < token.length; position++) {
				const short = token[position];
				const spec = profile.shortOptions[short];
				if (!spec) return rejected("unknown-short-option");
				if (spec.type === "flag") { if (short === "d" || short === "D") decode = true; if (short !== "d") booleanOptions.push(short); continue; }
				let value, source;
				if (position + 1 < token.length) { value = token.slice(position + 1); source = "attached"; }
				else if (index + 1 < tokens.length) { value = tokens[++index]; source = "next-token"; }
				else return rejected("missing-option-argument");
				consumedArguments.push(consumedArgument(short, index, source, APPLE_BASE64_ARGUMENT_ROLES[short] ?? "other", value));
				break;
			}
			continue;
		}
		recognizing = false;
		operands.push(token);
	}
	return { status: PROFILE_STATUS.ACCEPTED_SAFE, applicability, facts: { utility: UTILITY.BASE64, decode, booleanOptions, operands, consumedArguments, delimiter: { seen: false } } };
}
export function normalizeEnvInvocation(tokens = []) {
	const identity = normalizeLiteralUtilityIdentity(tokens[0] ?? "");
	if (identity.utility !== UTILITY.ENV) return identityEvidence(identity);
	return profilesFor(UTILITY.ENV).map((profile) => runEnvMachine(profile, tokens));
}
export function normalizeChmodInvocation(tokens = []) {
	const identity = normalizeLiteralUtilityIdentity(tokens[0] ?? "");
	if (identity.utility !== UTILITY.CHMOD) return identityEvidence(identity);
	return profilesFor(UTILITY.CHMOD).map((profile) => (profile.mode === "apple" ? runAppleChmodMachine(profile, tokens) : runGnuChmodMachine(profile, tokens)));
}
export function normalizeBase64Invocation(tokens = []) {
	const identity = normalizeLiteralUtilityIdentity(tokens[0] ?? "");
	if (identity.utility !== UTILITY.BASE64) return identityEvidence(identity);
	return profilesFor(UTILITY.BASE64).map((profile) => (profile.mode === "apple" ? runAppleBase64Machine(profile, tokens) : runGnuBase64Machine(profile, tokens)));
}
function firstUnsupportedProfileId(results) {
	return results.find((result) => result.status === PROFILE_STATUS.UNSUPPORTED)?.applicability.profileId ?? "unsupported";
}
function ambiguityDecision(context) {
	// Fixed enums only (reason/utility/profile/sink); carried non-enumerable so
	// the public Decision shape stays exactly { allowed, ruleId }.
	const decision = { allowed: false, ruleId: "utility-ambiguity" };
	Object.defineProperty(decision, "ambiguity", { value: Object.freeze(context), enumerable: false });
	return decision;
}
function adaptProtectedSink(utility, results, union, sink) {
	if (union.classification === "dangerous") return { allowed: false, ruleId: sink.dangerousRuleId };
	if (union.classification !== "unsupported" || !sink.applicable) return null;
	return ambiguityDecision({ utility, profile: firstUnsupportedProfileId(results), sink: sink.id });
}
function reduceWrappers(input, powershell = false) {
	let tokens = [...input];
	if (powershell) while (tokens[0] === "&") tokens.shift();
	for (let hops = 0; ; hops++) {
		if (hops > 32) return { tokens: null, ambiguity: { utility: UTILITY.UNSUPPORTED, profile: "unsupported", sink: SINK.WRAPPER } };
		while (ASSIGNMENT_TOKEN.test(tokens[0] ?? "")) tokens.shift();
		if (normalizeLiteralUtilityIdentity(tokens[0] ?? "").utility === UTILITY.ENV) {
			const [result] = normalizeEnvInvocation(tokens);
			if (result.status !== PROFILE_STATUS.ACCEPTED_SAFE) return { tokens: null, ambiguity: { utility: UTILITY.ENV, profile: result.applicability.profileId, sink: SINK.WRAPPER } };
			if (result.facts.eventualExecutable === null) return { tokens: [] };
			tokens = [result.facts.eventualExecutable, ...result.facts.eventualArgv];
			continue;
		}
		const wrapper = (tokens[0] ?? "").toLowerCase();
		if (!["sudo", "command", "builtin", "nohup"].includes(wrapper)) break;
		tokens.shift();
		for (;;) {
			if (tokens[0] === "--" || ASSIGNMENT_TOKEN.test(tokens[0] ?? "")) { tokens.shift(); continue; }
			if (wrapper === "sudo" && /^(?:-u|-g|-h|-p|-C|-D|-R|-T|-r|-t|--user|--group|--host|--prompt|--chdir|--chroot|--command-timeout|--role|--type)$/.test(tokens[0] ?? "")) { tokens.splice(0, 2); continue; }
			if (tokens[0]?.startsWith("-") && tokens[0] !== "--") { tokens.shift(); continue; }
			break;
		}
	}
	return { tokens };
}
function hasSensitiveLiteral(tokens, cwd, projectRoot = PROJECT_ROOT) {
	return tokens.some((token) => {
		if ((token.startsWith("-") && !/^-(?:LiteralPath|Path):/i.test(token)) || !/[\\/.~$]/.test(token)) return false;
		try {
			return isSensitivePolicyKey(canonicalizePolicyPath(token.replace(/^(?:-LiteralPath:|-Path:)/i, "").replace(/[;,]$/, ""), { base: cwd, projectRoot }));
		} catch {
			return false;
		}
	});
}
function hasManagedLiteral(tokens, cwd, config = AGENT_CONFIGS.claude, projectRoot = PROJECT_ROOT) {
	return tokens.some((token) => {
		if ((token.startsWith("-") && !/^-(?:LiteralPath|Path):/i.test(token)) || !/[\\/.]/.test(token)) return false;
		try {
			return isManaged(canonicalizePolicyPath(token.replace(/^(?:-LiteralPath:|-Path:)/i, "").replace(/[;,]$/, ""), { base: cwd, projectRoot }), config.managedSet, projectRoot);
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
function evaluateBash(command, cwd, config = AGENT_CONFIGS.claude, projectRoot = PROJECT_ROOT, depth = 0) {
	if (depth > 4) return { allowed: false, ruleId: "shell.obfuscated-interpreter" };
	try { for (const body of bashSubstitutions(command)) { const nested = evaluateBash(body, cwd, config, projectRoot, depth + 1); if (!nested.allowed) return nested; } } catch { return { allowed: false, ruleId: "shell.obfuscated-interpreter" }; }
	if (/^\s*:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:\s*$/.test(command)) return { allowed: false, ruleId: "shell.destructive-root" };
	let parsed;
	try { parsed = lex(command); } catch { return { allowed: false, ruleId: "shell.obfuscated-interpreter" }; }
	for (let index = 0; index < parsed.commands.length; index++) {
		const reduced = reduceWrappers(parsed.commands[index]);
		if (reduced.ambiguity) return ambiguityDecision(reduced.ambiguity);
		const tokens = reduced.tokens;
		const executable = (tokens[0] ?? "").toLowerCase();
		const identity = normalizeLiteralUtilityIdentity(tokens[0] ?? "");
		const rmOptions = tokens.filter((token) => token.startsWith("-")).join("");
		if ((executable === "rm" && /r/i.test(rmOptions) && /f/i.test(rmOptions) && tokens.some(isCriticalTarget)) || /^mkfs/.test(executable) || (executable === "dd" && tokens.some((token) => /^of=\/dev\/(?:sd|nvme|vd|disk)/.test(token)))) return { allowed: false, ruleId: "shell.destructive-root" };
		if (identity.utility === UTILITY.CHMOD) {
			const results = normalizeChmodInvocation(tokens);
			const union = reduceProfileUnion(results);
			const possibleCritical = results.some((result) => (result.partialRoles?.possibleTargets ?? []).some(isCriticalTarget));
			const decision = adaptProtectedSink(UTILITY.CHMOD, results, union, { id: SINK.CRITICAL_CHMOD, dangerousRuleId: "shell.destructive-root", applicable: possibleCritical });
			if (decision) return decision;
		}
		if (parsed.separators[index] === "|") {
			const downstream = reduceWrappers(parsed.commands[index + 1] ?? []).tokens ?? [];
			const shellSink = /^(?:sh|bash|zsh|dash|ksh)$/.test((downstream[0] ?? "").toLowerCase());
			if (identity.utility === UTILITY.BASE64) {
				const results = normalizeBase64Invocation(tokens).map((result) => (shellSink && result.status === PROFILE_STATUS.ACCEPTED_SAFE && result.facts.decode ? { ...result, status: PROFILE_STATUS.ACCEPTED_DANGEROUS } : result));
				const union = reduceProfileUnion(results);
				const decision = adaptProtectedSink(UTILITY.BASE64, results, union, { id: SINK.BASE64_SHELL, dangerousRuleId: "shell.pipe-to-shell", applicable: shellSink });
				if (decision) return decision;
			} else if (/^(?:curl|wget)$/.test(executable) && shellSink) return { allowed: false, ruleId: "shell.pipe-to-shell" };
		}
		if (["cat", "less", "more", "head", "tail", "bat", "grep", "rg", "sed", "awk", "source", ".", "cp", "install"].includes(executable) && hasSensitiveLiteral(tokens.slice(1), cwd, projectRoot)) return { allowed: false, ruleId: "shell.sensitive-read" };
		if (tokens.some((token) => token === "<") && hasSensitiveLiteral(tokens, cwd, projectRoot)) return { allowed: false, ruleId: "shell.sensitive-read" };
		if (executable === "git" && tokens[1]?.toLowerCase() === "push" && tokens.some((token) => ["-f", "--force", "--force-with-lease"].includes(token.toLowerCase()))) return { allowed: false, ruleId: "shell.force-push" };
		if (["rm", "mv", "cp", "install", "truncate", "touch", "chmod", "chown", "tee"].includes(executable) && hasManagedLiteral(tokens.slice(1), cwd, config, projectRoot)) return { allowed: false, ruleId: "shell.managed-config-tamper" };
		if ((/^(?:sed|perl)$/.test(executable) && tokens.some((token) => token.startsWith("-i")) && hasManagedLiteral(tokens, cwd, config, projectRoot)) || (tokens.includes(">") && hasManagedLiteral(tokens, cwd, config, projectRoot))) return { allowed: false, ruleId: "shell.managed-config-tamper" };
		if (/^(?:powershell|pwsh)(?:\.exe)?$/i.test(executable) && tokens.some((token) => /^-(?:enc|encodedcommand)$/i.test(token))) return { allowed: false, ruleId: "shell.obfuscated-interpreter" };
		if (/^(?:bash|sh|zsh|dash|ksh)$/.test(executable)) {
			const flag = tokens.findIndex((token) => /^-[^-]*c[^-]*$/.test(token));
			if (flag >= 0) { const body = tokens[flag + 1]; if (!body || /\$(?!\()/.test(body)) return { allowed: false, ruleId: "shell.obfuscated-interpreter" }; const nested = evaluateBash(body, cwd, config, projectRoot, depth + 1); if (!nested.allowed) return nested; }
		}
	}
	return { allowed: true };
}
function evaluatePowerShell(command, cwd, config = AGENT_CONFIGS.claude, projectRoot = PROJECT_ROOT) {
	const parsed = lex(command, true);
	for (let index = 0; index < parsed.commands.length; index++) {
		const reduced = reduceWrappers(parsed.commands[index], true);
		if (reduced.ambiguity) return ambiguityDecision(reduced.ambiguity);
		const tokens = reduced.tokens;
		const executable = (tokens[0] ?? "").toLowerCase();
		if ((["remove-item", "rm", "del", "erase", "rmdir", "rd"].includes(executable) && tokens.some((token) => /^-(?:r|recurse)$/i.test(token)) && tokens.some((token) => /^-(?:fo|force)$/i.test(token)) && tokens.some((token) => /^(?:[a-z]:\\?|[/~]|\$HOME)$/i.test(token))) || ["format-volume", "clear-disk", "initialize-disk"].includes(executable)) return { allowed: false, ruleId: "powershell.destructive-root" };
		if (parsed.separators[index] === "|" && /^(?:invoke-webrequest|iwr|curl|wget|invoke-restmethod|irm)$/.test(executable) && /^(?:invoke-expression|iex)$/.test(((reduceWrappers(parsed.commands[index + 1] ?? [], true).tokens ?? [])[0] ?? "").toLowerCase())) return { allowed: false, ruleId: "powershell.pipe-to-shell" };
		if (["get-content", "gc", "cat", "type", "select-string", "copy-item", "cp", "copy"].includes(executable) && hasSensitiveLiteral(tokens.slice(1), cwd, projectRoot)) return { allowed: false, ruleId: "powershell.sensitive-read" };
		if (executable === "git" && tokens[1]?.toLowerCase() === "push" && tokens.some((token) => ["-f", "--force", "--force-with-lease"].includes(token.toLowerCase()))) return { allowed: false, ruleId: "powershell.force-push" };
		if (["set-content", "add-content", "out-file", "clear-content", "remove-item", "move-item", "copy-item", "rename-item", "new-item"].includes(executable) && hasManagedLiteral(tokens.slice(1), cwd, config, projectRoot)) return { allowed: false, ruleId: "powershell.managed-config-tamper" };
		if (tokens.includes(">") && hasManagedLiteral(tokens, cwd, config, projectRoot)) return { allowed: false, ruleId: "powershell.managed-config-tamper" };
		if (/^(?:powershell|pwsh)(?:\.exe)?$/i.test(executable) && tokens.some((token) => /^-(?:enc|encodedcommand)$/i.test(token))) return { allowed: false, ruleId: "powershell.obfuscated-interpreter" };
	}
	return { allowed: true };
}
export function evaluateEvent(input, config = AGENT_CONFIGS.claude) {
	if (!isObject(input) || input.hook_event_name !== "PreToolUse" || !SUPPORTED_TOOLS.includes(input.tool_name) || !isObject(input.tool_input)) fail("invalid-event");
	const cwd = typeof input.cwd === "string" && isAbsolutePolicyPath(input.cwd) ? input.cwd : PROJECT_ROOT;
	const projectRoot = resolveProjectRoot(config, cwd);
	if (input.tool_name === "Bash" || input.tool_name === "PowerShell") {
		if (typeof input.tool_input.command !== "string") fail("invalid-event");
		return input.tool_name === "Bash" ? evaluateBash(input.tool_input.command, cwd, config, projectRoot) : evaluatePowerShell(input.tool_input.command, cwd, config, projectRoot);
	}
	if (typeof input.tool_input.file_path !== "string" || !isAbsolutePolicyPath(input.tool_input.file_path)) fail("invalid-event");
	return evaluateFile(input.tool_name, input.tool_input.file_path, config, projectRoot);
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
		"invalid-config": "missing or unknown --agent selector (expected --agent=<id>)",
		"oversized-input": "stdin exceeds 1048576 bytes",
		"missing-policy": "embedded policy registry is unavailable",
		"internal-error": "policy evaluation could not complete",
	};
	return `javi-forge PreToolUse failed closed [${id}]: ${messages[id] ?? messages["internal-error"]}`;
}
function denialDiagnostic(toolName, decision) {
	const tool = SUPPORTED_TOOLS.includes(toolName) ? toolName : "supported tool";
	if (decision.ambiguity) return `javi-forge PreToolUse denied ${tool} [${decision.ruleId}]: ${decision.ambiguity.utility} ${decision.ambiguity.profile} ${decision.ambiguity.sink} semantics denied as ambiguous`;
	return `javi-forge PreToolUse denied ${tool} [${decision.ruleId}]: global guard policy denied the invocation`;
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
		const config = resolveAgentConfig(process.argv);
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
		const decision = evaluateEvent(parsed, config);
		if (!decision.allowed) denyAndExit(denialDiagnostic(parsed.tool_name, decision));
		process.exitCode = 0;
	} catch (error) {
		denyAndExit(diagnostic(error));
	}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
