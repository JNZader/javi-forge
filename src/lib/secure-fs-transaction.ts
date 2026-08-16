/**
 * Platform-agnostic transactional file-write core for the SkillGuard Claude
 * PreToolUse installer (Slice 3a). This module owns all irreversible I/O behind
 * a single `PlatformSecureFs` adapter interface: it NEVER spawns a process and
 * NEVER branches on `process.platform`. Every ownership/identity/ACL/exclusive
 * decision is delegated to the injected adapter, so the engine is reviewed once
 * (platform-free) and exercised by a synchronous in-memory fake in tests.
 *
 * WU-2 defines the interface + result types here so the POSIX adapter can
 * implement them; WU-3 grows this file with `runTransaction` + `TransactionDeps`.
 */

/** Identity of an opened directory/file, captured from its handle. */
export interface SecureIdentity {
	dev: number;
	ino: number;
}

/** A held, no-follow directory handle plus its captured identity and path. */
export interface SecureDirHandle {
	readonly path: string;
	readonly identity: SecureIdentity;
	close(): Promise<void>;
}

/** Captured prior state of a target file, taken through the validated gate. */
export interface CapturedFile {
	bytes: Buffer;
	mode: number; // exact source mode, e.g. 0o600 / 0o644
	identity: SecureIdentity;
	sha256: string;
}

export type SecureRefusal =
	| "unsafe-parent-chain" // owner/mode/identity/handle proof failed
	| "unsupported-posix-acl" // ACL tool absent/parse/timeout/extended/changed
	| "windows-secure-object-unavailable"; // 3a Windows stub only

export interface SecureResult<T> {
	ok: boolean;
	value?: T;
	refusal?: SecureRefusal;
	detail?: string; // first offending path/capability, never secret content
}

/**
 * The whole platform boundary. Every host-dependent operation is a method here;
 * the transaction core talks only to this interface. POSIX now, Windows stub in
 * Slice 3b, a synchronous fake in tests.
 */
export interface PlatformSecureFs {
	/** Open an existing directory no-follow (O_DIRECTORY|O_NOFOLLOW) and capture dev+ino. */
	openDirNoFollow(dirPath: string): Promise<SecureResult<SecureDirHandle>>;

	/** Reopen a path and confirm its identity equals a previously held one. */
	revalidateIdentity(
		target: string,
		held: SecureIdentity,
	): Promise<SecureResult<void>>;

	/** Prove owner == effective uid or root AND no group/other write bits. */
	proveOwnershipAndMode(dirPath: string): Promise<SecureResult<void>>;

	/** Prove no extended/named/mask/default/inherited ACL on the path. */
	proveNoExtendedAcl(target: string): Promise<SecureResult<void>>;

	/** Create ONE child directory exclusively at mode, reopen+verify, return its handle. */
	createDirExclusive(
		parent: SecureDirHandle,
		name: string,
		mode: number,
	): Promise<SecureResult<SecureDirHandle>>;

	/**
	 * Capture a regular file's bytes+mode+identity+sha through the validated gate.
	 * MUST open the target with `O_NOFOLLOW|O_RDONLY` (never a plain path read): a
	 * symlink swapped in at the target name must fail the open, not be
	 * dereferenced. This is a security boundary (JD-B-003) — the capture is the
	 * source of both the persistent backup and the in-memory rollback bytes.
	 */
	captureFile(target: string): Promise<SecureResult<CapturedFile>>;

	/**
	 * Create <name> in dir with O_CREAT|O_EXCL|O_WRONLY|O_NOFOLLOW at mode; write
	 * bytes; `handle.sync()` (fsync) the file before close. The write and the
	 * fsync are one method so an fsync fault is an injectable fault point of
	 * `writeExclusive` itself (JD-B-004): a fake can succeed the write and fail
	 * the sync to drive that branch.
	 */
	writeExclusive(
		dir: SecureDirHandle,
		name: string,
		bytes: Buffer,
		mode: number,
	): Promise<SecureResult<void>>;

	/** Apply an exact mode to an existing staged file and re-verify mode + ACL absence. */
	applyExactMode(target: string, mode: number): Promise<SecureResult<void>>;

	/** Same-directory rename from -> to, then fsync the directory. */
	renameInDir(
		dir: SecureDirHandle,
		from: string,
		to: string,
	): Promise<SecureResult<void>>;

	/** Unlink an identity-matched file (rollback of a newly created target). */
	unlinkIfIdentity(
		dir: SecureDirHandle,
		name: string,
		held: SecureIdentity,
	): Promise<SecureResult<void>>;

	/** Remove an identity-matched EMPTY directory (rollback of a created segment). */
	rmdirIfIdentityEmpty(handle: SecureDirHandle): Promise<SecureResult<void>>;
}
