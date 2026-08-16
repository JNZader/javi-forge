// biome-ignore-all lint/suspicious/noTemplateCurlyInString: verbatim shell `${…}` and the literal Claude `${CLAUDE_PROJECT_DIR}` placeholder — never JS templates.
/**
 * Shared frozen ownership fixtures for the SkillGuard Claude PreToolUse guard.
 *
 * This module is the single source of truth for the byte/structure-exact
 * identities the read-only recognition layer (Slice 2) classifies against:
 *
 * - the managed settings-entry handler group the Slice-3 writer installs;
 * - the four v0 legacy cohort objects, copied verbatim from
 *   `templates/security-hooks/claude-settings-security.json` (never normalized);
 * - the marker/placeholder/hash constants.
 *
 * Everything here is data only (frozen literals plus a couple of pure
 * builders) so it is deterministic, host-independent, and trivially testable.
 * The production classifier imports the constants and the legacy cohort from
 * here; the tests additionally use the one-byte-edited and duplicate variants.
 */

/** Exact managed marker prefix on the settings handler's `statusMessage`. */
export const MANAGED_STATUS_PREFIX = "javi-forge-global-pretooluse:v1:sha256:";

/** Placeholder the canonical hash normalizes the live asset SHA token to. */
export const ASSET_SHA_PLACEHOLDER = "<ASSET_SHA256>";

/** Whole-file SHA-256 of the retained v0 legacy scaffold template. */
export const LEGACY_FILE_SHA256 =
	"b4638222ecddc2daac6ec3339596d853a626906bbd1233d789d80a319325c68d";

/** Exact managed matcher — an exact-name alternative list, never a wildcard. */
export const MANAGED_MATCHER = "Bash|PowerShell|Read|Write|Edit";

/** Single project-local MJS argument, kept as a literal placeholder path. */
export const MANAGED_ASSET_ARG =
	"${CLAUDE_PROJECT_DIR}/.claude/hooks/javi-forge-skillguard-pre-tool-use.mjs";

/** Exact asset filename under `.claude/hooks/`. */
export const ASSET_NAME = "javi-forge-skillguard-pre-tool-use.mjs";

/** Exact first-line comment marking the managed asset. */
export const ASSET_MANAGED_MARKER =
	"// javi-forge-managed: claude-pretooluse v1";

/**
 * A representative live asset SHA. Used only to build marker `statusMessage`
 * values in fixtures; the canonical settings identity is invariant under this
 * value (Decision ②), which the rotation-invariance test proves.
 */
export const SAMPLE_ASSET_SHA256 =
	"78be7e6613c012280b7ad17886462ba166b63ebd031e34565d757b3a0796d7cc";

/** Build the exact marker `statusMessage` for a given live asset SHA. */
export function managedStatusMessage(
	assetSha: string = SAMPLE_ASSET_SHA256,
): string {
	return `${MANAGED_STATUS_PREFIX}${assetSha}`;
}

/** Build the exact managed command handler for a given live asset SHA. */
export function managedHandler(assetSha: string = SAMPLE_ASSET_SHA256) {
	return {
		type: "command",
		command: "node",
		args: [MANAGED_ASSET_ARG],
		timeout: 30,
		statusMessage: managedStatusMessage(assetSha),
	};
}

/** Build the exact managed matcher group for a given live asset SHA. */
export function managedGroup(assetSha: string = SAMPLE_ASSET_SHA256) {
	return { matcher: MANAGED_MATCHER, hooks: [managedHandler(assetSha)] };
}

/** Build a valid settings container around the given hook sections. */
export function settingsContainer(
	pre: unknown[] = [],
	post: unknown[] = [],
	extra: Record<string, unknown> = {},
): Record<string, unknown> {
	return { ...extra, hooks: { PreToolUse: pre, PostToolUse: post } };
}

// --- v0 legacy cohort (verbatim from the retained template) ------------------

export const L1_BASH_DANGEROUS = {
	matcher: "Bash",
	hook: "COMMAND=\"$CLAUDE_TOOL_INPUT\"\nBLOCKED_PATTERNS=(\n  'rm -rf /'\n  'rm -rf ~'\n  'chmod 777'\n  'curl.*|.*sh'\n  'wget.*|.*sh'\n  'eval.*\\$'\n  'base64.*-d.*|.*sh'\n  ':(){:|:&};:'\n)\nfor pattern in \"${BLOCKED_PATTERNS[@]}\"; do\n  if echo \"$COMMAND\" | grep -qE \"$pattern\"; then\n    echo \"BLOCKED: Dangerous command pattern detected: $pattern\"\n    exit 2\n  fi\ndone\nexit 0",
	description:
		"Block dangerous shell commands (rm -rf /, chmod 777, pipe-to-sh, fork bombs)",
} as const;

export const L2_BASH_SENSITIVE_READ = {
	matcher: "Bash",
	hook: "COMMAND=\"$CLAUDE_TOOL_INPUT\"\nSENSITIVE_PATHS=(\n  '.env'\n  '.env.local'\n  '.env.production'\n  'credentials'\n  'secrets'\n  '.ssh'\n  '.gnupg'\n  '.aws/credentials'\n)\nfor path in \"${SENSITIVE_PATHS[@]}\"; do\n  if echo \"$COMMAND\" | grep -qE \"(cat|less|head|tail|bat|read).*$path\"; then\n    echo \"BLOCKED: Attempt to read sensitive file: $path\"\n    exit 2\n  fi\ndone\nexit 0",
	description: "Prevent reading sensitive files (.env, credentials, SSH keys)",
} as const;

export const L3_WRITE_EDIT_PROTECTED = {
	matcher: "Write|Edit",
	hook: "INPUT=\"$CLAUDE_TOOL_INPUT\"\nPROTECTED_FILES=(\n  '.env'\n  '.env.production'\n  'credentials.json'\n  'serviceAccountKey.json'\n  '.ssh/'\n  '.gnupg/'\n)\nfor pf in \"${PROTECTED_FILES[@]}\"; do\n  if echo \"$INPUT\" | grep -q \"$pf\"; then\n    echo \"BLOCKED: Cannot modify protected file: $pf\"\n    exit 2\n  fi\ndone\nexit 0",
	description: "Prevent writing to credential and secret files",
} as const;

export const L4_BASH_POST_SECRET_SCAN = {
	matcher: "Bash",
	hook: "OUTPUT=\"$CLAUDE_TOOL_OUTPUT\"\nLEAK_PATTERNS=(\n  'AKIA[0-9A-Z]{16}'\n  'ghp_[A-Za-z0-9]{36}'\n  'sk_live_[0-9a-zA-Z]{24,}'\n  'xox[baprs]-[0-9a-zA-Z-]+'\n  '-----BEGIN.*PRIVATE KEY-----'\n)\nfor pattern in \"${LEAK_PATTERNS[@]}\"; do\n  if echo \"$OUTPUT\" | grep -qE \"$pattern\"; then\n    echo \"WARNING: Command output may contain secrets. Review carefully.\"\n    exit 0\n  fi\ndone\nexit 0",
	description: "Warn if command output contains potential secrets",
} as const;

/** The complete four-object v0 legacy cohort in committed order (L1–L3 Pre, L4 Post). */
export const LEGACY_COHORT = {
	L1: L1_BASH_DANGEROUS,
	L2: L2_BASH_SENSITIVE_READ,
	L3: L3_WRITE_EDIT_PROTECTED,
	L4: L4_BASH_POST_SECRET_SCAN,
} as const;

/**
 * One-byte-edited L1: a single trailing character removed from the description.
 * It must fail deep-structural equality against the exact cohort member.
 */
export const L1_ONE_BYTE_EDITED = {
	...L1_BASH_DANGEROUS,
	description:
		"Block dangerous shell commands (rm -rf /, chmod 777, pipe-to-sh, fork bombs)".slice(
			0,
			-1,
		),
} as const;
