// Real-Windows validation of the digest-bound `.ps1` secure-object helper.
//
// This is the FIRST-EVER execution surface for
// `assets/claude-hooks/javi-forge-windows-secure-object.ps1`: every other test
// in the suite drives a FAKE `HelperTransport`. Here we drive the REAL adapter
// `createWindowsSecureFs(createPs1Session())` (which digest-verifies + spawns the
// real `powershell.exe` helper) against REAL NTFS fixtures built with `icacls`,
// `mklink /J`, and .NET `Set-Acl` on the C: volume.
//
// The whole suite is `describe.skipIf(process.platform !== "win32")` so it is
// INERT on the Linux dev box (0 run / all skipped) and only executes on the
// `windows-latest` CI job (Phase 5 / Decision 3). Because the `.ps1` has never
// run, a RED result here is EXPECTED and diagnostic: every assertion names the
// ledger fixture it maps to (ACL-1, ACL-6, ACL-7, ...) and includes the refusal
// `detail` in its message so the first-run `.ps1` issues (Add-Type compile,
// P/Invoke signatures, framing protocol) are pinpointable from the CI log.
//
// Fixture -> ledger-case map (design.md Decision 3 A-F):
//   ACCEPT  ACL-1 / E / E-root  -> real transactional install + idempotent + live C:\ probe
//   REFUSE  ACL-2  Everyone:(F)                 -> proveDacl
//           ACL-2c raw GENERIC_WRITE on a FILE  -> proveDacl (generic expansion)
//           ACL-2d raw GENERIC_ALL on a DIR     -> proveDacl (generic expansion)
//           ACL-4  NULL DACL                    -> proveDacl
//           ACL-5  foreign owner                -> proveOwner
//           ACL-6  Everyone:(AD) add-child      -> proveManagedContainer (tolerated by gate)
//           ACL-7  asset-only-repair grandparent (JDA-401) -> full tx, zero mutation
//           ACL-8  settings-only-repair delete-child (JDB5-001) -> full tx, zero mutation
//           ACL-8b settings-only-repair add-file            -> full tx, zero mutation
//           ACL-9  hooks-dir junction (JDA6-001)            -> full tx, zero mutation
//   REPARSE REPARSE-1 junction at `.claude`     -> openDirNoFollow (notFound=false)
//   EXCL    EXCL-1 pre-existing file            -> writeExclusive
//           EXCL-2 pre-existing dir             -> createDirExclusive
//   NOTDIR  JDA7-001 non-directory segment      -> openDirNoFollow refuses
//   DIGEST  F  tampered `.ps1`                  -> refusingTransport, NO spawn

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type PlatformSecureFs,
	runTransaction,
	type TransactionComponent,
} from "../lib/secure-fs-transaction.js";
import {
	createPs1Session,
	createWindowsSecureFs,
} from "../lib/secure-fs-windows.js";

const WIN = process.platform === "win32";
const ASSET_NAME = "javi-forge-skillguard-pre-tool-use.mjs";
const EVERYONE = "*S-1-1-0"; // SID-based to avoid runner locale differences
const NETWORK_SERVICE = "*S-1-5-20"; // a concretely NON-trusted owner (not SYSTEM/Admins/TI)

// --- deterministic transaction deps ---------------------------------------
const clock = () => new Date("2026-08-17T00:00:00.000Z");
let nonceCounter = 0;
const nonce = () => (nonceCounter++).toString(16).padStart(8, "0");

// --- host tooling (only ever called inside win32-gated `it`s) --------------
function icacls(target: string, ...args: string[]): void {
	execFileSync("icacls", [target, ...args], { stdio: "pipe" });
}
function mklinkJunction(link: string, target: string): void {
	execFileSync("cmd", ["/c", "mklink", "/J", link, target], { stdio: "pipe" });
}
function pwsh(script: string): void {
	execFileSync(
		"powershell.exe",
		["-NoProfile", "-NonInteractive", "-Command", script],
		{ stdio: "pipe" },
	);
}
/** Replace a path's whole security descriptor via a raw SDDL string (emits
 * generic bits / NULL DACL / foreign owner that `icacls` cannot). */
function setSddl(target: string, sddl: string): void {
	pwsh(
		`$a = Get-Acl -LiteralPath '${target}'; ` +
			`$a.SetSecurityDescriptorSddlForm('${sddl}'); ` +
			`Set-Acl -LiteralPath '${target}' -AclObject $a`,
	);
}
/** Remove a directory/junction robustly (rmdir does NOT follow a junction). */
function rmrf(target: string): void {
	try {
		fs.rmSync(target, { recursive: true, force: true, maxRetries: 3 });
	} catch {
		try {
			execFileSync("cmd", ["/c", "rmdir", "/s", "/q", target], {
				stdio: "pipe",
			});
		} catch {
			/* best-effort cleanup */
		}
	}
}
/** Remove ONLY a junction link (never its target contents). */
function rmJunction(link: string): void {
	try {
		execFileSync("cmd", ["/c", "rmdir", "/q", link], { stdio: "pipe" });
	} catch {
		/* best-effort */
	}
}

// --- fixture scaffolding ---------------------------------------------------
let baseDir: string; // one C:-volume scratch root; ancestor chain includes real C:\
let secureFs: PlatformSecureFs; // shared real adapter (lazy-spawns one powershell)

function cVolumeRoot(): string {
	// %USERPROFILE% lives on C:, so ancestor-chain gating reaches the REAL C:\
	// root (E-root guard: RUNNER_TEMP is on D:\ and would hide JDB-201).
	return process.env.USERPROFILE ?? os.homedir();
}

function mkProject(tag: string): string {
	const dir = path.join(baseDir, `${tag}-${randomBytes(4).toString("hex")}`);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function comp(
	target: string,
	desired: Buffer | null,
	wasAbsent: boolean,
): TransactionComponent {
	return {
		path: target,
		desired,
		capturePrior: !wasAbsent && desired !== null,
		forceBackup: false,
		wasAbsent,
	};
}

function claudePaths(projectDir: string): {
	claudeDir: string;
	hooksDir: string;
	assetPath: string;
	settingsPath: string;
} {
	const claudeDir = path.join(projectDir, ".claude");
	const hooksDir = path.join(claudeDir, "hooks");
	return {
		claudeDir,
		hooksDir,
		assetPath: path.join(hooksDir, ASSET_NAME),
		settingsPath: path.join(claudeDir, "settings.json"),
	};
}

describe.skipIf(!WIN)(
	"real win32 secure-object .ps1 (windows-latest only)",
	() => {
		beforeAll(() => {
			baseDir = fs.mkdtempSync(path.join(cVolumeRoot(), "jf-winsecfs-"));
			secureFs = createWindowsSecureFs(createPs1Session());
		});
		afterAll(() => {
			if (baseDir) rmrf(baseDir);
		});

		// === ACCEPT: real transactional install (ACL-1 + section E + FLUSH commit) ===
		it("ACL-1/E: installs both components transactionally into a fresh C: project, idempotent", async () => {
			const projectDir = mkProject("acl1-accept");
			const { assetPath, settingsPath } = claudePaths(projectDir);

			const out = await runTransaction({
				secureFs,
				clock,
				nonce,
				projectDir,
				asset: comp(assetPath, Buffer.from("asset-v1\n"), true),
				settings: comp(settingsPath, Buffer.from('{"v":1}\n'), true),
			});

			expect(out.ok, `install refused: ${out.errors.join(" | ")}`).toBe(true);
			expect(out.committed).toEqual([assetPath, settingsPath]);
			expect(fs.existsSync(assetPath)).toBe(true);
			expect(fs.readFileSync(assetPath, "utf8")).toBe("asset-v1\n");

			// The created managed containers must themselves re-pass Predicate A AND
			// proveManagedContainer (owner-only protected object, zero foreign add-child).
			const { claudeDir, hooksDir } = claudePaths(projectDir);
			for (const dir of [claudeDir, hooksDir]) {
				const own = await secureFs.proveOwnershipAndMode(dir);
				expect(own.ok, `proveOwner ${dir}: ${own.detail}`).toBe(true);
				const dacl = await secureFs.proveNoExtendedAcl(dir);
				expect(dacl.ok, `proveDacl ${dir}: ${dacl.detail}`).toBe(true);
				const mc = await secureFs.proveManagedContainer(dir);
				expect(mc.ok, `proveManagedContainer ${dir}: ${mc.detail}`).toBe(true);
			}

			// Idempotent: a second run with nothing to write is a zero-write no-op that
			// still gates the ancestor chain (real C:\) and commits nothing.
			const noop = await runTransaction({
				secureFs,
				clock,
				nonce,
				projectDir,
				asset: comp(assetPath, null, false),
				settings: comp(settingsPath, null, false),
			});
			expect(
				noop.ok,
				`idempotent run refused: ${noop.errors.join(" | ")}`,
			).toBe(true);
			expect(noop.committed).toEqual([]);
		});

		// === E-root: MANDATORY live C:\ / C:\Users read-only probe (JDB-201 guard) ===
		it("E-root: live C:\\ and C:\\Users pass Predicate A (proveOwner + proveDacl)", async () => {
			const cDrive = path.parse(cVolumeRoot()).root; // "C:\\"
			const cUsers = path.join(cDrive, "Users");
			for (const ancestor of [cDrive, cUsers]) {
				const own = await secureFs.proveOwnershipAndMode(ancestor);
				expect(own.ok, `proveOwner ${ancestor}: ${own.detail}`).toBe(true);
				const dacl = await secureFs.proveNoExtendedAcl(ancestor);
				expect(dacl.ok, `proveDacl ${ancestor}: ${dacl.detail}`).toBe(true);
			}
		});

		// === REFUSE: uniform-gate DACL predicate (proveDacl) ===
		it("ACL-2: Everyone:(F) on a dir refuses at the uniform gate (proveDacl)", async () => {
			const dir = mkProject("acl2-full");
			icacls(dir, "/grant", `${EVERYONE}:(F)`);
			const res = await secureFs.proveNoExtendedAcl(dir);
			expect(res.ok).toBe(false);
			expect(res.refusal).toBe("unsafe-windows-dacl");
			expect(res.detail, `unexpected detail: ${res.detail}`).toMatch(
				/path-endangering|foreign/i,
			);
		});

		it("ACL-2c: raw GENERIC_WRITE on a FILE refuses after MapGenericMask (proveDacl)", async () => {
			const file = path.join(mkProject("acl2c"), "leaf.txt");
			fs.writeFileSync(file, "x");
			// GENERIC_WRITE (0x40000000) for Everyone; icacls cannot emit generic bits.
			setSddl(file, `O:BAG:BAD:P(A;;0x40000000;;;WD)`);
			const res = await secureFs.proveNoExtendedAcl(file);
			expect(
				res.ok,
				`proveDacl accepted raw GENERIC_WRITE: ${res.detail}`,
			).toBe(false);
			expect(res.refusal).toBe("unsafe-windows-dacl");
		});

		it("ACL-2d: raw GENERIC_ALL on a DIR refuses after MapGenericMask (proveDacl)", async () => {
			const dir = mkProject("acl2d");
			// GENERIC_ALL (0x10000000) -> FILE_ALL_ACCESS superset (DELETE|WRITE_DAC|...).
			setSddl(dir, `O:BAG:BAD:P(A;;0x10000000;;;WD)`);
			const res = await secureFs.proveNoExtendedAcl(dir);
			expect(res.ok, `proveDacl accepted raw GENERIC_ALL: ${res.detail}`).toBe(
				false,
			);
			expect(res.refusal).toBe("unsafe-windows-dacl");
		});

		it("ACL-4: NULL DACL refuses (proveDacl)", async () => {
			const dir = mkProject("acl4");
			// SDDL with NO `D:` section => DACL absent => NULL DACL (everyone: full).
			setSddl(dir, `O:BAG:BA`);
			const res = await secureFs.proveNoExtendedAcl(dir);
			expect(res.ok, `proveDacl accepted a NULL DACL: ${res.detail}`).toBe(
				false,
			);
			expect(res.refusal).toBe("unsafe-windows-dacl");
		});

		it("ACL-5: foreign owner refuses (proveOwner)", async () => {
			const file = path.join(mkProject("acl5"), "leaf.txt");
			fs.writeFileSync(file, "x");
			icacls(file, "/setowner", NETWORK_SERVICE);
			const res = await secureFs.proveOwnershipAndMode(file);
			expect(res.ok, `proveOwner accepted a foreign owner: ${res.detail}`).toBe(
				false,
			);
			expect(res.refusal).toBe("unsafe-windows-dacl");
			expect(res.detail, `unexpected detail: ${res.detail}`).toMatch(/owner/i);
		});

		// === ACL-6: add-child tolerated at gate, refused at proveManagedContainer ===
		it("ACL-6: Everyone:(AD) is tolerated by the gate but refused by proveManagedContainer", async () => {
			const dir = mkProject("acl6");
			icacls(dir, "/grant", `${EVERYONE}:(AD)`); // add-subdirectory (materialized)
			// Uniform gate TOLERATES foreign add-child on an ordinary dir...
			const gateOwner = await secureFs.proveOwnershipAndMode(dir);
			const gateDacl = await secureFs.proveNoExtendedAcl(dir);
			expect(
				gateOwner.ok,
				`gate proveOwner unexpectedly refused: ${gateOwner.detail}`,
			).toBe(true);
			expect(
				gateDacl.ok,
				`gate proveDacl unexpectedly refused add-child: ${gateDacl.detail}`,
			).toBe(true);
			// ...but a dir the tool OWNS must refuse foreign add-child.
			const mc = await secureFs.proveManagedContainer(dir);
			expect(
				mc.ok,
				`proveManagedContainer accepted foreign add-child: ${mc.detail}`,
			).toBe(false);
			expect(mc.refusal).toBe("unsafe-windows-dacl");
			expect(mc.detail, `unexpected detail: ${mc.detail}`).toMatch(
				/add-child|foreign/i,
			);
		});

		// === ACL-7: asset-only-repair grandparent `.claude` (JDA-401), zero mutation ===
		it("ACL-7: foreign add-file on `.claude` refuses the whole tx with zero mutation", async () => {
			const projectDir = mkProject("acl7");
			const { claudeDir, hooksDir, assetPath, settingsPath } =
				claudePaths(projectDir);
			fs.mkdirSync(hooksDir, { recursive: true });
			fs.writeFileSync(assetPath, "stale-asset\n"); // present but STALE (will drift -> write)
			fs.writeFileSync(settingsPath, '{"current":true}\n');
			icacls(claudeDir, "/grant", `${EVERYONE}:(WD)`); // foreign FILE_ADD_FILE on grandparent

			const out = await runTransaction({
				secureFs,
				clock,
				nonce,
				projectDir,
				asset: comp(assetPath, Buffer.from("fresh-asset\n"), false), // drift -> write
				settings: comp(settingsPath, null, false), // settings noop
			});

			expect(out.ok, "tx unexpectedly committed a poisoned grandparent").toBe(
				false,
			);
			expect(out.committed).toEqual([]);
			expect(out.errors.join(" | ")).toMatch(/add-child|unsafe-windows-dacl/i);
			// zero mutation: the stale asset bytes are untouched.
			expect(fs.readFileSync(assetPath, "utf8")).toBe("stale-asset\n");
		});

		// === ACL-8: settings-only-repair hooks-dir delete-child (JDB5-001) ===
		it("ACL-8: foreign FILE_DELETE_CHILD on `.claude/hooks` refuses a settings-only repair", async () => {
			const projectDir = mkProject("acl8");
			const { hooksDir, assetPath, settingsPath } = claudePaths(projectDir);
			fs.mkdirSync(hooksDir, { recursive: true });
			fs.writeFileSync(assetPath, "current-asset\n"); // present + CURRENT (asset noop)
			fs.writeFileSync(settingsPath, "old-settings\n"); // DRIFTED -> write
			icacls(hooksDir, "/grant", `${EVERYONE}:(DC)`); // foreign delete-child

			const out = await runTransaction({
				secureFs,
				clock,
				nonce,
				projectDir,
				asset: comp(assetPath, null, false), // noop => createIfAbsent=false for hooksDir
				settings: comp(settingsPath, Buffer.from("new-settings\n"), false),
			});

			expect(
				out.ok,
				"settings-only repair committed over a poisoned hooks-dir",
			).toBe(false);
			expect(out.committed).toEqual([]);
			expect(out.errors.join(" | ")).toMatch(
				/path-endangering|add-child|unsafe-windows-dacl/i,
			);
			expect(fs.readFileSync(settingsPath, "utf8")).toBe("old-settings\n");
		});

		it("ACL-8b: foreign FILE_ADD_FILE on `.claude/hooks` refuses a settings-only repair", async () => {
			const projectDir = mkProject("acl8b");
			const { hooksDir, assetPath, settingsPath } = claudePaths(projectDir);
			fs.mkdirSync(hooksDir, { recursive: true });
			fs.writeFileSync(assetPath, "current-asset\n");
			fs.writeFileSync(settingsPath, "old-settings\n");
			icacls(hooksDir, "/grant", `${EVERYONE}:(WD)`); // foreign add-file (plant half)

			const out = await runTransaction({
				secureFs,
				clock,
				nonce,
				projectDir,
				asset: comp(assetPath, null, false),
				settings: comp(settingsPath, Buffer.from("new-settings\n"), false),
			});

			expect(out.ok).toBe(false);
			expect(out.committed).toEqual([]);
			expect(out.errors.join(" | ")).toMatch(/add-child|unsafe-windows-dacl/i);
			expect(fs.readFileSync(settingsPath, "utf8")).toBe("old-settings\n");
		});

		// === ACL-9: hooks-dir replaced by a JUNCTION (JDA6-001), notFound=false ===
		it("ACL-9: a junction at `.claude/hooks` refuses a settings-only repair (notFound=false)", async () => {
			const projectDir = mkProject("acl9");
			const { claudeDir, hooksDir, assetPath, settingsPath } =
				claudePaths(projectDir);
			const attackerDir = mkProject("acl9-attacker");
			fs.mkdirSync(claudeDir, { recursive: true });
			fs.writeFileSync(settingsPath, "old-settings\n"); // DRIFTED -> write
			// asset resolves THROUGH the junction and byte-matches -> asset noop.
			fs.writeFileSync(path.join(attackerDir, ASSET_NAME), "current-asset\n");
			mklinkJunction(hooksDir, attackerDir);
			try {
				// Direct-adapter proof: openDirNoFollow refuses the reparse point as
				// PRESENT (notFound MUST be false so ensureManagedContainer fails closed).
				const opened = await secureFs.openDirNoFollow(hooksDir);
				expect(opened.ok, "openDirNoFollow followed a junction").toBe(false);
				expect(
					opened.notFound,
					"a present reparse point was mis-reported as not-found",
				).toBeFalsy();

				const out = await runTransaction({
					secureFs,
					clock,
					nonce,
					projectDir,
					asset: comp(assetPath, null, false), // createIfAbsent=false for hooksDir
					settings: comp(settingsPath, Buffer.from("new-settings\n"), false),
				});
				expect(out.ok, "settings committed over a junctioned hooks-dir").toBe(
					false,
				);
				expect(out.committed).toEqual([]);
				expect(fs.readFileSync(settingsPath, "utf8")).toBe("old-settings\n");
			} finally {
				rmJunction(hooksDir);
				rmrf(attackerDir);
			}
		});

		// === REPARSE-1: a junction at `.claude` refuses openDirNoFollow ===
		it("REPARSE-1: a junction at `.claude` refuses openDirNoFollow (notFound=false)", async () => {
			const projectDir = mkProject("reparse1");
			const claudeDir = path.join(projectDir, ".claude");
			const attackerDir = mkProject("reparse1-attacker");
			mklinkJunction(claudeDir, attackerDir);
			try {
				const opened = await secureFs.openDirNoFollow(claudeDir);
				expect(opened.ok, "openDirNoFollow followed a junction").toBe(false);
				expect(opened.notFound).toBeFalsy();
			} finally {
				rmJunction(claudeDir);
				rmrf(attackerDir);
			}
		});

		// === JDA7-001: a non-directory segment refuses (POSIX O_DIRECTORY parity) ===
		it("JDA7-001: openDirNoFollow refuses a regular file (non-directory), notFound=false", async () => {
			const file = path.join(mkProject("notdir"), "not-a-dir");
			fs.writeFileSync(file, "x");
			const opened = await secureFs.openDirNoFollow(file);
			expect(opened.ok).toBe(false);
			expect(opened.notFound).toBeFalsy();
			expect(opened.detail, `unexpected detail: ${opened.detail}`).toMatch(
				/not a directory/i,
			);
		});

		// === EXCL: exclusive create refuses a pre-existing target ===
		it("EXCL-1/EXCL-2: writeExclusive and createDirExclusive refuse pre-existing names", async () => {
			const dir = mkProject("excl");
			fs.writeFileSync(path.join(dir, "file-exists"), "x");
			fs.mkdirSync(path.join(dir, "dir-exists"));
			const handleRes = await secureFs.openDirNoFollow(dir);
			expect(handleRes.ok, `openDir ${dir}: ${handleRes.detail}`).toBe(true);
			const handle = handleRes.value;
			if (!handle) throw new Error("no handle");
			try {
				const wr = await secureFs.writeExclusive(
					handle,
					"file-exists",
					Buffer.from("y"),
					0o600,
				);
				expect(wr.ok, "writeExclusive overwrote a pre-existing file").toBe(
					false,
				);

				const cr = await secureFs.createDirExclusive(
					handle,
					"dir-exists",
					0o700,
				);
				expect(cr.ok, "createDirExclusive reused a pre-existing dir").toBe(
					false,
				);
			} finally {
				await handle.close().catch(() => {});
			}
		});

		// === F: digest tamper -> refusingTransport, NO powershell spawned ===
		it("F: a tampered `.ps1` refuses every op with windows-secure-object-unavailable and NEVER spawns", async () => {
			let spawnCount = 0;
			const tampered = createWindowsSecureFs(
				createPs1Session({
					// Real manifest binding is read (default), but the on-disk `.ps1` bytes
					// are corrupted -> sha mismatch -> refusingTransport before any spawn.
					readFile: (p) =>
						p.endsWith(".ps1")
							? Buffer.from("tampered-helper-bytes")
							: fs.readFileSync(p),
					spawn: () => {
						spawnCount++;
						throw new Error("must not spawn on digest mismatch");
					},
				}),
			);
			const projectDir = mkProject("digest-tamper");
			const { assetPath, settingsPath } = claudePaths(projectDir);
			const out = await runTransaction({
				secureFs: tampered,
				clock,
				nonce,
				projectDir,
				asset: comp(assetPath, Buffer.from("x"), true),
				settings: comp(settingsPath, Buffer.from("y"), true),
			});
			expect(out.ok).toBe(false);
			expect(out.committed).toEqual([]);
			expect(out.errors.join(" | ")).toMatch(
				/windows-secure-object-unavailable|digest/i,
			);
			expect(
				spawnCount,
				"powershell was spawned despite a digest mismatch",
			).toBe(0);
		});
	},
);
