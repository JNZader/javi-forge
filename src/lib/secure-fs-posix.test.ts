import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createLinuxAclAdapter,
	createMacosAclAdapter,
	createPosixSecureFs,
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

describe("selectSecureFs platform selection", () => {
	it("returns null on win32 and unknown platforms", () => {
		expect(selectSecureFs("win32")).toBeNull();
		expect(selectSecureFs("sunos")).toBeNull();
	});

	it("returns an adapter on linux and darwin", () => {
		expect(selectSecureFs("linux")).not.toBeNull();
		expect(selectSecureFs("darwin")).not.toBeNull();
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

	it("captureFile refuses to follow a symlink at the target name", async () => {
		await writeFile(path.join(dir, "real"), "secret\n");
		const { symlink } = await import("node:fs/promises");
		await symlink(path.join(dir, "real"), path.join(dir, "link"));
		const res = await fsx.captureFile(path.join(dir, "link"));
		expect(res.ok).toBe(false);
	});
});
