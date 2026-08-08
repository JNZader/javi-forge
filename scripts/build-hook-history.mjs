#!/usr/bin/env node
/**
 * ONE-SHOT bootstrap generator for `assets/hooks/manifest.json` `historical[]`.
 *
 * It mines every revision of `src/commands/ci.ts` reachable from any ref, slices
 * the inline ``const *_HOOK = `…`;`` template literals, RENDERS them (the TS
 * source escapes `\\b` and `${` — those escapes must disappear once the template
 * becomes a plain file), dedupes by sha256 and records the FIRST commit that
 * introduced each variant.
 *
 * This script is dev-only and is NOT packed. It is the bootstrap mechanism, not
 * the ongoing one: once the inline constants are deleted, the outgoing hash of a
 * hook comes from `assets/hooks/<hook>` at the previous release, appended to
 * `historical[]` in the same PR that changes the body (design.md D6, binding
 * forward-maintenance rule).
 *
 * Usage:
 *   node scripts/build-hook-history.mjs              # report only (stdout JSON)
 *   node scripts/build-hook-history.mjs --write-assets
 *   node scripts/build-hook-history.mjs --write-manifest
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const SOURCE_FILE = "src/commands/ci.ts";
const ASSETS_DIR = path.join(REPO_ROOT, "assets", "hooks");

/** Inline constant name → installed hook name. */
const CONSTANT_TO_HOOK = {
	PRE_COMMIT_HOOK: "pre-commit",
	PRE_PUSH_HOOK: "pre-push",
	COMMIT_MSG_HOOK: "commit-msg",
};

const HOOK_NAMES = Object.values(CONSTANT_TO_HOOK);

const git = (args) =>
	execFileSync("git", args, {
		cwd: REPO_ROOT,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});

const sha256 = (text) =>
	createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

/**
 * Render a template-literal body to the bytes the shell will actually see.
 * Aborts on any unescaped `${` — an interpolation would mean the hook text is
 * not a constant and cannot be extracted to a static asset.
 */
export function renderTemplateLiteral(raw, where) {
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (ch === "\\") {
			const next = raw[i + 1];
			i++;
			switch (next) {
				case "n":
					out += "\n";
					break;
				case "t":
					out += "\t";
					break;
				case "r":
					out += "\r";
					break;
				case "0":
					out += "\0";
					break;
				case "`":
					out += "`";
					break;
				case "$":
					out += "$";
					break;
				case "\\":
					out += "\\";
					break;
				default:
					throw new Error(`${where}: unsupported escape sequence \\${next}`);
			}
			continue;
		}
		if (ch === "$" && raw[i + 1] === "{") {
			throw new Error(
				`${where}: unescaped \${ interpolation — the hook template is not a constant`,
			);
		}
		out += ch;
	}
	return out;
}

/**
 * Slice every ``const <NAME>_HOOK = `…`;`` literal out of a ci.ts revision.
 * Returns a map of hook name → rendered body. Constants that are absent from the
 * revision are simply missing from the map.
 */
export function extractHooks(source, where) {
	const hooks = {};
	const unknown = [];
	const opener = /const\s+([A-Z0-9_]*HOOK)\s*=\s*`/g;
	let match = opener.exec(source);
	while (match !== null) {
		const constantName = match[1];
		const start = opener.lastIndex;
		let end = start;
		while (end < source.length) {
			if (source[end] === "\\") {
				end += 2;
				continue;
			}
			if (source[end] === "`") break;
			end++;
		}
		if (end >= source.length) {
			throw new Error(
				`${where}: unterminated template literal for ${constantName}`,
			);
		}
		const hookName = CONSTANT_TO_HOOK[constantName];
		if (hookName) {
			hooks[hookName] = renderTemplateLiteral(
				source.slice(start, end),
				`${where}:${constantName}`,
			);
		} else {
			unknown.push(constantName);
		}
		opener.lastIndex = end + 1;
		match = opener.exec(source);
	}
	return { hooks, unknown };
}

function collectHistory() {
	// Oldest first, so the first sighting of a variant is its first commit.
	const revisions = git(["rev-list", "--all", "--reverse", "--", SOURCE_FILE])
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

	const history = Object.fromEntries(HOOK_NAMES.map((name) => [name, []]));
	const unknownConstants = new Set();
	let revisionsWithSource = 0;

	for (const rev of revisions) {
		let source;
		try {
			source = git(["show", `${rev}:${SOURCE_FILE}`]);
		} catch {
			continue; // revision where the file does not exist under this path
		}
		revisionsWithSource++;
		const { hooks, unknown } = extractHooks(source, rev.slice(0, 12));
		for (const name of unknown) unknownConstants.add(name);
		for (const [hookName, body] of Object.entries(hooks)) {
			const hash = sha256(body);
			const seen = history[hookName];
			if (!seen.some((entry) => entry.sha256 === hash)) {
				seen.push({ sha256: hash, firstCommit: rev });
			}
		}
	}

	return {
		history,
		revisions: revisions.length,
		revisionsWithSource,
		unknownConstants,
	};
}

function main() {
	const args = process.argv.slice(2);
	const writeAssets = args.includes("--write-assets");
	const writeManifest = args.includes("--write-manifest");

	const head = fs.readFileSync(path.join(REPO_ROOT, SOURCE_FILE), "utf8");
	const { hooks: current } = extractHooks(head, "worktree");
	const missing = HOOK_NAMES.filter((name) => !(name in current));
	if (missing.length > 0) {
		throw new Error(
			`worktree ${SOURCE_FILE} no longer defines: ${missing.join(", ")} — this bootstrap script only runs while the inline constants exist`,
		);
	}

	const { history, revisions, revisionsWithSource, unknownConstants } =
		collectHistory();

	// The census is the deliverable of the gate — emit it even when the gate
	// then fails, so the operator sees WHY.
	const report = {
		source: SOURCE_FILE,
		revisionsTouchingSource: revisions,
		revisionsReadable: revisionsWithSource,
		unknownHookConstants: [...unknownConstants],
		variantsPerHook: Object.fromEntries(
			HOOK_NAMES.map((name) => [name, history[name].length]),
		),
		headHashes: Object.fromEntries(
			HOOK_NAMES.map((name) => [name, sha256(current[name])]),
		),
	};
	process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);

	// Block gate BEFORE any write: a manifest with an empty historical[] would
	// classify every hook of the deployed fleet as `foreign` and refuse to
	// upgrade it. Fail with nothing written rather than half-written.
	const empty = HOOK_NAMES.filter((name) => history[name].length === 0);
	if (empty.length > 0) {
		throw new Error(
			`ZERO historical variants for: ${empty.join(", ")} — refusing to ship a manifest that would classify the installed fleet as foreign`,
		);
	}

	if (writeAssets) {
		fs.mkdirSync(ASSETS_DIR, { recursive: true });
		for (const hookName of HOOK_NAMES) {
			fs.writeFileSync(
				path.join(ASSETS_DIR, hookName),
				current[hookName],
				"utf8",
			);
		}
	}

	const manifest = {};
	for (const hookName of HOOK_NAMES) {
		const assetPath = path.join(ASSETS_DIR, hookName);
		const assetHash = fs.existsSync(assetPath)
			? createHash("sha256").update(fs.readFileSync(assetPath)).digest("hex")
			: sha256(current[hookName]);
		manifest[hookName] = {
			version: 1,
			sha256: assetHash,
			historical: history[hookName],
		};
	}

	if (writeManifest) {
		fs.mkdirSync(ASSETS_DIR, { recursive: true });
		fs.writeFileSync(
			path.join(ASSETS_DIR, "manifest.json"),
			`${JSON.stringify(manifest, null, 2)}\n`,
			"utf8",
		);
	}

	process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (
	process.argv[1] &&
	fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
	main();
}
