import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type ExecutionComponentStates,
	type ExecutionProbeEnv,
	type ExecutionReport,
	listManagedDropIns,
	probeExecution,
	probeExecutionSource,
	resolveManagedSettingsPaths,
} from "./claude-hook-manager.js";

// -----------------------------------------------------------------------------
// Host-independent fixtures: every source is a temp path injected through
// ExecutionProbeEnv. No test touches real /etc, /Library, or the real HOME.
// -----------------------------------------------------------------------------

let root: string;
const projectDir = (): string => path.join(root, "proj");
const homeDir = (): string => path.join(root, "home");
const managedDir = (): string => path.join(root, "managed");
const managedFile = (): string =>
	path.join(managedDir(), "managed-settings.json");
const dropInDir = (): string => path.join(managedDir(), "managed-settings.d");

function writeJson(target: string, value: unknown): void {
	fs.mkdirSync(path.dirname(target), { recursive: true });
	fs.writeFileSync(target, JSON.stringify(value, null, 2));
}

const CURRENT: ExecutionComponentStates = {
	asset: "managed-current",
	settings: "managed-current",
};

function baseEnv(
	overrides: Partial<ExecutionProbeEnv> = {},
): ExecutionProbeEnv {
	return {
		platform: "linux",
		homeDir: homeDir(),
		env: {},
		managedFile: managedFile(),
		managedDropInDir: dropInDir(),
		...overrides,
	};
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "javi-forge-exec-"));
	fs.mkdirSync(projectDir(), { recursive: true });
	fs.mkdirSync(homeDir(), { recursive: true });
	fs.mkdirSync(managedDir(), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("resolveManagedSettingsPaths", () => {
	it("maps darwin to the Library ClaudeCode paths", () => {
		const p = resolveManagedSettingsPaths("darwin");
		expect(p.file).toBe(
			"/Library/Application Support/ClaudeCode/managed-settings.json",
		);
		expect(p.dropInDir).toBe(
			"/Library/Application Support/ClaudeCode/managed-settings.d",
		);
	});

	it("maps linux (and WSL, which reports linux) to /etc/claude-code", () => {
		const p = resolveManagedSettingsPaths("linux");
		expect(p.file).toBe("/etc/claude-code/managed-settings.json");
		expect(p.dropInDir).toBe("/etc/claude-code/managed-settings.d");
	});

	it("maps win32 to the Program Files ClaudeCode paths", () => {
		const p = resolveManagedSettingsPaths("win32");
		expect(p.file).toBe("C:\\Program Files\\ClaudeCode\\managed-settings.json");
		expect(p.dropInDir).toBe(
			"C:\\Program Files\\ClaudeCode\\managed-settings.d",
		);
	});
});

describe("probeExecutionSource (fail-closed read outcomes)", () => {
	it("treats an absent file as clear (a non-existent file holds no flag)", async () => {
		const r = await probeExecutionSource(path.join(root, "nope.json"));
		expect(r).toEqual({ kind: "clear" });
	});

	it("treats a symlink as unknown, never clear", async () => {
		const realTarget = path.join(root, "real.json");
		writeJson(realTarget, {});
		const link = path.join(root, "link.json");
		fs.symlinkSync(realTarget, link);
		const r = await probeExecutionSource(link);
		expect(r.kind).toBe("unknown");
	});

	it("treats a present non-regular path (directory) as unknown, distinct from absent", async () => {
		const asDir = path.join(root, "adir.json");
		fs.mkdirSync(asDir);
		const r = await probeExecutionSource(asDir);
		expect(r.kind).toBe("unknown");
		expect(r).not.toEqual({ kind: "clear" });
	});

	it("treats malformed JSON as unknown('invalid-json'), never clear", async () => {
		const target = path.join(root, "bad.json");
		fs.writeFileSync(target, "{ not: valid json ]");
		const r = await probeExecutionSource(target);
		expect(r).toEqual({ kind: "unknown", reason: "invalid-json" });
	});

	it("treats binary content as unknown, never clear", async () => {
		const target = path.join(root, "bin.json");
		fs.writeFileSync(target, Buffer.from([0x7b, 0x00, 0x7d]));
		const r = await probeExecutionSource(target);
		expect(r.kind).toBe("unknown");
	});

	it("reports a present-but-unreadable file as unknown, distinct from absent", async () => {
		if (typeof process.getuid === "function" && process.getuid() === 0) {
			return; // root bypasses mode bits — skip rather than assert a false clear
		}
		const target = path.join(root, "locked.json");
		writeJson(target, { disableAllHooks: true });
		fs.chmodSync(target, 0o000);
		try {
			const r = await probeExecutionSource(target);
			expect(r.kind).toBe("unknown");
			expect(r).not.toEqual({ kind: "clear" });
		} finally {
			fs.chmodSync(target, 0o600);
		}
	});

	it("reports blocking('disableAllHooks') for a parsed source that sets it", async () => {
		const target = path.join(root, "d.json");
		writeJson(target, { disableAllHooks: true });
		expect(await probeExecutionSource(target)).toEqual({
			kind: "blocking",
			flag: "disableAllHooks",
		});
	});

	it("reports blocking('allowManagedHooksOnly') for a parsed source that sets it", async () => {
		const target = path.join(root, "a.json");
		writeJson(target, { allowManagedHooksOnly: true });
		expect(await probeExecutionSource(target)).toEqual({
			kind: "blocking",
			flag: "allowManagedHooksOnly",
		});
	});

	it("prefers disableAllHooks when a source sets both flags", async () => {
		const target = path.join(root, "both.json");
		writeJson(target, { disableAllHooks: true, allowManagedHooksOnly: true });
		expect(await probeExecutionSource(target)).toEqual({
			kind: "blocking",
			flag: "disableAllHooks",
		});
	});

	it("reports clear for a parsed source with unrelated keys only", async () => {
		const target = path.join(root, "ok.json");
		writeJson(target, { hooks: {}, model: "x" });
		expect(await probeExecutionSource(target)).toEqual({ kind: "clear" });
	});
});

describe("listManagedDropIns", () => {
	it("returns { entries: [] } when the drop-in dir is absent (ENOENT)", async () => {
		expect(await listManagedDropIns(path.join(root, "no-such-dir"))).toEqual({
			entries: [],
		});
	});

	it("returns only *.json entries, sorted, as full paths (real dir)", async () => {
		const dir = dropInDir();
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, "z.json"), "{}");
		fs.writeFileSync(path.join(dir, "a.json"), "{}");
		fs.writeFileSync(path.join(dir, "readme.md"), "x");
		expect(await listManagedDropIns(dir)).toEqual({
			entries: [path.join(dir, "a.json"), path.join(dir, "z.json")],
		});
	});

	it("uses the injected listDir seam and sorts stably", async () => {
		const dir = "/virtual/managed-settings.d";
		const listDir = async () => ["z.json", "a.json", "readme.md", "m.json"];
		expect(await listManagedDropIns(dir, listDir)).toEqual({
			entries: [
				path.join(dir, "a.json"),
				path.join(dir, "m.json"),
				path.join(dir, "z.json"),
			],
		});
	});

	it("reports a non-ENOENT readdir failure (EACCES) as unreadable, never empty", async () => {
		const dir = "/virtual/locked.d";
		const listDir = async () => {
			const error: NodeJS.ErrnoException = new Error("permission denied");
			error.code = "EACCES";
			throw error;
		};
		const result = await listManagedDropIns(dir, listDir);
		expect(result).not.toEqual({ entries: [] });
		expect("unreadable" in result && result.unreadable).toBe(true);
	});
});

describe("probeExecution — fail-closed verdict matrix", () => {
	it("1. all-clear local sources + current guard → runnable, empty lists", async () => {
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("runnable");
		expect(r.blockers).toEqual([]);
		expect(r.unknownSources).toEqual([]);
	});

	it("2. disableAllHooks at project → blocked, names project", async () => {
		writeJson(path.join(projectDir(), ".claude", "settings.json"), {
			disableAllHooks: true,
		});
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("blocked");
		expect(r.blockers).toContain("policy:disableAllHooks@project");
	});

	it("3. disableAllHooks at local → blocked, names local", async () => {
		writeJson(path.join(projectDir(), ".claude", "settings.local.json"), {
			disableAllHooks: true,
		});
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("blocked");
		expect(r.blockers).toContain("policy:disableAllHooks@local");
	});

	it("4. disableAllHooks at user → blocked, names user", async () => {
		writeJson(path.join(homeDir(), ".claude", "settings.json"), {
			disableAllHooks: true,
		});
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("blocked");
		expect(r.blockers).toContain("policy:disableAllHooks@user");
	});

	it("5. disableAllHooks at managed → blocked, names managed", async () => {
		writeJson(managedFile(), { disableAllHooks: true });
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("blocked");
		expect(r.blockers).toContain("policy:disableAllHooks@managed");
	});

	it("6. allowManagedHooksOnly at managed → blocked", async () => {
		writeJson(managedFile(), { allowManagedHooksOnly: true });
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("blocked");
		expect(r.blockers).toContain("policy:allowManagedHooksOnly@managed");
	});

	it("7. allowManagedHooksOnly at a NON-managed source is inert (does not block)", async () => {
		writeJson(path.join(projectDir(), ".claude", "settings.json"), {
			allowManagedHooksOnly: true,
		});
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("runnable");
		expect(r.blockers).toEqual([]);
	});

	it("7b. non-managed source still blocks on disableAllHooks even with allowManagedHooksOnly set", async () => {
		writeJson(path.join(projectDir(), ".claude", "settings.json"), {
			allowManagedHooksOnly: true,
			disableAllHooks: true,
		});
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("blocked");
		expect(r.blockers).toEqual(["policy:disableAllHooks@project"]);
	});

	it("8. malformed JSON at one source, rest clear → inconclusive, names it, no blockers", async () => {
		const target = path.join(homeDir(), ".claude", "settings.json");
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.writeFileSync(target, "{ broken ]");
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("inconclusive");
		expect(r.blockers).toEqual([]);
		expect(r.unknownSources.join("\n")).toContain("user:");
		expect(r.unknownSources.join("\n")).toContain("invalid-json");
	});

	it("9. symlinked managed file → inconclusive (unknown from managed source)", async () => {
		const realTarget = path.join(managedDir(), "real-managed.json");
		writeJson(realTarget, {});
		fs.symlinkSync(realTarget, managedFile());
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("inconclusive");
		expect(r.unknownSources.join("\n")).toContain("managed:");
	});

	it("10. guard-not-current asset (all sources clear) → blocked with guard:asset", async () => {
		const r = await probeExecution(
			projectDir(),
			{ asset: "edited-managed", settings: "managed-current" },
			baseEnv(),
		);
		expect(r.status).toBe("blocked");
		expect(r.blockers).toContain("guard:asset=edited-managed");
	});

	it("11. guard-not-current settings → blocked with guard:settings", async () => {
		const r = await probeExecution(
			projectDir(),
			{ asset: "managed-current", settings: "absent" },
			baseEnv(),
		);
		expect(r.status).toBe("blocked");
		expect(r.blockers).toContain("guard:settings=absent");
	});

	it("12. CLAUDE_CODE_SAFE_MODE set-truthy → unknownSources caveat + inconclusive", async () => {
		const r = await probeExecution(
			projectDir(),
			CURRENT,
			baseEnv({ env: { CLAUDE_CODE_SAFE_MODE: "1" } }),
		);
		expect(r.status).toBe("inconclusive");
		expect(r.unknownSources.join("\n")).toContain("safe-mode");
	});

	it("13. residual caveats are constant and present every run (even when runnable)", async () => {
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("runnable");
		expect(r.residual.length).toBeGreaterThanOrEqual(2);
		expect(r.residual.join("\n").toLowerCase()).toContain("server");
		expect(r.residual.join("\n").toLowerCase()).toContain("safe-mode");
		// Present with safe-mode unset too.
		expect(r.unknownSources).toEqual([]);
	});

	it("14. simultaneous blocker + unknown → blocked wins (precedence)", async () => {
		writeJson(managedFile(), { disableAllHooks: true });
		const badUser = path.join(homeDir(), ".claude", "settings.json");
		fs.mkdirSync(path.dirname(badUser), { recursive: true });
		fs.writeFileSync(badUser, "{ broken ]");
		const r = await probeExecution(projectDir(), CURRENT, baseEnv());
		expect(r.status).toBe("blocked");
		expect(r.blockers).toContain("policy:disableAllHooks@managed");
		expect(r.unknownSources.length).toBeGreaterThan(0);
	});

	it("15. stable committed order across multiple blockers (source order, guard last)", async () => {
		writeJson(path.join(projectDir(), ".claude", "settings.json"), {
			disableAllHooks: true,
		});
		writeJson(path.join(homeDir(), ".claude", "settings.json"), {
			disableAllHooks: true,
		});
		const r = await probeExecution(
			projectDir(),
			{ asset: "edited-managed", settings: "managed-current" },
			baseEnv(),
		);
		expect(r.blockers).toEqual([
			"policy:disableAllHooks@project",
			"policy:disableAllHooks@user",
			"guard:asset=edited-managed",
		]);
	});

	it("16. unreadable managed drop-in dir (EACCES) → inconclusive, names the dir, never runnable", async () => {
		// An admin ships blocking managed policy ONLY via drop-ins; the drop-in
		// directory is present-but-unenumerable (root-owned 0700). A non-root
		// operator's readdir throws EACCES. This MUST NOT collapse to "no drop-ins"
		// and yield a false `runnable` — it degrades to `inconclusive`.
		const listDir = async () => {
			const error: NodeJS.ErrnoException = new Error("permission denied");
			error.code = "EACCES";
			throw error;
		};
		const r = await probeExecution(projectDir(), CURRENT, baseEnv({ listDir }));
		expect(r.status).toBe("inconclusive");
		expect(r.status).not.toBe("runnable");
		expect(r.blockers).toEqual([]);
		expect(r.unknownSources.join("\n")).toContain(dropInDir());
	});

	it("17. genuinely-absent drop-in dir (ENOENT) contributes nothing → runnable", async () => {
		// The drop-in directory does not exist at all: a legitimate clear state.
		const r = await probeExecution(
			projectDir(),
			CURRENT,
			baseEnv({ managedDropInDir: path.join(root, "no-such-dropins.d") }),
		);
		expect(r.status).toBe("runnable");
		expect(r.unknownSources).toEqual([]);
	});

	it("promotes nothing: an unknown never becomes runnable", async () => {
		fs.writeFileSync(managedFile(), "{ broken ]");
		const r: ExecutionReport = await probeExecution(
			projectDir(),
			CURRENT,
			baseEnv(),
		);
		expect(r.status).not.toBe("runnable");
	});
});
