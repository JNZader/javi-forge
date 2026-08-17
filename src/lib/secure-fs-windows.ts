/**
 * Windows `PlatformSecureFs` adapter for the SkillGuard transactional installer
 * (Slice 3b). It is the win32 analog of the POSIX adapter: the ONLY place a
 * Windows security decision is requested, delegated across an injectable
 * `HelperTransport` seam to a bundled, digest-bound PowerShell helper (Phase 3)
 * that owns the real OS handles and computes Predicate A/B verdicts.
 *
 * This module is host-independent and fully testable on Linux via a fake
 * transport: `createWindowsSecureFs` builds framed requests and maps framed
 * responses to `SecureResult`s; it enforces the TS-side invariants the design
 * pins to the adapter (never the `.ps1`):
 *   - C1 (Decision 1a): `mode` is a sentinel, NOT POSIX bits. `captureFile`
 *     returns `WIN32_MODE_SENTINEL`; `applyExactMode` refuses any other mode.
 *   - C4 (Decision 1b): identity is the full-precision `volumeSerial:FileId`
 *     `opaque` token; an absent/zero/malformed token is a HARD REFUSAL, never a
 *     fallback to the truncated `dev`/`ino` (display-only).
 *   - JDA6-001 (Round-6): `openDir` maps ONLY `ERROR_FILE_NOT_FOUND` (2) /
 *     `ERROR_PATH_NOT_FOUND` (3) to `notFound:true`; every other failure leaves
 *     it absent so a present-but-unopenable container fails the transaction closed.
 *   - JDA7-001 (Round-7): `openDir` asserts `FILE_ATTRIBUTE_DIRECTORY` and
 *     refuses a non-directory with `notFound:false` (POSIX `O_DIRECTORY` parity).
 * Every transport error (spawn failure, dead session, bad frame, timeout) maps
 * to a fail-closed refusal — Windows is never a weaker tier than POSIX.
 */

import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CLAUDE_HOOK_ASSETS_DIR } from "../constants.js";
import type {
	CapturedFile,
	PlatformSecureFs,
	SecureDirHandle,
	SecureIdentity,
	SecureRefusal,
	SecureResult,
} from "./secure-fs-transaction.js";

// --- protocol constants ------------------------------------------------------

/**
 * The mode `captureFile` returns and `applyExactMode` demands on win32 (C1).
 * NTFS has no POSIX bits; the value only has to survive the core's opaque
 * round-trip, and `0o600` is the private-file mode the core already threads.
 */
export const WIN32_MODE_SENTINEL = 0o600;

/** Reject any frame whose declared length exceeds this (hook assets are tiny). */
export const HELPER_FRAME_LIMIT = 8 * 1024 * 1024; // 8 MiB

/** `GetFileInformationByHandle` attribute for a directory node. */
const FILE_ATTRIBUTE_DIRECTORY = 0x10;
/** win32 not-found status codes → the ONLY `notFound:true` mapping (JDA6-001). */
const ERROR_FILE_NOT_FOUND = 2;
const ERROR_PATH_NOT_FOUND = 3;

/** Windows PowerShell 5.1 host (always present on windows-latest). */
const POWERSHELL = "powershell.exe";
const POWERSHELL_ARGS = [
	"-NoProfile",
	"-NonInteractive",
	"-ExecutionPolicy",
	"Bypass",
	"-File",
];

/** Kill an idle session this long after the last transaction (zero handles). */
const HELPER_IDLE_MS = 30_000;

// --- transport seam ----------------------------------------------------------

export type HelperOp =
	| "openDir"
	| "revalidate"
	| "proveOwner"
	| "proveDacl"
	| "proveContainer"
	| "createDir"
	| "capture"
	| "writeExcl"
	| "applyMode"
	| "rename"
	| "unlink"
	| "rmdir"
	| "releaseHandle";

export interface HelperRequest {
	op: HelperOp;
	args: Record<string, unknown>;
}

export interface HelperResponse {
	ok: boolean;
	value?: unknown;
	refusal?: SecureRefusal;
	detail?: string;
	/** win32 error code on an openDir failure; drives the notFound mapping. */
	status?: number;
}

export interface HelperTransport {
	/** Strictly serial: exactly one outstanding request at a time. */
	request(req: HelperRequest): Promise<HelperResponse>;
	/** Idempotent; kills the child. */
	close(): Promise<void>;
}

// --- framing (pure, host-independent) ---------------------------------------

/** Encode a JSON body as `[uint32 BE byteLength][UTF-8 JSON]`. */
export function encodeFrame(body: unknown): Buffer {
	const json = Buffer.from(JSON.stringify(body), "utf8");
	const header = Buffer.alloc(4);
	header.writeUInt32BE(json.byteLength, 0);
	return Buffer.concat([header, json]);
}

/**
 * Decode as many complete frames as `buf` holds, returning them plus the
 * unconsumed remainder. Throws on a declared length past `HELPER_FRAME_LIMIT`
 * (the caller kills the session and fails closed).
 */
export function decodeFrames(buf: Buffer): { frames: unknown[]; rest: Buffer } {
	const frames: unknown[] = [];
	let offset = 0;
	while (buf.byteLength - offset >= 4) {
		const len = buf.readUInt32BE(offset);
		if (len > HELPER_FRAME_LIMIT) {
			throw new Error(`oversized frame: ${len} > ${HELPER_FRAME_LIMIT}`);
		}
		if (buf.byteLength - offset - 4 < len) break; // partial body — wait for more
		const body = buf.subarray(offset + 4, offset + 4 + len);
		frames.push(JSON.parse(body.toString("utf8")));
		offset += 4 + len;
	}
	return { frames, rest: buf.subarray(offset) };
}

// --- result helpers ----------------------------------------------------------

const ok = (): SecureResult<void> => ({ ok: true });
const okValue = <T>(value: T): SecureResult<T> => ({ ok: true, value });
const refuse = <T>(
	refusal: SecureRefusal,
	detail: string,
): SecureResult<T> => ({ ok: false, refusal, detail });

/** Map a void framed response, defaulting a refusal to the win32 DACL class. */
function mapVoid(res: HelperResponse, step: string): SecureResult<void> {
	// R1-002: acceptance is STRICT — a malformed frame with a truthy-non-boolean
	// `ok` (e.g. `1` or `"false"`) must NOT coerce to ACCEPT.
	if (res.ok === true) return ok();
	return {
		ok: false,
		refusal: res.refusal ?? "unsafe-windows-dacl",
		detail: res.detail ?? step,
	};
}

/**
 * A valid win32 identity token is `"<volHex>:<fileIdHex>"` with a NON-zero
 * FileId. Absent/empty/malformed/zero-FileId → refuse (C4): distinct SMB/exotic
 * objects share `FileId == 0`, and a swap on a colliding identity would be
 * accepted. Never falls back to the truncated `dev`/`ino`.
 */
function validOpaque(opaque: unknown): opaque is string {
	if (typeof opaque !== "string") return false;
	const parts = opaque.split(":");
	if (parts.length !== 2) return false;
	const [vol, fileId] = parts;
	if (!/^[0-9a-fA-F]+$/.test(vol) || !/^[0-9a-fA-F]+$/.test(fileId))
		return false;
	if (/^0+$/.test(fileId)) return false; // zero FileId → collision → refuse
	return true;
}

/** Derive DISPLAY-ONLY `dev`/`ino` from the opaque token; never compared. */
function identityFromOpaque(opaque: string): SecureIdentity {
	const [vol, fileId] = opaque.split(":");
	const dev = Number.parseInt(vol, 16) >>> 0;
	const ino = Number.parseInt(fileId.slice(-8), 16) >>> 0;
	return { dev, ino, opaque };
}

// --- adapter -----------------------------------------------------------------

export function createWindowsSecureFs(
	transport: HelperTransport,
): PlatformSecureFs {
	// Maps a returned handle object to the `.ps1`-side handleId so ops taking a
	// SecureDirHandle can address the retained kernel handle.
	const handleIds = new WeakMap<SecureDirHandle, string>();

	/** Send a request, mapping ANY transport error to a fail-closed refusal. */
	async function call(req: HelperRequest): Promise<HelperResponse> {
		try {
			return await transport.request(req);
		} catch (error) {
			const cause = error instanceof Error ? error.message : String(error);
			return {
				ok: false,
				refusal: "windows-secure-object-unavailable",
				detail: `helper ${cause}`,
			};
		}
	}

	// Always emits a releaseHandle op, even for a missing/malformed id: the
	// session increments `outstanding` on ANY ok openDir/createDir frame, so a
	// balancing releaseHandle is the ONLY way to decrement it back (R4-003).
	async function releaseHandle(handleId: unknown): Promise<void> {
		const handle = typeof handleId === "string" ? handleId : null;
		await call({ op: "releaseHandle", args: { handle } });
	}

	function makeHandle(
		dirPath: string,
		handleId: string,
		opaque: string,
	): SecureDirHandle {
		const handle: SecureDirHandle = {
			path: dirPath,
			identity: identityFromOpaque(opaque),
			close: () => releaseHandle(handleId),
		};
		handleIds.set(handle, handleId);
		return handle;
	}

	/** Shared open→handle path for openDir and createDir. */
	async function toHandle(
		res: HelperResponse,
		dirPath: string,
		step: string,
	): Promise<SecureResult<SecureDirHandle>> {
		// R1-002: STRICT accept — a truthy-non-boolean `ok` must not open a handle.
		if (res.ok !== true || !res.value) {
			const result = refuse<SecureDirHandle>(
				res.refusal ?? "unsafe-parent-chain",
				res.detail ?? step,
			);
			if (
				res.status === ERROR_FILE_NOT_FOUND ||
				res.status === ERROR_PATH_NOT_FOUND
			) {
				result.notFound = true; // the ONLY safe skip/create signal (JDA6-001)
			}
			return result;
		}
		const v = res.value as {
			handleId?: unknown;
			opaque?: unknown;
			attributes?: unknown;
		};
		const handleId = typeof v.handleId === "string" ? v.handleId : undefined;
		const attributes = typeof v.attributes === "number" ? v.attributes : 0;
		// JDA7-001: refuse a non-directory (POSIX O_DIRECTORY parity), notFound=false.
		if ((attributes & FILE_ATTRIBUTE_DIRECTORY) === 0) {
			await releaseHandle(handleId);
			return refuse(
				"unsafe-parent-chain",
				`${step}: not a directory ${dirPath}`,
			);
		}
		// C4: a directory we cannot identify by full-precision FileId is a refusal.
		if (!validOpaque(v.opaque)) {
			await releaseHandle(handleId);
			return refuse(
				"unsafe-parent-chain",
				`${step}: unresolvable identity ${dirPath}`,
			);
		}
		if (!handleId) {
			// R4-003: the .ps1 acked (session already incremented `outstanding`) but
			// sent no usable id — emit a balancing release so the idle watchdog can
			// still arm; otherwise a malformed ok permanently disarms it.
			await releaseHandle(v.handleId);
			return refuse("unsafe-parent-chain", `${step}: no handle ${dirPath}`);
		}
		return okValue(makeHandle(dirPath, handleId, v.opaque));
	}

	const secureFs: PlatformSecureFs = {
		async openDirNoFollow(dirPath) {
			return toHandle(
				await call({ op: "openDir", args: { path: dirPath } }),
				dirPath,
				`openDir ${dirPath}`,
			);
		},

		async revalidateIdentity(target, held) {
			if (!validOpaque(held.opaque)) {
				return refuse(
					"unsafe-parent-chain",
					`revalidate ${target}: unresolvable identity`,
				);
			}
			return mapVoid(
				await call({
					op: "revalidate",
					args: { path: target, opaque: held.opaque },
				}),
				`revalidate ${target}`,
			);
		},

		async proveOwnershipAndMode(dirPath) {
			return mapVoid(
				await call({ op: "proveOwner", args: { path: dirPath } }),
				`ownership ${dirPath}`,
			);
		},

		async proveNoExtendedAcl(target) {
			return mapVoid(
				await call({ op: "proveDacl", args: { path: target } }),
				`acl ${target}`,
			);
		},

		async proveManagedContainer(dirPath) {
			return mapVoid(
				await call({ op: "proveContainer", args: { path: dirPath } }),
				`container ${dirPath}`,
			);
		},

		async createDirExclusive(parent, name, mode) {
			// C1/JD-A-104: createDir ignores the numeric mode (Predicate B descriptor
			// governs), so NO sentinel assertion here — the core threads 0o700.
			const parentHandle = handleIds.get(parent);
			const full = path.join(parent.path, name);
			return toHandle(
				await call({
					op: "createDir",
					args: { parentHandle, name, mode },
				}),
				full,
				`createDir ${full}`,
			);
		},

		async captureFile(target) {
			const res = await call({ op: "capture", args: { path: target } });
			// R1-002: STRICT accept — reject a truthy-non-boolean `ok`.
			if (res.ok !== true || !res.value) {
				return refuse(
					res.refusal ?? "unsafe-windows-dacl",
					res.detail ?? `capture ${target}`,
				);
			}
			const v = res.value as { bytes?: unknown; opaque?: unknown };
			if (typeof v.bytes !== "string") {
				return refuse(
					"unsafe-parent-chain",
					`capture ${target}: missing bytes`,
				);
			}
			if (!validOpaque(v.opaque)) {
				return refuse(
					"unsafe-parent-chain",
					`capture ${target}: unresolvable identity`,
				);
			}
			const bytes = Buffer.from(v.bytes, "base64");
			return okValue<CapturedFile>({
				bytes,
				mode: WIN32_MODE_SENTINEL, // C1: sentinel, not a real NTFS permission
				identity: identityFromOpaque(v.opaque),
				sha256: createHash("sha256").update(bytes).digest("hex"),
			});
		},

		async writeExclusive(dir, name, bytes, mode) {
			const dirHandle = handleIds.get(dir);
			return mapVoid(
				await call({
					op: "writeExcl",
					args: {
						dirHandle,
						name,
						bytes: bytes.toString("base64"), // binary payload → base64 JSON body
						mode,
					},
				}),
				`writeExclusive ${name}`,
			);
		},

		async applyExactMode(target, mode) {
			// JD-A-104: the sentinel equality check lives ONLY here — the core only
			// ever calls applyExactMode with the 0o600 file mode it captured.
			if (mode !== WIN32_MODE_SENTINEL) {
				return refuse(
					"unsafe-parent-chain",
					`applyMode ${target}: unexpected mode ${mode.toString(8)}`,
				);
			}
			return mapVoid(
				await call({ op: "applyMode", args: { path: target, mode } }),
				`applyMode ${target}`,
			);
		},

		async renameInDir(dir, from, to) {
			const dirHandle = handleIds.get(dir);
			return mapVoid(
				await call({ op: "rename", args: { dirHandle, from, to } }),
				`rename ${from}->${to}`,
			);
		},

		async unlinkIfIdentity(dir, name, held) {
			if (!validOpaque(held.opaque)) {
				return refuse(
					"unsafe-parent-chain",
					`unlink ${name}: unresolvable identity`,
				);
			}
			const dirHandle = handleIds.get(dir);
			return mapVoid(
				await call({
					op: "unlink",
					args: { dirHandle, name, opaque: held.opaque },
				}),
				`unlink ${name}`,
			);
		},

		async rmdirIfIdentityEmpty(handle) {
			if (!validOpaque(handle.identity.opaque)) {
				return refuse(
					"unsafe-parent-chain",
					`rmdir ${handle.path}: unresolvable identity`,
				);
			}
			const id = handleIds.get(handle);
			return mapVoid(
				await call({
					op: "rmdir",
					args: { handle: id, opaque: handle.identity.opaque },
				}),
				`rmdir ${handle.path}`,
			);
		},
	};

	return secureFs;
}

// --- digest-bound refusing transport ----------------------------------------

/**
 * A transport that refuses EVERY op — used when the `.ps1` digest does not match
 * the manifest binding (or the binding is absent). No PowerShell is spawned.
 */
export function refusingTransport(detail: string): HelperTransport {
	return {
		async request() {
			return {
				ok: false,
				refusal: "windows-secure-object-unavailable",
				detail,
			};
		},
		async close() {},
	};
}

// --- real PowerShell session transport --------------------------------------

/** The subset of a spawned child process this session drives. */
export interface Ps1Child {
	stdin: { write(chunk: Buffer): void };
	stdout: { on(event: "data", cb: (chunk: Buffer) => void): void };
	stderr?: { on(event: "data", cb: (chunk: Buffer) => void): void };
	on(event: "exit" | "error", cb: (...args: unknown[]) => void): void;
	kill(): void;
	unref?(): void;
}

export interface WindowsHelperBinding {
	name: string;
	sha256: string;
}

export interface WindowsHelperManifest {
	installerHelpers?: { windowsSecureObject?: WindowsHelperBinding | null };
}

export interface Ps1SessionOptions {
	assetsDir?: string;
	manifest?: WindowsHelperManifest | null;
	readFile?: (filePath: string) => Buffer;
	spawn?: (cmd: string, args: string[]) => Ps1Child;
	idleMs?: number;
	setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
	clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
	registerExitHook?: (fn: () => void) => void;
}

interface Pending {
	req: HelperRequest;
	resolve: (res: HelperResponse) => void;
}

/**
 * The real transport: verify the on-disk `.ps1` sha256 against the manifest
 * binding BEFORE spawning (tamper-evident, symmetric with the `.mjs`); on a
 * mismatch/absent binding return `refusingTransport` and spawn nothing. On a
 * match, spawn `powershell.exe` lazily on the first request, complete the
 * handshake, and exchange strictly-serial length-prefixed frames. Any oversized
 * frame, bad handshake, child exit, or session error kills the child and fails
 * every pending/subsequent op closed. The idle watchdog only arms when ZERO
 * directory handles are outstanding (W1) so it never kills a live transaction.
 */
export function createPs1Session(
	opts: Ps1SessionOptions = {},
): HelperTransport {
	const assetsDir = opts.assetsDir ?? CLAUDE_HOOK_ASSETS_DIR;
	const readFile = opts.readFile ?? ((p: string) => readFileSync(p));
	const spawn =
		opts.spawn ??
		((cmd: string, args: string[]) =>
			nodeSpawn(cmd, args) as unknown as Ps1Child);
	const idleMs = opts.idleMs ?? HELPER_IDLE_MS;
	const setTimer =
		opts.setTimer ??
		((fn: () => void, ms: number) => {
			const t = setTimeout(fn, ms);
			t.unref?.();
			return t;
		});
	const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));
	const registerExitHook =
		opts.registerExitHook ?? ((fn) => process.once("exit", fn));

	let initialized = false;
	let dead = false;
	let deadDetail = "helper closed";
	let child: Ps1Child | null = null;
	let ready = false;
	let buffer: Buffer = Buffer.alloc(0);
	let current: Pending | null = null;
	const queue: Pending[] = [];
	let outstanding = 0; // live directory handles in the .ps1 handle table
	let idleTimer: ReturnType<typeof setTimeout> | null = null;

	/** Resolve the manifest binding from exactly ONE source (R1-001). */
	function resolveBinding(): WindowsHelperBinding | null | undefined {
		return opts.manifest
			? opts.manifest.installerHelpers?.windowsSecureObject
			: readManifestBinding();
	}

	/**
	 * R1-001: resolve the binding ONCE, verify the on-disk `.ps1` sha256 against
	 * it, and RETURN the verified binding so `init` spawns EXACTLY the artifact
	 * that was hashed. A manifest swap between verify and spawn can no longer slip
	 * an unverified `.ps1` through (there is no second manifest read). Any
	 * mismatch/absent binding/read error → a fail-closed detail, no binding.
	 * (The file-content TOCTOU — hash reads the `.ps1`, powershell re-opens it by
	 * path — is an already-accepted design residual, parity with the `.mjs`.)
	 */
	function verifyDigest():
		| { binding: WindowsHelperBinding }
		| { detail: string } {
		const binding = resolveBinding();
		if (!binding) return { detail: "helper digest mismatch" };
		try {
			const bytes = readFile(path.join(assetsDir, binding.name));
			const sha = createHash("sha256").update(bytes).digest("hex");
			if (sha !== binding.sha256) return { detail: "helper digest mismatch" };
		} catch {
			return { detail: "helper digest mismatch" };
		}
		return { binding };
	}

	function readManifestBinding(): WindowsHelperBinding | null | undefined {
		try {
			const raw = readFile(path.join(assetsDir, "manifest.json"));
			const parsed = JSON.parse(raw.toString("utf8")) as WindowsHelperManifest;
			return parsed.installerHelpers?.windowsSecureObject;
		} catch {
			return null;
		}
	}

	// PHASE-4 GATE (R4-001): there is intentionally NO per-request/handshake
	// timeout here yet. It is safe in Phase 2 ONLY because the manifest binding is
	// null so no real child ever spawns. Before flipping
	// `manifest.installerHelpers.windowsSecureObject` to a real sha in Phase 4,
	// a HELPER_OP_TIMEOUT_MS deadline MUST be added in the SAME change — otherwise
	// a hung/non-responding `.ps1` hangs the installer transaction forever.
	function init(): void {
		initialized = true;
		const verified = verifyDigest();
		if ("detail" in verified) {
			dead = true;
			deadDetail = verified.detail;
			return;
		}
		// R1-001: spawn EXACTLY the binding that verifyDigest hashed — no re-read.
		const ps1Path = path.join(assetsDir, verified.binding.name);
		try {
			child = spawn(POWERSHELL, [...POWERSHELL_ARGS, ps1Path]);
		} catch (error) {
			// R4-004: a synchronous spawn throw must fail closed, not hang callers.
			dead = true;
			deadDetail = `helper spawn ${error instanceof Error ? error.message : String(error)}`;
			return;
		}
		child.unref?.();
		child.stdout.on("data", onData);
		child.on("exit", () => onExit());
		child.on("error", () => onExit());
		registerExitHook(() => child?.kill());
	}

	/**
	 * Settle every pending/queued request (current is always `queue[0]` until its
	 * response shifts it) with the current fail-closed `deadDetail`, so no caller
	 * ever hangs. Shared by `fail` and `close` (R4-002).
	 */
	function drainPending(): void {
		const all = [...queue];
		queue.length = 0;
		current = null;
		for (const item of all) {
			item.resolve({
				ok: false,
				refusal: "windows-secure-object-unavailable",
				detail: deadDetail,
			});
		}
	}

	function fail(detail: string): void {
		if (dead) return;
		dead = true;
		deadDetail = `helper ${detail}`;
		child?.kill();
		if (idleTimer) {
			clearTimer(idleTimer);
			idleTimer = null;
		}
		drainPending();
	}

	function onExit(): void {
		fail("child exited");
	}

	function onData(chunk: Buffer): void {
		buffer = Buffer.concat([buffer, chunk]);
		let decoded: { frames: unknown[]; rest: Buffer };
		try {
			decoded = decodeFrames(buffer);
		} catch (error) {
			// R3-004: both stay fail-closed, but distinguish a genuine oversized
			// frame from a malformed/zero-length/bad-JSON body in the diagnostic.
			const msg = error instanceof Error ? error.message : String(error);
			fail(
				/oversized/i.test(msg) ? "oversized frame" : `malformed frame: ${msg}`,
			);
			return;
		}
		buffer = decoded.rest;
		for (const frame of decoded.frames) handleFrame(frame);
	}

	function handleFrame(frame: unknown): void {
		if (dead) return;
		if (!ready) {
			const hs = frame as { ready?: unknown; protocolVersion?: unknown };
			if (hs?.ready === true && hs.protocolVersion === 1) {
				ready = true;
				pump();
			} else {
				fail("bad handshake");
			}
			return;
		}
		const item = current;
		if (!item) return; // stray frame with nothing outstanding — ignore
		current = null;
		queue.shift();
		adjustHandles(item.req, frame as HelperResponse);
		item.resolve(frame as HelperResponse);
		maybeArmIdle();
		pump();
	}

	function adjustHandles(req: HelperRequest, res: HelperResponse): void {
		if ((req.op === "openDir" || req.op === "createDir") && res.ok === true) {
			outstanding++;
		} else if (req.op === "releaseHandle") {
			outstanding = Math.max(0, outstanding - 1);
		}
	}

	function maybeArmIdle(): void {
		if (dead || current || queue.length > 0 || outstanding > 0) return;
		if (idleTimer) return;
		idleTimer = setTimer(() => {
			idleTimer = null;
			fail("idle");
		}, idleMs);
	}

	function pump(): void {
		if (dead || !ready || current || queue.length === 0) return;
		current = queue[0];
		child?.stdin.write(encodeFrame(current.req));
	}

	return {
		async request(req) {
			if (!initialized) init();
			if (dead) {
				return {
					ok: false,
					refusal: "windows-secure-object-unavailable",
					detail: deadDetail,
				};
			}
			if (idleTimer) {
				clearTimer(idleTimer);
				idleTimer = null;
			}
			return new Promise<HelperResponse>((resolve) => {
				queue.push({ req, resolve });
				pump();
			});
		},
		async close() {
			if (!dead) {
				dead = true;
				deadDetail = "helper closed";
			}
			if (idleTimer) {
				clearTimer(idleTimer);
				idleTimer = null;
			}
			// R4-002: drain BEFORE killing the child so pending/queued promises settle
			// fail-closed even when close() (not onExit) is the terminator — otherwise
			// a caller that wired abort→close() would hang forever.
			drainPending();
			child?.kill();
		},
	};
}
