import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ACL_DETAIL,
	createLinuxAclAdapter,
	createMacosAclAdapter,
	createPosixSecureFs,
	probeAclCapability,
	type SpawnFn,
	type SpawnOutcome,
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

describe("createMacosAclAdapter (/bin/ls -lde, mocked spawn — never skipped)", () => {
	it("refuses when /bin/ls is absent", async () => {
		const acl = createMacosAclAdapter(
			spawnReturning({ spawnError: true, code: null, stdout: "" }),
		);
		expect((await acl.proveClean("/x")).refusal).toBe("unsupported-posix-acl");
	});

	it("refuses on non-zero exit and on timeout", async () => {
		expect(
			(
				await createMacosAclAdapter(
					spawnReturning({ code: 2, stdout: "" }),
				).proveClean("/x")
			).refusal,
		).toBe("unsupported-posix-acl");
		expect(
			(
				await createMacosAclAdapter(
					spawnReturning({ timedOut: true, code: null, stdout: "" }),
				).proveClean("/x")
			).refusal,
		).toBe("unsupported-posix-acl");
	});

	it("refuses on a trailing + flag on the mode line", async () => {
		const acl = createMacosAclAdapter(
			spawnReturning(clean("-rw-r--r--+ 1 user staff 10 Jan 1 file")),
		);
		expect((await acl.proveClean("/x")).refusal).toBe("unsupported-posix-acl");
	});

	it("refuses on a numbered ACE line", async () => {
		const acl = createMacosAclAdapter(
			spawnReturning(
				clean(
					"-rw-r--r-- 1 user staff 10 Jan 1 file\n 0: user:root allow read",
				),
			),
		);
		expect((await acl.proveClean("/x")).refusal).toBe("unsupported-posix-acl");
	});

	it("accepts a plain mode line with no + and no ACEs", async () => {
		const acl = createMacosAclAdapter(
			spawnReturning(clean("-rw-r--r-- 1 user staff 10 Jan 1 file")),
		);
		expect((await acl.proveClean("/x")).ok).toBe(true);
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

	it("never names an argv the platform does not run in the timeout detail", async () => {
		// darwin runs `/bin/ls -ld /`, never `--version`: the detail must not lie.
		const capability = await probeAclCapability(
			spawnReturning({ timedOut: true, code: null, stdout: "" }),
			"darwin",
		);
		expect(capability.status).toBe("unknown");
		const detail = (capability as { detail: string }).detail;
		expect(detail).not.toContain("--version");
		expect(detail).toContain("/bin/ls");
	});

	it("reports unknown on a non-zero exit", async () => {
		const capability = await probeAclCapability(
			spawnReturning({ code: 3, stdout: "" }),
			"linux",
		);
		expect(capability.status).toBe("unknown");
		expect((capability as { detail: string }).detail).toContain("3");
	});

	it("reports unknown when the version output is unparseable", async () => {
		const capability = await probeAclCapability(
			spawnReturning(clean("something else entirely\n")),
			"linux",
		);
		expect(capability.status).toBe("unknown");
	});

	it("probes /bin/ls on darwin", async () => {
		const capability = await probeAclCapability(
			spawnReturning(clean("drwx------ 2 user staff 64 Jan 1 /\n")),
			"darwin",
		);
		expect(capability).toEqual({ status: "available", tool: "/bin/ls" });
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

	it("returns an adapter on linux, darwin and win32 (Slice 3b wiring)", () => {
		expect(selectSecureFs("linux")).not.toBeNull();
		expect(selectSecureFs("darwin")).not.toBeNull();
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
