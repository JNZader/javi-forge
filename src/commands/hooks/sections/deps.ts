/**
 * L2 dependency-audit section (hook-consolidation S4).
 *
 * Port of `templates/security-hooks/pre-push-deps`. Same manifest→tool ladder,
 * run via `execFileAsync` (argv, no shell). A tool that is not installed is an
 * advisory skip (ok:true) exactly like the bash "not installed. Skipping"
 * branch — a missing auditor must never block a push. A genuine audit finding
 * (the auditor ran and exited non-zero) is a blocking failure (ok:false).
 */

import path from "node:path";
import fs from "fs-extra";
import { execFileAsync } from "../../../lib/exec.js";
import type { HookSection } from "../../hooks.js";

export interface DepsSectionDeps {
	execFile: (
		cmd: string,
		args: string[],
		opts?: { cwd?: string },
	) => Promise<{ stdout: string; stderr: string }>;
	which: (bin: string) => Promise<boolean>;
	fileExists: (p: string) => Promise<boolean>;
	log: (msg: string) => void;
}

async function whichReal(bin: string): Promise<boolean> {
	try {
		await execFileAsync("which", [bin]);
		return true;
	} catch {
		return false;
	}
}

function defaultDeps(): DepsSectionDeps {
	return {
		execFile: async (cmd, args, opts) => {
			const { stdout, stderr } = await execFileAsync(cmd, args, opts);
			return { stdout: String(stdout), stderr: String(stderr) };
		},
		which: whichReal,
		fileExists: (p) => fs.pathExists(p),
		log: (m) => console.log(m),
	};
}

interface ExecErr {
	code?: string | number;
}

/** ENOENT ⇒ the auditor binary is absent (advisory skip, never blocking). */
function isMissingBinary(e: unknown): boolean {
	return (e as ExecErr)?.code === "ENOENT";
}

/**
 * Run an auditor. A clean exit is ok:true; a non-zero exit (the tool ran and
 * found something) is a blocking ok:false; a missing binary (ENOENT) is an
 * advisory skip ok:true (parity with the bash "not installed" branch).
 */
async function runAudit(
	deps: DepsSectionDeps,
	projectDir: string,
	cmd: string,
	args: string[],
): Promise<{ ok: boolean; detail?: string }> {
	deps.log(`  ▶ ${cmd} ${args.join(" ")}`);
	try {
		await deps.execFile(cmd, args, { cwd: projectDir });
		return { ok: true };
	} catch (e) {
		if (isMissingBinary(e)) {
			deps.log(`  ⓘ ${cmd} not installed. Skipping (does not block).`);
			return { ok: true };
		}
		return {
			ok: false,
			detail: `high/critical vulnerabilities found (${cmd} ${args.join(" ")})`,
		};
	}
}

/**
 * The `deps` section factory. Detects the project's manifest and runs the
 * matching auditor. No manifest → advisory skip. A thrown error is caught and
 * mapped to a blocking failure (never an unhandled rejection).
 */
export function depsSection(
	overrides: Partial<DepsSectionDeps> = {},
): HookSection {
	const deps: DepsSectionDeps = { ...defaultDeps(), ...overrides };
	const at = (projectDir: string, name: string) => path.join(projectDir, name);
	return {
		id: "deps",
		blocking: true,
		async run({ projectDir }) {
			try {
				if (await deps.fileExists(at(projectDir, "package.json"))) {
					if (await deps.fileExists(at(projectDir, "pnpm-lock.yaml"))) {
						return runAudit(deps, projectDir, "pnpm", [
							"audit",
							"--audit-level=high",
						]);
					}
					if (await deps.fileExists(at(projectDir, "yarn.lock"))) {
						return runAudit(deps, projectDir, "yarn", [
							"npm",
							"audit",
							"--severity",
							"high",
						]);
					}
					return runAudit(deps, projectDir, "npm", [
						"audit",
						"--audit-level=high",
					]);
				}

				if (
					(await deps.fileExists(at(projectDir, "requirements.txt"))) ||
					(await deps.fileExists(at(projectDir, "pyproject.toml")))
				) {
					if (!(await deps.which("pip-audit"))) {
						deps.log("  ⓘ pip-audit not installed. Skipping (does not block).");
						return { ok: true };
					}
					return runAudit(deps, projectDir, "pip-audit", []);
				}

				if (await deps.fileExists(at(projectDir, "Cargo.toml"))) {
					if (!(await deps.which("cargo-audit"))) {
						deps.log(
							"  ⓘ cargo-audit not installed. Skipping (does not block).",
						);
						return { ok: true };
					}
					return runAudit(deps, projectDir, "cargo-audit", []);
				}

				if (await deps.fileExists(at(projectDir, "go.mod"))) {
					if (!(await deps.which("govulncheck"))) {
						deps.log(
							"  ⓘ govulncheck not installed. Skipping (does not block).",
						);
						return { ok: true };
					}
					return runAudit(deps, projectDir, "govulncheck", ["./..."]);
				}

				deps.log("  ⓘ no supported dependency manifest found. Skipping.");
				return { ok: true };
			} catch (e) {
				return {
					ok: false,
					detail: e instanceof Error ? e.message : String(e),
				};
			}
		},
	};
}
