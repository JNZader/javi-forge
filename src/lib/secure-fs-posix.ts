/**
 * POSIX `PlatformSecureFs` adapters for the SkillGuard transactional installer
 * (Slice 3a). This is the ONLY place a shell tool runs (`getfacl` on Linux,
 * `/bin/ls -lde` on macOS) and the ONLY place `os`/`fs` ownership bits are
 * interpreted. Everything fails closed: a missing/erroring/timed-out ACL tool,
 * an extended/named/mask/default/inherited ACL entry, a foreign-owned or
 * group/other-writable directory, or any inconclusive result refuses rather than
 * degrading to a weaker mode-only write. It never strips an ACL.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants as FS } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	open,
	rename,
	rmdir,
	unlink,
} from "node:fs/promises";
import path from "node:path";
import type {
	CapturedFile,
	PlatformSecureFs,
	SecureDirHandle,
	SecureIdentity,
	SecureRefusal,
	SecureResult,
} from "./secure-fs-transaction.js";

/** Bounded time budget for a single ACL inspection. */
const ACL_TIMEOUT_MS = 2000;
/** Read budget for the ACL tool output (defensive; ACLs are tiny). */
const ACL_MAX_BUFFER = 1024 * 1024;

/** Outcome of a bounded, locale-C spawn of an ACL inspection tool. */
export interface SpawnOutcome {
	/** The executable could not be spawned (e.g. ENOENT). */
	spawnError?: boolean;
	/** The call exceeded the bounded timeout. */
	timedOut?: boolean;
	/** Exit code, or null when it never exited cleanly. */
	code: number | null;
	stdout: string;
}

export type SpawnFn = (cmd: string, args: string[]) => Promise<SpawnOutcome>;

/** The bounded ACL prover behind each platform adapter. */
export interface PosixAclAdapter {
	/** Run the bounded, LC_ALL=C ACL tool and decide clean|extended|inconclusive. */
	proveClean(target: string): Promise<SecureResult<void>>;
}

// --- result constructors -----------------------------------------------------

const ok = (): SecureResult<void> => ({ ok: true });
const okValue = <T>(value: T): SecureResult<T> => ({ ok: true, value });
const refuse = <T>(
	refusal: SecureRefusal,
	detail: string,
): SecureResult<T> => ({ ok: false, refusal, detail });

function errCode(error: unknown): string | number | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? (error as { code: string | number }).code
		: undefined;
}

// --- default spawn (bounded, LC_ALL=C, argv never a shell string) ------------

const defaultSpawn: SpawnFn = (cmd, args) =>
	new Promise((resolve) => {
		execFile(
			cmd,
			args,
			{
				timeout: ACL_TIMEOUT_MS,
				maxBuffer: ACL_MAX_BUFFER,
				encoding: "utf8",
				env: { ...process.env, LC_ALL: "C", LANG: "C" },
			},
			(error, stdout) => {
				if (!error) return resolve({ code: 0, stdout: stdout ?? "" });
				const e = error as NodeJS.ErrnoException & {
					killed?: boolean;
					signal?: NodeJS.Signals | null;
				};
				if (e.code === "ENOENT") {
					return resolve({ spawnError: true, code: null, stdout: "" });
				}
				if (e.killed || e.signal === "SIGTERM") {
					return resolve({ timedOut: true, code: null, stdout: stdout ?? "" });
				}
				const code = typeof e.code === "number" ? e.code : 1;
				return resolve({ code, stdout: stdout ?? "" });
			},
		);
	});

// --- Linux getfacl adapter (Algorithm D) -------------------------------------

const LINUX_BASE_ENTRY = /^(user|group|other)::/;

export function createLinuxAclAdapter(
	spawn: SpawnFn = defaultSpawn,
): PosixAclAdapter {
	return {
		async proveClean(target) {
			const res = await spawn("getfacl", [
				"--absolute-names",
				"--numeric",
				"--omit-header",
				"--",
				target,
			]);
			if (res.spawnError)
				return refuse("unsupported-posix-acl", "getfacl absent");
			if (res.timedOut)
				return refuse("unsupported-posix-acl", "getfacl timeout");
			if (res.code !== 0) {
				return refuse("unsupported-posix-acl", `getfacl exit ${res.code}`);
			}
			for (const raw of res.stdout.split("\n")) {
				const line = raw.trim();
				if (line === "" || line.startsWith("#")) continue;
				if (LINUX_BASE_ENTRY.test(line)) continue;
				return refuse("unsupported-posix-acl", "extended ACL entry");
			}
			return ok();
		},
	};
}

// --- macOS /bin/ls -lde adapter (Algorithm E) --------------------------------

const MACOS_ACE_LINE = /^\s*\d+:\s/;

export function createMacosAclAdapter(
	spawn: SpawnFn = defaultSpawn,
): PosixAclAdapter {
	return {
		async proveClean(target) {
			const res = await spawn("/bin/ls", ["-lde", "--", target]);
			if (res.spawnError)
				return refuse("unsupported-posix-acl", "/bin/ls absent");
			if (res.timedOut) return refuse("unsupported-posix-acl", "ls timeout");
			if (res.code !== 0) {
				return refuse("unsupported-posix-acl", `ls exit ${res.code}`);
			}
			const lines = res.stdout.split("\n");
			const modeLine = lines[0] ?? "";
			if (modeLine[10] === "+") {
				return refuse("unsupported-posix-acl", "ACL present (+ flag)");
			}
			if (lines.some((line) => MACOS_ACE_LINE.test(line))) {
				return refuse("unsupported-posix-acl", "ACE listed");
			}
			return ok();
		},
	};
}

// --- the POSIX secure filesystem --------------------------------------------

const DIR_FLAGS = FS.O_DIRECTORY | FS.O_NOFOLLOW | FS.O_RDONLY;
const CAPTURE_FLAGS = FS.O_NOFOLLOW | FS.O_RDONLY;
const EXCLUSIVE_FLAGS = FS.O_CREAT | FS.O_EXCL | FS.O_WRONLY | FS.O_NOFOLLOW;

function identityOf(stats: { dev: number; ino: number }): SecureIdentity {
	return { dev: stats.dev, ino: stats.ino };
}

function ownershipTrusted(uid: number): boolean {
	const euid = typeof process.geteuid === "function" ? process.geteuid() : -1;
	return uid === euid || uid === 0;
}

export function createPosixSecureFs(acl: PosixAclAdapter): PlatformSecureFs {
	async function fsyncDir(dirPath: string): Promise<void> {
		const handle = await open(dirPath, DIR_FLAGS);
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	}

	const secureFs: PlatformSecureFs = {
		async openDirNoFollow(dirPath) {
			try {
				const handle = await open(dirPath, DIR_FLAGS);
				try {
					const stats = await handle.stat();
					const identity = identityOf(stats);
					return okValue<SecureDirHandle>({
						path: dirPath,
						identity,
						close: () => handle.close(),
					});
				} catch (error) {
					await handle.close();
					throw error;
				}
			} catch (error) {
				const code = errCode(error);
				const result = refuse<SecureDirHandle>(
					"unsafe-parent-chain",
					`openDir ${dirPath}: ${code ?? "error"}`,
				);
				// Genuine not-found ONLY on ENOENT (Round-6 / JDA6-001). Every other
				// errno — ELOOP/reparse, EACCES, ENOTDIR, transient — leaves notFound
				// absent so a present-but-unopenable managed container fails closed.
				if (code === "ENOENT") result.notFound = true;
				return result;
			}
		},

		async revalidateIdentity(target, held) {
			try {
				const stats = await lstat(target);
				if (stats.dev === held.dev && stats.ino === held.ino) return ok();
				return refuse("unsafe-parent-chain", `identity drift at ${target}`);
			} catch (error) {
				return refuse(
					"unsafe-parent-chain",
					`revalidate ${target}: ${errCode(error) ?? "error"}`,
				);
			}
		},

		async proveOwnershipAndMode(dirPath) {
			try {
				const stats = await lstat(dirPath);
				if (!ownershipTrusted(stats.uid)) {
					return refuse("unsafe-parent-chain", `foreign owner at ${dirPath}`);
				}
				if ((stats.mode & 0o022) !== 0) {
					return refuse(
						"unsafe-parent-chain",
						`group/other-writable ${dirPath}`,
					);
				}
				return ok();
			} catch (error) {
				return refuse(
					"unsafe-parent-chain",
					`ownership ${dirPath}: ${errCode(error) ?? "error"}`,
				);
			}
		},

		proveNoExtendedAcl(target) {
			return acl.proveClean(target);
		},

		async createDirExclusive(parent, name, mode) {
			const full = path.join(parent.path, name);
			try {
				await mkdir(full, { mode }); // fails EEXIST if it already exists
				await chmod(full, mode); // defeat umask masking of mkdir mode
			} catch (error) {
				return refuse(
					"unsafe-parent-chain",
					`mkdir ${full}: ${errCode(error) ?? "error"}`,
				);
			}
			const opened = await secureFs.openDirNoFollow(full);
			if (!opened.ok || !opened.value) return opened;
			const owned = await secureFs.proveOwnershipAndMode(full);
			if (!owned.ok) {
				await opened.value.close();
				return refuse("unsafe-parent-chain", owned.detail ?? full);
			}
			return opened;
		},

		async captureFile(target) {
			try {
				const handle = await open(target, CAPTURE_FLAGS);
				try {
					const stats = await handle.stat();
					if (!stats.isFile()) {
						return refuse(
							"unsafe-parent-chain",
							`capture ${target}: not a regular file`,
						);
					}
					const bytes = await handle.readFile();
					const sha256 = createHash("sha256").update(bytes).digest("hex");
					return okValue<CapturedFile>({
						bytes,
						mode: stats.mode & 0o7777,
						identity: identityOf(stats),
						sha256,
					});
				} finally {
					await handle.close();
				}
			} catch (error) {
				return refuse(
					"unsafe-parent-chain",
					`capture ${target}: ${errCode(error) ?? "error"}`,
				);
			}
		},

		async writeExclusive(dir, name, bytes, mode) {
			const full = path.join(dir.path, name);
			let handle: Awaited<ReturnType<typeof open>> | undefined;
			try {
				handle = await open(full, EXCLUSIVE_FLAGS, mode);
				await handle.writeFile(bytes);
				await handle.sync();
				return ok();
			} catch (error) {
				return refuse(
					"unsafe-parent-chain",
					`writeExclusive ${full}: ${errCode(error) ?? "error"}`,
				);
			} finally {
				await handle?.close().catch(() => {});
			}
		},

		async applyExactMode(target, mode) {
			try {
				await chmod(target, mode);
				const stats = await lstat(target);
				if ((stats.mode & 0o7777) !== mode) {
					return refuse("unsafe-parent-chain", `mode mismatch ${target}`);
				}
			} catch (error) {
				return refuse(
					"unsafe-parent-chain",
					`applyMode ${target}: ${errCode(error) ?? "error"}`,
				);
			}
			return acl.proveClean(target);
		},

		async renameInDir(dir, from, to) {
			try {
				await rename(path.join(dir.path, from), path.join(dir.path, to));
				await fsyncDir(dir.path);
				return ok();
			} catch (error) {
				return refuse(
					"unsafe-parent-chain",
					`rename ${from}->${to}: ${errCode(error) ?? "error"}`,
				);
			}
		},

		async unlinkIfIdentity(dir, name, held) {
			const full = path.join(dir.path, name);
			try {
				const stats = await lstat(full);
				if (stats.dev !== held.dev || stats.ino !== held.ino) {
					return refuse("unsafe-parent-chain", `identity mismatch ${full}`);
				}
				await unlink(full);
				await fsyncDir(dir.path);
				return ok();
			} catch (error) {
				return refuse(
					"unsafe-parent-chain",
					`unlink ${full}: ${errCode(error) ?? "error"}`,
				);
			}
		},

		async rmdirIfIdentityEmpty(handle) {
			try {
				const stats = await lstat(handle.path);
				if (
					stats.dev !== handle.identity.dev ||
					stats.ino !== handle.identity.ino
				) {
					return refuse(
						"unsafe-parent-chain",
						`identity mismatch ${handle.path}`,
					);
				}
				await rmdir(handle.path); // ENOTEMPTY if non-empty → refuse, no escalation
				return ok();
			} catch (error) {
				return refuse(
					"unsafe-parent-chain",
					`rmdir ${handle.path}: ${errCode(error) ?? "error"}`,
				);
			}
		},

		// On POSIX, permission to ADD a child to a directory IS the directory's
		// write bit; proveOwnershipAndMode already refuses any group/other write
		// (stats.mode & 0o022). So the managed-container check is definitionally the
		// same predicate gate() just ran on this path — idempotent, no new refusal
		// surface. The seam has teeth only on win32, where Predicate A tolerates
		// add-child on high ancestors (Round-4 / JDA-401).
		proveManagedContainer(dirPath) {
			return secureFs.proveOwnershipAndMode(dirPath);
		},
	};

	return secureFs;
}

/**
 * Select the POSIX secure filesystem for the host platform. Linux uses the
 * `getfacl` adapter, macOS uses `/bin/ls -lde`; Windows and every other platform
 * return `null` so the manager refuses with `windows-secure-object-unavailable`
 * and mutates nothing (Slice 3b implements Windows).
 */
export function selectSecureFs(
	platform: NodeJS.Platform = process.platform,
): PlatformSecureFs | null {
	if (platform === "linux") return createPosixSecureFs(createLinuxAclAdapter());
	if (platform === "darwin")
		return createPosixSecureFs(createMacosAclAdapter());
	return null;
}
