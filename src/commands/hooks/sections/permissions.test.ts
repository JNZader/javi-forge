import { execFile as realExecFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type PermissionsSectionDeps,
	permissionsSection,
} from "./permissions.js";

const execFileAsync = promisify(realExecFile);

function nulList(files: string[]): string {
	return files.length ? `${files.join("\0")}\0` : "";
}

function baseDeps(
	files: string[],
	over: Partial<PermissionsSectionDeps>,
): PermissionsSectionDeps {
	return {
		execFile: async () => ({ stdout: nulList(files), stderr: "" }),
		statFile: async () => ({ mode: 0o644, isFile: true }),
		firstLine: async () => "",
		log: () => {},
		...over,
	};
}

describe("permissionsSection (unit, mocked)", () => {
	it("world-writable staged file → blocks", async () => {
		const section = permissionsSection(
			baseDeps(["data.txt"], {
				statFile: async () => ({ mode: 0o666, isFile: true }),
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("world-writable");
	});

	it("unexpected executable (no ext / no shebang / not in hooks dir) → blocks", async () => {
		const section = permissionsSection(
			baseDeps(["bin/tool"], {
				statFile: async () => ({ mode: 0o755, isFile: true }),
				firstLine: async () => "not a shebang",
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("unexpected executable");
	});

	it("executable script by extension (.sh) is allowed → ok:true", async () => {
		const section = permissionsSection(
			baseDeps(["scripts/run.sh"], {
				statFile: async () => ({ mode: 0o755, isFile: true }),
				firstLine: async () => "not a shebang",
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("executable file inside a /hooks/ directory is allowed → ok:true", async () => {
		const section = permissionsSection(
			baseDeps([".git/hooks/pre-commit"], {
				statFile: async () => ({ mode: 0o755, isFile: true }),
				firstLine: async () => "not a shebang",
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("executable file with a #! shebang is allowed → ok:true", async () => {
		const section = permissionsSection(
			baseDeps(["tool"], {
				statFile: async () => ({ mode: 0o755, isFile: true }),
				firstLine: async () => "#!/usr/bin/env node",
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("non-executable regular file → ok:true", async () => {
		const section = permissionsSection(
			baseDeps(["readme.md"], {
				statFile: async () => ({ mode: 0o644, isFile: true }),
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("NUL-safe list: no staged files → ok:true", async () => {
		const section = permissionsSection(baseDeps([], {}));
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("a deleted staged path (stat null) is skipped, not fatal", async () => {
		const section = permissionsSection(
			baseDeps(["gone.txt"], { statFile: async () => null }),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(true);
	});

	it("a thrown git error is caught → ok:false", async () => {
		const section = permissionsSection(
			baseDeps(["x"], {
				execFile: async () => {
					throw new Error("git boom");
				},
			}),
		);
		const result = await section.run({ projectDir: "/repo" });
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("git boom");
	});
});

describe("permissionsSection (integration, real git + stat)", () => {
	let repo: string;
	beforeEach(async () => {
		repo = await fs.mkdtemp(path.join(os.tmpdir(), "jf-perms-"));
		await execFileAsync("git", ["init", "-q"], { cwd: repo });
		await execFileAsync("git", ["config", "user.email", "t@t.dev"], {
			cwd: repo,
		});
		await execFileAsync("git", ["config", "user.name", "t"], { cwd: repo });
	});
	afterEach(async () => {
		await fs.remove(repo);
	});

	it("a real world-writable staged file is blocked", async () => {
		const f = path.join(repo, "data.txt");
		await fs.writeFile(f, "hi\n");
		await fs.chmod(f, 0o666);
		await execFileAsync("git", ["add", "--", "data.txt"], { cwd: repo });

		const section = permissionsSection({ log: () => {} });
		const result = await section.run({ projectDir: repo });
		expect(result.ok).toBe(false);
		expect(result.detail).toContain("world-writable");
	});

	it("a real executable shell script is allowed", async () => {
		const f = path.join(repo, "run.sh");
		await fs.writeFile(f, "#!/bin/bash\necho hi\n");
		await fs.chmod(f, 0o755);
		await execFileAsync("git", ["add", "--", "run.sh"], { cwd: repo });

		const section = permissionsSection({ log: () => {} });
		const result = await section.run({ projectDir: repo });
		expect(result.ok).toBe(true);
	});
});
