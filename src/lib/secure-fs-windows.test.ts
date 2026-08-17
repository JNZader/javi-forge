import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
	addChild,
	captureOk,
	daclRefuse,
	deleteChild,
	foreignOwner,
	foreignWrite,
	genericAll,
	genericWrite,
	makeFakeHelperTransport,
	nullDacl,
	okVoid,
	openNotFound,
	openOk,
	openUnopenable,
} from "./__fixtures__/fake-helper-transport.js";
import type {
	SecureDirHandle,
	SecureIdentity,
} from "./secure-fs-transaction.js";
import {
	createPs1Session,
	createWindowsSecureFs,
	decodeFrames,
	encodeFrame,
	HELPER_FRAME_LIMIT,
	type HelperResponse,
	type Ps1Child,
	refusingTransport,
	WIN32_MODE_SENTINEL,
	type WindowsHelperManifest,
} from "./secure-fs-windows.js";

const DIR = "C:\\proj\\.claude";
const FILE = "C:\\proj\\.claude\\hooks\\asset.mjs";
const DIR_ATTR = 0x10; // FILE_ATTRIBUTE_DIRECTORY
const FILE_ATTR = 0x80; // FILE_ATTRIBUTE_NORMAL (not a directory)
const OPAQUE = "aabbccdd:1122334455667788";
const OPAQUE2 = "aabbccdd:8877665544332211";

/** Open a directory through the adapter, returning its handle for later ops. */
async function openHandle(
	fs: ReturnType<typeof createWindowsSecureFs>,
	t: ReturnType<typeof makeFakeHelperTransport>,
	dirPath = DIR,
	opaque = OPAQUE,
): Promise<SecureDirHandle> {
	t.on("openDir", () => openOk("h1", opaque, DIR_ATTR));
	const res = await fs.openDirNoFollow(dirPath);
	if (!res.ok || !res.value) throw new Error("openHandle failed");
	return res.value;
}

// ---------------------------------------------------------------------------
// Framing (Task 2.4) — pure, host-independent
// ---------------------------------------------------------------------------

describe("framing", () => {
	it("prefixes a JSON body with its big-endian uint32 byte length", () => {
		const frame = encodeFrame({ op: "ping", n: 1 });
		const body = Buffer.from(JSON.stringify({ op: "ping", n: 1 }), "utf8");
		expect(frame.readUInt32BE(0)).toBe(body.byteLength);
		expect(frame.subarray(4)).toEqual(body);
	});

	it("round-trips a single frame through decodeFrames", () => {
		const frame = encodeFrame({ ready: true, protocolVersion: 1 });
		const { frames, rest } = decodeFrames(frame);
		expect(frames).toEqual([{ ready: true, protocolVersion: 1 }]);
		expect(rest.byteLength).toBe(0);
	});

	it("decodes multiple concatenated frames and keeps the partial remainder", () => {
		const a = encodeFrame({ i: 1 });
		const b = encodeFrame({ i: 2 });
		const partial = encodeFrame({ i: 3 }).subarray(0, 6); // header + 2 bytes
		const { frames, rest } = decodeFrames(Buffer.concat([a, b, partial]));
		expect(frames).toEqual([{ i: 1 }, { i: 2 }]);
		expect(rest).toEqual(partial);
	});

	it("returns no frames when only a partial header is buffered", () => {
		const { frames, rest } = decodeFrames(Buffer.from([0, 0]));
		expect(frames).toEqual([]);
		expect(rest).toEqual(Buffer.from([0, 0]));
	});

	it("throws on a declared length exceeding HELPER_FRAME_LIMIT", () => {
		const oversized = Buffer.alloc(4);
		oversized.writeUInt32BE(HELPER_FRAME_LIMIT + 1, 0);
		expect(() => decodeFrames(oversized)).toThrow(/oversized/i);
	});

	it("round-trips a base64 binary payload inside the JSON body", () => {
		const bytes = Buffer.from([0x00, 0xff, 0x10, 0x7f, 0x80]);
		const frame = encodeFrame({
			op: "writeExcl",
			bytes: bytes.toString("base64"),
		});
		const { frames } = decodeFrames(frame);
		const decoded = Buffer.from(
			(frames[0] as { bytes: string }).bytes,
			"base64",
		);
		expect(decoded).toEqual(bytes);
	});
});

// ---------------------------------------------------------------------------
// Adapter: request build + response mapping (Tasks 2.1, 2.2)
// ---------------------------------------------------------------------------

describe("createWindowsSecureFs — proof method mapping", () => {
	it("proveOwnershipAndMode builds a proveOwner request and relays an ok verdict", async () => {
		const t = makeFakeHelperTransport();
		t.on("proveOwner", () => okVoid());
		const fs = createWindowsSecureFs(t);
		const res = await fs.proveOwnershipAndMode(DIR);
		expect(res.ok).toBe(true);
		expect(t.requests).toEqual([{ op: "proveOwner", args: { path: DIR } }]);
	});

	it("proveNoExtendedAcl accepts the real C:\\ posture (Predicate A accept)", async () => {
		const t = makeFakeHelperTransport();
		t.on("proveDacl", () => okVoid());
		const fs = createWindowsSecureFs(t);
		const res = await fs.proveNoExtendedAcl("C:\\");
		expect(res.ok).toBe(true);
		expect(t.requests[0]).toEqual({ op: "proveDacl", args: { path: "C:\\" } });
	});

	it.each([
		["foreign non-privileged write", foreignWrite],
		["FILE_DELETE_CHILD", deleteChild],
		["raw GENERIC_WRITE", genericWrite],
		["raw GENERIC_ALL", genericAll],
		["NULL DACL", nullDacl],
	])("proveNoExtendedAcl refuses %s with unsafe-windows-dacl", async (_l, posture) => {
		const t = makeFakeHelperTransport();
		t.on("proveDacl", posture);
		const fs = createWindowsSecureFs(t);
		const res = await fs.proveNoExtendedAcl(DIR);
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("unsafe-windows-dacl");
		expect(res.detail).toEqual(posture().detail);
	});

	it("proveOwnershipAndMode refuses a foreign owner", async () => {
		const t = makeFakeHelperTransport();
		t.on("proveOwner", foreignOwner);
		const fs = createWindowsSecureFs(t);
		const res = await fs.proveOwnershipAndMode(DIR);
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("unsafe-windows-dacl");
		expect(res.detail).toMatch(/foreign owner/);
	});

	it("proveManagedContainer builds a proveContainer request (Predicate B / CREATE_PARENT_DIR)", async () => {
		const t = makeFakeHelperTransport();
		t.on("proveContainer", () => okVoid());
		const fs = createWindowsSecureFs(t);
		const res = await fs.proveManagedContainer(DIR);
		expect(res.ok).toBe(true);
		expect(t.requests).toEqual([{ op: "proveContainer", args: { path: DIR } }]);
	});

	it("proveManagedContainer refuses a foreign add-child (add-child only on managed containers)", async () => {
		const t = makeFakeHelperTransport();
		t.on("proveContainer", addChild);
		const fs = createWindowsSecureFs(t);
		const res = await fs.proveManagedContainer(DIR);
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("unsafe-windows-dacl");
		expect(res.detail).toMatch(/add-child/);
	});
});

// ---------------------------------------------------------------------------
// openDir: notFound discrimination + FILE_ATTRIBUTE_DIRECTORY (Tasks 2.2, 2.3)
// ---------------------------------------------------------------------------

describe("createWindowsSecureFs — openDirNoFollow", () => {
	it("returns a handle with an opaque identity on success", async () => {
		const t = makeFakeHelperTransport();
		t.on("openDir", () => openOk("h1", OPAQUE, DIR_ATTR));
		const fs = createWindowsSecureFs(t);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(true);
		expect(res.value?.path).toBe(DIR);
		expect(res.value?.identity.opaque).toBe(OPAQUE);
		expect(t.requests[0]).toEqual({ op: "openDir", args: { path: DIR } });
	});

	it.each([
		["ERROR_FILE_NOT_FOUND", 2],
		["ERROR_PATH_NOT_FOUND", 3],
	])("maps %s to notFound=true on the refusal", async (_l, status) => {
		const t = makeFakeHelperTransport();
		t.on("openDir", () => openNotFound(status));
		const fs = createWindowsSecureFs(t);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(false);
		expect(res.notFound).toBe(true);
	});

	it("does NOT set notFound for a present-but-unopenable reparse point (fail closed)", async () => {
		const t = makeFakeHelperTransport();
		t.on("openDir", () => openUnopenable("reparse point", 5));
		const fs = createWindowsSecureFs(t);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(false);
		expect(res.notFound).toBeFalsy();
	});

	it("refuses a non-directory with notFound=false (JDA7-001 POSIX parity)", async () => {
		const t = makeFakeHelperTransport();
		t.on("openDir", () => openOk("h1", OPAQUE, FILE_ATTR));
		t.on("releaseHandle", () => okVoid());
		const fs = createWindowsSecureFs(t);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(false);
		expect(res.notFound).toBeFalsy();
		expect(res.detail).toMatch(/not a directory/i);
		// the wrongly-opened handle is released, not leaked
		expect(t.requests.some((r) => r.op === "releaseHandle")).toBe(true);
	});

	it("refuses when the helper returns an absent opaque identity (C4)", async () => {
		const t = makeFakeHelperTransport();
		t.on("openDir", () => ({
			ok: true,
			value: { handleId: "h1", attributes: DIR_ATTR },
		}));
		t.on("releaseHandle", () => okVoid());
		const fs = createWindowsSecureFs(t);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(false);
		expect(res.detail).toMatch(/identity/i);
	});

	it("refuses a zero-FileId opaque (SMB/exotic-FS collision, C4)", async () => {
		const t = makeFakeHelperTransport();
		t.on("openDir", () => openOk("h1", "aabbccdd:0000000000000000", DIR_ATTR));
		t.on("releaseHandle", () => okVoid());
		const fs = createWindowsSecureFs(t);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(false);
		expect(res.detail).toMatch(/identity/i);
	});
});

// ---------------------------------------------------------------------------
// Identity ops: opaque round-trip + held-identity guard (Task 2.2, C4)
// ---------------------------------------------------------------------------

describe("createWindowsSecureFs — identity ops", () => {
	it("revalidateIdentity forwards the held opaque for a .ps1-side comparison", async () => {
		const t = makeFakeHelperTransport();
		t.on("revalidate", () => okVoid());
		const fs = createWindowsSecureFs(t);
		const held: SecureIdentity = { dev: 1, ino: 2, opaque: OPAQUE };
		const res = await fs.revalidateIdentity(DIR, held);
		expect(res.ok).toBe(true);
		expect(t.requests[0]).toEqual({
			op: "revalidate",
			args: { path: DIR, opaque: OPAQUE },
		});
	});

	it("revalidateIdentity refuses (without calling the helper) when held opaque is absent", async () => {
		const t = makeFakeHelperTransport();
		const fs = createWindowsSecureFs(t);
		const res = await fs.revalidateIdentity(DIR, { dev: 1, ino: 2 });
		expect(res.ok).toBe(false);
		expect(res.detail).toMatch(/identity/i);
		expect(t.requests).toHaveLength(0); // never sent a comparison it cannot make
	});

	it("revalidateIdentity relays a drift refusal from the helper", async () => {
		const t = makeFakeHelperTransport();
		t.on("revalidate", () => daclRefuse("identity drift"));
		const fs = createWindowsSecureFs(t);
		const res = await fs.revalidateIdentity(DIR, {
			dev: 1,
			ino: 2,
			opaque: OPAQUE2,
		});
		expect(res.ok).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Mutating ops: capture / write / applyMode / rename / unlink / rmdir
// ---------------------------------------------------------------------------

describe("createWindowsSecureFs — capture and mutation ops", () => {
	it("captureFile decodes base64 bytes and returns the WIN32 sentinel mode", async () => {
		const bytes = Buffer.from("hook-source", "utf8");
		const t = makeFakeHelperTransport();
		t.on("capture", () => captureOk(bytes, OPAQUE));
		const fs = createWindowsSecureFs(t);
		const res = await fs.captureFile(FILE);
		expect(res.ok).toBe(true);
		expect(res.value?.bytes).toEqual(bytes);
		expect(res.value?.mode).toBe(WIN32_MODE_SENTINEL);
		expect(res.value?.identity.opaque).toBe(OPAQUE);
		// sha is computed adapter-side from the decoded bytes
		expect(res.value?.sha256).toHaveLength(64);
	});

	it("writeExclusive base64-encodes bytes into the request body", async () => {
		const bytes = Buffer.from([0x00, 0xff, 0x42]);
		const t = makeFakeHelperTransport();
		// R3-003: SAME adapter instance for open + execute, else the per-instance
		// WeakMap yields undefined and the retained handle id is silently dropped.
		const fs = createWindowsSecureFs(t);
		const dir = await openHandle(fs, t);
		t.on("writeExcl", () => okVoid());
		const res = await fs.writeExclusive(dir, "asset.tmp", bytes, 0o600);
		expect(res.ok).toBe(true);
		const req = t.requests.find((r) => r.op === "writeExcl");
		// R3-003: the real retained no-follow handle id is forwarded (not undefined),
		// so a regression to a TOCTOU-exposed path fallback fails here.
		expect(req?.args.dirHandle).toBe("h1");
		expect(req?.args.bytes).toBe(bytes.toString("base64"));
		expect(req?.args.name).toBe("asset.tmp");
	});

	it("applyExactMode asserts the WIN32 sentinel and refuses any other mode (JD-A-104)", async () => {
		const t = makeFakeHelperTransport();
		t.on("applyMode", () => okVoid());
		const fs = createWindowsSecureFs(t);
		const good = await fs.applyExactMode(FILE, WIN32_MODE_SENTINEL);
		expect(good.ok).toBe(true);
		const bad = await fs.applyExactMode(FILE, 0o755);
		expect(bad.ok).toBe(false);
		expect(bad.detail).toMatch(/mode/i);
	});

	it("createDirExclusive sends the parent handle id and returns a new handle", async () => {
		const t = makeFakeHelperTransport();
		const fs = createWindowsSecureFs(t); // R3-003: same instance for open + create
		const parent = await openHandle(fs, t);
		t.on("createDir", () => openOk("h2", OPAQUE2, DIR_ATTR));
		const res = await fs.createDirExclusive(parent, "hooks", 0o700);
		expect(res.ok).toBe(true);
		expect(res.value?.identity.opaque).toBe(OPAQUE2);
		const req = t.requests.find((r) => r.op === "createDir");
		// R3-003: the real retained parent handle id is forwarded, not undefined.
		expect(req?.args.parentHandle).toBe("h1");
	});

	it("rmdirIfIdentityEmpty forwards the handle's opaque identity", async () => {
		const t = makeFakeHelperTransport();
		const fs = createWindowsSecureFs(t); // R3-003: same instance for open + rmdir
		const handle = await openHandle(fs, t);
		t.on("rmdir", () => okVoid());
		const res = await fs.rmdirIfIdentityEmpty(handle);
		expect(res.ok).toBe(true);
		const req = t.requests.find((r) => r.op === "rmdir");
		// R3-003: the real retained kernel handle id is forwarded, not undefined.
		expect(req?.args.handle).toBe("h1");
		expect(req?.args.opaque).toBe(OPAQUE);
	});

	it("renameInDir builds the rename op with the dir handle and relays ok (R3-001)", async () => {
		const t = makeFakeHelperTransport();
		const fs = createWindowsSecureFs(t); // same instance so the handle id resolves
		const dir = await openHandle(fs, t);
		t.on("rename", () => okVoid());
		const res = await fs.renameInDir(dir, "asset.tmp", "asset.mjs");
		expect(res.ok).toBe(true);
		const req = t.requests.find((r) => r.op === "rename");
		expect(req?.args).toEqual({
			dirHandle: "h1",
			from: "asset.tmp",
			to: "asset.mjs",
		});
	});

	it("renameInDir relays a helper refusal via mapVoid (R3-001)", async () => {
		const t = makeFakeHelperTransport();
		const fs = createWindowsSecureFs(t);
		const dir = await openHandle(fs, t);
		t.on("rename", () => daclRefuse("rename crossed a boundary"));
		const res = await fs.renameInDir(dir, "asset.tmp", "asset.mjs");
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("unsafe-windows-dacl");
	});

	it("unlinkIfIdentity forwards the dir handle, name and held opaque (R3-002)", async () => {
		const t = makeFakeHelperTransport();
		const fs = createWindowsSecureFs(t);
		const dir = await openHandle(fs, t);
		t.on("unlink", () => okVoid());
		const held: SecureIdentity = { dev: 1, ino: 2, opaque: OPAQUE };
		const res = await fs.unlinkIfIdentity(dir, "asset.mjs", held);
		expect(res.ok).toBe(true);
		const req = t.requests.find((r) => r.op === "unlink");
		expect(req?.args).toEqual({
			dirHandle: "h1",
			name: "asset.mjs",
			opaque: OPAQUE,
		});
	});

	it("unlinkIfIdentity refuses a malformed held opaque WITHOUT sending (C4/R3-002)", async () => {
		const t = makeFakeHelperTransport();
		const fs = createWindowsSecureFs(t);
		const dir = await openHandle(fs, t);
		// zero-FileId opaque → uncomparable identity → refuse before any unlink op
		const res = await fs.unlinkIfIdentity(dir, "asset.mjs", {
			dev: 1,
			ino: 2,
			opaque: "aabbccdd:0000000000000000",
		});
		expect(res.ok).toBe(false);
		expect(res.detail).toMatch(/identity/i);
		expect(t.requests.some((r) => r.op === "unlink")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Strict boolean acceptance (R1-002) + handle-count balance (R4-003)
// ---------------------------------------------------------------------------

describe("createWindowsSecureFs — strict boolean acceptance (R1-002)", () => {
	it.each([
		["numeric 1", 1],
		['string "false"', "false"],
		['string "true"', "true"],
	])("mapVoid refuses a frame whose ok is truthy-but-not-boolean (%s)", async (_l, okish) => {
		const t = makeFakeHelperTransport();
		t.on("proveOwner", () => ({ ok: okish }) as unknown as HelperResponse);
		const fs = createWindowsSecureFs(t);
		const res = await fs.proveOwnershipAndMode(DIR);
		expect(res.ok).toBe(false);
	});

	it("toHandle refuses an openDir frame whose ok is a truthy string", async () => {
		const t = makeFakeHelperTransport();
		t.on(
			"openDir",
			() =>
				({
					ok: "true",
					value: { handleId: "h1", opaque: OPAQUE, attributes: DIR_ATTR },
				}) as unknown as HelperResponse,
		);
		const fs = createWindowsSecureFs(t);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(false);
	});

	it("captureFile refuses a frame whose ok is truthy-but-not-boolean", async () => {
		const t = makeFakeHelperTransport();
		t.on(
			"capture",
			() =>
				({
					ok: 1,
					value: { bytes: Buffer.from("x").toString("base64"), opaque: OPAQUE },
				}) as unknown as HelperResponse,
		);
		const fs = createWindowsSecureFs(t);
		const res = await fs.captureFile(FILE);
		expect(res.ok).toBe(false);
	});
});

describe("createWindowsSecureFs — balances the handle count on a malformed ok (R4-003)", () => {
	it("emits a releaseHandle op when an ok openDir frame carries no handle id", async () => {
		const t = makeFakeHelperTransport();
		// ok:true (so the session would increment `outstanding`) but no handleId.
		t.on("openDir", () => ({
			ok: true,
			value: { opaque: OPAQUE, attributes: DIR_ATTR },
		}));
		t.on("releaseHandle", () => okVoid());
		const fs = createWindowsSecureFs(t);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(false);
		expect(res.detail).toMatch(/no handle/i);
		// the balancing release is sent so the idle watchdog can still arm.
		expect(t.requests.some((r) => r.op === "releaseHandle")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Transport-error → fail-closed refusal (Task 2.2)
// ---------------------------------------------------------------------------

describe("createWindowsSecureFs — transport failures fail closed", () => {
	it("maps a rejected request to windows-secure-object-unavailable", async () => {
		const t = makeFakeHelperTransport();
		t.failNext(new Error("child exited"));
		const fs = createWindowsSecureFs(t);
		const res = await fs.proveOwnershipAndMode(DIR);
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("windows-secure-object-unavailable");
		expect(res.detail).toMatch(/child exited/);
	});

	it("a transport failure on openDir does not set notFound (fail closed, not skip)", async () => {
		const t = makeFakeHelperTransport();
		t.failNext(new Error("helper timeout"));
		const fs = createWindowsSecureFs(t);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(false);
		expect(res.notFound).toBeFalsy();
	});
});

// ---------------------------------------------------------------------------
// refusingTransport (Task 2.2)
// ---------------------------------------------------------------------------

describe("refusingTransport", () => {
	it("refuses every op with windows-secure-object-unavailable and the given detail", async () => {
		const t = refusingTransport("helper digest mismatch");
		const res = await t.request({ op: "openDir", args: { path: DIR } });
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("windows-secure-object-unavailable");
		expect(res.detail).toBe("helper digest mismatch");
	});

	it("drives the whole adapter to fail closed", async () => {
		const fs = createWindowsSecureFs(
			refusingTransport("helper digest mismatch"),
		);
		const res = await fs.openDirNoFollow(DIR);
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("windows-secure-object-unavailable");
	});
});

// ---------------------------------------------------------------------------
// createPs1Session — digest-verify-before-spawn + lifecycle (Task 2.2)
// ---------------------------------------------------------------------------

const PS1_BYTES = Buffer.from("# fake helper .ps1\n", "utf8");
const PS1_SHA = createHash("sha256").update(PS1_BYTES).digest("hex");
const MATCHING_MANIFEST: WindowsHelperManifest = {
	installerHelpers: {
		windowsSecureObject: {
			name: "javi-forge-windows-secure-object.ps1",
			sha256: PS1_SHA,
		},
	},
};

/** A fake PowerShell child driven by the test (no real process). */
function makeFakeChild(): Ps1Child & {
	emitStdout(buf: Buffer): void;
	emitExit(): void;
	written: Buffer[];
	killed: boolean;
	unrefed: boolean;
} {
	let onData: ((b: Buffer) => void) | undefined;
	let onExit: (() => void) | undefined;
	const child = {
		written: [] as Buffer[],
		killed: false,
		unrefed: false,
		stdin: {
			write(b: Buffer) {
				child.written.push(b);
			},
		},
		stdout: {
			on(_ev: "data", cb: (b: Buffer) => void) {
				onData = cb;
			},
		},
		on(ev: "exit" | "error", cb: () => void) {
			if (ev === "exit") onExit = cb;
		},
		kill() {
			child.killed = true;
		},
		unref() {
			child.unrefed = true;
		},
		emitStdout(buf: Buffer) {
			onData?.(buf);
		},
		emitExit() {
			onExit?.();
		},
	};
	return child;
}

describe("createPs1Session — digest verify before spawn", () => {
	it("returns refusingTransport and NEVER spawns when the manifest binding is null", async () => {
		const spawn = vi.fn();
		const session = createPs1Session({
			manifest: { installerHelpers: { windowsSecureObject: null } },
			readFile: () => PS1_BYTES,
			spawn: spawn as unknown as (c: string, a: string[]) => Ps1Child,
		});
		const res = await session.request({ op: "openDir", args: { path: DIR } });
		expect(res.ok).toBe(false);
		expect(res.detail).toMatch(/digest/i);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("reads the real on-disk manifest + .ps1 by default and, on the Phase-4 digest match, spawns and round-trips", async () => {
		const child = makeFakeChild();
		const spawn = vi.fn(() => child);
		// No manifest/readFile injected → default readManifestBinding reads the real
		// assets/claude-hooks/manifest.json (Phase-4: windowsSecureObject bound to a
		// real sha) and the default readFile hashes the real on-disk .ps1. The digest
		// now MATCHES, so the session spawns lazily and completes a real round-trip —
		// this is the wiring the manifest flip enables.
		const session = createPs1Session({
			spawn: spawn as unknown as (c: string, a: string[]) => Ps1Child,
			registerExitHook: () => {}, // hermetic: no real process 'exit' listener
		});
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		child.emitStdout(encodeFrame({ ready: true, protocolVersion: 1 }));
		child.emitStdout(encodeFrame({ ok: true }));
		const res = await p;
		expect(res.ok).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(1);
		await session.close();
	});

	it("returns refusingTransport and NEVER spawns on a sha256 mismatch", async () => {
		const spawn = vi.fn();
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => Buffer.from("tampered bytes", "utf8"),
			spawn: spawn as unknown as (c: string, a: string[]) => Ps1Child,
		});
		const res = await session.request({ op: "openDir", args: { path: DIR } });
		expect(res.ok).toBe(false);
		expect(res.detail).toMatch(/digest/i);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("spawns lazily (only on the first request) on a digest match", async () => {
		const child = makeFakeChild();
		const spawn = vi.fn(() => child);
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: spawn as unknown as (c: string, a: string[]) => Ps1Child,
		});
		expect(spawn).not.toHaveBeenCalled(); // not spawned at construction
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		// handshake then the op response
		child.emitStdout(encodeFrame({ ready: true, protocolVersion: 1 }));
		child.emitStdout(encodeFrame({ ok: true }));
		const res = await p;
		expect(res.ok).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(child.unrefed).toBe(true);
	});

	it("kills the child and refuses on an oversized frame (desync fail-closed)", async () => {
		const child = makeFakeChild();
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: (() => child) as unknown as (c: string, a: string[]) => Ps1Child,
		});
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		child.emitStdout(encodeFrame({ ready: true, protocolVersion: 1 }));
		const bad = Buffer.alloc(4);
		bad.writeUInt32BE(HELPER_FRAME_LIMIT + 1, 0);
		child.emitStdout(bad);
		const res = await p;
		expect(res.ok).toBe(false);
		expect(child.killed).toBe(true);
	});

	it("refuses when the child exits mid-request", async () => {
		const child = makeFakeChild();
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: (() => child) as unknown as (c: string, a: string[]) => Ps1Child,
		});
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		child.emitStdout(encodeFrame({ ready: true, protocolVersion: 1 }));
		child.emitExit();
		const res = await p;
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("windows-secure-object-unavailable");
	});

	it("refuses on a bad handshake and kills the child", async () => {
		const child = makeFakeChild();
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: (() => child) as unknown as (c: string, a: string[]) => Ps1Child,
		});
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		child.emitStdout(encodeFrame({ ready: false }));
		const res = await p;
		expect(res.ok).toBe(false);
		expect(child.killed).toBe(true);
	});

	it("resolves the binding ONCE — a manifest swap cannot cause an unverified spawn (R1-001)", async () => {
		const child = makeFakeChild();
		const spawn = vi.fn((_c: string, _a: string[]) => child);
		const verified = { name: "verified.ps1", sha256: PS1_SHA };
		const swapped = { name: "swapped.ps1", sha256: PS1_SHA };
		let bindingReads = 0;
		// A manifest whose binding MUTATES on the 2nd read: the old double-read code
		// verified `verified.ps1` then spawned `swapped.ps1`; the fix reads once.
		const mutatingManifest: WindowsHelperManifest = {
			installerHelpers: {
				get windowsSecureObject() {
					bindingReads++;
					return bindingReads === 1 ? verified : swapped;
				},
			},
		};
		const session = createPs1Session({
			assetsDir: "AD",
			manifest: mutatingManifest,
			// only `verified.ps1` hashes to PS1_SHA; `swapped.ps1` would not.
			readFile: (p) =>
				p.endsWith("verified.ps1") ? PS1_BYTES : Buffer.from("swapped bytes"),
			spawn: spawn as unknown as (c: string, a: string[]) => Ps1Child,
		});
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		child.emitStdout(encodeFrame({ ready: true, protocolVersion: 1 }));
		child.emitStdout(encodeFrame({ ok: true }));
		const res = await p;
		expect(res.ok).toBe(true);
		expect(bindingReads).toBe(1); // resolved exactly once
		const spawnArgs = spawn.mock.calls[0][1] as string[];
		// the spawned artifact is EXACTLY the one whose digest was verified.
		expect(spawnArgs.some((a) => a.includes("verified.ps1"))).toBe(true);
		expect(spawnArgs.some((a) => a.includes("swapped.ps1"))).toBe(false);
	});

	it("fails closed when spawn throws synchronously (R4-004)", async () => {
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: (() => {
				throw new Error("EACCES");
			}) as unknown as (c: string, a: string[]) => Ps1Child,
		});
		const res = await session.request({
			op: "proveOwner",
			args: { path: DIR },
		});
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("windows-secure-object-unavailable");
		expect(res.detail).toMatch(/spawn/i);
	});

	it("close() settles pending requests fail-closed instead of hanging (R4-002)", async () => {
		const child = makeFakeChild();
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: (() => child) as unknown as (c: string, a: string[]) => Ps1Child,
		});
		// queued before any handshake → it would never settle without draining.
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		await session.close();
		const res = await p;
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("windows-secure-object-unavailable");
		expect(child.killed).toBe(true);
	});

	it("distinguishes a malformed frame from an oversized one (R3-004)", async () => {
		const child = makeFakeChild();
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: (() => child) as unknown as (c: string, a: string[]) => Ps1Child,
		});
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		child.emitStdout(encodeFrame({ ready: true, protocolVersion: 1 }));
		// valid length header, body that is NOT valid JSON → decodeFrames throws
		// a SyntaxError, which must NOT be mislabeled "oversized frame".
		const badBody = Buffer.from("not-json{", "utf8");
		const header = Buffer.alloc(4);
		header.writeUInt32BE(badBody.byteLength, 0);
		child.emitStdout(Buffer.concat([header, badBody]));
		const res = await p;
		expect(res.ok).toBe(false);
		expect(res.detail).toMatch(/malformed frame/i);
		expect(res.detail).not.toMatch(/oversized/i);
		expect(child.killed).toBe(true);
	});

	it("refuses (does not hang) when the child never replies to a request (R4-001)", async () => {
		const child = makeFakeChild();
		let fire: (() => void) | undefined;
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: (() => child) as unknown as (c: string, a: string[]) => Ps1Child,
			// Capture the op-deadline callback (ms === opTimeoutMs) so the test can
			// fire it deterministically without real time — the injected timer seam.
			setTimer: (fn, ms) => {
				if (ms === 50) fire = fn;
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
			clearTimer: () => {},
			opTimeoutMs: 50,
			registerExitHook: () => {},
		});
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		child.emitStdout(encodeFrame({ ready: true, protocolVersion: 1 }));
		// The child ACKs the handshake but NEVER replies to the request. Firing the
		// armed deadline must kill the child and settle the caller fail-closed.
		expect(fire).toBeDefined();
		fire?.();
		const res = await p;
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("windows-secure-object-unavailable");
		expect(res.detail).toMatch(/timeout/i);
		expect(child.killed).toBe(true);
	});

	it("refuses (does not hang) when the handshake never arrives (R4-001)", async () => {
		const child = makeFakeChild();
		let fire: (() => void) | undefined;
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: (() => child) as unknown as (c: string, a: string[]) => Ps1Child,
			setTimer: (fn, ms) => {
				if (ms === 50) fire = fn;
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
			clearTimer: () => {},
			opTimeoutMs: 50,
			registerExitHook: () => {},
		});
		const p = session.request({ op: "proveOwner", args: { path: DIR } });
		// No handshake is ever emitted; the handshake deadline must fire closed.
		expect(fire).toBeDefined();
		fire?.();
		const res = await p;
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("windows-secure-object-unavailable");
		expect(res.detail).toMatch(/timeout/i);
		expect(child.killed).toBe(true);
	});

	it("does NOT re-init or spawn a child after close() — a completed close is terminal (R1-004)", async () => {
		const child = makeFakeChild();
		const spawn = vi.fn(() => child);
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: spawn as unknown as (c: string, a: string[]) => Ps1Child,
		});
		// close() BEFORE any request → the session was never initialized/spawned.
		await session.close();
		// A subsequent request must refuse closed and MUST NOT run init()/spawn a
		// fresh child the finished close() would never reap.
		const res = await session.request({
			op: "proveOwner",
			args: { path: DIR },
		});
		expect(res.ok).toBe(false);
		expect(res.refusal).toBe("windows-secure-object-unavailable");
		expect(spawn).not.toHaveBeenCalled();
	});
});

describe("createPs1Session — idle watchdog gated on outstanding handles (W1)", () => {
	it("does NOT arm the idle timer while a directory handle is outstanding", async () => {
		const child = makeFakeChild();
		let armed = 0;
		const session = createPs1Session({
			manifest: MATCHING_MANIFEST,
			readFile: () => PS1_BYTES,
			spawn: (() => child) as unknown as (c: string, a: string[]) => Ps1Child,
			// Only count IDLE arms (ms === idleMs); the R4-001 op deadline shares the
			// same seam but arms with opTimeoutMs, so it must not inflate this count.
			setTimer: (_fn, ms) => {
				if (ms === 10) armed++;
				return 1 as unknown as ReturnType<typeof setTimeout>;
			},
			clearTimer: () => {},
			idleMs: 10,
		});
		// openDir succeeds → one outstanding handle → watchdog must stay disarmed
		const p1 = session.request({ op: "openDir", args: { path: DIR } });
		child.emitStdout(encodeFrame({ ready: true, protocolVersion: 1 }));
		child.emitStdout(
			encodeFrame({
				ok: true,
				value: { handleId: "h1", opaque: OPAQUE, attributes: DIR_ATTR },
			}),
		);
		await p1;
		expect(armed).toBe(0);

		// releaseHandle drops the count to zero → watchdog may now arm
		const p2 = session.request({ op: "releaseHandle", args: { handle: "h1" } });
		child.emitStdout(encodeFrame({ ok: true }));
		await p2;
		expect(armed).toBeGreaterThan(0);
	});
});
