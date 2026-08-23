import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ACL_DETAIL,
	createLinuxAclAdapter,
	createPosixSecureFs,
	type PosixAclAdapter,
	probeAclCapability,
	type SpawnFn,
	type SpawnOutcome,
	type StatFn,
	selectSecureFs,
} from "./secure-fs-posix.js";

/** A deterministic spawn fake returning a fixed sequence of outcomes. */
const spawnReturning = (...outcomes: SpawnOutcome[]): SpawnFn => {
	let call = 0;
	return async () =>
		outcomes[Math.min(call++, outcomes.length - 1)] as SpawnOutcome;
};

const clean = (stdout: string): SpawnOutcome => ({ code: 0, stdout });

describe("createLinuxAclAdapter (getfacl, mocked spawn — never skipped)", () => {
	it("refuses when getfacl is absent (spawn error)", async () => {
		const acl = createLinuxAclAdapter(
			spawnReturning({ spawnError: true, code: null, stdout: "" }),
		);
		const res = await acl.proveClean("/x");
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("unsupported-posix-acl");
	});

	it("refuses on non-zero exit", async () => {
		const acl = createLinuxAclAdapter(spawnReturning({ code: 1, stdout: "" }));
		expect((await acl.proveClean("/x")).refusal).toBe("unsupported-posix-acl");
	});

	it("refuses on timeout", async () => {
		const acl = createLinuxAclAdapter(
			spawnReturning({ timedOut: true, code: null, stdout: "" }),
		);
		expect((await acl.proveClean("/x")).refusal).toBe("unsupported-posix-acl");
	});

	it.each([
		["named user", "user::rwx\nuser:1000:rwx\ngroup::r-x\nother::r--"],
		["named group", "user::rwx\ngroup:1000:rwx\nother::r--"],
		["mask", "user::rwx\ngroup::r-x\nmask::rwx\nother::r--"],
		["default", "user::rwx\ngroup::r-x\nother::r--\ndefault:user::rwx"],
	])("refuses on an extended ACL entry: %s", async (_name, stdout) => {
		const acl = createLinuxAclAdapter(spawnReturning(clean(stdout)));
		expect((await acl.proveClean("/x")).refusal).toBe("unsupported-posix-acl");
	});

	it("accepts only the three base entries", async () => {
		const acl = createLinuxAclAdapter(
			spawnReturning(clean("user::rwx\ngroup::r-x\nother::r--")),
		);
		expect((await acl.proveClean("/x")).ok).toBe(true);
	});

	it("refuses when the output changes between preflight and commit", async () => {
		const acl = createLinuxAclAdapter(
			spawnReturning(
				clean("user::rwx\ngroup::r-x\nother::r--"),
				clean("user::rwx\nuser:1000:rwx\ngroup::r-x\nother::r--"),
			),
		);
		expect((await acl.proveClean("/x")).ok).toBe(true);
		expect((await acl.proveClean("/x")).refusal).toBe("unsupported-posix-acl");
	});
});

describe("createLinuxAclAdapter.proveNoEndangeringAcl (lenient ancestor predicate)", () => {
	const OWNER_UID = 4242;
	const EUID = process.geteuid?.() ?? -1;
	const statReturning =
		(uid: number): StatFn =>
		async () => ({ uid });
	const lenient = (stdout: string, uid = OWNER_UID) =>
		createLinuxAclAdapter(spawnReturning(clean(stdout)), statReturning(uid));

	it("1.1 ALLOWS a masked read-only named-user (user:5000:rwx under mask::r--)", async () => {
		const acl = lenient(
			"user::rwx\nuser:5000:rwx\ngroup::r-x\nmask::r--\nother::r--",
		);
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(true);
	});

	it("1.2 REFUSES a foreign named-user with effective write (mask::rwx)", async () => {
		const acl = lenient(
			"user::rwx\nuser:5000:rwx\ngroup::r-x\nmask::rwx\nother::r--",
		);
		const res = await acl.proveNoEndangeringAcl("/x");
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("unsupported-posix-acl");
		expect(res.detail).toBe(ACL_DETAIL.extendedAclEntry);
	});

	it("1.3 REFUSES a named-group with effective write (all named groups potentially foreign)", async () => {
		const acl = lenient(
			"user::rwx\ngroup::r-x\ngroup:6000:rwx\nmask::rwx\nother::r--",
		);
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(false);
	});

	it("1.3a ALLOWS a named-group with effective non-write (group:6000:r-x under mask::r-x)", async () => {
		const acl = lenient(
			"user::rwx\ngroup::r-x\ngroup:6000:r-x\nmask::r-x\nother::r--",
		);
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(true);
	});

	it("1.3b ALLOWS a masked-out named-group (group:6000:rwx under mask::r-- → effective r--)", async () => {
		const acl = lenient(
			"user::rwx\ngroup::r-x\ngroup:6000:rwx\nmask::r--\nother::r--",
		);
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(true);
	});

	it("1.4 ALLOWS an x-only foreign named-user (traverse, not create/delete/rename)", async () => {
		const acl = lenient(
			"user::rwx\nuser:5000:--x\ngroup::r-x\nmask::r-x\nother::r--",
		);
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(true);
	});

	it.each([
		["owner uid via lstat", OWNER_UID],
		["root", 0],
		["process euid", EUID],
	])("1.5 ALLOWS a trusted named-user with effective write: %s", async (_n, uid) => {
		const acl = lenient(
			`user::rwx\nuser:${uid}:rwx\ngroup::r-x\nmask::rwx\nother::r--`,
			OWNER_UID,
		);
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(true);
	});

	it("1.6 ALLOWS a default:* entry (inheritance-only, not the on-path node)", async () => {
		const acl = lenient(
			"user::rwx\ngroup::r-x\nother::r--\ndefault:user::rwx\ndefault:user:5000:rwx\ndefault:group::r-x\ndefault:mask::rwx\ndefault:other::r--",
		);
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(true);
	});

	it("1.7 ALLOWS mask:: alone and the three base entries", async () => {
		expect(
			(
				await lenient(
					"user::rwx\ngroup::r-x\nmask::r--\nother::r--",
				).proveNoEndangeringAcl("/x")
			).ok,
		).toBe(true);
		expect(
			(
				await lenient(
					"user::rwx\ngroup::r-x\nother::r--",
				).proveNoEndangeringAcl("/x")
			).ok,
		).toBe(true);
	});

	it("1.8 REFUSES a named entry with raw write when no mask entry is present (fail closed)", async () => {
		const acl = lenient("user::rwx\nuser:5000:rwx\ngroup::r-x\nother::r--");
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(false);
	});

	it("1.9 REFUSES an unparseable line and a malformed mask", async () => {
		expect(
			(
				await lenient(
					"user::rwx\nnot an acl line\nother::r--",
				).proveNoEndangeringAcl("/x")
			).ok,
		).toBe(false);
		expect(
			(
				await lenient(
					"user::rwx\nmask::rw\ngroup::r-x\nother::r--",
				).proveNoEndangeringAcl("/x")
			).ok,
		).toBe(false);
	});

	it("1.10 REFUSES fail-closed on getfacl absent, timeout, or nonzero exit", async () => {
		const absent = createLinuxAclAdapter(
			spawnReturning({ spawnError: true, code: null, stdout: "" }),
			statReturning(OWNER_UID),
		);
		expect((await absent.proveNoEndangeringAcl("/x")).refusal).toBe(
			"unsupported-posix-acl",
		);
		const timeout = createLinuxAclAdapter(
			spawnReturning({ timedOut: true, code: null, stdout: "" }),
			statReturning(OWNER_UID),
		);
		expect((await timeout.proveNoEndangeringAcl("/x")).refusal).toBe(
			"unsupported-posix-acl",
		);
		const nonzero = createLinuxAclAdapter(
			spawnReturning({ code: 1, stdout: "" }),
			statReturning(OWNER_UID),
		);
		expect((await nonzero.proveNoEndangeringAcl("/x")).refusal).toBe(
			"unsupported-posix-acl",
		);
	});

	it("strips an inline #effective suffix before computing effective = raw ∩ mask", async () => {
		const acl = lenient(
			"user::rwx\nuser:5000:rwx\t#effective:r--\ngroup::r-x\nmask::r--\nother::r--",
		);
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(true);
	});

	it("keeps the getfacl argv shape unchanged (numeric, omit-header, -- guard)", async () => {
		const calls: Array<[string, string[]]> = [];
		const acl = createLinuxAclAdapter(async (cmd, args) => {
			calls.push([cmd, args]);
			return clean("user::rwx\ngroup::r-x\nother::r--");
		}, statReturning(OWNER_UID));
		await acl.proveNoEndangeringAcl("/some/dir");
		expect(calls).toEqual([
			[
				"getfacl",
				["--absolute-names", "--numeric", "--omit-header", "--", "/some/dir"],
			],
		]);
	});

	it("treats an owner-uid named-user as trusted only when lstat resolves it", async () => {
		const stdout =
			"user::rwx\nuser:5000:rwx\ngroup::r-x\nmask::rwx\nother::r--";
		const resolved = createLinuxAclAdapter(
			spawnReturning(clean(stdout)),
			statReturning(5000),
		);
		// 5000 IS the directory owner → trusted → allowed.
		expect((await resolved.proveNoEndangeringAcl("/x")).ok).toBe(true);
		const unresolved = createLinuxAclAdapter(
			spawnReturning(clean(stdout)),
			() => {
				throw new Error("ENOENT");
			},
		);
		// Owner unknown (lstat failed) → cannot prove the carve-out → fail closed.
		expect((await unresolved.proveNoEndangeringAcl("/x")).ok).toBe(false);
	});

	it("golden: ALLOWS the representative /home-class ancestor (root-owned uid0 mode0755, benign mask/RO-named/default)", async () => {
		// Representative of ubuntu-latest `/home`; exact bytes pinned by the first
		// green CI run (gh-home-getfacl artifact) in a follow-up commit — the
		// `getfacl --absolute-names --numeric --omit-header -- /home` output class.
		const GH_HOME_GETFACL_REPRESENTATIVE = [
			"user::rwx",
			"group::r-x",
			"user:0:r-x",
			"mask::r-x",
			"other::r-x",
			"default:user::rwx",
			"default:group::r-x",
			"default:other::r-x",
		].join("\n");
		const acl = lenient(GH_HOME_GETFACL_REPRESENTATIVE, 0);
		expect((await acl.proveNoEndangeringAcl("/home")).ok).toBe(true);
	});

	it("skips interspersed #comment lines (e.g. `# flags:`) and classifies the real entries", async () => {
		const acl = lenient(
			"# flags: -s-\nuser::rwx\ngroup::r-x\ngroup:6000:r-x\nmask::r-x\nother::r--",
		);
		expect((await acl.proveNoEndangeringAcl("/x")).ok).toBe(true);
	});
});

describe("probeAclCapability (read-only capability probe, mocked spawn)", () => {
	it("exports the stable detail tokens the adapters emit", () => {
		expect(ACL_DETAIL.getfaclAbsent).toBe("getfacl absent");
		expect(ACL_DETAIL.getfaclTimeout).toBe("getfacl timeout");
		expect(ACL_DETAIL.extendedAclEntry).toBe("extended ACL entry");
	});

	it("reports available when getfacl --version resolves and runs", async () => {
		const capability = await probeAclCapability(
			spawnReturning(clean("getfacl 2.3.1\n")),
			"linux",
		);
		expect(capability).toEqual({ status: "available", tool: "getfacl" });
	});

	it("reports absent when getfacl cannot be spawned (ENOENT)", async () => {
		const capability = await probeAclCapability(
			spawnReturning({ spawnError: true, code: null, stdout: "" }),
			"linux",
		);
		expect(capability).toEqual({ status: "absent", tool: "getfacl" });
	});

	it("reports unknown on timeout", async () => {
		const capability = await probeAclCapability(
			spawnReturning({ timedOut: true, code: null, stdout: "" }),
			"linux",
		);
		expect(capability.status).toBe("unknown");
		expect(capability).toMatchObject({ tool: "getfacl" });
	});

	it("does not probe an unsupported host", async () => {
		let spawned = false;
		const capability = await probeAclCapability(async () => {
			spawned = true;
			return clean("getfacl 2.3.1\n");
		}, "darwin");
		expect(capability).toEqual({
			status: "unknown",
			tool: "darwin",
			detail: "no POSIX ACL adapter for platform darwin",
		});
		expect(spawned).toBe(false);
	});

	it("is not-applicable on win32 and never spawns", async () => {
		let spawned = false;
		const capability = await probeAclCapability(async () => {
			spawned = true;
			return { code: 0, stdout: "" };
		}, "win32");
		expect(capability).toEqual({
			status: "not-applicable",
			tool: "windows-secure-object",
		});
		expect(spawned).toBe(false);
	});

	it("reports unknown on a platform with no POSIX ACL adapter", async () => {
		const capability = await probeAclCapability(
			spawnReturning(clean("")),
			"sunos",
		);
		expect(capability.status).toBe("unknown");
	});

	it("never mutates: it only ever runs a read-only version/list argv", async () => {
		const calls: Array<[string, string[]]> = [];
		await probeAclCapability(async (cmd, args) => {
			calls.push([cmd, args]);
			return { code: 0, stdout: "getfacl 2.3.1" };
		}, "linux");
		expect(calls).toEqual([["getfacl", ["--version"]]]);
	});
});

describe("selectSecureFs platform selection", () => {
	it("returns null on unknown platforms (no adapter → refuse, zero mutation)", () => {
		expect(selectSecureFs("sunos")).toBeNull();
	});

	it("returns adapters only on supported hosts", () => {
		expect(selectSecureFs("linux")).not.toBeNull();
		expect(selectSecureFs("darwin")).toBeNull();
		// Phase 4: win32 now returns the windows adapter over a lazily-spawned
		// digest-bound .ps1 session (was null pre-3b). Constructing it spawns
		// nothing — host-independent on the Linux dev box.
		expect(selectSecureFs("win32")).not.toBeNull();
	});
});

describe("createPosixSecureFs ownership + secure I/O (host-independent, own tmp tree)", () => {
	let dir: string;
	const cleanAcl = createLinuxAclAdapter(
		spawnReturning(clean("user::rwx\ngroup::r-x\nother::r--")),
	);
	const fsx = createPosixSecureFs(cleanAcl);

	beforeEach(async () => {
		dir = await mkdtemp(path.join(os.tmpdir(), "javi-forge-securefs-"));
		await chmod(dir, 0o700);
	});
	afterEach(() => rm(dir, { recursive: true, force: true }));

	it("proves ownership + mode on a private 0700 dir and refuses a world-writable one", async () => {
		const handle = await fsx.openDirNoFollow(dir);
		expect(handle.ok).toBe(true);
		expect((await fsx.proveOwnershipAndMode(dir)).ok).toBe(true);
		await chmod(dir, 0o777);
		const refused = await fsx.proveOwnershipAndMode(dir);
		expect(refused.ok).toBe(false);
		expect(refused.refusal).toBe("unsafe-parent-chain");
		await handle.value?.close();
	});

	it("writes a file exclusively, refuses a second exclusive create, and captures it back", async () => {
		const handle = (await fsx.openDirNoFollow(dir)).value;
		if (!handle) throw new Error("dir handle");
		const bytes = Buffer.from("payload\n", "utf8");
		expect((await fsx.writeExclusive(handle, "f.tmp", bytes, 0o600)).ok).toBe(
			true,
		);
		// Exclusive create over an existing name refuses (EEXIST).
		expect((await fsx.writeExclusive(handle, "f.tmp", bytes, 0o600)).ok).toBe(
			false,
		);
		const captured = await fsx.captureFile(path.join(dir, "f.tmp"));
		expect(captured.ok).toBe(true);
		expect(captured.value?.bytes.equals(bytes)).toBe(true);
		expect(captured.value?.mode).toBe(0o600);
		await handle.close();
	});

	it("captureFile refuses a non-regular target (char device) as unsafe-parent-chain", async () => {
		// /dev/null is a character device: open O_NOFOLLOW|O_RDONLY succeeds and a
		// read returns EOF immediately, so the old capture path would treat it as a
		// regular file. captureFile must fail closed because isFile() is false.
		// (A FIFO would block at open() with no writer, and a directory throws
		// EISDIR on read — both refuse for the wrong reason; a char device is the
		// deterministic case that proves the regular-file assertion.)
		const res = await fsx.captureFile("/dev/null");
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("unsafe-parent-chain");
	});

	it("captureFile refuses to follow a symlink at the target name", async () => {
		await writeFile(path.join(dir, "real"), "secret\n");
		const { symlink } = await import("node:fs/promises");
		await symlink(path.join(dir, "real"), path.join(dir, "link"));
		const res = await fsx.captureFile(path.join(dir, "link"));
		expect(res.ok).toBe(false);
	});

	it("creates a child dir at 0o700 exclusively and refuses a second create", async () => {
		const parent = (await fsx.openDirNoFollow(dir)).value;
		if (!parent) throw new Error("dir handle");
		const created = await fsx.createDirExclusive(parent, "seg", 0o700);
		expect(created.ok).toBe(true);
		const { stat } = await import("node:fs/promises");
		expect((await stat(path.join(dir, "seg"))).mode & 0o777).toBe(0o700);
		// A second exclusive create over the same name refuses (EEXIST).
		expect((await fsx.createDirExclusive(parent, "seg", 0o700)).ok).toBe(false);
		await created.value?.close();
		await parent.close();
	});

	it("revalidates identity and refuses on drift or a missing path", async () => {
		const handle = (await fsx.openDirNoFollow(dir)).value;
		if (!handle) throw new Error("dir handle");
		expect((await fsx.revalidateIdentity(dir, handle.identity)).ok).toBe(true);
		expect(
			(await fsx.revalidateIdentity(path.join(dir, "nope"), handle.identity))
				.ok,
		).toBe(false);
		// A different inode fails identity.
		expect((await fsx.revalidateIdentity(dir, { dev: 0, ino: -1 })).ok).toBe(
			false,
		);
		await handle.close();
	});

	it("applies an exact mode and re-verifies it, then renames within the dir", async () => {
		const handle = (await fsx.openDirNoFollow(dir)).value;
		if (!handle) throw new Error("dir handle");
		await fsx.writeExclusive(handle, "staged.tmp", Buffer.from("x"), 0o600);
		expect(
			(await fsx.applyExactMode(path.join(dir, "staged.tmp"), 0o640)).ok,
		).toBe(true);
		const { stat } = await import("node:fs/promises");
		expect((await stat(path.join(dir, "staged.tmp"))).mode & 0o777).toBe(0o640);
		expect((await fsx.renameInDir(handle, "staged.tmp", "final")).ok).toBe(
			true,
		);
		expect((await fsx.captureFile(path.join(dir, "final"))).ok).toBe(true);
		await handle.close();
	});

	it("1.11 proveManagedContainer stays STRICT: refuses a benign extended entry the lenient ancestor gate allows", async () => {
		// A benign entry (e.g. `mask::r--` or a read-only named user) the lenient
		// ancestor predicate ALLOWS, but a managed container (.claude/.claude/hooks)
		// must still refuse ANY extended entry — byte-identical to today.
		const benignAcl: PosixAclAdapter = {
			proveClean: async () => ({
				ok: false,
				refusal: "unsupported-posix-acl",
				detail: ACL_DETAIL.extendedAclEntry,
			}),
			proveNoEndangeringAcl: async () => ({ ok: true }),
		};
		const guarded = createPosixSecureFs(benignAcl);
		// Ancestor gate: lenient predicate ALLOWS the benign entry.
		expect((await guarded.proveNoEndangeringAcl(dir)).ok).toBe(true);
		// Managed container: strict `proveClean` still REFUSES it.
		const managed = await guarded.proveManagedContainer(dir);
		expect(managed.ok).toBe(false);
		expect(managed.refusal).toBe("unsupported-posix-acl");
		expect(managed.detail).toBe(ACL_DETAIL.extendedAclEntry);
	});

	it("proveManagedContainer proves ownership AND strict ACL cleanliness (both must pass)", async () => {
		const cleanAdapter: PosixAclAdapter = {
			proveClean: async () => ({ ok: true }),
			proveNoEndangeringAcl: async () => ({ ok: true }),
		};
		const guarded = createPosixSecureFs(cleanAdapter);
		expect((await guarded.proveManagedContainer(dir)).ok).toBe(true);
		// A group/other-writable managed container refuses on the ownership arm even
		// with a clean ACL.
		await chmod(dir, 0o777);
		const refused = await guarded.proveManagedContainer(dir);
		expect(refused.ok).toBe(false);
		expect(refused.refusal).toBe("unsafe-parent-chain");
	});

	it("unlinks an identity-matched file and rmdirs only an empty identity-matched dir", async () => {
		const parent = (await fsx.openDirNoFollow(dir)).value;
		if (!parent) throw new Error("dir handle");
		await fsx.writeExclusive(parent, "victim", Buffer.from("x"), 0o600);
		const captured = await fsx.captureFile(path.join(dir, "victim"));
		expect(
			(
				await fsx.unlinkIfIdentity(
					parent,
					"victim",
					captured.value?.identity ?? {
						dev: 0,
						ino: 0,
					},
				)
			).ok,
		).toBe(true);
		const seg = await fsx.createDirExclusive(parent, "empty", 0o700);
		if (!seg.value) throw new Error("seg handle");
		// Non-empty dir refuses removal.
		await fsx.writeExclusive(seg.value, "child", Buffer.from("x"), 0o600);
		expect((await fsx.rmdirIfIdentityEmpty(seg.value)).ok).toBe(false);
		await fsx
			.unlinkIfIdentity(seg.value, "child", { dev: 0, ino: 0 })
			.catch(() => {});
		const { unlink } = await import("node:fs/promises");
		await unlink(path.join(dir, "empty", "child"));
		expect((await fsx.rmdirIfIdentityEmpty(seg.value)).ok).toBe(true);
		await parent.close();
	});
});
