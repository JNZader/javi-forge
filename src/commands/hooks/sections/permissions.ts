/**
 * L3 permission-boundary section (hook-consolidation S4).
 *
 * Port of `templates/security-hooks/pre-commit-permissions`. Builds the staged
 * list NUL-safe (`-z` → split on "\0") and does the mode checks with `fs.stat`
 * in TS instead of shelling out to `stat`/`grep`. Two issue classes block the
 * commit: a world-writable file (`mode & 0o002`) and an executable
 * (`mode & 0o111`) that is NOT an allowed script/hook/shebang file.
 */

import path from "node:path";
import fs from "fs-extra";
import { execFileAsync } from "../../../lib/exec.js";
import type { HookSection } from "../../hooks.js";

/** Extensions that legitimately carry the executable bit. */
const SCRIPT_EXT = /\.(sh|bash|zsh|py|rb|pl)$/;

export interface PermissionsSectionDeps {
	execFile: (
		cmd: string,
		args: string[],
		opts?: { cwd?: string },
	) => Promise<{ stdout: string; stderr: string }>;
	/** stat a path; returns null when the file does not exist / is not a regular file. */
	statFile: (p: string) => Promise<{ mode: number; isFile: boolean } | null>;
	/** first line of a file (for the shebang allowance); "" on any read error. */
	firstLine: (p: string) => Promise<string>;
	log: (msg: string) => void;
}

async function statFileReal(
	p: string,
): Promise<{ mode: number; isFile: boolean } | null> {
	try {
		const st = await fs.stat(p);
		return { mode: st.mode, isFile: st.isFile() };
	} catch {
		return null;
	}
}

async function firstLineReal(p: string): Promise<string> {
	try {
		const content = await fs.readFile(p, "utf-8");
		return content.split("\n", 1)[0] ?? "";
	} catch {
		return "";
	}
}

function defaultDeps(): PermissionsSectionDeps {
	return {
		execFile: async (cmd, args, opts) => {
			const { stdout, stderr } = await execFileAsync(cmd, args, opts);
			return { stdout: String(stdout), stderr: String(stderr) };
		},
		statFile: statFileReal,
		firstLine: firstLineReal,
		log: (m) => console.log(m),
	};
}

async function stagedFiles(
	deps: PermissionsSectionDeps,
	projectDir: string,
): Promise<string[]> {
	const { stdout } = await deps.execFile(
		"git",
		["diff", "--cached", "--name-only", "--diff-filter=ACM", "-z"],
		{ cwd: projectDir },
	);
	return stdout.split("\0").filter((f) => f.length > 0);
}

/**
 * The `permissions` section factory. Injectable seams default to the real
 * git/fs implementation. A thrown error is caught and mapped to a blocking
 * failure (never an unhandled rejection).
 */
export function permissionsSection(
	overrides: Partial<PermissionsSectionDeps> = {},
): HookSection {
	const deps: PermissionsSectionDeps = { ...defaultDeps(), ...overrides };
	return {
		id: "permissions",
		blocking: true,
		async run({ projectDir }) {
			try {
				const files = await stagedFiles(deps, projectDir);
				if (files.length === 0) return { ok: true };

				const issues: string[] = [];
				for (const file of files) {
					const full = path.join(projectDir, file);
					const st = await deps.statFile(full);
					if (!st?.isFile) continue;

					if ((st.mode & 0o002) !== 0) {
						issues.push(`world-writable: ${file}`);
					}

					if ((st.mode & 0o111) !== 0) {
						const allowedByExt = SCRIPT_EXT.test(file);
						const allowedByHooksDir = file.includes("/hooks/");
						const allowedByShebang =
							allowedByExt || allowedByHooksDir
								? true
								: (await deps.firstLine(full)).startsWith("#!");
						if (!allowedByExt && !allowedByHooksDir && !allowedByShebang) {
							issues.push(`unexpected executable: ${file}`);
						}
					}
				}

				if (issues.length === 0) return { ok: true };
				return {
					ok: false,
					detail: `${issues.length} permission issue(s): ${issues
						.slice(0, 10)
						.join("; ")}`,
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
