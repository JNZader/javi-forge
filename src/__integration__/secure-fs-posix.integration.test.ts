// Real-Linux validation of the POSIX secure-fs adapter and the transactional
// SkillGuard installer against a REAL `getfacl`/`setfacl` toolchain.
//
// Every other POSIX test drives an injected `SpawnFn` or a fake
// `PlatformSecureFs`; here the REAL adapter and the REAL entry points run
// against real directories, a real parent-chain gate and a real `getfacl`.
//
// GATE: `describe.skipIf(process.platform !== "linux")` is the ONLY gate. ZERO
// in-test skip branches, ZERO `if (!ok) return;` escapes — the dead-test lesson
// from the old `/tmp`-rooted case in `claude-hook-manager.run.test.ts`, which
// "passed" on every host by returning before its first assertion.
//
// FIXTURE BASE: `mkdtemp` under `RUNNER_TEMP` (CI default) or `$HOME` (dev box),
// 0700. NEVER `os.tmpdir()`/`/tmp`: its `1777` sticky mode makes the ancestor
// gate refuse `unsafe-parent-chain` before any ACL logic runs, so a `/tmp`-rooted
// suite can only prove that `/tmp` is world-writable. The precondition is
// ASSERTED up front — it FAILS naming the offending path, it never skips.
//
// VALIDATION-VIA-REVERT (JD-P-001): the old `JF_INT_BASE=/jf-int` workaround (a
// 0700 base OUTSIDE `/home`) is GONE. GitHub's `ubuntu-latest` image ships
// `/home` with a REAL but BENIGN extended ACL entry, and the ancestor-chain gate
// walks from `/` down. The gate now runs the LENIENT path-endangering predicate,
// so a `$HOME`/`RUNNER_TEMP`-rooted fixture is ALLOWED past a benign `/home`
// instead of over-refused. A green suite under `$HOME` is the empirical proof the
// JD-P-001 over-refusal is closed. If CI `/home` ever carries an ENDANGERING
// entry, the precondition names it — that is a design-revisit trigger, not a
// test edit.
//
// LEG: `JAVI_FORGE_ACL_LEG=absent` (the CI leg where `/usr/bin/getfacl` is
// displaced) selects EXPECTATIONS only — adapter-absent refusals WITH the
// `acl`-package remediation instead of the happy path. Both legs assert.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runClaudeHookCommand } from "../commands/claude-hooks.js";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import {
	installClaudePreToolUse,
	repairClaudePreToolUse,
} from "../lib/claude-hook-manager.js";
import {
	ACL_DETAIL,
	probeAclCapability,
	selectSecureFs,
} from "../lib/secure-fs-posix.js";
import { ACL_PACKAGE_REMEDIATION } from "../lib/secure-refusal-remediation.js";

const LINUX = process.platform === "linux";
const ASSET_NAME = "javi-forge-skillguard-pre-tool-use.mjs";

/** `absent` = the CI leg where `getfacl` has been displaced host-wide. */
const ACL_LEG =
	process.env.JAVI_FORGE_ACL_LEG === "absent" ? "absent" : "present";
const EXPECT_GETFACL = ACL_LEG === "present";

/** The refusal detail every ACL proof must carry in the current leg. */
const EXPECTED_ACL_DETAIL = EXPECT_GETFACL
	? ACL_DETAIL.extendedAclEntry
	: ACL_DETAIL.getfaclAbsent;

let baseDir: string;

/**
 * A PRIVATE fixture root: `RUNNER_TEMP` on a GitHub runner, else `$HOME` on a
 * dev box. Never `os.tmpdir()` — see the header.
 *
 * The old `JF_INT_BASE=/jf-int` workaround (a 0700 base OUTSIDE `/home`) is GONE
 * (JD-P-001): the ancestor gate now runs the LENIENT path-endangering predicate,
 * so a `$HOME`/`RUNNER_TEMP`-rooted fixture whose `/home` carries a BENIGN
 * extended ACL is allowed instead of over-refused. A green suite under `$HOME`
 * is the empirical proof the narrowing closed the over-refusal.
 */
function privateRoot(): string {
	// An exported-but-EMPTY RUNNER_TEMP is `absent`, not a valid root: `||` rejects
	// it and would otherwise hand `mkdtemp` a relative cwd-rooted path.
	return process.env.RUNNER_TEMP?.trim() || os.homedir();
}

function mkProject(tag: string): string {
	const dir = path.join(baseDir, `${tag}-${randomBytes(4).toString("hex")}`);
	fs.mkdirSync(dir, { mode: 0o700 });
	fs.chmodSync(dir, 0o700); // defeat umask masking of mkdir's mode
	return dir;
}

/** Every directory from the filesystem root down to `target`, inclusive. */
function ancestorsOf(target: string): string[] {
	const chain: string[] = [];
	let current = path.resolve(target);
	for (;;) {
		chain.unshift(current);
		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return chain;
}

/**
 * Every ancestor of `target` the REAL narrowed adapter treats as path-ENDANGERING
 * (a foreign principal that can swap/delete/rename the on-path node), with the
 * refusal detail. Empty on a chain the lenient predicate allows — which now
 * includes a benign `/home` carrying a masked/read-only/`default:*` extended ACL.
 *
 * Uses the real `proveNoEndangeringAcl` (not a duplicated regex) so the
 * precondition proves EXACTLY what the install path will decide. Only meaningful
 * on the `present` leg — the caller gates on `EXPECT_GETFACL`.
 */
async function endangeringAncestors(target: string): Promise<string[]> {
	const secureFs = selectSecureFs("linux");
	if (!secureFs) throw new Error("selectSecureFs('linux') returned no adapter");
	const offenders: string[] = [];
	for (const dir of ancestorsOf(target)) {
		const res = await secureFs.proveNoEndangeringAcl(dir);
		if (!res.ok) offenders.push(`${dir} (${res.detail ?? res.refusal})`);
	}
	return offenders;
}

function claudePaths(projectDir: string): {
	claudeDir: string;
	assetPath: string;
	settingsPath: string;
} {
	const claudeDir = path.join(projectDir, ".claude");
	return {
		claudeDir,
		assetPath: path.join(claudeDir, "hooks", ASSET_NAME),
		settingsPath: path.join(claudeDir, "settings.json"),
	};
}

/** Drive the real CLI path and capture what the user would actually see. */
async function renderInstall(
	projectDir: string,
): Promise<{ code: number; out: string }> {
	const lines: string[] = [];
	const code = await runClaudeHookCommand(
		"install",
		projectDir,
		{},
		{ log: (m) => lines.push(m), logError: (m) => lines.push(m) },
	);
	return { code, out: lines.join("\n") };
}

describe.skipIf(!LINUX)(
	`real POSIX secure-fs (linux only, acl-leg=${ACL_LEG})`,
	() => {
		// The PATH-clobbering test restores PATH in its own `finally`, but that
		// only holds while it is the last test in the file: a test appended after
		// it, or a mid-`finally` crash, would leak an empty PATH into the rest of
		// the run. Capture the pristine value here and restore it idempotently in
		// `afterAll` too — belt and suspenders, and a no-op when the `finally` did
		// its job.
		const originalPath = process.env.PATH;

		beforeAll(() => {
			baseDir = fs.mkdtempSync(path.join(privateRoot(), "jf-posixsecfs-"));
			fs.chmodSync(baseDir, 0o700);
		});
		afterAll(() => {
			if (originalPath === undefined) delete process.env.PATH;
			else process.env.PATH = originalPath;
			if (baseDir) fs.rmSync(baseDir, { recursive: true, force: true });
		});

		// === PRECONDITION: the base is private, and so is every ancestor ==========
		// The gate walks root..projectDir, so a world-writable ancestor anywhere in
		// that chain refuses `unsafe-parent-chain` and would mask every ACL result
		// below. This is an ASSERTION, not a skip guard: a suite that cannot prove
		// its own fixture base proves nothing at all.
		it("PRECONDITION: fixture base is a private 0700 dir with a private ancestor chain", async () => {
			expect(
				baseDir.startsWith(path.resolve(os.tmpdir())),
				`fixture base is rooted under the world-writable ${os.tmpdir()}: ${baseDir}`,
			).toBe(false);

			const euid = process.geteuid?.() ?? -1;
			const baseStats = fs.lstatSync(baseDir);
			expect(
				baseStats.uid,
				`fixture base ${baseDir} is not owned by euid`,
			).toBe(euid);
			expect(
				baseStats.mode & 0o7777,
				`fixture base ${baseDir} is not mode 0700`,
			).toBe(0o700);

			for (const dir of ancestorsOf(baseDir)) {
				const stats = fs.lstatSync(dir);
				expect(
					stats.uid === euid || stats.uid === 0,
					`controlling directory ${dir} is owned by uid ${stats.uid} (neither euid ${euid} nor root)`,
				).toBe(true);
				expect(
					stats.mode & 0o022,
					`controlling directory ${dir} is group- or world-writable (mode ${(stats.mode & 0o7777).toString(8)})`,
				).toBe(0);
			}

			// On the happy-path leg the chain must be free of PATH-ENDANGERING ACL
			// entries: the narrowed adapter refuses on the FIRST ancestor a foreign
			// principal could swap/delete/rename, so an endangering ancestor would
			// otherwise surface as an opaque install refusal two tests down. Name it
			// here instead. A BENIGN extended entry (GitHub `ubuntu-latest` ships
			// `/home` with a masked/read-only one) is ALLOWED — that is precisely the
			// JD-P-001 over-refusal this change closes. An endangering entry here is a
			// DESIGN-REVISIT trigger, not a test edit.
			const aclOffenders = EXPECT_GETFACL
				? await endangeringAncestors(baseDir)
				: [];
			expect(
				aclOffenders,
				`controlling directories carry PATH-ENDANGERING ACL entries the narrowed adapter refuses: ${aclOffenders.join(", ")} — if this is a real GH runner /home entry, revisit the JD-P-001 predicate, do not edit this test`,
			).toEqual([]);
		});

		// === LEG PROOF: the host matches the leg this run claims to exercise ======
		it("LEG: the host ACL capability matches JAVI_FORGE_ACL_LEG", async () => {
			const capability = await probeAclCapability();
			expect(
				capability.status,
				`leg=${ACL_LEG} but probeAclCapability reported ${capability.status}`,
			).toBe(EXPECT_GETFACL ? "available" : "absent");
			expect(capability.tool).toBe("getfacl");
		});

		// === INSTALL + IDEMPOTENCY through the real gate =========================
		it("installs both components through the real getfacl gate, then re-runs as a zero-write no-op", async () => {
			const projectDir = mkProject("install");
			const { claudeDir, assetPath, settingsPath } = claudePaths(projectDir);

			const first = await installClaudePreToolUse(projectDir);

			if (EXPECT_GETFACL) {
				expect(first.ok, `install refused: ${first.errors.join(" | ")}`).toBe(
					true,
				);
				expect(first.changed).toEqual([assetPath, settingsPath]);
				expect(fs.readFileSync(assetPath)).toEqual(
					fs.readFileSync(path.join(CLAUDE_HOOK_ASSETS_DIR, ASSET_NAME)),
				);
				// The managed containers the transaction created must themselves be
				// private (0700, owner-only) — they hold the executed asset.
				for (const dir of [claudeDir, path.dirname(assetPath)]) {
					expect(fs.lstatSync(dir).mode & 0o7777, `${dir} is not 0700`).toBe(
						0o700,
					);
				}

				const before = [assetPath, settingsPath].map((p) => ({
					bytes: fs.readFileSync(p),
					mtimeMs: fs.statSync(p).mtimeMs,
				}));

				const second = await installClaudePreToolUse(projectDir);
				expect(
					second.ok,
					`idempotent run refused: ${second.errors.join(" | ")}`,
				).toBe(true);
				expect(second.changed).toEqual([]);
				expect(second.backups).toEqual([]);

				const repaired = await repairClaudePreToolUse(projectDir, {});
				expect(
					repaired.ok,
					`repair refused: ${repaired.errors.join(" | ")}`,
				).toBe(true);
				expect(repaired.changed).toEqual([]);

				// Byte- AND mtime-stable: a "no-op" that rewrites identical bytes is
				// still a write, and would rotate the mtime.
				const after = [assetPath, settingsPath].map((p) => ({
					bytes: fs.readFileSync(p),
					mtimeMs: fs.statSync(p).mtimeMs,
				}));
				expect(after).toEqual(before);
			} else {
				// Adapter absent: fail closed on the FIRST controlling directory, with
				// zero mutation — no asset, no settings, no backup, no temp file.
				expect(first.ok, "install committed without a resolvable getfacl").toBe(
					false,
				);
				expect(first.changed).toEqual([]);
				expect(first.backups).toEqual([]);
				expect(first.errors.join(" | ")).toContain(ACL_DETAIL.getfaclAbsent);
				expect(fs.readdirSync(projectDir)).toEqual([]);
			}
		});

		// === STRICT refuses a real named entry, LENIENT gate INSTALLS past it =====
		// A read-only foreign named-user (`u:nobody:r`) on a controlling ANCESTOR is
		// mode-innocuous (mask r-- → no group/other write bit). The STRICT proof
		// still refuses it (managed containers + leaf source rely on that), but the
		// narrowed LENIENT ancestor gate that drives the full install ALLOWS it —
		// this is the JD-P-001 over-refusal being fixed, proven end-to-end through the
		// real CLI. (An effective-WRITE entry cannot isolate the ACL path here: the
		// mask couples into st_mode's group class, so `proveOwnershipAndMode` refuses
		// it first — the lenient ACL refuse is exercised directly in the tests below.)
		it("STRICT refuses a read-only named entry the LENIENT ancestor gate now installs past (JD-P-001)", async () => {
			const projectDir = mkProject("extended-acl");
			execFileSync("setfacl", ["-m", "u:nobody:r", projectDir], {
				stdio: "pipe",
			});

			const secureFs = selectSecureFs("linux");
			expect(secureFs, "selectSecureFs('linux') returned no adapter").not.toBe(
				null,
			);
			// STRICT proof (managed-container/leaf predicate) still refuses ANY named.
			const strict = await secureFs?.proveNoExtendedAcl(projectDir);
			expect(
				strict?.ok,
				`proveNoExtendedAcl accepted a named-user ACL: ${strict?.detail}`,
			).toBe(false);
			expect(strict?.refusal).toBe("unsupported-posix-acl");
			expect(strict?.detail).toBe(EXPECTED_ACL_DETAIL);
			// The mode stays innocuous (no group/other write) — a read-only mask.
			expect(fs.lstatSync(projectDir).mode & 0o022).toBe(0);
			// LENIENT ancestor proof ALLOWS it on the happy leg (read-only ≠ endanger).
			const lenient = await secureFs?.proveNoEndangeringAcl(projectDir);
			expect(lenient?.ok).toBe(EXPECT_GETFACL);

			const { code, out } = await renderInstall(projectDir);
			if (EXPECT_GETFACL) {
				// The over-refusal is CLOSED: the benign read-only ancestor entry no
				// longer blocks the install. It commits both components.
				expect(
					code,
					`install refused a benign read-only ancestor: ${out}`,
				).toBe(0);
				expect(fs.existsSync(path.join(projectDir, ".claude"))).toBe(true);
			} else {
				// getfacl displaced: fail closed with the adapter-absent detail.
				expect(code, `install did not refuse: ${out}`).toBe(1);
				expect(out).toContain(EXPECTED_ACL_DETAIL);
				expect(fs.readdirSync(projectDir)).toEqual([]);
			}

			// A resolvable adapter never suggests installing the `acl` package (it is
			// already there); the hint belongs to the adapter-absent path alone.
			expect(
				out.includes(ACL_PACKAGE_REMEDIATION),
				"package remediation leaked onto a resolvable-adapter run",
			).toBe(!EXPECT_GETFACL);
		});

		// === LENIENT ANCESTOR PREDICATE over a REAL setfacl'd dir (JD-P-001) =======
		// The narrowed `proveNoEndangeringAcl` must ALLOW a benign (masked read-only)
		// foreign named-user on a controlling directory — the exact over-refusal this
		// change fixes — while still REFUSING a foreign named-user with effective
		// write.
		it("ALLOWS a masked read-only foreign named-user on a controlling directory (the over-refusal fix)", async () => {
			const projectDir = mkProject("masked-ro");
			// nobody(65534): rwx granted but the mask pins effective down to r--.
			execFileSync(
				"setfacl",
				["-m", "u:65534:rwx", "-m", "m::r--", projectDir],
				{ stdio: "pipe" },
			);
			// Mode carries no group/other write — only the ACL math decides this.
			expect(fs.lstatSync(projectDir).mode & 0o022).toBe(0);

			const secureFs = selectSecureFs("linux");
			const res = await secureFs?.proveNoEndangeringAcl(projectDir);
			if (EXPECT_GETFACL) {
				expect(
					res?.ok,
					`lenient predicate refused a masked read-only named-user: ${res?.detail}`,
				).toBe(true);
			} else {
				// getfacl displaced → fail closed with the adapter-absent detail.
				expect(res?.ok).toBe(false);
				expect(res?.detail).toBe(ACL_DETAIL.getfaclAbsent);
			}
		});

		it("REFUSES a foreign named-user with effective write on a controlling directory", async () => {
			const projectDir = mkProject("foreign-write");
			// nobody(65534): rwx with the auto-recalculated mask rwx → effective rwx,
			// and 65534 ∉ {owner, root, euid} → path-endangering.
			execFileSync("setfacl", ["-m", "u:65534:rwx", projectDir], {
				stdio: "pipe",
			});

			const secureFs = selectSecureFs("linux");
			const res = await secureFs?.proveNoEndangeringAcl(projectDir);
			expect(
				res?.ok,
				"lenient predicate allowed a foreign named-user with effective write",
			).toBe(false);
			expect(res?.refusal).toBe("unsupported-posix-acl");
			expect(res?.detail).toBe(EXPECTED_ACL_DETAIL);
			// The strict managed-container proof refuses it too (defence in depth).
			expect((await secureFs?.proveManagedContainer(projectDir))?.ok).toBe(
				false,
			);
		});

		// === getfacl unresolvable IN-PROCESS: real ENOENT, real remediation =======
		// Runs identically in BOTH legs. The PATH window is kept as small as
		// possible (one call) because everything inside it loses `node`, `getfacl`
		// and every other PATH-resolved binary.
		it("renders the acl-package remediation when getfacl is unresolvable on PATH", async () => {
			const projectDir = mkProject("no-getfacl");
			const emptyPathDir = path.join(baseDir, "empty-path-dir");
			fs.mkdirSync(emptyPathDir, { recursive: true });

			const previousPath = process.env.PATH;
			let rendered: { code: number; out: string };
			try {
				// `defaultSpawn` inherits `process.env`, so an empty PATH produces a
				// REAL ENOENT from `execFile("getfacl", ...)` — not a mocked one.
				process.env.PATH = emptyPathDir;
				rendered = await renderInstall(projectDir);
			} finally {
				if (previousPath === undefined) delete process.env.PATH;
				else process.env.PATH = previousPath;
			}

			expect(rendered.code, `install did not refuse: ${rendered.out}`).toBe(1);
			expect(rendered.out).toContain(ACL_DETAIL.getfaclAbsent);
			expect(
				rendered.out,
				"an adapter-absent refusal was rendered bare, with no package remediation",
			).toContain(ACL_PACKAGE_REMEDIATION);
			expect(fs.readdirSync(projectDir)).toEqual([]);
		});
	},
);
