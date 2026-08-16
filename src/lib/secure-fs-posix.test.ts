import { describe, expect, it } from "vitest";
import {
	createLinuxAclAdapter,
	createMacosAclAdapter,
	type SpawnFn,
	type SpawnOutcome,
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
