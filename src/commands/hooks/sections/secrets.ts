/**
 * L1 secret-scan section (hook-consolidation S4).
 *
 * Port of `templates/security-hooks/pre-commit-secrets` into TypeScript. The
 * bash body built the staged-file list with `git diff --cached --name-only`
 * and then piped it through `xargs git diff` (pre-commit-secrets:52) — a
 * whitespace split that silently dropped any path containing a space and
 * swallowed the git error with `|| true` (K-005). This port builds the staged
 * list NUL-safe (`-z` → split on `"\0"`) and passes each filename as a SEPARATE
 * argv element to `git diff` (no shell, no xargs), so a path like
 * `app secrets.env` is scanned as ONE path and can never be split.
 *
 * A matched pattern in an ADDED diff line blocks the commit (ok:false).
 */

import { execFileAsync } from "../../../lib/exec.js";
import type { HookSection } from "../../hooks.js";

/** A secret pattern ported byte-faithfully from the bash SECRET_PATTERNS array. */
interface SecretPattern {
	name: string;
	re: RegExp;
}

/**
 * Ported from `templates/security-hooks/pre-commit-secrets` SECRET_PATTERNS.
 * bash `(?i)` → the JS `/i` flag; bash `\x27` (a single quote) → a literal `'`.
 * No `/g` flag is used, so `.test()` never carries `lastIndex` state between
 * lines. Order is preserved from the bash array.
 */
const SECRET_PATTERNS: SecretPattern[] = [
	// AWS access key id
	{ name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
	// Generic API keys / tokens assigned to key-like vars
	{
		name: "generic-api-key",
		re: /(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{20,}["']/i,
	},
	// Private key headers
	{
		name: "private-key",
		re: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
	},
	// GitHub tokens
	{ name: "github-token", re: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
	// Generic password assignments
	{
		name: "password-assignment",
		re: /(password|passwd|pwd)\s*[:=]\s*["'][^\s"']{8,}["']/i,
	},
	// Slack tokens
	{ name: "slack-token", re: /xox[baprs]-[0-9a-zA-Z-]+/ },
	// Stripe keys
	{ name: "stripe-secret-key", re: /sk_live_[0-9a-zA-Z]{24,}/ },
	{ name: "stripe-restricted-key", re: /rk_live_[0-9a-zA-Z]{24,}/ },
	// SendGrid
	{
		name: "sendgrid-key",
		re: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/,
	},
];

/** ARG_MAX guard: cap the number of file paths per `git diff` argv batch. */
export const DEFAULT_CHUNK_SIZE = 512;

/**
 * maxBuffer for the content `git diff` read. Node's default is 1 MiB; a staged
 * diff larger than that rejects and (caught) blocks every large legitimate
 * commit with a cryptic buffer error. Raise the ceiling to a generous but
 * BOUNDED 64 MiB so ordinary large commits scan, while a genuinely pathological
 * diff still fails closed instead of exhausting memory.
 */
export const DIFF_MAX_BUFFER = 64 * 1024 * 1024;

interface Finding {
	file: string;
	line: number;
	pattern: string;
}

export interface SecretsSectionDeps {
	/** argv-only exec (no shell). Defaults to the real `git` via execFileAsync. */
	execFile: (
		cmd: string,
		args: string[],
		opts?: { cwd?: string; maxBuffer?: number },
	) => Promise<{ stdout: string; stderr: string }>;
	log: (msg: string) => void;
	/** File-count per `git diff` batch (ARG_MAX guard). Defaults to 512. */
	chunkSize: number;
}

function defaultDeps(): SecretsSectionDeps {
	return {
		execFile: async (cmd, args, opts) => {
			const { stdout, stderr } = await execFileAsync(cmd, args, opts);
			return { stdout: String(stdout), stderr: String(stderr) };
		},
		log: (m) => console.log(m),
		chunkSize: DEFAULT_CHUNK_SIZE,
	};
}

/** NUL-safe staged-file list (`-z` → split on "\0", drop the trailing empty). */
async function stagedFiles(
	deps: SecretsSectionDeps,
	projectDir: string,
): Promise<string[]> {
	const { stdout } = await deps.execFile(
		"git",
		["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"],
		{ cwd: projectDir },
	);
	return stdout.split("\0").filter((f) => f.length > 0);
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}

/**
 * Walk a unified diff and report every ADDED line (`+`, never `+++`) that
 * matches a secret pattern, tracking the new-file path and line number so a
 * finding reads `path:line pattern`.
 */
export function scanDiff(diff: string): Finding[] {
	const findings: Finding[] = [];
	let currentFile = "";
	let newLine = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++ ")) {
			const p = line.slice(4).trim();
			currentFile = p === "/dev/null" ? "" : p.replace(/^b\//, "");
			continue;
		}
		if (line.startsWith("--- ")) continue;
		const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
		if (hunk) {
			newLine = Number.parseInt(hunk[1], 10);
			continue;
		}
		if (
			line.startsWith("diff --git") ||
			line.startsWith("index ") ||
			line.startsWith("old mode") ||
			line.startsWith("new mode") ||
			line.startsWith("similarity ") ||
			line.startsWith("rename ") ||
			line.startsWith("new file") ||
			line.startsWith("deleted file")
		) {
			continue;
		}
		if (line.startsWith("+")) {
			const content = line.slice(1);
			for (const { name, re } of SECRET_PATTERNS) {
				if (re.test(content)) {
					findings.push({ file: currentFile, line: newLine, pattern: name });
				}
			}
			newLine++;
		} else if (line.startsWith("-")) {
			// removed line — does not advance the new-file line counter
		} else {
			// context (leading space) or blank line
			newLine++;
		}
	}
	return findings;
}

/**
 * The `secrets` section factory. Injectable seams default to the real
 * `git`-via-execFileAsync implementation; tests pass mocks. A thrown git error
 * becomes a blocking `{ ok: false }` (never an unhandled rejection), matching
 * the ciSection/tddSection hardening.
 */
export function secretsSection(
	overrides: Partial<SecretsSectionDeps> = {},
): HookSection {
	const deps: SecretsSectionDeps = { ...defaultDeps(), ...overrides };
	return {
		id: "secrets",
		blocking: true,
		async run({ projectDir }) {
			try {
				const files = await stagedFiles(deps, projectDir);
				if (files.length === 0) return { ok: true };

				const findings: Finding[] = [];
				for (const batch of chunk(files, deps.chunkSize)) {
					// `--no-color` is MANDATORY: under `color.ui=always` (or
					// `color.diff=always`) git emits ANSI escapes even to a pipe, so
					// added lines render as `\x1b[32m+secret\x1b[m` and both the
					// `+`/`+++ ` line checks in scanDiff fail — the scanner would then
					// find zero secrets and fail OPEN. Forcing color off keeps the diff
					// plain-text and the scan deterministic.
					const { stdout } = await deps.execFile(
						"git",
						["diff", "--no-color", "--cached", "--", ...batch],
						{ cwd: projectDir, maxBuffer: DIFF_MAX_BUFFER },
					);
					findings.push(...scanDiff(stdout));
				}

				if (findings.length === 0) return { ok: true };
				const summary = findings
					.slice(0, 10)
					.map((f) => `${f.file || "<staged>"}:${f.line} ${f.pattern}`)
					.join("; ");
				return {
					ok: false,
					detail: `${findings.length} potential secret(s): ${summary}`,
				};
			} catch (e) {
				return {
					ok: false,
					detail: e instanceof Error ? e.message : String(e),
				};
			}
		},
	};
}
